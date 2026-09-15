#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U16 emergency restoration command smoke FAILED at line $LINENO"' ERR
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"; : "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; OTHER='99999999-9999-9999-9999-999999999916'; EVIDENCE='98600000-0000-0000-0000-000000000021'; EVENT='98600000-0000-0000-0000-000000000031'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }
field(){ BODY="$(body "$1")" KEY="$2" python3 -c "import json,os;print(json.loads(os.environ['BODY'])[os.environ['KEY']])"; }
AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#'); REVIEWER=$(token 'admin@syncai.ca' 'Admin123!@#'); test -n "$AUTHOR"; test -n "$REVIEWER"
ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1"); SITE=$(psqlc "select site_id from assets where id='$ASSET'")
psqlc "insert into organizations(id,name,industry,org_level) values('$OTHER','U16 foreign','utilities','enterprise') on conflict(id) do nothing"
psqlc "insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class) values('$EVIDENCE','$ORG','$ASSET','ci-u16','approved_inspection','Verified command-state evidence for controlled transition testing.','DOCUMENTED') on conflict(id) do nothing"
VERIFY=$(rpc "$REVIEWER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent command evidence review\",\"p_outcome\":\"verified\",\"p_note\":\"Identity, observation, applicability and command scope independently confirmed.\"}"); ok "$VERIFY"
psqlc "insert into restoration_events(id,organization_id,site_id,asset_id,event_code,event_type,reason,status,opened_at,actual_return_at,opened_by,closed_by) values('$EVENT','$ORG',nullif('$SITE','')::uuid,'$ASSET','REC-U16-CI','major_intervention','Controlled closed event for U16 lifecycle acceptance.','closed',now()-interval '1 day',now(),(select id from auth.users where email='demo@syncai.ca'),(select id from auth.users where email='admin@syncai.ca')) on conflict(id) do nothing"
CREATE=$(rpc "$AUTHOR" create_recovery_operating_command "{\"p_command\":{\"command_ref\":\"U16-CI\",\"asset_id\":\"$ASSET\",\"site_id\":\"$SITE\",\"restoration_event_id\":\"$EVENT\"}}"); ok "$CREATE"; COMMAND=$(field "$CREATE" command_id)
FOREIGN=$(rpc "$AUTHOR" request_recovery_operating_mode "{\"p_command_id\":\"00000000-0000-0000-0000-000000000016\",\"p_to_mode\":\"elevated_risk\",\"p_basis\":\"Cross tenant command must remain invisible and refused.\"}"); err "$FOREIGN" 'operating command not found'
INVALID_JUMP=$(rpc "$AUTHOR" request_recovery_operating_mode "{\"p_command_id\":\"$COMMAND\",\"p_to_mode\":\"restoration\",\"p_basis\":\"Skipping controlled command stages must always be refused.\"}"); err "$INVALID_JUMP" 'not permitted'
NO_EVIDENCE=$(rpc "$AUTHOR" request_recovery_operating_mode "{\"p_command_id\":\"$COMMAND\",\"p_to_mode\":\"elevated_risk\",\"p_basis\":\"Observed precursor conditions require elevated human attention.\"}"); ok "$NO_EVIDENCE"; T=$(field "$NO_EVIDENCE" transition_id)
SELF=$(rpc "$AUTHOR" review_recovery_operating_mode "{\"p_transition_id\":\"$T\",\"p_decision\":\"authorize\",\"p_note\":\"Requester cannot independently authorize their own transition.\"}"); err "$SELF" 'requester cannot authorize'
MISSING=$(rpc "$REVIEWER" review_recovery_operating_mode "{\"p_transition_id\":\"$T\",\"p_decision\":\"authorize\",\"p_note\":\"Independent review must refuse a transition without evidence.\"}"); err "$MISSING" 'requires verified canonical evidence'
REJECT=$(rpc "$REVIEWER" review_recovery_operating_mode "{\"p_transition_id\":\"$T\",\"p_decision\":\"reject\",\"p_note\":\"Rejected because the request omitted canonical verified evidence.\"}"); ok "$REJECT"
for MODE in elevated_risk business_continuity emergency_response damage_assessment restoration recovery post_event_learning normal; do
 REQUEST=$(rpc "$AUTHOR" request_recovery_operating_mode "{\"p_command_id\":\"$COMMAND\",\"p_to_mode\":\"$MODE\",\"p_basis\":\"Controlled observed conditions support accountable transition to $MODE.\",\"p_evidence_item_ids\":[\"$EVIDENCE\"],\"p_missing_evidence\":[\"Field authority remains outside this state record\"]}"); ok "$REQUEST"; T=$(field "$REQUEST" transition_id)
 APPROVE=$(rpc "$REVIEWER" review_recovery_operating_mode "{\"p_transition_id\":\"$T\",\"p_decision\":\"authorize\",\"p_note\":\"Independent review confirms verified evidence and the controlled transition basis.\"}"); ok "$APPROVE"
done
WORKSPACE=$(rpc "$AUTHOR" get_recovery_operating_command_workspace '{}'); ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" COMMAND="$COMMAND" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert len(x['modes'])==8;a=next(c for c in x['commands'] if c['id']==os.environ['COMMAND']);assert a['current_mode']=='normal';assert len(a['transitions'])==9;assert 'does not automatically' in x['authority_boundary']"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type like 'recovery_operating_mode%' and event_data->>'command_id'='$COMMAND'")" = 19
echo 'U16 emergency restoration command smoke passed: modes=8 legal_transitions=true invalid_jump_refused=true tenant_wall=true verified_evidence=true independent_authority=true canonical_event=true'
