-- ============================================================================
-- Sync Develop Slice 4B — PROGRESS INTEGRITY CROSS-CHECK WITH A CONFIDENCE
-- RATING (D5.20, spec II.9).
--
-- THE SPEC'S OWN EXAMPLE, verbatim (II.9):
--
--   "Cross-check claimed progress against drawings issued, deliverables
--    approved, quantities complete, procurement releases, field installation,
--    inspection records. 'Contractor reports engineering 92% complete; only
--    71% of IFC deliverables accepted → progress confidence LOW.'"
--
-- 20261201090000 made a claimed percent impossible to invent: it is derived
-- from a recorded rule of credit. That closes one hole and leaves the bigger
-- one open — a rule of credit can be applied honestly to a step that was
-- never actually reached. The claim is internally consistent and externally
-- unverified, and every earned-value figure downstream inherits that.
--
-- So this file records INDEPENDENT OBSERVATIONS — counted things, from a
-- different source than the claim — and reports the divergence.
--
-- ── THE FOUR RULES ─────────────────────────────────────────────────────────
--
--   1. ABSENCE OF EVIDENCE IS NOT CONFIRMATION. An element with no
--      independent observation is UNRATED, never HIGH. The single easiest
--      way to build a dishonest assurance screen is to let "nothing
--      contradicts it" render as "verified".
--
--   2. THE BINDING MEASURE IS THE LOWEST INDEPENDENT ONE. Where several
--      sources observe the same element they rarely agree; taking the
--      average lets one generous source cover a damning one. The lowest is
--      taken, and the source that produced it is NAMED in the discrepancy
--      sentence, so a reader can go and argue with that source specifically.
--
--   3. COVERAGE IS REPORTED WITH THE RATING, ALWAYS. A HIGH confidence over
--      two of nineteen claimed elements is a true statement about two
--      elements and a false impression of the project. Every rating carries
--      the fraction of claimed elements it was computed over, and the case
--      rating is REFUSED outright when coverage is zero.
--
--   4. THE RATING IS DERIVED, NOT DECLARED. There is no column, parameter or
--      RPC through which anybody can state a progress confidence. It is a
--      function of the observed divergence, and the band thresholds are
--      returned with it (spec §46: "configurable weights — do not pretend
--      universal science").
--
-- ── AMBIGUITY RESOLVED: WHAT COUNTS AS INDEPENDENT ─────────────────────────
-- The spec lists six cross-check sources. RULING: each is recorded as a
-- COUNTED PAIR — observed complete out of observed total — because that is
-- the only form in which "71% of IFC deliverables accepted" can be checked
-- rather than asserted. A source that could be recorded as a bare percentage
-- would be a second place to type a progress number, which is the hole this
-- row exists to close. The denominator must be greater than zero: an
-- observation out of nothing is a division by zero wearing a percentage sign.
--
-- §70: recording an independent observation of physical progress is a
-- progress judgement and is refused to the AI-operator identity BY NAME —
-- the same wall record_progress_claim carries, for the same reason. An AI
-- identity that could write the evidence could verify the claim it cannot
-- make.
--
-- Canonical reuse: project_progress_claims / periods (D5.06),
-- project_wbs_elements (D5.01), record_calculation_run (D11.29),
-- audit_events, security_events.
-- ============================================================================

create table if not exists public.project_progress_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  period_id uuid not null references project_progress_periods(id) on delete restrict,
  wbs_element_id uuid not null references project_wbs_elements(id) on delete restrict,
  -- Spec II.9's six sources, in the spec's own order.
  evidence_source text not null check (evidence_source in
    ('drawings_issued','deliverables_accepted','quantities_complete',
     'procurement_releases','field_installation','inspection_records')),
  -- A COUNTED PAIR, never a percentage. "71% accepted" is an assertion;
  -- "137 of 193 accepted" is a check.
  observed_complete numeric not null,
  observed_total numeric not null,
  unit text not null check (btrim(unit) <> ''),
  basis text not null check (length(btrim(basis)) >= 10),
  observed_by uuid references auth.users(id),
  observed_at timestamptz not null default now(),
  -- One observation per source per element per period. A second reading from
  -- the same source in the same period is a correction, and a correction that
  -- silently coexists with what it corrects makes "the lowest source" a
  -- lottery.
  unique (period_id, wbs_element_id, evidence_source),
  -- FINITE, and a denominator that is actually a denominator.
  constraint evidence_counts_finite check (
    observed_complete > '-Infinity'::numeric and observed_complete < 'Infinity'::numeric
    and observed_total > '-Infinity'::numeric and observed_total < 'Infinity'::numeric
  ),
  constraint evidence_total_positive check (observed_total > 0),
  constraint evidence_complete_in_range check (
    observed_complete >= 0 and observed_complete <= observed_total
  )
);

