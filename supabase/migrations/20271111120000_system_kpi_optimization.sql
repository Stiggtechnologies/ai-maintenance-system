-- C8.25 — Optimize the whole system, not a single KPI.
--
-- Canonical reuse: kpi_catalog is the only KPI identity, recommendations is
-- an optional same-tenant subject, and audit_events is the only audit log.
-- This does not add a solver, a weight, a score, or a second KPI service.
-- A named human records a qualitative effect for the focal KPI and for every
-- other catalog page. Unknown stays unknown. A different human accepts or
-- rejects. Acceptance cannot create work, approve, accept risk, spend, change
-- an operating limit, or return equipment to service.

create table if not exists public.system_kpi_optimizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  focal_kpi_key text not null references public.kpi_catalog(kpi_key),
  focal_page text not null,
  intent text not null,
  required_pages text[] not null,
  safety_kpi_worsens boolean not null default false,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'rejected')),
  recommendation_id uuid references public.recommendations(id) on delete restrict,
  proposed_by uuid not null references auth.users(id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  escalation_note text,
  constraint system_kpi_optimizations_intent_len check (length(btrim(intent)) >= 20),
  constraint system_kpi_optimizations_decision_actor check (
    (status = 'proposed' and decided_by is null and decided_at is null)
    or (status in ('accepted', 'rejected') and decided_by is not null
        and decided_by is distinct from proposed_by and decided_at is not null
        and length(btrim(coalesce(decision_note, ''))) >= 20)
  ),
  constraint system_kpi_optimizations_safety_escalation check (
    status <> 'accepted' or safety_kpi_worsens = false
    or length(btrim(coalesce(escalation_note, ''))) >= 20
  )
);

create table if not exists public.system_kpi_optimization_effects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  optimization_id uuid not null references public.system_kpi_optimizations(id) on delete cascade,
  kpi_key text not null references public.kpi_catalog(kpi_key),
  catalog_page text not null,
  effect text not null check (effect in ('improves', 'worsens', 'unchanged', 'unknown')),
  basis text not null,
  constraint system_kpi_optimization_effects_basis_len check (length(btrim(basis)) >= 20),
  unique (optimization_id, kpi_key)
);

create index if not exists system_kpi_optimizations_org_time_idx
  on public.system_kpi_optimizations (organization_id, proposed_at desc);
create index if not exists system_kpi_optimization_effects_opt_idx
  on public.system_kpi_optimization_effects (optimization_id);

alter table public.system_kpi_optimizations enable row level security;
alter table public.system_kpi_optimization_effects enable row level security;

drop policy if exists system_kpi_optimizations_read on public.system_kpi_optimizations;
create policy system_kpi_optimizations_read
  on public.system_kpi_optimizations for select to authenticated
  using (organization_id = public.app_current_org());

drop policy if exists system_kpi_optimization_effects_read on public.system_kpi_optimization_effects;
create policy system_kpi_optimization_effects_read
  on public.system_kpi_optimization_effects for select to authenticated
  using (organization_id = public.app_current_org());

revoke all on table public.system_kpi_optimizations from public, anon, authenticated;
revoke all on table public.system_kpi_optimization_effects from public, anon, authenticated;
grant select on table public.system_kpi_optimizations to authenticated;
grant select on table public.system_kpi_optimization_effects to authenticated;

create or replace function public.enforce_system_kpi_optimization_write()
returns trigger
language plpgsql
set search_path = public
as $trg$
begin
  if coalesce(current_setting('app.system_kpi_optimization_write', true), '') <> 'on' then
    raise exception 'system KPI optimizations are written only by the governed functions';
  end if;
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'a system KPI optimization cannot change organization';
  end if;
  if tg_table_name = 'system_kpi_optimizations' and tg_op = 'DELETE' then
    raise exception 'system KPI optimizations are retained';
  end if;
  if tg_table_name = 'system_kpi_optimizations' and tg_op = 'UPDATE' and old.status <> 'proposed' then
    raise exception 'a decided system KPI optimization is immutable';
  end if;
  if tg_table_name = 'system_kpi_optimization_effects' and tg_op <> 'INSERT' then
    raise exception 'system KPI effects are immutable';
  end if;
  if tg_table_name = 'system_kpi_optimization_effects' and tg_op = 'INSERT' then
    if not exists (
      select 1 from public.system_kpi_optimizations o
      where o.id = new.optimization_id and o.organization_id = new.organization_id
    ) then
      raise exception 'an effect must stay in the same organization as its assessment';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$trg$;

