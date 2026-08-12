-- ============================================================================
-- Completing enterprise governance (capability register E4.01, E4.04, E4.06,
-- E4.11). With slices 9 and 10 this closes every E4 item except E4.09
-- regulatory evidence, which is jurisdiction-specific and stays honest at 🟡.
--
--   E4.01 GLOBAL STANDARDS VS SITE-LEVEL AUTHORITY. A multi-site operator sets
--         standards centrally and sites deviate locally. The failure mode is
--         not deviation — it is UNRECORDED deviation. Sites may request a
--         variance; the standard itself names who can grant one; every granted
--         variance carries compensating controls and an expiry, because a
--         permanent exception is just a standard nobody updated.
--
--   E4.04 RISK-ACCEPTANCE THRESHOLDS, tied to the delegation ladder rather than
--         floating free. Who may accept what residual risk is already stated in
--         authority_limits.max_risk_level; accept_risk() enforces it. And an
--         active acceptance now becomes the legitimate escape valve in the
--         authority trigger: over-ceiling RISK is permitted when — and only
--         when — someone whose ceiling covers it has signed for it, in writing,
--         with an expiry.
--
--   E4.06 ENGINEERING APPROVAL REQUIREMENTS. Certain change classes must not be
--         approved on maintenance authority alone. The rule names the class,
--         the discipline and the basis; the trigger refuses approval until the
--         named discipline has signed.
--
--   E4.11 RECOMMENDATION VERSION CONTROL. Recommendations were mutated in
--         place, so the decision trail recorded only the final wording — you
--         could see that something was approved but not what it said when it
--         was proposed. Every material change now snapshots the prior state.
--
-- Canonical reuse: recommendations, sites, authority_limits, user_profiles,
-- audit_events, app_current_org(). Additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- E4.11 — Recommendation version control (first: everything below mutates
-- recommendations, and those mutations should be captured from the outset)
-- ----------------------------------------------------------------------------
create table if not exists recommendation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  version int not null,
  -- The PRIOR state, captured before it was overwritten.
  snapshot jsonb not null,
  changed_fields text[] not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  register_ref text not null default 'E4.11',
  unique (recommendation_id, version)
);

create index if not exists idx_rec_versions_lookup
  on recommendation_versions(recommendation_id, version desc);

alter table recommendation_versions enable row level security;

drop policy if exists rec_versions_org_read on recommendation_versions;
create policy rec_versions_org_read on recommendation_versions
  for select to authenticated using (organization_id = app_current_org());

create or replace function public.snapshot_recommendation_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed text[] := '{}';
  v_next int;
begin
  -- Only material fields. Enrichment timestamps and clerical stamps would
  -- bury the substantive history in noise.
  if new.title      is distinct from old.title      then v_changed := v_changed || 'title'::text; end if;
  if new.issue      is distinct from old.issue      then v_changed := v_changed || 'issue'::text; end if;
  if new.action     is distinct from old.action     then v_changed := v_changed || 'action'::text; end if;
  if new.impact     is distinct from old.impact     then v_changed := v_changed || 'impact'::text; end if;
  if new.rationale  is distinct from old.rationale  then v_changed := v_changed || 'rationale'::text; end if;
  if new.status     is distinct from old.status     then v_changed := v_changed || 'status'::text; end if;
  if new.urgency    is distinct from old.urgency    then v_changed := v_changed || 'urgency'::text; end if;
  if new.risk_impact is distinct from old.risk_impact then v_changed := v_changed || 'risk_impact'::text; end if;
  if new.estimated_cost_usd is distinct from old.estimated_cost_usd then v_changed := v_changed || 'estimated_cost_usd'::text; end if;
  if new.consequence_summary is distinct from old.consequence_summary then v_changed := v_changed || 'consequence_summary'::text; end if;

  if array_length(v_changed, 1) is null then
    return new;
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from recommendation_versions where recommendation_id = old.id;

  insert into recommendation_versions (organization_id, recommendation_id,
    version, snapshot, changed_fields, changed_by)
  values (old.organization_id, old.id, v_next, to_jsonb(old), v_changed, auth.uid());

  return new;
