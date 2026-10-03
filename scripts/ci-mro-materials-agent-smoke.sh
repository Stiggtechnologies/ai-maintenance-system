#!/usr/bin/env bash
set -euo pipefail
trap 'echo "MRO Materials Specialist smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.08 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
SITE='22222222-2222-2222-2222-222222222222'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
WORK='bbbbbbbb-0000-0000-0000-000000000001'
MATERIAL='c1080000-0000-4000-8000-000000000001'
ALTERNATE='c1080000-0000-4000-8000-000000000002'
FOREIGN='c1080000-0000-4000-8000-000000000099'
STOCK='c1080000-0000-4000-8000-000000000010'
LOT='c1080000-0000-4000-8000-000000000011'
DEMAND='c1080000-0000-4000-8000-000000000012'
BOM='c1080000-0000-4000-8000-000000000013'
COMPONENT='c1080000-0000-4000-8000-000000000014'
SUBSTITUTION='c1080000-0000-4000-8000-000000000015'
OWNER='00000000-0000-0000-0000-000000000003'
SOURCE='c108-agent-smoke-inventory'

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}

rpc() {
  curl -sS -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "$3"
}

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
TECHNICIAN=$(token technician@syncai.ca 'Tech123!@#')
test -n "$ENGINEER" && test -n "$TECHNICIAN"

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='inventory_management' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='analyse_mro_material_position'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='identify_missing_materials_docs'")" = '1'
test "$(psqlc "select operating_charter ?& array['purpose','modes','inputs','outputs','guardrails','routes'] from public.ai_agents where organization_id='$ORG' and key='inventory_management' limit 1")" = 't'