drop trigger if exists trg_system_kpi_optimizations_write on public.system_kpi_optimizations;
create trigger trg_system_kpi_optimizations_write
  before insert or update or delete on public.system_kpi_optimizations
  for each row execute function public.enforce_system_kpi_optimization_write();

drop trigger if exists trg_system_kpi_optimization_effects_write on public.system_kpi_optimization_effects;
create trigger trg_system_kpi_optimization_effects_write
  before insert or update or delete on public.system_kpi_optimization_effects
  for each row execute function public.enforce_system_kpi_optimization_write();

revoke all on function public.enforce_system_kpi_optimization_write()
  from public, anon, authenticated;

create or replace function public.propose_system_kpi_optimization(
  p_focal_kpi_key text,
  p_intent text,
  p_effects jsonb,
  p_recommendation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_focal text := btrim(coalesce(p_focal_kpi_key, ''));
  v_intent text := btrim(coalesce(p_intent, ''));
  v_focal_page text;
  v_required text[] := '{}'::text[];
  v_missing text[] := '{}'::text[];
  v_seen text[] := '{}'::text[];
  v_covered text[] := '{}'::text[];
  v_effects jsonb := '[]'::jsonb;
  v_safety boolean := false;
  v_id uuid;
  v_count int := 0;
  r record;
  v_key text;
  v_effect text;
  v_basis text;
  v_page text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;
  select role into v_role from public.user_profiles
   where id = auth.uid() and organization_id = v_org;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error', 'ai_admin cannot propose a system KPI optimization');
  end if;
  if v_role is null or v_role not in (
    'admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner'
  ) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if length(v_intent) < 20 then
    return jsonb_build_object('error', 'intent must explain the optimization in at least 20 characters');
  end if;
  select page into v_focal_page from public.kpi_catalog where kpi_key = v_focal;
  if v_focal_page is null then
    return jsonb_build_object('error', 'focal KPI is not in the canonical catalog');
  end if;
  if p_recommendation_id is not null and not exists (
    select 1 from public.recommendations rec
    where rec.id = p_recommendation_id and rec.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'recommendation is not in this organization');
  end if;
  if jsonb_typeof(p_effects) is distinct from 'array' then
    return jsonb_build_object('error', 'effects must be a list of catalog KPI judgements');
  end if;

  select coalesce(array_agg(distinct k.page order by k.page), '{}'::text[])
    into v_required
  from public.kpi_catalog k
  where k.page is distinct from v_focal_page;

  for r in select value from jsonb_array_elements(p_effects) as t(value)
  loop
    v_key := btrim(coalesce(r.value->>'kpiKey', ''));
    v_effect := btrim(coalesce(r.value->>'effect', ''));
    v_basis := btrim(coalesce(r.value->>'basis', ''));
    if v_key = '' then
      return jsonb_build_object('error', 'every effect must name a catalog KPI');
    end if;
    if v_key = any(v_seen) then
      return jsonb_build_object('error', 'each KPI is recorded once; effects are not overwritten or netted');
    end if;
    v_seen := v_seen || v_key;
    if v_effect not in ('improves', 'worsens', 'unchanged', 'unknown') then
      return jsonb_build_object('error', 'effect must be improves, worsens, unchanged or unknown');
    end if;
    if length(v_basis) < 20 then
      return jsonb_build_object('error', 'each effect needs a substantive basis; unknown is labeled, not invented');
    end if;
    select page into v_page from public.kpi_catalog where kpi_key = v_key;
    if v_page is null then
      return jsonb_build_object('error', 'effect names a KPI that is not in the canonical catalog');
    end if;
    if v_key = v_focal and v_effect is distinct from 'improves' then
      return jsonb_build_object('error', 'the focal KPI of an optimization must be judged improves');
    end if;
    if v_page = 'risk_safety' and v_effect = 'worsens' then
      v_safety := true;
    end if;
    v_effects := v_effects || jsonb_build_array(jsonb_build_object(
      'kpiKey', v_key, 'page', v_page, 'effect', v_effect, 'basis', v_basis
    ));
    v_count := v_count + 1;
    if v_page is distinct from v_focal_page and not v_page = any(v_covered) then
      v_covered := v_covered || v_page;
    end if;
  end loop;

  if v_count < 2 then
    return jsonb_build_object('error', 'single-KPI optimization refused');
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_effects) e
    where e->>'kpiKey' = v_focal and e->>'effect' = 'improves'
  ) then
    return jsonb_build_object('error', 'the focal KPI must be included and judged improves');
  end if;

  foreach v_page in array v_required loop
    if not v_page = any(v_covered) then
      v_missing := v_missing || v_page;
    end if;
  end loop;
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return jsonb_build_object(
      'error',
      'single-KPI optimization refused: record an effect for every other KPI catalog page ('
        || array_to_string(v_missing, ', ') || ')'
    );
  end if;

  perform set_config('app.system_kpi_optimization_write', 'on', true);
  insert into public.system_kpi_optimizations(
    organization_id, focal_kpi_key, focal_page, intent, required_pages,
    safety_kpi_worsens, recommendation_id, proposed_by
  ) values (
    v_org, v_focal, v_focal_page, v_intent, v_required,
    v_safety, p_recommendation_id, auth.uid()
  ) returning id into v_id;

  insert into public.system_kpi_optimization_effects(
    organization_id, optimization_id, kpi_key, catalog_page, effect, basis
  )
  select v_org, v_id, e->>'kpiKey', e->>'page', e->>'effect', e->>'basis'
  from jsonb_array_elements(v_effects) e;

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org, 'system_kpi_optimization_proposed', v_role,
    jsonb_build_object(
      'optimization_id', v_id,
      'focal_kpi_key', v_focal,
      'focal_page', v_focal_page,
      'required_pages', to_jsonb(v_required),
      'effect_count', v_count,
      'safety_kpi_worsens', v_safety,
      'recommendation_id', p_recommendation_id,
      'authority', 'assessment_only'
    )
  );

  return jsonb_build_object(
    'optimizationId', v_id,
    'status', 'proposed',
    'safetyKpiWorsens', v_safety,
    'operationalAuthorization', false
  );
