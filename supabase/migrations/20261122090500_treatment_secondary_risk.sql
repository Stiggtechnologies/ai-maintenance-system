-- ============================================================================
-- Sync Develop Slice 3C — a treatment that creates a new risk creates a
-- LINKED RISK (D5.25, spec III.§15), and the §15 strategy vocabulary becomes
-- an enforced enum rather than an RPC-only convention.
--
-- SPEC §15, VERBATIM: "Treatment: id, risk_id, owner_id, strategy,
-- expected_reduction, cost, expected_benefit, new_risk_created, due_date,
-- status."
--
-- OVERLAP-MAP RULING IS BINDING: treatments ride the canonical recommendation
-- model (scenarios as the options + recommendations as the selected treatment
-- + risk_treatment_dependencies). NO standalone Treatment table is created
-- here. Eight of the ten §15 fields are already live and reachable from the
-- /risk cockpit (risk_id, owner via treatment_owner_id, strategy, expected
-- residual/net change, cost, due via required_completion_date, status).
--
-- WHAT WAS MISSING, AND WHY IT MATTERED: `new_risk_created` existed only as
-- `introduced_risks`, a jsonb array of free text. "Bypassing the interlock
-- introduces a new hazard" sat in a jsonb blob with no owner, no rating, no
-- review date, no treatment of its own, and no way for the risk register to
-- know it existed. A secondary risk that is a sentence inside the record of
-- the risk that caused it is a secondary risk nobody manages — which is the
-- ordinary way treatments make things worse.
--
-- RULINGS THIS FILE TAKES:
--
--   * `introduced_risks` KEEPS ITS EXACT MEANING — the mandatory assessment
--     ("even when the answer is an empty array", 20260921110101:1979). It is
--     not repurposed and its contents are stored byte-identically.
--     `new_risk_created` is the NEW, §15-named key: the subset of that
--     assessment which is a real, ratable risk, given as objects. Empty
--     assessment + non-empty new_risk_created is a contradiction and is
--     REFUSED — a treatment cannot both introduce nothing and introduce
--     something.
--
--   * THE LINKED RISK IS A REAL `risks` ROW (ruling: no parallel risk store)
--     created in the SAME TRANSACTION as the treatment, so a treatment
--     recorded with a secondary risk that failed to create cannot exist.
--
--   * IT INHERITS THE PARENT'S OBJECTIVE, and this is a ruling, not a
--     convenience: a risk created BY treating risk R threatens the same
--     objective R threatens — that is why the treatment was worth doing.
--     The D11.16 invariant (20261115090000) requires every risk to link to
--     an objective, so a parent carrying no objective link (a grandfathered
--     row) REFUSES the secondary creation BY NAME rather than letting the
--     invariant raise a less useful error one frame later. Fail closed on a
--     missing link — the 3B posture.
--
--   * A SECONDARY RISK IS BORN 'draft', NOT 'identified'. The risks table
--     carries a lifecycle contract (scope decision, horizon, biases, method
--     limitations and more) that a status of 'identified' must satisfy. This
--     file will not invent those fields to make a status look further along,
--     and it will not let their absence refuse the treatment either. The risk
--     exists, is rated and is owned; its promotion is its owner's act on the
--     same terms as every other risk.
--
--   * A SECONDARY RISK MUST BE RATED AT BIRTH. Title, event description,
--     current score and current level are all required, and non-finite
--     numerics are refused explicitly ('NaN'::numeric = 'NaN' is TRUE in
--     Postgres, so a range check alone lets NaN through). An unrated
--     secondary risk cannot be compared with the risk the treatment was
--     supposed to reduce, which makes net_risk_change a number with nothing
--     behind it.
--
--   * THE LINK IS TWO TYPED COLUMNS ON `risks`, not a jsonb pointer:
--     secondary_to_risk_id (the risk whose treatment caused it) and
--     arising_from_scenario_id (the treatment option itself). Both ON DELETE
--     SET NULL with the origin preserved in the ledger — the risk survives
--     its parent, because the hazard does.
--
--   * THE §15 STRATEGY ENUM IS ENFORCED AT THE DATABASE. The seven ISO 31000
--     strategies were checked only inside create_risk_treatment; a direct
--     write could store any string. Narrowing an accepted set is the
--     permitted direction, and no path in this repository writes a value
--     outside it (create_risk_treatment is the only writer).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The §15 strategy enum, enforced.
-- ---------------------------------------------------------------------------
alter table public.scenarios
  drop constraint if exists scenarios_treatment_strategy_check;
