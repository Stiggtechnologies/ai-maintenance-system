-- ============================================================================
-- C5.24 — assumptions become a governed part of the ONE recommendation
-- contract.
--
-- A recommendation may legitimately have no material assumptions. What is not
-- legitimate is silently treating an unexamined blank as “none”. The packet
-- therefore records one of two named-human dispositions:
--   * recorded: one or more explicit assumptions, each with its basis,
--     consequence if wrong and validation method;
--   * none_identified: an explicit, substantive basis for that assessment.
--
-- Canonical reuse: recommendations, recommendation_contract_gaps(),
-- check_recommendation_contract(), get_recommendation_contract_posture(),
-- user_profiles and audit_events. No parallel recommendation, approval,
-- evidence, queue, workflow or audit model is introduced.
-- ============================================================================

alter table public.recommendations
  add column if not exists assumption_packet jsonb,
  -- Deliberately no FK: audit attribution must survive identity off-boarding.
  add column if not exists assumptions_recorded_by uuid,
  add column if not exists assumptions_recorded_at timestamptz,
  add column if not exists assumption_context_digest text;

-- One definition is shared by the writer, the persistence constraint, the
-- approval preflight, the trigger path and the posture report.
create or replace function public.recommendation_assumption_packet_valid(
  p_packet jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_disposition text;
  v_items jsonb;
  v_item jsonb;
begin
  if p_packet is null or jsonb_typeof(p_packet) <> 'object' then
    return false;
  end if;

  v_disposition := p_packet->>'disposition';
  v_items := p_packet->'items';

  if v_disposition not in ('recorded', 'none_identified')
     or public.contract_narrative_blank(p_packet->>'basis')
     or v_items is null
     or jsonb_typeof(v_items) <> 'array' then
    return false;
  end if;

  if v_disposition = 'none_identified' then
    return jsonb_array_length(v_items) = 0;
  end if;

  if jsonb_array_length(v_items) = 0 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or public.contract_narrative_blank(v_item->>'statement')
       or public.contract_narrative_blank(v_item->>'basis')
       or public.contract_narrative_blank(v_item->>'consequence_if_wrong')
       or public.contract_narrative_blank(v_item->>'validation_method') then
      return false;
    end if;
  end loop;

  return true;
end
$$;

comment on function public.recommendation_assumption_packet_valid(jsonb) is
  'C5.24 single packet predicate used by every recommendation release surface. A blank is not a none-identified assessment.';

-- Bind the human judgement to the exact recommendation and the current
-- evidence packet. A later edit or evidence change does not silently inherit
-- an answer made about an older decision basis: the stored digest goes stale
-- and every release surface blocks until the packet is reassessed.
create or replace function public.recommendation_assumption_context_digest(
  p_organization_id uuid,
  p_recommendation_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.recommendations%rowtype;
  v_payload jsonb;
begin
  select * into r from public.recommendations
  where id = p_recommendation_id and organization_id = p_organization_id;
  if not found then return null; end if;

  v_payload := jsonb_build_object(
    'recommendationId', r.id,
    'assetId', r.asset_id,
    'riskId', r.risk_id,
    'title', r.title,
    'issue', r.issue,
    'action', r.action,
    'impact', r.impact,
    'confidence', r.confidence,
    'rationale', r.rationale,
    'consequenceSummary', r.consequence_summary,
    'alternativesConsidered', r.alternatives_considered,
    'requiredCompletionDate', r.required_completion_date,
    'requiredApproverRole', r.required_approver_role,
    'verificationMethod', r.verification_method,
    'evidencePacketDigest', public.recommendation_evidence_packet_digest(
      r.organization_id, r.id
    )
  );
  return encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
end
$$;

revoke all on function public.recommendation_assumption_context_digest(uuid, uuid)
  from public, anon, authenticated, service_role;

alter table public.recommendations
  drop constraint if exists recommendations_assumption_packet_shape_check;
alter table public.recommendations
  add constraint recommendations_assumption_packet_shape_check check (
    (assumption_packet is null
      and assumptions_recorded_by is null
      and assumptions_recorded_at is null
      and assumption_context_digest is null)
    or
    (public.recommendation_assumption_packet_valid(assumption_packet)
      and assumptions_recorded_by is not null
      and assumptions_recorded_at is not null
      and assumption_context_digest ~ '^[0-9a-f]{64}$')
  );

-- Provenance is written only by the governed RPC below. This blocks a direct
-- PostgREST update from forging either the judgement or its author.
create or replace function public.enforce_recommendation_assumption_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.recommendation_assumption_write', true) = 'granted' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assumption_packet is not null
       or new.assumptions_recorded_by is not null
       or new.assumptions_recorded_at is not null
       or new.assumption_context_digest is not null then
      raise exception
        'recommendation assumptions and their provenance are written only through record_recommendation_assumptions()'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.assumption_packet is distinct from old.assumption_packet
     or new.assumptions_recorded_by is distinct from old.assumptions_recorded_by
     or new.assumptions_recorded_at is distinct from old.assumptions_recorded_at
     or new.assumption_context_digest is distinct from old.assumption_context_digest then
    raise exception
      'recommendation assumptions and their provenance are written only through record_recommendation_assumptions()'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_recommendation_assumption_provenance
  on public.recommendations;
create trigger trg_recommendation_assumption_provenance
  before insert or update of assumption_packet, assumptions_recorded_by,
    assumptions_recorded_at, assumption_context_digest
  on public.recommendations
  for each row execute function public.enforce_recommendation_assumption_provenance();

create or replace function public.record_recommendation_assumptions(
  p_recommendation_id uuid,
  p_packet jsonb,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_rec public.recommendations%rowtype;
  v_previous jsonb;
  v_digest text;
  v_context_digest text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;

  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording recommendation assumptions is a named-human engineering judgement — the AI may propose assumptions but may not attest the organization examined them');
  end if;
  if coalesce(v_role, '') not in (
    'reliability_engineer', 'maintenance_manager', 'executive', 'admin'
  ) then
    return jsonb_build_object('error',
      'recommendation assumptions require reliability engineering, maintenance management, executive or administrative authority');
  end if;

  select * into v_rec
  from public.recommendations
  where id = p_recommendation_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'recommendation not found');
  end if;
  if v_rec.status in ('approved', 'released', 'scheduled') then
    return jsonb_build_object('error',
      'an approved or released recommendation cannot have its assumption basis rewritten; return it to governed review and create a new decision basis');
  end if;
  if not public.recommendation_assumption_packet_valid(p_packet) then
    return jsonb_build_object('error',
      'the assumption packet is incomplete: state recorded or none_identified, give a substantive overall basis, and for every recorded assumption give a substantive statement, basis, consequence_if_wrong and validation_method');
  end if;
  if public.contract_narrative_blank(p_note) then
    return jsonb_build_object('error',
      'record why this assumption assessment is appropriate for this recommendation');
  end if;

  v_previous := v_rec.assumption_packet;
  v_digest := encode(extensions.digest(p_packet::text, 'sha256'), 'hex');
  v_context_digest := public.recommendation_assumption_context_digest(
    v_org, p_recommendation_id
  );

  perform set_config('app.recommendation_assumption_write', 'granted', true);
  update public.recommendations
  set assumption_packet = p_packet,
      assumptions_recorded_by = auth.uid(),
      assumptions_recorded_at = now(),
      assumption_context_digest = v_context_digest,
      updated_at = now()
  where id = p_recommendation_id and organization_id = v_org;
  perform set_config('app.recommendation_assumption_write', '', true);

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org,
    'recommendation_assumptions',
    v_role,
    jsonb_build_object(
      'recommendation_id', p_recommendation_id,
      'disposition', p_packet->>'disposition',
      'packet_sha256', v_digest,
      'context_sha256', v_context_digest,
      'note', btrim(p_note)
    ),
    v_previous,
    p_packet
  );

  return jsonb_build_object(
    'recommendationId', p_recommendation_id,
    'disposition', p_packet->>'disposition',
    'packetSha256', v_digest,
    'contextSha256', v_context_digest,
    'recordedBy', auth.uid(),
    'recordedAt', now()
  );
end
$$;

revoke all on function public.record_recommendation_assumptions(uuid, jsonb, text)
  from public, anon;
grant execute on function public.record_recommendation_assumptions(uuid, jsonb, text)
  to authenticated;

comment on function public.record_recommendation_assumptions(uuid, jsonb, text) is
  'C5.24 tenant-scoped named-human assumption assessment for the canonical recommendation. It does not approve, release or execute the recommendation.';

create or replace function public.get_recommendation_assumption_packet(
  p_recommendation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_rec public.recommendations%rowtype;
  v_name text;
  v_current_context_digest text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into v_rec
  from public.recommendations
  where id = p_recommendation_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'recommendation not found');
  end if;
  select coalesce(full_name, email) into v_name
  from public.user_profiles where id = v_rec.assumptions_recorded_by;
  v_current_context_digest := public.recommendation_assumption_context_digest(
    v_org, v_rec.id
  );

  return jsonb_build_object(
    'recommendationId', v_rec.id,
    'recommendationTitle', v_rec.title,
    'recommendationStatus', v_rec.status,
    'packet', v_rec.assumption_packet,
    'recordedBy', v_rec.assumptions_recorded_by,
    'recordedByName', v_name,
    'recordedAt', v_rec.assumptions_recorded_at,
    'storedContextDigest', v_rec.assumption_context_digest,
    'currentContextDigest', v_current_context_digest,
    'valid', public.recommendation_assumption_packet_valid(v_rec.assumption_packet)
      and v_rec.assumption_context_digest = v_current_context_digest,
    'boundary', 'Assumption assessment does not approve the recommendation, accept risk, release work or prove an outcome.',
    'operationalAuthorization', false
  );
end
$$;

revoke all on function public.get_recommendation_assumption_packet(uuid)
  from public, anon;
grant execute on function public.get_recommendation_assumption_packet(uuid)
  to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Release preflight: the exact existing contract plus C5.24. A packet is
-- binary — no amount of population elsewhere compensates for a missing or
-- malformed assumption assessment.
-- --------------------------------------------------------------------------
create or replace function public.check_recommendation_contract(
  p_recommendation_id uuid
)
returns table (
  releasable boolean,
  "missingFields" text[],
  completeness numeric,
  reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.recommendations%rowtype;
  v_missing text[] := '{}';
  v_present int := 0;
  v_total int := 12;
begin
  select * into r from public.recommendations
  where id = p_recommendation_id
    and organization_id = public.app_current_org();

  if not found then
    return query select false, array['(not found)']::text[], 0::numeric,
      'No such recommendation in this organization.'::text;
    return;
  end if;

  if r.asset_id is not null
     or (r.risk_id is not null and exists (
           select 1 from public.risks x
           where x.id = r.risk_id
             and x.organization_id = r.organization_id
             and x.context_id is not null))
  then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'asset/functional location or governed risk context (C8.11)'); end if;
  if not public.contract_field_blank(r.issue) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'current condition or problem (C8.12)'); end if;
  if not public.contract_field_blank(r.rationale) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'evidence used (C8.13)'); end if;
  if public.recommendation_assumption_packet_valid(r.assumption_packet)
     and r.assumption_context_digest = public.recommendation_assumption_context_digest(
       r.organization_id, r.id
     ) then
    v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'Assumptions and validation plan (C5.24): a blank is not an assessment; record explicit assumptions or a justified none-identified disposition'); end if;
  if not public.contract_field_blank(r.action) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'recommended action (C8.16)'); end if;
  if r.confidence is not null then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'confidence and uncertainty (C8.19)'); end if;
  if not public.contract_narrative_blank(r.consequence_summary) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'consequence — safety, environmental, production, financial (C8.15): approving without it is a judgement about cost with the benefit left blank'); end if;
  if not public.contract_narrative_blank(r.alternatives_considered) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'alternatives considered (C8.17): without it an approver cannot tell a recommendation from the only idea anybody had'); end if;
  if r.required_completion_date is not null then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'required completion date (C8.18): "soon" is not schedulable and can never be overdue'); end if;
  if not public.contract_field_blank(r.required_approver_role) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'required approver (C8.20): unstated, it defaults to whoever happens to be looking'); end if;
  if not public.contract_narrative_blank(r.verification_method) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'verification method (C8.21): without it the loop never closes and this returns next year'); end if;
  if not public.contract_field_blank(r.impact) then v_present := v_present + 1; end if;

  return query select
    array_length(v_missing, 1) is null,
    v_missing,
    round(v_present::numeric / v_total, 2),
    case when array_length(v_missing, 1) is null
      then 'Contract complete. Every field an approver needs is present.'
      else format(
        'NOT RELEASABLE — %s required field(s) missing. Completeness is %s%%, reported and deliberately not used as the gate: releasing is binary, and missing fields do not become acceptable by being outnumbered.',
        array_length(v_missing, 1), round(100.0 * v_present / v_total))
    end;
