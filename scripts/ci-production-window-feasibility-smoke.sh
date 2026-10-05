#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C8.08 production-window feasibility smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); PLANNER=$(uuid)
SITE_A=$(uuid); SITE_B=$(uuid); FOREIGN_SITE=$(uuid)
ASSET_A=$(uuid); ASSET_B=$(uuid); FOREIGN_ASSET=$(uuid)
WO_A=$(uuid); WO_B=$(uuid); FOREIGN_WO=$(uuid)
OPT=$(uuid); FOREIGN_OPT=$(uuid)
WEEK=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select (current_date + 14)::text")
WEEK_END=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select ('$WEEK'::date + 7)::text")

jwt(){
  SUBJECT="$1" EMAIL="$2" JWT_SECRET_VALUE="$JWT_SECRET" python3 - <<'PY'
import base64,hashlib,hmac,json,os,time
def enc(v): return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=').decode()
now=int(time.time()); h=enc({'alg':'HS256','typ':'JWT'})
p=enc({'aud':'authenticated','exp':now+3600,'iat':now,'sub':os.environ['SUBJECT'],
  'email':os.environ['EMAIL'],'phone':'','role':'authenticated','aal':'aal1',
  'app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},
  'amr':[{'method':'password','timestamp':now}]})
body=f'{h}.{p}'; sig=base64.urlsafe_b64encode(hmac.new(os.environ['JWT_SECRET_VALUE'].encode(),body.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
print(f'{body}.{sig}')
PY
}
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(1 if isinstance(x,dict) and x.get('error') else 0)"; }
jqp(){ BODY="$1" EXPR="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);print(eval(os.environ['EXPR'],{'__builtins__':{},'x':x,'len':len,'str':str,'sum':sum,'next':next,'all':all}))"; }
production(){ BODY="$1" python3 -c "import json,os;x=json.loads(os.environ['BODY']);print(json.dumps(next(c for c in x['checks'] if c['constraint']=='Production window')))"; }

EMAIL="c808-planner-$PLANNER@invalid.syncai.ca"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into public.organizations(id,name) values
  ('$ORG','C8.08 production-window tenant'),
  ('$FOREIGN_ORG','C8.08 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$PLANNER','authenticated','authenticated','$EMAIL','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into public.user_profiles(id,organization_id,email,full_name,role) values
  ('$PLANNER','$ORG','$EMAIL','C8.08 accountable planner','planner');
insert into public.sites(id,organization_id,name) values
  ('$SITE_A','$ORG','C8.08 North site'),
  ('$SITE_B','$ORG','C8.08 South site'),
  ('$FOREIGN_SITE','$FOREIGN_ORG','C8.08 foreign site');
insert into public.assets(id,organization_id,site_id,tag,name,asset_class,criticality,status) values
  ('$ASSET_A','$ORG','$SITE_A','C808-A','C8.08 north pump','pump','high','active'),
  ('$ASSET_B','$ORG','$SITE_B','C808-B','C8.08 south pump','pump','medium','active'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG','$FOREIGN_SITE','C808-X','Foreign pump','pump','high','active');
insert into public.work_orders(id,organization_id,site_id,asset_id,wo_number,title,status,estimated_hours) values
  ('$WO_A','$ORG','$SITE_A','$ASSET_A','C808-WO-A','North pump governed work','pending',8),
  ('$WO_B','$ORG','$SITE_B','$ASSET_B','C808-WO-B','South pump governed work','pending',8),
  ('$FOREIGN_WO','$FOREIGN_ORG','$FOREIGN_SITE','$FOREIGN_ASSET','C808-WO-X','Foreign work','pending',8);
insert into public.schedule_options(id,organization_id,week_start,label,strategy,items,total_hours,capacity_hours,status,generated_by) values
  ('$OPT','$ORG','$WEEK','C8.08 governed week','production evidence',jsonb_build_array(jsonb_build_object('wo_id','$WO_A'),jsonb_build_object('wo_id','$WO_B')),16,24,'draft','$PLANNER'),
  ('$FOREIGN_OPT','$FOREIGN_ORG','$WEEK','C8.08 foreign week','foreign',jsonb_build_array(jsonb_build_object('wo_id','$FOREIGN_WO')),8,24,'draft',null);
PSQL

TOKEN=$(jwt "$PLANNER" "$EMAIL")
test -n "$TOKEN"

# No production evidence is never a silent clearance.
R=$(rpc "$TOKEN" evaluate_schedule_feasibility "{\"p_option_id\":\"$OPT\"}")
noerr "$R"; P=$(production "$R")
test "$(jqp "$P" "x['passed']")" = "None"
test "$(jqp "$P" "x['not_assessable_work_orders']")" = "2"
test "$(jqp "$P" "len(x['evidence'])")" = "2"

# An organization-wide full-week availability signal assesses both jobs.
psqlc "insert into public.operational_constraint_signals(organization_id,signal_kind,signal_key,state,observed_at,valid_until,source_system,source_ref,basis) values('$ORG','production','C808-WINDOW','available',now()-interval '1 day','$WEEK_END'::date+interval '1 day','C808-SMOKE','PLAN-ORG','Approved operating plan records an available maintenance window across the tenant.');" >/dev/null
R=$(rpc "$TOKEN" evaluate_schedule_feasibility "{\"p_option_id\":\"$OPT\"}")
noerr "$R"; P=$(production "$R")
test "$(jqp "$P" "x['passed']")" = "True"
test "$(jqp "$P" "x['available_work_orders']")" = "2"
test "$(jqp "$P" "all(s['scope']=='organization' for e in x['evidence'] for s in e['signals'])")" = "True"

# A more-specific site signal overrides the same organization key and exposes
# one real conflict without contaminating the other site.
psqlc "insert into public.operational_constraint_signals(organization_id,site_id,signal_kind,signal_key,state,observed_at,valid_until,source_system,source_ref,basis) values('$ORG','$SITE_A','production','C808-WINDOW','unavailable',now()-interval '12 hours','$WEEK_END'::date+interval '1 day','C808-SMOKE','PLAN-SITE-A','The approved north-site production campaign conflicts with the proposed maintenance week.');" >/dev/null
R=$(rpc "$TOKEN" evaluate_schedule_feasibility "{\"p_option_id\":\"$OPT\"}")
noerr "$R"; P=$(production "$R")
test "$(jqp "$P" "x['passed']")" = "False"
test "$(jqp "$P" "x['count']")" = "1"
test "$(jqp "$P" "next(e for e in x['evidence'] if e['workOrderId']=='$WO_A')['assessmentState']")" = "unavailable"
test "$(jqp "$P" "next(e for e in x['evidence'] if e['workOrderId']=='$WO_B')['assessmentState']")" = "available"

# A still-more-specific unknown exact-asset signal is not a pass and does not
# fall back to less-specific evidence that would hide the uncertainty.
psqlc "insert into public.operational_constraint_signals(organization_id,site_id,asset_id,signal_kind,signal_key,state,observed_at,valid_until,source_system,source_ref,basis) values('$ORG','$SITE_A','$ASSET_A','production','C808-WINDOW','unknown',now()-interval '3 minutes','$WEEK_END'::date+interval '1 day','C808-SMOKE','PLAN-ASSET-UNKNOWN','The exact asset production disposition is awaiting the accountable operations review.');" >/dev/null
R=$(rpc "$TOKEN" evaluate_schedule_feasibility "{\"p_option_id\":\"$OPT\"}")
noerr "$R"; P=$(production "$R")
test "$(jqp "$P" "x['passed']")" = "None"
test "$(jqp "$P" "next(e for e in x['evidence'] if e['workOrderId']=='$WO_A')['signals'][0]['scope']")" = "asset"

# Available evidence that expires mid-week is also not a clearance.
psqlc "insert into public.operational_constraint_signals(organization_id,site_id,asset_id,signal_kind,signal_key,state,observed_at,valid_until,source_system,source_ref,basis) values('$ORG','$SITE_A','$ASSET_A','production','C808-WINDOW','available',now()-interval '2 minutes','$WEEK'::date+interval '3 days','C808-SMOKE','PLAN-ASSET-PARTIAL','The exact asset is available only for the first part of the proposed maintenance week.');" >/dev/null
R=$(rpc "$TOKEN" evaluate_schedule_feasibility "{\"p_option_id\":\"$OPT\"}")
noerr "$R"; P=$(production "$R")
test "$(jqp "$P" "x['passed']")" = "None"
test "$(jqp "$P" "next(e for e in x['evidence'] if e['workOrderId']=='$WO_A')['signals'][0]['coversWeek']")" = "False"

# Foreign evidence and foreign schedule options never cross the tenant wall.
psqlc "insert into public.operational_constraint_signals(organization_id,site_id,asset_id,signal_kind,signal_key,state,observed_at,valid_until,source_system,source_ref,basis) values('$FOREIGN_ORG','$FOREIGN_SITE','$FOREIGN_ASSET','production','C808-WINDOW','unavailable',now()-interval '1 minute','$WEEK_END'::date+interval '1 day','C808-SMOKE','FOREIGN-PLAN','Foreign production evidence must remain outside the active tenant assessment.');" >/dev/null
FOREIGN=$(rpc "$TOKEN" evaluate_schedule_feasibility "{\"p_option_id\":\"$FOREIGN_OPT\"}")
test "$(jqp "$FOREIGN" "x['error']")" = "schedule option not found"

# A current exact-asset conflict enters the warning count and the consequential
# release still requires an accountable human acknowledgement.
psqlc "insert into public.operational_constraint_signals(organization_id,site_id,asset_id,signal_kind,signal_key,state,observed_at,valid_until,source_system,source_ref,basis) values('$ORG','$SITE_A','$ASSET_A','production','C808-WINDOW','unavailable',now()-interval '1 minute','$WEEK_END'::date+interval '1 day','C808-SMOKE','PLAN-ASSET-CONFLICT','The exact asset production plan conflicts with the full proposed maintenance week.');" >/dev/null
DENIED=$(rpc "$TOKEN" release_schedule_option "{\"p_id\":\"$OPT\",\"p_acknowledge_warnings\":false}")
test "$(jqp "$DENIED" "'constraint warning' in x['error']")" = "True"
test "$(jqp "$DENIED" "next(c for c in x['feasibility']['checks'] if c['constraint']=='Production window')['passed']")" = "False"
RELEASED=$(rpc "$TOKEN" release_schedule_option "{\"p_id\":\"$OPT\",\"p_acknowledge_warnings\":true}")
noerr "$RELEASED"
test "$(jqp "$RELEASED" "x['released']")" = "$OPT"
test "$(psqlc "select status from public.schedule_options where id='$OPT'")" = "released"

# The obsolete one-argument release overload has no executable privilege, so
# it cannot bypass feasibility even though its historical definition remains.
test "$(psqlc "select has_function_privilege('$PLANNER','public.release_schedule_option(uuid)','EXECUTE')")" = "f"
test "$(psqlc "select has_function_privilege('$PLANNER','public.evaluate_schedule_feasibility_core_20261212(uuid)','EXECUTE')")" = "f"

echo 'C8.08 production-window feasibility smoke passed: canonical_feed=true tenant_wall=true scope_precedence=true full_week_only=true unknown_visible=true warning_ack=true bypass_closed=true'
