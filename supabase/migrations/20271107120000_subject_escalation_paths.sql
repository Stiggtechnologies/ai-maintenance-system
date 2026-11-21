-- E4.07 Escalation paths.
--
-- Authority limits already name escalates_to_role when an approval is refused.
-- What was missing is a path for an overdue or blocked decision, work order
-- or condition alert, and a named on-call holder when that path is an incident.
--
-- Canonical reuse:
--   decisions.decision_required_date, approval_status and outcome_status
--   work_orders.due_date, status and completed_at
--   condition_alerts.triggered_at, cleared_at and work_order_id
--   authority_limits.role_key as the only escalation target vocabulary
--   user_profiles for the named human and the role they actually hold
--   audit_events as the one ledger
--
-- These tables are the path record. They are not a second work queue, approval
-- store or alert register. Raising and acknowledging do not approve a
-- decision, release work, clear an alert or grant authority.
--
-- The 1..8760 hour bound on an overdue-alert rule is a storage validity
-- ceiling so a tenant commitment cannot be written as a multi-year interval
-- by mistake. It is not an alarm standard and SyncAI does not supply the
-- window. Decisions and work become overdue only from their own recorded dates.

create table public.escalation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_key text not null,
  version integer not null check (version > 0),
  subject_kind text not null check (subject_kind in ('decision','work_order','condition_alert')),
  condition_kind text not null check (condition_kind in ('overdue','blocked')),
  incident_path boolean not null,
  response_window_hours integer,
  escalates_to_role text not null,
  basis text not null,
  status text not null default 'draft' check (status in ('draft','adopted','retired')),
  proposed_by uuid not null references auth.users(id),
  proposed_at timestamptz not null default now(),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  adoption_note text,
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  retirement_note text,
  supersedes_id uuid references public.escalation_rules(id),
  created_at timestamptz not null default now(),
  constraint escalation_rules_key_shape check (rule_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint escalation_rules_basis_length check (length(btrim(basis)) between 20 and 4000),
  constraint escalation_rules_role_shape check (escalates_to_role ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint escalation_rules_window_shape check (
    (subject_kind = 'condition_alert' and condition_kind = 'overdue'
      and response_window_hours between 1 and 8760)
    or (not (subject_kind = 'condition_alert' and condition_kind = 'overdue')
      and response_window_hours is null)),
  constraint escalation_rules_status_shape check (
    (status = 'draft'
      and adopted_by is null and adopted_at is null and adoption_note is null
      and retired_by is null and retired_at is null and retirement_note is null)
    or (status = 'adopted'
      and adopted_by is not null and adopted_at is not null
      and length(btrim(adoption_note)) between 20 and 4000
      and retired_by is null and retired_at is null and retirement_note is null)
    or (status = 'retired'
      and retired_by is not null and retired_at is not null
      and length(btrim(retirement_note)) between 20 and 4000)),
  unique (organization_id, rule_key, version)
);

create unique index escalation_rules_one_draft
  on public.escalation_rules(organization_id, rule_key)
  where status = 'draft';
create unique index escalation_rules_one_adopted_condition
  on public.escalation_rules(organization_id, subject_kind, condition_kind)
  where status = 'adopted';
create index escalation_rules_org_status
  on public.escalation_rules(organization_id, status, proposed_at desc);

create table public.on_call_duties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_key text not null,
  user_id uuid not null references auth.users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  basis text not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  ended_early_by uuid references auth.users(id),
  ended_early_at timestamptz,
  end_note text,
  constraint on_call_duties_window check (ends_at > starts_at),
  constraint on_call_duties_role_shape check (role_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint on_call_duties_basis_length check (length(btrim(basis)) between 20 and 4000),
  constraint on_call_duties_end_shape check (
    (ended_early_at is null and ended_early_by is null and end_note is null)
    or (ended_early_at is not null and ended_early_by is not null
      and length(btrim(end_note)) between 20 and 4000))
);

create index on_call_duties_cover
  on public.on_call_duties(organization_id, role_key, starts_at desc);

create table public.escalation_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null references public.escalation_rules(id),
  subject_kind text not null check (subject_kind in ('decision','work_order','condition_alert')),
  subject_id uuid not null,
  condition_kind text not null check (condition_kind in ('overdue','blocked')),
  incident_path boolean not null,
  escalates_to_role text not null,
  response_window_hours integer,
  subject_due_on date,
  subject_due_at timestamptz,
  linked_work_order_id uuid,
  state_basis text not null,
  on_call_duty_id uuid references public.on_call_duties(id),
  on_call_user_id uuid references auth.users(id),
  raise_note text not null,
  raised_by uuid not null references auth.users(id),
  raised_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','acknowledged','withdrawn')),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  acknowledgement_note text,
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  withdrawal_note text,
  constraint escalation_records_basis_length check (length(btrim(state_basis)) between 20 and 4000),
  constraint escalation_records_note_length check (length(btrim(raise_note)) between 20 and 4000),
  constraint escalation_records_window_shape check (
    (subject_kind = 'condition_alert' and condition_kind = 'overdue'
      and response_window_hours between 1 and 8760)
    or (not (subject_kind = 'condition_alert' and condition_kind = 'overdue')
      and response_window_hours is null)),
  constraint escalation_records_incident_on_call check (
    incident_path = false or (on_call_duty_id is not null and on_call_user_id is not null)),
  constraint escalation_records_ack_shape check (
    (status <> 'acknowledged'
      and acknowledged_by is null and acknowledged_at is null and acknowledgement_note is null)
    or (status = 'acknowledged'
      and acknowledged_by is not null and acknowledged_at is not null
      and length(btrim(acknowledgement_note)) between 20 and 4000
      and withdrawn_by is null)),
  constraint escalation_records_withdraw_shape check (
    (status <> 'withdrawn'
      and withdrawn_by is null and withdrawn_at is null and withdrawal_note is null)
    or (status = 'withdrawn'
      and withdrawn_by is not null and withdrawn_at is not null
      and length(btrim(withdrawal_note)) between 20 and 4000
      and acknowledged_by is null))
);

