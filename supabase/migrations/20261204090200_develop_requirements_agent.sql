-- ============================================================================
-- Sync Develop Slice 5A — the Requirements Agent (D12.09, spec III.§59).
--
-- §59: "Requirements Agent (missing/unverified/orphan/inconsistent — '14
-- requirements have no verification method')."
--
-- ── RULING 1 — THE SPEC'S OWN EXAMPLE IS A SQL QUERY, SO IT IS SQL ────────
--
-- "14 requirements have no verification method" is a COUNT over a column. It
-- has one right answer, it is cheap, and it is auditable. Sending it to a
-- language model would make a deterministic fact probabilistic, non-
-- reproducible and unciteable — and would produce a number nobody could
-- defend at a gate review. Every finding family in this file except one is
-- therefore computed in SQL by get_case_requirement_findings, and the counts
-- the agent reports are read from that function INSIDE the recording RPC
-- rather than supplied by the caller. A model cannot report a number it
-- invented, the same wall record_gate_agent_report already stands behind.
--
-- THE ONE EXCEPTION is semantic inconsistency between two requirements —
-- "availability shall be ≥ 98%" beside "single train, no installed spare".
-- Nothing in the schema can see that; it needs reading comprehension over two
-- prose statements. Those findings ARE model output, they are stored with
-- `source = 'ai_suggestion'` FIXED IN SQL (never read from the payload, the
-- propose_framework_from_document idiom), they are rendered as AI-generated,
-- and they carry no severity that can block anything.
--
-- ── RULING 2 — THE AGENT PROPOSES; IT HAS NO PATH TO ANY DISPOSITION ──────
--
-- Not a promise — an absence plus four refusals it composes with:
--
--   * requirement_agent_reports has NO column that can hold a verification
--     status, a result, an approval or a decision. `advisory` is pinned true
--     by a CHECK so a later migration adding one has to argue with this
--     constraint first (the gate_agent_reports idiom, 20261123090200).
--   * create_requirement_verification refuses 'ai_admin' BY NAME
--     (20261204090100) — the identity cannot state a verification method and
--     so cannot clear its own "missing verification method" finding.
--   * record_verification_result refuses 'ai_admin' BY NAME, and
--     trg_verification_recorder_is_human refuses a result attributed to that
--     identity for EVERY writer, service included.
--   * design_requirements.verification_status is moved only by
--     record_verification_result (20261204090100 ruling 5). There is no act
--     in this product that types a status onto a requirement, for anybody.
--
-- The agent holds no path to any of those tables. Its only write is
-- record_requirements_agent_report.
--
-- ── RULING 3 — REPORTS ARE ON DEMAND, NOT SCHEDULED ──────────────────────
--
-- The same ruling the Gate Agent records: a cron writing a findings report
-- per case per hour would make the agent's LAST RUN the thing people cite
-- instead of the live answer, and the live answer is one function call away.
-- get_case_requirement_findings is available on every load; the agent adds
-- narrative and a dated record when someone asks for one.
--
-- ── RULING 4 — A FINDINGS REPORT OVER AN EMPTY REQUIREMENT SET REFUSES ────
--
-- "0 findings" over a case with no requirements is the most dangerous output
-- this family could produce: it is identical to a perfectly traced project
-- and it renders green. The finding function refuses, the recording RPC
-- refuses, and the refusal text says what to do instead.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The deterministic finding engine (ruling 1).
--
--    Five families, all in SQL, each carrying the RECORD LINKS §59 asks for
--    (requirement id + ref, and the second requirement where a finding is
--    about a pair). Severity is a fact about the finding class, not a
--    judgement: 'blocking' means a gate category exists that consumes it,
--    'attention' means an engineer should look, 'informational' means it is
--    context.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_requirement_findings(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  v_total int;
  v_findings jsonb := '[]'::jsonb;
  v_missing jsonb;
  v_unverified jsonb;
  v_orphan jsonb;
  v_inconsistent jsonb;
  v_unowned jsonb;
  v_trace jsonb;
  v_no_wbs jsonb := '[]'::jsonb;
  v_refusals jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*) into v_total from design_requirements d
   where d.development_case_id = c.id;

  -- ── RULING 4: the empty-set refusal ─────────────────────────────────────
  if v_total = 0 then
    return jsonb_build_object(
      'caseId', c.id, 'refused', true, 'requirementCount', 0,
      'findings', '[]'::jsonb, 'findingCount', null,
      'refusal',
        'This case has no requirements, so the Requirements Agent has nothing to check. It reports a REFUSAL rather than "0 findings", because 0 findings over an empty requirement set is indistinguishable from a fully traced, fully verified project — and it renders the same colour. Record the requirements (§10) and ask again.');
  end if;

  -- ── FAMILY 1: missing verification method (the spec's own example) ───────
  select coalesce(jsonb_agg(jsonb_build_object(
    'family', 'missing_verification_method',
    'severity', 'blocking',
    'source', 'deterministic',
    'requirementId', d.id,
    'requirementRef', d.requirement_ref,
    'category', d.category,
    'detail', format('%s has no verification method. Nobody has said how anyone would know it was met, so it cannot be verified, cannot be closed at a gate, and will be carried to handover as an open question wearing the word "requirement".', d.requirement_ref))
    order by d.requirement_ref), '[]'::jsonb)
  into v_missing
  from design_requirements d
  where d.development_case_id = c.id
    and coalesce(btrim(d.verification_method), '') = ''
    and not exists (select 1 from verification_obligations o
                     where o.requirement_id = d.id);

  -- ── FAMILY 2: unverified ────────────────────────────────────────────────
  --  Split three ways, because "nobody has looked yet", "somebody was
  --  supposed to look and the date has passed" and "somebody looked and it
  --  failed" are three different states that a single 'unverified' count
  --  would flatten into one comfortable number.
  select coalesce(jsonb_agg(f order by f->>'requirementRef'), '[]'::jsonb)
  into v_unverified
  from (
    select jsonb_build_object(
      'family', 'unverified',
      'subFamily', case
        when d.verification_status = 'failed' then 'verification_failed'
        when exists (select 1 from verification_obligations o
                      where o.requirement_id = d.id and o.status = 'open'
                        and o.due_date < current_date) then 'verification_overdue'
        when exists (select 1 from verification_obligations o
                      where o.requirement_id = d.id and o.status = 'open')
          then 'verification_pending'
        else 'no_verification_planned' end,
      'severity', case when d.verification_status = 'failed' then 'blocking'
                       else 'attention' end,
      'source', 'deterministic',
      'requirementId', d.id,
      'requirementRef', d.requirement_ref,
      'category', d.category,
      'verificationStatus', d.verification_status,
      'detail', case
        when d.verification_status = 'failed'
          then format('%s was verified and FAILED. This is not an open item; it is a known negative result, and carrying it as "in progress" would lose the one piece of information the verification produced.', d.requirement_ref)
        when exists (select 1 from verification_obligations o
                      where o.requirement_id = d.id and o.status = 'open'
                        and o.due_date < current_date)
          then format('%s has a verification that is past its due date. A verification that never happens looks identical to one that passed.', d.requirement_ref)
        when exists (select 1 from verification_obligations o
                      where o.requirement_id = d.id and o.status = 'open')
          then format('%s has a verification planned and open, in date. Listed for completeness, not as a problem.', d.requirement_ref)
        else format('%s states a verification method but no verification has been planned against it. The method is a sentence until an obligation exists with a date on it.', d.requirement_ref)
      end) as f
    from design_requirements d
    where d.development_case_id = c.id
      and d.verification_status in ('open','failed')
      and not (coalesce(btrim(d.verification_method), '') = ''
               and not exists (select 1 from verification_obligations o
                                where o.requirement_id = d.id))
  ) s;

  -- ── FAMILY 3: orphan ────────────────────────────────────────────────────
  --  Upstream orphan: no objective (§10's chain head). Downstream orphan: not
  --  in the WBS — DELEGATED to get_case_scope_traceability, the ONE
  --  implementation of that question (D5.02). If the delegate cannot answer,
  --  the downstream half is REFUSED rather than reported as zero.
  v_trace := get_case_scope_traceability(c.id);
  if v_trace ? 'error' then
    v_refusals := v_refusals || to_jsonb(format(
      'The downstream orphan check (requirement absent from the WBS) could not run: %s. It is NOT reported as zero orphans.',
      v_trace->>'error'));
  else
    v_no_wbs := coalesce(v_trace->'forwardGaps'->'requirementsWithoutWbs', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(f order by f->>'requirementRef'), '[]'::jsonb)
  into v_orphan
  from (
    select jsonb_build_object(
      'family', 'orphan',
      'subFamily', 'no_objective',
      'severity', 'attention',
      'source', 'deterministic',
      'requirementId', d.id,
      'requirementRef', d.requirement_ref,
      'category', d.category,
      'detail', format('%s traces to no objective. A requirement nobody can connect to an objective is a requirement nobody can defend deleting either — it survives every scope challenge by being unattached.', d.requirement_ref)) as f
    from design_requirements d
    where d.development_case_id = c.id and d.objective_id is null
    union all
    select jsonb_build_object(
      'family', 'orphan',
      'subFamily', 'absent_from_wbs',
      'severity', 'blocking',
      'source', 'deterministic',
      'requirementId', (x->>'requirementId')::bigint,
      'requirementRef', x->>'requirementRef',
      'category', x->>'category',
      'detail', format('%s does not appear in the WBS — the spec''s own example of a broken scope chain (I.6: "Requirement R-184 does not appear in the WBS"). Nothing is scheduled or costed to deliver it. Reported by get_case_scope_traceability, not recomputed here.', x->>'requirementRef')) as f
    from jsonb_array_elements(v_no_wbs) x
  ) s;

  -- ── FAMILY 4: inconsistent (deterministic classes only) ─────────────────
  select coalesce(jsonb_agg(f order by f->>'requirementRef', f->>'subFamily'), '[]'::jsonb)
  into v_inconsistent
  from (
    -- 4a. Status asserted with no verification behind it. The only way this
    --     can happen today is a row written before 20261204090100 or by a
    --     migration; it is still checked, because "verified" with nothing
    --     behind it is the single most expensive lie this table can tell.
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'verified_without_a_result',
      'severity', 'blocking', 'source', 'deterministic',
      'requirementId', d.id, 'requirementRef', d.requirement_ref,
      'detail', format('%s is marked VERIFIED but no completed verification with an achieved result stands behind it. The status is an assertion, not a finding.', d.requirement_ref)) as f
    from design_requirements d
    where d.development_case_id = c.id
      and d.verification_status = 'verified'
      and not exists (select 1 from verification_obligations o
                       where o.requirement_id = d.id and o.status = 'completed'
                         and o.result = 'achieved')
    union all
    -- 4b. A parent verified while a child is not. Decomposition means the
    --     parent is met BY its children; a verified parent over an unverified
    --     child is the hierarchy contradicting itself.
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'parent_verified_before_child',
      'severity', 'blocking', 'source', 'deterministic',
      'requirementId', p.id, 'requirementRef', p.requirement_ref,
      'relatedRequirementId', ch.id, 'relatedRequirementRef', ch.requirement_ref,
      'detail', format('%s is VERIFIED but its child %s is %s. A parent requirement is met BY its children; a verified parent above an unverified child means one of the two statuses is wrong.',
        p.requirement_ref, ch.requirement_ref, ch.verification_status)) as f
    from design_requirements p
    join design_requirements ch on ch.parent_requirement_id = p.id
    where p.development_case_id = c.id
      and p.verification_status = 'verified'
      and ch.verification_status <> 'verified'
    union all
    -- 4c. Testable with nothing to test against.
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'testable_without_acceptance_criteria',
      'severity', 'attention', 'source', 'deterministic',
      'requirementId', d.id, 'requirementRef', d.requirement_ref,
      'detail', format('%s will be verified by %s but states no acceptance criteria. A test with nothing to test against produces a number nobody can call a pass or a fail.',
        d.requirement_ref, d.verification_method)) as f
    from design_requirements d
    where d.development_case_id = c.id
      and d.verification_method in ('test','operational_validation','factory_test','site_test')
      and coalesce(btrim(d.acceptance_criteria), '') = ''
    union all
    -- 4d. Two requirements measured by one KPI (20261204090000 ruling 4).
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'shared_operating_kpi',
      'severity', 'attention', 'source', 'deterministic',
      'requirementId', a.id, 'requirementRef', a.requirement_ref,
      'relatedRequirementId', b.id, 'relatedRequirementRef', b.requirement_ref,
      'detail', format('%s and %s are both measured in operation by "%s". One KPI cannot report which of the two is being met, so in service the pair is unfalsifiable — decompose, or measure them differently.',
        a.requirement_ref, b.requirement_ref, a.operating_kpi_key)) as f
    from design_requirements a
    join design_requirements b
      on b.development_case_id = a.development_case_id
     and b.operating_kpi_key = a.operating_kpi_key
     and b.id > a.id
    where a.development_case_id = c.id and a.operating_kpi_key is not null
  ) s;

  -- ── FAMILY 5: unowned (20261204090000 ruling 5) ─────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
    'family', 'unowned', 'severity', 'attention', 'source', 'deterministic',
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category,
    'detail', format('%s has no owner. §10 gives a requirement an owner_id; a requirement with nobody accountable is a wish that survives to handover.', d.requirement_ref))
    order by d.requirement_ref), '[]'::jsonb)
  into v_unowned
  from design_requirements d
  where d.development_case_id = c.id and d.owner_id is null;

  v_findings := v_missing || v_unverified || v_orphan || v_inconsistent || v_unowned;

  return jsonb_build_object(
    'caseId', c.id,
    'refused', false,
    'requirementCount', v_total,
    'findingCount', jsonb_array_length(v_findings),
    'byFamily', jsonb_build_object(
      'missingVerificationMethod', jsonb_array_length(v_missing),
      'unverified', jsonb_array_length(v_unverified),
      'orphan', jsonb_array_length(v_orphan),
      'inconsistent', jsonb_array_length(v_inconsistent),
      'unowned', jsonb_array_length(v_unowned)),
    -- The §59 headline, formed the way the spec forms it.
    'headline', format('%s requirement(s) have no verification method; %s are unverified; %s are orphaned; %s are internally inconsistent; %s have no owner.',
      jsonb_array_length(v_missing), jsonb_array_length(v_unverified),
      jsonb_array_length(v_orphan), jsonb_array_length(v_inconsistent),
      jsonb_array_length(v_unowned)),
    'findings', v_findings,
    'refusals', v_refusals,
    'advisory', true,
    'disclaimer', 'Findings, not dispositions. Nothing here changes a verification status, closes an obligation or marks a requirement verified — those are §70 human acts and the database refuses this path to all three.');
