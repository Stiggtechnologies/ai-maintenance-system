-- ============================================================================
-- Sync Develop Slice 3D — the Methodology Agent (D12.06, spec III.§56).
--
-- WHAT §56 ASKS FOR: "ingests framework documents → proposes stages / gates /
-- requirements / authority maps; human-approved".
--
-- THE SHAPE OF THE ANSWER. The agent does not get a private store to write
-- opinions into. It writes a DRAFT ProjectFramework on the ONE framework
-- family — real stages, real gates, real requirements — through the SAME
-- authoring RPCs a human uses, and every requirement it proposes is stamped
-- AI_SUGGESTION, the lowest of the eight D3.14 provenance tiers. A draft
-- framework governs nothing. It starts governing when a human adopts it, and
-- adopt_project_framework refuses the AI-operator identity by name
-- (20261123090000 §8). That is the whole §70 boundary for this agent, and it
-- is a database boundary, not a UI one.
--
-- WHY NOT A PROPOSAL TABLE WITH ITS OWN 'adopted' COLUMN. Because then two
-- rows would answer "is this framework in force?" — the proposal's status and
-- project_frameworks.status — and the day they disagreed the product would
-- have to pick one. framework_proposals records the INGESTION (which document,
-- which agent, which model, what the agent said, who ran it); adoption is read
-- LIVE from the framework itself. One answer, one place.
--
-- SPEC AMBIGUITY RESOLVED (§56 says the agent proposes "authority maps" too).
-- RULING: NOT built here. Authority is authority_limits + governance rule sets
-- (D3.34/D3.03, ruling 14), a family with its own adoption ceremony,
-- versioning and composite conditions. A framework proposal that also minted
-- authority rows would be one agent writing into two governance families
-- through one act. The register row records this as the named residual rather
-- than claiming a coverage this file does not have.
--
-- SPEC AMBIGUITY RESOLVED (does "ingests documents" mean the agent parses the
-- PDF itself?). RULING: no new ingestion rail. The document must already be in
-- kb_intake_documents — the governed import door every other document in the
-- product comes through. The agent reads it there; it does not open a second
-- way into the tenant's corpus.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The ingestion record.
-- ---------------------------------------------------------------------------
create table if not exists public.framework_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- The governed import door. A proposal always names the document it read.
  document_id uuid not null references kb_intake_documents(id) on delete cascade,
  -- The DRAFT framework this proposal materialized. Adoption status is read
  -- from this row, never duplicated here.
  framework_id uuid not null references project_frameworks(id) on delete cascade,
  -- Which agent, which model. "The methodology agent proposed it" is only
  -- checkable if the run is named.
  agent_key text not null default 'sync-develop-methodology'
    check (btrim(agent_key) <> ''),
  model text,
  -- The agent's own structured output, kept verbatim so the draft can be
  -- audited against what was actually proposed.
  proposal jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proposal) = 'object'),
  summary text not null check (btrim(summary) <> ''),
  -- Who ran the agent. A proposal nobody asked for is a proposal nobody owns.
  proposed_by uuid not null references auth.users(id),
  status text not null default 'proposed' check (status in ('proposed','withdrawn')),
  withdrawn_reason text,
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  constraint framework_proposal_withdrawal check (
    status <> 'withdrawn'
    or (btrim(coalesce(withdrawn_reason, '')) <> '' and withdrawn_at is not null)
  )
);

create index if not exists idx_framework_proposals_org
  on framework_proposals(organization_id, status, created_at desc);
create unique index if not exists idx_framework_proposals_framework
  on framework_proposals(framework_id);

