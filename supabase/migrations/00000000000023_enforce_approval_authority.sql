-- ============================================================================
-- Enforce approval authority at the database boundary.
--
-- Organization members retain read access. Direct approval mutations require
-- the database-owned role predicate introduced in migration 22. Autonomous
-- action records remain readable in scope but writable only by trusted service
-- paths that bypass RLS.
-- ============================================================================

-- Core operating-loop approval records.
drop policy if exists approvals_org_rw on public.approvals;
drop policy if exists approvals_org_read on public.approvals;
drop policy if exists approvals_authority_update on public.approvals;

create policy approvals_org_read on public.approvals
  for select to authenticated
  using (organization_id = public.app_current_org());

create policy approvals_authority_update on public.approvals
  for update to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_approval_authority()
  )
  with check (
    organization_id = public.app_current_org()
    and public.app_has_approval_authority()
  );

-- Compatibility decision/workflow/action tables evolved from organization_id
-- to also carry tenant_id. Build the policy expression from the columns that
-- exist so clean databases and upgraded databases converge safely.
do $$
declare
  decision_scope text;
  parent_scope text;
  has_org boolean;
  has_tenant boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'autonomous_decisions'
      and column_name = 'organization_id'
  ) into has_org;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'autonomous_decisions'
      and column_name = 'tenant_id'
  ) into has_tenant;

  if has_org and has_tenant then
    decision_scope := '(organization_id = public.app_current_org() or tenant_id = public.app_current_org())';
    parent_scope := '(d.organization_id = public.app_current_org() or d.tenant_id = public.app_current_org())';
  elsif has_tenant then
    decision_scope := 'tenant_id = public.app_current_org()';
    parent_scope := 'd.tenant_id = public.app_current_org()';
  elsif has_org then
    decision_scope := 'organization_id = public.app_current_org()';
    parent_scope := 'd.organization_id = public.app_current_org()';
  else
    raise exception 'autonomous_decisions has no organization scope column';
  end if;

  execute 'alter table public.autonomous_decisions enable row level security';
  execute 'drop policy if exists autonomous_decisions_org_rw on public.autonomous_decisions';
  execute 'drop policy if exists autonomous_decisions_org_read on public.autonomous_decisions';
  execute 'drop policy if exists autonomous_decisions_authority_update on public.autonomous_decisions';
  execute format(
    'create policy autonomous_decisions_org_read on public.autonomous_decisions for select to authenticated using (%s)',
    decision_scope
  );
  execute format(
    'create policy autonomous_decisions_authority_update on public.autonomous_decisions for update to authenticated using ((%s) and public.app_has_approval_authority()) with check ((%s) and public.app_has_approval_authority())',
    decision_scope,
    decision_scope
  );

  execute 'alter table public.approval_workflows enable row level security';
  execute 'drop policy if exists approval_workflows_authed_rw on public.approval_workflows';
  execute 'drop policy if exists approval_workflows_parent_org on public.approval_workflows';
  execute 'drop policy if exists approval_workflows_org_read on public.approval_workflows';
  execute 'drop policy if exists approval_workflows_authority_update on public.approval_workflows';
  execute format(
    'create policy approval_workflows_org_read on public.approval_workflows for select to authenticated using (exists (select 1 from public.autonomous_decisions d where d.id = decision_id and %s))',
    parent_scope
  );
  execute format(
    'create policy approval_workflows_authority_update on public.approval_workflows for update to authenticated using (public.app_has_approval_authority() and exists (select 1 from public.autonomous_decisions d where d.id = decision_id and %s)) with check (public.app_has_approval_authority() and exists (select 1 from public.autonomous_decisions d where d.id = decision_id and %s))',
    parent_scope,
    parent_scope
  );

  execute 'alter table public.autonomous_actions enable row level security';
  execute 'drop policy if exists autonomous_actions_authed_rw on public.autonomous_actions';
  execute 'drop policy if exists autonomous_actions_parent_org on public.autonomous_actions';
  execute 'drop policy if exists autonomous_actions_org_read on public.autonomous_actions';
  execute format(
    'create policy autonomous_actions_org_read on public.autonomous_actions for select to authenticated using (exists (select 1 from public.autonomous_decisions d where d.id = decision_id and %s))',
    parent_scope
  );
end
$$;
