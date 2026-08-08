-- ============================================================================
-- The accountability cascade (capability register E4.02, E4.03, E4.12;
-- strengthens C6.01–C6.06).
--
-- Three defects in how accountability reaches the top of the organization:
--
--   1. The RACI was already complete in kpi_catalog — accountable, responsible,
--      CONSULTED and INFORMED are populated on all 29 ISO 55000 KPIs — but
--      get_kpi_dashboard() only ever returned A and R. The extended half of the
--      chain existed in the database and never reached a human. Fixed here.
--
--   2. E4.03 delegation-of-authority limits did not exist. The decision-rights
--      matrix names WHICH ROLE must approve but never UP TO WHAT VALUE. A board
--      delegates authority in amounts, not only in job titles.
--
--   3. There was no board pack: a frozen, attested, point-in-time record of what
--      the board was told. Live dashboards are not governance evidence — they
--      change after the meeting.
--
-- HONESTY CONSTRAINT ON AUTHORITY LIMITS. Monetary ceilings are a customer's
-- own policy; inventing them and enforcing them silently would be worse than
-- having none. So limits follow the taxonomy pattern from slice 4: they are
-- seeded as DRAFTS with a stated basis, and the enforcement trigger consults
-- ONLY ADOPTED limits. Until an accountable human adopts a limit, nothing is
-- blocked. Once adopted, the ceiling is enforced in the database and cannot be
-- bypassed through the API.
--
-- Canonical reuse: recommendations, kpi_catalog, kpi_values, user_profiles,
-- app_current_org(). Additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Full RACI through the API boundary
-- ----------------------------------------------------------------------------
create or replace function public.get_kpi_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  result jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();

  select coalesce(jsonb_agg(row order by row->>'page', row->>'name'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'kpi_key', c.kpi_key, 'name', c.name, 'page', c.page, 'formula', c.formula,
      'target_label', c.target_label, 'direction', c.direction, 'unit', c.unit,
      -- The complete chain, not just A and R. 'consulted' and 'informed' were
      -- populated on every catalog row but were dropped here.
      'accountable', c.accountable, 'responsible', c.responsible,
      'consulted', c.consulted, 'informed', c.informed,
      -- Which layer of the organization owns the metric, so a reader can see
      -- board-tier and crew-tier measures as distinct things.
      'accountability_tier', case
        when c.accountable in ('Board') then 'board'
        when c.accountable in ('CEO', 'CFO', 'Executive', 'Strategy') then 'executive'
        when c.accountable in ('Operations Director', 'Asset Mgmt', 'Risk Manager', 'HSE', 'Digital') then 'functional'
        else 'site' end,
      'agent_owner', c.agent_owner, 'computable', c.computable, 'source_note', c.source_note,
      'value', lv.value, 'status', lv.status, 'variance_pct', lv.variance_pct,
      'confidence', lv.confidence, 'computed_from', lv.computed_from, 'computed_at', lv.computed_at
    ) as row
    from kpi_catalog c
    left join lateral (
      select * from kpi_values kv
      where kv.organization_id = v_org and kv.kpi_key = c.kpi_key
      order by kv.computed_at desc limit 1
    ) lv on true
    where c.audience is null
       or v_role = any(c.audience)
       or v_role in ('admin', 'ai_admin')
  ) q;

  return jsonb_build_object('role', v_role, 'kpis', result);
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Delegation-of-authority limits (E4.03)
-- ----------------------------------------------------------------------------
create table if not exists authority_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  role_key text not null,               -- user_profiles.role this limit binds
  tier_label text not null,             -- human name for the layer
  -- Ceilings. NULL means "this dimension is not limited for this role".
  max_commitment_usd numeric,
  max_risk_level text check (max_risk_level in ('Low','Medium','High','Critical')),
  max_production_downtime_hours numeric,
  escalates_to_role text,               -- who holds authority above the ceiling
  basis text not null,                  -- WHY this number; never left implicit
  status text not null default 'draft'
    check (status in ('draft', 'adopted', 'superseded')),
  version int not null default 1,
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  superseded_by uuid references authority_limits(id),
  register_ref text not null default 'E4.03',
  created_at timestamptz not null default now()
);

