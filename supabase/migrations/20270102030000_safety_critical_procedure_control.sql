-- C5.14 — governed alteration of safety-critical procedures.
--
-- Canonical reuse only:
--   * standard_work + procedure_translations remain the procedure/version model;
--   * engineering_approval_rules remains the change-class/competence vocabulary;
--   * approvals remains the decision record;
--   * decision_rights remains the policy-as-code declaration;
--   * audit_events remains the immutable operating trace.
-- No second procedure, approval, workflow, queue, or audit store is created.

alter table public.standard_work
  add column if not exists safety_critical boolean not null default false,
  add column if not exists engineering_change_class text;

alter table public.standard_work
  drop constraint if exists standard_work_safety_classification_complete;
alter table public.standard_work
  add constraint standard_work_safety_classification_complete check (
    (safety_critical is false and engineering_change_class is null)
    or
    (safety_critical is true
      and engineering_change_class = 'safety_critical_procedure_change')
  );

alter table public.standard_work
  drop constraint if exists standard_work_engineering_change_rule_fkey;
alter table public.standard_work
  add constraint standard_work_engineering_change_rule_fkey
  foreign key (organization_id, engineering_change_class)
  references public.engineering_approval_rules(organization_id, change_class)
  on delete restrict;

insert into public.engineering_approval_rules
  (organization_id, change_class, title, required_role, basis, status, register_ref)
select o.id,
       'safety_critical_procedure_change',
       'Alter a safety-critical procedure',
       'admin',
       'C5.14: a declared safety-critical procedure alteration requires an independent named-human designated safety authority to review the exact version, evidence basis and applicability before adoption.',
       'adopted',
       'C5.14'
from public.organizations o
on conflict (organization_id, change_class) do nothing;

update public.decision_rights
set enforcement = 'enforced', required_authority = 'admin'
where right_key = 'alter_safety_procedures'
  and tier = 'approval';

-- Classification is monotonic. The safety-specific request wrappers set a
-- transaction-local marker before calling the existing canonical request
-- functions. A generic request cannot revise a previously classified safety
-- procedure, and neither a client write nor a later revision can downgrade it.
create or replace function public.guard_safety_critical_standard_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prior public.standard_work%rowtype;
  marker text := coalesce(current_setting('syncai.safety_procedure_write', true), '');
begin
  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'UPDATE' and (
    new.safety_critical is distinct from old.safety_critical
    or new.engineering_change_class is distinct from old.engineering_change_class
  ) then
    if marker <> 'on'
       or auth.uid() is null
       or new.organization_id is distinct from public.app_current_org()
       or new.revision_requested_by is distinct from auth.uid() then
      raise exception 'Direct classification write refused; use the governed safety-critical procedure request';
    end if;
    if old.safety_critical
       or new.safety_critical is distinct from true
       or new.engineering_change_class is distinct from 'safety_critical_procedure_change' then
      raise exception 'Safety classification cannot be downgraded or rewritten';
    end if;
  end if;

  if new.previous_standard_work_id is not null then
    select * into prior
    from public.standard_work
    where id = new.previous_standard_work_id
      and organization_id = new.organization_id
    for share;
    if not found then
      raise exception 'Safety classification requires the same-tenant prior standard';
    end if;
    if prior.safety_critical and not new.safety_critical and marker <> 'on' then
      raise exception 'A generic door cannot revise a classified safety-critical procedure; use the governed safety-critical request';
    end if;
    if prior.safety_critical
       and new.engineering_change_class is not null
       and new.engineering_change_class is distinct from prior.engineering_change_class then
      raise exception 'Safety classification cannot be downgraded or changed to another class';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.safety_critical and (
      marker <> 'on'
      or auth.uid() is null
      or new.organization_id is distinct from public.app_current_org()
      or new.revision_requested_by is distinct from auth.uid()
    ) then
      raise exception 'Safety-critical procedure classification requires the governed named-human same-tenant request';
    end if;
    return new;
  end if;

  return new;
end $$;

revoke all on function public.guard_safety_critical_standard_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists safety_critical_standard_revision_guard
  on public.standard_work;
create trigger safety_critical_standard_revision_guard
before insert or update or delete on public.standard_work
for each row execute function public.guard_safety_critical_standard_revision();