end
$$;

drop trigger if exists trg_snapshot_recommendation_version on recommendations;
create trigger trg_snapshot_recommendation_version
  after update on recommendations
  for each row execute function public.snapshot_recommendation_version();

-- ----------------------------------------------------------------------------
-- E4.01 — Global standards and site-level variance authority
-- ----------------------------------------------------------------------------
create table if not exists governance_standards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  standard_key text not null,
  title text not null,
  requirement text not null,
  mandatory boolean not null default true,
  -- Who owns the standard globally, and therefore who may grant a variance.
  owner_role text not null,
  variance_approver_role text not null,
  basis text not null,
  status text not null default 'draft'
    check (status in ('draft', 'adopted', 'superseded')),
  version int not null default 1,
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  register_ref text not null default 'E4.01',
  created_at timestamptz not null default now(),
  unique (organization_id, standard_key, version)
);

alter table governance_standards enable row level security;

drop policy if exists governance_standards_read on governance_standards;
create policy governance_standards_read on governance_standards
  for select to authenticated using (organization_id = app_current_org());

create table if not exists standard_site_variances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  standard_id uuid not null references governance_standards(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  justification text not null,
  -- A variance without compensating controls is not a variance; it is a gap.
  compensating_controls text not null,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'withdrawn')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  -- Mandatory. A permanent exception is a standard nobody updated.
  expires_at timestamptz,
  register_ref text not null default 'E4.01',
  unique (standard_id, site_id, requested_at)
);

create index if not exists idx_variances_active
  on standard_site_variances(organization_id, status, expires_at);

alter table standard_site_variances enable row level security;

drop policy if exists variances_org_read on standard_site_variances;
create policy variances_org_read on standard_site_variances
  for select to authenticated using (organization_id = app_current_org());

insert into governance_standards (organization_id, standard_key, title,
  requirement, mandatory, owner_role, variance_approver_role, basis)
select o.id, v.k, v.t, v.r, v.m, v.own, v.appr, v.basis
from organizations o
cross join (values
  ('failure_coding', 'Failure coding on corrective closeout',
   'Every corrective work order records a coded failure mode from the adopted enterprise taxonomy before closeout.',
   true, 'reliability_engineer', 'reliability_engineer',
   'Proposed: the reliability engine, segmented metrics and repeat-failure detection all read actual_failure_mode. Uncoded closeouts are invisible to every downstream analysis (C3.01–C3.12).'),
  ('safety_gate_clearance', 'Safety-consequence clearance before approval',
   'No recommendation touching a screened safety dimension is approved without gatekeeper clearance.',
   true, 'admin', 'executive',
   'Proposed: enforced in the database by trg_enforce_safety_gate (C1.11/C8.24). Recorded here so a site cannot treat it as local discretion.'),
  ('schedule_freeze', 'Weekly schedule freeze before execution',
   'Execution works to a released, frozen weekly schedule; additions inside the week are recorded as break-in work.',
   true, 'maintenance_manager', 'maintenance_manager',
   'Proposed: schedule compliance and break-in work (C6.09/C6.13) are only measurable against a frozen plan.'),
  ('pm_interval_change_review', 'Engineering review of PM interval changes',
   'PM interval changes are reviewed against failure history before adoption; interval changes are not made on cost grounds alone.',
   true, 'reliability_engineer', 'reliability_engineer',
   'Proposed: interval changes alter risk exposure. Confirm against the operator''s own maintenance-engineering procedure before adoption.'),
  ('data_quality_gate', 'Asset data-quality gate before go-live',
   'An asset does not enter the operating loop until its onboarding data-quality gate passes.',
   false, 'asset_manager', 'maintenance_manager',
   'Proposed: advisory rather than mandatory because partial onboarding is legitimate during migration. Recorded so the exception is visible.')
) as v(k, t, r, m, own, appr, basis)
where not exists (
  select 1 from governance_standards gs
  where gs.organization_id = o.id and gs.standard_key = v.k
);

