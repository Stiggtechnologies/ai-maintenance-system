#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U2.08 asset service-level smoke FAILED at line $LINENO"' ERR

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"
}

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-4999-8999-999999999208'
ASSET='92080000-0000-4000-8000-000000000001'
OTHER_ASSET='92080000-0000-4000-8000-000000000002'
FOREIGN_ASSET='92080000-0000-4000-8000-000000000003'
EVIDENCE='92080000-0000-4000-8000-000000000011'
UNVERIFIED='92080000-0000-4000-8000-000000000012'
WRONG_EVIDENCE='92080000-0000-4000-8000-000000000013'
FOREIGN_EVIDENCE='92080000-0000-4000-8000-000000000014'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){
  local code
  code="$(status "$1")"
  test "$code" = 200 || { echo "expected HTTP 200, got ${code}: $(body "$1")"; return 1; }
  BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"
}
err(){
  local code
  code="$(status "$1")"
  test "$code" = 200 || { echo "expected controlled HTTP 200 refusal, got ${code}: $(body "$1")"; return 1; }
  BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"
}

RPCS=$(psqlc "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('record_asset_service_level','verify_asset_service_level')")
test "$RPCS" = 'record_asset_service_level,verify_asset_service_level'
psqlc "notify pgrst, 'reload schema'" >/dev/null

MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$MANAGER" && test -n "$ADMIN" && test -n "$TECH"

psqlc "insert into organizations(id,name,industry,org_level) values('$OTHER_ORG','U2.08 foreign','utilities','enterprise') on conflict(id) do nothing"
psqlc "insert into assets(id,organization_id,name,tag) values('$ASSET','$ORG','U2.08 process water pump','U208-PW-1'),('$OTHER_ASSET','$ORG','U2.08 backup water pump','U208-PW-2'),('$FOREIGN_ASSET','$OTHER_ORG','Foreign service asset','U208-X-1') on conflict(id) do nothing"
psqlc "insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class) values('$EVIDENCE','$ORG','$ASSET','operations-manual','service_narrative','Verified process-water service narrative and consequence basis.','DOCUMENTED'),('$UNVERIFIED','$ORG','$ASSET','draft-notes','service_narrative','Unverified draft service claim that must not be admitted.','DOCUMENTED'),('$WRONG_EVIDENCE','$ORG','$OTHER_ASSET','operations-manual','service_narrative','Verified evidence for a different asset in the same tenant.','DOCUMENTED'),('$FOREIGN_EVIDENCE','$OTHER_ORG','$FOREIGN_ASSET','foreign-manual','service_narrative','Foreign-tenant evidence that must never cross the tenant wall.','DOCUMENTED') on conflict(id) do nothing"

VERIFY=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent CI review against controlled operations manual\",\"p_outcome\":\"verified\",\"p_note\":\"Asset applicability and source provenance confirmed.\"}")
ok "$VERIFY"
VERIFY_WRONG=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$WRONG_EVIDENCE\",\"p_method\":\"Independent CI review for second fixture asset\",\"p_outcome\":\"verified\",\"p_note\":\"Second-asset applicability and source confirmed.\"}")
ok "$VERIFY_WRONG"