create or replace function public.request_safety_critical_project_standard_revision(
  p_verification_id uuid,
  p_previous_id bigint,
  p_language text,
  p_content text,
  p_change_summary text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v_rule public.engineering_approval_rules%rowtype;
  v_right public.decision_rights%rowtype;
  v_result jsonb;
  v_revision_id bigint;
  v_approval_id uuid;
begin
  select role into v_role from public.user_profiles
  where id = v_actor and organization_id = v_org;
  if v_actor is null or v_org is null or coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error', 'A named same-tenant human must request the safety-critical procedure alteration');
  end if;
  select * into v_rule from public.engineering_approval_rules
  where organization_id = v_org
    and change_class = 'safety_critical_procedure_change'
    and status = 'adopted';
  select * into v_right from public.decision_rights
  where right_key = 'alter_safety_procedures'
    and tier = 'approval'
    and enforcement = 'enforced';
  if v_rule.id is null or v_right.right_key is null
     or v_rule.required_role is distinct from v_right.required_authority then
    return jsonb_build_object('error', 'The adopted safety-procedure rule and enforced decision right must agree before a change can be requested');
  end if;

  perform set_config('syncai.safety_procedure_write', 'on', true);
  v_result := public.request_project_standard_revision(
    p_verification_id, p_previous_id, p_language, p_content,
    p_change_summary, p_basis
  );
  if v_result ? 'error' then
    perform set_config('syncai.safety_procedure_write', '', true);
    return v_result;
  end if;
  v_revision_id := (v_result->>'revisionId')::bigint;
  v_approval_id := (v_result->>'approvalId')::uuid;

  update public.standard_work
  set safety_critical = true,
      engineering_change_class = v_rule.change_class
  where id = v_revision_id
    and organization_id = v_org
    and revision_requested_by = v_actor;
  if not found then
    raise exception 'Safety-critical revision receipt did not resolve to the named requester';
  end if;

  perform set_config('syncai.standard_revision_decision', '1', true);
  update public.approvals
  set owner_role = v_rule.required_role,
      required_validation = 'Designated safety authority must review the exact changed procedure, source evidence, applicability, protective-system and permit effects, and requester separation before adoption.',
      approval_scope = coalesce(approval_scope, '{}'::jsonb) || jsonb_build_object(
        'engineeringChangeClass', v_rule.change_class,
        'engineeringRuleId', v_rule.id,
        'requiredAuthority', v_rule.required_role
      )
  where id = v_approval_id
    and organization_id = v_org
    and standard_work_revision_id = v_revision_id
    and status in ('required', 'pending');
  perform set_config('syncai.standard_revision_decision', '', true);
  perform set_config('syncai.safety_procedure_write', '', true);

  insert into public.audit_events
    (organization_id, entity_type, actor, event_data, new_state)
  values (
    v_org, 'safety_procedure_change', v_role,
    jsonb_build_object(
      'action', 'requested', 'actorId', v_actor,
      'revisionId', v_revision_id, 'approvalId', v_approval_id,
      'engineeringRuleId', v_rule.id, 'sourceKind', 'project_corrective_action'
    ),
    jsonb_build_object(
      'status', 'draft', 'safetyCritical', true,
      'engineeringChangeClass', v_rule.change_class,
      'requiredAuthority', v_rule.required_role
    )
  );
  return v_result || jsonb_build_object(
    'safetyCritical', true,
    'engineeringChangeClass', v_rule.change_class,
    'requiredAuthority', v_rule.required_role
  );
end $$;

revoke all on function public.request_safety_critical_project_standard_revision(
  uuid, bigint, text, text, text, text
) from public, anon, service_role;
grant execute on function public.request_safety_critical_project_standard_revision(
  uuid, bigint, text, text, text, text
) to authenticated;

create or replace function public.request_safety_critical_learning_standard_revision(
  p_observation_id uuid,
  p_content text,
  p_change_summary text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v_rule public.engineering_approval_rules%rowtype;
  v_right public.decision_rights%rowtype;
  v_result jsonb;
  v_revision_id bigint;
  v_approval_id uuid;
begin
  select role into v_role from public.user_profiles
  where id = v_actor and organization_id = v_org;
  if v_actor is null or v_org is null or coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error', 'A named same-tenant human must request the safety-critical procedure alteration');
  end if;
  select * into v_rule from public.engineering_approval_rules
  where organization_id = v_org
    and change_class = 'safety_critical_procedure_change'
    and status = 'adopted';
  select * into v_right from public.decision_rights
  where right_key = 'alter_safety_procedures'
    and tier = 'approval'
    and enforcement = 'enforced';
  if v_rule.id is null or v_right.right_key is null
     or v_rule.required_role is distinct from v_right.required_authority then
    return jsonb_build_object('error', 'The adopted safety-procedure rule and enforced decision right must agree before a change can be requested');
  end if;

  perform set_config('syncai.safety_procedure_write', 'on', true);
  v_result := public.request_learning_standard_revision(
    p_observation_id, p_content, p_change_summary, p_basis
  );
  if v_result ? 'error' then
    perform set_config('syncai.safety_procedure_write', '', true);
    return v_result;
  end if;
  v_revision_id := (v_result->>'revisionId')::bigint;
  v_approval_id := (v_result->>'approvalId')::uuid;

  update public.standard_work
  set safety_critical = true,
      engineering_change_class = v_rule.change_class
  where id = v_revision_id
    and organization_id = v_org
    and revision_requested_by = v_actor;
  if not found then
    raise exception 'Safety-critical revision receipt did not resolve to the named requester';
  end if;

  perform set_config('syncai.standard_revision_decision', '1', true);
  update public.approvals
  set owner_role = v_rule.required_role,
      required_validation = 'Designated safety authority must review the exact changed procedure, source evidence, applicability, protective-system and permit effects, and requester separation before adoption.',
      approval_scope = coalesce(approval_scope, '{}'::jsonb) || jsonb_build_object(
        'engineeringChangeClass', v_rule.change_class,
        'engineeringRuleId', v_rule.id,
        'requiredAuthority', v_rule.required_role
      )
  where id = v_approval_id
    and organization_id = v_org
    and standard_work_revision_id = v_revision_id
    and status in ('required', 'pending');
  perform set_config('syncai.standard_revision_decision', '', true);
  perform set_config('syncai.safety_procedure_write', '', true);

  insert into public.audit_events
    (organization_id, entity_type, actor, event_data, new_state)
  values (
    v_org, 'safety_procedure_change', v_role,
    jsonb_build_object(
      'action', 'requested', 'actorId', v_actor,
      'revisionId', v_revision_id, 'approvalId', v_approval_id,
      'engineeringRuleId', v_rule.id, 'sourceKind', 'standard_work_observation'
    ),
    jsonb_build_object(
      'status', 'draft', 'safetyCritical', true,
      'engineeringChangeClass', v_rule.change_class,
      'requiredAuthority', v_rule.required_role
    )
  );
  return v_result || jsonb_build_object(
    'safetyCritical', true,
    'engineeringChangeClass', v_rule.change_class,
    'requiredAuthority', v_rule.required_role
  );
end $$;

revoke all on function public.request_safety_critical_learning_standard_revision(
  uuid, text, text, text
) from public, anon, service_role;
grant execute on function public.request_safety_critical_learning_standard_revision(
  uuid, text, text, text
) to authenticated;

-- Strengthen the one canonical standard-revision approval trigger. Both the
-- project and learning adoption functions already set the decision marker and
-- requester separation; this adds the exact C5.14 rule/right/role gate and a
-- procedure-specific audit receipt before either function can verify content.
create or replace function public.guard_standard_revision_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.standard_work%rowtype;
  e public.engineering_approval_rules%rowtype;
  d public.decision_rights%rowtype;
  v_role text;
begin
  if old.standard_work_revision_id is not null then
    if new.standard_work_revision_id is distinct from old.standard_work_revision_id
       or new.organization_id is distinct from old.organization_id then
      raise exception 'Standard revision approval identity is immutable';
    end if;
    if new is distinct from old
       and current_setting('syncai.standard_revision_decision', true) is distinct from '1' then
      raise exception 'Use the governed standard revision decision';
    end if;

    select * into r from public.standard_work
    where id = old.standard_work_revision_id
      and organization_id = old.organization_id
    for share;
    if r.safety_critical and new.status is distinct from old.status then
      if new.status not in ('approved', 'rejected') then
        raise exception 'Safety-critical procedure decisions may only approve or reject the exact revision';
      end if;
      select * into e from public.engineering_approval_rules
      where organization_id = old.organization_id
        and change_class = r.engineering_change_class
        and status = 'adopted';
      select * into d from public.decision_rights
      where right_key = 'alter_safety_procedures'
        and tier = 'approval'
        and enforcement = 'enforced';
      select role into v_role from public.user_profiles
      where id = new.approver_user_id
        and organization_id = old.organization_id;
      if e.id is null or d.right_key is null
         or e.required_role is distinct from d.required_authority
         or new.owner_role is distinct from e.required_role then
        raise exception 'Safety-critical procedure adoption requires its adopted engineering rule and enforced decision right';
      end if;
      if new.approver_user_id is null
         or coalesce(v_role, '') = 'ai_admin'
         or v_role is distinct from e.required_role then
        raise exception 'A named same-tenant designated safety authority is required';
      end if;
      if r.revision_requested_by = new.approver_user_id then
        raise exception 'The safety-critical procedure requester cannot decide their own alteration';
      end if;
      new.approval_scope := coalesce(new.approval_scope, '{}'::jsonb)
        || jsonb_build_object(
          'engineeringChangeClass', e.change_class,
          'engineeringRuleId', e.id,
          'requiredAuthority', e.required_role,
          'safetyCritical', true
        );
      insert into public.audit_events
        (organization_id, entity_type, actor, event_data, new_state)
      values (
        old.organization_id, 'safety_procedure_decision', v_role,
        jsonb_build_object(
          'action', new.status, 'actorId', new.approver_user_id,
          'revisionId', r.id, 'approvalId', old.id,
          'requesterId', r.revision_requested_by,
          'engineeringRuleId', e.id
        ),
        jsonb_build_object(
          'status', new.status, 'safetyCritical', true,
          'engineeringChangeClass', e.change_class,
          'requiredAuthority', e.required_role
        )
      );
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_standard_revision_approval()
  from public, anon, authenticated, service_role;

comment on function public.request_safety_critical_project_standard_revision(
  uuid, bigint, text, text, text, text
) is 'C5.14 governed project-corrective-action request. Creates a draft only; a separate designated safety authority must decide adoption.';
comment on function public.request_safety_critical_learning_standard_revision(
  uuid, text, text, text
) is 'C5.14 governed observed-learning request. Creates a draft only; a separate designated safety authority must decide adoption.';

notify pgrst, 'reload schema';
