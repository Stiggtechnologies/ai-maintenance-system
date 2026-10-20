#!/usr/bin/env bash
# E7.01/E7.02/E7.07/E7.09/E7.11/E7.12 — live supplier-governance transcript.
set -euo pipefail
trap 'echo "Supplier-commercial governance smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
FOREIGN_ORG='e7012800-0000-4000-8000-000000000001'
FOREIGN_UID='e7012800-0000-4000-8000-000000000002'
EVIDENCE='e7012800-0000-4000-8000-000000000003'
RUN_KEY="supplier-$(date +%s)-$$"

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; v=json.loads(os.environ['BODY']).get(os.environ['KEY']); print('' if v is None else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); bad=isinstance(x,dict) and (x.get('answered') is False or x.get('error')); sys.exit(1) if bad else None"; }
expect_refusal(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('refusal') or x.get('error') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected refusal',os.environ['WANT'],'got',x) or sys.exit(1))"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$MANAGER"; test -n "$ADMIN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
begin
  insert into organizations(id,name) values('e7012800-0000-4000-8000-000000000001','E7 supplier foreign tenant')
    on conflict(id) do nothing;
  if not exists(select 1 from auth.users where email='supplier-foreign@syncai.ca') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
      recovery_token,email_change,email_change_token_new,email_change_token_current,
      phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','e7012800-0000-4000-8000-000000000002',
      'authenticated','authenticated','supplier-foreign@syncai.ca',
      extensions.crypt('ForeignSupplier123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"E7 foreign manager"}',
      '','','','','','','','');
  end if;
  if not exists(select 1 from auth.identities where user_id='e7012800-0000-4000-8000-000000000002') then
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),'e7012800-0000-4000-8000-000000000002',
      'e7012800-0000-4000-8000-000000000002',
      '{"sub":"e7012800-0000-4000-8000-000000000002","email":"supplier-foreign@syncai.ca"}',
      'email',now(),now(),now());
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('e7012800-0000-4000-8000-000000000002','e7012800-0000-4000-8000-000000000001',
    'supplier-foreign@syncai.ca','E7 foreign manager','maintenance_manager')
  on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
end $seed$;
PSQL
FOREIGN=$(token 'supplier-foreign@syncai.ca' 'ForeignSupplier123!@#')
test -n "$FOREIGN"

psqlc "insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class,source_reference) values('$EVIDENCE','$ORG','ci-supplier-governance','controlled_document','Verified supplier delivery, traceability and advisory source package.','DOCUMENTED','$RUN_KEY') on conflict(id) do nothing" >/dev/null
VERIFIED=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent supplier-document and receiving-record review\",\"p_outcome\":\"verified\",\"p_note\":\"Receiving evidence, traceability records and the original vendor advisory were independently reviewed.\"}")
noerr "$VERIFIED"

SUPPLIER=$(psqlc "select id from suppliers where organization_id='$ORG' order by id limit 1")
MATERIAL=$(psqlc "select id from materials where organization_id='$ORG' order by material_code limit 1")
test -n "$SUPPLIER"; test -n "$MATERIAL"
ORDERED=$(psqlc "select (current_date-20)::text")
PROMISED=$(psqlc "select (current_date-10)::text")
RECEIVED=$(psqlc "select (current_date-8)::text")

