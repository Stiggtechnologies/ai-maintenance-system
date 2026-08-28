#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 3 — governance depth: tailoring, intensity, enforcement.
#
# Steps (each a live transcript against a real local database):
#   1  library (D3.02/D11.04): the six starter profiles exist as DRAFTS with
#      only INDUSTRY_GUIDANCE/BEST_PRACTICE requirement tiers and no
#      ADEM/Suncor string anywhere in their content; the tenant seeding verb
#      is idempotent (0 added on re-run).
#   2  org tree (D11.14): sub-node creation is executive-only; rank
#      inversion and self-parenting refused at the persistence boundary for
#      a raw service write (a rank-legal cycle is structurally impossible —
#      ranks strictly decrease upward); DRAFT profile attachment refused;
#      adopted profiles attached to the tenant root and a deeper node.
#   3  inheritance (D11.14): resolve_org_governance_profile walks depth-0
#      and multi-hop; a case created WITHOUT a framework inherits the
#      resolved ADOPTED profile and the workspace read names the source.
#   4  tailoring adoption (D3.03): rule-set adoption refused while a
#      referenced framework has no adopted version (named); adoption
#      succeeds once the referenced profiles are adopted.
#   5  intensity refusals (D3.04): missing factors refused NAMING each;
#      off-scale rating refused with the stated scale; missing value (no
#      capex) refused naming value; no-determination-before-rules refused.
#   6  determination (D3.03/D3.04): elevated case determined (value+risk+
#      reg+interfaces drivers); persisted CURRENT row; direct client write
#      refused by the provenance trigger; framework-mismatch refusal when
#      the rules select a different profile than the case's.
#   7  enforcement (D3.05): with the ELEVATED binding adopted, a gate
#      proceed with every mandatory finding met is refused until every
#      mandatory criterion carries an ACCEPTED deliverable — at the RPC
#      (named jsonb refusal) AND at the persistence boundary (check_violation
#      for a marker-holding simulated client); the sponsor/creator is
#      refused by the intensity-wide segregation rule; after acceptance the
#      same review proceeds, recorded by a non-sponsor.
#   7c monotone resolution: a FULL-intensity case with only the elevated
#      binding adopted is enforced against the elevated binding (absence at
#      a stricter level can never disarm), and the determination names the
#      fallback.
#   7d act-time re-validation: gates passed BEFORE any determination stay
#      recorded, but once the case is determined elevated the binding blocks
#      advance AND sanction until the deliverable is accepted — the
#      ordering bypass is closed at the acts.
#   7e sanction value-band staleness: committing a value that bands above
#      the determined value level is refused until re-determination; an
#      in-band sanction proceeds.
#   7f non-finite refusals: NaN capex refused at case creation; a service-
#      forced NaN refused by apply_case_governance naming value; a NaN
#      sanction value refused.
#   7g subject-swap re-litigation: a service UPDATE moving a passing review
#      onto an armed case is admitted AND audited as a binding violation; a
#      client-context swap is refused at the boundary.
#   7h concurrent determinations chain (advisory lock): two overlapping
#      apply_case_governance calls both succeed, one current row remains.
#   8  audit: the determination and the binding adoption left their
#      audit_events/security_events rows; the arming tables' provenance
#      backstop refused a client write and audited a service write.
#
# Run: supabase start && scripts/ci-develop-slice3-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-3 smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'

sql_must_fail(){ local out
  out=$( { PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 <<<"$1"; } || true )
  if PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<<"$1"; then
    echo "expected SQL to be refused, it succeeded: $1"; return 1
  fi
  printf '%s' "$out"
}
field(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"; }
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'): print('unexpected error:',x); sys.exit(1)
PY
}
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

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
RE=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"; test -n "$RE"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
RE_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and role='reliability_engineer' limit 1")
test -n "$MANAGER_ID"; test -n "$RE_ID"

# Idempotent re-run: clear this smoke's artifacts (audited service path by
# design), and return the slice's adoptable content to draft.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'SMOKE3 %';" >/dev/null
psqlc "delete from kb_intake_documents where organization_id='$ORG' and source_id like 'smoke3-%';" >/dev/null
psqlc "update organizations set governance_profile_id=null where name like 'SMOKE3 %' or id='$ORG';" >/dev/null
psqlc "delete from organizations where name like 'SMOKE3 %' and parent_id is not null and not exists (select 1 from organizations c where c.parent_id=organizations.id);" >/dev/null
psqlc "delete from organizations where name like 'SMOKE3 %';" >/dev/null
psqlc "update governance_tailoring_rule_sets set status='draft', adopted_by=null, adopted_at=null, superseded_by=null where organization_id='$ORG';" >/dev/null
psqlc "update governance_intensity_bindings set status='draft', adopted_by=null, adopted_at=null, superseded_by=null where organization_id='$ORG';" >/dev/null
psqlc "update project_frameworks set status='draft', adopted_by=null, adopted_at=null, superseded_by=null where organization_id='$ORG' and name in ('Major Capital Projects — Mining & Metals','Sustaining Capital — Light Governance','Turnaround & Shutdown Delivery','Brownfield Modification — Operating Site','Digital & IT Delivery','Exploration & Study Phase');" >/dev/null
psqlc "select set_config('app.governance_config_write','granted',true); delete from governance_tailoring_rule_sets where organization_id='$ORG' and (name like 'SMOKE3 %' or version > 1);" >/dev/null
psqlc "delete from organizations where name like 'SMOKE3 Foreign %';" >/dev/null

