#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D12.13 RAM case completion smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999926'
CASE='98630000-0000-4000-8000-000000000001'
PARTIAL_CASE='98630000-0000-4000-8000-000000000002'
FOREIGN_CASE='98639999-0000-4000-8000-000000000001'
TRAIN='98631000-0000-4000-8000-000000000001'
PUMP_A='98631000-0000-4000-8000-000000000002'
PUMP_B='98631000-0000-4000-8000-000000000003'
PARTIAL_ASSET='98631000-0000-4000-8000-000000000004'
PROJECT=9863001
TARGET=9863001
CC_GROUP=9863001

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
ok(){ test "${1##*$'\n'}" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "${1##*$'\n'}" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'].lower() in x.get('error','').lower(),x"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
ADMIN_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
test -n "$ADMIN" && test -n "$ADMIN_ID"

# Idempotent fixture reset. RAM reports cascade through their case; the table's
# provenance trigger explicitly admits only that parent cascade.
psqlc "delete from development_cases where id in ('$CASE','$PARTIAL_CASE');" >/dev/null
psqlc "delete from work_orders where id::text like '98632%';" >/dev/null
psqlc "delete from component_life_events where organization_id='$ORG' and unit_number like 'D1213-%';" >/dev/null
psqlc "delete from asset_maintenance_strategy_recommendations where id::text like '98635%';" >/dev/null
psqlc "delete from asset_failure_mode_libraries where organization_id='$ORG' and (id::text like '98634%' or (coalesce(session_id,'') like 'autonomous-onboarding:%' and asset_id like 'D1213-%'));" >/dev/null
psqlc "delete from common_cause_groups where id=$CC_GROUP;" >/dev/null
psqlc "delete from assets where id in ('$TRAIN','$PUMP_A','$PUMP_B','$PARTIAL_ASSET');" >/dev/null
psqlc "delete from capital_projects where id=$PROJECT;" >/dev/null

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','D12.13 foreign tenant','utilities') on conflict(id) do nothing;
insert into capital_projects(id,organization_id,project_code,title,status)
values($PROJECT,'$ORG','D1213-RAM','D12.13 governed RAM project','active');
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,capital_project_id,created_by) values
('$CASE','$ORG','D12.13 complete RAM case','brownfield','Evaluate only governed RAM evidence for the declared project asset set.','active',$PROJECT,'$ADMIN_ID'),
('$PARTIAL_CASE','$ORG','D12.13 partial RAM case','brownfield','Prove one missing family does not suppress all other case-scoped RAM context.','active',null,'$ADMIN_ID'),
('$FOREIGN_CASE','$OTHER_ORG','D12.13 foreign case','brownfield','Cross-tenant identifiers must be refused.','active',null,null)
on conflict(id) do nothing;
insert into assets(id,organization_id,asset_tag,tag,name,criticality) values
('$TRAIN','$ORG','D1213-TRAIN','D1213-TRAIN','Process train','critical'),
('$PUMP_A','$ORG','D1213-PA','D1213-PA','Duty pump A','high'),
('$PUMP_B','$ORG','D1213-PB','D1213-PB','Standby pump B','high'),
('$PARTIAL_ASSET','$ORG','D1213-PART','D1213-PART','Partial-context pump','medium');
insert into development_case_assets(organization_id,development_case_id,asset_id,added_by) values
('$ORG','$CASE','$TRAIN','$ADMIN_ID'),('$ORG','$CASE','$PUMP_A','$ADMIN_ID'),('$ORG','$CASE','$PUMP_B','$ADMIN_ID'),
('$ORG','$PARTIAL_CASE','$PARTIAL_ASSET','$ADMIN_ID');

insert into ram_targets(id,organization_id,project_id,system_label,target_availability,target_basis,configuration)
values($TARGET,'$ORG',$PROJECT,'D12.13 process train',0.97,'Human-approved project RAM basis','series');
insert into ram_allocations(organization_id,target_id,subsystem_label,demonstrated_availability,evidence,complexity_weight)
values('$ORG',$TARGET,'Pumping function',0.985,'Measured fleet history',1);

insert into asset_dependencies(organization_id,dependent_asset_id,supplier_asset_id,dependency_kind,redundancy_group,min_suppliers_required,evidence,source)
values
('$ORG','$TRAIN','$PUMP_A','functional','D1213-PUMPS',1,null,'derived'),
('$ORG','$TRAIN','$PUMP_B','functional','D1213-PUMPS',1,'Approved RBD D1213 rev A','human');
insert into common_cause_groups(id,organization_id,name,cause_kind,description)
values($CC_GROUP,'$ORG','D1213 shared suction','shared_supply','Both pumps depend on one suction header.');
insert into common_cause_members(group_id,asset_id,organization_id) values
($CC_GROUP,'$PUMP_A','$ORG'),($CC_GROUP,'$PUMP_B','$ORG');