create unique index escalation_records_one_open
  on public.escalation_records(organization_id, subject_kind, subject_id, condition_kind)
  where status = 'open';
create index escalation_records_org_status
  on public.escalation_records(organization_id, status, raised_at desc);

alter table public.escalation_rules enable row level security;
alter table public.on_call_duties enable row level security;
alter table public.escalation_records enable row level security;

drop policy if exists escalation_rules_read on public.escalation_rules;
create policy escalation_rules_read on public.escalation_rules
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists on_call_duties_read on public.on_call_duties;
create policy on_call_duties_read on public.on_call_duties
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists escalation_records_read on public.escalation_records;
create policy escalation_records_read on public.escalation_records
  for select to authenticated using (organization_id = public.app_current_org());

revoke all on public.escalation_rules from public, anon, authenticated;
revoke all on public.on_call_duties from public, anon, authenticated;
revoke all on public.escalation_records from public, anon, authenticated;
grant select on public.escalation_rules to authenticated;
grant select on public.on_call_duties to authenticated;
grant select on public.escalation_records to authenticated;
revoke truncate on public.escalation_rules from public, anon, authenticated, service_role;
revoke truncate on public.on_call_duties from public, anon, authenticated, service_role;
revoke truncate on public.escalation_records from public, anon, authenticated, service_role;

create or replace function public.escalation_paths_locked()
returns trigger
language plpgsql
set search_path = public
as $esc$
begin
  if current_setting('app.escalation_path_write', true) is distinct from 'granted' then
    raise exception 'escalation paths are written only through the governed doors'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'escalation paths are retained; withdraw a record or retire a rule instead of deleting'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'escalation_rules' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.rule_key is distinct from old.rule_key
       or new.version is distinct from old.version
       or new.subject_kind is distinct from old.subject_kind
       or new.condition_kind is distinct from old.condition_kind
       or new.incident_path is distinct from old.incident_path
       or new.response_window_hours is distinct from old.response_window_hours
       or new.escalates_to_role is distinct from old.escalates_to_role
       or new.basis is distinct from old.basis
       or new.proposed_by is distinct from old.proposed_by
       or new.proposed_at is distinct from old.proposed_at then
      raise exception 'escalation rule terms are immutable; adopt, retire or propose a new version'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'on_call_duties' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.role_key is distinct from old.role_key
       or new.user_id is distinct from old.user_id
       or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.basis is distinct from old.basis
       or new.recorded_by is distinct from old.recorded_by
       or new.recorded_at is distinct from old.recorded_at then
      raise exception 'an on-call duty can only be ended, not rewritten'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'escalation_records' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.rule_id is distinct from old.rule_id
       or new.subject_kind is distinct from old.subject_kind
       or new.subject_id is distinct from old.subject_id
       or new.condition_kind is distinct from old.condition_kind
       or new.incident_path is distinct from old.incident_path
       or new.escalates_to_role is distinct from old.escalates_to_role
       or new.response_window_hours is distinct from old.response_window_hours
       or new.subject_due_on is distinct from old.subject_due_on
       or new.subject_due_at is distinct from old.subject_due_at
       or new.linked_work_order_id is distinct from old.linked_work_order_id
       or new.state_basis is distinct from old.state_basis
       or new.on_call_duty_id is distinct from old.on_call_duty_id
       or new.on_call_user_id is distinct from old.on_call_user_id
       or new.raise_note is distinct from old.raise_note
       or new.raised_by is distinct from old.raised_by
       or new.raised_at is distinct from old.raised_at then
      raise exception 'an escalation record can only be acknowledged or withdrawn'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$esc$;

create or replace function public.escalation_paths_no_truncate()
returns trigger
language plpgsql
set search_path = public
as $esc$
begin
  raise exception 'escalation paths cannot be truncated'
    using errcode = 'insufficient_privilege';
end
$esc$;

revoke all on function public.escalation_paths_locked() from public, anon, authenticated;
revoke all on function public.escalation_paths_no_truncate() from public, anon, authenticated;

drop trigger if exists escalation_rules_locked on public.escalation_rules;
create trigger escalation_rules_locked
  before insert or update or delete on public.escalation_rules
  for each row execute function public.escalation_paths_locked();
drop trigger if exists on_call_duties_locked on public.on_call_duties;
create trigger on_call_duties_locked
  before insert or update or delete on public.on_call_duties
  for each row execute function public.escalation_paths_locked();
drop trigger if exists escalation_records_locked on public.escalation_records;
create trigger escalation_records_locked
  before insert or update or delete on public.escalation_records
  for each row execute function public.escalation_paths_locked();

drop trigger if exists escalation_rules_no_truncate on public.escalation_rules;
create trigger escalation_rules_no_truncate
  before truncate on public.escalation_rules
  for each statement execute function public.escalation_paths_no_truncate();
drop trigger if exists on_call_duties_no_truncate on public.on_call_duties;
create trigger on_call_duties_no_truncate
  before truncate on public.on_call_duties
  for each statement execute function public.escalation_paths_no_truncate();
drop trigger if exists escalation_records_no_truncate on public.escalation_records;
create trigger escalation_records_no_truncate
  before truncate on public.escalation_records
  for each statement execute function public.escalation_paths_no_truncate();

