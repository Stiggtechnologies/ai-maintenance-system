-- ============================================================================
-- Sync Develop Slice 2 — Benefit with a mandatory owner (D9.10, spec §32),
-- landed on the ONE value store per overlap-map ruling 11: value_metrics IS
-- the Benefit object. "A new Benefit table beside value_metrics = a second
-- value store" — none arrives.
--
-- WHAT §32 ADDS: owner_id (spec: "Every project needs a benefit owner"),
-- objective_id (Benefit MEASURES Objective, §34), development_case_id (the
-- per-case rollup the Case Workspace renders), expected_date (a benefit
-- without a date can never be overdue — the C8.18 argument), and basis (the
-- asset_economics rule: where the number comes from).
--
-- ENFORCEMENT, AT THE PERSISTENCE BOUNDARY: a CASE-BOUND benefit without an
-- owner or a basis does not insert — CHECK constraints (no client, RLS-
-- bypassed client, or service caller can produce one), plus a BEFORE trigger
-- holding the owner to THIS organization's membership (an FK cannot). The
-- legacy operating-loop metrics (risk_exposure_reduced rows the loop writes
-- with no case binding) are NOT case benefits and pass through untouched —
-- their column stays null and their behavior is exactly yesterday's. The
-- governed write path for case benefits is record_case_benefit below; the
-- verification loop stays verify_value_metric (ruling 12 — no third
-- checkpoint store).
--
-- Canonical reuse: value_metrics + verify_value_metric (00000000000008),
-- risk_objectives, development_cases, user_profiles, audit_events. No new
-- table.
-- ============================================================================

alter table public.value_metrics
  add column if not exists owner_id uuid references user_profiles(id) on delete restrict,
  add column if not exists objective_id uuid references risk_objectives(id) on delete set null,
  add column if not exists development_case_id uuid references development_cases(id) on delete cascade,
  add column if not exists expected_date date,
  add column if not exists basis text;

-- A case benefit names its owner, its date and its basis — at the schema,
-- for every writer. (Case-bound rows are new with this migration, so there
-- is nothing to grandfather: the constraint is exact from day one.)
alter table public.value_metrics
  drop constraint if exists value_metrics_case_benefit_owner;
alter table public.value_metrics
  add constraint value_metrics_case_benefit_owner check (
    development_case_id is null
    or (owner_id is not null
        and expected_date is not null
        and basis is not null and btrim(basis) <> '')
  );

create index if not exists idx_value_metrics_case
  on value_metrics(organization_id, development_case_id)
  where development_case_id is not null;

-- The owner is a member of THIS organization, and the case the benefit is
-- bound to belongs to THIS organization — the FKs prove existence, the
-- trigger proves tenancy on both edges. Same-org is a data invariant (like
-- the objective cycle guard), so it holds for every writer, service
-- included: without the case check, the value_metrics_org_rw direct path
-- could insert an own-org benefit dangling onto another tenant's case (an
-- integrity smell even though the workspace read filters it out by org).
create or replace function public.enforce_benefit_owner_membership()
returns trigger
language plpgsql
as $$
declare
  v_owner_org uuid;
  v_case_org uuid;
begin
  if new.development_case_id is null then
    return new;
  end if;
  select organization_id into v_case_org
  from development_cases where id = new.development_case_id;
  if v_case_org is distinct from new.organization_id then
    raise exception
      'A case benefit belongs to its case''s organization — a benefit pointing at another tenant''s development case is refused for every writer.'
      using errcode = 'check_violation';
  end if;
  if new.owner_id is null then
    return new;
  end if;
  select organization_id into v_owner_org from user_profiles where id = new.owner_id;
  if v_owner_org is distinct from new.organization_id then
    raise exception
      'A benefit owner must be a member of the organization the benefit belongs to — accountability does not cross tenants.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists trg_benefit_owner_membership on public.value_metrics;
create trigger trg_benefit_owner_membership
  before insert or update on public.value_metrics
  for each row execute function public.enforce_benefit_owner_membership();

revoke all on function public.enforce_benefit_owner_membership() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The governed write path for case benefits. Projected until verified — the
-- existing verify_value_metric loop is the verification door (ruling 12).
-- ---------------------------------------------------------------------------
create or replace function public.record_case_benefit(
  p_case_id uuid,
  p_label text,
  p_expected_value numeric,
  p_unit text,
  p_expected_date date,
  p_owner_id uuid,
  p_basis text,
  p_objective_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a benefit requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'benefits are not recordable on a ' || c.status || ' case');
  end if;
  if coalesce(length(btrim(p_label)), 0) < 3 then
    return jsonb_build_object('error', 'a benefit needs a label (3 characters minimum)');
  end if;
  if p_expected_value is null then
    return jsonb_build_object('error', 'a benefit states its expected value');
  end if;
  if coalesce(length(btrim(p_unit)), 0) < 1 then
    return jsonb_build_object('error', 'a benefit value states its unit (usd, hours, percent, ...)');
  end if;
  if p_expected_date is null then
    return jsonb_build_object('error',
      'a benefit without an expected date can never be overdue — state when it is expected');
  end if;
  if p_owner_id is null or not exists (
    select 1 from user_profiles where id = p_owner_id and organization_id = v_org) then
    return jsonb_build_object('error',
      'every benefit names an owner who is a member of this organization (spec §32: "Every project needs a benefit owner")');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 10 then
    return jsonb_build_object('error',
      'a benefit without its basis is a number somebody liked — state where the expected value comes from (10 characters minimum)');
  end if;
  if p_objective_id is not null and not exists (
    select 1 from risk_objectives
    where id = p_objective_id and organization_id = v_org and status = 'adopted') then
    return jsonb_build_object('error',
      'a benefit measures an ADOPTED objective (spec §34) — adopt it first, or omit the link');
  end if;

  insert into value_metrics
    (organization_id, development_case_id, objective_id, owner_id,
     metric_type, label, value, unit, status, period,
     expected_date, basis)
  values
    (v_org, c.id, p_objective_id, p_owner_id,
     'projected_annualized_value', btrim(p_label), p_expected_value,
     btrim(p_unit), 'projected', 'per_year',
     p_expected_date, btrim(p_basis))
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_benefit', coalesce(v_role, 'unknown'),
    jsonb_build_object('benefit_id', v_id, 'case_id', c.id,
      'label', btrim(p_label), 'expected_value', p_expected_value,
      'unit', btrim(p_unit), 'expected_date', p_expected_date,
      'owner_id', p_owner_id, 'objective_id', p_objective_id));

  return jsonb_build_object('benefit_id', v_id, 'case_id', c.id,
    'status', 'projected',
    'note', 'Projected until a human verifies it (verify_value_metric) — the one verification loop.');
end
$$;

revoke all on function public.record_case_benefit(uuid, text, numeric, text, date, uuid, text, uuid) from public, anon;
grant execute on function public.record_case_benefit(uuid, text, numeric, text, date, uuid, text, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
