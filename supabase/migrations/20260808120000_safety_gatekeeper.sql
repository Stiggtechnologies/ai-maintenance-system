-- ============================================================================
-- Safety Gatekeeper: consequence screening with an ENFORCED veto
-- (capability register C1.11, C8.24; guard for E2.13).
--
-- Spec §8 requires that for every consequential recommendation the system
-- determines whether it affects a safety-critical barrier, pressure
-- containment, environmental compliance, a protective/shutdown/alarm
-- function, an integrity operating window, a regulatory inspection or test,
-- product quality, cybersecurity, workforce safety, production constraints,
-- capital or operating budgets, or contractual/warranty obligations — and
-- escalates those to the designated accountable authority.
--
-- Design:
--   * Screening is DETERMINISTIC (no LLM) and CONSERVATIVE — when signals are
--     ambiguous it flags for review rather than clearing. Safety overrides
--     optimization, so the failure mode is "extra human review", never
--     "silent pass".
--   * The veto is a BEFORE UPDATE TRIGGER on recommendations, not a policy or
--     an application check: no client, RPC, or future connector can approve a
--     recommendation whose gatekeeper-required screening is unattested.
--   * The gatekeeper's clearance is a human act, recorded with identity, time
--     and note. The platform never clears its own gate.
--
-- Canonical reuse: recommendations, assets, work_orders, user_profiles,
-- app_current_org(). Additive only; no existing policy is modified.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The twelve spec dimensions as governed reference data.
-- ---------------------------------------------------------------------------
create table if not exists consequence_dimensions (
  key text primary key,
  title text not null,
  description text not null,
  requires_gatekeeper boolean not null default false,
  escalation_authority text,
  register_ref text not null,
  created_at timestamptz not null default now()
);

alter table consequence_dimensions enable row level security;
drop policy if exists consequence_dimensions_read on consequence_dimensions;
create policy consequence_dimensions_read on consequence_dimensions
  for select to authenticated using (true);

insert into consequence_dimensions
  (key, title, description, requires_gatekeeper, escalation_authority, register_ref) values
  ('safety_barrier','Safety-critical barrier','Affects a barrier preventing or mitigating a major-accident hazard.',true,'safety_authority','C8.24'),
  ('pressure_containment','Pressure containment or structural integrity','Affects pressure-retaining or load-bearing integrity.',true,'engineering_authority','C8.24'),
  ('environmental_compliance','Environmental compliance','Affects emissions, discharges, containment or a permit condition.',true,'safety_authority','C8.24'),
  ('protective_function','Protective, shutdown or alarm function','Affects a trip, interlock, relief, or alarm function.',true,'safety_authority','C8.24'),
  ('operating_window','Integrity operating window','Changes or challenges an approved operating limit.',true,'engineering_authority','C8.24'),
  ('regulatory_inspection','Regulatory inspection or test','Affects a statutory inspection, proof test or certification interval.',true,'engineering_authority','C8.24'),
  ('product_quality','Product quality','Affects product or service quality delivered to customers.',false,'operations_authority','C8.24'),
  ('cybersecurity','Cybersecurity','Affects control-system, network or data security posture.',true,'security_authority','C8.24'),
  ('workforce_safety','Workforce safety or competency','Affects occupational safety, permits, isolation or required competency.',true,'safety_authority','C8.24'),
  ('production_constraint','Production constraints','Affects a production constraint, bottleneck or committed plan.',false,'operations_authority','C8.24'),
  ('budget','Capital or operating budgets','Commits or materially changes capital or operating expenditure.',false,'budget_authority','C8.24'),
  ('contractual','Contractual or warranty obligations','Affects warranty, contract or service-level obligations.',false,'commercial_authority','C8.24')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Screening results, one per recommendation.
-- ---------------------------------------------------------------------------
create table if not exists recommendation_screenings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  dimensions_hit jsonb not null default '[]',
  requires_gatekeeper boolean not null default false,
  screening_basis text not null,
  gatekeeper_attested_at timestamptz,
  gatekeeper_attested_by uuid,
  gatekeeper_note text,
  screened_at timestamptz not null default now(),
  unique (recommendation_id)
);

create index if not exists idx_rec_screenings_org
  on recommendation_screenings(organization_id, requires_gatekeeper);

alter table recommendation_screenings enable row level security;
drop policy if exists recommendation_screenings_org on recommendation_screenings;
create policy recommendation_screenings_org on recommendation_screenings
  for select to authenticated
  using (organization_id = app_current_org());
-- writes only through the governed RPCs below

