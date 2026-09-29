#!/usr/bin/env bash
set -euo pipefail
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
ORG='11111111-1111-1111-1111-111111111111'

token(){ local response; response=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); sys.exit(1) if isinstance(x,dict) and x.get('error') else None"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error','') if isinstance(x,dict) else ''; sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected refusal',os.environ['WANT'],'got',x) or sys.exit(1))"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; v=json.loads(os.environ['BODY']).get(os.environ['KEY']); print('' if v is None else v)"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
FOREIGN=$(token 'smoke6b-foreign@syncai.ca' 'Foreign123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$FOREIGN"; test -n "$TECH"
INPUT='{"p_material_code":"D607-RUNTIME","p_description":"Runtime catalogue seal","p_unit_of_measure":"each","p_basis":"D6.07 authenticated smoke fixture"}'
expect_error "$(rpc "$TECH" create_catalogue_material "$INPUT")" 'human'
CREATED=$(rpc "$PLANNER" create_catalogue_material "$INPUT")
noerr "$CREATED"
MATERIAL=$(field "$CREATED" materialId)
test -n "$MATERIAL"
expect_error "$(rpc "$PLANNER" create_catalogue_material "$INPUT")" 'already exists'
SUPPLIER=$(psqlc "select awarded_supplier_id from contract_packages where organization_id='$ORG' and package_code='S6B-P1'")
ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by id limit 1")
test -n "$SUPPLIER"; test -n "$ASSET"
LINK="{\"p_material_id\":\"$MATERIAL\",\"p_supplier_id\":$SUPPLIER,\"p_supplier_part_number\":\"D607-SEAL\",\"p_basis\":\"Supplier catalogue fixture\"}"
expect_error "$(rpc "$FOREIGN" link_catalogue_supplier "$LINK")" 'not found'
RESULT=$(rpc "$PLANNER" link_catalogue_supplier "$LINK")
noerr "$RESULT"
test "$(field "$RESULT" approvedForThisMaterial)" = 'False'
expect_error "$(rpc "$PLANNER" link_catalogue_supplier "$LINK")" 'already exists'
COMPONENT=$(psqlc "insert into components(organization_id,asset_id,name) values('$ORG','$ASSET','D607 runtime bearing') returning id" | head -1)
test -n "$COMPONENT"
BOM="{\"p_material_id\":\"$MATERIAL\",\"p_asset_id\":\"$ASSET\",\"p_asset_class\":null,\"p_component_id\":\"$COMPONENT\",\"p_qty_per\":2,\"p_position_note\":\"D607 runtime position\",\"p_basis\":\"Drawing fixture\"}"
expect_error "$(rpc "$TECH" link_catalogue_bom "$BOM")" 'human'
expect_error "$(rpc "$FOREIGN" link_catalogue_bom "$BOM")" 'not found'
RECORDED=$(rpc "$PLANNER" link_catalogue_bom "$BOM")
noerr "$RECORDED"
test -n "$(field "$RECORDED" bomLineId)"
expect_error "$(rpc "$PLANNER" link_catalogue_bom "$BOM")" 'already exists'
# RLS must hide the tenant-owned row from the other authenticated tenant.
FOREIGN_ROWS=$(curl -fsS "$API_URL/rest/v1/materials?id=eq.$MATERIAL&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FOREIGN")
test "$FOREIGN_ROWS" = '[]'
# A SELECT policy must not become an accidental direct-write route.
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/bom_lines" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER" -H 'Content-Type: application/json' \
 -d "{\"organization_id\":\"$ORG\",\"material_id\":\"$MATERIAL\",\"asset_id\":\"$ASSET\",\"qty_per\":1}")
test "$STATUS" = '403'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('material_catalogue','material_supplier') and event_data->>'materialId'='$MATERIAL'")" = '2'
echo 'D6.07 authenticated material smoke passed: catalogue supplier component_bom duplicate_refusal role_refusal foreign_tenant RLS direct_write_denial audit'