create or replace function public.request_standard_variance(
  p_standard_id uuid,
  p_site_id uuid,
  p_justification text,
  p_compensating_controls text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  s governance_standards%rowtype;
  v_id uuid;
begin
  select * into s from governance_standards
  where id = p_standard_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'standard not found');
  end if;
  if coalesce(length(trim(p_justification)), 0) < 20 then
    return jsonb_build_object('error',
      'a variance request must state why the standard cannot be met (20 characters minimum)');
  end if;
  if coalesce(length(trim(p_compensating_controls)), 0) < 20 then
    return jsonb_build_object('error',
      'state the compensating controls. A variance without them is not a variance, it is a gap');
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    return jsonb_build_object('error',
      'a variance must expire. A permanent exception is a standard nobody updated');
  end if;
  if p_expires_at > now() + interval '2 years' then
    return jsonb_build_object('error',
      'a variance may not run beyond two years without re-examining the standard itself');
  end if;

  insert into standard_site_variances (organization_id, standard_id, site_id,
    justification, compensating_controls, requested_by, expires_at)
  values (v_org, p_standard_id, p_site_id, trim(p_justification),
    trim(p_compensating_controls), auth.uid(), p_expires_at)
  returning id into v_id;

  return jsonb_build_object('variance_id', v_id, 'status', 'pending',
    'approver_role', s.variance_approver_role);
end
$$;

grant execute on function public.request_standard_variance(uuid, uuid, text, text, timestamptz) to authenticated;

create or replace function public.decide_standard_variance(
  p_variance_id uuid,
  p_approve boolean,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  r standard_site_variances%rowtype;
  s governance_standards%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();

  select * into r from standard_site_variances
  where id = p_variance_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'variance not found');
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('error', 'this variance is already ' || r.status);
  end if;

  select * into s from governance_standards where id = r.standard_id;

  -- The standard names its own variance authority. Nobody else may grant one.
  if v_role is distinct from s.variance_approver_role
     and v_role not in ('admin', 'ai_admin') then
    return jsonb_build_object('error',
      format('granting a variance to "%s" requires the %s role',
        s.title, s.variance_approver_role));
  end if;

  -- Nor may the requester decide their own request.
  if r.requested_by is not null and r.requested_by = auth.uid() then
    return jsonb_build_object('error',
      'segregation of duties: you requested this variance and cannot also decide it');
  end if;

  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record the reasoning for this decision');
  end if;

  update standard_site_variances
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note)
  where id = p_variance_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'standard_variance', coalesce(v_role, 'unknown'),
    jsonb_build_object('variance_id', p_variance_id, 'standard', s.standard_key,
      'approved', p_approve));

  return jsonb_build_object('variance_id', p_variance_id,
    'status', case when p_approve then 'approved' else 'rejected' end);
end
$$;

grant execute on function public.decide_standard_variance(uuid, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- E4.04 — Risk-acceptance thresholds bound to the delegation ladder
-- ----------------------------------------------------------------------------
create table if not exists risk_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('recommendation', 'asset', 'site', 'standard')),
  subject_id uuid not null,
  risk_level text not null check (risk_level in ('Low','Medium','High','Critical')),
  rationale text not null,
  compensating_controls text not null,
  accepted_by uuid not null references auth.users(id),
  accepted_role text not null,
  accepted_at timestamptz not null default now(),
  -- Mandatory, and bounded. Risk accepted forever is risk nobody re-examines.
  expires_at timestamptz not null,
  review_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'expired', 'withdrawn')),
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  register_ref text not null default 'E4.04',
  created_at timestamptz not null default now()
);

create index if not exists idx_risk_acceptances_subject
  on risk_acceptances(organization_id, subject_type, subject_id, status);

alter table risk_acceptances enable row level security;

