-- ============================================================================
-- Sync Develop Slice 4A — the project controls baseline data model, all
-- ELEVEN structures (D5.04, spec I.8).
--
-- SPEC I.8 VERBATIM: "Need: WBS, CBS, OBS, schedule, cost baseline,
-- progress, commitments, actuals, forecast, changes, contingency."
--
-- THIS IS NOT A SECOND BASELINE CONCEPT. The register row is explicit and
-- so is the build plan: D5.26 already ships Baseline — six types, versioned,
-- approved by a human act, prior versions immutable at the persistence
-- boundary (20261110090000). This file EXTENDS that object. A controls
-- baseline is a development_baselines row PLUS, per structure, a record of
-- exactly what that structure contained at the moment of approval:
--
--     development_baselines (the anchor: type, version, approved_by/at)
--       └── controls_baseline_structures (per structure: count + digest)
--
-- No new approval act, no new version counter, no second immutability rule.
-- The version that is immutable is the baseline's; the capture rows inherit
-- that immutability and add their own append-only backstop, because a
-- capture that could be edited would let the "what did it contain" answer
-- change under a fixed approval.
--
-- WHY A DIGEST RATHER THAN A COPY. Copying every WBS element into a
-- baseline table would be a second scope store (forbidden), and it would
-- drift the moment either copy was corrected. A count plus an ordered md5
-- over the structure's identifying fields answers the question the baseline
-- is for — "has this changed since it was fixed?" — without duplicating the
-- rows. Drift is reported by re-deriving the digest at read time and
-- comparing; the report names WHICH structures drifted, never a single
-- aggregate "baseline out of date" flag.
--
-- THE ELEVEN, THEIR HOMES, AND THE TWO THAT REFUSE. Each structure names
-- the canonical home it is derived from. Two of the eleven have no home in
-- this repository yet, and they REFUSE BY NAME rather than reporting zero:
--
--   WBS            project_wbs_elements                    (D5.01, 4A)
--   CBS            project_cbs_codes                       (D5.01, 4A)
--   OBS            project_control_accounts x organizations (D5.01, 4A)
--   schedule       shutdown_tasks via the P6 door          (D5.28, S1+4A)
--   cost baseline  project_cost_items.baseline_cost        (D5.29, 4A)
--   progress       *** NO HOME YET — D5.19/D5.20, Slice 4B ***
--   commitments    project_cost_items.commitment           (D5.29, 4A;
--                  contract-side commitments arrive with D6.06 in Slice 6)
--   actuals        project_cost_items.actual               (D5.29, 4A)
--   forecast       project_cost_items.forecast             (D5.29, 4A)
--   changes        project_scope_changes                   (D5.03, 4A;
--                  baseline-anchored change CONTROL is D5.27, Slice 4B)
--   contingency    project_cost_items.contingency          (D5.29, 4A;
--                  the contingency LEDGER is D5.17, Slice 4B)
--
-- A structure with no home returns a refusal that names the slice that owns
-- it. A structure with a home but no rows returns "nothing to baseline" —
-- capturing an empty structure would record a fiction: it would later read
-- as "this project was baselined with no WBS", which is indistinguishable
-- from "the WBS was deleted after baselining".
--
-- §70. Capturing a controls baseline is part of SETTING a baseline, and the
-- spec's determinism boundary reserves that to authorized humans: the
-- ai_admin identity is refused BY NAME here exactly as it is at
-- approve_case_baseline. The capture is also refused unless the baseline is
-- APPROVED — capturing against a draft would let a structure be "baselined"
-- before anybody accepted it.
--
-- Canonical reuse: development_baselines (EXTENDED, not forked),
-- project_wbs_elements / project_cbs_codes / project_control_accounts /
-- project_cost_items / project_scope_changes / shutdown_tasks,
-- audit_events, security_events.
-- ============================================================================

