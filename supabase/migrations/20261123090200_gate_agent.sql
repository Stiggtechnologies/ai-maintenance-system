-- ============================================================================
-- Sync Develop Slice 3D — the Gate Agent (D12.08, spec III.§58).
--
-- §58: "continuously evaluates readiness and blockers; cannot approve".
--
-- THE HALF THAT ALREADY EXISTED, AND WHY THIS FILE IS SHORT. "Cannot approve"
-- is not built here because it is already built, four times over:
--   * record_case_gate_review refuses role 'ai_admin' by name;
--   * trg_gate_review_provenance refuses any client writing an outcome
--     directly, marker or no marker (20261101090300);
--   * trg_review_recorder_is_human (20261123090000) refuses a review
--     attributed to the AI-operator identity for EVERY writer, service
--     included;
--   * gate_review_sod_position reports the same refusal to the screen, and
--     open_gate_review / record_gate_review_outcome both act on it.
-- The gate agent composes with that. It gets no new privilege, no bypass and
-- no table that could be mistaken for a decision.
--
-- WHAT IS NEW: the agent's own report, and the discipline that a report is a
-- READING, not a verdict. gate_agent_reports has NO outcome column, NO
-- approval column and NO status a human could mistake for a determination.
-- It carries the readiness the shipped evaluator returned at a moment in
-- time, the blockers it named, and the agent's narrative over them.
--
-- SPEC AMBIGUITY RESOLVED (§58 says "continuously"). RULING: reports are
-- written on demand, not on a schedule. A pg_cron job writing a readiness
-- report per case per hour would fill the table with rows nobody read and,
-- worse, would make the agent's last run the thing people cite instead of the
-- live number the screen computes. "Continuously available" is satisfied by
-- get_gate_readiness being live on every load; the agent adds narrative when
-- someone asks for it. The register row states this rather than claiming a
-- scheduler that does not exist.
--
-- SPEC AMBIGUITY RESOLVED (does the report's readiness figure become a second
-- source of truth?). RULING: no, and the schema enforces it — the snapshot is
-- stored with the timestamp it was taken and every read of it is labelled
-- "as at". Nothing in the product consumes gate_agent_reports to decide
-- anything; the only consumer is the screen that renders it beside the live
-- number.
-- ============================================================================

create table if not exists public.gate_agent_reports (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  gate_id bigint not null references stage_gates(id) on delete cascade,
  -- The shipped evaluator's answer at the moment of the run. Kept whole so
  -- the narrative can be audited against what it was written over.
  readiness_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(readiness_snapshot) = 'object'),
  blockers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blockers) = 'array'),
  blocker_count int not null default 0 check (blocker_count >= 0),
  readiness_pct numeric check (readiness_pct is null
    or (readiness_pct >= 0 and readiness_pct <= 100)),
  blocked boolean not null,
  -- Bounded at the DATABASE, not only in the edge function that happens to
  -- slice(0, 6000) today. The RPC is granted to authenticated and enforced
  -- nothing, so any org member could persist an unbounded, immutable,
  -- undeletable, org-readable string. The RPC refuses over-length narratives
  -- by name; this CHECK is the backstop for every other writer.
  narrative text check (narrative is null or length(narrative) <= 6000),
  model text,
  agent_key text not null default 'sync-develop-gate'
    check (btrim(agent_key) <> ''),
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- THE COLUMNS THAT ARE NOT HERE. There is no outcome, no recommendation to
  -- proceed, no approval and no signature. A gate agent that could store the
  -- string 'proceed' anywhere would eventually have it read as one. `advisory`
  -- is pinned true by a CHECK so a later migration adding a decision column
  -- has to argue with this constraint first.
  advisory boolean not null default true,
  constraint gate_agent_report_is_advisory check (advisory)
);

-- Idempotent for a database where the table already exists from an earlier
-- run of this migration (create table if not exists skips the column CHECK).
do $narrative$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.gate_agent_reports'::regclass
                   and conname = 'gate_agent_report_narrative_bounded') then
    alter table public.gate_agent_reports
      add constraint gate_agent_report_narrative_bounded
      check (narrative is null or length(narrative) <= 6000);
  end if;
end
$narrative$;

create index if not exists idx_gate_agent_reports_gate
  on gate_agent_reports(organization_id, development_case_id, gate_id, created_at desc);

