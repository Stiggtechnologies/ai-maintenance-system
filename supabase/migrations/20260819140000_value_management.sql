-- ============================================================================
-- Financial and value-management controls (register E9.01–E9.08, E9.11).
--
-- The accountability cascade slice gave the boardroom a KPI view. This gives
-- it the arithmetic underneath, and the arithmetic has one rule the rest of
-- this platform now enforces everywhere: say what the number rests on.
--
-- THE ERROR THIS EXISTS TO PREVENT. Comparing the NPV of a 10-year option
-- against the NPV of a 20-year option is a category error that looks like
-- analysis — the longer option accumulates more value simply by lasting
-- longer. compareOptions REFUSES to rank on NPV when lives differ and uses
-- equivalent annual value instead, reporting whether the naive ranking would
-- have chosen differently.
--
-- A SECOND ONE. A capital list ordered by benefit is not a prioritisation.
-- Under a budget, ranking by benefit PER UNIT COST fits more value in, and the
-- difference is reported as a number rather than left as a principle.
--
-- Canonical reuse: asset_economics and lifecycle_evaluations from the
-- lifecycle-decisions slice, value_metrics and board_packs from the baseline
-- and accountability slices, capital_projects from E8, assets,
-- app_current_org(). Additive.
-- ============================================================================

create table if not exists financial_assumptions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  assumption_key text not null,
  label text not null,
  value numeric not null,
  unit text,
  -- An assumption with no source is a number somebody liked.
  source text not null,
  effective_from date not null default current_date,
  review_due date,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_finassum_key
  on financial_assumptions(organization_id, assumption_key, effective_from);