drop policy if exists risk_acceptances_read on risk_acceptances;
create policy risk_acceptances_read on risk_acceptances
  for select to authenticated using (organization_id = app_current_org());

create or replace function public.risk_rank(p text)
returns int
language sql
immutable
as $$
  select case p when 'Low' then 1 when 'Medium' then 2
                when 'High' then 3 when 'Critical' then 4 else 0 end;
$$;

create or replace function public.accept_risk(
  p_subject_type text,
  p_subject_id uuid,
  p_risk_level text,
  p_rationale text,
  p_compensating_controls text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  l authority_limits%rowtype;
  v_id uuid;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if risk_rank(p_risk_level) = 0 then
    return jsonb_build_object('error', 'risk_level must be Low, Medium, High or Critical');
  end if;
  if coalesce(length(trim(p_rationale)), 0) < 20 then
    return jsonb_build_object('error',
      'state why this residual risk is acceptable (20 characters minimum)');
  end if;
  if coalesce(length(trim(p_compensating_controls)), 0) < 20 then
    return jsonb_build_object('error',
      'state the compensating controls that make the residual risk tolerable');
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    return jsonb_build_object('error',
      'a risk acceptance must expire — risk accepted forever is risk nobody re-examines');
  end if;
  if p_expires_at > now() + interval '1 year' then
    return jsonb_build_object('error',
      'a risk acceptance may not run beyond one year without being re-taken');
  end if;

  -- THE THRESHOLD. Who may accept what is already stated in the delegation
  -- ladder; this reads it rather than inventing a second answer.
  select * into l from authority_limits
  where organization_id = v_org and role_key = v_role and status = 'adopted'
  order by version desc limit 1;

  if found and l.max_risk_level is not null
     and risk_rank(p_risk_level) > risk_rank(l.max_risk_level) then
    return jsonb_build_object('error',
      format('%s risk exceeds the %s ceiling of %s for your role. Escalate to %s.',
        p_risk_level, l.tier_label, l.max_risk_level,
        coalesce(l.escalates_to_role, 'the board')));
  end if;

  insert into risk_acceptances (organization_id, subject_type, subject_id,
    risk_level, rationale, compensating_controls, accepted_by, accepted_role,
    expires_at, review_at)
  values (v_org, p_subject_type, p_subject_id, p_risk_level, trim(p_rationale),
    trim(p_compensating_controls), auth.uid(), v_role, p_expires_at,
    p_expires_at - interval '30 days')
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'risk_acceptance', v_role,
    jsonb_build_object('acceptance_id', v_id, 'risk_level', p_risk_level,
      'subject_type', p_subject_type, 'expires_at', p_expires_at));

  return jsonb_build_object('acceptance_id', v_id, 'expires_at', p_expires_at,
    'ceiling_checked', found);
end
$$;

grant execute on function public.accept_risk(text, uuid, text, text, text, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- E4.06 — Engineering approval requirements
-- ----------------------------------------------------------------------------
create table if not exists engineering_approval_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  change_class text not null,
  title text not null,
  required_role text not null,
  basis text not null,
  status text not null default 'draft'
    check (status in ('draft', 'adopted', 'superseded')),
  register_ref text not null default 'E4.06',
  created_at timestamptz not null default now(),
  unique (organization_id, change_class)
);

alter table engineering_approval_rules enable row level security;

drop policy if exists eng_rules_read on engineering_approval_rules;
create policy eng_rules_read on engineering_approval_rules
  for select to authenticated using (organization_id = app_current_org());

alter table recommendations
  add column if not exists change_class text,
  add column if not exists engineering_signed_by uuid references auth.users(id),
  add column if not exists engineering_signed_at timestamptz,
  add column if not exists engineering_note text;