end
$$;

revoke all on function public.get_case_requirement_findings(uuid) from public, anon;
grant execute on function public.get_case_requirement_findings(uuid) to authenticated, service_role;

comment on function public.get_case_requirement_findings(uuid) is
  'D12.09 / spec §59: the deterministic half of the Requirements Agent — missing verification method, unverified, orphan, inconsistent, unowned — with record links. Refuses over an empty requirement set. The WBS orphan class is DELEGATED to get_case_scope_traceability, never recomputed.';

-- ---------------------------------------------------------------------------
-- 2. The agent's report. A READING, never a disposition (ruling 2).
-- ---------------------------------------------------------------------------
create table if not exists public.requirement_agent_reports (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- The deterministic engine's answer at the moment of the run, kept whole so
  -- the narrative can be audited against what it was written over.
  findings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(findings) = 'array'),
  finding_count int not null default 0 check (finding_count >= 0),
  requirement_count int not null default 0 check (requirement_count >= 0),
  by_family jsonb not null default '{}'::jsonb
    check (jsonb_typeof(by_family) = 'object'),
  -- Bounded at the DATABASE. The RPC refuses over-length narratives by name;
  -- this CHECK is the backstop for every other writer, because the row is
  -- immutable, undeletable and readable by the whole organization.
  narrative text check (narrative is null or length(narrative) <= 6000),
  model text,
  agent_key text not null default 'sync-develop-requirements'
    check (btrim(agent_key) <> ''),
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- THE COLUMNS THAT ARE NOT HERE. No verification status, no result, no
  -- outcome, no approval, no disposition. A requirements agent that could
  -- store the string 'verified' anywhere would eventually have it read as
  -- one. `advisory` is pinned true so a later migration adding a decision
  -- column has to argue with this constraint first.
  advisory boolean not null default true,
  constraint requirement_agent_report_is_advisory check (advisory)
);

