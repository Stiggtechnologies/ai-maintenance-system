-- ============================================================================
-- Sync Develop Slice 2 — Objective nesting (D11.15) and the risk→objective
-- invariant (D11.16), spec §2, overlap-map ruling: risk_objectives is the ONE
-- Objective store; §2 extends it. No second objective table exists or arrives.
--
-- WHAT §2 ADDS TO THE EXISTING OBJECT (typed, not replacing): risk_objectives
-- already carries parent_id (nesting at the schema), owner, level, prose
-- target/measurement/timeframe/tolerance, versioning and adoption. The spec's
-- typed fields land beside the prose, never instead of it:
--   * target_value numeric + unit  — the measurable point ("96", "%")
--   * target_date                  — when it must hold
-- The prose fields stay mandatory: a numeric target without its sentence is
-- a number nobody can challenge. Typed fields are optional and render as
-- "not stated" when absent (standing constraint 3 — no fabricated numbers).
--
-- NESTING INTEGRITY: parent_id existed with no cycle guard — a client could
-- adopt A→B→A and every recursive traversal (the new get_objective_tree, the
-- rollup) would spin. The BEFORE trigger below walks the proposed ancestry
-- and refuses cycles, self-parenting and cross-org parents at the boundary,
-- for every writer including the service path (a cycle is corrupt in any
-- provenance; there is no legitimate restore of one).
--
-- THE D11.16 INVARIANT (spec §2 verbatim: "Risk always links to an
-- objective"): risks were insertable with only free-text objective_at_risk.
-- From this migration:
--   * a NEW risk arriving without objective_id is REFUSED at the persistence
--     boundary (BEFORE trigger, check_violation) for every client path —
--     including RLS-bypassed simulated clients;
--   * clearing an existing link (objective_id → NULL) is refused the same
--     way: a risk cannot be silently unhooked from what it threatens;
--   * the service path (restore, backfill) is admitted AND audited into
--     security_events — refusing the service key buys nothing (the
--     20261005090300 argument, kept);
--   * create_risk_assessment — the only SQL insert path into risks — is
--     re-created to REQUIRE an ADOPTED objective (the link_risk_objective
--     standard: one standard, no weaker second path) and to seed
--     objective_at_risk from the objective it names.
--
-- GRANDFATHERING, HONESTLY (the register row's demand): rows that predate
-- this migration keep operating — they update freely so long as the update
-- does not CLEAR a link — and their count is RECORDED at migration time, one
-- audit_events row per organization ('risk_objective_invariant', with the
-- grandfathered count), so the backlog is a queryable number, never a silent
-- one. Closing that backlog is link_risk_objective work, visible in /risk.
--
-- Canonical reuse: risk_objectives, risks, audit_events, security_events,
-- app_current_org(). Additive; no table created.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. §2 typed target fields on the ONE objective store.
-- ---------------------------------------------------------------------------
alter table public.risk_objectives
  add column if not exists target_value numeric,
  add column if not exists unit text,
  add column if not exists target_date date;

-- A typed value needs its unit; a bare "96" answers nothing. (The reverse —
-- a unit with no value — is tolerated as authoring order.)
alter table public.risk_objectives
  drop constraint if exists risk_objectives_typed_target_unit;
alter table public.risk_objectives
  add constraint risk_objectives_typed_target_unit check (
    target_value is null or (unit is not null and btrim(unit) <> '')
  );

-- ---------------------------------------------------------------------------
-- 2. Nesting integrity: no cycles, no self-parent, no cross-org parent.
--    Enforced for EVERY writer — a cyclic hierarchy is corrupt data, not a
--    provenance question, so the service path is refused too.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_objective_nesting_integrity()
returns trigger
language plpgsql
as $$
declare
  v_ancestor uuid;
  v_ancestor_org uuid;
  v_depth int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception
      'An objective cannot be its own parent (spec §2 nesting is a hierarchy, not a loop).'
      using errcode = 'check_violation';
  end if;
  select organization_id into v_ancestor_org from risk_objectives where id = new.parent_id;
  if v_ancestor_org is null then
    raise exception 'Parent objective does not exist.' using errcode = 'check_violation';
  end if;
  if v_ancestor_org <> new.organization_id then
    raise exception
      'Parent objective belongs to another organization — objective hierarchies never cross tenants.'
      using errcode = 'check_violation';
  end if;
  v_ancestor := new.parent_id;
  while v_ancestor is not null loop
    v_depth := v_depth + 1;
    if v_depth > 50 then
      raise exception
        'Objective ancestry exceeds 50 levels — refusing what is either a cycle or a hierarchy no one can read.'
        using errcode = 'check_violation';
    end if;
    select parent_id into v_ancestor from risk_objectives where id = v_ancestor;
    if v_ancestor = new.id then
      raise exception
        'This parent assignment would close a cycle (the proposed parent is a descendant of this objective).'
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end
$$;

drop trigger if exists trg_objective_nesting_integrity on public.risk_objectives;
create trigger trg_objective_nesting_integrity
  before insert or update of parent_id on public.risk_objectives
  for each row execute function public.enforce_objective_nesting_integrity();

revoke all on function public.enforce_objective_nesting_integrity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. upsert_risk_objective, re-created from its 20260921110102 definition
--    with exactly three deltas (everything else diffed identical at
--    authoring time):
--      * accepts target_value / unit / target_date (optional, typed);
--      * validates the value/unit pairing with a named refusal;
--      * writes them on insert and update.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_risk_objective(p_objective jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  v_id uuid:=nullif(p_objective->>'id','')::uuid;
  v_owner uuid:=nullif(p_objective->>'owner_id','')::uuid;
  v_parent uuid:=nullif(p_objective->>'parent_id','')::uuid;
  v_context uuid:=nullif(p_objective->>'context_id','')::uuid;
  v_target_value numeric:=nullif(p_objective->>'target_value','')::numeric;
  v_unit text:=nullif(btrim(coalesce(p_objective->>'unit','')),'');
  v_target_date date:=nullif(p_objective->>'target_date','')::date;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(length(btrim(p_objective->>'description')),0)<5 or
     coalesce(length(btrim(p_objective->>'target')),0)<2 or
     coalesce(length(btrim(p_objective->>'measurement')),0)<2 or
     coalesce(length(btrim(p_objective->>'timeframe')),0)<2 or
     coalesce(length(btrim(p_objective->>'tolerance')),0)<2 then
    return jsonb_build_object('error','objective, target, measure, timeframe and tolerance are required');
  end if;
  if p_objective->>'objective_level' not in
    ('enterprise','business_unit','site','system','asset','project','task') then
    return jsonb_build_object('error','invalid objective level');
  end if;
  if v_target_value is not null and v_unit is null then
    return jsonb_build_object('error','a numeric target states its unit — a bare number answers nothing');
  end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','objective owner not found in this organization');
  end if;
  if v_parent is not null and not exists(select 1 from risk_objectives where id=v_parent and organization_id=v_org) then
    return jsonb_build_object('error','parent objective not found in this organization');
  end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization');
  end if;
  if v_id is null then
    insert into risk_objectives(organization_id,parent_id,context_id,owner_id,objective_level,
      description,target,measurement,timeframe,tolerance,target_value,unit,target_date,
      review_date,created_by)
    values(v_org,v_parent,v_context,v_owner,p_objective->>'objective_level',
      btrim(p_objective->>'description'),btrim(p_objective->>'target'),
      btrim(p_objective->>'measurement'),btrim(p_objective->>'timeframe'),
      btrim(p_objective->>'tolerance'),v_target_value,v_unit,v_target_date,
      nullif(p_objective->>'review_date','')::date,auth.uid())
    returning id into v_id;
  else
    update risk_objectives set parent_id=v_parent,context_id=v_context,owner_id=v_owner,
      objective_level=p_objective->>'objective_level',description=btrim(p_objective->>'description'),
      target=btrim(p_objective->>'target'),measurement=btrim(p_objective->>'measurement'),
      timeframe=btrim(p_objective->>'timeframe'),tolerance=btrim(p_objective->>'tolerance'),
      target_value=v_target_value,unit=v_unit,target_date=v_target_date,
      review_date=nullif(p_objective->>'review_date','')::date,updated_at=now()
    where id=v_id and organization_id=v_org and status='draft';
    if not found then return jsonb_build_object('error','only a draft objective in this organization can be edited'); end if;
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_objective',v_role,jsonb_build_object('objective_id',v_id,'status','draft'));
  return jsonb_build_object('objective_id',v_id,'status','draft');
end;
$$;
grant execute on function public.upsert_risk_objective(jsonb) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 4. create_risk_objective_version, re-created from 20260921110102 with the
--    typed fields carried onto the successor (a new version must not silently
--    drop a configured numeric target). Everything else identical.
-- ---------------------------------------------------------------------------
create or replace function public.create_risk_objective_version(
  p_objective_id uuid,p_changes jsonb,p_reason text
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; current_objective risk_objectives%rowtype; v_id uuid;
  v_owner uuid; v_parent uuid; v_context uuid; v_level text;
  v_description text; v_target text; v_measurement text; v_timeframe text; v_tolerance text;
  v_target_value numeric; v_unit text; v_target_date date;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if coalesce(length(btrim(p_reason)),0)<10 then
    return jsonb_build_object('error','record why a new objective version is required'); end if;
  select * into current_objective from risk_objectives
    where id=p_objective_id and organization_id=v_org and status='adopted';
  if not found then return jsonb_build_object('error','adopted objective not found'); end if;
  if exists(select 1 from risk_objectives where supersedes_id=current_objective.id and status='draft') then
    return jsonb_build_object('error','a draft successor already exists'); end if;
  v_owner:=coalesce(nullif(p_changes->>'owner_id','')::uuid,current_objective.owner_id);
  v_parent:=case when p_changes ? 'parent_id' then nullif(p_changes->>'parent_id','')::uuid else current_objective.parent_id end;
  v_context:=case when p_changes ? 'context_id' then nullif(p_changes->>'context_id','')::uuid else current_objective.context_id end;
  v_level:=coalesce(nullif(p_changes->>'objective_level',''),current_objective.objective_level);
  v_description:=coalesce(nullif(btrim(p_changes->>'description'),''),current_objective.description);
  v_target:=coalesce(nullif(btrim(p_changes->>'target'),''),current_objective.target);
  v_measurement:=coalesce(nullif(btrim(p_changes->>'measurement'),''),current_objective.measurement);
  v_timeframe:=coalesce(nullif(btrim(p_changes->>'timeframe'),''),current_objective.timeframe);
  v_tolerance:=coalesce(nullif(btrim(p_changes->>'tolerance'),''),current_objective.tolerance);
  v_target_value:=case when p_changes ? 'target_value' then nullif(p_changes->>'target_value','')::numeric else current_objective.target_value end;
  v_unit:=case when p_changes ? 'unit' then nullif(btrim(coalesce(p_changes->>'unit','')),'') else current_objective.unit end;
  v_target_date:=case when p_changes ? 'target_date' then nullif(p_changes->>'target_date','')::date else current_objective.target_date end;
  if v_level not in ('enterprise','business_unit','site','system','asset','project','task') or
     length(v_description)<5 or length(v_target)<2 or length(v_measurement)<2 or
     length(v_timeframe)<2 or length(v_tolerance)<2 then
    return jsonb_build_object('error','the successor objective is incomplete'); end if;
  if v_target_value is not null and v_unit is null then
    return jsonb_build_object('error','a numeric target states its unit — a bare number answers nothing'); end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','objective owner not found in this organization'); end if;
  if v_parent is not null and not exists(select 1 from risk_objectives where id=v_parent and organization_id=v_org) then
    return jsonb_build_object('error','parent objective not found in this organization'); end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization'); end if;
  insert into risk_objectives(organization_id,supersedes_id,parent_id,context_id,owner_id,objective_level,
    description,target,measurement,timeframe,tolerance,target_value,unit,target_date,version,review_date,created_by)
  values(v_org,current_objective.id,v_parent,v_context,v_owner,v_level,v_description,v_target,v_measurement,
    v_timeframe,v_tolerance,v_target_value,v_unit,v_target_date,current_objective.version+1,
    case when p_changes ? 'review_date' then nullif(p_changes->>'review_date','')::date else current_objective.review_date end,
    auth.uid()) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_objective_version',v_role,jsonb_build_object('objective_id',v_id,
    'supersedes_id',current_objective.id,'version',current_objective.version+1,'reason',btrim(p_reason)));
  return jsonb_build_object('objective_id',v_id,'status','draft','version',current_objective.version+1,
    'supersedes_id',current_objective.id);
end;
$$;
grant execute on function public.create_risk_objective_version(uuid,jsonb,text) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 5. The nested read: one recursive traversal, org-scoped, SECURITY INVOKER
--    (risk_objectives carries an org read policy). Each node reports its
--    depth, its typed and prose targets, and how many risks link to it
--    DIRECTLY — a rollup of descendants' risks is derivable by the caller
--    from the parent chain, and inventing one aggregation the screen does
--    not render would be dead weight.
-- ---------------------------------------------------------------------------
create or replace function public.get_objective_tree()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with recursive tree as (
    select o.*, 0 as depth,
           array[o.id] as path
    from risk_objectives o
    where o.organization_id = app_current_org()
      and o.parent_id is null
      and o.status in ('draft','adopted')
    union all
    select o.*, t.depth + 1,
           t.path || o.id
    from risk_objectives o
    join tree t on o.parent_id = t.id
    where o.organization_id = app_current_org()
      and o.status in ('draft','adopted')
      and not o.id = any(t.path)
      and t.depth < 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'parentId', t.parent_id,
    'depth', t.depth,
    'level', t.objective_level,
    'description', t.description,
    'target', t.target,
    'targetValue', t.target_value,
    'unit', t.unit,
    'targetDate', t.target_date,
    'tolerance', t.tolerance,
    'status', t.status,
    'version', t.version,
    'owner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = t.owner_id),
    'linkedRisks', (select count(*) from risks r
                    where r.objective_id = t.id and r.organization_id = t.organization_id),
    'linkedCases', (select count(*) from development_cases c
                    where c.objective_id = t.id and c.organization_id = t.organization_id))
    order by t.path), '[]'::jsonb)
  from tree t;