create table if not exists public.controls_baseline_structures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  baseline_id uuid not null references development_baselines(id) on delete cascade,
  -- The eleven, verbatim from spec I.8 in the spec's own order.
  structure text not null check (structure in
    ('wbs','cbs','obs','schedule','cost_baseline','progress','commitments',
     'actuals','forecast','changes','contingency')),
  -- Where the captured rows live. Recorded, not inferred at read time, so a
  -- later re-homing is visible as a difference rather than silently applied
  -- to history.
  home text not null check (btrim(home) <> ''),
  element_count int not null check (element_count > 0),
  content_digest text not null check (btrim(content_digest) <> ''),
  -- The instant the structure's own rows last moved, as at capture time. A
  -- capture claims to record what a structure held WHEN THE BASELINE WAS
  -- APPROVED; without this the claim was unfalsifiable, because nothing tied
  -- captured_at to approved_at and a late capture recorded post-approval
  -- content as the approval-instant state (after which drift read zero for
  -- ever). capture_controls_baseline_structure refuses when this is after
  -- the approval, and the read shows both instants.
  structure_last_changed_at timestamptz,
  captured_by uuid not null references auth.users(id),
  captured_at timestamptz not null default now(),
  unique (baseline_id, structure)
);

create index if not exists idx_cbs_struct_case
  on controls_baseline_structures(organization_id, development_case_id, structure);

alter table public.controls_baseline_structures enable row level security;
drop policy if exists controls_baseline_structures_read on public.controls_baseline_structures;
create policy controls_baseline_structures_read on public.controls_baseline_structures
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: capture is a definer RPC.

comment on table public.controls_baseline_structures is
  'D5.04 (spec I.8): what each of the eleven controls structures contained when a development_baselines version was approved. EXTENDS the D5.26 Baseline object — it does not introduce a second baseline concept, a second version counter or a second approval act.';

-- ---------------------------------------------------------------------------
-- Append-only backstop. A capture is a statement about a moment that has
-- already passed, so there is nothing to update: an UPDATE or DELETE from a
-- client is refused, and the service path is admitted AND audited (the
-- development_baselines posture, 20261110090000:110 — a platform correction
-- is legitimate, a silent one is not).
--
-- TRUNCATE gets its own statement-level trigger and the verb is revoked:
-- this is a ledger of what was fixed and when, and a row-level trigger
-- never fires for TRUNCATE (the audit_events lesson, 20261121090000).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_controls_baseline_capture_immutable()
returns trigger
language plpgsql
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_org uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'controls_baseline_structures records what each controls structure contained when a baseline was approved; truncating it erases every such record in one statement. It is append-only for every caller.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'A controls-baseline capture was ' || lower(tg_op) || 'd by a service caller. '
           || 'The capture is the record of what a structure contained at approval; '
           || 'changing one changes what a past baseline is understood to have fixed (D5.04).');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'a controls-baseline capture is immutable — it records what a structure contained at the instant a baseline was approved, and that instant has passed. Approve a NEW baseline version and capture against it.'
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function public.enforce_controls_baseline_capture_immutable() from public, anon, authenticated;

drop trigger if exists trg_controls_baseline_capture_immutable on public.controls_baseline_structures;
create trigger trg_controls_baseline_capture_immutable
  before update or delete on public.controls_baseline_structures
  for each row execute function public.enforce_controls_baseline_capture_immutable();

drop trigger if exists trg_controls_baseline_capture_no_truncate on public.controls_baseline_structures;
create trigger trg_controls_baseline_capture_no_truncate
  before truncate on public.controls_baseline_structures
  for each statement execute function public.enforce_controls_baseline_capture_immutable();