echo '— 1. the library: six generic DRAFT archetypes under the provenance fence —'
N=$(psqlc "select count(*) from project_frameworks where organization_id='$ORG' and name in ('Major Capital Projects — Mining & Metals','Sustaining Capital — Light Governance','Turnaround & Shutdown Delivery','Brownfield Modification — Operating Site','Digital & IT Delivery','Exploration & Study Phase')")
test "$N" = "6"
BAD=$(psqlc "select count(*) from stage_gate_criteria sc join stage_gates g on g.id=sc.gate_id join project_frameworks f on f.id=g.framework_id where f.organization_id='$ORG' and f.name in ('Major Capital Projects — Mining & Metals','Sustaining Capital — Light Governance','Turnaround & Shutdown Delivery','Brownfield Modification — Operating Site','Digital & IT Delivery','Exploration & Study Phase') and sc.source_authority not in ('INDUSTRY_GUIDANCE','BEST_PRACTICE')")
test "$BAD" = "0"
FENCE=$(psqlc "select count(*) from project_frameworks f left join project_framework_stages s on s.framework_id=f.id left join stage_gates g on g.framework_id=f.id left join stage_gate_criteria sc on sc.gate_id=g.id where f.organization_id='$ORG' and (f.name ~* '\\madem\\M' or f.name ~* 'suncor' or f.source ~* '\\madem\\M' or f.source ~* 'suncor' or f.basis ~* '\\madem\\M' or f.basis ~* 'suncor' or coalesce(sc.criterion,'') ~* '\\madem\\M' or coalesce(sc.guidance,'') ~* 'suncor')")
test "$FENCE" = "0"
R=$(rpc "$EXEC" seed_governance_framework_library '{}')
noerr "$R"; test "$(printf '%s' "$R"|field profiles_added)" = "0"
echo '   six drafts present; tiers fenced; re-seed added 0 (idempotent)'

echo '— 2. org tree: executive-only authoring, rank + cycle integrity, adopted-only profiles —'
R=$(rpc "$PLANNER" create_sub_organization '{"p_name":"SMOKE3 planner probe","p_node_level":"site","p_parent_node_id":"'"$ORG"'"}')
expect_err "$R" 'executive or administrator'
R=$(rpc "$EXEC" create_sub_organization '{"p_name":"SMOKE3 Mining BU","p_node_level":"business_unit","p_parent_node_id":"'"$ORG"'","p_jurisdiction":"AB, Canada"}')
noerr "$R"; BU=$(printf '%s' "$R"|field node_id); test -n "$BU"
R=$(rpc "$EXEC" create_sub_organization '{"p_name":"SMOKE3 Mine Site","p_node_level":"site","p_parent_node_id":"'"$BU"'"}')
noerr "$R"; SITE=$(printf '%s' "$R"|field node_id); test -n "$SITE"
R=$(rpc "$EXEC" create_sub_organization '{"p_name":"SMOKE3 inverted","p_node_level":"enterprise","p_parent_node_id":"'"$BU"'"}')
expect_err "$R" 'strictly above'
# A rank-legal cycle is structurally impossible (ranks strictly decrease
# upward), so the refusal that fires on a loop attempt is the rank rule; the
# explicit cycle walk stays as defense-in-depth behind it.
OUT=$(sql_must_fail "update organizations set parent_id='$SITE' where id='$BU';")
grep -qi 'strictly above' <<<"$OUT"
OUT=$(sql_must_fail "update organizations set parent_id='$BU' where id='$BU';")
grep -qi 'cannot be its own parent' <<<"$OUT"
# Name uniqueness is TENANT-scoped: another tenant's name is neither an
# oracle nor a denial; the same name inside this tenant's tree still refuses.
FOREIGN=$(psqlc "select provision_organization('SMOKE3 Foreign Tenant Corp')->>'organization_id'")
test -n "$FOREIGN"
R=$(rpc "$EXEC" create_sub_organization '{"p_name":"SMOKE3 Foreign Tenant Corp","p_node_level":"area","p_parent_node_id":"'"$SITE"'"}')
noerr "$R"
R=$(rpc "$EXEC" create_sub_organization '{"p_name":"SMOKE3 Foreign Tenant Corp","p_node_level":"area","p_parent_node_id":"'"$SITE"'"}')
expect_err "$R" 'already exists'
ADOPTED_SUSTAIN=""
R=$(rpc "$EXEC" set_org_governance_profile "{\"p_node_id\":\"$ORG\",\"p_framework_id\":\"$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Sustaining Capital — Light Governance' and version=1")\",\"p_note\":\"draft profiles cannot govern\"}")
expect_err "$R" 'cannot govern'
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Sustaining Capital — Light Governance' and version=1")\",\"p_note\":\"Adopted for the slice-3 CI transcript (sustaining archetype).\"}")
noerr "$R"
ADOPTED_SUSTAIN=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Sustaining Capital — Light Governance' and status='adopted'")
test -n "$ADOPTED_SUSTAIN"
R=$(rpc "$EXEC" set_org_governance_profile "{\"p_node_id\":\"$ORG\",\"p_framework_id\":\"$ADOPTED_SUSTAIN\",\"p_note\":\"Tenant default: light sustaining governance.\"}")
noerr "$R"
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Brownfield Modification — Operating Site' and version=1")\",\"p_note\":\"Adopted for the slice-3 CI transcript (brownfield archetype).\"}")
noerr "$R"
ADOPTED_BROWN=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Brownfield Modification — Operating Site' and status='adopted'")
R=$(rpc "$EXEC" set_org_governance_profile "{\"p_node_id\":\"$BU\",\"p_framework_id\":\"$ADOPTED_BROWN\",\"p_note\":\"BU override: operating-site discipline.\"}")
noerr "$R"
echo '   tree built (enterprise>BU>site); inversion+cycle refused; drafts refused; two profiles attached;'
echo '   foreign-tenant name neither an oracle nor a denial; in-tenant duplicate still refused'