end
$fn$;

create or replace function public.decide_system_kpi_optimization(
  p_optimization_id uuid,
  p_decision text,
  p_note text,
  p_escalation_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_row public.system_kpi_optimizations%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_escalation text := nullif(btrim(coalesce(p_escalation_note, '')), '');
  v_decision text := btrim(coalesce(p_decision, ''));
  v_safety boolean := false;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;
  select role into v_role from public.user_profiles
   where id = auth.uid() and organization_id = v_org;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error', 'ai_admin cannot decide a system KPI optimization');
  end if;
  if v_role is null or v_role not in (
    'admin', 'executive', 'maintenance_manager', 'reliability_engineer'
  ) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_decision not in ('accepted', 'rejected') then
    return jsonb_build_object('error', 'decision must be accepted or rejected');
  end if;
  if length(v_note) < 20 then
    return jsonb_build_object('error', 'decision note must be substantive');
  end if;

  select * into v_row from public.system_kpi_optimizations
   where id = p_optimization_id and organization_id = v_org
   for update;
  if not found then
    return jsonb_build_object('error', 'optimization not found in this organization');
  end if;
  if v_row.status <> 'proposed' then
    return jsonb_build_object('error', 'only a proposed assessment can be decided');
  end if;
  if v_row.proposed_by = auth.uid() then
    return jsonb_build_object('error', 'the proposer cannot decide their own system assessment');
  end if;
  if exists (
    select 1 from unnest(v_row.required_pages) as required(page)
    where not exists (
      select 1 from public.system_kpi_optimization_effects e
      where e.optimization_id = v_row.id
        and e.organization_id = v_org
        and e.catalog_page = required.page
    )
  ) then
    return jsonb_build_object('error', 'stored assessment does not cover every required system page');
  end if;

  v_safety := exists (
    select 1 from public.system_kpi_optimization_effects e
    where e.optimization_id = v_row.id
      and e.organization_id = v_org
      and e.catalog_page = 'risk_safety'
      and e.effect = 'worsens'
  );
  if v_decision = 'accepted' and v_safety then
    if v_escalation is null or length(v_escalation) < 20 then
      return jsonb_build_object('error', 'a worsening safety or risk KPI requires a substantive escalation note');
    end if;
    if v_role not in ('executive', 'admin') then
      return jsonb_build_object('error', 'accepting a worsening safety or risk KPI requires an executive or administrator');
    end if;
  end if;

  perform set_config('app.system_kpi_optimization_write', 'on', true);
  update public.system_kpi_optimizations set
    status = v_decision,
    safety_kpi_worsens = v_safety,
    decided_by = auth.uid(),
    decided_at = now(),
    decision_note = v_note,
    escalation_note = case when v_safety then v_escalation else v_row.escalation_note end
  where id = v_row.id and organization_id = v_org and status = 'proposed';

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org, 'system_kpi_optimization_decided', v_role,
    jsonb_build_object(
      'optimization_id', v_row.id,
      'decision', v_decision,
      'safety_kpi_worsens', v_safety,
      'decided_by', auth.uid(),
      'authority', 'assessment_only'
    )
  );

  return jsonb_build_object(
    'optimizationId', v_row.id,
    'status', v_decision,
    'safetyKpiWorsens', v_safety,
    'operationalAuthorization', false
  );