$$;

revoke all on function public.get_objective_tree() from public, anon;
grant execute on function public.get_objective_tree() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. D11.16 — the invariant trigger on risks, with the audited service path.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_risk_objective_link()
returns trigger
language plpgsql
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_guarded boolean;
begin
  if tg_op = 'INSERT' then
    v_guarded := new.objective_id is null;
  else
    -- Clearing a link is guarded; everything else — including updates on
    -- grandfathered rows that still carry no link — passes through.
    v_guarded := old.objective_id is not null and new.objective_id is null;
  end if;

  if not v_guarded then
    return new;
  end if;

  -- Service path (restore, backfill, pre-invariant fixtures): admitted AND
  -- audited. The org-exists guard keeps organization teardown from
  -- referencing the organization being removed.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = new.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         case tg_op
           when 'INSERT' then
             'Risk ' || new.id::text || ' inserted without an objective link by a '
               || 'service caller. Spec §2 requires every risk to link to an '
               || 'objective; this row joins the grandfathered backlog.'
           else
             'Objective link cleared from risk ' || new.id::text
               || ' by a service caller — the risk no longer names what it threatens.'
         end);
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception
      'A risk always links to an objective (spec §2): a risk that threatens '
      'nothing named is a worry, not a risk. Create the risk with objective_id '
      'set — adopt an objective first (upsert_risk_objective, adopt_risk_objective) '
      'if none governs this area yet.'
      using errcode = 'check_violation';
  end if;
  raise exception
    'The objective link on a risk cannot be cleared — a risk always links to an '
    'objective (spec §2). Re-point it with link_risk_objective if the objective '
    'was wrong; retire the risk through its lifecycle if it no longer threatens '
    'anything.'
    using errcode = 'check_violation';
