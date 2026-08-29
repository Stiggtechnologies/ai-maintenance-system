-- ============================================================================
-- Sync Develop Slice 3D — the Risk Agent's treatment recommendations
-- (D12.12, spec III.§62).
--
-- §62: "ISO 31000 workflow support; recommends, never accepts high-consequence
-- risk".
--
-- WHAT SHIPPED ALREADY. provision_risk_advisory_agents seeds ten advisory
-- agents against the ISO 31000 engine keys, every one born
-- risk_evidence_only, risk_may_approve=false, risk_may_accept=false, with the
-- table-level constraint ai_agents_no_risk_authority making those two flags
-- unsettable (20260921110102:2266). configure_risk_agent_binding re-asserts
-- the same three flags on every configuration. Acceptance is human-only at
-- accept_risk (ai_admin refused by name) and at
-- enforce_extended_risk_acceptance_authority. All of that is the boundary and
-- none of it is rebuilt here.
--
-- WHAT WAS MISSING, and is added: the agent had a charter and no work
-- product. This file gives it one — a treatment RECOMMENDATION against a
-- named ISO 31000 workflow step — and binds it to the shipped agent row so a
-- recommendation cannot exist without an agent that is structurally incapable
-- of approving or accepting anything.
--
-- THE ADOPTION PATH IS THE SHIPPED ONE. adopt_risk_treatment_advice does not
-- write a treatment; it calls create_risk_treatment (20261122090500), which
-- keeps every refusal it already makes — the §15 strategy enum, mandatory
-- residual, introduced_risks assessed even when empty, secondary risks rated
-- and owned, the objective-link precondition. The advice row is then marked
-- adopted and points at the treatment. One treatment model, as ruling D5.25
-- requires.
--
-- SPEC AMBIGUITY RESOLVED (§62's "never accepts HIGH-CONSEQUENCE risk" could
-- be read as: the agent may accept low ones). RULING: no. The boundary in
-- this product is not consequence-graded — accept_risk refuses the
-- AI-operator identity at every level, and this file does not carve an
-- exception for "low". A rule that permitted machine acceptance below a
-- threshold would put the threshold, not the human, in charge of §70. The
-- register row states this as a deliberate strengthening of the spec, not a
-- gap.
--
-- SPEC AMBIGUITY RESOLVED (which workflow steps?). RULING: the enum is the
-- one already enforced on ai_agents.risk_engine_key — twelve values, the ISO
-- 31000 spine this product already speaks. A second vocabulary for "workflow
-- step" would be a second answer to "where in the process is this".
-- ============================================================================

create table if not exists public.risk_treatment_advice (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  -- The SHIPPED advisory agent. Not a string naming one: the row itself, so
  -- the no-authority constraint on ai_agents stands behind every piece of
  -- advice.
  agent_id uuid not null references ai_agents(id) on delete restrict,
  -- The ISO 31000 step this advice belongs to — the ai_agents.risk_engine_key
  -- vocabulary, unchanged.
  workflow_step text not null check (workflow_step in
    ('context','criteria','identification','analysis','evaluation','treatment',
     'execution','assurance','monitoring','learning','governance','evidence')),
  -- The §15 strategies, the same seven create_risk_treatment enforces.
  recommended_strategy text not null check (recommended_strategy in
    ('avoid','pursue_opportunity','remove_source','change_likelihood',
     'change_consequence','share','retain')),
  label text not null check (btrim(label) <> ''),
  rationale text not null check (length(btrim(rationale)) >= 20),
  -- What the agent expects the treatment to leave behind, and what it thinks
  -- the treatment introduces. Both stated or the advice is not comparable
  -- with anything.
  expected_residual numeric not null
    check (expected_residual >= 0 and expected_residual <= 100),
  expected_introduced numeric not null default 0
    check (expected_introduced >= 0 and expected_introduced <= 100),
  -- Named limitations. §62's agent exposes uncertainty; a recommendation with
  -- no stated limits is the one nobody checks.
  limitations text not null check (length(btrim(limitations)) >= 10),
  evidence_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_ids) = 'array'),
  model text,
  status text not null default 'proposed'
    check (status in ('proposed','adopted','dismissed')),
  -- The treatment a human created FROM this advice. The canonical treatment
  -- model is the recommendation family (ruling D5.25).
  adopted_treatment_id uuid references recommendations(id) on delete set null,
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  dismissed_reason text,
  dismissed_by uuid references auth.users(id),
  dismissed_at timestamptz,
  proposed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint treatment_advice_terminal check (
    (status <> 'adopted'
      or (adopted_treatment_id is not null and adopted_by is not null and adopted_at is not null))
    and (status <> 'dismissed'
      or (btrim(coalesce(dismissed_reason, '')) <> '' and dismissed_by is not null))
  )
);