alter table public.framework_proposals enable row level security;
drop policy if exists framework_proposals_read on public.framework_proposals;
create policy framework_proposals_read on public.framework_proposals
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 2. THE §70 WALL. A proposal row may never be attached to a framework that
--    is already in force, and it may never be written by anything but the
--    RPCs below. Covers INSERT, UPDATE and DELETE: a proposal deleted after
--    adoption would erase the fact that a machine drafted what now governs
--    the tenant's gates, which is the single most important thing the row
--    records.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_framework_proposal_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.framework_proposal_write', true), '');
  f project_frameworks%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Mid-cascade: a declared parent is already gone, so an `on delete
    -- cascade` is collecting this row. The refusal below is for a delete aimed
    -- at the proposal itself. Without this the FK promised a cleanup the
    -- trigger forbade, and the parent could never be deleted at all (the
    -- enforce_framework_immutability idiom, 20261101090100).
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from project_frameworks where id = old.framework_id)
       or not exists (select 1 from kb_intake_documents where id = old.document_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'A framework proposal is the record that a machine drafted a governance model. It is not '
        'deleted — withdraw it with a stated reason (withdraw_framework_proposal), which keeps the '
        'record of what was proposed and why it was dropped.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if v_marker <> 'granted' then
    raise exception
      'A framework proposal cannot be written directly: propose_framework_from_document and '
      'withdraw_framework_proposal are the paths, and each names the document, the agent and the human.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into f from project_frameworks where id = new.framework_id;
  if not found or f.organization_id <> new.organization_id then
    raise exception
      'A framework proposal names a draft framework of its own organization.'
      using errcode = 'check_violation';
  end if;
  -- On INSERT only: a proposal is born against a DRAFT. An existing proposal
  -- is untouched when the human later adopts its framework — that transition
  -- is exactly what the row exists to have preceded.
  if tg_op = 'INSERT' and f.status <> 'draft' then
    raise exception
      'A machine proposal attaches to a DRAFT framework. Framework "%" is already %, and a proposal '
      'recorded against something already in force would read as if the machine had adopted it (spec §70).',
      f.name, f.status
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_framework_proposal_provenance() from public, anon, authenticated;

drop trigger if exists trg_framework_proposal_provenance on public.framework_proposals;
create trigger trg_framework_proposal_provenance
  before insert or update or delete on public.framework_proposals
  for each row execute function public.enforce_framework_proposal_provenance();

-- ---------------------------------------------------------------------------
-- 3. THE PROPOSAL ACT.
--
--    Every structural write goes through the EXISTING authoring RPCs —
--    create_project_framework, add_framework_stage, add_framework_gate,
--    set_gate_requirement — so every refusal those already make (unknown
--    stage_key, non-draft framework, missing instrument at a high tier,
--    non-positive weight, provenance escalation) applies to a machine
--    proposal unchanged. This function adds validation the agent path needs
--    and takes none away.
--
--    THE TIER IS NOT THE AGENT'S TO CHOOSE. p_proposal may carry whatever it
--    likes; every requirement is written at AI_SUGGESTION. That is D3.14's
--    "provenance tag on every INGESTED requirement" with an ingestion path
--    behind it, and it is why a proposed requirement can never quietly arrive
--    wearing REGULATION. That sentence was only true of THIS function until
--    20261123090500 capped set_gate_requirement itself: the AI-operator
--    identity could call the authoring RPC directly and mint a MANDATORY
--    REGULATION-tier requirement on any draft framework, which is also how
--    promote_requirement_authority's human-only tier RAISE was defeated
--    (nothing needs raising if it starts at the top). The cap lives at the
--    authoring act now, where every caller meets it.
--
--    THE NAME IS NOT THE AGENT'S TO CHOOSE EITHER, when it collides. The name
--    is model output and the model's only input is untrusted document text.
--    adopt_project_framework supersedes EVERY adopted framework sharing the
--    adopted one's name (20261123090000:963), and apply_case_governance
--    resolves tailoring rules by name + status='adopted'
--    (20261120090200:1119) — so a proposal that borrowed the name of a
--    framework already in force would, on adoption, silently replace the
--    tenant's live governance profile and re-point every rule naming it. With
--    is_mandatory and independent_assurance_required both defaulting FALSE on
--    a machine proposal, the replacement is systematically WEAKER than what it
--    replaced. Refused by name below; a human authoring a genuine successor
--    still has create_project_framework_version, which is a deliberate act on
--    a named source.
--
--    FAILURE IS WHOLE. A nested refusal RAISEs, so the transaction rolls back
--    and no half-built framework survives — a draft missing three of its
--    gates is worse than no draft, because it looks finished.
-- ---------------------------------------------------------------------------
create or replace function public.propose_framework_from_document(
  p_document_id uuid,
  p_proposal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_doc_title text;
  v_name text := btrim(coalesce(p_proposal->>'name', ''));
  v_basis text := btrim(coalesce(p_proposal->>'basis', ''));
  v_summary text := btrim(coalesce(p_proposal->>'summary', ''));
  v_stages jsonb := coalesce(p_proposal->'stages', '[]'::jsonb);
  v_gates jsonb := coalesce(p_proposal->'gates', '[]'::jsonb);
  v_reqs jsonb := coalesce(p_proposal->'requirements', '[]'::jsonb);
  v_framework_id uuid;
  v_proposal_id uuid;
  v_result jsonb;
  v_gate_ids jsonb := '{}'::jsonb;
  v_gate_id bigint;
  item jsonb;
  v_stage_count int := 0;
  v_gate_count int := 0;
  v_req_count int := 0;
  v_seq int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  -- The agent identity is ADMITTED here. Proposing is the act §56 describes;
  -- the boundary is adoption, and it lives in adopt_project_framework.
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'proposing a governance framework requires a governance, engineering or AI-operator role');
  end if;

  select title into v_doc_title from kb_intake_documents
  where id = p_document_id and organization_id = v_org;
  if v_doc_title is null then
    return jsonb_build_object('error',
      'document not found in this organization''s intake register — ingest it through the knowledge-base intake door first');
  end if;

  if jsonb_typeof(p_proposal) <> 'object' then
    return jsonb_build_object('error', 'the proposal must be a json object');
  end if;
  if length(v_name) < 3 then
    return jsonb_build_object('error', 'the proposed framework needs a name (3 characters minimum)');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('error',
      'state the basis: which parts of the document this framework was drawn from (20 characters minimum)');
  end if;
  if length(v_summary) < 20 then
    return jsonb_build_object('error',
      'state what this proposal says, in one paragraph a reviewer can read before opening the draft (20 characters minimum)');
  end if;
  if jsonb_typeof(v_stages) <> 'array' or jsonb_array_length(v_stages) = 0 then
    return jsonb_build_object('error',
      'a framework proposal names at least one stage — an empty framework governs nothing and could not be adopted anyway');
  end if;
  if jsonb_typeof(v_gates) <> 'array' or jsonb_array_length(v_gates) = 0 then
    return jsonb_build_object('error',
      'a framework proposal names at least one gate — a stage list with no decision point is not a governance model');
  end if;
  if jsonb_typeof(v_reqs) <> 'array' then
    return jsonb_build_object('error', 'requirements must be a json array (an empty array is allowed and means "no requirements proposed")');
  end if;
  -- The name collision, refused by name (see the header ruling). Checked
  -- BEFORE anything is written, so the common failure costs no rollback.
  if exists (select 1 from project_frameworks
             where organization_id = v_org and name = v_name and status = 'adopted') then
    return jsonb_build_object('error',
      format('"%s" is already the name of a framework this organization has ADOPTED. A proposal cannot take it: adopting a second framework under that name supersedes the one in force and re-points every tailoring rule that names it, which would replace the tenant''s live governance model without saying so. Propose it under its own name; a human versioning the existing model uses create_project_framework_version.', v_name));
  end if;

  -- Shape validation BEFORE anything is written, so the common failure costs
  -- no rollback and the message names the offending element.
  --
  -- EVERY NUMBER AND EVERY FLAG IS PARSED THROUGH sync_text_as_* (the
  -- 20261122090000 §0 helpers), never by a bare cast. p_proposal is caller JSON
  -- — model output in the agent path, arbitrary text over PostgREST — and a
  -- bare `::int` on "two" raised `invalid input syntax for type integer` AT THE
  -- USER, a raw 22P02 naming a Postgres type instead of the field. House law is
  -- that a refusal names what is wrong.
  for item in select * from jsonb_array_elements(v_stages) loop
    if coalesce(btrim(item->>'stage_key'), '') = '' then
      return jsonb_build_object('error', 'every proposed stage names a canonical stage_key');
    end if;
    v_seq := sync_text_as_int(nullif(item->>'sequence',''));
    if v_seq is null or v_seq < 1 then
      return jsonb_build_object('error',
        format('proposed stage "%s" carries no positive whole-number sequence (%s) — the order of stages is not something to infer later',
               item->>'stage_key', coalesce(nullif(item->>'sequence',''), 'none given')));
    end if;
  end loop;
  for item in select * from jsonb_array_elements(v_gates) loop
    if coalesce(length(btrim(coalesce(item->>'name',''))), 0) < 2 then
      return jsonb_build_object('error', 'every proposed gate is named');
    end if;
    if coalesce(btrim(item->>'stage_key'), '') = '' then
      return jsonb_build_object('error',
        format('proposed gate "%s" names no stage', item->>'name'));
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_stages) s
      where s->>'stage_key' = item->>'stage_key') then
      return jsonb_build_object('error',
        format('proposed gate "%s" sits on stage "%s", which this proposal does not define', item->>'name', item->>'stage_key'));
    end if;
    if nullif(item->>'sequence','') is not null
       and sync_text_as_int(item->>'sequence') is null then
      return jsonb_build_object('error',
        format('proposed gate "%s" carries a sequence that is not a whole number: %s', item->>'name', item->>'sequence'));
    end if;
    if nullif(item->>'readiness_threshold','') is not null
       and sync_text_as_numeric(item->>'readiness_threshold') is null then
      return jsonb_build_object('error',
        format('proposed gate "%s" carries a readiness_threshold that is not a number: %s', item->>'name', item->>'readiness_threshold'));
    end if;
    if nullif(item->>'independent_assurance_required','') is not null
       and sync_text_as_boolean(item->>'independent_assurance_required') is null then
      return jsonb_build_object('error',
        format('proposed gate "%s" carries an independent_assurance_required that is not true or false: %s',
               item->>'name', item->>'independent_assurance_required'));
    end if;
  end loop;
  for item in select * from jsonb_array_elements(v_reqs) loop
    if coalesce(length(btrim(coalesce(item->>'criterion',''))), 0) < 5 then
      return jsonb_build_object('error',
        'every proposed requirement states what must be established (5 characters minimum)');
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_gates) gg
      where gg->>'name' = item->>'gate') then
      return jsonb_build_object('error',
        format('proposed requirement "%s" is attached to gate "%s", which this proposal does not define',
               left(btrim(item->>'criterion'), 60), coalesce(item->>'gate', '(unnamed)')));
    end if;
    if nullif(item->>'is_mandatory','') is not null
       and sync_text_as_boolean(item->>'is_mandatory') is null then
      return jsonb_build_object('error',
        format('proposed requirement "%s" carries an is_mandatory that is not true or false: %s',
               left(btrim(item->>'criterion'), 60), item->>'is_mandatory'));
    end if;
    if nullif(item->>'minimum_confidence','') is not null
       and sync_text_as_numeric(item->>'minimum_confidence') is null then
      return jsonb_build_object('error',
        format('proposed requirement "%s" carries a minimum_confidence that is not a number: %s',
               left(btrim(item->>'criterion'), 60), item->>'minimum_confidence'));
    end if;
    if nullif(item->>'weight','') is not null
       and sync_text_as_numeric(item->>'weight') is null then
      return jsonb_build_object('error',
        format('proposed requirement "%s" carries a weight that is not a number: %s',
               left(btrim(item->>'criterion'), 60), item->>'weight'));
    end if;
    if nullif(item->>'sort_order','') is not null
       and sync_text_as_int(item->>'sort_order') is null then
      return jsonb_build_object('error',
        format('proposed requirement "%s" carries a sort_order that is not a whole number: %s',
               left(btrim(item->>'criterion'), 60), item->>'sort_order'));
    end if;
  end loop;

  -- Materialize, through the shipped authoring surface.
  v_result := create_project_framework(
    v_name,
    format('Proposed by the methodology agent from "%s"', v_doc_title),
    'AI_SUGGESTION',
    v_basis,
    coalesce(p_proposal->'project_classes', '[]'::jsonb));
  if v_result ? 'error' then
    raise exception 'framework proposal refused: %', v_result->>'error'
      using errcode = 'check_violation';
  end if;
  v_framework_id := (v_result->>'framework_id')::uuid;

  for item in select * from jsonb_array_elements(v_stages) loop
    v_result := add_framework_stage(
      v_framework_id, item->>'stage_key', sync_text_as_int(item->>'sequence'),
      coalesce(nullif(btrim(coalesce(item->>'display_name','')), ''), item->>'stage_key'),
      nullif(btrim(coalesce(item->>'purpose','')), ''),
      nullif(btrim(coalesce(item->>'entry_criteria','')), ''),
      nullif(btrim(coalesce(item->>'exit_criteria','')), ''));
    if v_result ? 'error' then
      raise exception 'framework proposal refused at stage "%": %',
        item->>'stage_key', v_result->>'error'
        using errcode = 'check_violation';
    end if;
    v_stage_count := v_stage_count + 1;
  end loop;

  for item in select * from jsonb_array_elements(v_gates) loop
    v_result := add_framework_gate(
      v_framework_id, item->>'stage_key', btrim(item->>'name'),
      coalesce(sync_text_as_int(nullif(item->>'sequence','')), 1),
      coalesce(nullif(btrim(coalesce(item->>'decision_type','')), ''), 'gate'),
      sync_text_as_numeric(nullif(item->>'readiness_threshold','')),
      coalesce(sync_text_as_boolean(nullif(item->>'independent_assurance_required','')), false),
      nullif(btrim(coalesce(item->>'risk_threshold','')), ''));
    if v_result ? 'error' then
      raise exception 'framework proposal refused at gate "%": %',
        item->>'name', v_result->>'error'
        using errcode = 'check_violation';
    end if;
    v_gate_ids := v_gate_ids || jsonb_build_object(btrim(item->>'name'), v_result->'gate_id');
    v_gate_count := v_gate_count + 1;
  end loop;

  for item in select * from jsonb_array_elements(v_reqs) loop
    v_gate_id := (v_gate_ids->>btrim(item->>'gate'))::bigint;
    -- is_mandatory DEFAULTS FALSE here, where set_gate_requirement's own
    -- default is true. A machine-proposed requirement that silently arrived
    -- MANDATORY would let an agent hard-block a gate at any percentage
    -- (D3.35) by writing a sentence. Mandatory-ness on an AI_SUGGESTION is a
    -- claim the proposal must make explicitly, and a human still has to adopt
    -- the framework before it means anything.
    v_result := set_gate_requirement(
      v_gate_id, btrim(item->>'criterion'),
      coalesce(sync_text_as_boolean(nullif(item->>'is_mandatory','')), false),
      -- THE TIER, FIXED. Not read from p_proposal.
      'AI_SUGGESTION',
      nullif(btrim(coalesce(item->>'category','')), ''),
      nullif(btrim(coalesce(item->>'evidence_type','')), ''),
      sync_text_as_numeric(nullif(item->>'minimum_confidence','')),
      nullif(btrim(coalesce(item->>'guidance','')), ''),
      coalesce(sync_text_as_int(nullif(item->>'sort_order','')), 100),
      coalesce(sync_text_as_numeric(nullif(item->>'weight','')), 1.0));
    if v_result ? 'error' then
      raise exception 'framework proposal refused at requirement "%": %',
        left(btrim(item->>'criterion'), 60), v_result->>'error'
        using errcode = 'check_violation';
    end if;
    v_req_count := v_req_count + 1;
  end loop;

  perform set_config('app.framework_proposal_write', 'granted', true);
  insert into framework_proposals
    (organization_id, document_id, framework_id, agent_key, model, proposal,
     summary, proposed_by)
  values
    (v_org, p_document_id, v_framework_id,
     coalesce(nullif(btrim(coalesce(p_proposal->>'agent_key','')), ''), 'sync-develop-methodology'),
     nullif(btrim(coalesce(p_proposal->>'model','')), ''),
     p_proposal, v_summary, auth.uid())
  returning id into v_proposal_id;
  perform set_config('app.framework_proposal_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'framework_proposal', coalesce(v_role, 'unknown'),
    jsonb_build_object('proposal_id', v_proposal_id, 'framework_id', v_framework_id,
      'document_id', p_document_id, 'document', v_doc_title, 'name', v_name,
      'stages', v_stage_count, 'gates', v_gate_count, 'requirements', v_req_count,
      'source_authority', 'AI_SUGGESTION', 'adopted', false),
    jsonb_build_object('status', 'proposed', 'framework_status', 'draft'));

  return jsonb_build_object(
    'proposal_id', v_proposal_id,
    'framework_id', v_framework_id,
    'framework_status', 'draft',
    'name', v_name,
    'stages', v_stage_count,
    'gates', v_gate_count,
    'requirements', v_req_count,
    'source_authority', 'AI_SUGGESTION',
    'note', 'This is a DRAFT and governs nothing. A human executive or administrator adopts it (adopt_project_framework); the AI-operator identity cannot.');