create index if not exists idx_authority_limits_active
  on authority_limits(organization_id, role_key, status);

alter table authority_limits enable row level security;

drop policy if exists authority_limits_org_read on authority_limits;
create policy authority_limits_org_read on authority_limits
  for select to authenticated using (organization_id = app_current_org());

-- Seed the ladder as DRAFTS. These are a starting proposal drawn from the
-- decision-rights tiers already in the platform, not the customer's approved
-- delegation of authority — which is exactly what the basis text says, and
-- exactly why status is 'draft' and the trigger below ignores drafts.
insert into authority_limits (organization_id, role_key, tier_label,
  max_commitment_usd, max_risk_level, max_production_downtime_hours,
  escalates_to_role, basis)
select o.id, v.role_key, v.tier_label, v.usd, v.risk, v.downtime, v.escalates, v.basis
from organizations o
cross join (values
  ('technician', 'Crew', 0::numeric, 'Low', 0::numeric, 'maintenance_manager',
   'Proposed: execution authority only. Technicians execute released work and record results; they commit no spend. Derived from the decision-rights matrix (C5.01–C5.03), not from a customer delegation instrument.'),
  ('planner', 'Planning', 5000::numeric, 'Low', 4::numeric, 'maintenance_manager',
   'Proposed: routine materials and short windows inside an approved schedule. Placeholder amount — replace with the organization''s approved delegation of authority before adoption.'),
  ('reliability_engineer', 'Engineering', 25000::numeric, 'Medium', 8::numeric, 'maintenance_manager',
   'Proposed: strategy changes and engineering studies below capital thresholds. Placeholder amount pending the customer''s delegation instrument.'),
  ('maintenance_manager', 'Site', 100000::numeric, 'High', 24::numeric, 'executive',
   'Proposed: site-level commitments and planned outages within one shift-day. Placeholder amount pending the customer''s delegation instrument.'),
  ('executive', 'Executive', 2000000::numeric, 'Critical', 72::numeric, 'board',
   'Proposed: executive authority below the board reservation. Placeholder amount pending the customer''s delegation instrument.'),
  ('board', 'Board', null::numeric, 'Critical', null::numeric, null,
   'Proposed: matters reserved to the board carry no ceiling. Reserved-matter list must come from the board charter before adoption.')
) as v(role_key, tier_label, usd, risk, downtime, escalates, basis)
where not exists (
  select 1 from authority_limits al
  where al.organization_id = o.id and al.role_key = v.role_key
);

alter table recommendations
  add column if not exists estimated_cost_usd numeric,
  add column if not exists authority_cleared_by uuid references auth.users(id),
  add column if not exists authority_cleared_at timestamptz;

comment on column recommendations.estimated_cost_usd is
  'Numeric commitment implied by the action. financial_impact is prose for humans; this is the figure a delegation-of-authority ceiling can actually be checked against.';

create or replace function public.adopt_authority_limit(
  p_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l authority_limits%rowtype;
  v_role text;
begin
  select role into v_role from user_profiles where id = auth.uid();
  -- Adopting a delegation of authority is itself an act of authority.
  if v_role not in ('admin', 'ai_admin', 'executive') then
    return jsonb_build_object('error',
      'adopting a delegation-of-authority limit requires an executive or administrator');
  end if;

  select * into l from authority_limits
  where id = p_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'limit not found');
  end if;
  if l.status <> 'draft' then
    return jsonb_build_object('error', 'only drafts can be adopted');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error',
      'state the delegation instrument this limit comes from (10 characters minimum)');
  end if;

  update authority_limits
  set status = 'superseded', superseded_by = l.id
  where organization_id = l.organization_id and role_key = l.role_key
    and status = 'adopted';

  update authority_limits
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      basis = basis || ' | Adopted: ' || trim(p_note)
  where id = l.id;

  return jsonb_build_object('adopted', l.id, 'role_key', l.role_key);
end
$$;

grant execute on function public.adopt_authority_limit(uuid, text) to authenticated;