echo '— 3. inheritance: depth-0 and multi-hop resolution; a frameworkless case inherits —'
test "$(psqlc "select framework_id from resolve_org_governance_profile('$ORG')")" = "$ADOPTED_SUSTAIN"
test "$(psqlc "select framework_id from resolve_org_governance_profile('$SITE')")" = "$ADOPTED_BROWN"
test "$(psqlc "select source_depth from resolve_org_governance_profile('$SITE')")" = "1"
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE3 inherited light case","p_problem_statement":"Feeder liner wear is consuming maintenance budget beyond plan.","p_lifecycle_type":"sustaining_capital","p_estimated_capex":1000000}')
noerr "$R"
CASE_LIGHT=$(printf '%s' "$R"|field case_id); test -n "$CASE_LIGHT"
test "$(printf '%s' "$R"|field framework_id)" = "$ADOPTED_SUSTAIN"
test "$(printf '%s' "$R"|field framework_inherited_from)" = "$ORG"
G=$(rpc "$PLANNER" get_case_governance "{\"p_case_id\":\"$CASE_LIGHT\"}")
BODY="$G" python3 - <<'PY'
import json,os
g=json.loads(os.environ['BODY'])
assert g.get('inheritedProfile') and g['inheritedProfile']['name']=='Sustaining Capital — Light Governance', g.get('inheritedProfile')
assert g['inheritedProfile']['operableHere'] is True
assert g['framework']['name']=='Sustaining Capital — Light Governance'
assert isinstance(g.get('orgChain'), list) and len(g['orgChain'])>=1
PY
echo '   resolver: depth-0 sustaining at root, multi-hop brownfield at site; case inherited with source named'

echo '— 4. tailoring adoption: executable-contract refusal, then adoption —'
RS=$(psqlc "select id from governance_tailoring_rule_sets where organization_id='$ORG' and name='Reference Tailoring Rules' and version=1")
test -n "$RS"
R=$(rpc "$PLANNER" apply_case_governance "{\"p_case_id\":\"$CASE_LIGHT\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"Planner probe: role must be refused before rules are consulted.\"}")
expect_err "$R" 'governance or engineering role'
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_LIGHT\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"Classified from the case file for the CI transcript.\"}")
expect_err "$R" 'no ADOPTED tailoring rule set'
R=$(rpc "$EXEC" adopt_governance_rule_set "{\"p_rule_set_id\":\"$RS\",\"p_note\":\"Adoption must be refused while referenced frameworks are drafts.\"}")
expect_err "$R" 'no ADOPTED version'
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Major Capital Projects — Mining & Metals' and version=1")\",\"p_note\":\"Adopted for the slice-3 CI transcript (major-capital archetype).\"}")
noerr "$R"
R=$(rpc "$EXEC" adopt_governance_rule_set "{\"p_rule_set_id\":\"$RS\",\"p_note\":\"Adopted for the slice-3 CI transcript from the reference proposal.\"}")
noerr "$R"
echo '   adoption refused naming the unadopted framework, then adopted with all three referenced profiles live'

