#!/usr/bin/env bash
# Organization governance workspace live acceptance (D3.02 / D11.14).
# Run: supabase start && bash scripts/ci-organization-governance-workspace-smoke.sh
set -euo pipefail
trap 'echo "Organization governance workspace smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ROOT='70101090-0000-4000-8000-000000000001'
CHILD='70101090-0000-4000-8000-000000000002'

field(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"; }
expect_err(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
err=(x.get('error') if isinstance(x,dict) else None) or (x.get('message') if isinstance(x,dict) else None) or ''
if os.environ['NEEDLE'].lower() not in str(err).lower():
    print('expected refusal containing %r, got: %s' % (os.environ['NEEDLE'], x)); sys.exit(1)
PY
}
token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r"|python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
test -n "$EXEC"; test -n "$PLANNER"

echo '— 1. every new root receives the six-profile draft shelf; child nodes do not —'
psqlc "insert into organizations(id,name,industry,org_level,parent_id) values('$ROOT','SMOKE Organization Provisioning Root','industrial','enterprise',null) on conflict(id) do nothing;" >/dev/null
test "$(psqlc "select count(*) from project_frameworks where organization_id='$ROOT'")" = '6'
test "$(psqlc "select count(*) from project_frameworks where organization_id='$ROOT' and status='draft'")" = '6'
test "$(psqlc "select count(*) from governance_tailoring_rule_sets where organization_id='$ROOT'")" -ge 1
psqlc "insert into organizations(id,name,industry,org_level,parent_id) values('$CHILD','SMOKE Provisioned Child Node','industrial','site','$ROOT') on conflict(id) do nothing;" >/dev/null
test "$(psqlc "select count(*) from project_frameworks where organization_id='$CHILD'")" = '0'
echo '   root: six draft profiles + tailoring defaults; child: no duplicate shelf'

echo '— 2. the tenant-scoped workspace is reachable and does not expose another root —'
W=$(rpc "$EXEC" get_organization_governance_workspace '{}')
BODY="$W" ROOT="$ROOT" python3 - <<'PY'
import json,os
w=json.loads(os.environ['BODY'])
assert not w.get('error'), w
assert w['root']['id']=='11111111-1111-1111-1111-111111111111', w['root']
assert w['canManage'] is True and w['actorRole']=='executive', w
ids={n['id'] for n in w['nodes']}
assert os.environ['ROOT'] not in ids, ids
PY
W=$(rpc "$PLANNER" get_organization_governance_workspace '{}')
BODY="$W" python3 - <<'PY'
import json,os
w=json.loads(os.environ['BODY'])
assert not w.get('error'), w
assert w['canManage'] is False and w['actorRole']=='planner', w
PY
echo '   executive and planner can read only their subtree; authority is explicit'

echo '— 3. live tree authoring and profile decisions remain human-gated and audited —'
psqlc "delete from organizations where name='SMOKE Workspace Business Unit' and parent_id='$ORG';" >/dev/null
R=$(rpc "$PLANNER" create_sub_organization '{"p_name":"SMOKE Workspace Business Unit","p_node_level":"business_unit","p_parent_node_id":"'$ORG'","p_jurisdiction":"Alberta, Canada"}')
expect_err "$R" 'executive or administrator'
R=$(rpc "$EXEC" create_sub_organization '{"p_name":"SMOKE Workspace Business Unit","p_node_level":"business_unit","p_parent_node_id":"'$ORG'","p_jurisdiction":"Alberta, Canada"}')
BU=$(printf '%s' "$R" | field node_id); test -n "$BU"
R=$(rpc "$PLANNER" set_organization_node '{"p_node_id":"'$BU'","p_node_level":"business_unit","p_jurisdiction":"Saskatchewan, Canada"}')
expect_err "$R" 'executive or administrator'
R=$(rpc "$EXEC" set_organization_node '{"p_node_id":"'$BU'","p_node_level":"business_unit","p_jurisdiction":"Saskatchewan, Canada"}')
test "$(printf '%s' "$R" | field node_id)" = "$BU"
FW=$(psqlc "select id from project_frameworks where organization_id='$ORG' and status='adopted' order by name limit 1")
test -n "$FW"
R=$(rpc "$EXEC" set_org_governance_profile '{"p_node_id":"'$BU'","p_framework_id":"'$FW'","p_note":"Recorded executive basis for this governed workspace acceptance."}')
test "$(printf '%s' "$R" | field node_id)" = "$BU"
W=$(rpc "$EXEC" get_organization_governance_workspace '{}')
BODY="$W" BU="$BU" FW="$FW" python3 - <<'PY'
import json,os
w=json.loads(os.environ['BODY'])
n=next(n for n in w['nodes'] if n['id']==os.environ['BU'])
assert n['jurisdiction']=='Saskatchewan, Canada', n
assert n['attachedProfile']['id']==os.environ['FW'], n
assert n['resolvedProfile']['id']==os.environ['FW'], n
PY
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='organization_tree' and event_data->>'node_id'='$BU'")" -ge 3
echo '   planner refused; executive create/update/profile acts accepted and audited'

echo 'Organization governance workspace smoke passed.'