-- The enforced ceiling. Mirrors the safety gate: a BEFORE UPDATE trigger that
-- refuses the state change rather than a UI rule that a direct API call skips.
create or replace function public.enforce_authority_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  l authority_limits%rowtype;
  v_rank int;
  v_max_rank int;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select role into v_role from user_profiles where id = auth.uid();
  if v_role in ('admin', 'ai_admin') then
    return new;   -- platform administration is audited separately
  end if;

  select * into l from authority_limits
  where organization_id = new.organization_id
    and role_key = v_role and status = 'adopted'
  order by version desc limit 1;

  -- No ADOPTED limit for this role: the organization has not delegated in
  -- amounts yet. Nothing is invented and nothing is blocked.
  if not found then
    return new;
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

  if l.max_risk_level is not null and new.risk_impact is not null then
    v_rank := case new.risk_impact
      when 'Low' then 1 when 'Medium' then 2 when 'High' then 3 when 'Critical' then 4 else 0 end;
    v_max_rank := case l.max_risk_level
      when 'Low' then 1 when 'Medium' then 2 when 'High' then 3 when 'Critical' then 4 else 4 end;
    if v_rank > v_max_rank then
      raise exception
        'Delegation of authority: % risk exceeds the % ceiling of % for %. Escalate to %.',
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

drop trigger if exists trg_enforce_authority_limit on recommendations;
create trigger trg_enforce_authority_limit
  before update of status on recommendations
  for each row execute function public.enforce_authority_limit();

-- ----------------------------------------------------------------------------
-- 3. Board pack — a frozen, attested record of what the board was told
-- ----------------------------------------------------------------------------
create table if not exists board_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  period_label text not null,
  period_start date not null,
  period_end date not null,
  -- The frozen content. Once attested this must never be recomputed: the
  -- board's record is what the board saw, not what the data says today.
  kpi_snapshot jsonb not null,
  governance_snapshot jsonb not null,
  status text not null default 'draft'
    check (status in ('draft', 'attested', 'superseded')),
  prepared_by uuid references auth.users(id),
  prepared_at timestamptz not null default now(),
  attested_by uuid references auth.users(id),
  attested_at timestamptz,
  attestation_note text,
  register_ref text not null default 'E4.02/E4.12',
  unique (organization_id, period_label, prepared_at)
);

create index if not exists idx_board_packs_period
  on board_packs(organization_id, period_end desc);

alter table board_packs enable row level security;

-- Board packs are board-tier material: executives and administrators only.
drop policy if exists board_packs_read on board_packs;
create policy board_packs_read on board_packs
  for select to authenticated using (
    organization_id = app_current_org()
    and exists (
      select 1 from user_profiles p
      where p.id = auth.uid() and p.role in ('executive', 'admin', 'ai_admin')
    )
  );