echo '— 4b. succession: an adopted set is immutable but never a dead end; adopted means THE one —'
R=$(rpc "$MANAGER" set_rule_set_thresholds "{\"p_rule_set_id\":\"$RS\",\"p_value_thresholds\":{\"standard_from_usd\":1,\"elevated_from_usd\":2,\"full_from_usd\":3}}")
expect_err "$R" 'draft a new version'
R=$(rpc "$MANAGER" create_governance_rule_set_version "{\"p_rule_set_id\":\"$RS\"}")
noerr "$R"
RS2=$(printf '%s' "$R"|field rule_set_id); test -n "$RS2"
test "$(printf '%s' "$R"|field rules_cloned)" = "4"
test "$(printf '%s' "$R"|field version)" = "2"
R=$(rpc "$MANAGER" create_governance_rule_set_version "{\"p_rule_set_id\":\"$RS\"}")
expect_err "$R" 'already exists'
R=$(rpc "$EXEC" adopt_governance_rule_set "{\"p_rule_set_id\":\"$RS2\",\"p_note\":\"v2 adopted: succession is a live verb, cloned from v1 unchanged.\"}")
noerr "$R"
test "$(psqlc "select status from governance_tailoring_rule_sets where id='$RS'")" = "superseded"
test "$(psqlc "select count(*) from governance_tailoring_rule_sets where organization_id='$ORG' and status='adopted'")" = "1"
# A DIFFERENTLY-NAMED set adopted later supersedes the reference too — two
# rows both labeled adopted (one silently inert) can no longer exist, and
# the partial unique index stands behind the RPC.
test "$(psqlc "select count(*) from pg_indexes where indexname='idx_gov_rule_sets_one_adopted'")" = "1"
psqlc "select set_config('app.governance_config_write','granted',true);
insert into governance_tailoring_rule_sets (organization_id, name, version, status, value_thresholds, basis)
values ('$ORG','SMOKE3 Alt Rules',1,'draft','{\"standard_from_usd\": 5000000, \"elevated_from_usd\": 50000000, \"full_from_usd\": 250000000}'::jsonb,'Alternate configuration for the one-adopted-per-org transcript probe.');" >/dev/null
ALT=$(psqlc "select id from governance_tailoring_rule_sets where organization_id='$ORG' and name='SMOKE3 Alt Rules'")
R=$(rpc "$MANAGER" add_tailoring_rule "{\"p_rule_set_id\":\"$ALT\",\"p_priority\":10,\"p_description\":\"Everything runs sustaining in the alternate probe set.\",\"p_framework_name\":\"Sustaining Capital — Light Governance\"}")
noerr "$R"
R=$(rpc "$EXEC" adopt_governance_rule_set "{\"p_rule_set_id\":\"$ALT\",\"p_note\":\"Alt adopted: must supersede the reference set whatever its name.\"}")
noerr "$R"
test "$(psqlc "select status from governance_tailoring_rule_sets where id='$RS2'")" = "superseded"
test "$(psqlc "select count(*) from governance_tailoring_rule_sets where organization_id='$ORG' and status='adopted'")" = "1"
R=$(rpc "$MANAGER" create_governance_rule_set_version "{\"p_rule_set_id\":\"$RS2\"}")
noerr "$R"; RS3=$(printf '%s' "$R"|field rule_set_id)
R=$(rpc "$EXEC" adopt_governance_rule_set "{\"p_rule_set_id\":\"$RS3\",\"p_note\":\"Reference v3 re-adopted after the alternate-set supersession probe.\"}")
noerr "$R"
test "$(psqlc "select status from governance_tailoring_rule_sets where id='$ALT'")" = "superseded"
echo '   immutable-but-successable proven (v2 cloned+adopted); adopted-means-THE-one proven across names'

echo '— 5. the six-factor refusals: every absence NAMED —'
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_LIGHT\",\"p_risk\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"Missing complexity must be refused by name.\"}")
expect_err "$R" 'not computable'
BODY="$R" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
missing=x.get('missing_factors') or []
assert any(m.startswith('complexity') for m in missing), x
PY
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_LIGHT\",\"p_risk\":\"extreme\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"cosmic\",\"p_basis\":\"Every off-scale rating must be named at once, with its scale.\"}")
expect_err "$R" 'not computable'
BODY="$R" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
missing=x.get('missing_factors') or []
assert any(m.startswith('risk (') and 'extreme' in m and 'low, medium, high, critical' in m for m in missing), x
assert any(m.startswith('interfaces (') and 'cosmic' in m and 'isolated, limited, multiple, extensive' in m for m in missing), x
PY
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE3 valueless case","p_problem_statement":"Pump seal failures repeat on the transfer line each quarter.","p_lifecycle_type":"sustaining_capital"}')
noerr "$R"; CASE_NOVALUE=$(printf '%s' "$R"|field case_id)
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_NOVALUE\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"Missing value must be refused naming value.\"}")
expect_err "$R" 'not computable'
BODY="$R" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
missing=x.get('missing_factors') or []
assert any(m.startswith('value') for m in missing), x
PY
echo '   missing complexity named; off-scale risk named with its scale; missing value named'

