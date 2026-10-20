#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U2.08 asset service-level smoke FAILED at line $LINENO"' ERR

# Synthetic private fixture only. Never a customer operation or source-standing claim.
test "${GITHUB_ACTIONS:-false}" = true || test "${SYNCAI_U208_PRIVATE_FIXTURE:-0}" = 1
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE
export PGOPTIONS='-c application_name=syncai-u208-private-fixture'
psqlc() {
  PGPASSWORD=postgres psql -X -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -c "$1"
}
http() {
  # Ignore proxy configuration, prohibit redirects and bound transport failures.
  command curl --noproxy '*' --proto '=http' --proto-redir '=http' --max-redirs 0 --connect-timeout 5 --max-time 20 "$@"
}

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
API_URL="$API_URL" python3 -c "import os,urllib.parse;u=urllib.parse.urlparse(os.environ['API_URL']);assert u.scheme=='http' and u.hostname in ('127.0.0.1','localhost') and u.port==54321 and not u.username and not u.password and u.path in ('','/') and not u.query and not u.fragment,'private loopback API required'"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-4999-8999-999999999208'
ASSET='92080000-0000-4000-8000-000000000001'
OTHER_ASSET='92080000-0000-4000-8000-000000000002'
FOREIGN_ASSET='92080000-0000-4000-8000-000000000003'
EVIDENCE='92080000-0000-4000-8000-000000000011'
RISK='92080000-0000-4000-8000-000000000021'
UNVERIFIED='92080000-0000-4000-8000-000000000012'
WRONG_EVIDENCE='92080000-0000-4000-8000-000000000013'
FOREIGN_EVIDENCE='92080000-0000-4000-8000-000000000014'

token(){ http -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){
  local payload="$3" actor=''
  if test "$2" = record_asset_service_level || test "$2" = verify_asset_service_level; then
    case "$1" in "$MANAGER") actor="$MANAGER_ID";; "$ADMIN") actor="$ADMIN_ID";; "$TECH") actor="$TECH_ID";; *) return 1;; esac
    payload=$(PAYLOAD="$payload" ACTOR="$actor" ORG="$ORG" python3 -c "import json,os,uuid;x=json.loads(os.environ['PAYLOAD']);x.setdefault('p_command_id',str(uuid.uuid4()));x.setdefault('p_observed_actor_id',os.environ['ACTOR']);x.setdefault('p_observed_organization_id',os.environ['ORG']);print(json.dumps(x))")
  fi
  http -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$payload"
}
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){
  local code
  code="$(status "$1")"
  test "$code" = 200 || { echo "expected HTTP 200, got ${code}"; return 1; }
  BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"
}
err(){
  local code
  code="$(status "$1")"
  test "$code" = 200 || { echo "expected controlled HTTP 200 refusal, got ${code}"; return 1; }
  BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"
}
snapshot(){
  psqlc "select jsonb_build_object('services',coalesce((select jsonb_agg(to_jsonb(s) order by s.asset_id) from asset_service_levels s where organization_id='$ORG'),'[]'::jsonb),'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from audit_events a where organization_id='$ORG'),'[]'::jsonb),'approvals',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from approvals a where organization_id='$ORG'),'[]'::jsonb),'work_orders',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from work_orders w where organization_id='$ORG'),'[]'::jsonb))"
}
sqlDenied(){
  local response
  if response=$(psqlc "$1" 2>&1); then echo 'privileged write unexpectedly admitted'; return 1; fi
  # Connection, missing relation and syntax errors must NOT qualify a backstop.
  [[ "$response" =~ ERROR:[[:space:]]+42501 ]] || { echo 'expected SQLSTATE 42501 for privileged refusal'; return 1; }
}

RPCS=$(psqlc "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('record_asset_service_level','verify_asset_service_level')")
test "$RPCS" = 'record_asset_service_level,verify_asset_service_level'
psqlc "notify pgrst, 'reload schema'" >/dev/null

MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$MANAGER" && test -n "$ADMIN" && test -n "$TECH"
MANAGER_ID=$(psqlc "select id from user_profiles where email='manager@syncai.ca'")
ADMIN_ID=$(psqlc "select id from user_profiles where email='admin@syncai.ca'")
TECH_ID=$(psqlc "select id from user_profiles where email='technician@syncai.ca'")
test -n "$MANAGER_ID" && test -n "$ADMIN_ID" && test -n "$TECH_ID"