insert into engineering_approval_rules (organization_id, change_class, title, required_role, basis)
select o.id, v.c, v.t, v.r, v.b
from organizations o
cross join (values
  ('pm_interval_change', 'Change to a preventive-maintenance interval', 'reliability_engineer',
   'Proposed: an interval change alters risk exposure between interventions and must be reasoned from failure history, not cost.'),
  ('operating_limit_change', 'Change to an equipment operating limit', 'reliability_engineer',
   'Proposed: operating limits are design constraints. Confirm against OEM documentation and the operator''s engineering procedure before adoption.'),
  ('material_substitution', 'Substitution of a specified material or component', 'reliability_engineer',
   'Proposed: substitutions change failure behaviour and warranty position.'),
  ('repair_vs_replace', 'Major repair versus replacement decision', 'reliability_engineer',
   'Proposed: a lifecycle decision with capital consequences; engineering assessment precedes the commercial one.')
) as v(c, t, r, b)
where not exists (
  select 1 from engineering_approval_rules e
  where e.organization_id = o.id and e.change_class = v.c
);

create or replace function public.sign_engineering_review(
  p_recommendation_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  r recommendations%rowtype;
  e engineering_approval_rules%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();

  select * into r from recommendations
  where id = p_recommendation_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'recommendation not found');
  end if;
  if r.change_class is null then
    return jsonb_build_object('error', 'this recommendation carries no engineering change class');
  end if;

  select * into e from engineering_approval_rules
  where organization_id = v_org and change_class = r.change_class;
  if not found then
    return jsonb_build_object('error', 'no engineering rule for change class ' || r.change_class);
  end if;
  if v_role is distinct from e.required_role and v_role not in ('admin', 'ai_admin') then
    return jsonb_build_object('error',
      format('%s requires sign-off by the %s role', e.title, e.required_role));
  end if;
  if coalesce(length(trim(p_note)), 0) < 20 then
    return jsonb_build_object('error',
      'record the engineering basis for this sign-off (20 characters minimum)');
  end if;

  update recommendations
  set engineering_signed_by = auth.uid(), engineering_signed_at = now(),
      engineering_note = trim(p_note)
  where id = p_recommendation_id;

  return jsonb_build_object('signed', p_recommendation_id, 'change_class', r.change_class);
end
$$;