end
$$;

revoke all on function public.propose_framework_from_document(uuid, jsonb) from public, anon;
grant execute on function public.propose_framework_from_document(uuid, jsonb) to authenticated, service_role;

comment on function public.propose_framework_from_document(uuid, jsonb) is
  'D12.06 / spec §56: the methodology agent''s only write. Materializes a DRAFT ProjectFramework through the shipped authoring RPCs with every requirement stamped AI_SUGGESTION (D3.14). Adoption is a separate human act that refuses this identity.';

-- ---------------------------------------------------------------------------
-- 4. WITHDRAWAL. A proposal a human looked at and rejected is a fact.
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_framework_proposal(
  p_proposal_id uuid,
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
  p framework_proposals%rowtype;
  f project_frameworks%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'withdrawing a proposal is a human judgement about a machine''s work — the AI-operator identity cannot mark its own proposal dead any more than it can adopt it');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'withdrawing a framework proposal requires a governance or engineering role');
  end if;
  select * into p from framework_proposals where id = p_proposal_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'framework proposal not found');
  end if;
  if p.status <> 'proposed' then
    return jsonb_build_object('error', 'this proposal is already ' || p.status);
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    return jsonb_build_object('error',
      'state why this proposal is being withdrawn (10 characters minimum) — "the agent got it wrong" is the most valuable sentence in this table');
  end if;
  select * into f from project_frameworks where id = p.framework_id;
  if f.status <> 'draft' then
    return jsonb_build_object('error',
      format('framework "%s" has already been %s by a human — withdrawing the proposal now would suggest the adoption never happened', f.name, f.status));
  end if;

  perform set_config('app.framework_proposal_write', 'granted', true);
  update framework_proposals
  set status = 'withdrawn', withdrawn_reason = btrim(p_reason),
      withdrawn_by = auth.uid(), withdrawn_at = now()
  where id = p.id;
  perform set_config('app.framework_proposal_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'framework_proposal', coalesce(v_role, 'unknown'),
    jsonb_build_object('proposal_id', p.id, 'framework_id', p.framework_id,
      'reason', btrim(p_reason)),
    jsonb_build_object('status', 'proposed'),
    jsonb_build_object('status', 'withdrawn', 'withdrawn_by', auth.uid()));

  return jsonb_build_object('proposal_id', p.id, 'status', 'withdrawn');