psqlc "insert into organizations(id,name,industry,org_level) values('$OTHER_ORG','U2.08 foreign','utilities','enterprise') on conflict(id) do nothing"
psqlc "insert into assets(id,organization_id,name,tag) values('$ASSET','$ORG','U2.08 process water pump','U208-PW-1'),('$OTHER_ASSET','$ORG','U2.08 backup water pump','U208-PW-2'),('$FOREIGN_ASSET','$OTHER_ORG','Foreign service asset','U208-X-1') on conflict(id) do nothing"
psqlc "insert into risks(id,organization_id,title,information_sensitivity) values('$RISK','$ORG','Declared synthetic U2.08 inspection visibility fixture','public')"
psqlc "insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class) values('$UNVERIFIED','$ORG','$ASSET','draft-notes','service_narrative','Unverified draft service claim that must not be admitted.','DOCUMENTED'),('$WRONG_EVIDENCE','$ORG','$OTHER_ASSET','operations-manual','service_narrative','Verified evidence for a different asset in the same tenant.','DOCUMENTED'),('$FOREIGN_EVIDENCE','$OTHER_ORG','$FOREIGN_ASSET','foreign-manual','service_narrative','Foreign-tenant evidence that must never cross the tenant wall.','DOCUMENTED') on conflict(id) do nothing"

# Authenticated capture starts risk-unlinked, as canonical RLS requires.
# The separate privileged association below is ONLY synthetic fixture setup:
# it is not proof of a governed/audited risk-evidence capture workflow.
CAPTURE=$(http -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/evidence_items" -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER" -H 'content-type: application/json' -H 'Prefer: return=representation' -d "{\"id\":\"$EVIDENCE\",\"organization_id\":\"$ORG\",\"asset_id\":\"$ASSET\",\"source_system\":\"synthetic-ci-field-inspection\",\"source_reference\":\"synthetic-u208-controlled-isolation-01\",\"evidence_type\":\"field_inspection\",\"signal_kind\":\"inspection\",\"description\":\"Declared synthetic CI inspection: isolating this test pump stops the simulated wash-plant water service. No customer observation or normative limit is asserted.\",\"evidence_class\":\"INSPECTED\",\"provenance\":{\"synthetic\":true,\"captured_by\":\"$MANAGER_ID\",\"capture_method\":\"controlled test isolation observation\"}}")
test "$(status "$CAPTURE")" = 201
BODY="$(body "$CAPTURE")" EVIDENCE="$EVIDENCE" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert len(x)==1 and x[0]['id']==os.environ['EVIDENCE'] and x[0]['evidence_class']=='INSPECTED' and x[0]['verification_status']=='unverified',x"
psqlc "begin; set local role service_role; update evidence_items set risk_id='$RISK' where id='$EVIDENCE' and organization_id='$ORG'; commit" >/dev/null
test "$(psqlc "select risk_id from evidence_items where id='$EVIDENCE' and organization_id='$ORG'")" = "$RISK"

VERIFY=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent CI verification of declared synthetic operational inspection\",\"p_outcome\":\"verified\",\"p_note\":\"Synthetic capture actor, observation and asset applicability checked; no customer fact or normative tolerance.\"}")
ok "$VERIFY"
VERIFY_WRONG=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$WRONG_EVIDENCE\",\"p_method\":\"Independent CI review for second fixture asset\",\"p_outcome\":\"verified\",\"p_note\":\"Second-asset applicability and source confirmed.\"}")
ok "$VERIFY_WRONG"
REFUSAL_STATE=$(snapshot)