end
$fn$;

create or replace function public.get_system_kpi_optimization_workspace()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;
  return jsonb_build_object(
    'boundary',
    'Acceptance records a human judgement that the proposal was assessed across the KPI system. It does not approve work, accept risk, commit spend, change an operating limit or return equipment to service.',
    'catalog', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kpiKey', k.kpi_key, 'name', k.name, 'page', k.page
      ) order by k.page, k.name), '[]'::jsonb)
      from public.kpi_catalog k
    ),
    'pages', (
      select coalesce(jsonb_agg(pages.page order by pages.page), '[]'::jsonb)
      from (select distinct page from public.kpi_catalog) pages
    ),
    'assessments', (
      select coalesce(jsonb_agg(item.payload order by item.proposed_at desc), '[]'::jsonb)
      from (
        select o.proposed_at,
          jsonb_build_object(
            'id', o.id,
            'status', o.status,
            'focalKpiKey', o.focal_kpi_key,
            'focalPage', o.focal_page,
            'intent', o.intent,
            'requiredPages', o.required_pages,
            'safetyKpiWorsens', o.safety_kpi_worsens,
            'recommendationId', o.recommendation_id,
            'proposedAt', o.proposed_at,
            'decidedAt', o.decided_at,
            'decisionNote', o.decision_note,
            'escalationNote', o.escalation_note,
            'operationalAuthorization', false,
            'effects', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'kpiKey', e.kpi_key,
                'page', e.catalog_page,
                'effect', e.effect,
                'basis', e.basis
              ) order by e.catalog_page, e.kpi_key), '[]'::jsonb)
              from public.system_kpi_optimization_effects e
              where e.optimization_id = o.id and e.organization_id = v_org
            )
          ) as payload
        from public.system_kpi_optimizations o
        where o.organization_id = v_org
        order by o.proposed_at desc
        limit 20
      ) item
    )
  );
end
$fn$;

revoke all on function public.propose_system_kpi_optimization(text, text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.decide_system_kpi_optimization(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_system_kpi_optimization_workspace()
  from public, anon, authenticated;
grant execute on function public.propose_system_kpi_optimization(text, text, jsonb, uuid)
  to authenticated;
grant execute on function public.decide_system_kpi_optimization(uuid, text, text, text)
  to authenticated;
grant execute on function public.get_system_kpi_optimization_workspace()
  to authenticated;

comment on function public.propose_system_kpi_optimization(text, text, jsonb, uuid) is
  'C8.25: refuse a single-KPI optimization. Records qualitative effects across every other kpi_catalog page. No score, weight, work, approval, spend, limit change, or return to service.';
comment on function public.decide_system_kpi_optimization(uuid, text, text, text) is
  'C8.25: a different named human accepts or rejects a frozen system assessment. A worsening risk_safety KPI needs an executive or administrator and an escalation note. No operational authority.';

notify pgrst, 'reload schema';
