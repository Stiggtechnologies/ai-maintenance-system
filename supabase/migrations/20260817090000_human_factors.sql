-- ============================================================================
-- Human factors and workforce (capability register E6.01–E6.14, C2.08).
--
-- The scheduler in this platform already knows how many hours a craft can
-- deliver in a week, because craft_capacity was built to hold the operator's
-- real number rather than a headcount guess. What it does not know is anything
-- about the people behind that number: who is qualified to do the work, who is
-- the only person qualified, who has been on shift for eleven days, and who
-- retires in eighteen months taking the only knowledge of a critical machine
-- with them.
--
-- TWO DESIGN STANCES THAT ARE NOT NEGOTIABLE HERE.
--
-- 1. HUMAN-PERFORMANCE EVENTS DO NOT REFERENCE THE PERSON.
--
--    human_performance_events has no worker column, and that is deliberate
--    rather than an omission. An error-analysis table keyed to individuals
--    becomes a disciplinary record, people stop reporting, and the data that
--    would have prevented the next event stops existing. What is recorded is
--    the error TYPE and the CONDITIONS that made it likely — time on shift,
--    procedure quality, supervision, tooling — because those are what can be
--    changed. The register asks for human-performance error analysis; this is
--    the only version of it that keeps working after the first hard case.
--
-- 2. THE WORKFORCE TABLE HOLDS THE MINIMUM.
--
--    An employee reference and a display name, no contact details, no personal
--    data beyond what rostering needs. It is RLS-scoped like everything else,
--    and any demo rows are obviously fictional.
--
-- THE FINDING THIS SLICE EXISTS FOR. Single points of knowledge. The U2 slice
-- found the assets whose loss stops other assets; this finds the PEOPLE whose
-- absence stops work — the sole holder of a statutory authorisation, the one
-- person who can commission the AHS system — and, where a retirement date is
-- recorded, when that becomes a certainty rather than a risk.
--
-- Canonical reuse: craft_capacity (extended in place with an actual-vs-
-- theoretical view rather than replaced), job_plans and job_plan crafts from
-- the planning slice, work_orders, sites, organizations, app_current_org().
-- Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- E6.01 — competencies as master data
-- ---------------------------------------------------------------------------
create table if not exists competencies (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  competency_key text not null,
  title text not null,
  kind text not null check (kind in
    ('certification', 'licence', 'statutory_authorisation', 'skill', 'familiarisation')),
  issuing_body text,
  -- Null means it does not expire. Anything statutory almost always does.
  validity_months int check (validity_months is null or validity_months > 0),
  -- A statutory item cannot be waived by a supervisor in a hurry.
  is_statutory boolean not null default false,
  description text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_comp_key
  on competencies(organization_id, competency_key);

alter table competencies enable row level security;
drop policy if exists comp_read on competencies;
create policy comp_read on competencies
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- The workforce. Minimum viable personal data, by design.
-- ---------------------------------------------------------------------------
create table if not exists workforce_members (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  employee_ref text not null,
  display_name text not null,
  craft text,
  -- E6.06: contractors are workforce too, and their qualification is the
  -- same question asked of a different employer.
  employment_type text not null default 'employee' check (employment_type in
    ('employee', 'contractor', 'agency', 'oem_specialist')),
  employer text,
  fte numeric not null default 1.0 check (fte > 0 and fte <= 1.5),
  hired_on date,
  -- E6.10. Recorded where known; absence is reported rather than assumed away.
  expected_departure date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_wm_ref
  on workforce_members(organization_id, employee_ref);
create index if not exists idx_wm_craft
  on workforce_members(organization_id, craft) where active;

alter table workforce_members enable row level security;
drop policy if exists wm_read on workforce_members;
create policy wm_read on workforce_members
  for select to authenticated using (organization_id = app_current_org());

create table if not exists member_competencies (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  member_id bigint not null references workforce_members(id) on delete cascade,
  competency_id bigint not null references competencies(id) on delete cascade,
  granted_on date not null,
  expires_on date,
  verified_by uuid references auth.users(id) on delete set null,
  evidence_reference text,
  created_at timestamptz not null default now(),
  check (expires_on is null or expires_on >= granted_on)
);

create unique index if not exists idx_mc_pair
  on member_competencies(member_id, competency_id);
create index if not exists idx_mc_expiry
  on member_competencies(organization_id, expires_on) where expires_on is not null;

alter table member_competencies enable row level security;
drop policy if exists mc_read on member_competencies;
create policy mc_read on member_competencies
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E6.02 — training and apprenticeship plans
-- ---------------------------------------------------------------------------
create table if not exists training_plans (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  member_id bigint not null references workforce_members(id) on delete cascade,
  competency_id bigint not null references competencies(id) on delete cascade,
  plan_kind text not null check (plan_kind in
    ('apprenticeship', 'requalification', 'cross_training', 'succession')),
  target_date date,
  status text not null default 'planned' check (status in
    ('planned', 'in_progress', 'complete', 'abandoned')),
  -- The reason it exists. A succession plan with no named risk is a wish.
  driver text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tp_member
  on training_plans(organization_id, member_id, status);

alter table training_plans enable row level security;
drop policy if exists tp_read on training_plans;
create policy tp_read on training_plans
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E6.03 — human-performance events. NOTE THE ABSENCE OF A PERSON COLUMN.
--
-- This table describes conditions, not people. Adding a member_id here would
-- turn error analysis into a disciplinary record, and the reporting that makes
-- it useful would stop within a month. What is actionable is the condition.
-- ---------------------------------------------------------------------------
create table if not exists human_performance_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  work_order_id uuid references work_orders(id) on delete set null,
  occurred_at timestamptz not null default now(),
  -- Reason/Rasmussen classification. Skill/rule/knowledge, plus violation.
  error_type text not null check (error_type in
    ('slip', 'lapse', 'rule_based_mistake', 'knowledge_based_mistake',
     'routine_violation', 'situational_violation')),
  outcome_severity text check (outcome_severity in
    ('near_miss', 'minor', 'moderate', 'serious')),
  -- The conditions that made it likely. These are what can be changed.
  hours_on_shift numeric check (hours_on_shift >= 0),
  consecutive_days_worked int check (consecutive_days_worked >= 0),
  procedure_available boolean,
  procedure_accurate boolean,
  correct_tooling_available boolean,
  first_time_performing_task boolean,
  supervision_present boolean,
  time_pressure text check (time_pressure in ('none', 'moderate', 'high')),
  contributing_conditions text,
  corrective_action text,
  created_at timestamptz not null default now()
);

create index if not exists idx_hpe_org
  on human_performance_events(organization_id, occurred_at desc);

alter table human_performance_events enable row level security;
drop policy if exists hpe_read on human_performance_events;
create policy hpe_read on human_performance_events
  for select to authenticated using (organization_id = app_current_org());

comment on table human_performance_events is
  'Deliberately has no worker reference. Error analysis keyed to individuals '
  'becomes a disciplinary record and reporting stops. Conditions are what can '
  'be changed; add a person column and this table stops working.';

-- ---------------------------------------------------------------------------
-- E6.04 / E6.07 — rosters, and the labour rules that bound them
-- ---------------------------------------------------------------------------
create table if not exists shift_assignments (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  member_id bigint not null references workforce_members(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  shift_kind text not null default 'day' check (shift_kind in
    ('day', 'night', 'swing', 'callout', 'overtime', 'training', 'leave')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_sa_member
  on shift_assignments(organization_id, member_id, starts_at desc);

alter table shift_assignments enable row level security;
drop policy if exists sa_read on shift_assignments;
create policy sa_read on shift_assignments
  for select to authenticated using (organization_id = app_current_org());

create table if not exists labour_rules (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_key text not null,
  title text not null,
  -- Where the limit comes from decides whether it can be flexed at all.
  source text not null check (source in
    ('statutory', 'labour_agreement', 'company_standard', 'fatigue_science')),
  limit_kind text not null check (limit_kind in
    ('max_consecutive_days', 'max_hours_per_shift', 'min_rest_hours_between_shifts',
     'max_hours_per_7_days', 'max_hours_per_14_days', 'max_consecutive_nights')),
  limit_value numeric not null check (limit_value > 0),
  applies_to_craft text,
  reference text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_lr_key
  on labour_rules(organization_id, rule_key);

alter table labour_rules enable row level security;
drop policy if exists lr_read on labour_rules;
create policy lr_read on labour_rules
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E6.05 — crew composition, E6.08 — specialised tools
-- ---------------------------------------------------------------------------
create table if not exists crew_templates (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  template_key text not null,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_ct_key
  on crew_templates(organization_id, template_key);

create table if not exists crew_template_roles (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id bigint not null references crew_templates(id) on delete cascade,
  role_label text not null,
  craft text,
  headcount int not null default 1 check (headcount > 0),
  required_competency_id bigint references competencies(id) on delete set null,
  -- A safety-attendant role is not a nice-to-have that can be dropped when
  -- the crew is short.
  is_mandatory boolean not null default true
);

create index if not exists idx_ctr_template on crew_template_roles(template_id);

create table if not exists specialised_tools (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  tool_key text not null,
  title text not null,
  quantity_available int not null default 1 check (quantity_available >= 0),
  -- The constraint people forget: the tool exists and nobody is licensed on it.
  required_competency_id bigint references competencies(id) on delete set null,
  lead_time_days int,
  owned_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_st_key
  on specialised_tools(organization_id, tool_key);

alter table crew_templates enable row level security;
alter table crew_template_roles enable row level security;
alter table specialised_tools enable row level security;
drop policy if exists ct_read on crew_templates;
create policy ct_read on crew_templates
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists ctr_read on crew_template_roles;
create policy ctr_read on crew_template_roles
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists st_read on specialised_tools;
create policy st_read on specialised_tools
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E6.09 / E6.10 — knowledge areas and who actually holds them
-- ---------------------------------------------------------------------------
create table if not exists knowledge_areas (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  area_key text not null,
  title text not null,
  -- What stops if nobody holds this.
  consequence_if_lost text not null,
  criticality text not null default 'medium' check (criticality in
    ('critical', 'high', 'medium', 'low')),
  documented_where text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_ka_key
  on knowledge_areas(organization_id, area_key);

create table if not exists knowledge_holders (
  area_id bigint not null references knowledge_areas(id) on delete cascade,
  member_id bigint not null references workforce_members(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  depth text not null default 'competent' check (depth in
    ('aware', 'competent', 'expert')),
  primary key (area_id, member_id)
);

alter table knowledge_areas enable row level security;
alter table knowledge_holders enable row level security;
drop policy if exists ka_read on knowledge_areas;
create policy ka_read on knowledge_areas
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists kh_read on knowledge_holders;
create policy kh_read on knowledge_holders
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E6.11 / E6.12 — standard work and its translations
-- ---------------------------------------------------------------------------
create table if not exists standard_work (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  work_key text not null,
  title text not null,
  craft text,
  -- The measured time, and how it was arrived at. A standard time with no
  -- basis is an estimate someone will later be held to.
  standard_minutes numeric check (standard_minutes > 0),
  basis text,
  crew_template_id bigint references crew_templates(id) on delete set null,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_sw_key
  on standard_work(organization_id, work_key, version);

create table if not exists procedure_translations (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  standard_work_id bigint not null references standard_work(id) on delete cascade,
  language_code text not null,
  content text not null,
  -- A machine translation of a safety-critical procedure is not a translation.
  translation_status text not null default 'draft' check (translation_status in
    ('draft', 'machine_translated', 'human_verified')),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (translation_status <> 'human_verified' or verified_at is not null)
);

create unique index if not exists idx_pt_lang
  on procedure_translations(standard_work_id, language_code);

alter table standard_work enable row level security;
alter table procedure_translations enable row level security;
drop policy if exists sw_read on standard_work;
create policy sw_read on standard_work
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists pt_read on procedure_translations;
create policy pt_read on procedure_translations
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E6.14 — actual capacity, not theoretical hours.
--
-- Extends craft_capacity rather than replacing it: that table already holds
-- the operator's delivered-hours figure. This records what was DEDUCTED to
-- reach it, so the number can be argued with instead of merely believed.
-- ---------------------------------------------------------------------------
create table if not exists capacity_deductions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  craft text not null,
  deduction_kind text not null check (deduction_kind in
    ('leave', 'training', 'sickness', 'indirect_time', 'travel',
     'toolbox_and_permits', 'standby', 'vacancy')),
  weekly_hours numeric not null check (weekly_hours >= 0),
  basis text not null,
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_cd_craft
  on capacity_deductions(organization_id, craft, effective_from desc);

alter table capacity_deductions enable row level security;
drop policy if exists cd_read on capacity_deductions;
create policy cd_read on capacity_deductions
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
drop function if exists get_workforce_posture();
create or replace function get_workforce_posture()
returns table (
  members_total bigint,
  contractors bigint,
  competencies_defined bigint,
  competency_grants bigint,
  expired_competencies bigint,
  expiring_90d bigint,
  statutory_expired bigint,
  knowledge_areas_defined bigint,
  single_point_areas bigint,
  members_with_departure_date bigint,
  roster_rows bigint,
  labour_rules_defined bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  m as (
    select count(*) filter (where active)::bigint n,
           count(*) filter (where active and employment_type <> 'employee')::bigint contractors,
           count(*) filter (where active and expected_departure is not null)::bigint leaving
    from workforce_members where organization_id = (select id from org)
  ),
  c as (select count(*)::bigint n from competencies where organization_id = (select id from org)),
  g as (
    select count(*)::bigint n,
           count(*) filter (where expires_on is not null and expires_on < current_date)::bigint expired,
           count(*) filter (where expires_on is not null
                              and expires_on between current_date and current_date + 90)::bigint expiring
    from member_competencies where organization_id = (select id from org)
  ),
  se as (
    select count(*)::bigint n
    from member_competencies mc
    join competencies cc on cc.id = mc.competency_id
    where mc.organization_id = (select id from org)
      and cc.is_statutory and mc.expires_on is not null and mc.expires_on < current_date
  ),
  k as (select count(*)::bigint n from knowledge_areas where organization_id = (select id from org)),
  sp as (
    select count(*)::bigint n from (
      select ka.id from knowledge_areas ka
      left join knowledge_holders kh on kh.area_id = ka.id
      left join workforce_members wm on wm.id = kh.member_id and wm.active
      where ka.organization_id = (select id from org)
      group by ka.id
      having count(wm.id) <= 1
    ) x
  ),
  r as (select count(*)::bigint n from shift_assignments where organization_id = (select id from org)),
  lr as (select count(*)::bigint n from labour_rules where organization_id = (select id from org))
  select m.n, m.contractors, c.n, g.n, g.expired, g.expiring, se.n,
         k.n, sp.n, m.leaving, r.n, lr.n,
    case
      when m.n = 0 then
        'No workforce is recorded. Every capacity figure in the scheduler is therefore an '
        || 'aggregate with nobody behind it: the platform can say a craft has 320 hours and '
        || 'cannot say whether anyone holding the required authorisation is available in them.'
      else
        m.n || ' active worker(s), ' || m.contractors || ' of them not direct employees. '
        || case when c.n = 0
                then 'No competencies are defined, so no work can be checked against a qualification.'
                else g.n || ' competency grant(s) across ' || c.n || ' defined competencies' ||
                     case when g.expired > 0 then ', ' || g.expired || ' expired' else '' end ||
                     case when g.expiring > 0 then ', ' || g.expiring || ' expiring within 90 days' else '' end ||
                     '.' end
    end
    || case when se.n > 0 then ' ' || se.n
            || ' EXPIRED STATUTORY authorisation(s) — these cannot be waived by a supervisor.' else '' end
    || case when sp.n > 0 then ' ' || sp.n
            || ' knowledge area(s) have one holder or none: the workforce equivalent of a single '
            || 'point of failure.' else '' end
    || case when r.n = 0 then ' No roster data is recorded, so fatigue exposure cannot be assessed at all.'
            else '' end
  from m, c, g, se, k, sp, r, lr;
$$;

grant execute on function get_workforce_posture() to authenticated;

-- Knowledge areas with too few holders, and when that becomes certain.
create or replace function get_knowledge_risk()
returns table (
  area_title text,
  criticality text,
  consequence_if_lost text,
  holder_count bigint,
  holders text,
  earliest_departure date,
  documented_where text,
  has_succession_plan boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select ka.title, ka.criticality, ka.consequence_if_lost,
         count(wm.id)::bigint,
         coalesce(string_agg(wm.display_name, ', ' order by wm.display_name), '(nobody)'),
         min(wm.expected_departure),
         ka.documented_where,
         exists (
           select 1 from training_plans tp
           where tp.organization_id = ka.organization_id
             and tp.plan_kind in ('succession', 'cross_training')
             and tp.status in ('planned', 'in_progress')
         )
  from knowledge_areas ka
  left join knowledge_holders kh on kh.area_id = ka.id
  left join workforce_members wm on wm.id = kh.member_id and wm.active
  where ka.organization_id = app_current_org()
  group by ka.id, ka.title, ka.criticality, ka.consequence_if_lost,
           ka.documented_where, ka.organization_id
  having count(wm.id) <= 2
  order by count(wm.id),
           case ka.criticality when 'critical' then 1 when 'high' then 2
                               when 'medium' then 3 else 4 end;
$$;

grant execute on function get_knowledge_risk() to authenticated;

-- Roster rows for the fatigue engine, plus the rules to test them against.
create or replace function get_roster_window(p_days int default 21)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ruleKey', rule_key, 'title', title, 'source', source,
        'limitKind', limit_kind, 'limitValue', limit_value,
        'appliesToCraft', applies_to_craft, 'reference', reference))
      from labour_rules where organization_id = app_current_org()
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'memberId', wm.id, 'displayName', wm.display_name, 'craft', wm.craft,
        'shifts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'startsAt', sa.starts_at, 'endsAt', sa.ends_at, 'shiftKind', sa.shift_kind)
            order by sa.starts_at)
          from shift_assignments sa
          where sa.member_id = wm.id
            and sa.starts_at >= now() - make_interval(days => greatest(1, least(p_days, 120)))
        ), '[]'::jsonb)))
      from workforce_members wm
      where wm.organization_id = app_current_org() and wm.active
        and exists (select 1 from shift_assignments s where s.member_id = wm.id)
    ), '[]'::jsonb)
  );
$$;

grant execute on function get_roster_window(int) to authenticated;

-- E6.14 — theoretical against actual, with the deductions itemised.
create or replace function get_craft_capacity_reconciliation()
returns table (
  craft text,
  declared_weekly_hours numeric,
  deductions_total numeric,
  deduction_detail jsonb,
  headcount bigint,
  theoretical_weekly_hours numeric,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  cap as (
    select distinct on (craft) craft, weekly_hours, basis
    from craft_capacity where organization_id = (select id from org)
    order by craft, effective_from desc
  ),
  ded as (
    select craft, sum(weekly_hours) total,
           jsonb_agg(jsonb_build_object('kind', deduction_kind,
                                        'hours', weekly_hours, 'basis', basis)) detail
    from capacity_deductions where organization_id = (select id from org)
    group by craft
  ),
  hc as (
    select craft, count(*)::bigint n, sum(fte) fte
    from workforce_members
    where organization_id = (select id from org) and active and craft is not null
    group by craft
  )
  select coalesce(cap.craft, ded.craft, hc.craft),
         cap.weekly_hours,
         coalesce(ded.total, 0),
         coalesce(ded.detail, '[]'::jsonb),
         coalesce(hc.n, 0),
         coalesce(hc.fte, 0) * 40,
         case
           when cap.weekly_hours is null then
             'No delivered-hours figure is recorded for this craft, so the scheduler has nothing to '
             || 'constrain against.'
           when hc.n is null or hc.n = 0 then
             'A delivered-hours figure exists with no workforce recorded behind it. The number may be '
             || 'right; nothing in the platform can check it.'
           when ded.total is null then
             'Delivered hours are recorded but the deductions behind them are not, so the gap between '
             || round(coalesce(hc.fte, 0) * 40, 1) || ' theoretical hours and ' || cap.weekly_hours
             || ' delivered is unexplained rather than justified.'
           else
             round(coalesce(hc.fte, 0) * 40, 1) || ' theoretical hours less ' || ded.total
             || ' itemised deduction hours leaves ' || round(coalesce(hc.fte, 0) * 40 - ded.total, 1)
             || '; the operator declares ' || cap.weekly_hours || '.'
             || case when abs(coalesce(hc.fte, 0) * 40 - ded.total - cap.weekly_hours) > 4
                     then ' Those do not reconcile, and the declared figure is the one the scheduler uses.'
                     else '' end
         end
  from cap
  full outer join ded on ded.craft = cap.craft
  full outer join hc on hc.craft = coalesce(cap.craft, ded.craft)
  order by 1;
$$;

grant execute on function get_craft_capacity_reconciliation() to authenticated;

notify pgrst, 'reload schema';
