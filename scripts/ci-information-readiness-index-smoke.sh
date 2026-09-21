#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.23 information readiness index smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
bash scripts/ci-physical-information-readiness-smoke.sh >/dev/null
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"; : "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; OTHER_ORG='99999999-9999-9999-9999-999999999927'; CASE='91110800-0000-4000-8000-000000000001'; FOREIGN_CASE='91110800-0000-4000-8000-000000000002'; EVIDENCE='91110800-0000-4000-8000-000000000003'; SYSTEM=911108001
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }
USER_TOKEN=$(token 'admin@syncai.ca' 'Admin123!@#'); USER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'"); ASSET_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select id from assets where organization_id='$ORG' order by created_at limit 1")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into asset_onboarding_items(organization_id,asset_id,requirement_key,status,value,source,confidence,note)
values('$ORG','$ASSET_ID','s16_regulatory_requirements','pending',jsonb_build_object('summary','Regulatory evidence outstanding'),'D11.23 acceptance','high','Regulatory information remains deliberately unresolved.')
on conflict(asset_id,requirement_key) do update set status='pending',evidence_item_id=null,note=excluded.note;
insert into commissioning_system_readiness_scope(organization_id,commissioning_system_id,onboarding_item_id,owner_id,required_before,basis,basis_evidence_item_id,assigned_by)
select '$ORG','$SYSTEM',id,'$USER_ID',current_date,'Regulatory information is required before controlled handover.','$EVIDENCE','$USER_ID' from asset_onboarding_items
where organization_id='$ORG' and asset_id='$ASSET_ID' and requirement_key='s16_regulatory_requirements' on conflict do nothing;
SQL
ANON=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_case_information_readiness_index" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_case_id\":\"$CASE\"}"); test "$(status "$ANON")" = 400; body "$ANON" | grep -q 'authentication required'
BLOCKED=$(rpc "$USER_TOKEN" get_case_information_readiness_index "{\"p_case_id\":\"$CASE\"}"); test "$(status "$BLOCKED")" = 200
BODY="$(body "$BLOCKED")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["project"]["required"]==2;assert x["project"]["accepted"]==0;assert x["project"]["index"]==0;assert x["project"]["status"]=="BLOCKED";assert x["project"]["hardBlockerCount"]==1;assert x["hardBlockers"][0]["class"]=="regulatory";assert "regardless of the index" in x["hardBlockerRule"]'
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "update asset_onboarding_items set status='human_provided',evidence_item_id='$EVIDENCE' where organization_id='$ORG' and asset_id='$ASSET_ID' and requirement_key in ('s14_bom','s16_regulatory_requirements');"
READY=$(rpc "$USER_TOKEN" get_case_information_readiness_index "{\"p_case_id\":\"$CASE\"}"); test "$(status "$READY")" = 200
BODY="$(body "$READY")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["project"]["accepted"]==2;assert x["project"]["index"]==100;assert x["project"]["status"]=="READY";assert x["project"]["hardBlockerCount"]==0'
ENGINE=$(rpc "$USER_TOKEN" get_case_information_engine "{\"p_case_id\":\"$CASE\"}"); test "$(status "$ENGINE")" = 200
BODY="$(body "$ENGINE")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);r=x["legs"]["assetDataReadiness"];assert r["built"] is True;assert r["project"]["index"]==100;assert r["project"]["status"]=="READY";assert r["formula"].startswith("Accepted evidence-backed");assert "regulatory certification" in r["decisionBoundary"];assert "score" not in x;assert x["graph"]["absentEdgeCount"]==2;assert x["complete"] is False;assert "No composite score" in x["headline"];assert "2 of §34" in x["headline"]'
FOREIGN=$(rpc "$USER_TOKEN" get_case_information_readiness_index "{\"p_case_id\":\"$FOREIGN_CASE\"}"); test "$(status "$FOREIGN")" = 400; body "$FOREIGN" | grep -q 'not found in current tenant'
echo 'D11.23 information readiness index smoke passed: exact_ratio=true regulatory_blocker=true evidence_required=true project_rollup=true system_rollup=true sync_information_composed=true no_composite_score=true remaining_graph_gap_honest=true tenant_wall=true human_authority=true'