end
$$;

revoke all on function public.withdraw_framework_proposal(uuid, text) from public, anon;
grant execute on function public.withdraw_framework_proposal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE READ. Proposals with their framework's LIVE status, plus the draft
--    frameworks a human authored by hand — one shelf, because "what can I
--    adopt?" is one question.
--
--    WHAT EACH DRAFT CARRIES, AND WHY COUNTS ALONE WERE NOT ENOUGH. The first
--    version returned stages/gates/requirements as count(*) and the
--    FRAMEWORK-level source_authority, and the adopt button sat next to those
--    three numbers. Adoption is the §70 human act in this whole slice — the
--    one thing the AI-operator identity is refused — and the human doing it
--    could not see what they were disposing of: not how many requirements are
--    MANDATORY (one mandatory requirement hard-blocks its gate at any
--    readiness percentage, D3.35), not how many gates demand INDEPENDENT
--    ASSURANCE, not which provenance tiers the requirements claim, and not
--    that adopting this draft SUPERSEDES a framework already in force under
--    the same name and re-points every tailoring rule that names it. All four
--    are returned now. A confirmation step that cannot state what changes is
--    a click, not a determination.
-- ---------------------------------------------------------------------------
create or replace function public.get_framework_shelf()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object(
    'proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'summary', p.summary,
        'agentKey', p.agent_key,
        'model', p.model,
        'status', p.status,
        'withdrawnReason', p.withdrawn_reason,
        'createdAt', p.created_at,
        'proposedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = p.proposed_by),
        'document', (select d.title from kb_intake_documents d where d.id = p.document_id),
        'documentId', p.document_id,
        'framework', jsonb_build_object(
          'id', f.id, 'name', f.name, 'version', f.version, 'status', f.status,
          'sourceAuthority', f.source_authority,
          'stages', (select count(*) from project_framework_stages s where s.framework_id = f.id),
          'gates', (select count(*) from stage_gates g where g.framework_id = f.id),
          'requirements', (select count(*) from stage_gate_criteria sc
                           join stage_gates g2 on g2.id = sc.gate_id where g2.framework_id = f.id),
          'mandatoryRequirements', (select count(*) from stage_gate_criteria sc
                           join stage_gates g2 on g2.id = sc.gate_id
                           where g2.framework_id = f.id and sc.is_mandatory),
          'independentAssuranceGates', (select count(*) from stage_gates g
                           where g.framework_id = f.id and g.independent_assurance_required),
          'requirementTiers', coalesce((
            select jsonb_object_agg(t.source_authority, t.n) from (
              select sc.source_authority, count(*) as n
              from stage_gate_criteria sc join stage_gates g2 on g2.id = sc.gate_id
              where g2.framework_id = f.id group by sc.source_authority) t), '{}'::jsonb),
          'willSupersede', (
            select jsonb_build_object('id', a.id, 'name', a.name, 'version', a.version,
                                      'sourceAuthority', a.source_authority, 'adoptedAt', a.adopted_at)
            from project_frameworks a
            where a.organization_id = v_org and a.name = f.name and a.status = 'adopted'
            order by a.version desc limit 1)))
        order by p.created_at desc)
      from framework_proposals p
      join project_frameworks f on f.id = p.framework_id
      where p.organization_id = v_org), '[]'::jsonb),
    'drafts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'version', f.version,
        'sourceAuthority', f.source_authority, 'source', f.source, 'basis', f.basis,
        'machineProposed', exists (select 1 from framework_proposals p2 where p2.framework_id = f.id),
        'stages', (select count(*) from project_framework_stages s where s.framework_id = f.id),
        'gates', (select count(*) from stage_gates g where g.framework_id = f.id),
        'requirements', (select count(*) from stage_gate_criteria sc
                         join stage_gates g2 on g2.id = sc.gate_id where g2.framework_id = f.id),
        -- What adoption actually arms. One mandatory requirement blocks its
        -- gate at any percentage; an independence flag changes who may record.
        'mandatoryRequirements', (select count(*) from stage_gate_criteria sc
                         join stage_gates g2 on g2.id = sc.gate_id
                         where g2.framework_id = f.id and sc.is_mandatory),
        'independentAssuranceGates', (select count(*) from stage_gates g
                         where g.framework_id = f.id and g.independent_assurance_required),
        'requirementTiers', coalesce((
          select jsonb_object_agg(t.source_authority, t.n) from (
            select sc.source_authority, count(*) as n
            from stage_gate_criteria sc join stage_gates g2 on g2.id = sc.gate_id
            where g2.framework_id = f.id group by sc.source_authority) t), '{}'::jsonb),
        -- What adoption REPLACES. Null when nothing is in force under this
        -- name; a whole framework identity when something is.
        'willSupersede', (
          select jsonb_build_object('id', a.id, 'name', a.name, 'version', a.version,
                                    'sourceAuthority', a.source_authority, 'adoptedAt', a.adopted_at)
          from project_frameworks a
          where a.organization_id = v_org and a.name = f.name and a.status = 'adopted'
          order by a.version desc limit 1))
        order by f.name, f.version)
      from project_frameworks f
      where f.organization_id = v_org and f.status = 'draft'), '[]'::jsonb),
    'adopted', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'version', f.version,
        'sourceAuthority', f.source_authority, 'adoptedAt', f.adopted_at,
        'adoptedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = f.adopted_by),
        'gates', (select count(*) from stage_gates g where g.framework_id = f.id))
        order by f.name)
      from project_frameworks f
      where f.organization_id = v_org and f.status = 'adopted'), '[]'::jsonb));
end
$$;

revoke all on function public.get_framework_shelf() from public, anon;
grant execute on function public.get_framework_shelf() to authenticated;

notify pgrst, 'reload schema';