echo '— 6. determination: light + elevated persisted; provenance trigger; framework mismatch —'
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_LIGHT\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"Classified from the case file for the CI transcript.\"}")
noerr "$R"
test "$(printf '%s' "$R"|field intensity_level)" = "light"
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3 brownfield elevated case\",\"p_problem_statement\":\"Secondary crusher circuit modification beside the operating line.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":120000000,\"p_framework_id\":\"$ADOPTED_BROWN\"}")
noerr "$R"; CASE_ELEV=$(printf '%s' "$R"|field case_id); test -n "$CASE_ELEV"
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_ELEV\",\"p_risk\":\"high\",\"p_complexity\":\"medium\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"permit_required\",\"p_interfaces\":\"multiple\",\"p_basis\":\"Classified in the CI transcript from the modification scope.\"}")
noerr "$R"
test "$(printf '%s' "$R"|field intensity_level)" = "elevated"
BODY="$R" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
# EXACT spec I.2 factor order — the lib mirror's order, pinned live.
assert x['drivers']==['value','risk','regulatory_exposure','interfaces'], x['drivers']
assert x['factor_levels']['complexity']==2
assert x['framework']['name']=='Brownfield Modification — Operating Site'
PY
DET=$(psqlc "select count(*) from development_case_governance where development_case_id='$CASE_ELEV' and status='current'")
test "$DET" = "1"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
insert into development_case_governance (organization_id, development_case_id, rule_set_id, rule_id, framework_id, intensity_level, computed_level, factor_inputs, factor_levels, drivers, basis, determined_by)
select organization_id, development_case_id, rule_set_id, rule_id, framework_id, 'light', 'light', factor_inputs, factor_levels, drivers, 'forged determination attempt (must be refused)', determined_by
from development_case_governance where development_case_id='$CASE_ELEV' limit 1;
rollback;")
grep -qi 'apply_case_governance' <<<"$OUT"
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_LIGHT\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"Re-determination on a mismatching lifecycle must be refused.\"}")
noerr "$R"  # same case, same rules: allowed re-determination supersedes
test "$(psqlc "select count(*) from development_case_governance where development_case_id='$CASE_LIGHT'")" = "2"
test "$(psqlc "select count(*) from development_case_governance where development_case_id='$CASE_LIGHT' and status='current'")" = "1"
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE3 mismatch case","p_problem_statement":"Tailings line reroute across the operating corridor for compliance.","p_lifecycle_type":"regulatory","p_estimated_capex":2000000}')
noerr "$R"; CASE_MM=$(printf '%s' "$R"|field case_id)
test "$(printf '%s' "$R"|field framework_id)" = "$ADOPTED_SUSTAIN"
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_MM\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"permit_required\",\"p_interfaces\":\"limited\",\"p_basis\":\"Rules select brownfield; the case inherited sustaining — must refuse.\"}")
expect_err "$R" 'different framework'
echo '   light+elevated persisted (supersession proven); forged write refused; mismatch refused by name'

echo '— 7. D3.05 ENFORCED: adopted elevated binding blocks the gate pass until deliverables are ACCEPTED —'
BIND=$(psqlc "select id from governance_intensity_bindings where organization_id='$ORG' and intensity_level='elevated' and status='draft' order by version desc limit 1")
test -n "$BIND"
R=$(rpc "$MANAGER" adopt_intensity_binding "{\"p_binding_id\":\"$BIND\",\"p_note\":\"Manager adoption must be refused — arming enforcement is executive work.\"}")
expect_err "$R" 'executive or administrator'
R=$(rpc "$EXEC" adopt_intensity_binding "{\"p_binding_id\":\"$BIND\",\"p_note\":\"Adopted for the slice-3 CI transcript from the reference proposal.\"}")
noerr "$R"
G1=$(psqlc "select g.id from stage_gates g where g.framework_id='$ADOPTED_BROWN' and g.name='G1 — Framing'")
test -n "$G1"
CRIT=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G1 and is_mandatory")
test -n "$CRIT"
FIND="[{\"criterion_text\":\"$CRIT\",\"status\":\"met\",\"evidence\":\"Impact statement reviewed in the CI transcript.\"}]"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_ELEV\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Every mandatory finding met, but no accepted deliverable exists yet.\",\"p_findings\":$FIND}")
expect_err "$R" 'no ACCEPTED deliverable'
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE_ELEV',$G1,'need_identification','proceed','$MANAGER_ID',now(),'bypass attempt: must be stopped by the intensity trigger');
rollback;")
grep -qi 'Intensity binding' <<<"$OUT"
grep -qi 'ACCEPTED deliverable' <<<"$OUT"
R=$(rpc "$PLANNER" create_case_deliverable "{\"p_case_id\":\"$CASE_ELEV\",\"p_title\":\"SMOKE3 operating-unit impact statement\",\"p_type\":\"report\",\"p_owner_id\":\"$RE_ID\",\"p_requirement_id\":$(psqlc "select id from stage_gate_criteria where gate_id=$G1 and is_mandatory")}")
noerr "$R"; DLV=$(printf '%s' "$R"|field deliverable_id); test -n "$DLV"
R=$(rpc "$RE" kb_ingest_document '{"p_source_id":"smoke3-impact-statement","p_title":"SMOKE3 operating-unit impact statement r0","p_chunks":[{"chunk_index":0,"content":"Impact: crusher line 2 outage window 6h during tie-in, no process safety envelope change."}]}')
noerr "$R"
DOC=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='smoke3-impact-statement'")
R=$(rpc "$RE" submit_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_document_id\":\"$DOC\"}")
noerr "$R"
R=$(rpc "$MANAGER" accept_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_decision\":\"accepted\",\"p_note\":\"Impact statement reviewed against the case scope.\"}")
noerr "$R"
R=$(rpc "$PLANNER" record_case_gate_review "{\"p_case_id\":\"$CASE_ELEV\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"A planner holds no review role, so this recording is refused on role.\",\"p_findings\":$FIND}")
expect_err "$R" 'governance or engineering role'
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_ELEV\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Mandatory met and the accepted deliverable now stands behind it.\",\"p_findings\":$FIND}")
noerr "$R"
test "$(printf '%s' "$R"|field outcome)" = "proceed"
echo '   refused at the RPC and at the boundary until acceptance; then the same findings proceed'