ANON=$(http -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/record_asset_service_level" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Anonymous service\",\"p_beneficiary\":\"Anonymous beneficiary\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Anonymous access must be refused before any record is written.\",\"p_basis\":\"Anonymous callers have no named-human authority.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":0}")
test "$ANON" = 401
UNAUTHORIZED=$(rpc "$TECH" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Technician role must not author this consequence.\",\"p_basis\":\"Controlled operations manual with explicit limitations.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":0}")
err "$UNAUTHORIZED" 'named same-tenant'
FOREIGN=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_service_name\":\"Foreign service\",\"p_beneficiary\":\"Foreign system\",\"p_tolerable_downtime_hours\":1,\"p_consequence_class\":\"production\",\"p_restoration_rank\":1,\"p_notes\":\"Foreign asset must be refused at the tenant wall.\",\"p_basis\":\"Foreign source is intentionally outside this tenant.\",\"p_evidence_item_id\":\"$FOREIGN_EVIDENCE\",\"p_expected_version\":0}")
err "$FOREIGN" 'asset not found'
UNVERIFIED_RESULT=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Unverified evidence must not establish this consequence.\",\"p_basis\":\"Draft notes are not an independently verified source.\",\"p_evidence_item_id\":\"$UNVERIFIED\",\"p_expected_version\":0}")
err "$UNVERIFIED_RESULT" 'requires applicable verified'
WRONG_RESULT=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Wrong-asset evidence must not establish this consequence.\",\"p_basis\":\"The evidence belongs to a separate canonical asset.\",\"p_evidence_item_id\":\"$WRONG_EVIDENCE\",\"p_expected_version\":0}")
err "$WRONG_RESULT" 'requires applicable verified'
test "$(snapshot)" = "$REFUSAL_STATE"

AUDIT_BEFORE=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('asset_service_level','asset_service_level_verification')")
AUTHORITY_BEFORE=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
CREATE=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Loss stops production; approved tolerance and rank remain unknown.\",\"p_basis\":\"Declared synthetic operational inspection; normative limits remain unknown.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":0}")
ok "$CREATE"
BODY="$(body "$CREATE")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['status']=='draft' and x['version']==1,x"
GRAPH_DRAFT=$(rpc "$MANAGER" get_dependency_graph '{}')
ok "$GRAPH_DRAFT"
BODY="$(body "$GRAPH_DRAFT")" ASSET="$ASSET" python3 -c "import json,os;x=json.loads(os.environ['BODY']);n=next((n for n in x['nodes'] if n['id']==os.environ['ASSET']),None);assert n is None or n.get('serviceName') is None,n"

SELF=$(rpc "$MANAGER" verify_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_expected_version\":1,\"p_review_note\":\"The author cannot provide the required independent review.\"}")
err "$SELF" 'author cannot verify'
STALE=$(rpc "$ADMIN" verify_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_expected_version\":0,\"p_review_note\":\"Independent review attempted against a deliberately stale version.\"}")
err "$STALE" 'changed since review began'
VERIFY_LEVEL=$(rpc "$ADMIN" verify_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_expected_version\":1,\"p_review_note\":\"Independent review confirms the service, evidence and preserved unknown values.\"}")
ok "$VERIFY_LEVEL"
BODY="$(body "$VERIFY_LEVEL")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['status']=='verified' and x['version']==2,x"
GRAPH_VERIFIED=$(rpc "$MANAGER" get_dependency_graph '{}')
ok "$GRAPH_VERIFIED"
BODY="$(body "$GRAPH_VERIFIED")" ASSET="$ASSET" python3 -c "import json,os;x=json.loads(os.environ['BODY']);n=next(n for n in x['nodes'] if n['id']==os.environ['ASSET']);assert n['serviceName']=='Process water delivery' and n['tolerableDowntimeHours'] is None and n['restorationRank'] is None,n"

EDIT=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant and firewater interface\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Scope changed; prior verification must be invalidated automatically.\",\"p_basis\":\"Declared synthetic operational inspection plus clarified beneficiary scope.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":2}")
ok "$EDIT"
BODY="$(body "$EDIT")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['status']=='draft' and x['version']==3,x"
GRAPH_EDIT=$(rpc "$MANAGER" get_dependency_graph '{}')
ok "$GRAPH_EDIT"
BODY="$(body "$GRAPH_EDIT")" ASSET="$ASSET" python3 -c "import json,os;x=json.loads(os.environ['BODY']);n=next((n for n in x['nodes'] if n['id']==os.environ['ASSET']),None);assert n is None or n.get('serviceName') is None,n"
REVERIFY=$(rpc "$ADMIN" verify_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_expected_version\":3,\"p_review_note\":\"Independent review confirms the clarified beneficiary and unchanged evidence limitations.\"}")
ok "$REVERIFY"