alter table public.scenarios
  add constraint scenarios_treatment_strategy_check check (
    treatment_strategy is null or treatment_strategy in
      ('avoid','pursue_opportunity','remove_source','change_likelihood',
       'change_consequence','share','retain'));

alter table public.recommendations
  drop constraint if exists recommendations_treatment_strategy_check;
alter table public.recommendations
  add constraint recommendations_treatment_strategy_check check (
    treatment_strategy is null or treatment_strategy in
      ('avoid','pursue_opportunity','remove_source','change_likelihood',
       'change_consequence','share','retain'));

comment on column public.scenarios.treatment_strategy is
  'D5.25 / spec §15 + ISO 31000 6.5.2: avoid, pursue_opportunity, remove_source, change_likelihood, change_consequence, share, retain. Enforced at the database since 20261122090500 — previously RPC-only.';

-- ---------------------------------------------------------------------------
-- 2. The secondary-risk linkage on the ONE risks table.
-- ---------------------------------------------------------------------------
alter table public.risks
  add column if not exists secondary_to_risk_id uuid references risks(id) on delete set null,
  add column if not exists arising_from_scenario_id uuid references scenarios(id) on delete set null;

create index if not exists idx_risks_secondary_to
  on risks(organization_id, secondary_to_risk_id)
  where secondary_to_risk_id is not null;

comment on column public.risks.secondary_to_risk_id is
  'D5.25 / spec §15 new_risk_created: this risk was CREATED BY treating the referenced risk. A secondary risk that lives only as prose inside its parent''s treatment is a risk nobody manages.';

-- A risk cannot be its own secondary risk, and the chain cannot close on
-- itself — a two-row cycle would make "what created this?" unanswerable.
create or replace function public.enforce_secondary_risk_acyclic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor uuid := new.secondary_to_risk_id;
  v_hops int := 0;
begin
  if new.secondary_to_risk_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.secondary_to_risk_id is not distinct from old.secondary_to_risk_id then
    return new;
  end if;
  if new.secondary_to_risk_id = new.id then
    raise exception
      'A risk cannot be the secondary risk created by treating itself (spec §15).'
      using errcode = 'check_violation';
  end if;
  while v_cursor is not null and v_hops < 64 loop
    if v_cursor = new.id then
      raise exception
        'That link would close the secondary-risk chain into a cycle: risk % already sits upstream of this one, so "what created this risk?" would have no answer.', new.secondary_to_risk_id
        using errcode = 'check_violation';
    end if;
    select r.secondary_to_risk_id into v_cursor from risks r where r.id = v_cursor;
    v_hops := v_hops + 1;
  end loop;
  return new;
end
$$;

revoke all on function public.enforce_secondary_risk_acyclic() from public, anon, authenticated;

drop trigger if exists trg_secondary_risk_acyclic on public.risks;
create trigger trg_secondary_risk_acyclic
  before insert or update on public.risks
  for each row execute function public.enforce_secondary_risk_acyclic();

-- ---------------------------------------------------------------------------
-- 2b. THE SECONDARY RISK'S PROVENANCE IS NOT SEVERABLE.
--
--     `scenarios` carries a permissive `for all` policy and
--     `risks.arising_from_scenario_id` is ON DELETE SET NULL, so any org
--     member could delete the treatment option and leave
--     get_risk_secondary_risks reporting a risk created by treating X *by no
--     treatment* — with nothing distinguishing "severed" from "never
--     linked". The header above says the link is two typed columns precisely
--     so that question stays answerable.
--
--     Same per-command restrictive idiom as D11.17's evidence_items
--     hardening and this slice's work_orders landing (20261122090200 §2b),
--     scoped to the scenarios a secondary risk points at. Ordinary treatment
--     options are untouched.
-- ---------------------------------------------------------------------------
create index if not exists idx_risks_arising_from_scenario
  on risks(arising_from_scenario_id)
  where arising_from_scenario_id is not null;