revoke truncate on table public.controls_baseline_structures from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE ONE STRUCTURE-STATE PREDICATE. Every site that needs to know what a
-- structure currently contains — the capture act, the drift report, the
-- controls read, the surface — calls THIS. A structure whose count and
-- digest were computed two different ways in two places is how a baseline
-- silently stops matching what it was taken from.
-- ---------------------------------------------------------------------------
create or replace function public.controls_structure_state(
  p_case_id uuid,
  p_structure text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  v_home text;
  v_count int := 0;
  v_digest text;
  v_changed_at timestamptz;
  v_refusal text;
begin
  -- THE TENANT GATE. This was the one security definer in the slice with no
  -- organization check at all: granted to `authenticated` and taking an
  -- arbitrary case uuid, it handed any signed-in user of any tenant another
  -- tenant's element counts and a stable md5 over the identifying fields —
  -- a confirmation oracle for guessed WBS/CBS code sets and control-account
  -- owners, and an existence oracle for case ids. Its three siblings in this
  -- file all carry the dual-caller gate; it now does too, and the EXECUTE
  -- grant is withdrawn entirely below because its only callers are the two
  -- definers in this file, which run as the owner.
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  if p_structure = 'wbs' then
    v_home := 'project_wbs_elements';
    select count(*), md5(coalesce(string_agg(
             w.wbs_code || '~' || w.title || '~' || coalesce(p.wbs_code, '-'), '|'
             order by w.wbs_code), ''))
      into v_count, v_digest
    from project_wbs_elements w
    left join project_wbs_elements p on p.id = w.parent_id
    where w.development_case_id = c.id;
    select max(w.created_at) into v_changed_at
    from project_wbs_elements w where w.development_case_id = c.id;

  elsif p_structure = 'cbs' then
    v_home := 'project_cbs_codes';
    select count(*), md5(coalesce(string_agg(
             b.cbs_code || '~' || b.cost_type, '|' order by b.cbs_code), ''))
      into v_count, v_digest
    from project_cbs_codes b where b.development_case_id = c.id;
    select max(b.created_at) into v_changed_at
    from project_cbs_codes b where b.development_case_id = c.id;

  elsif p_structure = 'obs' then
    -- The OBS leg (20261130090000, ruling 3): who is accountable for which
    -- control account. No second org tree exists to digest.
    v_home := 'project_control_accounts x organizations';
    select count(*), md5(coalesce(string_agg(
             ca.control_account_ref || '~' || ca.accountable_owner_id::text
               || '~' || coalesce(ca.org_node_id::text, '-'), '|'
             order by ca.control_account_ref), ''))
      into v_count, v_digest
    from project_control_accounts ca where ca.development_case_id = c.id;
    select max(ca.created_at) into v_changed_at
    from project_control_accounts ca where ca.development_case_id = c.id;

  elsif p_structure = 'schedule' then
    v_home := 'shutdown_tasks (P6 import door)';
    select count(*), md5(coalesce(string_agg(
             t.task_key || '~' || t.duration_hours::text || '~'
               || coalesce(t.planned_start::text, '-') || '~'
               || coalesce(t.planned_finish::text, '-') || '~' || t.origin, '|'
             order by e.event_key, t.task_key), ''))
      into v_count, v_digest
    from shutdown_tasks t
    join shutdown_events e on e.id = t.event_id
    where e.organization_id = c.organization_id and e.development_case_id = c.id;
    select max(t.created_at) into v_changed_at
    from shutdown_tasks t
    join shutdown_events e on e.id = t.event_id
    where e.organization_id = c.organization_id and e.development_case_id = c.id;

  elsif p_structure in ('cost_baseline','commitments','actuals','forecast','contingency') then
    v_home := 'project_cost_items.' ||
      (case p_structure when 'cost_baseline' then 'baseline_cost' else p_structure end);
    select count(*), md5(coalesce(string_agg(
             ci.cost_item_ref || '~' || (case p_structure
               when 'cost_baseline' then ci.baseline_cost
               when 'commitments' then ci.commitment
               when 'actuals' then ci.actual
               when 'forecast' then ci.forecast
               else ci.contingency end)::text, '|' order by ci.cost_item_ref), ''))
      into v_count, v_digest
    from project_cost_items ci
    where ci.development_case_id = c.id
      and (case p_structure
             when 'cost_baseline' then ci.baseline_cost
             when 'commitments' then ci.commitment
             when 'actuals' then ci.actual
             when 'forecast' then ci.forecast
             else ci.contingency end) is not null;
    select max(ci.updated_at) into v_changed_at
    from project_cost_items ci where ci.development_case_id = c.id;

  elsif p_structure = 'changes' then
    v_home := 'project_scope_changes';
    select count(*), md5(coalesce(string_agg(
             sc.change_ref || '~' || sc.origin || '~' || coalesce(sc.cost_effect::text, '-'),
             '|' order by sc.change_ref), ''))
      into v_count, v_digest
    from project_scope_changes sc where sc.development_case_id = c.id;
    select max(sc.created_at) into v_changed_at
    from project_scope_changes sc where sc.development_case_id = c.id;

  elsif p_structure = 'progress' then
    -- The honest hole. Reported as a refusal naming its owner, never as 0.
    v_home := 'none yet';
    v_refusal :=
      'Progress has no home in this repository yet: rules of credit, physical percent complete and the IFC-accepted-versus-reported check are D5.19/D5.20 (progress integrity, spec II.9), which land in Slice 4B. Reporting a progress baseline of zero would read as "this project was baselined at 0% complete", which is a measurement nobody took.';

  else
    return jsonb_build_object('error',
      format('"%s" is not one of the eleven controls structures (spec I.8): wbs, cbs, obs, schedule, cost_baseline, progress, commitments, actuals, forecast, changes, contingency', p_structure));
  end if;

  if v_refusal is null and v_count = 0 then
    v_refusal := format(
      'Nothing is recorded in %s for this case, so there is nothing to baseline. Capturing an empty structure would later read as "baselined with none", which cannot be told apart from "everything was deleted after baselining".',
      v_home);
  end if;

  return jsonb_build_object(
    'structure', p_structure,
    'home', v_home,
    'elementCount', case when v_refusal is null then v_count else null end,
    'digest', case when v_refusal is null then v_digest else null end,
    'latestChangeAt', case when v_refusal is null then v_changed_at else null end,
    'refusal', v_refusal);
end
$$;

-- No EXECUTE for anyone. Its only callers are the two SECURITY DEFINER
-- functions below, which run as the owner and therefore need no grant; a
-- grant to `authenticated` bought nothing and opened a direct PostgREST
-- route to every tenant's structure digests.
revoke all on function public.controls_structure_state(uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The capture act. §70: humans only, ai_admin refused BY NAME.
-- ---------------------------------------------------------------------------
create or replace function public.capture_controls_baseline_structure(
  p_baseline_id uuid,
  p_structure text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  b development_baselines%rowtype;
  v_state jsonb;
  v_changed timestamptz;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'capturing a controls baseline is part of SETTING a baseline — a human accountability act the AI-operator identity cannot perform (spec §70)');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'capturing a controls baseline requires a governance or engineering role');
  end if;
  select * into b from development_baselines where id = p_baseline_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'baseline not found');
  end if;
  if b.status <> 'approved' then
    return jsonb_build_object('error',
      format('that baseline is %s. A controls structure is captured against an APPROVED baseline — capturing against a draft would record a structure as baselined before anybody accepted it.', b.status));
  end if;

  v_state := controls_structure_state(b.development_case_id, p_structure);
  if v_state ? 'error' then
    return v_state;
  end if;
  if v_state->>'refusal' is not null then
    return jsonb_build_object('error', v_state->>'refusal');
  end if;

  -- THE CAPTURE IS A CLAIM ABOUT THE APPROVAL INSTANT, NOT ABOUT NOW.
  -- controls_structure_state reads LIVE rows, so capturing late recorded the
  -- post-approval state under the approval's timestamp — after which drift
  -- read zero for ever, and anyone could make driftedCount say 0 by choosing
  -- when to press the button. That is the whole question D5.04 exists to
  -- answer, so a structure that has moved since the approval is refused with
  -- both instants named: approve a NEW version, whose approval instant the
  -- current content actually belongs to.
  v_changed := (v_state->>'latestChangeAt')::timestamptz;
  if v_changed is not null and b.approved_at is not null and v_changed > b.approved_at then
    return jsonb_build_object('error',
      format('the %s structure last changed at %s, AFTER %s v%s was approved at %s. Capturing now would record content that did not exist at the approval as what the approval fixed — and drift against it would then read zero for ever. Approve a new baseline version and capture against that.',
             p_structure, v_changed, b.baseline_type, b.version, b.approved_at));
  end if;
  if exists (select 1 from controls_baseline_structures
             where baseline_id = b.id and structure = p_structure) then
    return jsonb_build_object('error',
      format('the %s structure is already captured against this baseline version, and a capture is immutable. Approve a new baseline version to re-capture.', p_structure));
  end if;

  insert into controls_baseline_structures
    (organization_id, development_case_id, baseline_id, structure, home,
     element_count, content_digest, structure_last_changed_at, captured_by)
  values
    (v_org, b.development_case_id, b.id, p_structure, v_state->>'home',
     (v_state->>'elementCount')::int, v_state->>'digest', v_changed, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'controls_baseline_structure', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', b.development_case_id, 'baseline_id', b.id,
      'capture_id', v_id, 'structure', p_structure, 'action', 'captured',
      'baseline_type', b.baseline_type, 'baseline_version', b.version),
    null,
    jsonb_build_object('structure', p_structure, 'home', v_state->>'home',
      'elementCount', v_state->>'elementCount', 'digest', v_state->>'digest'));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Controls structure %s captured against baseline %s v%s on case %s (%s elements) as role %s.',
            p_structure, b.baseline_type, b.version, b.development_case_id,
            v_state->>'elementCount', coalesce(v_role, 'none')));

  return jsonb_build_object('capture_id', v_id, 'structure', p_structure,
    'baseline_type', b.baseline_type, 'baseline_version', b.version,
    'element_count', (v_state->>'elementCount')::int, 'digest', v_state->>'digest');
