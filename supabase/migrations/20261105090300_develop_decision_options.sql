-- ============================================================================
-- Sync Develop Slice 1 — Decision + DecisionOption (D3.27 / D3.28, overlap-map
-- ruling 4).
--
-- Ruling 4 is binding: `decisions` (00000000000001:252, already extended at
-- 20260921110101:481 and 20260921110102:353) IS the canonical decision store.
-- This file adds the spec §16 columns TO it; `ria_decisions` stays
-- assessment-scoped, `lifecycle_evaluations` stays the economic-evaluation
-- record, stage_gate_reviews stay gate decisions. A fourth decision store is
-- the named anti-pattern and none is created.
--
-- OPTIONS ARE THE EXISTING `scenarios` OBJECT, GENERALIZED (D3.28 ruling: no
-- new DecisionOption table). scenarios was born as a per-recommendation
-- option set with effect fields and a recommended flag; the ROS already
-- generalized it once (risk_id, treatment fields). This file adds the third
-- parent (decision_id) and the spec §17 comparison vector: capex, opex,
-- lifecycle_cost, schedule/risk/reliability/environmental effects,
-- expected_value. Absent figures stay NULL and render as "not stated" —
-- register standing constraint 3, no fabricated numbers.
--
-- SELECTING AN OPTION IS A GOVERNED DEFINER-RPC ACT — the reconstructible
-- "why did we select Vendor B" record (spec §16): who selected, when, and a
-- mandatory rationale, with evidence links (Decision USES Evidence, §34) into
-- canonical evidence_items and assumption links (Decision DEPENDS_ON
-- Assumption) through the EXISTING risk_assumption_dependencies family
-- (subject_type='decision' has existed there since 20260921110102:146 —
-- reused, not re-modelled). Two provenance triggers in the post-fix #282
-- idiom guard the record:
--
--   * enforce_decision_selection_provenance — the selection columns on
--     `decisions` move only under the transaction-local marker set by
--     select_decision_option; INSERTs arriving already-selected, UPDATEs, and
--     DELETEs of a decided decision are refused for clients and admitted-
--     AND-audited for the service path; BEFORE DELETE returns OLD.
--   * enforce_decision_option_provenance — once a decision is DECIDED its
--     option set (chosen and rejected alike) is the record of what the
--     selection was made against: client edits, additions and deletions are
--     refused; service writes admitted and audited. Undecided decisions'
--     options remain freely draftable. Legacy recommendation-/risk-scoped
--     scenarios (decision_id null) are untouched by construction.
--
-- No silent overwrite anywhere: a made decision is not re-selectable; changed
-- circumstances are a NEW decision (the same rule sanction and gate outcomes
-- follow). ai_admin is refused by name in the selection RPC — the LLM frames
-- options and gathers evidence; a human selects.
--
-- RLS: restrictive case-scoped write policies copy the ROS sensitivity idiom
-- (20260921110102:1515) — case-bound decision rows and decision-bound option
-- rows arrive through definer RPCs only, while every legacy write path
-- (operating-loop approvals, treatment scenarios) continues unchanged because
-- its rows carry NULL in the new parent columns.
-- ============================================================================

alter table public.decisions
  add column if not exists development_case_id uuid
    references development_cases(id) on delete cascade,
  add column if not exists decision_question text,
  add column if not exists objective_id uuid
    references risk_objectives(id) on delete set null,
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists decision_required_date date,
  add column if not exists selected_option_id uuid
    references scenarios(id) on delete set null,
  add column if not exists selected_by uuid references auth.users(id),
  add column if not exists selected_at timestamptz,
  add column if not exists selection_rationale text,
  add column if not exists approval_level text,
  add column if not exists evidence_item_ids jsonb not null default '[]'::jsonb;

-- A selection that names nobody, no moment, or no reason is not a selection.
alter table public.decisions
  drop constraint if exists decisions_selection_recorded;