drop policy if exists scenarios_secondary_origin_no_del on public.scenarios;
create policy scenarios_secondary_origin_no_del on public.scenarios as restrictive
  for delete to authenticated
  using (not exists (
    select 1 from risks r where r.arising_from_scenario_id = scenarios.id));

-- ---------------------------------------------------------------------------
-- 3. create_risk_treatment, RE-CREATED from its 20260921110101:1942
--    definition with FIVE marked insertions, each one counted (an earlier
--    draft of this comment said "exactly TWO" and listed the audit event
--    among the byte-identical parts, which it is not — a re-creation review
--    is bounded by these counts, so an undercount invites the skim that
--    produced this slice's first regression):
--      (1) the DECLARE block's secondary-risk variables;
--      (2) the new_risk_created validation block, before any write, so a bad
--          secondary risk refuses the whole treatment rather than
--          half-creating it;
--      (3) the introduced-risk floor, which makes net_risk_change account
--          for the hazards the treatment creates;
--      (4) the creation block, after the scenario exists so the link can
--          point at it, with its own audit event per secondary risk;
--      (5) the 'secondary_risks' key on the returned payload and on the
--          treatment's audit event.
--    Everything else — the strategy check, the resource/competency readiness
--    walk, the residual arithmetic, the recommendation contract and the
--    approval row — is byte-identical.
-- ---------------------------------------------------------------------------
create or replace function public.create_risk_treatment(
  p_risk_id uuid,
  p_option jsonb,
  p_select boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  r risks%rowtype;
  v_scenario uuid;
  v_rec uuid;
  v_approval uuid;
  v_strategy text := p_option->>'strategy';
  v_required jsonb := coalesce(p_option->'required_resources','[]'::jsonb);
  v_available jsonb := coalesce(p_option->'available_resources','[]'::jsonb);
  v_competencies jsonb := coalesce(p_option->'required_competencies','[]'::jsonb);
  v_missing jsonb := '[]'::jsonb;
  v_executable boolean := true;
  v_residual numeric;
  v_introduced numeric;
  v_net numeric;
  item text;
  -- D5.25 (20261122090500, marked insertion): the §15 secondary risks.
  v_new_risks jsonb := coalesce(p_option->'new_risk_created','[]'::jsonb);
  v_new_risk jsonb;
  v_secondary uuid;
  v_secondary_ids jsonb := '[]'::jsonb;
  v_score numeric;
  v_owner uuid;
  v_secondary_max numeric := 0;
  v_secondary_worst text;
begin
  select * into r from risks where id = p_risk_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_strategy not in ('avoid','pursue_opportunity','remove_source','change_likelihood',
    'change_consequence','share','retain') then
    return jsonb_build_object('error','invalid ISO 31000 treatment strategy');
  end if;
  if coalesce(btrim(p_option->>'label'),'') = '' then
    return jsonb_build_object('error','treatment label is required');
  end if;
  v_residual := nullif(p_option->>'residual_risk','')::numeric;
  v_introduced := coalesce(nullif(p_option->>'introduced_risk','')::numeric,0);
  if v_residual is null then return jsonb_build_object('error','expected residual risk is required'); end if;
  if not (p_option ? 'introduced_risks') then
    return jsonb_build_object('error','introduced_risks must be assessed, even when the answer is an empty array');
  end if;

  -- D5.25 (20261122090500, marked insertion): validate every secondary risk
  -- BEFORE anything is written. A treatment whose secondary risk cannot be
  -- rated is refused whole — half a treatment with a missing hazard record
  -- is the failure this row exists to close.
  if jsonb_typeof(v_new_risks) <> 'array' then
    return jsonb_build_object('error',
      'new_risk_created is an array of the risks this treatment creates (spec §15) — one object per risk, each rated');
  end if;
  if jsonb_array_length(v_new_risks) > 0
     and jsonb_array_length(coalesce(p_option->'introduced_risks','[]'::jsonb)) = 0 then
    return jsonb_build_object('error',
      'this treatment states it introduces no risks (introduced_risks is empty) yet names risks it creates — a treatment cannot both introduce nothing and introduce something');
  end if;
  if jsonb_array_length(v_new_risks) > 0 and r.objective_id is null then
    return jsonb_build_object('error',
      'a risk created by treating this risk threatens the same objective this risk threatens, and this risk carries no objective link (a pre-invariant row). Link it first (link_risk_objective) — inventing an objective for the secondary risk would fabricate what it endangers');
  end if;
  for v_new_risk in select * from jsonb_array_elements(v_new_risks) loop
    if coalesce(length(btrim(coalesce(v_new_risk->>'title',''))),0) < 5 then
      return jsonb_build_object('error',
        'each risk this treatment creates carries a title (5 characters minimum) — spec §15 new_risk_created');
    end if;
    if coalesce(length(btrim(coalesce(v_new_risk->>'event_description',''))),0) < 10 then
      return jsonb_build_object('error',
        format('secondary risk "%s" states no event — what actually happens if it occurs (10 characters minimum)', v_new_risk->>'title'));
    end if;
    v_score := nullif(v_new_risk->>'current_risk_score','')::numeric;
    if v_score is null then
      return jsonb_build_object('error',
        format('secondary risk "%s" is unrated (current_risk_score). An unrated risk created by a treatment cannot be compared with the risk the treatment reduces, which leaves net_risk_change standing on nothing', v_new_risk->>'title'));
    end if;
    if v_score = 'NaN'::numeric or v_score < 0 or v_score > 100 then
      return jsonb_build_object('error',
        format('secondary risk "%s" carries a non-finite or out-of-range score — a rating must be a finite number between 0 and 100', v_new_risk->>'title'));
    end if;
    if coalesce(v_new_risk->>'current_risk_level','') not in
       ('Very Low','Low','Medium','High','Critical') then
      return jsonb_build_object('error',
        format('secondary risk "%s" states no risk level (Very Low, Low, Medium, High, Critical)', v_new_risk->>'title'));
    end if;
    v_owner := coalesce(nullif(v_new_risk->>'risk_owner_id','')::uuid,
                        nullif(p_option->>'treatment_owner_id','')::uuid,
                        r.risk_owner_id);
    if v_owner is null or not exists (
      select 1 from user_profiles where id = v_owner and organization_id = v_org) then
      return jsonb_build_object('error',
        format('secondary risk "%s" has no owner in this organization — a hazard the treatment creates and nobody owns is the exact failure spec §15 names', v_new_risk->>'title'));
    end if;
    if v_score > v_secondary_max then
      v_secondary_max := v_score;
      v_secondary_worst := btrim(v_new_risk->>'title');
    end if;
  end loop;

  -- D5.25 (20261122090500, marked insertion): THE RATED SECONDARY RISKS ENTER
  -- THE ARITHMETIC.
  --
  -- This row demands a rating on every risk a treatment creates, and states
  -- why: "an unrated secondary risk leaves net_risk_change standing on
  -- nothing". The first draft collected the ratings, wrote them onto real
  -- risks rows — and then computed net_risk_change from the caller's free
  -- text `introduced_risk` scalar, cross-checking nothing. A treatment could
  -- be recorded as a 60-point improvement in the same transaction that
  -- created a Critical 95-point hazard. The rating was demanded and ignored.
  --
  -- The floor is the GREATEST secondary score, not the sum: two hazards of 60
  -- and 95 are not a 155-point exposure, but the treatment introduces at
  -- least the worst of them. Refused rather than silently floored, because
  -- overwriting the caller's stated number would replace one invented
  -- quantity with another.
  if v_secondary_max > 0 and v_introduced < v_secondary_max then
    return jsonb_build_object('error',
      format('this treatment states it introduces %s of risk while creating "%s", rated %s — introduced_risk must be at least the greatest secondary-risk score, or expected_risk_reduction claims an improvement the treatment''s own new hazards contradict (spec §15)',
             v_introduced, v_secondary_worst, v_secondary_max));
  end if;

  for item in select jsonb_array_elements_text(v_required) loop
    if not (v_available ? item) then
      v_missing := v_missing || jsonb_build_array('resource: ' || item);
      v_executable := false;
    end if;
  end loop;
  -- Competency requirements name the canonical competency key. At least one
  -- active workforce member must hold each key; identity is not guessed.
  for item in select jsonb_array_elements_text(v_competencies) loop
    if not exists (
      select 1 from competencies c
      join member_competencies mc on mc.competency_id = c.id
      join workforce_members wm on wm.id = mc.member_id and wm.active
      where c.organization_id = v_org and c.competency_key = item
        and (mc.expires_on is null or mc.expires_on >= current_date)
    ) then
      v_missing := v_missing || jsonb_build_array('competency: ' || item);
      v_executable := false;
    end if;
  end loop;
  v_net := coalesce(r.current_risk_score,0) - v_residual - v_introduced;

  insert into scenarios (
    organization_id, risk_id, asset_id, key, label, cost, downtime_impact,
    production_impact, safety_risk, environmental_risk, financial_exposure,
    mission_readiness_impact, recommended, treatment_strategy,
    expected_residual_risk, introduced_risks, expected_risk_reduction,
    confidence, required_resources, available_resources,
    required_competencies, executable, readiness_gaps, asset_life_impact,
    objective_tradeoffs
  ) values (
    v_org,r.id,r.asset_id,coalesce(p_option->>'key',v_strategy),btrim(p_option->>'label'),
    coalesce((p_option->>'cost')::numeric,0),p_option->>'downtime_impact',
    p_option->>'production_impact',p_option->>'safety_risk',p_option->>'environmental_risk',
    p_option->>'financial_exposure',p_option->>'mission_readiness_impact',p_select,
    v_strategy,v_residual,coalesce(p_option->'introduced_risks','[]'::jsonb),v_net,
    nullif(p_option->>'confidence','')::numeric,v_required,v_available,
    v_competencies,v_executable,v_missing,p_option->>'asset_life_impact',
    coalesce(p_option->'objective_tradeoffs','{}'::jsonb)
  ) returning id into v_scenario;

  -- D5.25 (20261122090500, marked insertion): the secondary risks become
  -- REAL risks, in this transaction, linked both ways, each audited. They
  -- inherit the parent's objective (header ruling), context, criteria
  -- profile, site and asset — the same exposure, arrived at differently.
  for v_new_risk in select * from jsonb_array_elements(v_new_risks) loop
    v_owner := coalesce(nullif(v_new_risk->>'risk_owner_id','')::uuid,
                        nullif(p_option->>'treatment_owner_id','')::uuid,
                        r.risk_owner_id);
    insert into risks (
      organization_id, context_id, criteria_profile_id, site_id, asset_id,
      objective_id, development_case_id, title, kind, objective_at_risk,
      risk_source, event_description, current_risk_score, current_risk_level,
      risk_owner_id, status, source_kind, created_by,
      secondary_to_risk_id, arising_from_scenario_id
    ) values (
      v_org, r.context_id, r.criteria_profile_id, r.site_id, r.asset_id,
      r.objective_id, r.development_case_id, btrim(v_new_risk->>'title'),
      'threat', r.objective_at_risk,
      format('Secondary risk created by the "%s" treatment of risk "%s"',
             btrim(p_option->>'label'), r.title),
      btrim(v_new_risk->>'event_description'),
      nullif(v_new_risk->>'current_risk_score','')::numeric,
      -- BORN 'draft', deliberately (header ruling): the platform's own risk
      -- lifecycle contract requires a full scoping record before a risk may
      -- stand at 'identified', and this file will neither fabricate those
      -- fields nor let the missing scope refuse the treatment. The secondary
      -- risk is real, rated and owned from the moment it exists; promoting it
      -- through the lifecycle is the owner's act, on the same terms as every
      -- other risk.
      v_new_risk->>'current_risk_level', v_owner, 'draft', 'human', auth.uid(),
      r.id, v_scenario
    ) returning id into v_secondary;

    v_secondary_ids := v_secondary_ids || jsonb_build_array(jsonb_build_object(
      'risk_id', v_secondary, 'title', btrim(v_new_risk->>'title'),
      'level', v_new_risk->>'current_risk_level',
      'score', nullif(v_new_risk->>'current_risk_score','')::numeric));

    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (v_org,'risk_secondary_created',
      coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
      jsonb_build_object('risk_id', v_secondary, 'parent_risk_id', r.id,
        'scenario_id', v_scenario, 'treatment_strategy', v_strategy,
        'title', btrim(v_new_risk->>'title'),
        'level', v_new_risk->>'current_risk_level'),
      null,
      jsonb_build_object('status','draft','secondary_to_risk_id', r.id,
        'arising_from_scenario_id', v_scenario,
        'current_risk_level', v_new_risk->>'current_risk_level'));
  end loop;

  if p_select then
    if not v_executable then
      return jsonb_build_object('scenario_id',v_scenario,'selected',false,
        'error','treatment is not executable','readiness_gaps',v_missing);
    end if;
    if coalesce(length(btrim(p_option->>'rationale')),0) < 20
       or coalesce(btrim(p_option->>'consequence_summary'),'') = ''
       or coalesce(btrim(p_option->>'alternatives_considered'),'') = ''
       or nullif(p_option->>'required_completion_date','') is null
       or coalesce(btrim(p_option->>'required_approver_role'),'') = ''
       or coalesce(btrim(p_option->>'verification_method'),'') = ''
       or nullif(p_option->>'treatment_owner_id','') is null
       or not exists(select 1 from user_profiles where
         id=(p_option->>'treatment_owner_id')::uuid and organization_id=v_org) then
      return jsonb_build_object('scenario_id',v_scenario,'selected',false,
        'error','selected treatment lacks the canonical recommendation contract or named treatment owner');
    end if;
    insert into recommendations (
      organization_id, risk_id, asset_id, title, issue, action, impact,
      confidence, urgency, status, approval_required, accountable, responsible,
      consulted, informed, financial_impact, risk_impact, rationale,
      consequence_summary, alternatives_considered, required_completion_date,
      required_approver_role, verification_method, estimated_cost_usd,
      treatment_strategy, treatment_owner_id, original_risk_score,
      expected_residual_risk_score, target_risk_score, new_risks_introduced,
      net_risk_change, resource_readiness, raised_by
    ) values (
      v_org,r.id,r.asset_id,btrim(p_option->>'label'),r.event_description,
      coalesce(p_option->>'action',p_option->>'label'),p_option->>'impact',
      coalesce((p_option->>'confidence')::int,round(coalesce(r.confidence,0))::int),
      case when r.current_risk_level in ('Critical','High') then 'critical' else 'action' end,
      'pending',p_option->>'required_approver_role',
      coalesce((select full_name from user_profiles where id=r.risk_owner_id),'Named risk owner'),
      coalesce((select full_name from user_profiles where id=(p_option->>'treatment_owner_id')::uuid),'Named treatment owner'),
      array_to_string(array(select jsonb_array_elements_text(r.stakeholders)),', '),
      p_option->>'informed',p_option->>'financial_exposure',coalesce(r.current_risk_level,'Medium'),
      btrim(p_option->>'rationale'),btrim(p_option->>'consequence_summary'),
      btrim(p_option->>'alternatives_considered'),(p_option->>'required_completion_date')::date,
      p_option->>'required_approver_role',p_option->>'verification_method',
      coalesce((p_option->>'cost')::numeric,0),v_strategy,
      (p_option->>'treatment_owner_id')::uuid,r.current_risk_score,v_residual,
      coalesce(nullif(p_option->>'target_risk','')::numeric,r.target_risk_score),
      coalesce(p_option->'introduced_risks','[]'::jsonb),v_net,
      jsonb_build_object('executable',v_executable,'gaps',v_missing),auth.uid()
    ) returning id into v_rec;
    insert into approvals (
      organization_id,risk_id,recommendation_id,status,owner_role,reason,
      consequence_of_wrong,required_validation
    ) values (
      v_org,r.id,v_rec,'required',p_option->>'required_approver_role',
      'Human approval required before risk treatment becomes executable work.',
      p_option->>'consequence_summary',p_option->>'verification_method'
    ) returning id into v_approval;
    update risks set status = 'treatment_active',updated_at=now() where id=r.id;
  end if;
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_treatment',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'scenario_id',v_scenario,'selected',p_select,
      'recommendation_id',v_rec,'approval_id',v_approval,'executable',v_executable,
      -- D5.25 (20261122090500, marked insertion).
      'secondary_risks',v_secondary_ids));
  return jsonb_build_object('scenario_id',v_scenario,'selected',p_select,
    'executable',v_executable,'readiness_gaps',v_missing,
    'recommendation_id',v_rec,'approval_id',v_approval,'net_risk_change',v_net,
    'human_approval_required',p_select,
    -- D5.25 (20261122090500, marked insertion).
    'secondary_risks',v_secondary_ids);