create or replace function public.generate_board_pack(
  p_period_label text,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_kpis jsonb;
  v_gov jsonb;
  v_id uuid;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('executive', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'preparing a board pack requires an executive or administrator');
  end if;
  if p_period_end < p_period_start then
    return jsonb_build_object('error', 'period_end precedes period_start');
  end if;

  -- Board- and executive-tier KPIs with the complete accountability chain and,
  -- critically, whether each figure was measured or is still awaiting a source.
  select coalesce(jsonb_agg(jsonb_build_object(
    'kpi_key', c.kpi_key, 'name', c.name,
    'accountable', c.accountable, 'responsible', c.responsible,
    'consulted', c.consulted, 'informed', c.informed,
    'target_label', c.target_label, 'unit', c.unit,
    'measured', lv.value is not null,
    'value', lv.value, 'status', lv.status, 'variance_pct', lv.variance_pct,
    'confidence', lv.confidence, 'computed_at', lv.computed_at,
    'source_note', case when lv.value is null then c.source_note end
  ) order by c.accountable, c.name), '[]'::jsonb)
  into v_kpis
  from kpi_catalog c
  left join lateral (
    select * from kpi_values kv
    where kv.organization_id = v_org and kv.kpi_key = c.kpi_key
      and kv.computed_at::date <= p_period_end
    order by kv.computed_at desc limit 1
  ) lv on true
  where c.accountable in ('Board', 'CEO', 'CFO', 'Executive', 'Strategy');

  -- What the governance machinery did in the period. These are the numbers a
  -- board asks for when it wants to know whether the controls actually ran.
  select jsonb_build_object(
    'recommendations_raised', (
      select count(*) from recommendations
      where organization_id = v_org and created_at::date between p_period_start and p_period_end),
    'recommendations_approved', (
      select count(*) from recommendations
      where organization_id = v_org and status = 'approved'
        and updated_at::date between p_period_start and p_period_end),
    'safety_gates_pending', (
      select count(*) from recommendation_screenings
      where organization_id = v_org and requires_gatekeeper and gatekeeper_attested_at is null),
    'authority_limits_adopted', (
      select count(*) from authority_limits
      where organization_id = v_org and status = 'adopted'),
    'authority_limits_draft', (
      select count(*) from authority_limits
      where organization_id = v_org and status = 'draft'),
    'taxonomy_definitions_adopted', (
      select count(*) from taxonomy_definitions
      where organization_id = v_org and status = 'adopted')
  ) into v_gov;

  insert into board_packs (organization_id, period_label, period_start, period_end,
    kpi_snapshot, governance_snapshot, prepared_by)
  values (v_org, p_period_label, p_period_start, p_period_end, v_kpis, v_gov, auth.uid())
  returning id into v_id;

  return jsonb_build_object('board_pack_id', v_id, 'kpis', jsonb_array_length(v_kpis),
    'measured', (select count(*) from jsonb_array_elements(v_kpis) k where (k->>'measured')::boolean),
    'governance', v_gov);
end
$$;

grant execute on function public.generate_board_pack(text, date, date) to authenticated;

create or replace function public.attest_board_pack(
  p_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  b board_packs%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('executive', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'attestation requires an executive or administrator');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error',
      'an attestation must say what is being attested to (10 characters minimum)');
  end if;

  select * into b from board_packs
  where id = p_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'board pack not found');
  end if;
  if b.status <> 'draft' then
    return jsonb_build_object('error', 'this pack is already ' || b.status);
  end if;

  update board_packs
  set status = 'attested', attested_by = auth.uid(), attested_at = now(),
      attestation_note = trim(p_note)
  where id = p_id;

  return jsonb_build_object('attested', p_id, 'at', now());
end
$$;

grant execute on function public.attest_board_pack(uuid, text) to authenticated;

-- An attested pack is the board's record and is immutable thereafter.
create or replace function public.protect_attested_board_pack()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'attested'
     and (new.kpi_snapshot is distinct from old.kpi_snapshot
       or new.governance_snapshot is distinct from old.governance_snapshot
       or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end) then
    raise exception
      'Board pack % is attested; its content is the board''s record and cannot be edited. Prepare a new pack for the period.',
      old.id using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists trg_protect_attested_board_pack on board_packs;
create trigger trg_protect_attested_board_pack
  before update on board_packs
  for each row execute function public.protect_attested_board_pack();

create or replace function public.get_accountability_cascade()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();

  return jsonb_build_object(
    'role', v_role,
    'limits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'role_key', role_key, 'tier_label', tier_label,
        'max_commitment_usd', max_commitment_usd, 'max_risk_level', max_risk_level,
        'max_production_downtime_hours', max_production_downtime_hours,
        'escalates_to_role', escalates_to_role, 'basis', basis, 'status', status,
        'adopted_at', adopted_at
      ) order by coalesce(max_commitment_usd, 1e15)), '[]'::jsonb)
      from authority_limits
      where organization_id = v_org and status in ('draft', 'adopted')),
    'enforcement_note',
      'Only ADOPTED limits are enforced. Draft limits are a proposal awaiting the organization''s delegation instrument and block nothing.',
    'packs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'period_label', period_label, 'period_end', period_end,
        'status', status, 'attested_at', attested_at, 'attestation_note', attestation_note,
        'kpi_count', jsonb_array_length(kpi_snapshot),
        'measured_count', (select count(*) from jsonb_array_elements(kpi_snapshot) k
                           where (k->>'measured')::boolean),
        'governance', governance_snapshot
      ) order by period_end desc), '[]'::jsonb)
      from board_packs
      where organization_id = v_org
        and v_role in ('executive', 'admin', 'ai_admin'))
  );
end
$$;

grant execute on function public.get_accountability_cascade() to authenticated;

notify pgrst, 'reload schema';