end
$$;

revoke all on function public.check_recommendation_contract(uuid)
  from public, anon;
grant execute on function public.check_recommendation_contract(uuid)
  to authenticated, service_role;

-- Trigger path. enforce_recommendation_contract() already delegates to this
-- function; replacing it is enough to make C5.24 unbypassable.
create or replace function public.recommendation_contract_gaps(
  r public.recommendations
)
returns text[]
language sql
stable
set search_path = public
as $$
  select array_remove(array[
    case when r.asset_id is null
      and not (r.risk_id is not null and exists (
        select 1 from public.risks x
        where x.id = r.risk_id
          and x.organization_id = r.organization_id
          and x.context_id is not null))
      then 'asset/functional location or governed risk context (C8.11)' end,
    case when public.contract_field_blank(r.issue)
      then 'current condition or problem (C8.12)' end,
    case when public.contract_field_blank(r.rationale)
      then 'evidence used (C8.13)' end,
    case when not public.recommendation_assumption_packet_valid(r.assumption_packet)
      or r.assumption_context_digest is distinct from
        public.recommendation_assumption_context_digest(r.organization_id, r.id)
      then 'Assumptions and validation plan (C5.24): a blank is not an assessment; record explicit assumptions or a justified none-identified disposition' end,
    case when public.contract_field_blank(r.action)
      then 'recommended action (C8.16)' end,
    case when r.confidence is null
      then 'confidence and uncertainty (C8.19)' end,
    case when public.contract_narrative_blank(r.consequence_summary)
      then 'consequence — safety, environmental, production, financial (C8.15): approving without it is a judgement about cost with the benefit left blank' end,
    case when public.contract_narrative_blank(r.alternatives_considered)
      then 'alternatives considered (C8.17): without it an approver cannot tell a recommendation from the only idea anybody had' end,
    case when r.required_completion_date is null
      then 'required completion date (C8.18): "soon" is not schedulable and can never be overdue' end,
    case when public.contract_field_blank(r.required_approver_role)
      then 'required approver (C8.20): unstated, it defaults to whoever happens to be looking' end,
    case when public.contract_narrative_blank(r.verification_method)
      then 'verification method (C8.21): without it the loop never closes and this returns next year' end
  ], null);