create index if not exists idx_treatment_advice_risk
  on risk_treatment_advice(organization_id, risk_id, status, created_at desc);

alter table public.risk_treatment_advice enable row level security;
drop policy if exists risk_treatment_advice_read on public.risk_treatment_advice;
create policy risk_treatment_advice_read on public.risk_treatment_advice
  for select to authenticated
  using (organization_id = app_current_org() and can_read_risk(risk_id));

-- ---------------------------------------------------------------------------
-- THE §70 WALL, INSERT / UPDATE / DELETE.
--
--   * the bound agent must be one that structurally cannot approve or accept
--     — checked cross-table, which a row-local CHECK cannot see;
--   * an adoption must be recorded by a human: the AI-operator identity can
--     never stand as adopted_by, for any writer, service included;
--   * a DISMISSAL must be recorded by a human, for the same reason and with
--     more force. dismiss_risk_treatment_advice refuses the identity at the
--     RPC — "the AI-operator identity cannot dismiss its own recommendation" —
--     and until this arm existed there was nothing behind that sentence. The
--     dismissals are how anyone finds out whether the agent is worth listening
--     to (see the read below), so leaving them writable by the thing being
--     measured made the one honest signal in this table corruptible;
--   * advice is never written directly, and never deleted — a dismissed
--     recommendation is the record that a machine suggested something a human
--     declined. The DELETE branch stands aside mid-cascade, because an FK that
--     declares `on delete cascade` and a trigger that refuses every delete
--     between them make the parent undeletable.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_treatment_advice_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.treatment_advice_write', true), '');
  a ai_agents%rowtype;
  v_role text;
begin
  if tg_op = 'DELETE' then
    -- Mid-cascade: the risk or the organization this advice hangs off is
    -- already gone (the enforce_framework_immutability idiom, 20261101090100).
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from risks where id = old.risk_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'Treatment advice is the record that an agent recommended something. It is not deleted — '
        'dismiss it with a reason (dismiss_risk_treatment_advice).'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if v_marker <> 'granted' then
    raise exception
      'Treatment advice cannot be written directly: record_risk_treatment_advice, '
      'adopt_risk_treatment_advice and dismiss_risk_treatment_advice are the paths.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into a from ai_agents where id = new.agent_id;
  if not found or a.organization_id <> new.organization_id then
    raise exception 'Treatment advice names an advisory agent of its own organization.'
      using errcode = 'check_violation';
  end if;
  if a.risk_may_approve or a.risk_may_accept or not coalesce(a.risk_evidence_only, false) then
    raise exception
      'Agent "%" is not evidence-only: it carries approve=% accept=%. Advice may only come from an '
      'agent that structurally cannot approve work or accept risk (spec §62, §70).',
      a.name, a.risk_may_approve, a.risk_may_accept
      using errcode = 'check_violation';
  end if;

  -- The adoption actor, on INSERT and on every UPDATE that names one.
  if new.adopted_by is not null
     and (tg_op = 'INSERT' or new.adopted_by is distinct from old.adopted_by) then
    select role into v_role from user_profiles where id = new.adopted_by;
    if coalesce(v_role, '') = 'ai_admin' then
      raise exception
        'Adopting a treatment is a human act: the AI-operator identity recommends, it does not decide '
        'what the organization will do about a risk (spec §62, §70).'
        using errcode = 'check_violation';
    end if;
  end if;

  -- The DISMISSAL actor, on the same guard. See the header: an agent that can
  -- bury its own recommendation controls the record of how good it is.
  if new.dismissed_by is not null
     and (tg_op = 'INSERT' or new.dismissed_by is distinct from old.dismissed_by) then
    select role into v_role from user_profiles where id = new.dismissed_by;
    if coalesce(v_role, '') = 'ai_admin' then
      raise exception
        'Dismissing a treatment recommendation is a human judgement about a machine''s work — the '
        'AI-operator identity cannot mark its own recommendation dead any more than it can adopt it '
        '(spec §62, §70).'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_treatment_advice_boundary() from public, anon, authenticated;

