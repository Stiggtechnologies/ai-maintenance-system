// Enumerated privileged fixture controls, not product APIs or audit proof.
// Importing/listing the Playwright suite does NOT open a database connection.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const org = "11111111-1111-1111-1111-111111111111";
const foreignOrg = "9208b000-0000-4000-8000-000000000099";
const asset = "9208b000-0000-4000-8000-000000000001";
const evidence = "9208b000-0000-4000-8000-000000000011";
const risk = "9208b000-0000-4000-8000-000000000021";
const manager = "00000000-0000-0000-0000-000000000003";

const controls = {
  snapshot: `select jsonb_build_object(
    'service',(select to_jsonb(s) from public.asset_service_levels s where asset_id='${asset}'),
    'history',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.audit_events a
      where a.organization_id='${org}' and a.entity_type in ('asset_service_level','asset_service_level_verification')
        and a.new_state->>'asset_id'='${asset}'),'[]'::jsonb),
    'approvals',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.approvals a where a.organization_id='${org}'),'[]'::jsonb),
    'workOrders',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from public.work_orders w where w.organization_id='${org}'),'[]'::jsonb))`,
  // Risk association and description correction are privileged test mutations.
  // In particular, description-only correction is NOT canonically audited by
  // the existing verification-field triggers; this harness claims no such audit.
  "associate-risk": `update public.evidence_items set risk_id='${risk}' where id='${evidence}'`,
  "restrict-risk": `update public.risks set information_sensitivity='restricted' where id='${risk}'`,
  "public-risk": `update public.risks set information_sensitivity='public' where id='${risk}'`,
  "drift-evidence": `update public.evidence_items set description=description||' Privileged synthetic browser fixture correction; not canonical audit proof.' where id='${evidence}'`,
  "role-technician": `update public.user_profiles set role='technician' where id='${manager}'`,
  "organization-foreign": `update public.user_profiles set organization_id='${foreignOrg}' where id='${manager}'`,
  "restore-profile": `update public.user_profiles set role='maintenance_manager',organization_id='${org}' where id='${manager}'`,
};

export function controlFixture(action) {
  assert(Object.hasOwn(controls, action), "Unknown U2 browser fixture control");
  assert(
    process.env.GITHUB_ACTIONS === "true" ||
      process.env.SYNCAI_U208_BROWSER_PRIVATE_FIXTURE === "1",
    "Disposable-local browser fixture authorization required",
  );
  const url = new URL(process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321");
  assert(
    url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.port === "54321" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "Only the fixed local Supabase HTTP endpoint is accepted",
  );
  for (const key of [
    "PGHOSTADDR",
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
    "PGOPTIONS",
  ])
    assert(
      process.env[key] === undefined,
      "Inherited PostgreSQL routing/options must be unset",
    );
  const preflight = `do $guard$ begin
    if not exists(select 1 from public.organizations where id='${org}' and name='Fort McMurray Oil Sands Demo')
      or not exists(select 1 from public.assets where id='${asset}' and organization_id='${org}' and tag='U208-BROWSER-PW-1')
      or not exists(select 1 from public.organizations where id='${foreignOrg}' and name='U2 browser synthetic foreign organization')
      or not exists(select 1 from public.user_profiles where id='${manager}' and email='manager@syncai.ca') then
      raise exception 'Disposable U2 browser fixture identity mismatch';
    end if;
  end $guard$;`;
  const sql =
    action === "snapshot"
      ? `begin; ${preflight} ${controls[action]}; commit;`
      : `begin; ${preflight} do $mutation$ declare affected integer; begin
      ${controls[action]}; get diagnostics affected=row_count;
      if affected<>1 then raise exception 'Fixture control must affect exactly one canonical fixture row'; end if;
      end $mutation$; select jsonb_build_object('fixtureControl','${action}','privilegedFixtureMutation',true); commit;`;
  const output = execFileSync(
    "psql",
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      "127.0.0.1",
      "-p",
      "54322",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      sql,
    ],
    {
      encoding: "utf8",
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        LANG: "C",
        PGPASSWORD: "postgres",
        PGSSLMODE: "disable",
        PGOPTIONS:
          "-c statement_timeout=15000 -c application_name=syncai-u208-browser-fixture",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output.trim());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(
    process.argv.length,
    3,
    "Exactly one enumerated fixture action is required",
  );
  console.log(JSON.stringify(controlFixture(process.argv[2])));
}