$$;

-- Backlog posture. Releasable/blocked still delegates to the preflight, so the
-- card cannot disagree with the trigger. C5.24 is visible as its own field.
drop function if exists public.get_recommendation_contract_posture();
create or replace function public.get_recommendation_contract_posture()
returns table (
  register text,
  label text,
  blocking boolean,
  populated bigint,
  total bigint,
  share numeric,
  releasable_rows bigint,
  blocked_rows bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select * from public.recommendations
    where organization_id = public.app_current_org()
  ),
  t as (select count(*) n from r),
  releasability as (
    select
      count(*) filter (where c.releasable) as ok,
      count(*) filter (where not c.releasable) as blocked
    from r, lateral check_recommendation_contract(r.id) c
  )
  select v.reg, v.lab, v.blk, v.pop, t.n,
         case when t.n > 0 then round(v.pop::numeric / t.n, 3) else 0 end,
         rel.ok, rel.blocked
  from t, releasability rel, lateral (values
    ('C8.11','Asset/functional location or governed risk context', true,
      (select count(*) from r where asset_id is not null
         or (r.risk_id is not null and exists (
              select 1 from public.risks x
              where x.id = r.risk_id
                and x.organization_id = r.organization_id
                and x.context_id is not null)))),
    ('C8.12','Current condition or problem', true,
      (select count(*) from r where not public.contract_field_blank(issue))),
    ('C8.13','Evidence used', true,
      (select count(*) from r where not public.contract_field_blank(rationale))),
    ('C5.24','Assumptions and validation plan', true,
      (select count(*) from r
       where public.recommendation_assumption_packet_valid(assumption_packet)
         and assumption_context_digest = public.recommendation_assumption_context_digest(
           organization_id, id
         ))),
    ('C8.15','Consequence: safety, environmental, production, financial', true,
      (select count(*) from r where not public.contract_narrative_blank(consequence_summary))),
    ('C8.16','Recommended action', true,
      (select count(*) from r where not public.contract_field_blank(action))),
    ('C8.17','Alternative actions considered', true,
      (select count(*) from r where not public.contract_narrative_blank(alternatives_considered))),
    ('C8.18','Required completion date', true,
      (select count(*) from r where required_completion_date is not null)),
    ('C8.19','Confidence and uncertainty', true,
      (select count(*) from r where confidence is not null)),
    ('C8.20','Required human approval (named authority)', true,
      (select count(*) from r where not public.contract_field_blank(required_approver_role))),
    ('C8.21','Method for verifying effectiveness', true,
      (select count(*) from r where not public.contract_narrative_blank(verification_method)))
  ) as v(reg, lab, blk, pop)
  order by 6, 1;
$$;

revoke all on function public.get_recommendation_contract_posture()
  from public, anon;
grant execute on function public.get_recommendation_contract_posture()
  to authenticated, service_role;

notify pgrst, 'reload schema';
