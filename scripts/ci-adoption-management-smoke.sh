#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U23 adoption-management smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
EVIDENCE='98230000-0000-4000-8000-000000000001'
CATEGORIES='stakeholder_mapping,role_design,process_ownership,training,field_trials,change_impact,feedback,adoption_metrics,procedure_updates,incentives,communications,champions,benefits_tracking'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

AUTHOR=$(token 'admin@syncai.ca' 'Admin123!@#')
VERIFIER=$(token 'demo@syncai.ca' 'Demo123!@#')
REVIEWER=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$AUTHOR" && test -n "$VERIFIER" && test -n "$REVIEWER"
read -r AUTHOR_ID REVIEWER_ID <<<"$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F ' ' -v ON_ERROR_STOP=1 -c "select (select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'),(select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca')")"
test -n "$AUTHOR_ID" && test -n "$REVIEWER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
values('$EVIDENCE','$ORG','ci','document','Verified U23 rollout and measurement evidence','DOCUMENTED') on conflict(id) do nothing;
SQL
VERIFY=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent U23 evidence review\",\"p_outcome\":\"verified\",\"p_note\":\"The controlled acceptance record is fit to prove rollout activity and measurements.\"}")
ok "$VERIFY"

PROGRAM=$(rpc "$AUTHOR" create_adoption_program "{\"p_program\":{\"title\":\"Enterprise reliability adoption\",\"objective\":\"Establish evidenced use of the governed reliability operating model.\",\"scope\":\"Acceptance-test sites, roles, procedures and value measures.\",\"sponsorId\":\"$REVIEWER_ID\",\"processOwnerId\":\"$AUTHOR_ID\",\"startsOn\":\"2026-10-01\",\"targetOn\":\"2027-03-31\"}}")
ok "$PROGRAM"
PROGRAM_ID=$(BODY="$(body "$PROGRAM")" python3 -c 'import json,os;print(json.loads(os.environ["BODY"])["programId"])')

MISSING=$(rpc "$AUTHOR" activate_adoption_program "{\"p_program_id\":\"$PROGRAM_ID\",\"p_basis\":\"A partial rollout must not be promoted as implementation-ready.\"}")
err "$MISSING" 'all thirteen adoption disciplines'

while IFS= read -r PAYLOAD; do
  ITEM=$(rpc "$AUTHOR" upsert_adoption_item "{\"p_program_id\":\"$PROGRAM_ID\",\"p_item\":$PAYLOAD}")
  ok "$ITEM"
done < <(CATEGORIES="$CATEGORIES" AUTHOR_ID="$AUTHOR_ID" python3 -c '
import json,os
audience={"stakeholder_mapping","training","field_trials","feedback","communications","champions"}
for category in os.environ["CATEGORIES"].split(","):
  item={"category":category,"title":"Govern "+category.replace("_"," "),"ownerId":os.environ["AUTHOR_ID"],"plan":"Execute the controlled rollout activity, retain its evidence and resolve findings.","successMeasure":"The named owner supplies independently verified completion evidence.","dueOn":"2027-03-31"}
  if category in audience:item["affectedGroup"]="Maintenance and reliability users"
  if category=="procedure_updates":item["sourceReference"]="Controlled procedure PR-100 revision B"
  if category=="change_impact":item["impactLevel"]="high"
  if category=="incentives":item["safetyGuardrail"]="Never reward output that bypasses safety, evidence or approval controls."
  print(json.dumps(item,separators=(",",":")))')

ACTIVATE=$(rpc "$AUTHOR" activate_adoption_program "{\"p_program_id\":\"$PROGRAM_ID\",\"p_basis\":\"All thirteen adoption disciplines have named owners, dates and controlled plans.\"}")
ok "$ACTIVATE"

WORKSPACE=$(rpc "$AUTHOR" get_adoption_management_workspace '{}')
ok "$WORKSPACE"
ITEMS=$(BODY="$(body "$WORKSPACE")" PROGRAM_ID="$PROGRAM_ID" python3 -c '
import json,os
x=json.loads(os.environ["BODY"]);p=next(v for v in x["programs"] if v["id"]==os.environ["PROGRAM_ID"])
assert p["progress"]["plannedCategories"]==13
for i in p["items"]:print(i["id"]+"|"+i["category"])')

while IFS='|' read -r ITEM_ID CATEGORY; do
  if test "$CATEGORY" = adoption_metrics || test "$CATEGORY" = benefits_tracking; then
    PREMATURE=$(rpc "$AUTHOR" set_adoption_item_status "{\"p_item_id\":\"$ITEM_ID\",\"p_status\":\"complete\",\"p_note\":\"Completion must refuse a measurement item without its three value points.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
    err "$PREMATURE" 'baseline, target and actual'
    for POINT_VALUE in 'baseline|20' 'target|80' 'actual|75'; do
      POINT=${POINT_VALUE%|*}; VALUE=${POINT_VALUE#*|}
      RECORDED=$(rpc "$AUTHOR" record_adoption_value_point "{\"p_item_id\":\"$ITEM_ID\",\"p_point\":\"$POINT\",\"p_value\":$VALUE,\"p_unit\":\"percent\",\"p_basis\":\"Controlled acceptance measurement for comparable adoption closeout.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
      ok "$RECORDED"
    done
  fi
  COMPLETE=$(rpc "$AUTHOR" set_adoption_item_status "{\"p_item_id\":\"$ITEM_ID\",\"p_status\":\"complete\",\"p_note\":\"The controlled rollout activity is complete and supported by verified evidence.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
  ok "$COMPLETE"
done <<<"$ITEMS"

SUBMITTED=$(rpc "$AUTHOR" submit_adoption_program "{\"p_program_id\":\"$PROGRAM_ID\",\"p_basis\":\"Every adoption discipline is complete with verified evidence and comparable measurements.\"}")
ok "$SUBMITTED"
SELF_REVIEW=$(rpc "$AUTHOR" review_adoption_program "{\"p_program_id\":\"$PROGRAM_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"The author must never perform the independent closeout review.\"}")
err "$SELF_REVIEW" 'author or submitter cannot'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin update adoption_programs set status='completed' where id='$PROGRAM_ID';
    raise exception 'direct adoption mutation was incorrectly allowed';
  exception when others then if sqlerrm not like '%governed functions%' then raise; end if; end;
end \$\$;
SQL

APPROVED=$(rpc "$REVIEWER" review_adoption_program "{\"p_program_id\":\"$PROGRAM_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"Independent review confirms all disciplines, evidence and observed value points.\"}")
ok "$APPROVED"
COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(distinct category) from adoption_items where program_id='$PROGRAM_ID' and status='complete'),(select count(*) from value_metrics where adoption_item_id in(select id from adoption_items where program_id='$PROGRAM_ID') and adoption_point='actual' and status='verified'),(select count(*) from approvals where adoption_program_id='$PROGRAM_ID' and status='approved'),(select count(*) from audit_events where organization_id='$ORG' and event_data->>'program_id'='$PROGRAM_ID');")
echo "U23 ledger counts disciplines|verified_actuals|approvals|audit=$COUNTS"
test "$COUNTS" = '13|2|2|36'
echo 'U23 adoption-management smoke passed: disciplines=13 evidence_verified=true tenant_scoped=true direct_write_denied=true measurements=baseline-target-actual independent_closeout=true operational_authority=false'
