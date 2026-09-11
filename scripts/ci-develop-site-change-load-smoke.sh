#!/usr/bin/env bash
# D7.15 — live Site Change Load transcript.
set -euo pipefail
trap 'echo "Site-change-load smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"
ORG='11111111-1111-1111-1111-111111111111'
SITE='71500000-0000-4000-8000-000000000001'
EMPTY_SITE='71500000-0000-4000-8000-000000000002'
ASSET='71500000-0000-4000-8000-000000000003'
CASE='71500000-0000-4000-8000-000000000004'
WO='71500000-0000-4000-8000-000000000005'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$PLANNER"; test -n "$PLANNER_ID"

psqlc "insert into sites(id,organization_id,name) values('$SITE','$ORG','D7.15 Load Site'),('$EMPTY_SITE','$ORG','D7.15 Empty Site') on conflict(id) do nothing; insert into assets(id,organization_id,site_id,tag,name) values('$ASSET','$ORG','$SITE','D715-ASSET','D7.15 Asset') on conflict(id) do nothing; insert into development_cases(id,organization_id,title,site_id,lifecycle_type,problem_statement,status,created_by,created_at) values('$CASE','$ORG','D7.15 concurrent project','$SITE','brownfield','Coordinate a concurrent brownfield change without exceeding site absorption capacity.','active','$PLANNER_ID','2025-12-01 00:00+00') on conflict(id) do nothing; insert into work_orders(id,organization_id,site_id,asset_id,wo_number,title,status,estimated_hours,created_at) values('$WO','$ORG','$SITE','$ASSET','LOAD-001','Quantified maintenance backlog','pending',40,'2025-12-15 00:00+00') on conflict(id) do nothing; insert into outage_windows(organization_id,site_id,window_key,title,kind,starts_at,ends_at,status) values('$ORG','$SITE','D715-OUTAGE','Concurrent outage','shutdown','2026-01-15 00:00+00','2026-01-20 00:00+00','planned') on conflict(organization_id,window_key) do nothing; insert into schedule_options(organization_id,week_start,label,strategy,items,total_hours,capacity_hours,status,released_by,released_at) values('$ORG','2026-01-05','D7.15 released schedule','load smoke',jsonb_build_array(jsonb_build_object('wo_id','$WO')),40,10,'released','$PLANNER_ID','2025-12-31 00:00+00'); insert into temporary_modifications(organization_id,asset_id,modification_kind,description,reason,required_removal_by,installed_at,installed_by,approved_by,work_order_id) values('$ORG','$ASSET','temporary_repair','D7.15 concurrent temporary repair','Smoke evidence for site change load','2026-03-01','2025-12-20 00:00+00','$PLANNER_ID','$PLANNER_ID','$WO');" >/dev/null

COMP=$(psqlc "with recorded as (insert into competencies(organization_id,competency_key,title,kind) values('$ORG','D715-TRAIN','D7.15 change training','skill') returning id) select id from recorded")
MEMBER=$(psqlc "with recorded as (insert into workforce_members(organization_id,site_id,employee_ref,display_name,craft) values('$ORG','$SITE','D715-MEMBER','D7.15 Member','planner') returning id) select id from recorded")
psqlc "insert into training_plans(organization_id,member_id,competency_id,plan_kind,target_date,status,driver,created_at) values('$ORG',$MEMBER,$COMP,'cross_training','2026-02-01','planned','Concurrent site change','2025-12-15 00:00+00'); insert into craft_capacity(organization_id,site_id,craft,weekly_hours,basis,effective_from,resource_category) values('$ORG','$SITE','planner',10,'D7.15 smoke net capacity','2025-12-01','project_management'); insert into capacity_deductions(organization_id,site_id,craft,deduction_kind,weekly_hours,basis,effective_from,resource_category) values('$ORG','$SITE','planner','training',2,'D7.15 smoke deduction already reflected in net capacity','2025-12-01','project_management');" >/dev/null

LOAD=$(rpc "$PLANNER" get_site_change_load "{\"p_site_id\":\"$SITE\",\"p_horizon_weeks\":13,\"p_as_of\":\"2026-01-01T00:00:00Z\"}")
BODY="$LOAD" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if x.get('error') or x.get('changeLoadIndex')!=7 or not x.get('forecastComputable'):
    print('expected seven canonical load signals and computable forecast, got:',x); sys.exit(1)
if float(x.get('quantifiedLoadHours',-1))!=40 or float(x.get('netWeeklyCapacityHours',-1))!=10 or float(x.get('weeksToAbsorb',-1))!=4:
    print('expected 40 hours / 10 weekly = 4 weeks, got:',x); sys.exit(1)
if float(x.get('horizonUtilizationPct',-1))!=30.77:
    print('expected 40/130 = 30.77%, got:',x); sys.exit(1)
if x.get('capacityDeductionContext',{}).get('treatment','').find('not subtracted twice')<0:
    print('expected net-capacity anti-double-count statement, got:',x); sys.exit(1)
PY

# A zero/default estimate is unknown, not free work: the forecast now refuses.
psqlc "insert into work_orders(organization_id,site_id,asset_id,wo_number,title,status,estimated_hours,created_at) values('$ORG','$SITE','$ASSET','LOAD-MISSING','Unestimated backlog','pending',0,'2025-12-20 00:00+00')" >/dev/null
MISSING=$(rpc "$PLANNER" get_site_change_load "{\"p_site_id\":\"$SITE\",\"p_horizon_weeks\":13,\"p_as_of\":\"2026-01-01T00:00:00Z\"}")
BODY="$MISSING" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if x.get('forecastComputable') or x.get('forecastState')!='not_computable_missing_work_estimates' or x.get('evidenceGaps',{}).get('workOrdersWithoutPositiveEstimate')!=1:
    print('expected named missing-estimate refusal, got:',x); sys.exit(1)
PY

NO_CAP=$(rpc "$PLANNER" get_site_change_load "{\"p_site_id\":\"$EMPTY_SITE\"}")
BODY="$NO_CAP" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if x.get('forecastComputable') or x.get('forecastState')!='not_computable_no_site_capacity':
    print('expected no-capacity refusal, got:',x); sys.exit(1)
PY

CROSS=$(rpc "$PLANNER" get_site_change_load '{"p_site_id":"00000000-0000-4000-8000-000000000099"}')
BODY="$CROSS" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if 'not found' not in str(x.get('error','')).lower():
    print('expected absent/cross-tenant site refusal, got:',x); sys.exit(1)
PY

echo "Site-change-load smoke passed: index=7 backlog=40h net_capacity=10h/week absorption=4weeks gaps=refused"