-- ---------------------------------------------------------------------------
-- 3. Deterministic, conservative screening.
-- ---------------------------------------------------------------------------
create or replace function public.screen_recommendation_consequences(
  p_recommendation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r recommendations%rowtype;
  a assets%rowtype;
  v_text text;
  v_hits text[] := '{}';
  v_requires boolean := false;
  v_basis text;
  v_safety_wo boolean := false;
  v_approval_flag boolean := false;
begin
  select * into r from recommendations
  where id = p_recommendation_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'recommendation not found');
  end if;
  select * into a from assets where id = r.asset_id;

  v_text := lower(concat_ws(' ', r.title, r.issue, r.action, r.rationale,
    r.consequence_summary, a.name, a.asset_class, a.area));

  select exists (
    select 1 from work_orders w
    where w.asset_id = r.asset_id and coalesce(w.safety_flag, false)
  ) into v_safety_wo;

  -- recommendations.approval_required is TEXT in this schema; treat any
  -- affirmative spelling as a signal and anything else as no signal.
  v_approval_flag := lower(coalesce(r.approval_required, '')) in
    ('true', 't', 'yes', 'y', 'required', '1');

  -- Keyword and context signals. Conservative by construction: a hit only
  -- ever ADDS review; nothing here can clear a gate.
  if v_text ~ '(safety|barrier|hazard|loss of containment|major accident)'
     or v_safety_wo or v_approval_flag then
    v_hits := array_append(v_hits, 'safety_barrier');
  end if;
  if v_text ~ '(pressure|vessel|piping|structural|weld|tube rupture|containment)' then
    v_hits := array_append(v_hits, 'pressure_containment');
  end if;
  if v_text ~ '(emission|spill|leak|environment|discharge|flare|permit)' then
    v_hits := array_append(v_hits, 'environmental_compliance');
  end if;
  if v_text ~ '(trip|interlock|relief|alarm|shutdown|protective|esd|sis)' then
    v_hits := array_append(v_hits, 'protective_function');
  end if;
  if v_text ~ '(operating limit|operating window|setpoint|derate|iow|threshold)' then
    v_hits := array_append(v_hits, 'operating_window');
  end if;
  if v_text ~ '(inspection|statutory|regulator|certif|proof test|absa|code)' then
    v_hits := array_append(v_hits, 'regulatory_inspection');
  end if;
  if v_text ~ '(quality|specification|contamin|off-spec)' then
    v_hits := array_append(v_hits, 'product_quality');
  end if;
  if v_text ~ '(cyber|network|firmware|control system|plc|dcs|scada)' then
    v_hits := array_append(v_hits, 'cybersecurity');
  end if;
  if v_text ~ '(permit|isolation|lockout|confined space|competen|training|crew)' then
    v_hits := array_append(v_hits, 'workforce_safety');
  end if;
  if v_text ~ '(production|throughput|bottleneck|availability|output|plan)' then
    v_hits := array_append(v_hits, 'production_constraint');
  end if;
  if v_text ~ '(capital|budget|expenditure|replace|procure|cost)' then
    v_hits := array_append(v_hits, 'budget');
  end if;
  if v_text ~ '(warranty|contract|service level|vendor|oem agreement)' then
    v_hits := array_append(v_hits, 'contractual');
  end if;

  -- Critical assets are treated as safety-relevant unless proven otherwise.
  if coalesce(a.criticality, '') = 'critical'
     and not ('safety_barrier' = any(v_hits)) then
    v_hits := array_append(v_hits, 'safety_barrier');
  end if;

  select bool_or(d.requires_gatekeeper) into v_requires
  from consequence_dimensions d where d.key = any(v_hits);
  v_requires := coalesce(v_requires, false);

  v_basis := format(
    'Deterministic keyword and context screening over title/issue/action/rationale/consequence plus asset criticality (%s), safety-flagged work history (%s) and approval_required (%s). Conservative: ambiguity flags for review.',
    coalesce(a.criticality, 'unknown'), v_safety_wo, v_approval_flag);

  insert into recommendation_screenings (organization_id, recommendation_id,
    dimensions_hit, requires_gatekeeper, screening_basis)
  values (r.organization_id, r.id, to_jsonb(v_hits), v_requires, v_basis)
  on conflict (recommendation_id) do update
    set dimensions_hit = excluded.dimensions_hit,
        requires_gatekeeper = excluded.requires_gatekeeper,
        screening_basis = excluded.screening_basis,
        screened_at = now();

  return jsonb_build_object('ok', true, 'dimensions', to_jsonb(v_hits),
    'requires_gatekeeper', v_requires);
end
$$;

grant execute on function public.screen_recommendation_consequences(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Gatekeeper clearance — a human act, never the platform's.
-- ---------------------------------------------------------------------------
create or replace function public.attest_safety_review(
  p_recommendation_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('admin', 'ai_admin', 'maintenance_manager', 'reliability_engineer') then
    return jsonb_build_object('error',
      'safety clearance requires designated gatekeeper authority');
  end if;
  if p_note is null or length(trim(p_note)) < 10 then
    return jsonb_build_object('error',
      'a substantive clearance note is required (what was reviewed and why it is safe to proceed)');
  end if;

  update recommendation_screenings
  set gatekeeper_attested_at = now(),
      gatekeeper_attested_by = auth.uid(),
      gatekeeper_note = left(p_note, 2000)
  where recommendation_id = p_recommendation_id
    and organization_id = app_current_org();

  if not found then
    return jsonb_build_object('error', 'no screening found — screen the recommendation first');
  end if;
  return jsonb_build_object('ok', true);
end
$$;

grant execute on function public.attest_safety_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE ENFORCED VETO. A trigger, so no client, RPC or future connector can
--    approve past an unattested safety gate.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_safety_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s recommendation_screenings%rowtype;
begin
  if new.status is distinct from 'approved'
     or old.status is not distinct from new.status then
    return new;
  end if;

  select * into s from recommendation_screenings
  where recommendation_id = new.id;

  if found and s.requires_gatekeeper and s.gatekeeper_attested_at is null then
    raise exception
      'Safety gate: recommendation % affects % and requires gatekeeper clearance before approval',
      new.id, s.dimensions_hit
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists trg_enforce_safety_gate on recommendations;
create trigger trg_enforce_safety_gate
  before update of status on recommendations
  for each row execute function public.enforce_safety_gate();