DIRECT=$(http -sS -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/rest/v1/asset_service_levels?asset_id=eq.$ASSET" -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER" -H 'content-type: application/json' -d '{"service_name":"Bypass attempt"}')
test "$DIRECT" = 401 || test "$DIRECT" = 403
ROW=$(psqlc "select status||'|'||version||'|'||(tolerable_downtime_hours is null)||'|'||(restoration_rank is null)||'|'||(recorded_by<>reviewed_by) from asset_service_levels where organization_id='$ORG' and asset_id='$ASSET'")
test "$ROW" = 'verified|4|true|true|true'
FOREIGN_COUNT=$(psqlc "select count(*) from asset_service_levels where organization_id='$OTHER_ORG' and asset_id='$FOREIGN_ASSET'")
test "$FOREIGN_COUNT" = 0
AUDIT_AFTER=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('asset_service_level','asset_service_level_verification')")
test "$AUDIT_AFTER" -eq "$((AUDIT_BEFORE + 4))"
AUTHORITY_AFTER=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
test "$AUTHORITY_AFTER" = "$AUTHORITY_BEFORE"

# Bound editor reads and reconciliation to observed canonical membership, not
# merely whichever JWT happened to be installed when a UI request was sent.
for SECTION in assets levels evidence history; do
  CURRENT=$(rpc "$MANAGER" get_asset_service_level_editor "{\"p_observed_actor_id\":\"$MANAGER_ID\",\"p_observed_organization_id\":\"$ORG\",\"p_section\":\"$SECTION\",\"p_asset_id\":\"$ASSET\"}")
  ok "$CURRENT"
  BODY="$(body "$CURRENT")" ACTOR="$MANAGER_ID" ORG="$ORG" SECTION="$SECTION" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['actor_id']==os.environ['ACTOR'] and x['organization_id']==os.environ['ORG'] and x['section']==os.environ['SECTION'] and isinstance(x['rows'],list),x"
  MISMATCH=$(rpc "$MANAGER" get_asset_service_level_editor "{\"p_observed_actor_id\":\"$ADMIN_ID\",\"p_observed_organization_id\":\"$ORG\",\"p_section\":\"$SECTION\",\"p_asset_id\":\"$ASSET\"}")
  err "$MISMATCH" 'observed named actor'
done
HISTORY=$(rpc "$MANAGER" get_asset_service_level_editor "{\"p_observed_actor_id\":\"$MANAGER_ID\",\"p_observed_organization_id\":\"$ORG\",\"p_section\":\"history\",\"p_asset_id\":\"$ASSET\"}")
BODY="$(body "$HISTORY")" MANAGER_ID="$MANAGER_ID" ADMIN_ID="$ADMIN_ID" python3 -c "import json,os;rows=json.loads(os.environ['BODY'])['rows'];assert len(rows)==4,rows;assert [r['new_state']['version'] for r in rows]==[1,2,3,4];assert rows[0]['previous_state'] is None;assert [r['previous_state']['version'] for r in rows[1:]]==[1,2,3];assert [r['actor'] for r in rows]==[os.environ['MANAGER_ID'],os.environ['ADMIN_ID']]*2;assert all('basis' in r['new_state'] and 'evidence_snapshot' in r['new_state'] and 'notes' in r['new_state'] for r in rows)"

# API privilege revocation and actual trigger paths, including service role.
PRIVILEGE_STATE=$(snapshot)
sqlDenied "begin; set local role service_role; update asset_service_levels set service_name='Privileged bypass' where asset_id='$ASSET'; rollback"
sqlDenied "begin; set local role service_role; insert into audit_events(organization_id,entity_type,actor,event_data) values('$ORG','asset_service_level','$MANAGER_ID','{\"command_id\":\"92080000-0000-4000-8000-000000000090\"}'); rollback"
for OP in "update audit_events set actor='rewritten' where entity_type='asset_service_level' and organization_id='$ORG'" "delete from audit_events where entity_type='asset_service_level' and organization_id='$ORG'" "truncate audit_events"; do
  sqlDenied "begin; $OP; rollback"