create table if not exists business_cases (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id bigint references capital_projects(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  case_ref text not null,
  title text not null,
  driver text not null check (driver in
    ('safety', 'regulatory', 'reliability', 'capacity', 'cost_reduction',
     'obsolescence', 'environmental')),
  discount_rate numeric not null check (discount_rate >= 0 and discount_rate < 1),
  -- Where the rate came from. A discount rate nobody owns quietly decides
  -- every long-dated decision in the organisation.
  discount_rate_source text,
  status text not null default 'draft' check (status in
    ('draft', 'submitted', 'approved', 'rejected', 'superseded')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_bcase_ref
  on business_cases(organization_id, case_ref);

create table if not exists business_case_options (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  case_id bigint not null references business_cases(id) on delete cascade,
  label text not null,
  -- Service life matters: options of different lives cannot be compared on NPV.
  life_periods int not null check (life_periods > 0),
  -- Negative for cost, positive for benefit, keyed by period.
  cash_flows jsonb not null default '[]',
  -- E9.03: the probability the benefit actually lands.
  benefit_probability numeric check (benefit_probability > 0 and benefit_probability <= 1),
  is_do_nothing boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bcopt_case on business_case_options(case_id);

create table if not exists capital_plan_items (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  plan_year int not null,
  case_id bigint references business_cases(id) on delete set null,
  label text not null,
  cost numeric not null check (cost >= 0),
  benefit_present_value numeric,
  -- Some things are not optional and should not compete on benefit-cost.
  mandatory boolean not null default false,
  mandatory_basis text,
  created_at timestamptz not null default now(),
  check (not mandatory or (mandatory_basis is not null and btrim(mandatory_basis) <> ''))
);

create index if not exists idx_capplan_year
  on capital_plan_items(organization_id, plan_year);

create table if not exists budget_lines (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  budget_year int not null,
  category text not null check (category in
    ('labour', 'materials', 'contract', 'capital', 'overhaul', 'other')),
  budgeted numeric not null,
  committed numeric not null default 0,
  actual numeric not null default 0,
  -- Forecast at completion, and what it rests on.
  forecast numeric,
  forecast_basis text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_budget_key
  on budget_lines(organization_id, budget_year, category, site_id)
  nulls not distinct;

alter table financial_assumptions enable row level security;
alter table business_cases enable row level security;
alter table business_case_options enable row level security;
alter table capital_plan_items enable row level security;
alter table budget_lines enable row level security;
drop policy if exists finassum_read on financial_assumptions;
create policy finassum_read on financial_assumptions
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists bcase_read on business_cases;
create policy bcase_read on business_cases
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists bcopt_read on business_case_options;
create policy bcopt_read on business_case_options
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists capplan_read on capital_plan_items;
create policy capplan_read on capital_plan_items
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists budget_read on budget_lines;
create policy budget_read on budget_lines
  for select to authenticated using (organization_id = app_current_org());

drop function if exists get_value_posture();
create or replace function get_value_posture()
returns table (
  assumptions_defined bigint,
  assumptions_without_review bigint,
  cases_total bigint,
  cases_with_do_nothing bigint,
  cases_mixed_lives bigint,
  plan_items bigint,
  plan_items_without_benefit bigint,
  mandatory_items bigint,
  budget_lines bigint,
  budget_lines_without_forecast_basis bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  a as (
    select count(*)::bigint n,
           count(*) filter (where review_due is null)::bigint no_review
    from financial_assumptions where organization_id = (select id from org)
  ),
  c as (
    select count(*)::bigint n,
           count(*) filter (where exists (
             select 1 from business_case_options o
             where o.case_id = bc.id and o.is_do_nothing))::bigint with_dn,
           count(*) filter (where (
             select count(distinct o.life_periods) from business_case_options o
             where o.case_id = bc.id) > 1)::bigint mixed
    from business_cases bc where bc.organization_id = (select id from org)
  ),
  p as (
    select count(*)::bigint n,
           count(*) filter (where benefit_present_value is null and not mandatory)::bigint no_benefit,
           count(*) filter (where mandatory)::bigint mand
    from capital_plan_items where organization_id = (select id from org)
  ),
  b as (
    select count(*)::bigint n,
           count(*) filter (where forecast is not null
                              and (forecast_basis is null or btrim(forecast_basis) = ''))::bigint no_basis
    from budget_lines where organization_id = (select id from org)
  )
  select a.n, a.no_review, c.n, c.with_dn, c.mixed, p.n, p.no_benefit, p.mand,
         b.n, b.no_basis,
    case
      when c.n = 0 and p.n = 0 and b.n = 0 then
        'No business cases, capital plan or budget is recorded. The platform can rank work by risk '
        || 'and cannot yet say what any of it costs or returns, which is the language the decision '
        || 'is actually taken in.'
      else
        c.n || ' business case(s), ' || p.n || ' capital plan item(s), ' || b.n || ' budget line(s).'
        || case when c.n > 0 and c.with_dn < c.n then ' ' || (c.n - c.with_dn)
                || ' case(s) carry NO do-nothing option — without one there is nothing to justify '
                || 'spending against.' else '' end
        || case when c.mixed > 0 then ' ' || c.mixed
                || ' case(s) compare options of DIFFERENT service lives, where raw NPV is not a valid '
                || 'comparison; those are ranked on equivalent annual value instead.' else '' end
    end
    || case when p.no_benefit > 0 then ' ' || p.no_benefit
            || ' non-mandatory plan item(s) have no benefit value, so they cannot be prioritised '
            || 'against anything — only funded or not.' else '' end
    || case when b.no_basis > 0 then ' ' || b.no_basis
            || ' budget forecast(s) state no basis.' else '' end
    || case when a.no_review > 0 then ' ' || a.no_review
            || ' financial assumption(s) have no review date; a discount rate nobody revisits quietly '
            || 'decides every long-dated decision in the organisation.' else '' end
  from a, c, p, b;
$$;

grant execute on function get_value_posture() to authenticated;

create or replace function get_business_case(p_case_ref text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'caseRef', bc.case_ref, 'title', bc.title, 'driver', bc.driver,
    'discountRate', bc.discount_rate, 'discountRateSource', bc.discount_rate_source,
    'status', bc.status,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', o.label, 'lifePeriods', o.life_periods,
        'cashFlows', o.cash_flows, 'benefitProbability', o.benefit_probability,
        'isDoNothing', o.is_do_nothing, 'notes', o.notes) order by o.label)
      from business_case_options o where o.case_id = bc.id
    ), '[]'::jsonb))
  from business_cases bc
  where bc.organization_id = app_current_org() and bc.case_ref = p_case_ref;
$$;

grant execute on function get_business_case(text) to authenticated;

create or replace function get_capital_plan(p_year int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'label', label, 'cost', cost,
    'benefit', coalesce(benefit_present_value, 0),
    'mandatory', mandatory, 'mandatoryBasis', mandatory_basis) order by label), '[]'::jsonb)
  from capital_plan_items
  where organization_id = app_current_org() and plan_year = p_year;
$$;

grant execute on function get_capital_plan(int) to authenticated;

notify pgrst, 'reload schema';