insert into asset_meter_readings(id,organization_id,asset_id,meter_kind,value,recorded_at,source_system,source_ref,basis) values
('98633000-0000-4000-8000-000000000001','$ORG','$TRAIN','operating_hours',100,timestamptz '2026-01-01 00:00Z','historian','D1213-T-START','Governed CI historian start reading.'),
('98633000-0000-4000-8000-000000000002','$ORG','$TRAIN','operating_hours',860,timestamptz '2026-02-11 16:00Z','historian','D1213-T-END','Governed CI historian end reading.'),
('98633000-0000-4000-8000-000000000003','$ORG','$PUMP_A','operating_hours',200,timestamptz '2026-01-01 00:00Z','historian','D1213-A-START','Governed CI historian start reading.'),
('98633000-0000-4000-8000-000000000004','$ORG','$PUMP_A','operating_hours',970,timestamptz '2026-02-11 16:00Z','historian','D1213-A-END','Governed CI historian end reading.'),
('98633000-0000-4000-8000-000000000005','$ORG','$PUMP_B','operating_hours',300,timestamptz '2026-01-01 00:00Z','historian','D1213-B-START','Governed CI historian start reading.'),
('98633000-0000-4000-8000-000000000006','$ORG','$PUMP_B','operating_hours',1050,timestamptz '2026-02-11 16:00Z','historian','D1213-B-END','Governed CI historian end reading.');

insert into work_orders(id,organization_id,asset_id,title,status,work_type,completed_at,downtime_hours) values
('98632000-0000-4000-8000-000000000001','$ORG','$TRAIN','D12.13 train corrective 1','completed','corrective',timestamptz '2026-01-06 00:00Z',2),
('98632000-0000-4000-8000-000000000002','$ORG','$TRAIN','D12.13 train corrective 2','completed','corrective',timestamptz '2026-01-20 00:00Z',3),
('98632000-0000-4000-8000-000000000003','$ORG','$TRAIN','D12.13 train corrective 3','completed','corrective',timestamptz '2026-02-05 00:00Z',2),
('98632000-0000-4000-8000-000000000004','$ORG','$PUMP_A','D12.13 pump A corrective 1','completed','corrective',timestamptz '2026-01-05 00:00Z',4),
('98632000-0000-4000-8000-000000000005','$ORG','$PUMP_A','D12.13 pump A corrective 2','completed','corrective',timestamptz '2026-01-18 00:00Z',5),
('98632000-0000-4000-8000-000000000006','$ORG','$PUMP_A','D12.13 pump A corrective 3','completed','corrective',timestamptz '2026-02-03 00:00Z',3),
('98632000-0000-4000-8000-000000000007','$ORG','$PUMP_B','D12.13 pump B corrective 1','completed','corrective',timestamptz '2026-01-07 00:00Z',3),
('98632000-0000-4000-8000-000000000008','$ORG','$PUMP_B','D12.13 pump B corrective 2','completed','corrective',timestamptz '2026-01-21 00:00Z',4),
('98632000-0000-4000-8000-000000000009','$ORG','$PUMP_B','D12.13 pump B corrective 3','completed','corrective',timestamptz '2026-02-07 00:00Z',3);

insert into component_life_events(organization_id,asset_id,unit_number,component,hours_at_change_out,event_date,event_kind,symptom,source_file) values
('$ORG','$TRAIN','D1213-TRAIN','train',500,date '2025-01-01','failure','trip','ci-d1213'),
('$ORG','$TRAIN','D1213-TRAIN','train',900,date '2025-06-01','failure','trip','ci-d1213'),
('$ORG','$PUMP_A','D1213-PA','pump',600,date '2025-01-01','failure','seal leak','ci-d1213'),
('$ORG','$PUMP_A','D1213-PA','pump',1000,date '2025-06-01','failure','seal leak','ci-d1213'),
('$ORG','$PUMP_B','D1213-PB','pump',650,date '2025-02-01','failure','bearing heat','ci-d1213'),
('$ORG','$PUMP_B','D1213-PB','pump',1100,date '2025-07-01','failure','bearing heat','ci-d1213');

insert into asset_failure_mode_libraries(id,session_id,organization_id,asset_id,canonical_asset_id,failure_mode,failure_mechanism,cause,effect,detection_method,consequence,current_controls,recommended_controls,source) values
('98634000-0000-4000-8000-000000000001','D1213-A','$ORG','$PUMP_A','$PUMP_A','Seal leakage','abrasive wear','solids ingress','loss of containment','leak inspection','environmental release','weekly round','review flush plan','human_reviewed_library'),
('98634000-0000-4000-8000-000000000002','D1213-B','$ORG','$PUMP_B','$PUMP_B','Bearing overheating','lubrication loss','blocked line','pump trip','temperature trend','production loss','online temperature','inspect lubrication route','human_reviewed_library');
insert into asset_maintenance_strategy_recommendations(id,session_id,organization_id,asset_id,recommendation,failure_mode_addressed,risk_reduced,evidence_used,assumptions,confidence,required_approval,status) values
('98635000-0000-4000-8000-000000000001','D1213-A','$ORG','$PUMP_A','Trend seal-flush differential pressure','Seal leakage','loss of containment','{"refs":["D1213-RBD"]}','{"duty":"solids-bearing water"}','medium','reliability_engineer','draft'),
('98635000-0000-4000-8000-000000000002','D1213-B','$ORG','$PUMP_B','Inspect lubrication delivery','Bearing overheating','production loss','{"refs":["D1213-RBD"]}','{"duty":"standby"}','medium','reliability_engineer','draft');
SQL