ANON=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/record_asset_service_level" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Anonymous service\",\"p_beneficiary\":\"Anonymous beneficiary\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Anonymous access must be refused before any record is written.\",\"p_basis\":\"Anonymous callers have no named-human authority.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":0}")
test "$ANON" = 401
UNAUTHORIZED=$(rpc "$TECH" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Technician role must not author this consequence.\",\"p_basis\":\"Controlled operations manual with explicit limitations.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":0}")
err "$UNAUTHORIZED" 'named same-tenant'
FOREIGN=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_service_name\":\"Foreign service\",\"p_beneficiary\":\"Foreign system\",\"p_tolerable_downtime_hours\":1,\"p_consequence_class\":\"production\",\"p_restoration_rank\":1,\"p_notes\":\"Foreign asset must be refused at the tenant wall.\",\"p_basis\":\"Foreign source is intentionally outside this tenant.\",\"p_evidence_item_id\":\"$FOREIGN_EVIDENCE\",\"p_expected_version\":0}")
err "$FOREIGN" 'asset not found'
UNVERIFIED_RESULT=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Unverified evidence must not establish this consequence.\",\"p_basis\":\"Draft notes are not an independently verified source.\",\"p_evidence_item_id\":\"$UNVERIFIED\",\"p_expected_version\":0}")
err "$UNVERIFIED_RESULT" 'requires applicable verified'
WRONG_RESULT=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Wrong-asset evidence must not establish this consequence.\",\"p_basis\":\"The evidence belongs to a separate canonical asset.\",\"p_evidence_item_id\":\"$WRONG_EVIDENCE\",\"p_expected_version\":0}")
err "$WRONG_RESULT" 'requires applicable verified'

AUDIT_BEFORE=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('asset_service_level','asset_service_level_verification')")
AUTHORITY_BEFORE=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
CREATE=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Loss stops production; approved tolerance and rank remain unknown.\",\"p_basis\":\"Verified operations manual; limits are not yet quantified.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":0}")
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

EDIT=$(rpc "$MANAGER" record_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_service_name\":\"Process water delivery\",\"p_beneficiary\":\"Operating plant and firewater interface\",\"p_tolerable_downtime_hours\":null,\"p_consequence_class\":\"production\",\"p_restoration_rank\":null,\"p_notes\":\"Scope changed; prior verification must be invalidated automatically.\",\"p_basis\":\"Verified operations manual plus clarified beneficiary scope.\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":2}")
ok "$EDIT"
BODY="$(body "$EDIT")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['status']=='draft' and x['version']==3,x"
GRAPH_EDIT=$(rpc "$MANAGER" get_dependency_graph '{}')
ok "$GRAPH_EDIT"
BODY="$(body "$GRAPH_EDIT")" ASSET="$ASSET" python3 -c "import json,os;x=json.loads(os.environ['BODY']);n=next((n for n in x['nodes'] if n['id']==os.environ['ASSET']),None);assert n is None or n.get('serviceName') is None,n"
REVERIFY=$(rpc "$ADMIN" verify_asset_service_level "{\"p_asset_id\":\"$ASSET\",\"p_expected_version\":3,\"p_review_note\":\"Independent review confirms the clarified beneficiary and unchanged evidence limitations.\"}")
ok "$REVERIFY"

DIRECT=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/rest/v1/asset_service_levels?asset_id=eq.$ASSET" -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER" -H 'content-type: application/json' -d '{"service_name":"Bypass attempt"}')
test "$DIRECT" = 401 || test "$DIRECT" = 403
ROW=$(psqlc "select status||'|'||version||'|'||(tolerable_downtime_hours is null)||'|'||(restoration_rank is null)||'|'||(recorded_by<>reviewed_by) from asset_service_levels where organization_id='$ORG' and asset_id='$ASSET'")
test "$ROW" = 'verified|4|true|true|true'
FOREIGN_COUNT=$(psqlc "select count(*) from asset_service_levels where organization_id='$OTHER_ORG' and asset_id='$FOREIGN_ASSET'")
test "$FOREIGN_COUNT" = 0
AUDIT_AFTER=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('asset_service_level','asset_service_level_verification')")
test "$AUDIT_AFTER" -eq "$((AUDIT_BEFORE + 4))"
AUTHORITY_AFTER=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
test "$AUTHORITY_AFTER" = "$AUTHORITY_BEFORE"

echo 'U2.08 asset service-level smoke passed: tenant_wall=true evidence_gate=true unknowns_preserved=true author_reviewer_separated=true optimistic_lock=true draft_excluded=true verified_admitted=true edit_invalidates=true direct_write_denied=true authority_unchanged=true'