-- Idempotent for a database where the table already exists from an earlier
-- run (create table if not exists skips the column CHECK).
do $narrative$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.requirement_agent_reports'::regclass
                   and conname = 'requirement_agent_report_narrative_bounded') then
    alter table public.requirement_agent_reports
      add constraint requirement_agent_report_narrative_bounded
      check (narrative is null or length(narrative) <= 6000);
  end if;
end
$narrative$;

create index if not exists idx_requirement_agent_reports_case
  on requirement_agent_reports(organization_id, development_case_id, created_at desc);

alter table public.requirement_agent_reports enable row level security;
drop policy if exists requirement_agent_reports_read on public.requirement_agent_reports;
create policy requirement_agent_reports_read on public.requirement_agent_reports
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 3. Provenance backstop — INSERT / UPDATE / DELETE / TRUNCATE.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_requirement_agent_report_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.requirement_agent_report_write', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'requirement_agent_reports is the dated record of what the agent said and when. Truncating it erases every reading in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    -- Mid-cascade: a declared parent is already gone.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'A requirements agent report is a dated reading of the findings the deterministic engine returned. It is not deleted.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception
      'A requirements agent report is immutable. Run the agent again — a second reading dated now is honest; an edited one dated then is not.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marker <> 'granted' then
    raise exception
      'A requirements agent report cannot be written directly: record_requirements_agent_report is the path, and it takes the finding counts from get_case_requirement_findings rather than from its caller.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_requirement_agent_report_provenance()
  from public, anon, authenticated;