alter table public.decisions
  add constraint decisions_selection_recorded check (
    selected_option_id is null
    or (selected_by is not null
        and selected_at is not null
        and btrim(coalesce(selection_rationale, '')) <> '')
  );
alter table public.decisions
  drop constraint if exists decisions_evidence_ids_array;
alter table public.decisions
  add constraint decisions_evidence_ids_array check (jsonb_typeof(evidence_item_ids) = 'array');

create index if not exists idx_decisions_case
  on decisions(organization_id, development_case_id)
  where development_case_id is not null;

alter table public.scenarios
  add column if not exists decision_id uuid
    references decisions(id) on delete cascade,
  add column if not exists description text,
  add column if not exists capex numeric,
  add column if not exists opex numeric,
  add column if not exists lifecycle_cost numeric,
  add column if not exists schedule_effect text,
  add column if not exists risk_effect text,
  add column if not exists reliability_effect text,
  add column if not exists environmental_effect text,
  add column if not exists expected_value numeric;

create index if not exists idx_scenarios_decision
  on scenarios(organization_id, decision_id)
  where decision_id is not null;

-- Case-bound decisions and decision-bound options are definer-RPC-only for
-- clients (the ROS restrictive idiom). Reads stay org-wide.
drop policy if exists decisions_case_scoped on public.decisions;
create policy decisions_case_scoped on public.decisions as restrictive
  for all to authenticated using (true)
  with check (development_case_id is null);
drop policy if exists scenarios_decision_scoped on public.scenarios;
create policy scenarios_decision_scoped on public.scenarios as restrictive
  for all to authenticated using (true)
  with check (decision_id is null);