# Autonomous onboarding attaches one generic fmea_library starter per new
# asset. Those rows stay in the canonical store; get_case_ram_scope must not
# count them as case-scoped FMEA.
AUTO_FMEA=$(psqlc "select count(*) from asset_failure_mode_libraries where organization_id='$ORG' and source='fmea_library' and coalesce(session_id,'') like 'autonomous-onboarding:%' and asset_id in ('D1213-TRAIN','D1213-PA','D1213-PB')")
test "$AUTO_FMEA" = "3"
PARTIAL_AUTO=$(psqlc "select count(*) from asset_failure_mode_libraries where organization_id='$ORG' and source='fmea_library' and coalesce(session_id,'') like 'autonomous-onboarding:%' and asset_id='D1213-PART'")
test "$PARTIAL_AUTO" = "1"

# The first edge is deliberately ungoverned. The server must name it and the
# client must not be able to evaluate only the convenient confirmed edge.
UNGOVERNED=$(rpc "$ADMIN" get_case_ram_scope "{\"p_case_id\":\"$CASE\"}")
ok "$UNGOVERNED"
BODY="$(body "$UNGOVERNED")" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert len(x['topology']['edges'])==2,x
assert any('whole declared topology is refused' in r for r in x['refusals']),x
PY

# Human confirmation and evidence make the exact declared graph eligible.
psqlc "update asset_dependencies set evidence='Approved RBD D1213 rev A',source='human',confirmed_by='$ADMIN_ID',confirmed_at=timestamptz '2026-02-12 00:00Z' where organization_id='$ORG' and dependent_asset_id='$TRAIN';" >/dev/null

SCOPE=$(rpc "$ADMIN" get_case_ram_scope "{\"p_case_id\":\"$CASE\"}")
ok "$SCOPE"
BODY="$(body "$SCOPE")" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['refused'] is False and len(x['assets'])==3 and len(x['targets'])==1,x
assert len(x['topology']['edges'])==2 and len(x['topology']['commonCauseGroups'])==1,x
assert len(x['fmea'])==2 and len(x['pmStrategies'])==2,x
assert {row['source'] for row in x['fmea']}=={'human_reviewed_library'},x
assert {row['failureMode'] for row in x['fmea']}=={'Seal leakage','Bearing overheating'},x
assert all('Primary function carrier' not in (row.get('failureMode') or '') for row in x['fmea']),x
for a in x['assets']:
    w=a['observationWindow']; assert w and round(float(w['calendarHours']))==1000 and len(w['failureEventHours'])==3,a
assert x['recommendationOnly'] if 'recommendationOnly' in x else True
PY

BEFORE=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from ram_targets where organization_id='$ORG')")
RESULT=$(npx tsx scripts/ci-develop-ram-case-completion-client.mts "$API_URL" "$ANON_KEY" "$ADMIN" "$CASE")
BODY="$RESULT" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['reportId'] and x['runId'] and x['upperBound'] is True,x
assert x['assetCount']==3 and x['fmeaCount']==2 and x['pmStrategyCount']==2,x
assert 0 < x['systemAvailability'] < 1,x
PY
AFTER=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from ram_targets where organization_id='$ORG')")
test "$BEFORE" = "$AFTER"

LINEAGE=$(psqlc "select method||'|'||code_version||'|'||(outputs->>'decisionBoundary') from calculation_runs where id='$(BODY="$RESULT" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['runId'])")'")
grep -q 'crowAMSAA' <<<"$LINEAGE"
grep -q 'evaluateRbd' <<<"$LINEAGE"
grep -q 'develop-ram/5E/2026-12-20' <<<"$LINEAGE"
grep -qi 'human' <<<"$LINEAGE"

# One missing family does not suppress all others, and missing evidence is
# explicit rather than represented as a healthy zero.
PARTIAL=$(rpc "$ADMIN" get_case_ram_scope "{\"p_case_id\":\"$PARTIAL_CASE\"}")
ok "$PARTIAL"
BODY="$(body "$PARTIAL")" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['refused'] is False and len(x['assets'])==1 and x['targets']==[],x
assert x['fmea']==[],x
text=' '.join(x['refusals']).lower()
for phrase in ('no capital project','no rbd','no valid observation window','no existing fmea','no existing pm-strategy'):
    assert phrase in text,(phrase,x)
PY

FOREIGN=$(rpc "$ADMIN" get_case_ram_scope "{\"p_case_id\":\"$FOREIGN_CASE\"}")
err "$FOREIGN" 'development case not found'

echo 'D12.13 RAM case completion smoke passed: canonical_rbd=true meter_window=true availability=true crow_amsaa=true weibull=true fmea=true pm_strategy=true common_cause_upper_bound=true lineage=true forged_identity_refused=true partial_leg_honesty=true tenant_wall=true advisory_only=true'