create index if not exists idx_progress_evidence_case
  on project_progress_evidence(organization_id, development_case_id, period_id);
create index if not exists idx_progress_evidence_element
  on project_progress_evidence(wbs_element_id);

alter table public.project_progress_evidence enable row level security;
drop policy if exists project_progress_evidence_read on public.project_progress_evidence;
create policy project_progress_evidence_read on public.project_progress_evidence
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: every mutation is a definer RPC.

comment on table public.project_progress_evidence is
  'D5.20 (spec II.9): an independent counted observation of physical progress — IFC deliverables accepted, quantities installed, inspection records — against which a claimed percent complete is cross-checked. Counted pairs only: a bare percentage here would be a second place to type a progress number.';

-- ---------------------------------------------------------------------------
-- The wall. INSERT, UPDATE and DELETE — evidence that can be deleted is
-- evidence that stops contradicting a claim the moment it becomes
-- inconvenient, which is the entire failure mode this row exists to detect.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_progress_evidence()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.progress_evidence_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_case_org uuid;
  p project_progress_periods%rowtype;
  v_case uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_progress_evidence is the independent record every progress confidence rating is derived from; truncating it makes every claimed percent on the project unverified in one statement, with nothing recording that it happened.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if tg_op in ('UPDATE','DELETE') then
    if not v_client and current_user not in ('authenticated', 'anon') then
      if exists (select 1 from organizations where id = v_org) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (v_org, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'A progress evidence observation was ' || lower(tg_op) || 'd by a service '
             || 'caller. The observation is what a claimed percent complete is '
             || 'cross-checked against (D5.20); evidence that can be changed stops '
             || 'contradicting a claim the moment it becomes inconvenient.');
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    raise exception
      'an independent progress observation is immutable — it records what was counted, by whom, at an instant that has passed. Record the corrected observation in the next period.'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = new.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'A progress evidence observation was written by a service caller outside '
           'record_progress_evidence. It is the independent measure a claimed '
           'percent complete is rated against (D5.20).');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'an independent progress observation is written through record_progress_evidence — a direct write would supply the evidence a claim is verified against with no recorded act behind it.'
      using errcode = 'insufficient_privilege';
  end if;

  select organization_id into v_case_org from development_cases where id = new.development_case_id;
  if v_case_org is null or v_case_org <> new.organization_id then
    raise exception
      'this progress observation is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;

  select * into p from project_progress_periods where id = new.period_id;
  if not found or p.development_case_id <> new.development_case_id then
    raise exception
      'a progress observation does not jump between cases: its period belongs to another development case'
      using errcode = 'check_violation';
  end if;

  select development_case_id into v_case from project_wbs_elements where id = new.wbs_element_id;
  if v_case is null or v_case <> new.development_case_id then
    raise exception
      'a progress observation does not jump between cases: its WBS element belongs to another development case'
      using errcode = 'check_violation';
  end if;
  -- The observer column is org-checked too: the integrity read runs inside a
  -- SECURITY DEFINER, so a foreign user id stamped by the (admitted,
  -- audited) service path would be resolvable to that person's identity.
  if new.observed_by is not null
     and not exists (select 1 from user_profiles up
                      where up.id = new.observed_by
                        and up.organization_id = new.organization_id) then
    raise exception
      'this progress observation names an observer who does not belong to the organization that owns it'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_progress_evidence() from public, anon, authenticated;

drop trigger if exists trg_progress_evidence on public.project_progress_evidence;
create trigger trg_progress_evidence
  before insert or update or delete on public.project_progress_evidence
  for each row execute function public.enforce_progress_evidence();