done
for ROLE in postgres authenticated service_role; do
  # CASCADE avoids using the historical U13 FK restriction as a false backstop.
  sqlDenied "begin; set local role $ROLE; truncate asset_service_levels cascade; rollback"
done
test "$(snapshot)" = "$PRIVILEGE_STATE"

# Canonical risk sensitivity must constrain service narrative AND historical
# snapshots; a captured unrestricted basis cannot launder a now-private risk.
psqlc "update risks set information_sensitivity='restricted' where id='$RISK'" >/dev/null
for SECTION in levels history evidence; do
  PRIVATE=$(rpc "$MANAGER" get_asset_service_level_editor "{\"p_observed_actor_id\":\"$MANAGER_ID\",\"p_observed_organization_id\":\"$ORG\",\"p_section\":\"$SECTION\",\"p_asset_id\":\"$ASSET\"}")
  ok "$PRIVATE"
  BODY="$(body "$PRIVATE")" ASSET="$ASSET" EVIDENCE="$EVIDENCE" python3 -c "import json,os;rows=json.loads(os.environ['BODY'])['rows'];assert all(r.get('asset_id')!=os.environ['ASSET'] and r.get('id')!=os.environ['EVIDENCE'] and (r.get('new_state') or {}).get('asset_id')!=os.environ['ASSET'] for r in rows),rows"
done
PRIVATE_GRAPH=$(rpc "$MANAGER" get_dependency_graph '{}')
BODY="$(body "$PRIVATE_GRAPH")" ASSET="$ASSET" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert all(n['id']!=os.environ['ASSET'] or n.get('serviceName') is None for n in x['nodes']),x"
psqlc "update risks set information_sensitivity='public' where id='$RISK'" >/dev/null