drop trigger if exists trg_requirement_agent_report_provenance on public.requirement_agent_reports;
create trigger trg_requirement_agent_report_provenance
  before insert or update or delete on public.requirement_agent_reports
  for each row execute function public.enforce_requirement_agent_report_provenance();

drop trigger if exists trg_requirement_agent_report_no_truncate on public.requirement_agent_reports;
create trigger trg_requirement_agent_report_no_truncate
  before truncate on public.requirement_agent_reports
  for each statement execute function public.enforce_requirement_agent_report_provenance();

revoke truncate on table public.requirement_agent_reports from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. record_requirements_agent_report — the agent's ONLY write.
--
--    The caller supplies a NARRATIVE and, optionally, semantic-inconsistency
--    candidates. Nothing else it sends is trusted:
--
--      * every finding count and every deterministic finding is read HERE
--        from get_case_requirement_findings;
--      * an AI finding whose requirement reference does not resolve on THIS
--        case is DROPPED and REPORTED — not mapped onto the nearest match,
--        because mapping 'PR-14' onto 'PR-014' inside a governance model is a
--        silent guess (the parseFrameworkProposal ruling);
--      * `source` on every AI finding is written as 'ai_suggestion' from a
--        SQL literal. The payload's own source field, if it carries one, is
--        never read — so a model cannot label its own output deterministic;
--      * `severity` on an AI finding is fixed at 'attention'. A model does
--        not get to mark its own guess blocking.
--
--    The AI-operator identity is ADMITTED here. This is the act §59 describes,
--    and it is the only door in this slice that admits it.
-- ---------------------------------------------------------------------------
create or replace function public.record_requirements_agent_report(
  p_case_id uuid,
  p_narrative text default null,
  p_model text default null,
  p_ai_findings jsonb default '[]'::jsonb
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
  v_findings jsonb;
  v_ai jsonb := '[]'::jsonb;
  v_dropped jsonb := '[]'::jsonb;
  v_all jsonb;
  x jsonb;
  v_ref_a text;
  v_ref_b text;
  v_concern text;
  v_id_a bigint;
  v_id_b bigint;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a requirements agent reading requires a governance, engineering, planning or AI-operator role — a report row carries an agent key, a model and a narrative, and is rendered as the agent''s reading of the requirement set');
  end if;
  if coalesce(length(p_narrative), 0) > 6000 then
    return jsonb_build_object('error',
      format('the narrative is %s characters; a requirements reading is capped at 6000 because the row is immutable, undeletable and readable by the whole organization', length(p_narrative)));
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- THE DETERMINISTIC ENGINE, read here rather than accepted from the caller.
  v_findings := get_case_requirement_findings(c.id);
  if v_findings ? 'error' then
    return v_findings;
  end if;
  if coalesce((v_findings->>'refused')::boolean, false) then
    -- RULING 4. A report over an empty requirement set is not recorded at
    -- all: a dated row saying "0 findings" would outlive the refusal that
    -- produced it and be cited as a clean reading.
    return jsonb_build_object('error', v_findings->>'refusal');
  end if;

  if p_ai_findings is not null and jsonb_typeof(p_ai_findings) = 'array' then
    for x in select * from jsonb_array_elements(p_ai_findings) loop
      v_ref_a := nullif(btrim(coalesce(x->>'requirement_ref','')), '');
      v_ref_b := nullif(btrim(coalesce(x->>'related_requirement_ref','')), '');
      v_concern := nullif(btrim(coalesce(x->>'concern','')), '');
      v_id_a := null;
      v_id_b := null;
      if v_ref_a is not null then
        select d.id into v_id_a from design_requirements d
         where d.development_case_id = c.id and d.requirement_ref = v_ref_a;
      end if;
      if v_ref_b is not null then
        select d.id into v_id_b from design_requirements d
         where d.development_case_id = c.id and d.requirement_ref = v_ref_b;
      end if;
      if v_concern is null or v_id_a is null then
        v_dropped := v_dropped || jsonb_build_object(
          'requirementRef', v_ref_a, 'relatedRequirementRef', v_ref_b,
          'reason', case when v_concern is null
            then 'no concern was stated — a finding with no statement of what is wrong is not a finding'
            else format('requirement reference "%s" does not resolve on this case; it was DROPPED rather than matched to the nearest reference', coalesce(v_ref_a, '(none)')) end);
      else
        v_ai := v_ai || jsonb_build_object(
          'family', 'inconsistent',
          'subFamily', 'semantic_inconsistency',
          -- FIXED IN SQL. The payload's own source and severity are never
          -- read: a model does not label its own output deterministic, and it
          -- does not mark its own guess blocking.
          'source', 'ai_suggestion',
          'severity', 'attention',
          'aiGenerated', true,
          'requirementId', v_id_a,
          'requirementRef', v_ref_a,
          'relatedRequirementId', v_id_b,
          'relatedRequirementRef', v_ref_b,
          'detail', left(v_concern, 1000));
      end if;
    end loop;
  end if;

  v_all := coalesce(v_findings->'findings', '[]'::jsonb) || v_ai;

  perform set_config('app.requirement_agent_report_write', 'granted', true);
  insert into requirement_agent_reports
    (organization_id, development_case_id, findings, finding_count,
     requirement_count, by_family, narrative, model, requested_by)
  values
    (v_org, c.id, v_all, jsonb_array_length(v_all),
     coalesce((v_findings->>'requirementCount')::int, 0),
     coalesce(v_findings->'byFamily', '{}'::jsonb)
       || jsonb_build_object('semanticInconsistencyAiSuggested', jsonb_array_length(v_ai)),
     nullif(btrim(coalesce(p_narrative, '')), ''),
     nullif(btrim(coalesce(p_model, '')), ''),
     auth.uid())
  returning id into v_id;
  perform set_config('app.requirement_agent_report_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'requirement_agent_report', coalesce(v_role, 'unknown'),
    jsonb_build_object('report_id', v_id, 'case_id', c.id,
      'requirement_count', v_findings->'requirementCount',
      'finding_count', jsonb_array_length(v_all),
      'ai_suggested', jsonb_array_length(v_ai),
      'ai_dropped', jsonb_array_length(v_dropped),
      'advisory', true, 'may_verify', false),
    jsonb_build_object('advisory', true));

  return jsonb_build_object(
    'report_id', v_id,
    'caseId', c.id,
    'requirementCount', v_findings->'requirementCount',
    'findingCount', jsonb_array_length(v_all),
    'byFamily', v_findings->'byFamily',
    'headline', v_findings->>'headline',
    'aiSuggestedCount', jsonb_array_length(v_ai),
    'aiDropped', v_dropped,
    'refusals', coalesce(v_findings->'refusals', '[]'::jsonb),
    'advisory', true,
    'disclaimer', 'A reading of the requirement set, not a disposition on it. The AI cannot verify a requirement, close an obligation or record a verification result (spec §70): create_requirement_verification and record_verification_result both refuse this identity by name, and the persistence wall refuses a verification attributed to it for every writer.');
end
$$;

revoke all on function public.record_requirements_agent_report(uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_requirements_agent_report(uuid, text, text, jsonb) to authenticated, service_role;

comment on function public.record_requirements_agent_report(uuid, text, text, jsonb) is
  'D12.09 / spec §59: the Requirements Agent''s ONLY write. Every deterministic finding and every count is read inside this function from get_case_requirement_findings; caller-supplied semantic findings are labelled ai_suggestion from a SQL literal, capped at severity attention, and DROPPED-and-REPORTED when their requirement reference does not resolve. No column of requirement_agent_reports can hold a verification status.';

-- ---------------------------------------------------------------------------
-- 5. The dated history, beside the live answer.
-- ---------------------------------------------------------------------------
create or replace function public.get_requirement_agent_reports(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  return jsonb_build_object(
    'caseId', c.id,
    -- The LIMIT lives in the row subquery, not beside the aggregate: a LIMIT
    -- on an aggregating select caps the one row it returns and silently caps
    -- nothing at all (the get_gate_agent_reports ruling).
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'asAt', r.created_at,
        'requirementCount', r.requirement_count,
        'findingCount', r.finding_count,
        'byFamily', r.by_family,
        'findings', r.findings,
        'narrative', r.narrative,
        'model', r.model,
        'agentKey', r.agent_key,
        'advisory', r.advisory,
        'requestedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = r.requested_by))
        order by r.created_at desc)
      from (
        select * from requirement_agent_reports r2
        where r2.organization_id = v_org and r2.development_case_id = c.id
        order by r2.created_at desc
        limit 50
      ) r), '[]'::jsonb));
end
$$;

revoke all on function public.get_requirement_agent_reports(uuid) from public, anon;
grant execute on function public.get_requirement_agent_reports(uuid) to authenticated;

notify pgrst, 'reload schema';