end
$$;

-- service_role is revoked EXPLICITLY: Supabase's `alter default privileges …
-- grant all on functions to service_role` already granted it, and revoking
-- from public/anon does not remove an explicit role grant — so the stated
-- ACL ("humans, through the app") and the real one differed. §70 held only
-- incidentally, because app_current_org() happens to be null for a service
-- caller.
revoke all on function public.capture_controls_baseline_structure(uuid, text) from public, anon, service_role;
grant execute on function public.capture_controls_baseline_structure(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The read: all eleven, always, in the spec's order — captured with drift,
-- or refused with the reason. A structure that is simply absent from this
-- list would be a structure nobody remembers to build.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_controls_baseline(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  v_structures jsonb := '[]'::jsonb;
  v_name text;
  v_state jsonb;
  cap controls_baseline_structures%rowtype;
  v_captured int := 0;
  v_drifted int := 0;
  v_names text[] := array['wbs','cbs','obs','schedule','cost_baseline','progress',
                          'commitments','actuals','forecast','changes','contingency'];
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  foreach v_name in array v_names loop
    v_state := controls_structure_state(c.id, v_name);
    -- The most recent capture of this structure on this case, whichever
    -- baseline type carried it.
    select * into cap from controls_baseline_structures
     where development_case_id = c.id and structure = v_name
     order by captured_at desc limit 1;

    if cap.id is not null then
      v_captured := v_captured + 1;
      if v_state->>'digest' is distinct from cap.content_digest then
        v_drifted := v_drifted + 1;
      end if;
    end if;

    v_structures := v_structures || jsonb_build_array(jsonb_build_object(
      'structure', v_name,
      'home', v_state->>'home',
      'currentCount', (v_state->>'elementCount')::int,
      'refusal', v_state->>'refusal',
      'baselined', cap.id is not null,
      'baseline', case when cap.id is null then null else (
        select jsonb_build_object(
          'baselineId', b.id, 'baselineType', b.baseline_type, 'version', b.version,
          'approvedAt', b.approved_at,
          'capturedAt', cap.captured_at,
          'capturedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = cap.captured_by),
          -- Both instants, so a reader can see that the capture describes the
          -- approval and not the moment somebody pressed the button.
          'structureLastChangedAt', cap.structure_last_changed_at,
          'elementCount', cap.element_count)
        from development_baselines b where b.id = cap.baseline_id) end,
      -- Drift is only meaningful once something was captured; before that
      -- it is null, not false.
      'drifted', case when cap.id is null then null
                      else (v_state->>'digest') is distinct from cap.content_digest end,
      'driftDetail', case
        when cap.id is null then null
        when (v_state->>'digest') is not distinct from cap.content_digest then null
        else format('%s now holds %s element(s); %s were captured at baseline %s. Something in this structure has changed since it was fixed — change control (D5.27) is where that is reconciled.',
                    v_state->>'home', coalesce(v_state->>'elementCount', '0'),
                    cap.element_count, cap.captured_at) end));
  end loop;

  return jsonb_build_object(
    'caseId', c.id,
    'structures', v_structures,
    'structureCount', array_length(v_names, 1),
    'capturedCount', v_captured,
    'driftedCount', v_drifted,
    -- NULL over an uncaptured case: 0% "baselined" reads as a judgement
    -- about the project; "no controls baseline has been captured" is a
    -- statement about the record.
    'baselineComplete', case when v_captured = 0 then null
                             else v_captured = array_length(v_names, 1) end);
end
$$;

revoke all on function public.get_case_controls_baseline(uuid) from public, anon;
grant execute on function public.get_case_controls_baseline(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