drop trigger if exists trg_progress_evidence_no_truncate on public.project_progress_evidence;
create trigger trg_progress_evidence_no_truncate
  before truncate on public.project_progress_evidence
  for each statement execute function public.enforce_progress_evidence();

revoke truncate on table public.project_progress_evidence from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE ACT. §70: refused to the AI-operator identity by name.
-- ---------------------------------------------------------------------------
create or replace function public.record_progress_evidence(
  p_period_id uuid,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p project_progress_periods%rowtype;
  w project_wbs_elements%rowtype;
  v_wbs_code text := nullif(btrim(coalesce(p_evidence->>'wbs_code','')), '');
  v_source text := nullif(btrim(coalesce(p_evidence->>'evidence_source','')), '');
  v_complete_raw text := nullif(btrim(coalesce(p_evidence->>'observed_complete','')), '');
  v_total_raw text := nullif(btrim(coalesce(p_evidence->>'observed_total','')), '');
  v_complete numeric;
  v_total numeric;
  v_unit text := nullif(btrim(coalesce(p_evidence->>'unit','')), '');
  v_basis text := nullif(btrim(coalesce(p_evidence->>'basis','')), '');
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'an independent observation of physical progress is a progress judgement — the AI-operator identity cannot record one (spec §70). An identity that could write the evidence could verify the claim it is forbidden to make.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording an independent progress observation requires a planning, engineering or governance role');
  end if;
  select * into p from project_progress_periods where id = p_period_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'reporting period not found');
  end if;
  if p.status = 'closed' then
    return jsonb_build_object('error',
      format('reporting period %s is closed; an observation recorded into it now would change what the progress integrity rating computed in it was based on.', p.period_ref));
  end if;
  if v_wbs_code is null then
    return jsonb_build_object('error',
      'name the WBS element this observation is about (wbs_code)');
  end if;
  select * into w from project_wbs_elements
   where development_case_id = p.development_case_id and wbs_code = v_wbs_code;
  if not found then
    return jsonb_build_object('error',
      format('WBS code "%s" does not resolve on this case', v_wbs_code));
  end if;
  if v_source is null then
    return jsonb_build_object('error',
      'name the independent source (evidence_source): drawings_issued, deliverables_accepted, quantities_complete, procurement_releases, field_installation or inspection_records');
  end if;
  if v_source not in ('drawings_issued','deliverables_accepted','quantities_complete',
                      'procurement_releases','field_installation','inspection_records') then
    return jsonb_build_object('error',
      format('"%s" is not one of the recorded cross-check sources (spec II.9): drawings_issued, deliverables_accepted, quantities_complete, procurement_releases, field_installation, inspection_records', v_source));
  end if;
  if v_complete_raw is null or v_total_raw is null then
    return jsonb_build_object('error',
      'an observation is a counted pair — observed_complete out of observed_total. A bare percentage here would be a second place to type a progress number, which is exactly what this cross-check exists to check.');
  end if;
  v_complete := sync_text_as_numeric(v_complete_raw);
  v_total := sync_text_as_numeric(v_total_raw);
  if v_complete is null then
    return jsonb_build_object('error', format('observed_complete "%s" is not a number', v_complete_raw));
  end if;
  if v_total is null then
    return jsonb_build_object('error', format('observed_total "%s" is not a number', v_total_raw));
  end if;
  if v_complete = 'NaN'::numeric or v_complete = 'Infinity'::numeric or v_complete = '-Infinity'::numeric
     or v_total = 'NaN'::numeric or v_total = 'Infinity'::numeric or v_total = '-Infinity'::numeric then
    return jsonb_build_object('error',
      'an observed count must be a finite number — a non-finite count produces a percentage that is not a percentage');
  end if;
  if v_total <= 0 then
    return jsonb_build_object('error',
      'observed_total must be greater than zero — an observation out of nothing is a division by zero wearing a percentage sign');
  end if;
  if v_complete < 0 or v_complete > v_total then
    return jsonb_build_object('error',
      format('observed_complete is %s of a total of %s — a count of the complete cannot be negative or exceed the whole', v_complete, v_total));
  end if;
  if v_unit is null then
    return jsonb_build_object('error',
      'state what is being counted (unit) — "137 of 193" means nothing until it says "drawings"');
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state where this observation came from (basis, 10 characters minimum) — an independent measure with no source is not independent');
  end if;
  if exists (select 1 from project_progress_evidence
             where period_id = p.id and wbs_element_id = w.id and evidence_source = v_source) then
    return jsonb_build_object('error',
      format('%s already carries a %s observation in period %s. A second reading from the same source in the same period is a correction, and a correction that coexists with what it corrects makes "the lowest source" a lottery — record it in the next period.',
             v_wbs_code, v_source, p.period_ref));
  end if;

  perform set_config('app.progress_evidence_write', 'granted', true);
  insert into project_progress_evidence
    (organization_id, development_case_id, period_id, wbs_element_id, evidence_source,
     observed_complete, observed_total, unit, basis, observed_by)
  values (v_org, p.development_case_id, p.id, w.id, v_source,
          v_complete, v_total, v_unit, v_basis, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_progress_evidence', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'evidence_id', v_id,
      'period_ref', p.period_ref, 'wbs_code', v_wbs_code, 'source', v_source,
      'action', 'observed'),
    null,
    jsonb_build_object('wbs_code', v_wbs_code, 'evidence_source', v_source,
      'observed_complete', v_complete, 'observed_total', v_total, 'unit', v_unit,
      'observedPercent', round(v_complete / v_total * 100, 1)));

  return jsonb_build_object('evidence_id', v_id, 'wbs_code', v_wbs_code,
    'evidence_source', v_source,
    'observed_percent', round(v_complete / v_total * 100, 1));