echo '— 7b. intensity-wide segregation: the sponsor/creator cannot record at elevated —'
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_ELEV\",\"p_risk\":\"high\",\"p_complexity\":\"medium\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"permit_required\",\"p_interfaces\":\"multiple\",\"p_basis\":\"Re-determination keeps elevated for the segregation probe.\"}")
noerr "$R"
SPONSOR_CASE=$(rpc "$MANAGER" create_development_case "{\"p_title\":\"SMOKE3 manager-sponsored elevated case\",\"p_problem_statement\":\"Conveyor drive replacement beside the operating gallery.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":90000000,\"p_framework_id\":\"$ADOPTED_BROWN\"}")
noerr "$SPONSOR_CASE"; CASE_SOD=$(printf '%s' "$SPONSOR_CASE"|field case_id)
R=$(rpc "$RE" apply_case_governance "{\"p_case_id\":\"$CASE_SOD\",\"p_risk\":\"high\",\"p_complexity\":\"medium\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"permit_required\",\"p_interfaces\":\"multiple\",\"p_basis\":\"Classified for the segregation probe in the CI transcript.\"}")
noerr "$R"; test "$(printf '%s' "$R"|field intensity_level)" = "elevated"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_SOD\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"The manager sponsors this case, so this recording must be refused.\",\"p_findings\":$FIND}")
expect_err "$R" 'cannot record any of its gate decisions'
echo '   sponsor refused by the intensity-wide segregation rule'

echo '— 7c. monotone resolution: FULL intensity with only the elevated binding adopted still enforces —'
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3 full-intensity fallback case\",\"p_problem_statement\":\"Ore handling expansion beside the operating train, full band value.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":300000000,\"p_framework_id\":\"$ADOPTED_BROWN\"}")
noerr "$R"; CASE_FULL=$(printf '%s' "$R"|field case_id); test -n "$CASE_FULL"
R=$(rpc "$RE" apply_case_governance "{\"p_case_id\":\"$CASE_FULL\",\"p_risk\":\"high\",\"p_complexity\":\"medium\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"permit_required\",\"p_interfaces\":\"multiple\",\"p_basis\":\"Classified for the monotone-fallback transcript probe.\"}")
noerr "$R"
test "$(printf '%s' "$R"|field intensity_level)" = "full"
BODY="$R" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['binding'] and x['binding']['intensity_level']=='elevated', x.get('binding')
assert 'strongest adopted binding at-or-below' in (x.get('binding_note') or ''), x.get('binding_note')
assert x.get('binding_unmet') and len(x['binding_unmet']['unlinked_mandatory'])==1, x.get('binding_unmet')
PY
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_FULL\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Full-intensity case must be held to at least the elevated binding.\",\"p_findings\":$FIND}")
expect_err "$R" 'no ACCEPTED deliverable'
# The seeded rule 40 floor RAISES a light-computed brownfield case to
# elevated — the raise-only floor exercised on live seeded data.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3 floor-raised case\",\"p_problem_statement\":\"Small valve-station tie-in beside the operating line, low every factor.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":1000000,\"p_framework_id\":\"$ADOPTED_BROWN\"}")
noerr "$R"; CASE_FLOOR=$(printf '%s' "$R"|field case_id)
R=$(rpc "$RE" apply_case_governance "{\"p_case_id\":\"$CASE_FLOOR\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"All-low brownfield: the rule floor must raise light to elevated.\"}")
noerr "$R"
test "$(printf '%s' "$R"|field computed_level)" = "light"
test "$(printf '%s' "$R"|field intensity_level)" = "elevated"
echo '   full case enforced against the elevated binding; determination names the fallback and the unmet demand;'
echo '   seeded rule floor raised a light-computed case to elevated (raise-only floor live)'

echo '— 7d. act-time re-validation: gates passed BEFORE determination cannot carry advance or sanction —'
if [ "$(psqlc "select count(*) from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='sanction' and status='adopted'")" = "0" ]; then
  SANC_LIMIT=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='sanction' and status='draft' order by version desc limit 1")
  test -n "$SANC_LIMIT"
  R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$SANC_LIMIT\",\"p_note\":\"Adopted for the slice-3 CI transcript from the demo delegation instrument.\"}")
  noerr "$R"