end
$$;

drop trigger if exists trg_risk_objective_link on public.risks;
create trigger trg_risk_objective_link
  before insert or update on public.risks
  for each row execute function public.enforce_risk_objective_link();

revoke all on function public.enforce_risk_objective_link() from public, anon, authenticated;

-- Grandfather-with-count, never silently: one audit row per organization
-- carrying the number of pre-invariant risks that hold no objective link.
do $$
declare
  org record;
begin
  for org in
    select organization_id, count(*) as unlinked
    from risks
    where objective_id is null
    group by organization_id
  loop
    insert into audit_events (organization_id, entity_type, actor, event_data)
    values (org.organization_id, 'risk_objective_invariant', 'migration',
      jsonb_build_object(
        'action', 'grandfathered',
        'unlinked_risks', org.unlinked,
        'note', 'Rows predating the risk→objective invariant (20261115090000). '
             || 'They keep operating and may not lose a link once one is set; '
             || 'closing the backlog is link_risk_objective work.'));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. create_risk_assessment, re-created from its 20260921110101 definition
--    with exactly two deltas (everything else diffed identical at authoring
--    time):
--      * REQUIRES objective_id resolving to an ADOPTED objective in this
--        organization (the link_risk_objective standard — one standard, no
--        weaker creation path), refused with the invariant named;
--      * seeds objective_at_risk from that objective's description when the
--        caller did not phrase its own.
-- ---------------------------------------------------------------------------
create or replace function public.create_risk_assessment(p_assessment jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_context risk_context_nodes%rowtype;
  v_criteria risk_criteria_profiles%rowtype;
  v_objective risk_objectives%rowtype;
  v_id uuid;
  v_risk risks%rowtype;
  v_gaps text[];
  v_status text := coalesce(p_assessment->>'status','draft');
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if v_status not in ('draft','identified') then
    return jsonb_build_object('error','new assessments may start only as draft or identified');
  end if;
  select * into v_context from risk_context_nodes
  where id = nullif(p_assessment->>'context_id','')::uuid and organization_id = v_org;
  if not found then return jsonb_build_object('error','context not found in this organization'); end if;
  select * into v_criteria from risk_criteria_profiles
  where id = nullif(p_assessment->>'criteria_profile_id','')::uuid and organization_id = v_org;
  if not found then return jsonb_build_object('error','criteria profile not found in this organization'); end if;
  -- D11.16: a risk always links to an objective (spec §2). Adopted, because a
  -- draft objective is not yet something the organization has agreed to
  -- protect — the same standard link_risk_objective already holds.
  select * into v_objective from risk_objectives
  where id = nullif(p_assessment->>'objective_id','')::uuid
    and organization_id = v_org and status = 'adopted';
  if not found then
    return jsonb_build_object('error',
      'a risk always links to an objective (spec §2): pass objective_id naming an ADOPTED objective in this organization — adopt one first (upsert_risk_objective, adopt_risk_objective) if none governs this area yet');
  end if;
  if nullif(p_assessment->>'site_id','') is not null and not exists(
    select 1 from sites where id=(p_assessment->>'site_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','site not found in this organization'); end if;
  if nullif(p_assessment->>'asset_id','') is not null and not exists(
    select 1 from assets where id=(p_assessment->>'asset_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','asset not found in this organization'); end if;
  if nullif(p_assessment->>'risk_owner_id','') is not null and not exists(
    select 1 from user_profiles where id=(p_assessment->>'risk_owner_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','risk owner not found in this organization'); end if;
  if nullif(p_assessment->>'decision_owner_id','') is not null and not exists(
    select 1 from user_profiles where id=(p_assessment->>'decision_owner_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','decision owner not found in this organization'); end if;
  if coalesce(btrim(p_assessment->>'title'),'') = '' then
    return jsonb_build_object('error','title is required');
  end if;

  insert into risks (
    organization_id, context_id, criteria_profile_id, site_id, asset_id, title,
    kind, objective_id, objective_at_risk, risk_source, event_description, causes, consequences,
    likelihood, existing_controls_summary, analysis_level, analysis_method,
    analysis_model_reference, control_effectiveness, uncertainty, confidence,
    complexity, connectivity, exposure, capacity_load, risk_velocity,
    time_to_unacceptable, inherent_risk_score, current_risk_score,
    residual_risk_score, target_risk_score, opportunity_score, value_at_risk,
    value_currency,
    current_risk_level, residual_risk_level, target_risk_level, decision_action,
    risk_owner_id, decision_owner_id, stakeholders, escalation_threshold,
    review_date, scope_decision, scope_expected_outcome, scope_inclusions,
    scope_exclusions, time_horizon, location_scope, resource_scope,
    responsibility_scope, relationship_scope, assumptions, biases,
    bias_review_complete, method_limitations, data_quality, reporting_profile,
    information_sensitivity, status, source_kind, created_by
  ) values (
    v_org, v_context.id, v_criteria.id,
    nullif(p_assessment->>'site_id','')::uuid, nullif(p_assessment->>'asset_id','')::uuid,
    btrim(p_assessment->>'title'), coalesce(p_assessment->>'kind','threat'),
    v_objective.id,
    coalesce(nullif(btrim(p_assessment->>'objective_at_risk'),''), v_objective.description),
    nullif(btrim(p_assessment->>'risk_source'),''),
    nullif(btrim(p_assessment->>'event_description'),''), coalesce(p_assessment->'causes','[]'::jsonb),
    coalesce(p_assessment->'consequences','{}'::jsonb), nullif(p_assessment->>'likelihood','')::numeric,
    nullif(btrim(p_assessment->>'existing_controls_summary'),''), p_assessment->>'analysis_level',
    nullif(btrim(p_assessment->>'analysis_method'),''), nullif(btrim(p_assessment->>'analysis_model_reference'),''),
    nullif(p_assessment->>'control_effectiveness','')::numeric, nullif(p_assessment->>'uncertainty','')::numeric,
    nullif(p_assessment->>'confidence','')::numeric, nullif(p_assessment->>'complexity','')::numeric,
    nullif(p_assessment->>'connectivity','')::numeric, nullif(p_assessment->>'exposure','')::numeric,
    nullif(p_assessment->>'capacity_load','')::numeric, nullif(p_assessment->>'risk_velocity','')::numeric,
    nullif(p_assessment->>'time_to_unacceptable','')::interval,
    nullif(p_assessment->>'inherent_risk_score','')::numeric, nullif(p_assessment->>'current_risk_score','')::numeric,
    nullif(p_assessment->>'residual_risk_score','')::numeric, nullif(p_assessment->>'target_risk_score','')::numeric,
    nullif(p_assessment->>'opportunity_score','')::numeric,
    nullif(p_assessment->>'value_at_risk','')::numeric,
    coalesce(nullif(p_assessment->>'value_currency',''),'USD'), p_assessment->>'current_risk_level',
    p_assessment->>'residual_risk_level', p_assessment->>'target_risk_level', p_assessment->>'decision_action',
    nullif(p_assessment->>'risk_owner_id','')::uuid, nullif(p_assessment->>'decision_owner_id','')::uuid,
    coalesce(p_assessment->'stakeholders','[]'::jsonb), nullif(btrim(p_assessment->>'escalation_threshold'),''),
    nullif(p_assessment->>'review_date','')::date, nullif(btrim(p_assessment->>'scope_decision'),''),
    nullif(btrim(p_assessment->>'scope_expected_outcome'),''), coalesce(p_assessment->'scope_inclusions','[]'::jsonb),
    coalesce(p_assessment->'scope_exclusions','[]'::jsonb), nullif(btrim(p_assessment->>'time_horizon'),''),
    nullif(btrim(p_assessment->>'location_scope'),''), coalesce(p_assessment->'resource_scope','[]'::jsonb),
    coalesce(p_assessment->'responsibility_scope','[]'::jsonb), coalesce(p_assessment->'relationship_scope','[]'::jsonb),
    coalesce(p_assessment->'assumptions','[]'::jsonb), coalesce(p_assessment->'biases','[]'::jsonb),
    coalesce((p_assessment->>'bias_review_complete')::boolean,false),
    coalesce(p_assessment->'method_limitations','[]'::jsonb),
    nullif(btrim(p_assessment->>'data_quality'),''),
    coalesce(p_assessment->'reporting_profile','{}'::jsonb),
    coalesce(p_assessment->>'information_sensitivity','internal'),
    'draft', coalesce(p_assessment->>'source_kind','human'), auth.uid()
  ) returning id into v_id;

  select * into v_risk from risks where id = v_id;
  v_gaps := public.risk_contract_gaps(v_risk);
  if v_status = 'identified' then
    if array_length(v_gaps,1) > 0 then
      return jsonb_build_object('risk_id',v_id,'status','draft','gaps',v_gaps,
        'note','Saved as draft because the identification contract is incomplete.');
    end if;
    update risks set status = 'identified', updated_at = now() where id = v_id;
  end if;
  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'risk_assessment', coalesce((select role from user_profiles where id = auth.uid()),'unknown'),
    jsonb_build_object('risk_id',v_id,'requested_status',v_status,'actual_status',
      case when v_status = 'identified' and array_length(v_gaps,1) is null then 'identified' else 'draft' end,
      'gaps',coalesce(to_jsonb(v_gaps),'[]'::jsonb)));
  return jsonb_build_object('risk_id',v_id,'status',
    case when v_status = 'identified' and array_length(v_gaps,1) is null then 'identified' else 'draft' end,
    'gaps',coalesce(to_jsonb(v_gaps),'[]'::jsonb));
end;
$$;
grant execute on function public.create_risk_assessment(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
