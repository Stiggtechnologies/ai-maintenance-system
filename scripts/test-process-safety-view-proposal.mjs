import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;
create function app_current_org() returns uuid language sql stable as $$select current_setting('test.org')::uuid$$;
create table audit_events(id uuid default gen_random_uuid(),organization_id uuid,entity_type text,actor text,event_data jsonb,created_at timestamptz default now());
alter table audit_events enable row level security;
create policy tenant_audit on audit_events for all to authenticated using(organization_id=app_current_org()) with check(organization_id=app_current_org());
grant select,insert on audit_events to authenticated;
insert into audit_events(organization_id,entity_type,event_data) values
('11111111-1111-4111-8111-111111111111','process_safety_control','{}'),('22222222-2222-4222-8222-222222222222','process_safety_control','{}');`);
const source = readFileSync(
  "supabase/migrations/20261219090001_process_safety_integrity_activation.sql",
  "utf8",
);
await db.exec(
  source.slice(
    source.indexOf("create view process_safety_control_events as"),
    source.indexOf("-- The records named below"),
  ),
);
// Conditional exposure fixture: these view grants are simulated, not asserted
// to exist in production. The parent owner must inspect actual live metadata.
await db.exec(`grant select,insert on process_safety_control_events to authenticated;
select set_config('test.org','11111111-1111-4111-8111-111111111111',false);set role authenticated;`);
assert.equal(
  (await db.query("select count(*)::int n from process_safety_control_events"))
    .rows[0].n,
  2,
);
const forged =
  "insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis) values('22222222-2222-4222-8222-222222222222','inspection_completed','inspection_plans',1,'33333333-3333-4333-8333-333333333333','Synthetic forged audit witness')";
await db.exec(forged);
await db.exec("reset role");
await db.exec(
  readFileSync("docs/qa/process-safety-view-containment.proposed.sql", "utf8"),
);
await db.exec("set role authenticated");
assert.equal(
  (await db.query("select count(*)::int n from process_safety_control_events"))
    .rows[0].n,
  1,
);
await assert.rejects(() => db.exec(forged), /permission denied/);
await db.exec("reset role");
// Owner path stands in for the existing guarded definer RPC's database owner.
await db.exec(
  "insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis) values('11111111-1111-4111-8111-111111111111','inspection_completed','inspection_plans',1,'33333333-3333-4333-8333-333333333333','Synthetic owner audit witness')",
);
assert.equal(
  (await db.query("select count(*)::int n from audit_events")).rows[0].n,
  4,
);
console.log(
  "PASS conditional two-tenant view leak and forged insert reproduced; proposed invoker/read and client-write containment pass; owner audit path retained. Live grants and native full-chain safety RPC qualification remain unverified.",
);
await db.close();