fi
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3 late-determination case\",\"p_problem_statement\":\"Reclaim tunnel conveyor upgrade beside the operating line.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":20000000,\"p_framework_id\":\"$ADOPTED_BROWN\"}")
noerr "$R"; CASE_ACT=$(printf '%s' "$R"|field case_id); test -n "$CASE_ACT"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_ACT\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"No determination exists yet, so no binding holds this recording.\",\"p_findings\":$FIND}")
noerr "$R"; test "$(printf '%s' "$R"|field outcome)" = "proceed"
R=$(rpc "$RE" apply_case_governance "{\"p_case_id\":\"$CASE_ACT\",\"p_risk\":\"high\",\"p_complexity\":\"medium\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"permit_required\",\"p_interfaces\":\"multiple\",\"p_basis\":\"Determined AFTER the gate pass for the act-time transcript probe.\"}")
noerr "$R"
test "$(printf '%s' "$R"|field intensity_level)" = "elevated"
BODY="$R" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x.get('binding_unmet') and len(x['binding_unmet']['unlinked_mandatory'])==1, x.get('binding_unmet')
PY
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE_ACT\",\"p_to_stage_key\":\"options_analysis\"}")
expect_err "$R" 'binding is not met'
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE_ACT\",\"p_note\":\"Sanction over a pre-determination gate pass must be refused.\",\"p_sanctioned_value\":20000000}")
expect_err "$R" 'binding is not met'
R=$(rpc "$PLANNER" create_case_deliverable "{\"p_case_id\":\"$CASE_ACT\",\"p_title\":\"SMOKE3 reclaim conveyor impact statement\",\"p_type\":\"report\",\"p_owner_id\":\"$RE_ID\",\"p_requirement_id\":$(psqlc "select id from stage_gate_criteria where gate_id=$G1 and is_mandatory")}")
noerr "$R"; DLV2=$(printf '%s' "$R"|field deliverable_id); test -n "$DLV2"
R=$(rpc "$RE" kb_ingest_document '{"p_source_id":"smoke3-reclaim-impact","p_title":"SMOKE3 reclaim conveyor impact statement r0","p_chunks":[{"chunk_index":0,"content":"Impact: reclaim tunnel conveyor outage 4h during change-over, isolation plan attached."}]}')
noerr "$R"
DOC2=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='smoke3-reclaim-impact'")
R=$(rpc "$RE" submit_deliverable "{\"p_deliverable_id\":\"$DLV2\",\"p_document_id\":\"$DOC2\"}")
noerr "$R"
R=$(rpc "$MANAGER" accept_deliverable "{\"p_deliverable_id\":\"$DLV2\",\"p_decision\":\"accepted\",\"p_note\":\"Impact statement reviewed against the conveyor scope.\"}")
noerr "$R"
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE_ACT\",\"p_to_stage_key\":\"options_analysis\"}")
noerr "$R"; test "$(printf '%s' "$R"|field current_stage_key)" = "options_analysis"
echo '   ordering bypass closed: advance AND sanction refused post-hoc until acceptance, then advance proceeds'

echo '— 7e. sanction value-band staleness: the determination cannot be silently outgrown —'
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE3 staleness case","p_problem_statement":"Slurry pump fleet renewal across the concentrator, phased by line.","p_lifecycle_type":"sustaining_capital","p_estimated_capex":2000000}')
noerr "$R"; CASE_STALE=$(printf '%s' "$R"|field case_id)
test "$(printf '%s' "$R"|field framework_id)" = "$ADOPTED_SUSTAIN"
R=$(rpc "$RE" apply_case_governance "{\"p_case_id\":\"$CASE_STALE\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"Classified light for the staleness transcript probe.\"}")
noerr "$R"; test "$(printf '%s' "$R"|field intensity_level)" = "light"
SG1=$(psqlc "select g.id from stage_gates g where g.framework_id='$ADOPTED_SUSTAIN' and g.stage_key='need_identification'")
SCRIT=$(psqlc "select criterion from stage_gate_criteria where gate_id=$SG1 and is_mandatory")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_STALE\",\"p_gate_id\":$SG1,\"p_outcome\":\"proceed\",\"p_note\":\"Screen passed for the staleness probe; light binding is unarmed.\",\"p_findings\":[{\"criterion_text\":\"$SCRIT\",\"status\":\"met\",\"evidence\":\"Screen reviewed in the CI transcript.\"}]}")
noerr "$R"
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE_STALE\",\"p_note\":\"Committing 24M under a 2M light determination must be refused.\",\"p_sanctioned_value\":24000000}")
expect_err "$R" 'bands above the value level'
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE_STALE\",\"p_note\":\"In-band sanction of the determined light case for the transcript.\",\"p_sanctioned_value\":2000000}")
noerr "$R"; test "$(printf '%s' "$R"|field status)" = "sanctioned"
echo '   out-of-band commitment refused naming the bands; in-band sanction proceeds'