-- ---------------------------------------------------------------------------
-- Selection provenance on decisions. SECURITY INVOKER on purpose
-- (20261005090100's argument, kept).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_decision_selection_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.decision_select_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_changed boolean;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
begin
  if tg_op = 'INSERT' then
    v_changed := new.selected_option_id is not null
              or new.selected_by is not null
              or new.selected_at is not null
              or nullif(btrim(coalesce(new.selection_rationale, '')), '') is not null;
  elsif tg_op = 'DELETE' then
    -- Deleting a decided decision erases the record of the selection.
    v_changed := old.selected_option_id is not null or old.selected_at is not null;
  else
    v_changed := new.selected_option_id is distinct from old.selected_option_id
              or new.selected_by is distinct from old.selected_by
              or new.selected_at is distinct from old.selected_at
              or new.selection_rationale is distinct from old.selection_rationale;
  end if;

  if not v_changed then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Audited service path — admitted and audited for EVERY operation
  -- (20261005090300 §1). Org-exists guard for organization teardown.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         case tg_op
           when 'INSERT' then
             'Decision ' || new.id::text
               || ' inserted already carrying a selection record by a service caller, '
               || 'bypassing select_decision_option().'
           when 'DELETE' then
             'Decided decision ' || old.id::text
               || ' deleted by a service caller — the selection record it carried is erased.'
           else
             'Selection record on decision ' || new.id::text
               || ' written by a service caller, bypassing select_decision_option().'
         end);
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Selecting a decision option is a recorded human act (spec §16 — the '
      'reconstructible record of why). It cannot be written directly: call '
      'select_decision_option(decision_id, option_id, rationale, ...), which records '
      'who selected, when, and on what basis, with evidence and assumption links.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_decision_selection_provenance on public.decisions;
create trigger trg_decision_selection_provenance
  before insert or update or delete on public.decisions
  for each row execute function public.enforce_decision_selection_provenance();

revoke all on function public.enforce_decision_selection_provenance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Option-set provenance on scenarios: a DECIDED decision's options — chosen
-- and rejected alike — are the comparison record. Fires only for
-- decision-scoped rows (legacy recommendation/risk scenarios pass through).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_decision_option_provenance()
returns trigger
language plpgsql
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_decision uuid := case when tg_op = 'DELETE' then old.decision_id else new.decision_id end;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_guarded boolean := false;
begin
  -- Guarded when the row belongs to a DECIDED decision — on UPDATE, when
  -- EITHER side does (re-parenting an option out of a decided decision is as
  -- much a mutation of the record as an edit in place), or when the row IS
  -- some decision's selected option.
  if v_decision is not null then
    select exists (select 1 from decisions d
                   where d.id = v_decision and d.selected_option_id is not null)
      into v_guarded;
  end if;
  if not v_guarded and tg_op = 'UPDATE'
     and new.decision_id is distinct from old.decision_id
     and old.decision_id is not null then
    select exists (select 1 from decisions d
                   where d.id = old.decision_id and d.selected_option_id is not null)
      into v_guarded;
  end if;
  if not v_guarded then
    v_guarded := exists (select 1 from decisions d
                         where d.selected_option_id =
                           (case when tg_op = 'DELETE' then old.id else new.id end));
  end if;

  if not v_guarded then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Audited service path (restore, correction) — admitted and audited.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Option row ' || (case when tg_op = 'DELETE' then old.id::text else new.id::text end)
           || ' of a decided decision written by a service caller (' || lower(tg_op)
           || ') — the option set of a made decision is the record of what the '
           || 'selection was judged against.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'This option belongs to a decision that has been made. The option set — chosen '
    'and rejected alike — is the record of what the selection was judged against '
    '(spec §16/§17); it cannot be edited, extended or deleted after the fact. '
    'Changed circumstances are a new decision.'
    using errcode = 'insufficient_privilege';
end
$$;

drop trigger if exists trg_decision_option_provenance on public.scenarios;
create trigger trg_decision_option_provenance
  before insert or update or delete on public.scenarios
  for each row execute function public.enforce_decision_option_provenance();

revoke all on function public.enforce_decision_option_provenance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Frame a decision on a case. Preparation, not determination — same role set
-- as create_development_case (ai_admin admitted here, refused at selection).
-- ---------------------------------------------------------------------------
create or replace function public.create_case_decision(
  p_case_id uuid,
  p_question text,
  p_required_date date default null,
  p_objective_id uuid default null,
  p_owner_id uuid default null,
  p_approval_level text default null
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
    return jsonb_build_object('error', 'framing a case decision requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'decisions are not framable on a ' || c.status || ' case');
  end if;
  if coalesce(length(btrim(p_question)), 0) < 10 then
    return jsonb_build_object('error',
      'a decision begins with its question — what is being decided? (10 characters minimum)');
  end if;
  if p_objective_id is not null and not exists
     (select 1 from risk_objectives where id = p_objective_id and organization_id = v_org) then
    return jsonb_build_object('error', 'objective not found in this organization');
  end if;
  if p_owner_id is not null and not exists
     (select 1 from user_profiles where id = p_owner_id and organization_id = v_org) then
    return jsonb_build_object('error', 'the decision owner must be a member of this organization');
  end if;

  insert into decisions
    (organization_id, development_case_id, decision_type, decision_question,
     objective_id, owner_id, decision_required_date, approval_level,
     approval_status, autonomy_mode, outcome_status, human_actor)
  values
    (v_org, c.id, 'development_case', btrim(p_question),
     p_objective_id, coalesce(p_owner_id, auth.uid()), p_required_date,
     nullif(btrim(coalesce(p_approval_level, '')), ''),
     'pending', 'advisory', 'open',
     (select coalesce(p.full_name, p.email) from user_profiles p where p.id = auth.uid()))
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_decision', coalesce(v_role, 'unknown'),
    jsonb_build_object('decision_id', v_id, 'case_id', c.id, 'action', 'framed',
      'question', btrim(p_question), 'required_date', p_required_date));

  return jsonb_build_object('decision_id', v_id, 'case_id', c.id);
end
$$;

revoke all on function public.create_case_decision(uuid, text, date, uuid, uuid, text) from public, anon;
grant execute on function public.create_case_decision(uuid, text, date, uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Add an option to an UNDECIDED decision — the §17 comparison vector on the
-- generalized scenarios object. Numbers stay NULL where not stated.
-- ---------------------------------------------------------------------------
create or replace function public.add_decision_option(
  p_decision_id uuid,
  p_label text,
  p_description text default null,
  p_capex numeric default null,
  p_opex numeric default null,
  p_lifecycle_cost numeric default null,
  p_schedule_effect text default null,
  p_risk_effect text default null,
  p_reliability_effect text default null,
  p_environmental_effect text default null,
  p_expected_value numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d decisions%rowtype;
  v_id uuid;
  v_seq int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'adding a decision option requires a planning, engineering or governance role');
  end if;
  select * into d from decisions where id = p_decision_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'decision not found');
  end if;
  if d.development_case_id is null then
    return jsonb_build_object('error',
      'options through this path hang off case decisions — this decision is not bound to a development case');
  end if;
  if d.selected_option_id is not null then
    return jsonb_build_object('error',
      'this decision has been made — its option set is the record of what the selection was judged against and cannot be extended; frame a new decision');
  end if;
  if coalesce(length(btrim(p_label)), 0) < 2 then
    return jsonb_build_object('error', 'an option needs a label (2 characters minimum)');
  end if;
  if p_capex is not null and p_capex < 0 then
    return jsonb_build_object('error', 'capex cannot be negative');
  end if;
  if p_opex is not null and p_opex < 0 then
    return jsonb_build_object('error', 'opex cannot be negative');
  end if;

  select coalesce(count(*), 0) + 1 into v_seq
  from scenarios where decision_id = d.id;

  insert into scenarios
    (organization_id, decision_id, key, label, description,
     capex, opex, lifecycle_cost, schedule_effect, risk_effect,
     reliability_effect, environmental_effect, expected_value, sequence_no)
  values
    (v_org, d.id, 'option_' || v_seq, btrim(p_label),
     nullif(btrim(coalesce(p_description, '')), ''),
     p_capex, p_opex, p_lifecycle_cost,
     nullif(btrim(coalesce(p_schedule_effect, '')), ''),
     nullif(btrim(coalesce(p_risk_effect, '')), ''),
     nullif(btrim(coalesce(p_reliability_effect, '')), ''),
     nullif(btrim(coalesce(p_environmental_effect, '')), ''),
     p_expected_value, v_seq)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_decision_option', coalesce(v_role, 'unknown'),
    jsonb_build_object('decision_id', d.id, 'option_id', v_id,
      'label', btrim(p_label), 'case_id', d.development_case_id));

  return jsonb_build_object('option_id', v_id, 'decision_id', d.id, 'key', 'option_' || v_seq);
end
$$;

revoke all on function public.add_decision_option(uuid, text, text, numeric, numeric, numeric, text, text, text, text, numeric) from public, anon;
grant execute on function public.add_decision_option(uuid, text, text, numeric, numeric, numeric, text, text, text, text, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE GOVERNED ACT: select an option. Who, when, rationale — mandatory.
-- Links evidence (canonical evidence_items) and assumptions (the existing
-- risk_assumption_dependencies family). ai_admin refused by name. A made
-- decision is never re-selected.
-- ---------------------------------------------------------------------------
create or replace function public.select_decision_option(
  p_decision_id uuid,
  p_option_id uuid,
  p_rationale text,
  p_evidence_item_ids jsonb default '[]'::jsonb,
  p_assumption_ids jsonb default '[]'::jsonb,
  p_approval_level text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d decisions%rowtype;
  o scenarios%rowtype;
  v_evidence_count int := 0;
  v_assumption_count int := 0;
  x jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'selecting a decision option is a human act — the AI-operator identity frames and prepares, it does not select');
    end if;
    return jsonb_build_object('error', 'selecting a decision option requires a governance or engineering role');
  end if;
  select * into d from decisions where id = p_decision_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'decision not found');
  end if;
  if d.selected_option_id is not null then
    return jsonb_build_object('error',
      'this decision has already been made — a selection is not overwritable; changed circumstances are a new decision');
  end if;
  select * into o from scenarios
  where id = p_option_id and organization_id = v_org and decision_id = d.id;
  if not found then
    return jsonb_build_object('error', 'that option does not belong to this decision');
  end if;
  if coalesce(length(btrim(p_rationale)), 0) < 20 then
    return jsonb_build_object('error',
      'record the basis for this selection — the years-later "why" (20 characters minimum)');
  end if;
  if p_evidence_item_ids is null or jsonb_typeof(p_evidence_item_ids) <> 'array' then
    return jsonb_build_object('error', 'evidence_item_ids must be a json array');
  end if;
  if p_assumption_ids is null or jsonb_typeof(p_assumption_ids) <> 'array' then
    return jsonb_build_object('error', 'assumption_ids must be a json array');
  end if;
  -- Every linked evidence row must exist in THIS organization.
  for x in select * from jsonb_array_elements(p_evidence_item_ids) loop
    if not exists (select 1 from evidence_items e
                   where e.id = (x #>> '{}')::uuid and e.organization_id = v_org) then
      return jsonb_build_object('error',
        'evidence link ' || (x #>> '{}') || ' does not resolve to evidence in this organization');
    end if;
    v_evidence_count := v_evidence_count + 1;
  end loop;
  -- Every linked assumption must exist in THIS organization.
  for x in select * from jsonb_array_elements(p_assumption_ids) loop
    if not exists (select 1 from risk_assumptions a
                   where a.id = (x #>> '{}')::uuid and a.organization_id = v_org) then
      return jsonb_build_object('error',
        'assumption link ' || (x #>> '{}') || ' does not resolve to an assumption in this organization');
    end if;
    v_assumption_count := v_assumption_count + 1;
  end loop;

  -- The sanctioned write. Local marker: cannot outlive this transaction.
  perform set_config('app.decision_select_write', 'granted', true);

  update decisions
  set selected_option_id = o.id,
      selected_by = auth.uid(),
      selected_at = now(),
      selection_rationale = btrim(p_rationale),
      approval_level = coalesce(nullif(btrim(coalesce(p_approval_level, '')), ''), approval_level),
      evidence_item_ids = p_evidence_item_ids,
      action_taken = coalesce(action_taken, 'Selected: ' || o.label)
  where id = d.id;

  perform set_config('app.decision_select_write', '', true);

  -- Decision DEPENDS_ON Assumption — through the ONE assumption-dependency
  -- family (20260921110102:146), never a new link table.
  insert into risk_assumption_dependencies (organization_id, assumption_id, subject_type, subject_id)
  select v_org, (x2 #>> '{}')::uuid, 'decision', d.id
  from jsonb_array_elements(p_assumption_ids) x2
  on conflict (assumption_id, subject_type, subject_id) do nothing;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_decision_selection', coalesce(v_role, 'unknown'),
    jsonb_build_object('decision_id', d.id, 'option_id', o.id,
      'option_label', o.label, 'case_id', d.development_case_id,
      'rationale', btrim(p_rationale),
      'evidence_links', v_evidence_count, 'assumption_links', v_assumption_count));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Decision option "%s" selected on decision %s by role %s (%s evidence, %s assumption link(s)).',
            o.label, d.id, coalesce(v_role, 'none'), v_evidence_count, v_assumption_count));

  return jsonb_build_object('decision_id', d.id, 'selected_option_id', o.id,
    'selected_by', auth.uid(), 'evidence_links', v_evidence_count,
    'assumption_links', v_assumption_count);
end
$$;

revoke all on function public.select_decision_option(uuid, uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.select_decision_option(uuid, uuid, text, jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