end
$$;

revoke all on function public.record_progress_evidence(uuid, jsonb) from public, anon, service_role;
grant execute on function public.record_progress_evidence(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- THE CROSS-CHECK. One predicate; the compute below is this plus lineage.
--
-- BANDS, STATED AND RETURNED WITH THE RATING:
--   high    divergence <=  5 percentage points
--   medium  divergence <= 15 percentage points
--   low     divergence >  15 percentage points
--   unrated no independent observation exists for the element at all
--
-- Divergence is ABSOLUTE. Claiming 60% where the evidence says 85% is as much
-- a break between the two systems as the reverse, and a signed test would let
-- under-claiming pass silently as conservatism.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_progress_integrity(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  p project_progress_periods%rowtype;
  v_elements jsonb := '[]'::jsonb;
  v_claimed int := 0;
  v_covered int := 0;
  v_low int := 0;
  v_medium int := 0;
  v_high int := 0;
  v_band text;
  v_headline text;
  v_worst jsonb;
  v_refusal text;
  v_evidence_count int := 0;
  v_digest text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select * into p from project_progress_periods
   where development_case_id = c.id order by period_end desc limit 1;

  if p.id is null then
    return jsonb_build_object(
      'caseId', c.id, 'period', null, 'elements', '[]'::jsonb,
      'claimedElementCount', 0, 'coveredElementCount', 0, 'coverage', null,
      'evidenceCount', 0, 'basisDigest', null,
      'confidence', null, 'headline', null,
      'bands', jsonb_build_object('high', 'divergence <= 5 points',
        'medium', 'divergence <= 15 points', 'low', 'divergence > 15 points'),
      'refusal',
        'No reporting period is recorded on this case, so there is no claimed progress to cross-check and nothing to rate.');
  end if;

  -- THE SAME POPULATION EARNED VALUE MEASURED. The cross-check rates the
  -- positions the earned value was computed from, which is the CUMULATIVE
  -- set — the latest position per element at or before the data date
  -- (20261201090300's ruling) — not the rows filed into the latest period.
  -- Rating a different population from the one the money was computed on
  -- would make "this earned value carries a HIGH progress confidence" a
  -- statement about a set the earned value never used.
  with claims as (
    select distinct on (cl.wbs_element_id)
           cl.wbs_element_id, cl.claimed_percent, cl.step_label, w.wbs_code, w.title,
           r.rule_ref, pp.period_ref, (cl.period_id <> p.id) as carried_forward
      from project_progress_claims cl
      join project_progress_periods pp on pp.id = cl.period_id
      join project_wbs_elements w on w.id = cl.wbs_element_id
      join project_rules_of_credit r on r.id = cl.rule_id
     where cl.development_case_id = c.id and pp.period_end <= p.period_end
     order by cl.wbs_element_id, pp.period_end desc
  ),
  -- Evidence likewise: the latest observation per element per source at or
  -- before the data date. An observation recorded in March against a package
  -- nobody re-counted in April still contradicts an April claim.
  observed as (
    select distinct on (e.wbs_element_id, e.evidence_source)
           e.wbs_element_id, e.evidence_source, e.unit,
           e.observed_complete, e.observed_total,
           e.observed_complete / e.observed_total * 100.0 as observed_percent
      from project_progress_evidence e
      join project_progress_periods pp on pp.id = e.period_id
     where e.development_case_id = c.id and pp.period_end <= p.period_end
     order by e.wbs_element_id, e.evidence_source, pp.period_end desc
  ),
  -- RULE 2: the binding measure is the LOWEST independent one, and the
  -- source that produced it is carried through by name.
  binding as (
    select distinct on (o.wbs_element_id)
           o.wbs_element_id, o.evidence_source, o.unit,
           o.observed_complete, o.observed_total, o.observed_percent
      from observed o
     order by o.wbs_element_id, o.observed_percent asc, o.evidence_source
  )
  select
    count(*),
    count(*) filter (where b.wbs_element_id is not null),
    count(*) filter (where b.wbs_element_id is not null
                       and abs(cl.claimed_percent - b.observed_percent) > 15),
    count(*) filter (where b.wbs_element_id is not null
                       and abs(cl.claimed_percent - b.observed_percent) > 5
                       and abs(cl.claimed_percent - b.observed_percent) <= 15),
    count(*) filter (where b.wbs_element_id is not null
                       and abs(cl.claimed_percent - b.observed_percent) <= 5),
    jsonb_agg(jsonb_build_object(
      'wbsCode', cl.wbs_code,
      'title', cl.title,
      'ruleRef', cl.rule_ref,
      'stepLabel', cl.step_label,
      'claimedPercent', cl.claimed_percent,
      'bindingSource', b.evidence_source,
      'bindingUnit', b.unit,
      'observedComplete', b.observed_complete,
      'observedTotal', b.observed_total,
      'observedPercent', round(b.observed_percent, 1),
      'divergencePoints', case when b.wbs_element_id is null then null
                               else round(abs(cl.claimed_percent - b.observed_percent), 1) end,
      'sourceCount', (select count(*) from observed o2 where o2.wbs_element_id = cl.wbs_element_id),
      'confidence', case
        when b.wbs_element_id is null then null
        when abs(cl.claimed_percent - b.observed_percent) <= 5 then 'high'
        when abs(cl.claimed_percent - b.observed_percent) <= 15 then 'medium'
        else 'low' end,
      -- RULE 1, said out loud on every uncovered element.
      'refusal', case when b.wbs_element_id is null then
        'No independent observation is recorded for this element in this period, so its claimed progress is UNRATED — nothing contradicts it and nothing confirms it, and those are not the same thing.'
        else null end,
      'discrepancy', case
        when b.wbs_element_id is null then null
        when abs(cl.claimed_percent - b.observed_percent) <= 5 then null
        else format('%s is reported %s percent complete at "%s"; only %s of %s %s are %s (%s percent).',
          cl.wbs_code, cl.claimed_percent, cl.step_label,
          b.observed_complete, b.observed_total, b.unit,
          replace(b.evidence_source, '_', ' '), round(b.observed_percent, 1))
        end
    ) order by case when b.wbs_element_id is null then 1 else 0 end,
               abs(cl.claimed_percent - coalesce(b.observed_percent, 0)) desc, cl.wbs_code)
    into v_claimed, v_covered, v_low, v_medium, v_high, v_elements
  from claims cl
  left join binding b on b.wbs_element_id = cl.wbs_element_id;

  v_elements := coalesce(v_elements, '[]'::jsonb);

  -- ── ONE DEFINITION OF evidenceCount, RETURNED BY THE READ. ──────────────
  -- The recorded run and the live surface must count the same thing or a
  -- just-recorded run reads as permanently STALE. Two definitions existed —
  -- "all evidence in the period" on the recording side and "evidence on
  -- claimed elements" on the surface — and any observation against an
  -- unclaimed element made them disagree for ever, permanently suppressing
  -- the code-version caption on a figure that was current. The count and the
  -- digest are computed HERE, once, and both sides read them from this read.
  select count(*) into v_evidence_count
    from project_progress_evidence e
    join project_progress_periods pp on pp.id = e.period_id
   where e.development_case_id = c.id and pp.period_end <= p.period_end;

  select md5(
      coalesce((select string_agg(w.wbs_code || '~' || cl.claimed_percent::text,
                                  '|' order by w.wbs_code)
                  from (select distinct on (c2.wbs_element_id) c2.wbs_element_id, c2.claimed_percent
                          from project_progress_claims c2
                          join project_progress_periods p2 on p2.id = c2.period_id
                         where c2.development_case_id = c.id and p2.period_end <= p.period_end
                         order by c2.wbs_element_id, p2.period_end desc) cl
                  join project_wbs_elements w on w.id = cl.wbs_element_id), '')
      || '#' ||
      coalesce((select string_agg(w.wbs_code || '~' || ev.evidence_source || '~'
                                  || ev.observed_complete::text || '/' || ev.observed_total::text,
                                  '|' order by w.wbs_code, ev.evidence_source)
                  from (select distinct on (e2.wbs_element_id, e2.evidence_source)
                               e2.wbs_element_id, e2.evidence_source,
                               e2.observed_complete, e2.observed_total
                          from project_progress_evidence e2
                          join project_progress_periods p2 on p2.id = e2.period_id
                         where e2.development_case_id = c.id and p2.period_end <= p.period_end
                         order by e2.wbs_element_id, e2.evidence_source, p2.period_end desc) ev
                  join project_wbs_elements w on w.id = ev.wbs_element_id), '')
      || '#' || p.period_ref)
    into v_digest;

  -- RULE 3 and the case rating.
  if v_claimed = 0 then
    v_refusal := format(
      'No progress is claimed in period %s, so there is nothing to cross-check. That is an empty claim set, not verified progress.', p.period_ref);
  elsif v_covered = 0 then
    v_refusal := format(
      '%s element(s) carry claimed progress in period %s and none of them has an independent observation recorded against it. There is no progress confidence rating: absence of evidence is not confirmation, and rating this HIGH because nothing contradicts it is the failure this cross-check exists to prevent.',
      v_claimed, p.period_ref);
  else
    v_band := case when v_low > 0 then 'low' when v_medium > 0 then 'medium' else 'high' end;
    select e into v_worst from jsonb_array_elements(v_elements) e
     where e->>'discrepancy' is not null limit 1;
    v_headline := case
      when v_worst is not null then v_worst->>'discrepancy'
      else format('All %s cross-checked element(s) sit within 5 points of their independent observation.', v_covered)
      end;
    if v_covered < v_claimed then
      v_headline := v_headline || format(
        ' This rating covers %s of %s claimed element(s); the other %s carry no independent observation and are unrated.',
        v_covered, v_claimed, v_claimed - v_covered);
    end if;
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'period', jsonb_build_object('id', p.id, 'periodRef', p.period_ref,
      'periodEnd', p.period_end, 'status', p.status),
    'elements', v_elements,
    'claimedElementCount', v_claimed,
    'coveredElementCount', v_covered,
    'coverage', case when v_claimed = 0 then null
                     else round(v_covered::numeric / v_claimed * 100, 1) end,
    'evidenceCount', v_evidence_count,
    'basisDigest', v_digest,
    'lowCount', v_low,
    'mediumCount', v_medium,
    'highCount', v_high,
    'confidence', v_band,
    'headline', v_headline,
    'bands', jsonb_build_object(
      'high', 'absolute divergence of 5 percentage points or less',
      'medium', 'absolute divergence of 15 percentage points or less',
      'low', 'absolute divergence greater than 15 percentage points',
      'note', 'The divergence is absolute: claiming less than the evidence shows is as much a break between the two systems as claiming more, and a signed test would let under-claiming pass as conservatism. The binding observation is the LOWEST of the sources recorded for an element, so one generous source cannot cover a damning one.'),
    'refusal', v_refusal);
end
$$;

revoke all on function public.get_case_progress_integrity(uuid) from public, anon, service_role;
grant execute on function public.get_case_progress_integrity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.compute_case_progress_integrity(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_report jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  v_el jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing the progress integrity cross-check requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_report := get_case_progress_integrity(c.id);
  if v_report ? 'error' then
    return v_report;
  end if;

  if v_report->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_report->>'refusal');
  end if;
  -- Every unrated element is named on the run. A rating recorded without the
  -- population it did not cover is the coverage failure written into the
  -- ledger.
  for v_el in select e from jsonb_array_elements(coalesce(v_report->'elements', '[]'::jsonb)) e loop
    if v_el->>'refusal' is not null then
      v_refusals := v_refusals || to_jsonb(format('%s: %s', v_el->>'wbsCode', v_el->>'refusal')::text);
    elsif v_el->>'discrepancy' is not null then
      v_refusals := v_refusals || to_jsonb(v_el->>'discrepancy');
    end if;
  end loop;

  if v_report->>'confidence' is null then
    v_outputs := null;
    if jsonb_array_length(v_refusals) = 0 then
      v_refusals := jsonb_build_array(
        'No progress confidence could be rated and no reason was recorded, which is itself a defect worth seeing.');
    end if;
  else
    v_outputs := jsonb_build_object(
      'confidence', v_report->'confidence',
      'coverage', v_report->'coverage',
      'claimedElementCount', v_report->'claimedElementCount',
      'coveredElementCount', v_report->'coveredElementCount',
      'lowCount', v_report->'lowCount',
      'mediumCount', v_report->'mediumCount',
      'highCount', v_report->'highCount',
      'headline', v_report->'headline',
      'periodRef', v_report->'period'->'periodRef');
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_progress_integrity',
    'Each element''s claimed percent complete AT THE DATA DATE — the latest recorded position per element at or before the period end, which is the population the earned value was computed from — compared against the LOWEST independent counted observation recorded for the same element at or before the same date (spec II.9 sources). The band is a function of the absolute divergence and the coverage is reported with it; an element with no observation is unrated rather than confirmed.',
    -- Both sides of the staleness comparison read the SAME fields off the
    -- SAME read. `basisDigest` covers the observed COUNTS as well as the
    -- rows, so a corrected observation is visible where a row count is not.
    jsonb_build_object(
      'periodRef', v_report->'period'->'periodRef',
      'basisDigest', v_report->'basisDigest',
      'claimedElementCount', v_report->'claimedElementCount',
      'coveredElementCount', v_report->'coveredElementCount',
      'evidenceCount', v_report->'evidenceCount'),
    (coalesce((select jsonb_agg(jsonb_build_object('table', 'project_progress_claims', 'id', q.id))
                 from (select distinct on (cl.wbs_element_id) cl.id
                         from project_progress_claims cl
                         join project_progress_periods pp on pp.id = cl.period_id
                        where cl.development_case_id = c.id
                          and pp.period_end <= (v_report->'period'->>'periodEnd')::date
                        order by cl.wbs_element_id, pp.period_end desc) q), '[]'::jsonb)
     || coalesce((select jsonb_agg(jsonb_build_object('table', 'project_progress_evidence', 'id', q.id))
                    from (select distinct on (e.wbs_element_id, e.evidence_source) e.id
                            from project_progress_evidence e
                            join project_progress_periods pp on pp.id = e.period_id
                           where e.development_case_id = c.id
                             and pp.period_end <= (v_report->'period'->>'periodEnd')::date
                           order by e.wbs_element_id, e.evidence_source, pp.period_end desc) q), '[]'::jsonb)),
    v_outputs,
    v_refusals);

  return v_report || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_progress_integrity'));
end
$$;

revoke all on function public.compute_case_progress_integrity(uuid) from public, anon, service_role;
grant execute on function public.compute_case_progress_integrity(uuid) to authenticated;