psqlc "
  insert into public.connectors(
    organization_id,connector_type,name,status,last_success_at,connector_key,
    system_kind,direction,write_enabled,enabled,endpoint_hint,
    expected_interval_minutes,credential_binding_ref,contract_note,register_ref
  ) values (
    '$ORG','inventory','C1.08 agent smoke inventory','active',now(),'$SOURCE',
    'inventory','read_only',false,true,'https://inventory.example.invalid/materials',
    60,'vault://tenant/c108-agent','Read-only C1.08 smoke source.','C1.08')
  on conflict (organization_id,connector_key) where connector_key is not null
  do update set enabled=true,status='active',last_success_at=now();

  insert into public.materials(
    id,organization_id,material_code,description,category,unit_of_measure,
    unit_cost_usd,lead_time_days,min_qty,max_qty,repairable,criticality,
    is_template,basis,source_system,external_id)
  values(
    '$MATERIAL','$ORG','C1-08-ROTABLE','C1.08 governed repairable fixture',
    'Rotables','each',12000,30,4,8,true,'critical',false,
    'Customer fixture representing an exact MRO catalogue record.','$SOURCE','c108-rotable')
  on conflict(id) do update set lead_time_days=30,min_qty=4,max_qty=8,
    repairable=true,criticality='critical',is_template=false,
    basis=excluded.basis,source_system=excluded.source_system;
  insert into public.materials(
    id,organization_id,material_code,description,category,unit_of_measure,
    repairable,criticality,is_template,basis,source_system,external_id)
  values(
    '$ALTERNATE','$ORG','C1-08-ALT','C1.08 governed alternate fixture',
    'Rotables','each',true,'critical',false,
    'Customer fixture representing a governed alternate.','$SOURCE','c108-alternate')
  on conflict(id) do update set is_template=false,basis=excluded.basis,
    source_system=excluded.source_system;

  insert into public.material_stock(
    id,organization_id,material_id,site_id,qty_on_hand,qty_reserved,
    qty_on_order,expected_receipt_date,last_counted_at,source_system)
  values('$STOCK','$ORG','$MATERIAL','$SITE',5,3,2,current_date+20,now(),'$SOURCE')
  on conflict(material_id,site_id) do update set qty_on_hand=5,qty_reserved=3,
    qty_on_order=2,expected_receipt_date=current_date+20,
    last_counted_at=now(),source_system='$SOURCE';

  insert into public.material_stock_lots(
    id,organization_id,material_id,site_id,lot_ref,qty,condition,
    certification_status,certification_ref,location,source_system,basis)
  values('$LOT','$ORG','$MATERIAL','$SITE','C108-LOT-1',2,'serviceable',
    'missing',null,'Stores-A1','$SOURCE','Physical count fixture; certification deliberately missing.')
  on conflict(id) do update set qty=2,condition='serviceable',
    certification_status='missing',source_system='$SOURCE';

  insert into public.work_order_materials(
    id,organization_id,work_order_id,material_id,qty_required,qty_reserved,
    qty_issued,status,needed_by)
  values('$DEMAND','$ORG','$WORK','$MATERIAL',4,1,0,'short',current_date+10)
  on conflict(id) do update set qty_required=4,qty_reserved=1,qty_issued=0,
    status='short',needed_by=current_date+10;

  delete from public.material_events where organization_id='$ORG' and material_id='$MATERIAL';
  insert into public.material_events(
    organization_id,work_order_material_id,material_id,event_type,qty,note,
    source_system,occurred_at)
  values
    ('$ORG',null,'$MATERIAL','issued',1,'Observed issue 1.','$SOURCE',now()-interval '300 days'),
    ('$ORG',null,'$MATERIAL','issued',2,'Observed issue 2.','$SOURCE',now()-interval '180 days'),
    ('$ORG',null,'$MATERIAL','issued',1,'Observed issue 3.','$SOURCE',now()-interval '60 days'),
    ('$ORG',null,'$MATERIAL','returned',1,'Repairable returned to the loop.','$SOURCE',now()-interval '40 days'),
    ('$ORG','$DEMAND','$MATERIAL','shortage_declared',3,'Open shortage fixture.','$SOURCE',now()-interval '1 day');

  insert into public.bom_lines(
    id,organization_id,asset_id,asset_class,material_id,qty_per,
    position_note,source_system)
  values('$BOM','$ORG','$ASSET',null,'$MATERIAL',1,
    'C1.08 pump rotable position.','$SOURCE')
  on conflict(id) do update set material_id='$MATERIAL',qty_per=1,
    position_note='C1.08 pump rotable position.',source_system='$SOURCE';

  insert into public.component_instances(
    id,organization_id,asset_id,component,position,material_id,serial_number,
    installed_at,state,source_system,source_ref,basis)
  values('$COMPONENT','$ORG','$ASSET','C1.08 rotable','c108-smoke','$MATERIAL',
    'C108-SERIAL-1',now()-interval '2 years','installed','$SOURCE','c108-installed',
    'Installed-component fixture with exact serial and source.')
  on conflict(id) do update set material_id='$MATERIAL',state='installed',
    source_system='$SOURCE',basis=excluded.basis;

  insert into public.material_substitutions(
    id,organization_id,material_id,substitute_material_id,substitution_type,
    approval_status,basis,valid_from,approved_by)
  values('$SUBSTITUTION','$ORG','$MATERIAL','$ALTERNATE','repairable_exchange',
    'approved','Future-approved exchange fixture; it is not yet a current alternative.',
    now()+interval '30 days','$OWNER')
  on conflict(id) do update set approval_status='approved',basis=excluded.basis,
    valid_from=excluded.valid_from;

  insert into public.approved_substitutions(
    organization_id,specified_material_id,substitute_material_id,conditions,
    approved_by,approved_at,expires_at,is_bidirectional)
  values('$ORG','$MATERIAL','$ALTERNATE',
    'Current legacy approval fixture; use remains a human engineering and work decision.',
    '$OWNER',now()-interval '30 days',now()+interval '1 year',false)
  on conflict(organization_id,specified_material_id,substitute_material_id)
  do update set conditions=excluded.conditions,approved_by=excluded.approved_by,
    approved_at=excluded.approved_at,expires_at=excluded.expires_at,
    is_bidirectional=excluded.is_bidirectional;
"