DELIVERY=$(rpc "$MANAGER" record_supplier_delivery "{\"p_payload\":{\"deliveryReference\":\"$RUN_KEY-delivery\",\"supplierId\":\"$SUPPLIER\",\"materialId\":\"$MATERIAL\",\"orderedOn\":\"$ORDERED\",\"promisedOn\":\"$PROMISED\",\"receivedOn\":\"$RECEIVED\",\"quantity\":\"2\",\"qualityOutcome\":\"accepted\",\"basis\":\"Signed receipt and receiving inspection establish the dates and outcome.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
noerr "$DELIVERY"; DELIVERY_ID=$(field "$DELIVERY" deliveryId); test "$(field "$DELIVERY" onTime)" = 'False'
test "$(psqlc "select count(*) from supplier_deliveries where id=$DELIVERY_ID and recorded_by is not null and evidence_item_id='$EVIDENCE'")" = '1'

SUSPECT1=$(rpc "$MANAGER" record_suspect_part_case "{\"p_payload\":{\"caseReference\":\"$RUN_KEY-suspect\",\"materialId\":\"$MATERIAL\",\"supplierId\":\"$SUPPLIER\",\"detectedOn\":\"$RECEIVED\",\"detectionMethod\":\"Receiving inspection\",\"concern\":\"documentation_missing\",\"unitsAlreadyInstalled\":\"0\",\"quarantined\":true,\"status\":\"open\",\"basis\":\"Receiving inspection found the required traceability certificate absent.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
noerr "$SUSPECT1"; SUSPECT1_ID=$(field "$SUSPECT1" suspectPartId); test "$(field "$SUSPECT1" version)" = '1'
SUSPECT2=$(rpc "$MANAGER" record_suspect_part_case "{\"p_payload\":{\"caseReference\":\"$RUN_KEY-suspect\",\"materialId\":\"$MATERIAL\",\"supplierId\":\"$SUPPLIER\",\"detectedOn\":\"$RECEIVED\",\"detectionMethod\":\"Document reconciliation\",\"concern\":\"documentation_missing\",\"unitsAlreadyInstalled\":\"0\",\"quarantined\":false,\"status\":\"cleared\",\"expectedVersion\":1,\"outcome\":\"Original traceability certificate was independently authenticated and matched the received lot.\",\"basis\":\"Independent reconciliation verified the certificate and lot identity.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
noerr "$SUSPECT2"; SUSPECT2_ID=$(field "$SUSPECT2" suspectPartId); test "$(field "$SUSPECT2" version)" = '2'
test "$(psqlc "select count(*) from suspect_parts where id=$SUSPECT1_ID and not active")" = '1'
test "$(psqlc "select count(*) from suspect_parts where id=$SUSPECT2_ID and active and status='cleared' and not quarantined")" = '1'

ADVISORY1=$(rpc "$MANAGER" record_vendor_advisory "{\"p_payload\":{\"advisoryReference\":\"$RUN_KEY-SB\",\"supplierId\":\"$SUPPLIER\",\"issuedOn\":\"$ORDERED\",\"title\":\"Bearing traceability verification bulletin\",\"advisoryKind\":\"service_bulletin\",\"appliesToModel\":\"CI-MODEL\",\"mandatory\":false,\"basis\":\"Original vendor bulletin was received and independently verified.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
noerr "$ADVISORY1"; ADVISORY1_ID=$(field "$ADVISORY1" advisoryId); test "$(field "$ADVISORY1" status)" = 'unassessed'
ADVISORY2=$(rpc "$MANAGER" assess_vendor_advisory "{\"p_advisory_id\":$ADVISORY1_ID,\"p_expected_version\":1,\"p_status\":\"planned\",\"p_disposition\":\"Applicable installed population identified; controlled inspection work is planned.\",\"p_basis\":\"Asset-register reconciliation and the verified bulletin establish applicability.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
noerr "$ADVISORY2"; ADVISORY2_ID=$(field "$ADVISORY2" advisoryId); test "$(field "$ADVISORY2" version)" = '2'
ADVISORY3=$(rpc "$MANAGER" assess_vendor_advisory "{\"p_advisory_id\":$ADVISORY2_ID,\"p_expected_version\":2,\"p_status\":\"complete\",\"p_disposition\":\"Named human reviewed the completed inspection record for every applicable asset.\",\"p_basis\":\"Verified completion evidence reconciles the applicable asset population.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
noerr "$ADVISORY3"; ADVISORY3_ID=$(field "$ADVISORY3" advisoryId); test "$(field "$ADVISORY3" version)" = '3'
test "$(psqlc "select count(*) from vendor_advisories where advisory_reference='$RUN_KEY-SB' and organization_id='$ORG'")" = '3'
test "$(psqlc "select count(*) from vendor_advisories where id=$ADVISORY3_ID and active and assessment_status='complete' and assessed_by is not null")" = '1'

CROSS_DELIVERY=$(rpc "$FOREIGN" record_supplier_delivery "{\"p_payload\":{\"deliveryReference\":\"foreign-attempt\",\"supplierId\":\"$SUPPLIER\",\"materialId\":\"$MATERIAL\",\"orderedOn\":\"$ORDERED\",\"promisedOn\":\"$PROMISED\",\"receivedOn\":\"$RECEIVED\",\"qualityOutcome\":\"accepted\",\"basis\":\"A foreign tenant cannot reuse another tenant supplier identity.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
expect_refusal "$CROSS_DELIVERY" 'supplier'
FOREIGN_WORKSPACE=$(rpc "$FOREIGN" get_supplier_governance_workspace '{}')
BODY="$FOREIGN_WORKSPACE" DELIVERY="$DELIVERY_ID" SUSPECT="$SUSPECT2_ID" ADVISORY="$ADVISORY3_ID" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('answered'); assert all(str(v.get('id'))!=os.environ['DELIVERY'] for v in x['deliveries']); assert all(str(v.get('id'))!=os.environ['SUSPECT'] for v in x['suspectCases']); assert all(str(v.get('id'))!=os.environ['ADVISORY'] for v in x['advisories'])"
OUT=$(sql_must_fail "update supplier_deliveries set note='bypass' where id=$DELIVERY_ID;"); grep -qi 'immutable' <<<"$OUT"
OUT=$(sql_must_fail "delete from suspect_parts where id=$SUSPECT2_ID;"); grep -qi 'cannot be deleted' <<<"$OUT"
OUT=$(sql_must_fail "update vendor_advisories set assessment_status='complete' where id=$ADVISORY3_ID;"); grep -qi 'governed named-human workflow' <<<"$OUT"

WORKSPACE=$(rpc "$MANAGER" get_supplier_governance_workspace '{}')
BODY="$WORKSPACE" DELIVERY="$DELIVERY_ID" SUSPECT="$SUSPECT2_ID" ADVISORY="$ADVISORY3_ID" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('answered'); assert any(str(v.get('id'))==os.environ['DELIVERY'] for v in x['deliveries']); assert any(str(v.get('id'))==os.environ['SUSPECT'] and v.get('status')=='cleared' for v in x['suspectCases']); assert any(str(v.get('id'))==os.environ['ADVISORY'] and v.get('assessmentStatus')=='complete' for v in x['advisories']); assert 'contractPackages' in x and 'performancePeriods' in x and 'warranties' in x"
NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_supplier_governance_workspace" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('supplier_delivery','suspect_part_case','vendor_advisory','vendor_advisory_assessment')")" -ge 6

echo 'Supplier-commercial governance smoke passed: delivery=immutable suspect=versioned quarantine=human advisory=versioned tenant-wall=true canonical-workspace=true'