grant execute on function public.sign_engineering_review(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- The authority trigger, extended: engineering sign-off, and risk acceptance
-- as the legitimate escape valve above the risk ceiling
-- ----------------------------------------------------------------------------
create or replace function public.enforce_authority_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  l authority_limits%rowtype;
  e engineering_approval_rules%rowtype;
  v_accept risk_acceptances%rowtype;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select role into v_role from user_profiles where id = auth.uid();

  -- E4.06: engineering sign-off is required of everyone, administrators
  -- included. It is a competence requirement, not a permission one.
  if new.change_class is not null then
    select * into e from engineering_approval_rules
    where organization_id = new.organization_id and change_class = new.change_class;
    if found and new.engineering_signed_at is null then
      raise exception
        'Engineering approval: "%" requires sign-off by the % role before approval.',
        e.title, e.required_role using errcode = 'check_violation';
    end if;
  end if;

  if v_role in ('admin', 'ai_admin') then
    return new;   -- platform administration is audited separately
  end if;

  select * into l from authority_limits
  where organization_id = new.organization_id
    and role_key = v_role and status = 'adopted'
  order by version desc limit 1;

  if not found then
    return new;   -- the organization has not delegated in amounts yet
  end if;

  if l.max_commitment_usd is not null then
    if new.estimated_cost_usd is null then
      raise exception
        'Delegation of authority: % holds a % ceiling of $%; this recommendation states no cost, so authority cannot be verified. Record estimated_cost_usd or escalate to %.',
        v_role, l.tier_label, l.max_commitment_usd, coalesce(l.escalates_to_role, 'a higher authority')
        using errcode = 'check_violation';
    end if;
    if new.estimated_cost_usd > l.max_commitment_usd then
      raise exception
        'Delegation of authority: $% exceeds the % ceiling of $% for %. Escalate to %.',
        new.estimated_cost_usd, l.tier_label, l.max_commitment_usd, v_role,
        coalesce(l.escalates_to_role, 'the board')
        using errcode = 'check_violation';
    end if;
  end if;

  if l.max_risk_level is not null and new.risk_impact is not null
     and risk_rank(new.risk_impact) > risk_rank(l.max_risk_level) then
    -- E4.04: an active, unexpired acceptance signed by someone whose own
    -- ceiling covers this risk is the legitimate way past the ceiling. Without
    -- one, the ceiling holds.
    select * into v_accept from risk_acceptances
    where organization_id = new.organization_id
      and subject_type = 'recommendation' and subject_id = new.id
      and status = 'active' and expires_at > now()
      and risk_rank(risk_level) >= risk_rank(new.risk_impact)
    order by accepted_at desc limit 1;

    if not found then
      raise exception
        'Delegation of authority: % risk exceeds the % ceiling of % for %. Escalate to %, or record a risk acceptance signed at that level.',
        new.risk_impact, l.tier_label, l.max_risk_level, v_role,
        coalesce(l.escalates_to_role, 'the board')
        using errcode = 'check_violation';
    end if;
  end if;

  new.authority_cleared_by := auth.uid();
  new.authority_cleared_at := now();
  return new;
end
$$;

-- Expire time-bounded governance instruments. Hourly, alongside the other
-- governance jobs — an expired variance or acceptance that still reads
-- 'active' is worse than none, because it looks like cover.
create or replace function public.expire_governance_instruments()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_var int;
  v_risk int;
begin
  with x as (
    update standard_site_variances set status = 'expired'
    where status = 'approved' and expires_at is not null and expires_at <= now()
    returning 1)
  select count(*) into v_var from x;

  with y as (
    update risk_acceptances set status = 'expired'
    where status = 'active' and expires_at <= now()
    returning 1)
  select count(*) into v_risk from y;

  return jsonb_build_object('variances_expired', v_var, 'risk_acceptances_expired', v_risk);
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire-governance-instruments')
    where exists (select 1 from cron.job where jobname = 'expire-governance-instruments');
    perform cron.schedule('expire-governance-instruments', '7 * * * *',
      $cron$select public.expire_governance_instruments();$cron$);
  end if;
exception when others then null;
end $$;

create or replace function public.get_governance_standards()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  return jsonb_build_object(
    'standards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'standard_key', s.standard_key, 'title', s.title,
        'requirement', s.requirement, 'mandatory', s.mandatory,
        'owner_role', s.owner_role, 'variance_approver_role', s.variance_approver_role,
        'status', s.status, 'basis', s.basis,
        'variances', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', v.id, 'site', si.name, 'status', v.status,
            'justification', v.justification,
            'compensating_controls', v.compensating_controls,
            'expires_at', v.expires_at, 'decision_note', v.decision_note)
            order by v.requested_at desc), '[]'::jsonb)
          from standard_site_variances v
          join sites si on si.id = v.site_id
          where v.standard_id = s.id and v.status in ('pending', 'approved'))
      ) order by s.mandatory desc, s.title), '[]'::jsonb)
      from governance_standards s
      where s.organization_id = v_org and s.status in ('draft', 'adopted')),
    'risk_acceptances', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ra.id, 'subject_type', ra.subject_type, 'risk_level', ra.risk_level,
        'accepted_role', ra.accepted_role, 'accepted_at', ra.accepted_at,
        'expires_at', ra.expires_at, 'status', ra.status,
        'rationale', ra.rationale, 'compensating_controls', ra.compensating_controls)
        order by ra.accepted_at desc), '[]'::jsonb)
      from risk_acceptances ra
      where ra.organization_id = v_org and ra.status = 'active'),
    'engineering_rules', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'change_class', change_class, 'title', title,
        'required_role', required_role, 'basis', basis)
        order by title), '[]'::jsonb)
      from engineering_approval_rules where organization_id = v_org));
end
$$;

grant execute on function public.get_governance_standards() to authenticated;

notify pgrst, 'reload schema';