drop trigger if exists trg_treatment_advice_boundary on public.risk_treatment_advice;
create trigger trg_treatment_advice_boundary
  before insert or update or delete on public.risk_treatment_advice
  for each row execute function public.enforce_treatment_advice_boundary();

-- ---------------------------------------------------------------------------
-- RECOMMEND. The agent's act. The AI-operator identity is admitted.
-- ---------------------------------------------------------------------------
create or replace function public.record_risk_treatment_advice(
  p_risk_id uuid,
  p_advice jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  r risks%rowtype;
  a ai_agents%rowtype;
  v_step text := btrim(coalesce(p_advice->>'workflow_step', ''));
  v_strategy text := btrim(coalesce(p_advice->>'recommended_strategy', ''));
  v_residual numeric;
  v_introduced numeric;
  v_id uuid;
  v_evidence jsonb := coalesce(p_advice->'evidence_ids', '[]'::jsonb);
  v_bad_evidence int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- "Has a profile" was the whole authorisation here, so the lowest-privileged
  -- member could author a row that renders on the assurance screen under a bot
  -- icon as the risk agent's recommendation, immutable and undeletable, with
  -- adopt and dismiss forms attached to it. Same set every sibling RPC in this
  -- slice uses; proposed_by is returned by get_case_treatment_advice so the
  -- author is on the screen either way.
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'recording a treatment recommendation requires a governance, engineering or AI-operator role — the row is attributed to an advisory agent and carries adopt and dismiss actions');
  end if;
  select * into r from risks where id = p_risk_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'risk not found in this organization');
  end if;
  if not can_read_risk(r.id) then
    return jsonb_build_object('error', 'risk not found in this organization');
  end if;

  -- The treatment-engine agent, provisioned by the shipped RPC. Its absence
  -- is a NAMED refusal, not a silent creation: an advisory agent is a
  -- configuration act (provision_risk_advisory_agents), and minting one here
  -- would be this file arming itself.
  select * into a from ai_agents
  where organization_id = v_org and risk_engine_key = 'treatment'
    and coalesce(status, '') = 'active'
  order by created_at limit 1;
  if not found then
    return jsonb_build_object('error',
      'no active advisory agent is bound to the ISO 31000 treatment engine in this organization — provision the advisory agents first (provision_risk_advisory_agents), which creates them evidence-only and without approval or acceptance authority');
  end if;

  if v_step not in ('context','criteria','identification','analysis','evaluation','treatment',
                    'execution','assurance','monitoring','learning','governance','evidence') then
    return jsonb_build_object('error',
      'workflow_step must be one of the twelve ISO 31000 engine steps this product already speaks');
  end if;
  if v_strategy not in ('avoid','pursue_opportunity','remove_source','change_likelihood',
                        'change_consequence','share','retain') then
    return jsonb_build_object('error', 'invalid ISO 31000 treatment strategy');
  end if;
  if coalesce(length(btrim(coalesce(p_advice->>'label',''))), 0) < 5 then
    return jsonb_build_object('error', 'the recommendation needs a label (5 characters minimum)');
  end if;
  if coalesce(length(btrim(coalesce(p_advice->>'rationale',''))), 0) < 20 then
    return jsonb_build_object('error', 'state why this treatment is recommended (20 characters minimum)');
  end if;
  if coalesce(length(btrim(coalesce(p_advice->>'limitations',''))), 0) < 10 then
    return jsonb_build_object('error',
      'state the limitations of this recommendation (10 characters minimum) — an agent that exposes no uncertainty is the one nobody checks (spec §62)');
  end if;
  -- sync_text_as_numeric, not a bare cast: p_advice is caller JSON, and
  -- `"expected_residual": "about forty"` raised `invalid input syntax for type
  -- numeric` AT THE USER — a raw 22P02 naming a Postgres type instead of the
  -- field (the 20261122090000 §0 helpers exist for exactly this).
  v_residual := sync_text_as_numeric(nullif(p_advice->>'expected_residual',''));
  if nullif(p_advice->>'expected_introduced','') is not null
     and sync_text_as_numeric(p_advice->>'expected_introduced') is null then
    return jsonb_build_object('error',
      format('expected_introduced is not a number: %s', p_advice->>'expected_introduced'));
  end if;
  v_introduced := coalesce(sync_text_as_numeric(nullif(p_advice->>'expected_introduced','')), 0);
  if v_residual is null then
    return jsonb_build_object('error',
      case when nullif(p_advice->>'expected_residual','') is null
        then 'state the expected residual risk this treatment would leave'
        else format('expected_residual is not a number: %s', p_advice->>'expected_residual') end);
  end if;
  -- Non-finite numerics refused by name, never rendered.
  if v_residual = 'NaN'::numeric or v_introduced = 'NaN'::numeric
     or v_residual < 0 or v_residual > 100 or v_introduced < 0 or v_introduced > 100 then
    return jsonb_build_object('error',
      'expected residual and introduced risk are finite numbers between 0 and 100');
  end if;
  if jsonb_typeof(v_evidence) <> 'array' then
    return jsonb_build_object('error', 'evidence_ids must be a json array');
  end if;
  select count(*) into v_bad_evidence
  from jsonb_array_elements_text(v_evidence) x
  where sync_text_as_uuid(x) is null
     or not exists (select 1 from evidence_items e
                    where e.id = sync_text_as_uuid(x) and e.organization_id = v_org);
  if v_bad_evidence > 0 then
    return jsonb_build_object('error',
      format('%s of the cited evidence ids are not evidence items of this organization — advice grounded in evidence that does not exist is worse than advice grounded in none', v_bad_evidence));
  end if;

  perform set_config('app.treatment_advice_write', 'granted', true);
  insert into risk_treatment_advice
    (organization_id, risk_id, agent_id, workflow_step, recommended_strategy,
     label, rationale, expected_residual, expected_introduced, limitations,
     evidence_ids, model, proposed_by)
  values
    (v_org, r.id, a.id, v_step, v_strategy,
     btrim(p_advice->>'label'), btrim(p_advice->>'rationale'),
     v_residual, v_introduced, btrim(p_advice->>'limitations'),
     v_evidence, nullif(btrim(coalesce(p_advice->>'model','')), ''), auth.uid())
  returning id into v_id;
  perform set_config('app.treatment_advice_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'risk_treatment_advice', coalesce(v_role, 'unknown'),
    jsonb_build_object('advice_id', v_id, 'risk_id', r.id, 'agent_id', a.id,
      'agent', a.name, 'workflow_step', v_step, 'strategy', v_strategy,
      'expected_residual', v_residual, 'may_accept', false, 'may_approve', false),
    jsonb_build_object('status', 'proposed'));

  return jsonb_build_object(
    'advice_id', v_id, 'risk_id', r.id, 'agent', a.name,
    'workflow_step', v_step, 'recommended_strategy', v_strategy,
    'status', 'proposed',
    'disclaimer', 'A recommendation, not a decision. Creating the treatment and accepting any residual risk are human acts the database refuses this identity (spec §62, §70).');