echo '— 7f. non-finite refusals: NaN is refused, never banded —'
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE3 nan-capex case","p_problem_statement":"Thickener rake drive refurbishment scoping for next shutdown.","p_lifecycle_type":"sustaining_capital","p_estimated_capex":"NaN"}')
expect_err "$R" 'finite amount'
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE3 nan-forced case","p_problem_statement":"Thickener rake drive refurbishment scoping for next shutdown.","p_lifecycle_type":"sustaining_capital","p_estimated_capex":1000000}')
noerr "$R"; CASE_NAN=$(printf '%s' "$R"|field case_id)
psqlc "update development_cases set estimated_capex='NaN'::numeric where id='$CASE_NAN';" >/dev/null
R=$(rpc "$RE" apply_case_governance "{\"p_case_id\":\"$CASE_NAN\",\"p_risk\":\"low\",\"p_complexity\":\"low\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"none\",\"p_interfaces\":\"isolated\",\"p_basis\":\"A service-forced NaN value must be refused naming value.\"}")
expect_err "$R" 'not computable'
BODY="$R" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
missing=x.get('missing_factors') or []
assert any(m.startswith('value (') and 'not a finite amount' in m for m in missing), x
PY
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE_ACT\",\"p_note\":\"A NaN sanction value must be refused as non-finite.\",\"p_sanctioned_value\":\"NaN\"}")
expect_err "$R" 'finite amount'
echo '   NaN refused at creation, at determination (named under value) and at sanction'

echo '— 7g. subject-swap re-litigation: a transplanted passing review is re-checked —'
REV=$(psqlc "select id from stage_gate_reviews where development_case_id='$CASE_ACT' and gate_id=$G1 and outcome='proceed' order by id desc limit 1")
test -n "$REV"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
update stage_gate_reviews set development_case_id='$CASE_SOD' where id=$REV;
rollback;")
grep -qi 'Intensity binding' <<<"$OUT"
N0=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%in violation of the adopted intensity binding%'")
psqlc "update stage_gate_reviews set development_case_id='$CASE_SOD' where id=$REV;" >/dev/null
N1=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%in violation of the adopted intensity binding%'")
test "$N1" -gt "$N0"
psqlc "update stage_gate_reviews set development_case_id='$CASE_ACT' where id=$REV;" >/dev/null
echo '   client transplant refused at the boundary; service transplant admitted AND audited'

echo '— 7h. concurrent determinations chain on the advisory lock —'
CONC_A=$(mktemp); CONC_B=$(mktemp)
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tA >"$CONC_A" 2>&1 <<SQL &
begin;
select set_config('request.jwt.claim.sub', '$RE_ID', true);
select apply_case_governance('$CASE_ELEV', 'high','medium','proven','permit_required','multiple', 'Concurrent determination A for the advisory-lock transcript probe.')->>'determination_id';
select pg_sleep(3);
commit;
SQL
CONC_PID=$!
sleep 1
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tA >"$CONC_B" 2>&1 <<SQL
begin;
select set_config('request.jwt.claim.sub', '$RE_ID', true);
select apply_case_governance('$CASE_ELEV', 'high','medium','proven','permit_required','multiple', 'Concurrent determination B for the advisory-lock transcript probe.')->>'determination_id';
commit;
SQL
wait $CONC_PID
! grep -q 'ERROR' "$CONC_A"
! grep -q 'ERROR' "$CONC_B"
test -s "$CONC_A"; test -s "$CONC_B"
test "$(psqlc "select count(*) from development_case_governance where development_case_id='$CASE_ELEV' and status='current'")" = "1"
rm -f "$CONC_A" "$CONC_B"
echo '   both determinations recorded, supersession chained, exactly one current row'

echo '— 8. audit trail —'
# The arming tables carry the §70 backstop: a client write is refused even
# RLS-bypassed; a service write is admitted AND audited.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update governance_intensity_bindings set status='draft' where organization_id='$ORG' and intensity_level='elevated' and status='adopted';
rollback;")
grep -qi 'authoring RPCs' <<<"$OUT"
P0=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%outside the governance authoring RPCs%'")
psqlc "update governance_tailoring_rule_sets set basis=basis||' (service touch for the audit transcript)' where organization_id='$ORG' and name='SMOKE3 Alt Rules';" >/dev/null
P1=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%outside the governance authoring RPCs%'")
test "$P1" -gt "$P0"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='case_governance'")" -ge 4
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='organization_tree'")" -ge 4
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%Governance regime determined%'")" -ge 2
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%intensity binding%adopted%'")" -ge 1
echo '   determination, tree authoring and binding adoption all left their trails'

echo '— 9. restore the borrowed world: detach the tenant-root profile (governed act) —'
# Other transcripts (slice 1's frameworkless-case sanction refusal) expect a
# tenant with NO attached default profile; the detachment runs through the
# same governed RPC, so the restoration itself is audited.
R=$(rpc "$EXEC" set_org_governance_profile "{\"p_node_id\":\"$ORG\",\"p_framework_id\":null,\"p_note\":\"Slice-3 transcript complete: tenant default detached so other transcripts see their expected world.\"}")
noerr "$R"
test "$(psqlc "select count(*) from organizations where id='$ORG' and governance_profile_id is not null")" = "0"
echo '   root profile detached; SMOKE3 nodes keep theirs for inspection (cleared on re-run)'

echo
echo 'Develop slice-3 smoke PASSED: library fenced and seeded, tree + inheritance live,'
echo 'six-factor refusals named, determination persisted and §70-guarded, and the'
echo 'intensity binding ENFORCED at the RPC and the persistence boundary.'