alter table public.gate_agent_reports enable row level security;
drop policy if exists gate_agent_reports_read on public.gate_agent_reports;
create policy gate_agent_reports_read on public.gate_agent_reports
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- The provenance backstop, INSERT / UPDATE / DELETE. A report is written by
-- its RPC or not at all, and it is never edited after the fact: a readiness
-- reading whose numbers can be revised later is not a reading.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_gate_agent_report_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.gate_agent_report_write', true), '');
begin
  if tg_op = 'DELETE' then
    -- Mid-cascade: a declared parent is already gone (the enforce_framework_
    -- immutability idiom, 20261101090100). Without this the `on delete
    -- cascade` on development_case_id promised a cleanup this branch forbade,
    -- so a case that had ever been read by the agent could not be deleted.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id)
       or not exists (select 1 from stage_gates where id = old.gate_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'A gate agent report is a dated reading of the readiness the evaluator returned. It is not deleted.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception
      'A gate agent report is immutable. Run the agent again — a second reading dated now is honest; '
      'an edited one dated then is not.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marker <> 'granted' then
    raise exception
      'A gate agent report cannot be written directly: record_gate_agent_report is the path, and it '
      'takes the readiness figures from the shipped evaluator rather than from its caller.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_gate_agent_report_provenance() from public, anon, authenticated;

drop trigger if exists trg_gate_agent_report_provenance on public.gate_agent_reports;
create trigger trg_gate_agent_report_provenance
  before insert or update or delete on public.gate_agent_reports
  for each row execute function public.enforce_gate_agent_report_provenance();

-- ---------------------------------------------------------------------------
-- THE REPORT ACT.
--
-- The caller supplies a NARRATIVE and nothing else that matters. Readiness,
-- blockers, the blocked verdict and the percentage are read HERE from
-- get_gate_readiness — the shipped evaluator — so an agent cannot report a
-- number it made up. That is the difference between an agent that reads the
-- gate and an agent that describes one.
--
-- The AI-operator identity is ADMITTED. This is the act §58 describes.
--
-- TWO THINGS THE FIRST VERSION GOT WRONG, BOTH FIXED HERE.
--
-- 1. AUTHORISATION WAS "HAS A PROFILE". `if v_role is null then forbidden` was
--    the entire check, so the lowest-privileged member of the organization
--    could author an immutable, undeletable row carrying an agent_key, a model
--    string and a narrative — rendered on the review screen under a bot icon
--    as the gate agent's reading. Every sibling RPC in this slice gates the
--    role; this one now does too, with the same set propose_framework_from_
--    document uses. requested_by is returned by get_gate_agent_reports so the
--    author is on the screen either way.
--
-- 2. THE RISK LADDER LEAKED AS A COUNT. This DEFINER function calls the
--    INVOKER evaluator, so get_gate_readiness ran with the definer's rights
--    and returned open_risk blockers for risks the CALLER may not read. The
--    first version stripped the risk's IDENTITY and kept its EXISTENCE, its
--    COUNT and the blocked/percentage figures computed over it — and persisted
--    blocker_count into an org-readable row. Redacting a name is not the
--    ladder; the ladder is about whether the reader learns a risk is there.
--    The blockers are now filtered through can_read_risk BEFORE anything else
--    happens to them. That is exact rather than approximate for two reasons:
--    can_read_risk resolves against auth.uid()/app_current_org() — JWT claims,
--    not the executing role — so it answers for the REQUESTER inside a
--    definer; and `blocked` and readinessPct are computed by the evaluator
--    from criteria alone (20261110090100:434), never from risks, so filtering
--    the risk family changes no number it did not own. The report a technician
--    gets is now the report get_gate_readiness would have given them.
-- ---------------------------------------------------------------------------
create or replace function public.record_gate_agent_report(
  p_case_id uuid,
  p_gate_id bigint,
  p_narrative text default null,
  p_model text default null
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
  g stage_gates%rowtype;
  v_readiness jsonb;
  v_blockers jsonb;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'recording a gate agent reading requires a governance, engineering or AI-operator role — a report row carries an agent key, a model and a narrative, and is rendered as the agent''s reading of the gate');
  end if;
  if coalesce(length(p_narrative), 0) > 6000 then
    return jsonb_build_object('error',
      format('the narrative is %s characters; a gate reading is capped at 6000 because the row is immutable, undeletable and readable by the whole organization', length(p_narrative)));
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  -- THE ONE EVALUATOR, then THE LADDER. This is a SECURITY DEFINER call into a
  -- SECURITY INVOKER function, so the readiness comes back with the definer's
  -- rights and its open_risk blockers are NOT sensitivity-filtered. They are
  -- filtered here, by can_read_risk, which answers for the REQUESTER even
  -- inside a definer because it resolves against the JWT claims rather than
  -- the executing role. A risk the caller may not read is DROPPED, not
  -- redacted: a redacted entry still tells the reader that something is there
  -- and how many, and existence is what the ladder withholds. The ones that
  -- survive still lose their titles, because the row itself is org-readable
  -- and the next reader may sit lower on the ladder than this one.
  v_readiness := get_gate_readiness(c.id, g.id);
  if v_readiness ? 'error' then
    return v_readiness;
  end if;

  select coalesce(jsonb_agg(
    case when x->>'type' = 'open_risk'
      then jsonb_build_object('type', 'open_risk', 'name',
             'A high or critical case risk is unresolved (identity withheld: the risk-sensitivity ladder applies to the risk register, not to this report)')
      else x end
    order by x->>'type'), '[]'::jsonb)
  into v_blockers
  from jsonb_array_elements(coalesce(v_readiness->'blockers', '[]'::jsonb)) x
  where x->>'type' <> 'open_risk'
     or can_read_risk(sync_text_as_uuid(x->>'id'));

  perform set_config('app.gate_agent_report_write', 'granted', true);
  insert into gate_agent_reports
    (organization_id, development_case_id, gate_id, readiness_snapshot,
     blockers, blocker_count, readiness_pct, blocked, narrative, model,
     requested_by)
  values
    (v_org, c.id, g.id,
     jsonb_build_object(
       'gateName', v_readiness->'gateName',
       'decisionType', v_readiness->'decisionType',
       'criteriaTotal', v_readiness->'criteriaTotal',
       'mandatoryTotal', v_readiness->'mandatoryTotal',
       'mandatoryMet', v_readiness->'mandatoryMet',
       'categories', v_readiness->'categories',
       'projection', v_readiness->'projection',
       'assurance', v_readiness->'assurance'),
       -- evidenceSummary IS DELIBERATELY NOT SNAPSHOTTED, for the reason
       -- open_gate_review gives for not snapshotting readiness at all. It
       -- counts evidence_items, which carry evidence_items_risk_sensitive
       -- (`risk_id is null or can_read_risk(risk_id)`) — a policy this DEFINER
       -- function does not run. Persisting the definer's count into an
       -- org-readable row would tell every member how much evidence the ladder
       -- hides from them, which is the leak the blocker filter above exists to
       -- close. Every other field here is derived from criteria, findings and
       -- reviews, which are org-scoped with no ladder above them. The live
       -- count is on the review pack, under the reader's own rights, which is
       -- where it belongs.
     v_blockers, jsonb_array_length(v_blockers),
     nullif(v_readiness->>'readinessPct','')::numeric,
     coalesce((v_readiness->>'blocked')::boolean, true),
     nullif(btrim(coalesce(p_narrative, '')), ''),
     nullif(btrim(coalesce(p_model, '')), ''),
     auth.uid())
  returning id into v_id;
  perform set_config('app.gate_agent_report_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'gate_agent_report', coalesce(v_role, 'unknown'),
    jsonb_build_object('report_id', v_id, 'case_id', c.id, 'gate_id', g.id,
      'gate', g.name, 'blocked', v_readiness->'blocked',
      'readiness_pct', v_readiness->'readinessPct',
      'blockers', jsonb_array_length(v_blockers),
      'advisory', true, 'may_approve', false),
    jsonb_build_object('advisory', true));

  return jsonb_build_object(
    'report_id', v_id,
    'gate', g.name,
    'blocked', coalesce((v_readiness->>'blocked')::boolean, true),
    'readinessPct', nullif(v_readiness->>'readinessPct','')::numeric,
    'blockers', v_blockers,
    'blockerCount', jsonb_array_length(v_blockers),
    'advisory', true,
    'disclaimer', 'This is a reading of the gate, not a decision on it. The AI cannot pass a gate (spec §70): record_case_gate_review refuses this identity, and so does the persistence boundary behind it.');
end
$$;

revoke all on function public.record_gate_agent_report(uuid, bigint, text, text) from public, anon;
grant execute on function public.record_gate_agent_report(uuid, bigint, text, text) to authenticated, service_role;

comment on function public.record_gate_agent_report(uuid, bigint, text, text) is
  'D12.08 / spec §58: the gate agent''s only write. Readiness, blockers and the blocked verdict are read from get_gate_readiness, never supplied by the caller; the risk family is counted without being named because a report row is org-readable. No column of gate_agent_reports can hold a decision.';

create or replace function public.get_gate_agent_reports(
  p_case_id uuid,
  p_gate_id bigint default null
)
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
    -- nothing at all.
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'gateId', r.gate_id,
        'gate', (select g.name from stage_gates g where g.id = r.gate_id),
        'asAt', r.created_at,
        'readinessPct', r.readiness_pct,
        'blocked', r.blocked,
        'blockerCount', r.blocker_count,
        'blockers', r.blockers,
        'narrative', r.narrative,
        'model', r.model,
        'agentKey', r.agent_key,
        'advisory', r.advisory,
        'requestedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = r.requested_by),
        'snapshot', r.readiness_snapshot)
        order by r.created_at desc)
      from (
        select * from gate_agent_reports r2
        where r2.organization_id = v_org and r2.development_case_id = c.id
          and (p_gate_id is null or r2.gate_id = p_gate_id)
        order by r2.created_at desc
        limit 50
      ) r), '[]'::jsonb));
end
$$;

revoke all on function public.get_gate_agent_reports(uuid, bigint) from public, anon;
grant execute on function public.get_gate_agent_reports(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