create or replace function public.escalation_require_actor(p_action text, p_approval boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $esc$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null or v_org is null then
    raise exception '% requires an authenticated organization member', p_action
      using errcode = 'insufficient_privilege';
  end if;
  select lower(role) into v_role
    from public.user_profiles
   where id = v_uid and organization_id = v_org;
  if v_role is null or v_role = '' or v_role = 'ai_admin'
     or public.app_current_role_is_external() then
    raise exception 'AI and external identities cannot %', p_action
      using errcode = 'insufficient_privilege';
  end if;
  if p_approval and not public.app_role_has_approval_authority(v_role) then
    raise exception '% requires approval authority', p_action
      using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object('userId', v_uid, 'role', v_role, 'organizationId', v_org);
end
$esc$;

create or replace function public.escalation_subject_posture(
  p_subject_kind text,
  p_subject_id uuid,
  p_condition_kind text,
  p_response_window_hours integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $esc$
declare
  v_org uuid := public.app_current_org();
  v_due_on date;
  v_due_at timestamptz;
  v_triggered timestamptz;
  v_cleared timestamptz;
  v_status text;
  v_completed timestamptz;
  v_approval text;
  v_outcome text;
  v_recommendation uuid;
  v_work uuid;
  v_window integer := p_response_window_hours;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('qualified', false,
      'reason', 'authentication and organization membership are required');
  end if;

  if p_subject_kind = 'decision' and p_condition_kind = 'overdue' then
    select d.decision_required_date, d.approval_status, d.outcome_status
      into v_due_on, v_approval, v_outcome
      from public.decisions d
     where d.id = p_subject_id and d.organization_id = v_org;
    if not found then
      return jsonb_build_object('qualified', false, 'reason', 'subject was not found in this organization');
    end if;
    if v_due_on is null then
      return jsonb_build_object('qualified', false, 'reason', 'this decision has no required date, so it cannot be overdue');
    end if;
    if v_due_on >= current_date then
      return jsonb_build_object('qualified', false, 'reason', 'the decision required date has not passed');
    end if;
    if v_approval is distinct from 'pending' or v_outcome is distinct from 'open' then
      return jsonb_build_object('qualified', false, 'reason', 'the decision is no longer an open pending decision');
    end if;
    return jsonb_build_object('qualified', true,
      'subjectDueOn', v_due_on,
      'stateBasis', format('Decision required date %s has passed; approval is still pending and the outcome is open.', v_due_on));
  elsif p_subject_kind = 'decision' and p_condition_kind = 'blocked' then
    select d.approval_status, d.outcome_status, d.recommendation_id
      into v_approval, v_outcome, v_recommendation
      from public.decisions d
     where d.id = p_subject_id and d.organization_id = v_org;
    if not found then
      return jsonb_build_object('qualified', false, 'reason', 'subject was not found in this organization');
    end if;
    if v_approval is distinct from 'pending' or v_outcome is distinct from 'open' then
      return jsonb_build_object('qualified', false, 'reason', 'the decision is no longer an open pending decision');
    end if;
    if v_recommendation is null then
      return jsonb_build_object('qualified', false, 'reason', 'this decision has no recommendation, so a blocked work order cannot be tied to it');
    end if;
    select w.id into v_work
      from public.work_orders w
     where w.organization_id = v_org
       and w.recommendation_id = v_recommendation
       and w.status = 'blocked'
       and w.completed_at is null
     order by w.created_at
     limit 1;
    if v_work is null then
      return jsonb_build_object('qualified', false, 'reason', 'no same-tenant blocked work order is linked through the recommendation on this decision');
    end if;
    return jsonb_build_object('qualified', true,
      'linkedWorkOrderId', v_work,
      'stateBasis', format('Decision remains open and pending while work order %s is blocked.', v_work));
  elsif p_subject_kind = 'work_order' and p_condition_kind = 'overdue' then
    select w.due_date, w.status, w.completed_at
      into v_due_at, v_status, v_completed
      from public.work_orders w
     where w.id = p_subject_id and w.organization_id = v_org;
    if not found then
      return jsonb_build_object('qualified', false, 'reason', 'subject was not found in this organization');
    end if;
    if v_due_at is null then
      return jsonb_build_object('qualified', false, 'reason', 'this work order has no due date, so it cannot be overdue');
    end if;
    if v_completed is not null or v_status = 'completed' then
      return jsonb_build_object('qualified', false, 'reason', 'completed work cannot be overdue');
    end if;
    if v_due_at >= now() then
      return jsonb_build_object('qualified', false, 'reason', 'the work order due date has not passed');
    end if;
    return jsonb_build_object('qualified', true,
      'subjectDueAt', v_due_at,
      'stateBasis', format('Work order due at %s is still incomplete.', v_due_at));
  elsif p_subject_kind = 'work_order' and p_condition_kind = 'blocked' then
    select w.status, w.completed_at into v_status, v_completed
      from public.work_orders w
     where w.id = p_subject_id and w.organization_id = v_org;
    if not found then
      return jsonb_build_object('qualified', false, 'reason', 'subject was not found in this organization');
    end if;
    if v_completed is not null or v_status = 'completed' then
      return jsonb_build_object('qualified', false, 'reason', 'completed work is not blocked');
    end if;
    if v_status is distinct from 'blocked' then
      return jsonb_build_object('qualified', false, 'reason', 'the work order status is not blocked');
    end if;
    return jsonb_build_object('qualified', true,
      'linkedWorkOrderId', p_subject_id,
      'stateBasis', format('Work order %s status is blocked and it is not complete.', p_subject_id));
  elsif p_subject_kind = 'condition_alert' and p_condition_kind = 'overdue' then
    if v_window is null or v_window < 1 or v_window > 8760 then
      return jsonb_build_object('qualified', false, 'reason', 'an overdue alert rule must carry the tenant response window in whole hours from 1 through 8760');
    end if;
    select a.triggered_at, a.cleared_at into v_triggered, v_cleared
      from public.condition_alerts a
     where a.id = p_subject_id and a.organization_id = v_org;
    if not found then
      return jsonb_build_object('qualified', false, 'reason', 'subject was not found in this organization');
    end if;
    if v_cleared is not null then
      return jsonb_build_object('qualified', false, 'reason', 'a cleared alert is not overdue');
    end if;
    v_due_at := v_triggered + make_interval(hours => v_window);
    if v_due_at >= now() then
      return jsonb_build_object('qualified', false, 'reason', 'the tenant response window has not elapsed');
    end if;
    return jsonb_build_object('qualified', true,
      'subjectDueAt', v_due_at,
      'responseWindowHours', v_window,
      'stateBasis', format('Alert triggered at %s is still uncleared after the tenant response window of %s hour(s).', v_triggered, v_window));
  elsif p_subject_kind = 'condition_alert' and p_condition_kind = 'blocked' then
    select a.cleared_at, w.id into v_cleared, v_work
      from public.condition_alerts a
      join public.work_orders w
        on w.id = a.work_order_id and w.organization_id = a.organization_id
     where a.id = p_subject_id and a.organization_id = v_org
       and a.cleared_at is null
       and w.status = 'blocked'
       and w.completed_at is null
     limit 1;
    if not found then
      if not exists (
        select 1 from public.condition_alerts a
         where a.id = p_subject_id and a.organization_id = v_org
      ) then
        return jsonb_build_object('qualified', false, 'reason', 'subject was not found in this organization');
      end if;
      return jsonb_build_object('qualified', false, 'reason', 'the alert is not open against a same-tenant blocked work order');
    end if;
    return jsonb_build_object('qualified', true,
      'linkedWorkOrderId', v_work,
      'stateBasis', format('Alert remains uncleared while linked work order %s is blocked.', v_work));
  end if;

  return jsonb_build_object('qualified', false, 'reason', 'this subject and condition are not an escalation path');
end
$esc$;

create or replace function public.propose_escalation_rule(
  p_rule_key text,
  p_subject_kind text,
  p_condition_kind text,
  p_incident_path boolean,
  p_response_window_hours integer,
  p_escalates_to_role text,
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid;
  v_uid uuid;
  v_role text;
  v_key text := lower(btrim(coalesce(p_rule_key, '')));
  v_target text := lower(btrim(coalesce(p_escalates_to_role, '')));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_version integer;
  v_row public.escalation_rules%rowtype;
begin
  v_actor := public.escalation_require_actor('propose an escalation rule', true);
  v_org := (v_actor->>'organizationId')::uuid;
  v_uid := (v_actor->>'userId')::uuid;
  v_role := v_actor->>'role';
  if v_org is distinct from public.app_current_org() then
    raise exception 'propose an escalation rule requires an authenticated organization member'
      using errcode = 'insufficient_privilege';
  end if;
  if v_key !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'rule key must be a lowercase identifier' using errcode = 'check_violation';
  end if;
  if p_subject_kind not in ('decision','work_order','condition_alert') then
    raise exception 'subject must be a decision, work order or condition alert' using errcode = 'check_violation';
  end if;
  if p_condition_kind not in ('overdue','blocked') then
    raise exception 'condition must be overdue or blocked' using errcode = 'check_violation';
  end if;
  if p_incident_path is null then
    raise exception 'say whether this rule is an incident path' using errcode = 'check_violation';
  end if;
  if p_subject_kind = 'condition_alert' and p_condition_kind = 'overdue' then
    if p_response_window_hours is null or p_response_window_hours < 1 or p_response_window_hours > 8760 then
      raise exception 'the overdue-alert response window must be the tenant whole hours from 1 through 8760; SyncAI does not supply one'
        using errcode = 'check_violation';
    end if;
  elsif p_response_window_hours is not null then
    raise exception 'a response window applies only to an overdue condition alert; decisions and work use their own due dates'
      using errcode = 'check_violation';
  end if;
  if v_target !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'escalates_to_role must be a role on the authority ladder for this organization'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.authority_limits al
     where al.organization_id = v_org and al.role_key = v_target
  ) then
    raise exception 'escalates_to_role must be a role on the authority ladder for this organization'
      using errcode = 'check_violation';
  end if;
  if length(v_basis) < 20 or length(v_basis) > 4000 then
    raise exception 'state the basis for this escalation rule in 20 to 4000 characters'
      using errcode = 'check_violation';
  end if;
  perform 1 from public.escalation_rules
   where organization_id = v_org and rule_key = v_key
   for update;
  if exists (
    select 1 from public.escalation_rules
     where organization_id = v_org and rule_key = v_key and status = 'draft'
  ) then
    raise exception 'adopt or retire the existing draft before proposing another version'
      using errcode = 'unique_violation';
  end if;
  select coalesce(max(version), 0) + 1 into v_version
    from public.escalation_rules
   where organization_id = v_org and rule_key = v_key;

  perform set_config('app.escalation_path_write', 'granted', true);
  insert into public.escalation_rules (
    organization_id, rule_key, version, subject_kind, condition_kind, incident_path,
    response_window_hours, escalates_to_role, basis, status, proposed_by
  ) values (
    v_org, v_key, v_version, p_subject_kind, p_condition_kind, p_incident_path,
    case when p_subject_kind = 'condition_alert' and p_condition_kind = 'overdue'
      then p_response_window_hours else null end,
    v_target, v_basis, 'draft', v_uid
  ) returning * into v_row;
  perform set_config('app.escalation_path_write', '', true);

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, new_state
  ) values (
    v_org, 'escalation_rule', v_role,
    jsonb_build_object('action','propose','ruleId',v_row.id,'ruleKey',v_row.rule_key,
      'version',v_row.version,'proposedBy',v_uid,'grantsAuthority',false),
    to_jsonb(v_row)
  );
  return jsonb_build_object('ruleId', v_row.id, 'status', v_row.status, 'version', v_row.version);
exception when others then
  perform set_config('app.escalation_path_write', '', true);
  raise;
end
$esc$;

create or replace function public.adopt_escalation_rule(p_rule_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid;
  v_uid uuid;
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_rule public.escalation_rules%rowtype;
  v_prior public.escalation_rules%rowtype;
  v_row public.escalation_rules%rowtype;
  v_prior_id uuid;
begin
  v_actor := public.escalation_require_actor('adopt an escalation rule', true);
  v_org := (v_actor->>'organizationId')::uuid;
  v_uid := (v_actor->>'userId')::uuid;
  v_role := v_actor->>'role';
  if length(v_note) < 20 or length(v_note) > 4000 then
    raise exception 'adoption requires a substantive note' using errcode = 'check_violation';
  end if;
  select * into v_rule from public.escalation_rules
   where id = p_rule_id and organization_id = v_org
   for update;
  if not found or v_rule.status <> 'draft' then
    raise exception 'draft escalation rule was not found in this organization'
      using errcode = 'no_data_found';
  end if;
  if v_rule.proposed_by = v_uid then
    raise exception 'the proposer cannot adopt their own escalation rule'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_prior from public.escalation_rules
   where organization_id = v_org
     and subject_kind = v_rule.subject_kind
     and condition_kind = v_rule.condition_kind
     and status = 'adopted'
   for update;
  if found then
    v_prior_id := v_prior.id;
  end if;

  perform set_config('app.escalation_path_write', 'granted', true);
  if v_prior_id is not null then
    update public.escalation_rules
       set status = 'retired', retired_by = v_uid, retired_at = now(),
           retirement_note = 'Superseded by a newly adopted rule for the same subject and condition.'
     where id = v_prior_id and organization_id = v_org;
  end if;
  update public.escalation_rules
     set status = 'adopted', adopted_by = v_uid, adopted_at = now(),
         adoption_note = v_note, supersedes_id = v_prior_id
   where id = v_rule.id and organization_id = v_org
   returning * into v_row;
  perform set_config('app.escalation_path_write', '', true);

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'escalation_rule', v_role,
    jsonb_build_object('action','adopt','ruleId',v_row.id,'adoptedBy',v_uid,
      'supersedesId',v_prior_id,'grantsAuthority',false),
    to_jsonb(v_rule), to_jsonb(v_row)
  );
  return jsonb_build_object('ruleId', v_row.id, 'status', v_row.status, 'supersedesId', v_prior_id);
exception when others then
  perform set_config('app.escalation_path_write', '', true);
  raise;
end
$esc$;

create or replace function public.retire_escalation_rule(p_rule_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid;
  v_uid uuid;
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_rule public.escalation_rules%rowtype;
  v_row public.escalation_rules%rowtype;
begin
  v_actor := public.escalation_require_actor('retire an escalation rule', true);
  v_org := (v_actor->>'organizationId')::uuid;
  v_uid := (v_actor->>'userId')::uuid;
  v_role := v_actor->>'role';
  if length(v_note) < 20 or length(v_note) > 4000 then
    raise exception 'retirement requires a substantive note' using errcode = 'check_violation';
  end if;
  select * into v_rule from public.escalation_rules
   where id = p_rule_id and organization_id = v_org
     and status in ('draft','adopted')
   for update;
  if not found then
    raise exception 'open escalation rule was not found in this organization'
      using errcode = 'no_data_found';
  end if;
  perform set_config('app.escalation_path_write', 'granted', true);
  update public.escalation_rules
     set status = 'retired', retired_by = v_uid, retired_at = now(), retirement_note = v_note
   where id = v_rule.id and organization_id = v_org
   returning * into v_row;
  perform set_config('app.escalation_path_write', '', true);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'escalation_rule', v_role,
    jsonb_build_object('action','retire','ruleId',v_row.id,'retiredBy',v_uid,'grantsAuthority',false),
    to_jsonb(v_rule), to_jsonb(v_row)
  );
  return jsonb_build_object('ruleId', v_row.id, 'status', v_row.status);
exception when others then
  perform set_config('app.escalation_path_write', '', true);
  raise;
end
$esc$;

create or replace function public.record_on_call_duty(
  p_role_key text,
  p_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid;
  v_uid uuid;
  v_role text;
  v_target text := lower(btrim(coalesce(p_role_key, '')));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_holder text;
  v_row public.on_call_duties%rowtype;
begin
  v_actor := public.escalation_require_actor('record an on-call duty', true);
  v_org := (v_actor->>'organizationId')::uuid;
  v_uid := (v_actor->>'userId')::uuid;
  v_role := v_actor->>'role';
  if v_target !~ '^[a-z][a-z0-9_]{1,63}$' or not exists (
    select 1 from public.authority_limits al
     where al.organization_id = v_org and al.role_key = v_target
  ) then
    raise exception 'on-call coverage must name a role on the authority ladder for this organization'
      using errcode = 'check_violation';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at <= now() then
    raise exception 'an on-call duty needs a start and an end, and the end must still be ahead'
      using errcode = 'check_violation';
  end if;
  if length(v_basis) < 20 or length(v_basis) > 4000 then
    raise exception 'state why this person is on call' using errcode = 'check_violation';
  end if;
  select lower(role) into v_holder
    from public.user_profiles
   where id = p_user_id and organization_id = v_org;
  if v_holder is distinct from v_target then
    raise exception 'the on-call holder must be a member of this organization whose role is the covered role'
      using errcode = 'check_violation';
  end if;
  perform set_config('app.escalation_path_write', 'granted', true);
  insert into public.on_call_duties (
    organization_id, role_key, user_id, starts_at, ends_at, basis, recorded_by
  ) values (
    v_org, v_target, p_user_id, p_starts_at, p_ends_at, v_basis, v_uid
  ) returning * into v_row;
  perform set_config('app.escalation_path_write', '', true);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, new_state
  ) values (
    v_org, 'on_call_duty', v_role,
    jsonb_build_object('action','record','dutyId',v_row.id,'userId',v_row.user_id,
      'roleKey',v_row.role_key,'recordedBy',v_uid,'grantsAuthority',false),
    to_jsonb(v_row)
  );
  return jsonb_build_object('dutyId', v_row.id, 'roleKey', v_row.role_key, 'userId', v_row.user_id);
exception when others then
  perform set_config('app.escalation_path_write', '', true);
  raise;
end
$esc$;

create or replace function public.end_on_call_duty(p_duty_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid;
  v_uid uuid;
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_duty public.on_call_duties%rowtype;
  v_row public.on_call_duties%rowtype;
begin
  v_actor := public.escalation_require_actor('end an on-call duty', true);
  v_org := (v_actor->>'organizationId')::uuid;
  v_uid := (v_actor->>'userId')::uuid;
  v_role := v_actor->>'role';
  if length(v_note) < 20 or length(v_note) > 4000 then
    raise exception 'ending a duty requires a substantive note' using errcode = 'check_violation';
  end if;
  select * into v_duty from public.on_call_duties
   where id = p_duty_id and organization_id = v_org and ended_early_at is null
   for update;
  if not found then
    raise exception 'open on-call duty was not found in this organization'
      using errcode = 'no_data_found';
  end if;
  perform set_config('app.escalation_path_write', 'granted', true);
  update public.on_call_duties
     set ended_early_by = v_uid, ended_early_at = now(), end_note = v_note
   where id = v_duty.id and organization_id = v_org
   returning * into v_row;
  perform set_config('app.escalation_path_write', '', true);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'on_call_duty', v_role,
    jsonb_build_object('action','end','dutyId',v_row.id,'endedBy',v_uid,'grantsAuthority',false),
    to_jsonb(v_duty), to_jsonb(v_row)
  );
  return jsonb_build_object('dutyId', v_row.id, 'endedEarlyAt', v_row.ended_early_at);
exception when others then
  perform set_config('app.escalation_path_write', '', true);
  raise;
end
$esc$;

create or replace function public.raise_subject_escalation(
  p_rule_id uuid,
  p_subject_id uuid,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid := public.app_current_org();
  v_uid uuid;
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_rule public.escalation_rules%rowtype;
  v_existing public.escalation_records%rowtype;
  v_posture jsonb;
  v_duty_id uuid;
  v_on_call uuid;
  v_holder text;
  v_row public.escalation_records%rowtype;
begin
  v_actor := public.escalation_require_actor('raise an escalation', false);
  v_uid := (v_actor->>'userId')::uuid;
  v_role := v_actor->>'role';
  if v_org is null or v_org is distinct from (v_actor->>'organizationId')::uuid then
    raise exception 'raise an escalation requires an authenticated organization member'
      using errcode = 'insufficient_privilege';
  end if;
  if length(v_note) < 20 or length(v_note) > 4000 then
    raise exception 'raising an escalation requires a substantive note' using errcode = 'check_violation';
  end if;
  select * into v_rule from public.escalation_rules
   where id = p_rule_id and organization_id = v_org and status = 'adopted'
   for update;
  if not found then
    raise exception 'adopted escalation rule was not found in this organization'
      using errcode = 'no_data_found';
  end if;
  if v_rule.subject_kind = 'work_order' then
    perform 1 from public.work_orders
     where id = p_subject_id and organization_id = v_org
     for update;
  elsif v_rule.subject_kind = 'decision' then
    perform 1 from public.decisions
     where id = p_subject_id and organization_id = v_org
     for update;
  elsif v_rule.subject_kind = 'condition_alert' then
    perform 1 from public.condition_alerts
     where id = p_subject_id and organization_id = v_org
     for update;
  end if;
  v_posture := public.escalation_subject_posture(
    v_rule.subject_kind, p_subject_id, v_rule.condition_kind, v_rule.response_window_hours);
  if coalesce((v_posture->>'qualified')::boolean, false) is not true then
    raise exception '%', coalesce(v_posture->>'reason', 'subject does not qualify')
      using errcode = 'check_violation';
  end if;

  select id, user_id into v_duty_id, v_on_call
    from public.on_call_duties
   where organization_id = v_org
     and role_key = v_rule.escalates_to_role
     and starts_at <= now()
     and ends_at > now()
     and ended_early_at is null
   order by starts_at desc, recorded_at desc
   limit 1;
  if v_on_call is not null then
    select lower(role) into v_holder
      from public.user_profiles
     where id = v_on_call and organization_id = v_org;
    if v_holder is distinct from v_rule.escalates_to_role then
      v_duty_id := null;
      v_on_call := null;
    end if;
  end if;
  if v_rule.incident_path and v_on_call is null then
    raise exception 'no current on-call holder covers %; record a duty before raising an incident escalation',
      v_rule.escalates_to_role
      using errcode = 'check_violation';
  end if;

  select * into v_existing from public.escalation_records
   where organization_id = v_org
     and subject_kind = v_rule.subject_kind
     and subject_id = p_subject_id
     and condition_kind = v_rule.condition_kind
     and status = 'open'
   for update;
  if found then
    if v_existing.rule_id = v_rule.id then
      return jsonb_build_object('escalationId', v_existing.id, 'status', 'open', 'idempotent', true);
    end if;
    raise exception 'an open escalation already exists for this subject and condition'
      using errcode = 'unique_violation';
  end if;

  perform set_config('app.escalation_path_write', 'granted', true);
  insert into public.escalation_records (
    organization_id, rule_id, subject_kind, subject_id, condition_kind, incident_path,
    escalates_to_role, response_window_hours, subject_due_on, subject_due_at,
    linked_work_order_id, state_basis, on_call_duty_id, on_call_user_id,
    raise_note, raised_by
  ) values (
    v_org, v_rule.id, v_rule.subject_kind, p_subject_id, v_rule.condition_kind, v_rule.incident_path,
    v_rule.escalates_to_role, v_rule.response_window_hours,
    nullif(v_posture->>'subjectDueOn','')::date,
    nullif(v_posture->>'subjectDueAt','')::timestamptz,
    nullif(v_posture->>'linkedWorkOrderId','')::uuid,
    v_posture->>'stateBasis', v_duty_id, v_on_call, v_note, v_uid
  ) returning * into v_row;
  perform set_config('app.escalation_path_write', '', true);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, new_state
  ) values (
    v_org, 'escalation_record', v_role,
    jsonb_build_object('action','raise','escalationId',v_row.id,'ruleId',v_rule.id,
      'subjectKind',v_row.subject_kind,'subjectId',v_row.subject_id,
      'onCallUserId',v_row.on_call_user_id,'raisedBy',v_uid,'grantsAuthority',false),
    to_jsonb(v_row)
  );
  return jsonb_build_object('escalationId', v_row.id, 'status', v_row.status, 'idempotent', false);
exception when others then
  perform set_config('app.escalation_path_write', '', true);
  raise;
end
$esc$;

create or replace function public.acknowledge_subject_escalation(p_escalation_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid := public.app_current_org();
  v_uid uuid;
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_row_old public.escalation_records%rowtype;
  v_row public.escalation_records%rowtype;
begin
  v_actor := public.escalation_require_actor('acknowledge an escalation', false);
  v_uid := (v_actor->>'userId')::uuid;
  v_role := v_actor->>'role';
  if v_org is null or v_org is distinct from (v_actor->>'organizationId')::uuid then
    raise exception 'acknowledge an escalation requires an authenticated organization member'
      using errcode = 'insufficient_privilege';
  end if;
  if length(v_note) < 20 or length(v_note) > 4000 then
    raise exception 'acknowledgement requires a substantive note' using errcode = 'check_violation';
  end if;
  select * into v_row_old from public.escalation_records
   where id = p_escalation_id and organization_id = v_org and status = 'open'
   for update;
  if not found then
    raise exception 'open escalation was not found in this organization'
      using errcode = 'no_data_found';
  end if;
  if v_row_old.raised_by = v_uid then
    raise exception 'the person who raised an escalation cannot acknowledge it'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row_old.incident_path then
    if v_uid is distinct from v_row_old.on_call_user_id
       and v_role is distinct from v_row_old.escalates_to_role then
      raise exception 'an incident escalation is acknowledged by the on-call holder or the role the path names'
        using errcode = 'insufficient_privilege';
    end if;
  elsif v_role is distinct from v_row_old.escalates_to_role
        and not public.app_role_has_approval_authority(v_role) then
    raise exception 'acknowledgement requires the named escalation role or approval authority'
      using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.escalation_path_write', 'granted', true);
  update public.escalation_records
     set status = 'acknowledged', acknowledged_by = v_uid, acknowledged_at = now(),
         acknowledgement_note = v_note
   where id = v_row_old.id and organization_id = v_org
   returning * into v_row;
  perform set_config('app.escalation_path_write', '', true);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'escalation_record', v_role,
    jsonb_build_object('action','acknowledge','escalationId',v_row.id,'acknowledgedBy',v_uid,
      'grantsAuthority',false,'approvesSubject',false,'releasesWork',false,'clearsAlert',false),
    to_jsonb(v_row_old), to_jsonb(v_row)
  );
  return jsonb_build_object('escalationId', v_row.id, 'status', v_row.status, 'grantsAuthority', false);
exception when others then
  perform set_config('app.escalation_path_write', '', true);
  raise;
end
$esc$;

create or replace function public.withdraw_subject_escalation(p_escalation_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid;
  v_uid uuid;
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_row_old public.escalation_records%rowtype;
  v_row public.escalation_records%rowtype;
begin
  v_actor := public.escalation_require_actor('withdraw an escalation', false);
  v_org := (v_actor->>'organizationId')::uuid;
  v_uid := (v_actor->>'userId')::uuid;
  v_role := v_actor->>'role';
  if length(v_note) < 20 or length(v_note) > 4000 then
    raise exception 'withdrawal requires a substantive note' using errcode = 'check_violation';
  end if;
  select * into v_row_old from public.escalation_records
   where id = p_escalation_id and organization_id = v_org and status = 'open'
   for update;
  if not found then
    raise exception 'open escalation was not found in this organization'
      using errcode = 'no_data_found';
  end if;
  if v_row_old.raised_by is distinct from v_uid
     and not public.app_role_has_approval_authority(v_role) then
    raise exception 'only the raiser or a person with approval authority can withdraw an escalation'
      using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.escalation_path_write', 'granted', true);
  update public.escalation_records
     set status = 'withdrawn', withdrawn_by = v_uid, withdrawn_at = now(), withdrawal_note = v_note
   where id = v_row_old.id and organization_id = v_org
   returning * into v_row;
  perform set_config('app.escalation_path_write', '', true);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'escalation_record', v_role,
    jsonb_build_object('action','withdraw','escalationId',v_row.id,'withdrawnBy',v_uid,'grantsAuthority',false),
    to_jsonb(v_row_old), to_jsonb(v_row)
  );
  return jsonb_build_object('escalationId', v_row.id, 'status', v_row.status);
exception when others then
  perform set_config('app.escalation_path_write', '', true);
  raise;
end
$esc$;

create or replace function public.get_escalation_paths()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $esc$
declare
  v_actor jsonb;
  v_org uuid := public.app_current_org();
  v_role text;
  v_rule public.escalation_rules%rowtype;
  v_subject record;
  v_posture jsonb;
  v_found integer;
  v_candidates jsonb := '[]'::jsonb;
begin
  v_actor := public.escalation_require_actor('read escalation paths', false);
  v_role := v_actor->>'role';
  if v_org is null or v_org is distinct from (v_actor->>'organizationId')::uuid then
    raise exception 'read escalation paths requires an authenticated organization member'
      using errcode = 'insufficient_privilege';
  end if;

  for v_rule in
    select * from public.escalation_rules
     where organization_id = v_org and status = 'adopted'
     order by subject_kind, condition_kind
  loop
    v_found := 0;
    if v_rule.subject_kind = 'decision' then
      for v_subject in
        select d.id from public.decisions d
         where d.organization_id = v_org
           and d.approval_status = 'pending'
           and d.outcome_status = 'open'
         order by d.created_at desc
         limit 100
      loop
        v_posture := public.escalation_subject_posture(
          v_rule.subject_kind, v_subject.id, v_rule.condition_kind, v_rule.response_window_hours);
        if coalesce((v_posture->>'qualified')::boolean, false) then
          v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
            'ruleId', v_rule.id, 'subjectKind', v_rule.subject_kind, 'subjectId', v_subject.id,
            'conditionKind', v_rule.condition_kind, 'incidentPath', v_rule.incident_path,
            'stateBasis', v_posture->>'stateBasis'));
          v_found := v_found + 1;
          exit when v_found >= 25;
        end if;
      end loop;
    elsif v_rule.subject_kind = 'work_order' then
      for v_subject in
        select w.id from public.work_orders w
         where w.organization_id = v_org and w.completed_at is null
         order by w.created_at desc
         limit 100
      loop
        v_posture := public.escalation_subject_posture(
          v_rule.subject_kind, v_subject.id, v_rule.condition_kind, v_rule.response_window_hours);
        if coalesce((v_posture->>'qualified')::boolean, false) then
          v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
            'ruleId', v_rule.id, 'subjectKind', v_rule.subject_kind, 'subjectId', v_subject.id,
            'conditionKind', v_rule.condition_kind, 'incidentPath', v_rule.incident_path,
            'stateBasis', v_posture->>'stateBasis'));
          v_found := v_found + 1;
          exit when v_found >= 25;
        end if;
      end loop;
    else
      for v_subject in
        select a.id from public.condition_alerts a
         where a.organization_id = v_org and a.cleared_at is null
         order by a.triggered_at desc
         limit 100
      loop
        v_posture := public.escalation_subject_posture(
          v_rule.subject_kind, v_subject.id, v_rule.condition_kind, v_rule.response_window_hours);
        if coalesce((v_posture->>'qualified')::boolean, false) then
          v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
            'ruleId', v_rule.id, 'subjectKind', v_rule.subject_kind, 'subjectId', v_subject.id,
            'conditionKind', v_rule.condition_kind, 'incidentPath', v_rule.incident_path,
            'stateBasis', v_posture->>'stateBasis'));
          v_found := v_found + 1;
          exit when v_found >= 25;
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'callerRole', v_role,
    'canAuthor', public.app_role_has_approval_authority(v_role),
    'control', 'Escalation records who must act on an overdue or blocked decision, work order or alert, including the on-call holder when the rule is an incident path. Raising and acknowledging are named-human acts. Acknowledgement does not approve a decision, release work, clear an alert, or grant authority. The workspace samples at most 25 qualifying subjects per adopted rule from 100 recent rows; raising any other subject still checks that subject.',
    'ladderRoles', coalesce((
      select jsonb_agg(role_key order by role_key)
        from (select distinct role_key from public.authority_limits where organization_id = v_org) roles
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', p.id, 'role', lower(p.role), 'name', coalesce(nullif(btrim(p.full_name), ''), 'Named member')
      ) order by lower(p.role), p.full_name)
        from public.user_profiles p
       where p.organization_id = v_org and coalesce(lower(p.role), '') <> 'ai_admin'
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'ruleKey', r.rule_key, 'version', r.version,
        'subjectKind', r.subject_kind, 'conditionKind', r.condition_kind,
        'incidentPath', r.incident_path, 'responseWindowHours', r.response_window_hours,
        'escalatesToRole', r.escalates_to_role, 'basis', r.basis, 'status', r.status,
        'proposedBy', r.proposed_by, 'isOwnDraft', r.proposed_by = auth.uid()
      ) order by r.status, r.subject_kind, r.condition_kind, r.version desc)
        from public.escalation_rules r
       where r.organization_id = v_org and r.status in ('draft','adopted')
    ), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'roleKey', d.role_key, 'userId', d.user_id,
        'startsAt', d.starts_at, 'endsAt', d.ends_at, 'basis', d.basis,
        'endedEarlyAt', d.ended_early_at,
        'covering', d.starts_at <= now() and d.ends_at > now() and d.ended_early_at is null
      ) order by d.recorded_at desc)
        from (
          select * from public.on_call_duties
           where organization_id = v_org
           order by recorded_at desc
           limit 100
        ) d
    ), '[]'::jsonb),
    'escalations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'ruleId', e.rule_id, 'subjectKind', e.subject_kind, 'subjectId', e.subject_id,
        'conditionKind', e.condition_kind, 'incidentPath', e.incident_path,
        'escalatesToRole', e.escalates_to_role, 'onCallUserId', e.on_call_user_id,
        'stateBasis', e.state_basis, 'raiseNote', e.raise_note, 'status', e.status,
        'isOwnRaise', e.raised_by = auth.uid()
      ) order by (e.status = 'open') desc, e.raised_at desc)
        from (
          select * from public.escalation_records
           where organization_id = v_org
           order by (status = 'open') desc, raised_at desc
           limit 100
        ) e
    ), '[]'::jsonb),
    'candidates', v_candidates
  );
