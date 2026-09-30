#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Site-maintenance handover smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.02 / C5.09 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"
: "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
SITE='22222222-2222-2222-2222-222222222222'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
WO='fa120000-0000-4000-8000-000000000001'
WOM='fa120000-0000-4000-8000-000000000002'
FOREIGN_ORG='fa120000-0000-4000-8000-000000000098'
FOREIGN_SITE='fa120000-0000-4000-8000-000000000099'

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -tAc "$1"
}

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}

rpc() {
  curl -sS -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "$3"
}

MANAGER=$(token manager@syncai.ca 'Manager123!@#')
SUPERVISOR=$(token supervisor@syncai.ca 'Super123!@#')
ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
test -n "$MANAGER" && test -n "$SUPERVISOR" && test -n "$ENGINEER"
MATERIAL=$(psqlc "select id from public.materials where organization_id='$ORG' order by id limit 1")
test -n "$MATERIAL"

psqlc "
  insert into public.organizations(id,name,industry)
  values ('$FOREIGN_ORG','Handover foreign tenant','ci_tenant_wall')
  on conflict(id) do nothing;
  insert into public.sites(id,organization_id,name,location)
  values ('$FOREIGN_SITE','$FOREIGN_ORG','Foreign handover site','CI')
  on conflict(id) do nothing;
  insert into public.work_orders
    (id,organization_id,asset_id,wo_number,title,description,status,priority,type,scheduled_date)
  values
    ('$WO','$ORG','$ASSET','SHIFT-001','Critical seal intervention',
     'Deterministic handover source work.','pending','critical','human_created',current_date)
  on conflict(id) do update set status='pending',priority='critical',scheduled_date=current_date;
  insert into public.work_order_materials
    (id,organization_id,work_order_id,material_id,qty_required,qty_reserved,status,needed_by)
  values ('$WOM','$ORG','$WO','$MATERIAL',2,0,'short',current_date)
  on conflict(work_order_id,material_id) do update
    set qty_required=2,qty_reserved=0,status='short',needed_by=current_date,updated_at=now();
  insert into public.process_events
    (organization_id,asset_id,event_type,severity,tag,description,occurred_at,source_system,external_id)
  values ('$ORG','$ASSET','alarm','critical','CI-SHIFT-001',
    'Deterministic critical handover event.',now(),'ci','site-maintenance-handover-smoke');
"

# The platform baseline carries the exact right/tool and the agent charter is
# visible as product configuration rather than a UI-only label.
PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='maintenance_operations' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='generate_meeting_packs'")" = '1'
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key in ('read_work_context','generate_shift_handover_pack')")" = '2'
test "$(psqlc "select operating_charter ?& array['purpose','inputs','outputs','guardrails','routes'] from public.ai_agents where organization_id='$ORG' and key='maintenance_operations' limit 1")" = 't'

# A reliability engineer cannot impersonate the site-management role and a
# same-tenant token cannot use a foreign site id.
DENIED=$(rpc "$ENGINEER" run_site_maintenance_manager_agent \
  "{\"p_site_id\":\"$SITE\",\"p_window_hours\":12,\"p_outgoing_shift_label\":\"Days\",\"p_incoming_shift_label\":\"Nights\"}")
DENIED="$DENIED" python3 - <<'PY'
import json, os
assert 'requires a named maintenance manager' in json.loads(os.environ['DENIED'])['error']
PY
FOREIGN=$(rpc "$MANAGER" run_site_maintenance_manager_agent \
  "{\"p_site_id\":\"$FOREIGN_SITE\",\"p_window_hours\":12,\"p_outgoing_shift_label\":\"Days\",\"p_incoming_shift_label\":\"Nights\"}")
FOREIGN="$FOREIGN" python3 - <<'PY'
import json, os
assert json.loads(os.environ['FOREIGN'])['error']=='site not found'
PY

BODY=$(rpc "$MANAGER" run_site_maintenance_manager_agent \
  "{\"p_site_id\":\"$SITE\",\"p_window_hours\":12,\"p_outgoing_shift_label\":\"Day shift\",\"p_incoming_shift_label\":\"Night shift\"}")
BODY="$BODY" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert x['status']=='draft', x
assert x['human_acknowledgement_required'] is True, x
assert x['acknowledgement_must_be_different_human'] is True, x
for key in ('may_assign_work','may_close_work','may_release_schedule',
            'may_change_equipment_custody','may_accept_risk','may_commit_spend',
            'may_return_to_service'):
    assert x[key] is False, (key,x)
assert x['counts']['work_orders'] >= 1 and x['counts']['material_shortages'] >= 1, x
PY

PACK=$(BODY="$BODY" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['pack_id'])")
RUN=$(BODY="$BODY" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['run_id'])")
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN' and organization_id='$ORG' and site_id='$SITE' and retained_for_governance and status='completed'")" = '1'
test "$(psqlc "select count(*) from public.shift_handover_packs where id='$PACK' and organization_id='$ORG' and site_id='$SITE' and status='draft' and source_snapshot @> '{\"workOrders\":[{\"sourceKey\":\"work:$WO\"}]}'::jsonb and source_snapshot @> '{\"materialShortages\":[{\"workOrderMaterialId\":\"$WOM\"}]}'::jsonb")" = '1'

# Direct API mutation cannot rewrite frozen evidence.
BEFORE=$(psqlc "select md5(source_snapshot::text) from public.shift_handover_packs where id='$PACK'")
PATCH_STATUS=$(curl -sS -o /tmp/site-handover-patch-body -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/shift_handover_packs?id=eq.$PACK" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $MANAGER" \
  -H 'Content-Type: application/json' -H 'Prefer: return=representation' \
  -d '{"outgoing_shift_label":"forged"}')
case "$PATCH_STATUS" in
  401|403) ;;
  200) test "$(cat /tmp/site-handover-patch-body)" = '[]' ;;
  *) echo "unexpected handover PATCH status: $PATCH_STATUS"; false ;;
esac
test "$(psqlc "select md5(source_snapshot::text) from public.shift_handover_packs where id='$PACK'")" = "$BEFORE"

# The creator cannot self-attest. A different named supervisor can acknowledge
# receipt, and acknowledgement changes no source-work state.
SELF=$(rpc "$MANAGER" acknowledge_shift_handover_pack \
  "{\"p_pack_id\":\"$PACK\",\"p_note\":\"I received the outgoing evidence pack.\"}")
SELF="$SELF" python3 - <<'PY'
import json, os
assert 'different named human' in json.loads(os.environ['SELF'])['error']
PY
ACK=$(rpc "$SUPERVISOR" acknowledge_shift_handover_pack \
  "{\"p_pack_id\":\"$PACK\",\"p_note\":\"Night shift received the pack and will verify the critical seal work first.\"}")
ACK="$ACK" python3 - <<'PY'
import json, os
x=json.loads(os.environ['ACK'])
assert x['status']=='acknowledged' and x['source_state_changed'] is False, x
PY
test "$(psqlc "select count(*) from public.shift_handover_packs where id='$PACK' and status='acknowledged' and acknowledged_by='00000000-0000-0000-0000-000000000007' and acknowledged_role='supervisor'")" = '1'
test "$(psqlc "select status from public.work_orders where id='$WO'")" = 'pending'

echo 'Site-maintenance handover smoke passed: exact_sources=true freshness=true role_gate=true tenant_wall=true immutable_pack=true different_human_ack=true no_execution_authority=true'
