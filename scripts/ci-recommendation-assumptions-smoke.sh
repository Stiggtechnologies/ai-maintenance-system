#!/usr/bin/env bash
# C5.24: real Postgres proof for the canonical recommendation assumption packet.
set -euo pipefail
trap 'echo "Recommendation assumptions smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999925'
ASSET='c5240000-0000-4000-8000-000000000001'
OTHER_ASSET='c5240000-0000-4000-8000-000000000002'
REC='c5240000-0000-4000-8000-000000000011'
REC2='c5240000-0000-4000-8000-000000000012'
FOREIGN_REC='c5240000-0000-4000-8000-000000000013'

field(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"; }
token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
sql_must_fail(){ local out; out=$( { PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 <<<"$1"; } || true ); if PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<<"$1"; then echo "expected SQL refusal, got success: $1"; return 1; fi; printf '%s' "$out"; }
expect_err(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
e=(x.get('error') if isinstance(x,dict) else None) or ''
if os.environ['NEEDLE'].lower() not in str(e).lower():
    print('expected refusal containing %r, got %s' % (os.environ['NEEDLE'],x)); sys.exit(1)
PY
}
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'):
    print('unexpected refusal:',x); sys.exit(1)
PY
}

RE=$(token 'demo@syncai.ca' 'Demo123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$RE"; test -n "$MANAGER"; test -n "$TECH"

# The dedicated AI identity makes the §70 refusal executable rather than a
# source assertion. It is shared with other governance smokes when present.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
declare v_uid uuid := '99999999-9999-4999-8999-999999999999';
begin
  if not exists (select 1 from auth.users where id=v_uid) then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
      email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
      confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000',v_uid,'authenticated','authenticated',
      'smoke-aibot@syncai.ca',extensions.crypt('AiBot123!@#',extensions.gen_salt('bf')),
      now(),now(),now(),' {"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Smoke AI operator"}'::jsonb,'','','','','','','','');
  end if;
  if not exists(select 1 from auth.identities where user_id=v_uid) then
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),v_uid,v_uid,jsonb_build_object('sub',v_uid::text,'email','smoke-aibot@syncai.ca'),'email',now(),now(),now());
  end if;
  insert into public.user_profiles(id,organization_id,email,role)
  values(v_uid,'11111111-1111-1111-1111-111111111111','smoke-aibot@syncai.ca','ai_admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role='ai_admin';
end $seed$;
PSQL
AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#'); test -n "$AIBOT"

echo '— seed two tenants and complete recommendation shells —'
psqlc "insert into organizations(id,name,industry) values('$OTHER_ORG','C5.24 foreign tenant','utilities') on conflict(id) do nothing;
  insert into assets(id,organization_id,name,tag,criticality) values
    ('$ASSET','$ORG','C5.24 governed pump','C524-P-101','high'),
    ('$OTHER_ASSET','$OTHER_ORG','C5.24 foreign pump','C524-X-101','high')
  on conflict(id) do nothing;
  delete from recommendations where id in ('$REC','$REC2','$FOREIGN_REC');
  insert into recommendations(id,organization_id,asset_id,title,issue,action,impact,confidence,urgency,status,rationale,
    consequence_summary,alternatives_considered,required_completion_date,required_approver_role,verification_method)
  values
    ('$REC','$ORG','$ASSET','C5.24 first assumption proof','Repeated seal failures remain mechanistically unverified.','Run the evidence plan before changing the maintenance strategy.','Protect safe production and avoid unsupported interval changes.',78,'action','pending','Work history and inspection evidence are linked in the governed packet.','If the mechanism is wrong, the intervention may preserve the repeat failure.','Continue current controls or inspect before changing the maintenance basis.',current_date+30,'reliability_engineer','Compare seal condition and process solids through ten representative startups.'),
    ('$REC2','$ORG','$ASSET','C5.24 recorded assumptions proof','The startup exposure model carries one unverified premise.','Validate the premise before the recommendation is released.','Keep the decision basis explicit and testable.',72,'advisory','pending','The recommendation distinguishes observed timing from inferred mechanism.','A false premise would move the monitoring window away from the damaging event.','Retain current controls while collecting a discriminating startup dataset.',current_date+45,'maintenance_manager','Review the ten-start dataset and document whether the premise held.'),
    ('$FOREIGN_REC','$OTHER_ORG','$OTHER_ASSET','C5.24 foreign recommendation','Foreign tenant issue.','Foreign tenant action.','Foreign tenant impact.',70,'advisory','pending','Foreign tenant evidence basis.','Foreign tenant consequence statement is deliberately substantive.','Foreign tenant alternative statement is deliberately substantive.',current_date+20,'reliability_engineer','Foreign tenant verification statement is deliberately substantive.');" >/dev/null

echo '— blank is not none, and the release trigger refuses it —'
BEFORE=$(rpc "$RE" check_recommendation_contract "{\"p_recommendation_id\":\"$REC\"}")
grep -q '"releasable":false' <<<"$BEFORE"
grep -q 'Assumptions and validation plan (C5.24)' <<<"$BEFORE"
OUT=$(sql_must_fail "update recommendations set status='approved' where id='$REC';")
grep -q 'Assumptions and validation plan (C5.24)' <<<"$OUT"

echo '— malformed, unauthorized, AI and cross-tenant packets fail closed —'
BAD=$(rpc "$MANAGER" record_recommendation_assumptions "{\"p_recommendation_id\":\"$REC\",\"p_packet\":{\"disposition\":\"recorded\",\"basis\":\"A substantive overall assessment basis is present here.\",\"items\":[]},\"p_note\":\"Manager reviewed the incomplete packet for a refusal proof.\"}")
expect_err "$BAD" 'assumption packet is incomplete'
DENIED=$(rpc "$TECH" record_recommendation_assumptions "{\"p_recommendation_id\":\"$REC\",\"p_packet\":{\"disposition\":\"none_identified\",\"basis\":\"The complete decision scope was reviewed for material assumptions.\",\"items\":[]},\"p_note\":\"Technician attempts an authority-gated engineering judgement.\"}")
expect_err "$DENIED" 'require reliability engineering'
AI_DENIED=$(rpc "$AIBOT" record_recommendation_assumptions "{\"p_recommendation_id\":\"$REC\",\"p_packet\":{\"disposition\":\"none_identified\",\"basis\":\"The complete decision scope was reviewed for material assumptions.\",\"items\":[]},\"p_note\":\"AI attempts to attest that the organization examined assumptions.\"}")
expect_err "$AI_DENIED" 'named-human engineering judgement'
FOREIGN=$(rpc "$RE" get_recommendation_assumption_packet "{\"p_recommendation_id\":\"$FOREIGN_REC\"}")
expect_err "$FOREIGN" 'recommendation not found'

echo '— provenance columns cannot be forged directly —'
OUT=$(sql_must_fail "update recommendations set assumption_packet='{\"disposition\":\"none_identified\",\"basis\":\"A direct write tries to forge the human assessment record.\",\"items\":[]}'::jsonb, assumptions_recorded_by=(select id from user_profiles where organization_id='$ORG' and role='reliability_engineer' limit 1), assumptions_recorded_at=now() where id='$REC';")
grep -q 'record_recommendation_assumptions' <<<"$OUT"

echo '— a named human can record a justified none-identified disposition —'
GOOD=$(rpc "$MANAGER" record_recommendation_assumptions "{\"p_recommendation_id\":\"$REC\",\"p_packet\":{\"disposition\":\"none_identified\",\"basis\":\"The evidence scope, alternatives, consequence model and verification plan were reviewed and no additional premise is material to this decision.\",\"items\":[]},\"p_note\":\"Manager completed the assumption review for this exact recommendation revision.\"}")
noerr "$GOOD"
test "$(printf '%s' "$GOOD" | field disposition)" = 'none_identified'
AFTER=$(rpc "$RE" check_recommendation_contract "{\"p_recommendation_id\":\"$REC\"}")
grep -q '"releasable":true' <<<"$AFTER"

echo '— explicit assumptions carry basis, consequence and validation —'
RECORDED=$(rpc "$RE" record_recommendation_assumptions "{\"p_recommendation_id\":\"$REC2\",\"p_packet\":{\"disposition\":\"recorded\",\"basis\":\"The recommendation separates the observed startup timing from the causal premise that remains to be tested.\",\"items\":[{\"statement\":\"Intermittent solids exposure continues during the next operating period.\",\"basis\":\"Recent events cluster after startup but the historian does not measure solids continuously.\",\"consequence_if_wrong\":\"The proposed monitoring window may target the wrong exposure and preserve recurrence.\",\"validation_method\":\"Measure process solids and inspect the seal through ten representative startups.\"}]},\"p_note\":\"Reliability engineering recorded the material premise and its discriminating test.\"}")
noerr "$RECORDED"
PACKET=$(rpc "$RE" get_recommendation_assumption_packet "{\"p_recommendation_id\":\"$REC2\"}")
test "$(printf '%s' "$PACKET" | field valid)" = 'True'
grep -q 'operationalAuthorization":false' <<<"$PACKET"

test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='recommendation_assumptions' and (event_data->>'recommendation_id')::uuid in ('$REC','$REC2');")" = '2'
test "$(psqlc "select count(*) from recommendations where id in ('$REC','$REC2') and assumptions_recorded_by is not null and assumptions_recorded_at is not null;")" = '2'

echo 'Recommendation assumptions smoke passed: tenant wall, role and AI refusals, provenance guard, packet shape, audit and binary release gate.'