end
$esc$;

revoke all on function public.escalation_require_actor(text, boolean) from public, anon, authenticated;
revoke all on function public.escalation_subject_posture(text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.propose_escalation_rule(text, text, text, boolean, integer, text, text) from public, anon;
revoke all on function public.adopt_escalation_rule(uuid, text) from public, anon;
revoke all on function public.retire_escalation_rule(uuid, text) from public, anon;
revoke all on function public.record_on_call_duty(text, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.end_on_call_duty(uuid, text) from public, anon;
revoke all on function public.raise_subject_escalation(uuid, uuid, text) from public, anon;
revoke all on function public.acknowledge_subject_escalation(uuid, text) from public, anon;
revoke all on function public.withdraw_subject_escalation(uuid, text) from public, anon;
revoke all on function public.get_escalation_paths() from public, anon;

grant execute on function public.escalation_subject_posture(text, uuid, text, integer) to authenticated;
grant execute on function public.propose_escalation_rule(text, text, text, boolean, integer, text, text) to authenticated;
grant execute on function public.adopt_escalation_rule(uuid, text) to authenticated;
grant execute on function public.retire_escalation_rule(uuid, text) to authenticated;
grant execute on function public.record_on_call_duty(text, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.end_on_call_duty(uuid, text) to authenticated;
grant execute on function public.raise_subject_escalation(uuid, uuid, text) to authenticated;
grant execute on function public.acknowledge_subject_escalation(uuid, text) to authenticated;
grant execute on function public.withdraw_subject_escalation(uuid, text) to authenticated;
grant execute on function public.get_escalation_paths() to authenticated;

comment on table public.escalation_rules is
  'E4.07 tenant-authored path for one overdue or blocked condition. Draft until a different named human adopts it. Not an approval and not a work order.';
comment on table public.on_call_duties is
  'E4.07 named on-call coverage for an authority-ladder role. Required before an incident escalation can be raised.';
comment on table public.escalation_records is
  'E4.07 record that a named human raised a qualifying subject onto an adopted path. Acknowledgement grants no authority over the subject.';