SUPPLIER=$(psqlc "
  insert into public.suppliers(
    organization_id,supplier_code,name,supplier_kind,
    safety_qualification_status,safety_qualification_expires,
    approved_vendor,approval_reference,notes)
  values('$ORG','C108-SUP','C1.08 Approved Repair Vendor','repair_vendor',
    'qualified',current_date+365,true,'C108-AVL','Smoke fixture.')
  on conflict(organization_id,supplier_code) do update set approved_vendor=true,
    safety_qualification_status='qualified',safety_qualification_expires=current_date+365
  returning id")
test -n "$SUPPLIER"

psqlc "
  insert into public.material_suppliers(
    organization_id,material_id,supplier_id,approved_for_this_material,
    supplier_part_number,quoted_lead_time_days,unit_price,lifecycle_status,
    last_time_buy_date,end_of_support_date)
  values('$ORG','$MATERIAL',$SUPPLIER,true,'C108-PN',30,11800,
    'last_time_buy',current_date+120,current_date+365)
  on conflict(material_id,supplier_id) do update set
    approved_for_this_material=true,quoted_lead_time_days=30,
    lifecycle_status='last_time_buy',last_time_buy_date=current_date+120,
    end_of_support_date=current_date+365;
  insert into public.supplier_deliveries(
    organization_id,supplier_id,material_id,ordered_on,promised_on,
    received_on,quantity,quality_outcome,note)
  select '$ORG',$SUPPLIER,'$MATERIAL',current_date-90,current_date-60,
    current_date-62,1,'accepted','C1.08 delivery fixture.'
  where not exists(select 1 from public.supplier_deliveries
    where organization_id='$ORG' and supplier_id=$SUPPLIER
      and material_id='$MATERIAL' and note='C1.08 delivery fixture.');
"

TEMPLATE=$(psqlc "select id from public.materials where organization_id='$ORG' and is_template order by material_code limit 1")
test -n "$TEMPLATE"

TEMPLATE_RESULT=$(rpc "$ENGINEER" run_mro_materials_agent \
  "{\"p_material_id\":\"$TEMPLATE\",\"p_window_days\":365,\"p_limit\":200}")
TEMPLATE_RESULT="$TEMPLATE_RESULT" python3 - <<'PY'
import json,os
assert 'template material classes are not operator inventory evidence' in json.loads(os.environ['TEMPLATE_RESULT'])['error']
PY

DENIED=$(rpc "$TECHNICIAN" run_mro_materials_agent \
  "{\"p_material_id\":\"$MATERIAL\",\"p_window_days\":365,\"p_limit\":200}")
DENIED="$DENIED" python3 - <<'PY'
import json,os
assert 'requires a named planner' in json.loads(os.environ['DENIED'])['error']
PY

FOREIGN_RESULT=$(rpc "$ENGINEER" run_mro_materials_agent \
  "{\"p_material_id\":\"$FOREIGN\",\"p_window_days\":365,\"p_limit\":200}")
FOREIGN_RESULT="$FOREIGN_RESULT" python3 - <<'PY'
import json,os
assert json.loads(os.environ['FOREIGN_RESULT'])['error']=='material not found'
PY

BEFORE_SOURCE=$(psqlc "select concat(
  (select count(*) from public.material_stock where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.work_order_materials where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.material_events where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.bom_lines where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.component_instances where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.supplier_deliveries where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.material_substitutions where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.approved_substitutions where organization_id='$ORG' and specified_material_id='$MATERIAL'),'|',
  (select count(*) from public.approvals where organization_id='$ORG'))")

BODY=$(rpc "$ENGINEER" run_mro_materials_agent \
  "{\"p_material_id\":\"$MATERIAL\",\"p_window_days\":365,\"p_limit\":200}")
IDS=$(BODY="$BODY" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['criticalSpares']['state']=='shortage_evidence_present',x
assert x['criticalSpares']['approvedAlternatives']==1,x
assert x['reorderPolicy']['state']=='existing_minimum_reached_or_breached',x
assert x['reorderPolicy']['observedLeadTimeDemand'] is not None,x
assert x['repairables']['state']=='repairable_history_present_turnaround_unproven',x
assert x['repairables']['turnaroundDays'] is None,x
assert x['repairables']['repairYield'] is None,x
assert x['stockouts']['state']=='open_short_line',x
assert x['obsolescence']['state']=='supplier_lifecycle_exposure',x
assert x['obsolescence']['remainingAssetLife'] is None,x
assert x['inventoryPosition']['available']==2,x
assert any(g['code']=='sole_approved_source' for g in x['evidenceGaps']),x
assert any(g['code']=='lot_certification' for g in x['evidenceGaps']),x
for key in ('mayCreatePurchaseOrder','mayChangeStock','mayReserveOrIssueMaterial',
            'mayApproveSupplier','mayChangeReorderPolicy','mayApproveSubstitution',
            'mayCommitSpend','mayReleaseWork'):
    assert x[key] is False,(key,x)
print(x['packId']+'|'+x['runId'])
PY
)
PACK=${IDS%%|*}
RUN=${IDS##*|}
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN' and organization_id='$ORG' and material_id='$MATERIAL' and retained_for_governance and status='completed' and agent_tool_key='analyse_mro_material_position'")" = '1'
test "$(psqlc "select count(*) from public.mro_material_agent_packs where id='$PACK' and organization_id='$ORG' and source_snapshot->'material'->>'materialCode'='C1-08-ROTABLE' and jsonb_array_length(source_snapshot->'materialEvents')=5 and jsonb_array_length(source_snapshot->'supplierDeliveries')=1 and jsonb_array_length(source_snapshot->'installedComponents')=1 and jsonb_array_length(source_snapshot->'substitutions')=2 and assessment->'criticalSpares'->>'approvedAlternatives'='1' and assessment->'stockouts'->>'state'='open_short_line'")" = '1'
AFTER_SOURCE=$(psqlc "select concat(
  (select count(*) from public.material_stock where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.work_order_materials where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.material_events where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.bom_lines where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.component_instances where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.supplier_deliveries where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.material_substitutions where organization_id='$ORG' and material_id='$MATERIAL'),'|',
  (select count(*) from public.approved_substitutions where organization_id='$ORG' and specified_material_id='$MATERIAL'),'|',
  (select count(*) from public.approvals where organization_id='$ORG'))")
test "$AFTER_SOURCE" = "$BEFORE_SOURCE"

# Exact evidence cannot be rewritten through the browser API.
BEFORE=$(psqlc "select md5(source_snapshot::text) from public.mro_material_agent_packs where id='$PACK'")
PATCH_STATUS=$(curl -sS -o /tmp/mro-material-pack-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/mro_material_agent_packs?id=eq.$PACK" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"assessment":{"forged":true}}')
case "$PATCH_STATUS" in 401|403) ;; 200) test "$(cat /tmp/mro-material-pack-patch.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select md5(source_snapshot::text) from public.mro_material_agent_packs where id='$PACK'")" = "$BEFORE"

ASSIGNED=$(rpc "$ENGINEER" assign_mro_material_review \
  "{\"p_pack_id\":\"$PACK\",\"p_assigned_to\":\"$OWNER\",\"p_due_date\":\"2099-12-31\",\"p_note\":\"Reconcile certified serviceable stock, open demand and last-time-buy exposure before any purchase or policy decision.\"}")
ASSIGNED="$ASSIGNED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['ASSIGNED'])
assert x['assignedTo']=='00000000-0000-0000-0000-000000000003',x
assert 'No inventory, procurement or work action' in x['note'],x
PY
test "$(psqlc "select count(*) from public.mro_material_review_assignments where pack_id='$PACK' and assigned_to='$OWNER'")" = '1'

echo 'MRO Materials Specialist smoke passed: five_modes=true exact_source_snapshot=true template_refusal=true missing_stock_unknown=true role_gate=true tenant_wall=true immutable_pack=true named_review=true no_execution_authority=true'