end
$$;

revoke all on function public.record_risk_treatment_advice(uuid, jsonb) from public, anon;
grant execute on function public.record_risk_treatment_advice(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ADOPT — a human act that delegates to the SHIPPED treatment writer.
--
-- RULING: adoption SELECTS. create_risk_treatment takes p_select, and with it
-- false it records an option (a scenario) and produces no treatment at all.
-- Marking advice "adopted" on the back of that would be a status with nothing
-- behind it, so this verb always selects — which is also what puts the
-- treatment through the shipped approval contract (named owner, verification
-- method, required approver role, approvals row). A human who only wants to
-- record the option without committing to it calls create_risk_treatment
-- directly, exactly as they do today from the risk cockpit; the advice then
-- honestly stays 'proposed'.
-- ---------------------------------------------------------------------------
create or replace function public.adopt_risk_treatment_advice(
  p_advice_id uuid,
  p_option jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  adv risk_treatment_advice%rowtype;
  v_result jsonb;
  v_option jsonb;
  v_treatment uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'adopting a treatment recommendation is a §70 human determination — the AI-operator identity proposed it and cannot also act on it');
  end if;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into adv from risk_treatment_advice
  where id = p_advice_id and organization_id = v_org;
  if not found or not can_read_risk(adv.risk_id) then
    return jsonb_build_object('error', 'treatment advice not found');
  end if;
  if adv.status <> 'proposed' then
    return jsonb_build_object('error', 'this recommendation is already ' || adv.status);
  end if;

  -- WHAT THE HUMAN MUST STATE, AND WHAT MAY BE CARRIED OVER.
  --
  -- The first version carried residual_risk and strategy over from the advice
  -- whenever p_option omitted them, and the only caller in the product omitted
  -- both — so the model's expected residual became the ORGANIZATION'S RECORDED
  -- residual, attributed to the manager who clicked, and create_risk_treatment
  -- wrote it to recommendations.expected_residual_risk(_score) and derived
  -- expected_risk_reduction from it: the figures a later accept_risk is judged
  -- against. That is the same silent inheritance the very next check refuses
  -- for introduced_risks, on the identical reasoning — the agent's expectation
  -- is not an assessment. Both are demanded explicitly now. The label and the
  -- strategy still default from the advice, because those are WHAT is being
  -- adopted rather than a judgement about how much risk is left; changing them
  -- silently would leave the advice row describing a treatment that never
  -- existed, so they default and are overridable.
  if not (p_option ? 'residual_risk')
     or nullif(btrim(coalesce(p_option->>'residual_risk','')), '') is null then
    return jsonb_build_object('error',
      format('state the residual risk you expect this treatment to leave. The agent expected %s; that is its expectation, not your assessment, and the number recorded here is what a later risk acceptance is judged against.',
             adv.expected_residual),
      'agentExpectedResidual', adv.expected_residual);
  end if;
  if sync_text_as_numeric(btrim(p_option->>'residual_risk')) is null then
    return jsonb_build_object('error',
      format('residual_risk is not a number: %s', p_option->>'residual_risk'));
  end if;
  v_option := coalesce(p_option, '{}'::jsonb)
    || jsonb_build_object(
      'strategy', coalesce(nullif(btrim(coalesce(p_option->>'strategy','')), ''), adv.recommended_strategy),
      'label', coalesce(nullif(btrim(coalesce(p_option->>'label','')), ''), adv.label),
      'residual_risk', btrim(p_option->>'residual_risk'),
      'introduced_risk', coalesce(nullif(p_option->>'introduced_risk',''), adv.expected_introduced::text));
  if not (v_option ? 'introduced_risks') then
    return jsonb_build_object('error',
      'introduced_risks must be assessed by the human adopting this recommendation, even when the answer is an empty array — the agent''s expectation is not an assessment');
  end if;

  -- THE ONE TREATMENT WRITER. Every refusal below this line is
  -- create_risk_treatment's, rendered as it wrote it — including the ones it
  -- returns alongside a scenario_id, which is why the error test comes first.
  v_result := create_risk_treatment(adv.risk_id, v_option, true);
  if v_result ? 'error' then
    return v_result;
  end if;
  v_treatment := nullif(v_result->>'recommendation_id','')::uuid;
  if v_treatment is null then
    return jsonb_build_object('error',
      'the treatment writer produced no treatment to adopt — nothing has been marked adopted',
      'result', v_result);
  end if;

  perform set_config('app.treatment_advice_write', 'granted', true);
  update risk_treatment_advice
  set status = 'adopted', adopted_treatment_id = v_treatment,
      adopted_by = auth.uid(), adopted_at = now()
  where id = adv.id;
  perform set_config('app.treatment_advice_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'risk_treatment_advice', coalesce(v_role, 'unknown'),
    jsonb_build_object('advice_id', adv.id, 'risk_id', adv.risk_id,
      'treatment_id', v_treatment, 'strategy', v_option->>'strategy'),
    jsonb_build_object('status', 'proposed'),
    jsonb_build_object('status', 'adopted', 'adopted_by', auth.uid()));

  return v_result || jsonb_build_object('advice_id', adv.id, 'advice_status', 'adopted');
end
$$;

revoke all on function public.adopt_risk_treatment_advice(uuid, jsonb) from public, anon;
grant execute on function public.adopt_risk_treatment_advice(uuid, jsonb) to authenticated;

comment on function public.adopt_risk_treatment_advice(uuid, jsonb) is
  'D12.12 / spec §62: the human act on a machine recommendation. Delegates to create_risk_treatment — the ONE treatment writer (ruling D5.25) — and refuses the AI-operator identity by name. Accepting any residual risk remains a separate act accept_risk refuses to this identity at every level.';

create or replace function public.dismiss_risk_treatment_advice(
  p_advice_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  adv risk_treatment_advice%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot dismiss its own recommendation — a human decides whether the advice was any good');
  end if;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into adv from risk_treatment_advice
  where id = p_advice_id and organization_id = v_org;
  if not found or not can_read_risk(adv.risk_id) then
    return jsonb_build_object('error', 'treatment advice not found');
  end if;
  if adv.status <> 'proposed' then
    return jsonb_build_object('error', 'this recommendation is already ' || adv.status);
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    return jsonb_build_object('error',
      'state why this recommendation is being dismissed (10 characters minimum) — the dismissals are how anyone finds out whether the agent is worth listening to');
  end if;

  perform set_config('app.treatment_advice_write', 'granted', true);
  update risk_treatment_advice
  set status = 'dismissed', dismissed_reason = btrim(p_reason),
      dismissed_by = auth.uid(), dismissed_at = now()
  where id = adv.id;
  perform set_config('app.treatment_advice_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'risk_treatment_advice', coalesce(v_role, 'unknown'),
    jsonb_build_object('advice_id', adv.id, 'risk_id', adv.risk_id, 'reason', btrim(p_reason)),
    jsonb_build_object('status', 'proposed'),
    jsonb_build_object('status', 'dismissed', 'dismissed_by', auth.uid()));

  return jsonb_build_object('advice_id', adv.id, 'status', 'dismissed');
end
$$;

revoke all on function public.dismiss_risk_treatment_advice(uuid, text) from public, anon;
grant execute on function public.dismiss_risk_treatment_advice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- THE READ. SECURITY INVOKER so the risk-sensitivity ladder on the read
-- policy applies exactly as it does to every other risk-scoped read.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_treatment_advice(p_case_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not exists (select 1 from development_cases
                 where id = p_case_id and organization_id = v_org) then
    return jsonb_build_object('error', 'development case not found');
  end if;
  return jsonb_build_object(
    'caseId', p_case_id,
    'advice', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', adv.id,
        'riskId', adv.risk_id,
        'riskTitle', r.title,
        'riskLevel', r.current_risk_level,
        'workflowStep', adv.workflow_step,
        'recommendedStrategy', adv.recommended_strategy,
        'label', adv.label,
        'rationale', adv.rationale,
        'limitations', adv.limitations,
        'expectedResidual', adv.expected_residual,
        'expectedIntroduced', adv.expected_introduced,
        'evidenceIds', adv.evidence_ids,
        'model', adv.model,
        'agent', (select ag.name from ai_agents ag where ag.id = adv.agent_id),
        -- WHO RAN IT. The agent name alone said "an agent produced this" and
        -- nothing in the payload or on the screen distinguished agent output
        -- from a row somebody wrote by hand through the RPC. The role gate on
        -- record_risk_treatment_advice narrows who can, and this names them.
        'proposedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = adv.proposed_by),
        'adoptedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = adv.adopted_by),
        'dismissedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = adv.dismissed_by),
        'status', adv.status,
        'adoptedTreatmentId', adv.adopted_treatment_id,
        'dismissedReason', adv.dismissed_reason,
        'createdAt', adv.created_at,
        'advisory', true)
        order by adv.created_at desc)
      from risk_treatment_advice adv
      join risks r on r.id = adv.risk_id
      where adv.organization_id = v_org and r.development_case_id = p_case_id), '[]'::jsonb));
end
$$;

revoke all on function public.get_case_treatment_advice(uuid) from public, anon;
grant execute on function public.get_case_treatment_advice(uuid) to authenticated;

notify pgrst, 'reload schema';
