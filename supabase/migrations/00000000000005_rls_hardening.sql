-- ============================================================================
-- RLS hardening — clears all "RLS Policy Always True" security-advisor lints.
--
-- Catalog/reference tables: SELECT-only for authenticated users; writes happen
-- via service role (bypasses RLS) or migrations.
-- Child transaction tables: writes scoped through the parent row's
-- organization_id; user-scoped tables keyed to auth.uid().
-- ============================================================================

-- ---- Catalog / reference: read-only for authenticated ----------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'kpi_definitions','kpis_kois','kpi_packs','industry_asset_libraries',
    'industry_criticality_profiles','industry_governance_profiles',
    'industry_failure_mode_packs','industry_oee_models','oee_loss_categories',
    'production_lines','deployment_templates','tenants','tenant_settings',
    'sir_agents','sir_events','sir_queue','trace_snapshots',
    'research_programs','research_variants','research_runs','research_results',
    'promotion_candidates'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_authed_rw', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_read', t
    );
  end loop;
end $$;

-- production_lines carries organization_id → org-scoped read/write instead.
drop policy if exists production_lines_read on production_lines;
create policy production_lines_org_rw on production_lines
  for all to authenticated
  using (organization_id is null or organization_id = app_current_org())
  with check (organization_id is null or organization_id = app_current_org());

-- ---- Child tables: scope through parent organization_id --------------------
drop policy if exists connector_runs_authed_rw on connector_runs;
create policy connector_runs_parent_org on connector_runs
  for all to authenticated
  using (exists (select 1 from connectors c where c.id = connector_id and c.organization_id = app_current_org()))
  with check (exists (select 1 from connectors c where c.id = connector_id and c.organization_id = app_current_org()));

drop policy if exists work_order_tasks_authed_rw on work_order_tasks;
create policy work_order_tasks_parent_org on work_order_tasks
  for all to authenticated
  using (exists (select 1 from work_orders w where w.id = work_order_id and w.organization_id = app_current_org()))
  with check (exists (select 1 from work_orders w where w.id = work_order_id and w.organization_id = app_current_org()));

drop policy if exists work_order_status_history_authed_rw on work_order_status_history;
create policy work_order_status_history_parent_org on work_order_status_history
  for all to authenticated
  using (exists (select 1 from work_orders w where w.id = work_order_id and w.organization_id = app_current_org()))
  with check (exists (select 1 from work_orders w where w.id = work_order_id and w.organization_id = app_current_org()));

drop policy if exists autonomous_actions_authed_rw on autonomous_actions;
create policy autonomous_actions_parent_org on autonomous_actions
  for all to authenticated
  using (exists (select 1 from autonomous_decisions d where d.id = decision_id and d.organization_id = app_current_org()))
  with check (exists (select 1 from autonomous_decisions d where d.id = decision_id and d.organization_id = app_current_org()));

drop policy if exists approval_workflows_authed_rw on approval_workflows;
create policy approval_workflows_parent_org on approval_workflows
  for all to authenticated
  using (exists (select 1 from autonomous_decisions d where d.id = decision_id and d.organization_id = app_current_org()))
  with check (exists (select 1 from autonomous_decisions d where d.id = decision_id and d.organization_id = app_current_org()));

drop policy if exists billing_invoices_authed_rw on billing_invoices;
create policy billing_invoices_parent_org on billing_invoices
  for select to authenticated
  using (exists (select 1 from billing_subscriptions s where s.id = subscription_id and s.organization_id = app_current_org()));

-- ---- User-scoped tables ------------------------------------------------------
drop policy if exists user_kpi_dashboard_authed_rw on user_kpi_dashboard;
create policy user_kpi_dashboard_own on user_kpi_dashboard
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_preferences_authed_rw on user_preferences;
create policy user_preferences_own on user_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
