-- ============================================================================
-- Tenancy isolation — remove the null-organization escape hatch.
--
-- WHAT WAS WRONG
--
-- 00000000000002_legacy_compat.sql:433-455 generated, for sixteen tables:
--
--     for all to authenticated
--     using       (organization_id is null or organization_id = app_current_org())
--     with check  (organization_id is null or organization_id = app_current_org())
--
-- and 00000000000005_rls_hardening.sql:36-39 gave production_lines the same
-- expression by hand — seventeen tables in total, not sixteen. Any iteration
-- over the legacy_compat array alone misses production_lines.
--
-- The `organization_id is null` disjunct appears in the WITH CHECK as well as
-- the USING, which makes it a write channel, not merely a read leak. Measured
-- on a throwaway Postgres carrying the full chain plus a second tenant, every
-- step below succeeded before this migration:
--
--   1. org B inserts system_alerts with organization_id = NULL          ok
--   2. org A selects it                                                 1 row
--   3. org A updates org B's row                                        ok
--   4. org A deletes org B's row                                        ok
--   5. org A sets organization_id = NULL on its own three alerts        ok
--   6. org B then reads all three                                       3 rows
--
-- Step 5 is the severe one: a single UPDATE exports a tenant's rows to every
-- other tenant, on seventeen tables including audit_events and
-- billing_subscriptions. `for all` also granted UPDATE and DELETE on
-- audit_events, which is an audit-integrity defect independent of tenancy.
--
-- WHY THIS CANNOT EMPTY THE APP
--
-- Measured, not assumed. There are zero null-organization_id rows in all
-- seventeen tables after the full chain and demo seed, and no migration
-- creates one. Removing the disjunct and re-counting every table as
-- demo@syncai.ca returned identical counts. `public` contains 270 tables and
-- zero views or materialized views, so there is no view-bypass surface. Every
-- supabase/functions caller uses the service role, which bypasses RLS
-- entirely, and no SECURITY INVOKER function reachable by `authenticated`
-- writes to any of these tables.
--
-- ---------------------------------------------------------------------------
-- PER-TABLE CHANGES
--
-- Bucket A — tenant data. `organization_id = app_current_org()`, no null
-- disjunct, and `for all` split into the commands the product actually issues.
-- Anything not listed is left to the service role.
--
--   SELECT only — no authenticated write site exists in src/:
--     asset_classes            no app reference; seeded WITH organization_id
--                              (00000000000004_demo_seed.sql:204), so it is
--                              tenant data despite the name. The global
--                              taxonomy is asset_ontology /
--                              oem_model_catalogue / asset_twin_templates.
--     asset_locations          no app reference; seeded with org (:213)
--     maintenance_metrics      no app reference; seeded with org (:305)
--     production_lines         no app reference; seeded with org (:403)
--     connectors               read at IntegrationsPage.tsx:59, which already
--                              filters on organization_id. Writes go through
--                              register_connector / begin_connector_run /
--                              finish_connector_run (SECURITY DEFINER).
--     oee_measurements         syncaiDataService.ts:160,182
--     oee_loss_events          syncaiDataService.ts:201
--     kpi_measurements         TacticalDashboard.tsx:81, StrategicDashboard.tsx:62,
--                              syncaiDataService.ts:117,128, dashboardServices.ts:230;
--                              written by billing-gainshare (service role)
--     asset_health_monitoring  AssetDetailPage.tsx:49, dashboardServices.ts:216;
--                              written by autonomous-orchestrator (service role)
--     asset_snapshots          BillingOverview.tsx:137; written by
--                              billing-invoice (service role)
--     backlog_snapshots        syncaiDataService.ts:252
--     audit_events             syncaiDataService.ts:354, governance.ts:77.
--                              SELECT only is deliberate: rows are written by
--                              accept_risk / run_control_audit / decide_* via
--                              SECURITY DEFINER, and an audit log a user can
--                              rewrite is not an audit log.
--     billing_subscriptions    UsageDashboard.tsx:56, BillingOverview.tsx:107.
--                              aws-marketplace.ts:100 and salesforce-license.ts:74
--                              look like writers but cannot be: they set
--                              tenant_id and filter on aws_customer_identifier /
--                              sf_license_id, and none of those columns exist on
--                              this table in any migration. Those paths already
--                              fail against the repository schema — schema
--                              drift, not a dependency of this policy.
--
--   SELECT + UPDATE:
--     system_alerts            acknowledge/resolve — dashboardServices.ts:383,395
--                              and AutonomousDashboard.tsx:158
--     notifications            mark-as-read — operatingLoopService.ts:1012
--
--   SELECT + INSERT:
--     deployment_instances     DeploymentConfiguratorPage.tsx:226, which sets
--                              organization_id explicitly, so the WITH CHECK
--                              is satisfied.
--
-- Bucket B — genuine shared reference data. NO CHANGE. These already carry
-- `for select to authenticated using (true)` with no write policy, so writes
-- are already service-role or migration only, and a tenant cannot mutate a
-- shared row or create a null-org one. The canonical shape for a table that
-- genuinely mixes global and tenant rows already exists and is unchanged here:
-- reliability_kb_chunks_read, `for select ... using (organization_id is null
-- or organization_id = app_current_org())`, read-only with no WITH CHECK.
--
-- Bucket B-violation — tables swept into the reference bucket at
-- 00000000000005_rls_hardening.sql:11-31 that hold no reference data. None has
-- an organization_id to scope by, so the correct grant is none: the `_read`
-- policy is dropped and access reverts to the service role.
--     tenants          id, name — the customer list. Every customer could
--                      enumerate every other customer's name. Zero read sites.
--     tenant_settings  per-customer config. One read site,
--                      OverviewDashboard.tsx:202, which selects
--                      autonomy_mode_default — a column that does not exist
--                      (the table has `settings jsonb`). It already returns
--                      nothing and is wrapped in try/catch.
--     trace_snapshots  full LLM traces, tool calls and cost data. Zero read sites.
--     sir_agents       agent roster
--     sir_events       event payloads
--     sir_queue        job payloads
--                      The only reader of the three sir_* tables is
--                      IntelligenceRuntimePanel.tsx, which has zero importers
--                      anywhere in src/.
--
-- Bucket C — child and user-scoped tables. Their policies are correct today
-- but only because 00000000000005_rls_hardening.sql ran exactly once. That
-- migration is not idempotent: its drop guard at :37 names
-- production_lines_read while :38 creates production_lines_org_rw, so a replay
-- aborts at :38 — after the catalog loop, before the child-table drops at :40.
-- Migration 2 unconditionally re-creates every `<t>_authed_rw`. Applying the
-- chain twice on a throwaway Postgres leaves exactly these six tables carrying
-- `using (true) with check (true)` alongside their tightened policy, and
-- permissive policies OR together, so the tightened one becomes decorative:
--
--     billing_invoices  connector_runs  user_kpi_dashboard
--     user_preferences  work_order_status_history  work_order_tasks
--
-- The drop guards in migrations 5 and 19 are fixed in this branch, but a
-- database that has already replayed is not helped by that. This migration
-- therefore re-asserts all six policies using the exact idiom of migration 5,
-- and sweeps every legacy `_authed_rw` and `_org_rw` policy name
-- unconditionally, so the chain converges on the correct state no matter how
-- many times it has been applied.
--
-- Bucket D — NOT TOUCHED. 00000000000023_enforce_approval_authority.sql
-- already re-expressed autonomous_decisions, autonomous_actions and
-- approval_workflows per-command with no null tolerance. That migration is the
-- model this one copies.
--
-- ---------------------------------------------------------------------------
-- EXPLICITLY DEFERRED — not guessed at here
--
--   research_programs, research_runs, research_results, promotion_candidates,
--   research_variants, llm_provider_events
--
-- These are SyncAI's own R&D benchmark results, promotion decisions and
-- provider telemetry, readable in full by every authenticated user of every
-- tenant. They belong with the bucket B-violation set above and were nearly
-- included. They are held back because the fix is not a tenancy fix: the
-- tables carry no organization_id, so scoping them requires an admin-role
-- predicate, and ResearchDashboard.tsx is a LIVE screen — imported at
-- App.tsx:31 and routed at App.tsx:488-494 behind AdminGate — that reads all
-- four research tables at :90, :95, :100, :121, :166. Dropping their read
-- policy would blank a shipped page for administrators. Choosing the right
-- predicate (app_current_role() = 'admin' versus a new capability) is a
-- product decision, and this migration does not make it. The exposure is
-- platform-internal rather than cross-tenant customer data, which is why
-- deferring is acceptable and the tenants/tenant_settings pair above is not.
--
--   provision_deployment (00000000000015_autonomous_deployment.sql:45)
--
-- Its authorization guard reads `inst.organization_id <> app_current_org()`.
-- When the instance's organization_id is NULL that comparison is NULL, the IF
-- is false, and the forbidden branch never fires. Removing the disjunct from
-- deployment_instances closes the route to creating such a row, so the
-- exploitable path is shut by this migration, but the guard is independently
-- wrong and should become `is distinct from`. Changing a SECURITY DEFINER
-- function body is a different review surface from a policy change and is left
-- to its own commit.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Retire the legacy policy names — BY NAME, on named tables only.
--
--    Emphatically NOT a wildcard sweep of pg_policies. `_org_rw` is also the
--    name migration 1 gives the 29 core tables (sites, assets, work_orders,
--    components, recommendations, …), and those policies are already correct —
--    `organization_id = app_current_org()`, no null disjunct. A pattern-matched
--    `drop policy ... like '%_org_rw'` removes them too, and because RLS stays
--    enabled a table with no policy denies everything: every core screen goes
--    blank for every signed-in user. That was measured, not theorised — an
--    earlier draft of this migration did exactly that and stripped 31 tables.
--
--    So the lists below are literal and closed. The `_authed_rw` list is
--    migration 2's `authed` array verbatim: migration 5 already drops each of
--    those, and repeating the drop here is a no-op that costs nothing and
--    keeps the retirement of that policy shape visible in one place.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  -- The seventeen tables carrying the defective org_rw expression: migration
  -- 2's org_scoped array (16) plus production_lines, which migration 5 gave
  -- the same expression by hand.
  foreach t in array array[
    'asset_classes','asset_locations','connectors','oee_measurements',
    'oee_loss_events','kpi_measurements','maintenance_metrics',
    'asset_health_monitoring','system_alerts','notifications','audit_events',
    'asset_snapshots','backlog_snapshots','deployment_instances',
    'billing_subscriptions','production_lines'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_org_rw', t);
  end loop;

  -- Migration 2's authed array. `using (true) with check (true)` on every one.
  foreach t in array array[
    'connector_runs','work_order_tasks','work_order_status_history',
    'kpi_definitions','kpis_kois','user_kpi_dashboard','autonomous_actions',
    'approval_workflows','research_programs','research_runs','research_results',
    'promotion_candidates','deployment_templates','tenants','tenant_settings',
    'user_preferences','billing_invoices','sir_agents','sir_events','sir_queue',
    'trace_snapshots'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_authed_rw', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Bucket A — read-only tenant data.
--
--    Simple column comparison against app_current_org(), which is a STABLE
--    SECURITY DEFINER single-row lookup on user_profiles by primary key. No
--    correlated EXISTS, no join table, so there is no starvation risk of the
--    kind an inline EXISTS against a membership table would create.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'asset_classes','asset_locations','connectors','oee_measurements',
    'oee_loss_events','kpi_measurements','maintenance_metrics',
    'asset_health_monitoring','asset_snapshots','backlog_snapshots',
    'audit_events','billing_subscriptions','production_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_org_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using (organization_id = app_current_org())',
      t || '_org_read', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Bucket A — SELECT + UPDATE.
--
--    The WITH CHECK repeats the org predicate so an UPDATE cannot move a row
--    out of the tenant. That is the specific hole closed here: without it,
--    `set organization_id = null` was a one-statement tenant-data export.
-- ---------------------------------------------------------------------------
drop policy if exists system_alerts_org_read on public.system_alerts;
create policy system_alerts_org_read on public.system_alerts
  for select to authenticated
  using (organization_id = app_current_org());

drop policy if exists system_alerts_org_update on public.system_alerts;
create policy system_alerts_org_update on public.system_alerts
  for update to authenticated
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());

drop policy if exists notifications_org_read on public.notifications;
create policy notifications_org_read on public.notifications
  for select to authenticated
  using (organization_id = app_current_org());

drop policy if exists notifications_org_update on public.notifications;
create policy notifications_org_update on public.notifications
  for update to authenticated
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 3. Bucket A — SELECT + INSERT.
-- ---------------------------------------------------------------------------
drop policy if exists deployment_instances_org_read on public.deployment_instances;
create policy deployment_instances_org_read on public.deployment_instances
  for select to authenticated
  using (organization_id = app_current_org());

drop policy if exists deployment_instances_org_insert on public.deployment_instances;
create policy deployment_instances_org_insert on public.deployment_instances
  for insert to authenticated
  with check (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 4. Bucket B-violation — platform-internal tables, service role only.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants','tenant_settings','trace_snapshots',
    'sir_agents','sir_events','sir_queue'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Bucket C — re-assert migration 5's policies so a replayed chain converges.
--
--    Verbatim the idiom of 00000000000005_rls_hardening.sql:41-85, including
--    the policy names, so this is a re-assertion and not a second dialect.
--
--    The EXISTS lookups seek the parent by primary key — connectors.id,
--    work_orders.id, billing_subscriptions.id — all of which are indexed by
--    their PK constraint, so each check is a single index probe rather than a
--    scan. That is why an EXISTS is acceptable here and a column comparison is
--    used everywhere else: these six tables have no usable organization_id of
--    their own. (connector_runs and work_order_tasks did acquire an
--    organization_id column later, from the ingestion-contract work, but their
--    policies deliberately continue to ignore it — switching predicate would
--    change which rows are visible, which is not this migration's business.)
-- ---------------------------------------------------------------------------
drop policy if exists connector_runs_parent_org on public.connector_runs;
create policy connector_runs_parent_org on public.connector_runs
  for all to authenticated
  using (exists (select 1 from connectors c where c.id = connector_id and c.organization_id = app_current_org()))
  with check (exists (select 1 from connectors c where c.id = connector_id and c.organization_id = app_current_org()));

drop policy if exists work_order_tasks_parent_org on public.work_order_tasks;
create policy work_order_tasks_parent_org on public.work_order_tasks
  for all to authenticated
  using (exists (select 1 from work_orders w where w.id = work_order_id and w.organization_id = app_current_org()))
  with check (exists (select 1 from work_orders w where w.id = work_order_id and w.organization_id = app_current_org()));

drop policy if exists work_order_status_history_parent_org on public.work_order_status_history;
create policy work_order_status_history_parent_org on public.work_order_status_history
  for all to authenticated
  using (exists (select 1 from work_orders w where w.id = work_order_id and w.organization_id = app_current_org()))
  with check (exists (select 1 from work_orders w where w.id = work_order_id and w.organization_id = app_current_org()));

drop policy if exists billing_invoices_parent_org on public.billing_invoices;
create policy billing_invoices_parent_org on public.billing_invoices
  for select to authenticated
  using (exists (select 1 from billing_subscriptions s where s.id = subscription_id and s.organization_id = app_current_org()));

drop policy if exists user_kpi_dashboard_own on public.user_kpi_dashboard;
create policy user_kpi_dashboard_own on public.user_kpi_dashboard
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