# A privileged synthetic description-only amendment changes live standing,
# NOT immutable past review. It is NOT an audited source-correction workflow.
STATE_BEFORE=$(psqlc "select to_jsonb(s)::text from asset_service_levels s where asset_id='$ASSET' and organization_id='$ORG'")
COVERAGE_BEFORE=$(rpc "$MANAGER" get_dependency_coverage '{}')
psqlc "begin; set local role service_role; update evidence_items set description=description||' Privileged synthetic description amendment; no audit-workflow proof.' where id='$EVIDENCE'; commit" >/dev/null
STALE_GRAPH=$(rpc "$MANAGER" get_dependency_graph '{}')
BODY="$(body "$STALE_GRAPH")" ASSET="$ASSET" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert all(n['id']!=os.environ['ASSET'] or n.get('serviceName') is None for n in x['nodes']),x"
COVERAGE_AFTER=$(rpc "$MANAGER" get_dependency_coverage '{}')
BEFORE="$(body "$COVERAGE_BEFORE")" AFTER="$(body "$COVERAGE_AFTER")" python3 -c "import json,os;a=json.loads(os.environ['BEFORE'])[0];b=json.loads(os.environ['AFTER'])[0];assert b['assets_with_service_level']==a['assets_with_service_level']-1,(a,b)"
STALE_LEVEL=$(rpc "$MANAGER" get_asset_service_level_editor "{\"p_observed_actor_id\":\"$MANAGER_ID\",\"p_observed_organization_id\":\"$ORG\",\"p_section\":\"levels\"}")
BODY="$(body "$STALE_LEVEL")" ASSET="$ASSET" python3 -c "import json,os;r=next(r for r in json.loads(os.environ['BODY'])['rows'] if r['asset_id']==os.environ['ASSET']);assert r['status']=='verified' and r['analysis_eligible'] is False,r"
REFERENCE=$(http -sS "$API_URL/rest/v1/current_asset_service_level_references?asset_id=eq.$ASSET" -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER")
BODY="$REFERENCE" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x==[],x"
test "$(psqlc "select to_jsonb(s)::text from asset_service_levels s where asset_id='$ASSET' and organization_id='$ORG'")" = "$STATE_BEFORE"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('asset_service_level','asset_service_level_verification')")" = "$AUDIT_AFTER"

# Deliberately discard a REAL committed HTTP response. Reconcile only; repeated
# original command (including changed payload) MUST NOT become a new mutation or
# a false no-write/refusal merely because the original CAS version is stale.
LOSS_COMMAND='92080000-0000-4000-8000-000000000091'
PAYLOAD="{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Declared synthetic scope amendment; normative values remain unknown.\",\"p_basis\":\"Privileged synthetic inspection amendment; no normative inference or audited correction claim.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":4,\"p_command_id\":\"$LOSS_COMMAND\",\"p_observed_actor_id\":\"$MANAGER_ID\",\"p_observed_organization_id\":\"$ORG\"}"
rpc "$MANAGER" record_asset_service_level "$PAYLOAD" >/dev/null
LOSS_STATE=$(psqlc "select to_jsonb(s)::text from asset_service_levels s where asset_id='$ASSET' and organization_id='$ORG'")
LOSS_AUDIT=$(psqlc "select jsonb_agg(to_jsonb(a) order by a.created_at,a.id)::text from audit_events a where organization_id='$ORG' and entity_type in ('asset_service_level','asset_service_level_verification')")
DUPLICATE=$(rpc "$MANAGER" record_asset_service_level "$PAYLOAD")
ok "$DUPLICATE"
BODY="$(body "$DUPLICATE")" COMMAND="$LOSS_COMMAND" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['outcome']=='unknown' and x['command_id']==os.environ['COMMAND'] and 'error' not in x,x"
CHANGED_PAYLOAD=$(PAYLOAD="$PAYLOAD" python3 -c "import json,os;x=json.loads(os.environ['PAYLOAD']);x['p_service_name']='Different attempted payload';print(json.dumps(x))")
CHANGED_DUPLICATE=$(rpc "$MANAGER" record_asset_service_level "$CHANGED_PAYLOAD")
ok "$CHANGED_DUPLICATE"
BODY="$(body "$CHANGED_DUPLICATE")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['outcome']=='unknown' and 'error' not in x,x"
RECONCILED=$(rpc "$MANAGER" get_asset_service_level_command "{\"p_command_id\":\"$LOSS_COMMAND\",\"p_observed_actor_id\":\"$MANAGER_ID\",\"p_observed_organization_id\":\"$ORG\"}")
ok "$RECONCILED"
BODY="$(body "$RECONCILED")" COMMAND="$LOSS_COMMAND" ACTOR="$MANAGER_ID" ORG="$ORG" ASSET="$ASSET" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['outcome']=='committed' and x['command_id']==os.environ['COMMAND'] and x['actor_id']==os.environ['ACTOR'] and x['organization_id']==os.environ['ORG'] and x['asset_id']==os.environ['ASSET'] and x['operation']=='record' and x['version']==5 and x['status']=='draft',x"
BODY="$(body "$RECONCILED")" PAYLOAD="$PAYLOAD" python3 -c "import json,os;assert json.loads(os.environ['BODY'])['request']==json.loads(os.environ['PAYLOAD']),'original request receipt mismatch'"
WRONG_RECONCILE=$(rpc "$MANAGER" get_asset_service_level_command "{\"p_command_id\":\"$LOSS_COMMAND\",\"p_observed_actor_id\":\"$ADMIN_ID\",\"p_observed_organization_id\":\"$ORG\"}")
err "$WRONG_RECONCILE" 'observed named actor'
test "$(psqlc "select to_jsonb(s)::text from asset_service_levels s where asset_id='$ASSET' and organization_id='$ORG'")" = "$LOSS_STATE"
test "$(psqlc "select jsonb_agg(to_jsonb(a) order by a.created_at,a.id)::text from audit_events a where organization_id='$ORG' and entity_type in ('asset_service_level','asset_service_level_verification')")" = "$LOSS_AUDIT"
test "$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")" = "$AUTHORITY_BEFORE"

echo 'U2.08 bounded operational smoke passed: tenant_wall=true current_context=true independent_review=true live_standing=true immutable_history=true duplicate_unknown=true read_only_reconciliation=true authority_unchanged=true; full typed document/obligation standing, native races and real browser qualification remain separate required gates'