end;
$$;
grant execute on function public.create_risk_treatment(uuid, jsonb, boolean) to authenticated, service_role;
revoke execute on function public.create_risk_treatment(uuid,jsonb,boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. The read: what a treatment created, from either end.
-- ---------------------------------------------------------------------------
create or replace function public.get_risk_secondary_risks(p_risk_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r risks%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into r from risks where id = p_risk_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'risk not found in this organization');
  end if;
  -- THE SENSITIVITY LADDER APPLIES HERE TOO. This is a SECURITY DEFINER read,
  -- so `risks_sensitive_read` (can_read_risk — public/internal/confidential/
  -- restricted) does NOT apply on its own, and the first draft scoped by
  -- organization alone. A technician refused the row by RLS could read the
  -- same risk's title, and every child risk's title, score, level, owner and
  -- treatment label, straight out of this function. definerTenancy.test.ts
  -- cannot see it — its scanner inspects functions taking an organization
  -- argument — so the predicate is stated here explicitly.
  if not can_read_risk(r.id) then
    return jsonb_build_object('error', 'risk not found in this organization');
  end if;
  return jsonb_build_object(
    'riskId', r.id,
    'title', r.title,
    'createdByTreatmentOf', case when r.secondary_to_risk_id is null then null else (
      select jsonb_build_object('riskId', p.id, 'title', p.title,
        'treatment', (select s.label from scenarios s where s.id = r.arising_from_scenario_id),
        'strategy', (select s.treatment_strategy from scenarios s where s.id = r.arising_from_scenario_id))
      from risks p where p.id = r.secondary_to_risk_id and can_read_risk(p.id)) end,
    'createdRisks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'riskId', s.id,
        'title', s.title,
        'level', s.current_risk_level,
        'score', s.current_risk_score,
        'status', s.status,
        'owner', (select coalesce(up.full_name, up.email) from user_profiles up where up.id = s.risk_owner_id),
        'treatment', (select sc.label from scenarios sc where sc.id = s.arising_from_scenario_id),
        'strategy', (select sc.treatment_strategy from scenarios sc where sc.id = s.arising_from_scenario_id))
        order by case s.current_risk_level when 'Critical' then 0 when 'High' then 1 else 2 end, s.title)
      from risks s
      where s.organization_id = v_org and s.secondary_to_risk_id = r.id
        and can_read_risk(s.id)
    ), '[]'::jsonb));
end
$$;

revoke all on function public.get_risk_secondary_risks(uuid) from public, anon;
grant execute on function public.get_risk_secondary_risks(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
