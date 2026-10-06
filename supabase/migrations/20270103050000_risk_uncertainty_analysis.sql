-- U18.02 — governed uncertainty-aware risk analysis.
--
-- Canonical reuse:
--   * risks and risk_criteria_profiles remain the risk and threshold truth;
--   * evidence_items remains the one evidence store;
--   * approvals and audit_events remain the authority and audit ledgers.
--
-- A validated packet means an independent human reviewed the exact inputs,
-- adopted threshold snapshot, derived results and linked evidence. It does not
-- accept risk, authorize operation, release work or commit spend.
-- Current-main draft composition after risk_decision_preview_context. This
-- migration remains unqualified until the complete-chain native/HTTP gates
-- pass. Post-wait checks do not freeze ancestor sensitivity/stakeholder
-- changes and are not a complete race qualification.

-- Forward-only repair of the single canonical VOI writer renamed by #561.
-- Preserve its exact calculation, receipt and evidence/audit writes; the only
-- behavioral delta rejects special NUMERIC values before calculation or DML.
-- Existing null/range refusals and the public role/visibility wrapper remain.
create or replace function public.record_risk_value_of_information_authoritative_internal(
  p_risk_id uuid,
  p_analysis jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  r risks%rowtype;
  v_information_cost numeric;
  v_decision_cost numeric;
  v_uncertainty_reduction numeric;
  v_change_probability numeric;
  v_expected numeric;
  v_net numeric;
  v_recommendation text;
  v_evidence uuid;
  v_result jsonb;
begin
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  v_information_cost:=nullif(p_analysis->>'information_cost','')::numeric;
  v_decision_cost:=nullif(p_analysis->>'decision_cost_if_wrong','')::numeric;
  v_uncertainty_reduction:=nullif(p_analysis->>'uncertainty_reduction','')::numeric;
  v_change_probability:=nullif(p_analysis->>'probability_decision_changes','')::numeric;
  if v_information_cost is null or v_decision_cost is null or
     v_uncertainty_reduction is null or v_change_probability is null or
     v_information_cost<0 or v_decision_cost<0 or
     v_uncertainty_reduction not between 0 and 1 or
     v_change_probability not between 0 and 1 then
    return jsonb_build_object('error','costs must be non-negative and probability inputs must be between 0 and 1');
  end if;
  if not public.sync_is_finite_numeric(v_information_cost)
     or not public.sync_is_finite_numeric(v_decision_cost)
     or not public.sync_is_finite_numeric(v_uncertainty_reduction)
     or not public.sync_is_finite_numeric(v_change_probability) then
    return jsonb_build_object('error','value-of-information inputs must be finite numbers');
  end if;
  if coalesce(length(btrim(p_analysis->>'information_action')),0)<10 then
    return jsonb_build_object('error','describe the inspection, test or enquiry being valued');
  end if;
  v_expected:=v_decision_cost*v_uncertainty_reduction*v_change_probability;
  v_net:=v_expected-v_information_cost;
  v_recommendation:=case when v_net>0 then 'GATHER_INFORMATION'
    else 'DECIDE_WITH_CURRENT_INFORMATION' end;
  v_result:=jsonb_build_object(
    'information_action',btrim(p_analysis->>'information_action'),
    'information_cost',v_information_cost,'decision_cost_if_wrong',v_decision_cost,
    'uncertainty_reduction',v_uncertainty_reduction,
    'probability_decision_changes',v_change_probability,
    'expected_value',round(v_expected,2),'net_value',round(v_net,2),
    'recommendation',v_recommendation,'currency',coalesce(p_analysis->>'currency',r.value_currency),
    'recorded_at',now(),'human_decision_required',true);
  update risks set value_of_information=v_result,updated_at=now() where id=r.id;
  insert into evidence_items(organization_id,risk_id,asset_id,source_system,evidence_type,
    description,confidence_contribution,data_quality,ts,signal_kind,source_reference,provenance)
  values(v_org,r.id,r.asset_id,'risk_operating_system','value_of_information',
    format('%s: expected information value %s, net %s. %s',v_recommendation,
      round(v_expected,2),round(v_net,2),btrim(p_analysis->>'information_action')),
    0,coalesce(r.data_quality,'unknown'),now(),'value_of_information',null,
    jsonb_build_object('calculation',v_result)) returning id into v_evidence;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_value_of_information',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'evidence_id',v_evidence,'result',v_result));
  return v_result || jsonb_build_object('evidence_id',v_evidence);
end;
$$;
revoke all on function public.record_risk_value_of_information_authoritative_internal(uuid, jsonb)
  from public, anon, authenticated, service_role;

create table if not exists public.risk_uncertainty_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  risk_id uuid not null references public.risks(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'pending_review'
    check (status in ('pending_review','validated','rejected','superseded')),
  method text not null check (length(btrim(method)) >= 3),
  basis text not null check (length(btrim(basis)) >= 20),
  probability_lower numeric not null check (probability_lower between 0 and 1),
  probability_central numeric not null check (probability_central between 0 and 1),
  probability_upper numeric not null check (probability_upper between 0 and 1),
  confidence_level numeric not null check (confidence_level > 0 and confidence_level <= 1),
  confidence_interval_lower numeric not null check (confidence_interval_lower between 0 and 1),
  confidence_interval_upper numeric not null check (confidence_interval_upper between 0 and 1),
  best_case_loss numeric not null check (best_case_loss >= 0),
  expected_case_loss numeric not null check (expected_case_loss >= 0),
  worst_case_loss numeric not null check (worst_case_loss >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  sensitivity_inputs jsonb not null check (jsonb_typeof(sensitivity_inputs)='array'),
  sensitivity_results jsonb not null check (jsonb_typeof(sensitivity_results)='array'),
  threshold_profile_id uuid not null references public.risk_criteria_profiles(id) on delete restrict,
  decision_thresholds jsonb not null check (jsonb_typeof(decision_thresholds)='object'),
  reassessment_triggers text[] not null,
  review_due_at timestamptz not null,
  voi_action text not null check (length(btrim(voi_action)) >= 10),
  voi_information_cost numeric not null check (voi_information_cost >= 0),
  voi_decision_cost_if_wrong numeric not null check (voi_decision_cost_if_wrong >= 0),
  voi_uncertainty_reduction numeric not null check (voi_uncertainty_reduction between 0 and 1),
  voi_probability_decision_changes numeric not null check (voi_probability_decision_changes between 0 and 1),
  voi_expected_value numeric not null check (voi_expected_value >= 0),
  voi_net_value numeric not null,
  voi_recommendation text not null
    check (voi_recommendation in ('GATHER_INFORMATION','DECIDE_WITH_CURRENT_INFORMATION')),
  analysis_digest text not null check (analysis_digest ~ '^[0-9a-f]{64}$'),
  -- Legacy coverage is explicit; never backfill today's dependencies as a
  -- historical submission snapshot. The governed writer always creates v2.
  digest_version integer not null default 1 check (digest_version in (1,2)),
  input_binding_snapshot jsonb,
  author_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewer_id uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  approval_id uuid references public.approvals(id) on delete restrict,
  derived_evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  operational_authorization boolean not null default false check (not operational_authorization),
  -- Replacement extends the canonical packet; there is no second intent store.
  replaces_analysis_id uuid,
  replacement_intent_id uuid,
  replacement_request_fingerprint text,
  replacement_compare_and_swap jsonb,
  replacement_reason text,
  superseded_by_analysis_id uuid,
  superseded_at timestamptz,
  superseded_by_user_id uuid references auth.users(id) on delete restrict,
  unique (organization_id,id),
  unique (organization_id,risk_id,id),
  unique (organization_id,risk_id,version),
  unique (organization_id,author_id,replacement_intent_id),
  unique (organization_id,risk_id,replaces_analysis_id),
  unique (organization_id,risk_id,superseded_by_analysis_id),
  foreign key (organization_id,risk_id,replaces_analysis_id)
    references public.risk_uncertainty_analyses(organization_id,risk_id,id)
    deferrable initially deferred,
  foreign key (organization_id,risk_id,superseded_by_analysis_id)
    references public.risk_uncertainty_analyses(organization_id,risk_id,id)
    deferrable initially deferred,
  constraint risk_uncertainty_replacement_metadata_check check (
    (replaces_analysis_id is null and replacement_intent_id is null
      and replacement_request_fingerprint is null and replacement_compare_and_swap is null
      and replacement_reason is null)
    or (replaces_analysis_id is not null and replaces_analysis_id<>id
      and replacement_intent_id is not null and replacement_request_fingerprint is not null
      and replacement_request_fingerprint ~ '^[0-9a-f]{64}$'
      and replacement_compare_and_swap is not null and jsonb_typeof(replacement_compare_and_swap)='object'
      and replacement_reason is not null and length(btrim(replacement_reason))>=20)
  ),
  constraint risk_uncertainty_supersession_metadata_check check (
    (status<>'superseded' and superseded_by_analysis_id is null
      and superseded_at is null and superseded_by_user_id is null)
    or (status='superseded' and superseded_by_analysis_id is not null
      and superseded_by_analysis_id<>id and superseded_at is not null
      and isfinite(superseded_at) and superseded_at>=created_at
      and superseded_by_user_id is not null and superseded_by_user_id=author_id)
  ),
  check (probability_lower <= probability_central and probability_central <= probability_upper),
  check (confidence_interval_lower <= confidence_interval_upper),
  check (best_case_loss <= expected_case_loss and expected_case_loss <= worst_case_loss),
  check (cardinality(reassessment_triggers) between 1 and 20),
  check (review_due_at > created_at),
  constraint risk_uncertainty_binding_snapshot_check check (
    (digest_version=1 and input_binding_snapshot is null)
    or (digest_version=2 and input_binding_snapshot is not null
      and jsonb_typeof(input_binding_snapshot)='object'
      and input_binding_snapshot->'digestVersion' is not distinct from '2'::jsonb
      and input_binding_snapshot->'bindingComplete' is not distinct from 'true'::jsonb)
  ),
  check (
    (status='pending_review' and reviewer_id is null and reviewed_at is null
      and review_note is null and approval_id is null and derived_evidence_item_id is null)
    or
    (status='superseded' and reviewer_id is null and reviewed_at is null
      and review_note is null and approval_id is null and derived_evidence_item_id is null)
    or
    (status in ('validated','rejected') and reviewer_id is not null
      and reviewer_id<>author_id and reviewed_at is not null
      and length(btrim(coalesce(review_note,'')))>=20 and approval_id is not null
      and (status='rejected' or derived_evidence_item_id is not null))
  )
);

create unique index if not exists idx_risk_uncertainty_one_pending
  on public.risk_uncertainty_analyses(organization_id,risk_id)
  where status='pending_review';
create index if not exists idx_risk_uncertainty_recent
  on public.risk_uncertainty_analyses(organization_id,risk_id,version desc);

create table if not exists public.risk_uncertainty_analysis_evidence (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.risk_uncertainty_analyses(id) on delete restrict,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (analysis_id,evidence_item_id)
);

alter table public.risk_uncertainty_analyses enable row level security;
alter table public.risk_uncertainty_analysis_evidence enable row level security;

drop policy if exists risk_uncertainty_select_org on public.risk_uncertainty_analyses;
create policy risk_uncertainty_select_org on public.risk_uncertainty_analyses
  for select to authenticated using (
    organization_id=public.app_current_org() and public.can_read_risk(risk_id)
  );
drop policy if exists risk_uncertainty_evidence_select_org on public.risk_uncertainty_analysis_evidence;
create policy risk_uncertainty_evidence_select_org on public.risk_uncertainty_analysis_evidence
  for select to authenticated using (
    organization_id=public.app_current_org() and exists (
      select 1 from public.risk_uncertainty_analyses a
      where a.id=risk_uncertainty_analysis_evidence.analysis_id
        and a.organization_id=public.app_current_org()
        and a.organization_id=risk_uncertainty_analysis_evidence.organization_id
        and public.can_read_risk(a.risk_id)
    )
  );

revoke all on public.risk_uncertainty_analyses from anon,authenticated,service_role;
revoke all on public.risk_uncertainty_analysis_evidence from anon,authenticated,service_role;
grant select on public.risk_uncertainty_analyses to authenticated;
grant select on public.risk_uncertainty_analysis_evidence to authenticated;

create or replace function public.enforce_risk_uncertainty_analysis_write()
returns trigger language plpgsql set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.risk_uncertainty_write',true),'');
begin
  if tg_op='DELETE' then
    raise exception 'risk uncertainty analyses are retained; record a new version';
  end if;
  if v_marker<>'granted' then
    raise exception 'risk uncertainty analysis changes require the governed submit and review functions';
  end if;
  if tg_op='INSERT' then
    if new.status is distinct from 'pending_review'
      or new.analysis_digest is distinct from repeat('0',64)
      or new.reviewer_id is not null or new.reviewed_at is not null
      or new.review_note is not null or new.approval_id is not null
      or new.derived_evidence_item_id is not null then
      raise exception 'risk uncertainty insertion requires an initial pending packet without review artifacts';
    end if;
  end if;
  if tg_op='UPDATE' then
    if old.status in ('validated','rejected','superseded') then
      raise exception 'reviewed risk uncertainty analysis history is immutable; submit a new version';
    end if;
    if new.status='superseded' then
      -- Only this branch may add the successor tuple. Every input, original
      -- digest, replacement intent and review artifact remains immutable.
      if old.status is distinct from 'pending_review' or old.analysis_digest=repeat('0',64)
        or new.superseded_by_analysis_id is null or new.superseded_by_analysis_id=old.id
        or new.superseded_at is null or new.superseded_by_user_id is distinct from old.author_id
        or old.superseded_by_analysis_id is not null or old.superseded_at is not null
        or old.superseded_by_user_id is not null
        or new.reviewer_id is not null or new.reviewed_at is not null
        or new.review_note is not null or new.approval_id is not null
        or new.derived_evidence_item_id is not null
        or (to_jsonb(new)-array['status','superseded_by_analysis_id','superseded_at','superseded_by_user_id'])
          is distinct from
          (to_jsonb(old)-array['status','superseded_by_analysis_id','superseded_at','superseded_by_user_id']) then
        raise exception 'risk uncertainty supersession must retain the exact submitted history and name its successor';
      end if;
      return new;
    end if;
    -- Every submitted identity, engineering input and future column is frozen.
    -- Only the one initialization and named-human review channels below differ.
    if (to_jsonb(new) - array['status','analysis_digest','reviewer_id','reviewed_at','review_note','approval_id','derived_evidence_item_id'])
      is distinct from
      (to_jsonb(old) - array['status','analysis_digest','reviewer_id','reviewed_at','review_note','approval_id','derived_evidence_item_id']) then
      raise exception 'submitted risk uncertainty analysis inputs are immutable; submit a new version';
    end if;
    if old.analysis_digest=repeat('0',64) then
      if old.status is distinct from 'pending_review'
        or new.status is distinct from 'pending_review'
        or new.analysis_digest=repeat('0',64)
        or new.analysis_digest is distinct from public.risk_uncertainty_analysis_digest(old.organization_id,old.id)
        or (old.digest_version=2 and new.analysis_digest is distinct from
          encode(extensions.digest(public.risk_uncertainty_v2_digest_payload(
            old,old.input_binding_snapshot)::text,'sha256'),'hex'))
        or new.reviewer_id is distinct from old.reviewer_id
        or new.reviewed_at is distinct from old.reviewed_at
        or new.review_note is distinct from old.review_note
        or new.approval_id is distinct from old.approval_id
        or new.derived_evidence_item_id is distinct from old.derived_evidence_item_id then
        raise exception 'risk uncertainty initial digest finalization must bind the exact pending inputs and evidence';
      end if;
    else
      if new.analysis_digest is distinct from old.analysis_digest then
        raise exception 'submitted risk uncertainty analysis digest is immutable; submit a new version';
      end if;
      if new is distinct from old and (
        old.status is distinct from 'pending_review'
        or new.status not in ('validated','rejected')
      ) then
        raise exception 'risk uncertainty lifecycle changes require the independent review transition';
      end if;
      -- The existing row CHECK requires the complete independent reviewer,
      -- date, substantive note, approval and validated calculated-evidence tuple.
      -- The sole public review RPC retains current role/tenant and self-review gates.
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_risk_uncertainty_analysis_write on public.risk_uncertainty_analyses;
create trigger trg_risk_uncertainty_analysis_write
  before insert or update or delete on public.risk_uncertainty_analyses
  for each row execute function public.enforce_risk_uncertainty_analysis_write();

-- Deferred reciprocal checks inspect the FINAL pair, not an intermediate NEW
-- row image. Increasing versions prevent cycles; uniqueness prevents forks.
create or replace function public.enforce_risk_uncertainty_replacement_pair()
returns trigger language plpgsql set search_path=public as $$
declare a public.risk_uncertainty_analyses%rowtype; p public.risk_uncertainty_analyses%rowtype;
  s public.risk_uncertainty_analyses%rowtype;
begin
  select * into a from public.risk_uncertainty_analyses where id=new.id;
  if not found then raise exception 'risk uncertainty replacement history must be retained'; end if;
  if a.replaces_analysis_id is not null then
    select * into p from public.risk_uncertainty_analyses
    where id=a.replaces_analysis_id and organization_id=a.organization_id and risk_id=a.risk_id;
    if not found or p.status is distinct from 'superseded'
      or p.organization_id is distinct from a.organization_id or p.risk_id is distinct from a.risk_id
      or p.superseded_by_analysis_id is distinct from a.id
      or p.author_id is distinct from a.author_id or p.version>=a.version
      or a.analysis_digest=repeat('0',64)
      or p.superseded_at is distinct from a.created_at
      or p.superseded_by_user_id is distinct from a.author_id
      or a.replacement_compare_and_swap->>'analysisId' is distinct from p.id::text
      or a.replacement_compare_and_swap->'version' is distinct from to_jsonb(p.version)
      or a.replacement_compare_and_swap->'digestVersion' is distinct from to_jsonb(p.digest_version)
      or a.replacement_compare_and_swap->>'analysisDigest' is distinct from p.analysis_digest
      or coalesce(a.replacement_compare_and_swap->>'currentDigest','') !~ '^[0-9a-f]{64}$'
      or coalesce(a.replacement_compare_and_swap->>'policyDigest','') !~ '^[0-9a-f]{64}$' then
      raise exception 'risk uncertainty replacement predecessor and successor must form a scoped reciprocal history pair';
    end if;
  end if;
  if a.superseded_by_analysis_id is not null then
    select * into s from public.risk_uncertainty_analyses
    where id=a.superseded_by_analysis_id and organization_id=a.organization_id and risk_id=a.risk_id;
    if not found or s.replaces_analysis_id is distinct from a.id
      or s.organization_id is distinct from a.organization_id or s.risk_id is distinct from a.risk_id
      or s.author_id is distinct from a.author_id or s.version<=a.version
      or s.analysis_digest=repeat('0',64)
      or a.superseded_at is distinct from s.created_at
      or a.superseded_by_user_id is distinct from s.author_id then
      raise exception 'risk uncertainty supersession requires its exact same-author successor';
    end if;
  end if;
  return null;
end $$;
create constraint trigger trg_risk_uncertainty_replacement_pair
  after insert or update on public.risk_uncertainty_analyses
  deferrable initially deferred for each row
  execute function public.enforce_risk_uncertainty_replacement_pair();

create or replace function public.enforce_risk_uncertainty_evidence_link()
returns trigger language plpgsql set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.risk_uncertainty_write',true),'');
begin
  if tg_op<>'INSERT' then
    raise exception 'risk uncertainty evidence bindings are immutable; submit a new analysis version';
  end if;
  if v_marker<>'granted' then
    raise exception 'risk uncertainty evidence bindings require the governed submit function';
  end if;
  if not exists(
    select 1 from public.risk_uncertainty_analyses a
    join public.evidence_items e on e.id=new.evidence_item_id
    where a.id=new.analysis_id and a.organization_id=new.organization_id
      and a.status='pending_review' and a.analysis_digest=repeat('0',64)
      and e.organization_id=new.organization_id and e.risk_id=a.risk_id
      and e.verification_status='verified'
  ) then
    raise exception 'analysis evidence must be verified evidence linked to this exact risk and organization';
  end if;
  return new;
end $$;

drop trigger if exists trg_risk_uncertainty_evidence_link on public.risk_uncertainty_analysis_evidence;
create trigger trg_risk_uncertainty_evidence_link
  before insert or update or delete on public.risk_uncertainty_analysis_evidence
  for each row execute function public.enforce_risk_uncertainty_evidence_link();

create or replace function public.refuse_risk_uncertainty_truncate()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'risk uncertainty history is retained; truncate refused';
end $$;

drop trigger if exists trg_refuse_risk_uncertainty_truncate on public.risk_uncertainty_analyses;
create trigger trg_refuse_risk_uncertainty_truncate
  before truncate on public.risk_uncertainty_analyses
  for each statement execute function public.refuse_risk_uncertainty_truncate();
drop trigger if exists trg_refuse_risk_uncertainty_evidence_truncate on public.risk_uncertainty_analysis_evidence;
create trigger trg_refuse_risk_uncertainty_evidence_truncate
  before truncate on public.risk_uncertainty_analysis_evidence
  for each statement execute function public.refuse_risk_uncertainty_truncate();

create or replace function public.risk_uncertainty_analysis_digest_v1(
  p_organization_id uuid,p_analysis_id uuid
) returns text language plpgsql stable security definer set search_path=public as $$
declare v_payload jsonb;
begin
  select jsonb_build_object(
    'analysisId',a.id,'riskId',a.risk_id,'version',a.version,
    'method',a.method,'basis',a.basis,
    'probability',jsonb_build_object('lower',a.probability_lower,'central',a.probability_central,'upper',a.probability_upper),
    'confidence',jsonb_build_object('level',a.confidence_level,'lower',a.confidence_interval_lower,'upper',a.confidence_interval_upper),
    'lossCases',jsonb_build_object('best',a.best_case_loss,'expected',a.expected_case_loss,'worst',a.worst_case_loss,'currency',a.currency),
    'sensitivityInputs',a.sensitivity_inputs,'sensitivityResults',a.sensitivity_results,
    'thresholdProfileId',a.threshold_profile_id,'decisionThresholds',a.decision_thresholds,
    'reassessmentTriggers',to_jsonb(a.reassessment_triggers),'reviewDueAt',a.review_due_at,
    'valueOfInformation',jsonb_build_object('action',a.voi_action,'informationCost',a.voi_information_cost,
      'decisionCostIfWrong',a.voi_decision_cost_if_wrong,'uncertaintyReduction',a.voi_uncertainty_reduction,
      'probabilityDecisionChanges',a.voi_probability_decision_changes,'expectedValue',a.voi_expected_value,
      'netValue',a.voi_net_value,'recommendation',a.voi_recommendation),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'verificationStatus',e.verification_status,'verifiedBy',e.verified_by,
      'verifiedAt',e.verified_at,'qualityGrade',e.quality_grade,
      'applicabilityGrade',e.applicability_grade,'revision',e.revision
    ) order by e.id) from public.risk_uncertainty_analysis_evidence b
      join public.evidence_items e on e.id=b.evidence_item_id
      where b.organization_id=p_organization_id and b.analysis_id=a.id),'[]'::jsonb)
  ) into v_payload
  from public.risk_uncertainty_analyses a
  where a.id=p_analysis_id and a.organization_id=p_organization_id;
  if v_payload is null then return null; end if;
  return encode(extensions.digest(v_payload::text,'sha256'),'hex');
end $$;

-- Pure canonical evidence-row content projection shared by scoped capture
-- and native record diagnostics. This does not bypass signed-edge immutability
-- or establish device ingestion, signature validity or approved source claims.
create or replace function public.risk_uncertainty_evidence_digest_projection(
  e public.evidence_items
) returns jsonb language plpgsql immutable
set search_path=public set timezone='UTC' as $$
begin
  return jsonb_build_object(
    'id',e.id,'organizationId',e.organization_id,'riskId',e.risk_id,
    'assetId',e.asset_id,'recommendationId',e.recommendation_id,
    'developmentCaseId',e.development_case_id,'relatedAsset',e.related_asset,'createdAt',e.created_at,
    'description',e.description,'sourceSystem',e.source_system,
    'evidenceType',e.evidence_type,'signalKind',e.signal_kind,
    'sourceReference',e.source_reference,'provenance',e.provenance,
    'documentId',e.document_id,'evidenceClass',e.evidence_class,
    'verificationStatus',e.verification_status,'verifiedBy',e.verified_by,
    'verifiedAt',e.verified_at,'verificationMethod',e.verification_method,
    'verificationNote',e.verification_note,'qualityGrade',e.quality_grade,
    'applicabilityGrade',e.applicability_grade,'applicability',e.applicability,
    'revision',e.revision,'timestamp',e.ts,'dataQuality',e.data_quality,
    'confidenceContribution',e.confidence_contribution,
    'edgeNodeId',e.edge_node_id,'edgeSensorId',e.edge_sensor_id,
    'edgeModelRegisterId',e.edge_model_register_id,'edgeObservationId',e.edge_observation_id,
    'edgeSequence',e.edge_sequence,'edgePayloadSha256',e.edge_payload_sha256,
    'edgeSignatureKeyId',e.edge_signature_key_id,'edgeSignatureVerifiedAt',e.edge_signature_verified_at,
    'edgeObservation',e.edge_observation
  );
end $$;

-- Version-two content projection. Missing/rebound dependencies remain an
-- explicit incomplete object, not NULL or an empty-array freshness success.
-- Every found row is scoped to the requested canonical tenant and risk. A
-- document UUID is only an anchor: no claim approval or KB eligibility is
-- inferred here while the shared quarantine/claim-purpose contract is pending.
create or replace function public.risk_uncertainty_input_binding_snapshot(
  p_organization_id uuid,p_risk_id uuid,p_evidence_item_ids uuid[]
) returns jsonb language plpgsql stable security definer
set search_path=public set timezone='UTC' as $$
declare
  v_expected_ids uuid[]; v_found_count integer; v_evidence jsonb;
  v_criteria jsonb; v_criteria_profile_id uuid;
begin
  select coalesce(array_agg(distinct x order by x),'{}'::uuid[])
    into v_expected_ids from unnest(coalesce(p_evidence_item_ids,'{}'::uuid[])) x;
  select count(*),coalesce(jsonb_agg(public.risk_uncertainty_evidence_digest_projection(e)
    order by e.id),'[]'::jsonb) into v_found_count,v_evidence
  from public.evidence_items e
  where e.id=any(v_expected_ids) and e.organization_id=p_organization_id
    and e.risk_id=p_risk_id;
  select r.criteria_profile_id,jsonb_build_object(
    'id',c.id,'organizationId',c.organization_id,'version',c.version,
    'status',c.status,'adoptedBy',c.adopted_by,'adoptedAt',c.adopted_at,
    'supersededBy',c.superseded_by,'decisionThresholds',c.decision_thresholds,
    'contextId',c.context_id,'name',c.name,'industryCode',c.industry_code,
    'jurisdiction',c.jurisdiction,'consequenceDimensions',c.consequence_dimensions,
    'likelihoodScale',c.likelihood_scale,'thresholds',c.thresholds,
    'scoringWeights',c.scoring_weights,'riskCapacity',c.risk_capacity,
    'aggregateRules',c.aggregate_rules,'timeFactors',c.time_factors,
    'toleranceStatements',c.tolerance_statements,'basis',c.basis,'reviewDate',c.review_date
  ) into v_criteria_profile_id,v_criteria
  from public.risks r join public.risk_criteria_profiles c
    on c.id=r.criteria_profile_id and c.organization_id=p_organization_id
  where r.id=p_risk_id and r.organization_id=p_organization_id;
  -- Preserve the same-org pointer even when its profile is missing or moved;
  -- never join through a foreign profile merely to obtain its content.
  if not found then
    select r.criteria_profile_id into v_criteria_profile_id from public.risks r
    where r.id=p_risk_id and r.organization_id=p_organization_id;
    v_criteria:=null;
  end if;
  return jsonb_build_object(
    'digestVersion',2,'organizationId',p_organization_id,'riskId',p_risk_id,
    'expectedEvidenceIds',to_jsonb(v_expected_ids),
    'expectedEvidenceCount',cardinality(v_expected_ids),'foundEvidenceCount',v_found_count,
    'bindingComplete',cardinality(v_expected_ids) between 1 and 20
      and v_found_count=cardinality(v_expected_ids) and v_criteria is not null,
    'evidence',v_evidence,'currentCriteriaProfileId',v_criteria_profile_id,
    'currentCriteria',v_criteria
  );
end $$;

-- Pure allowlisted immutable packet + bindings. The same projection hashes
-- the stored submission snapshot and current live inputs. Review, approval,
-- audit and derived-evidence artifacts cannot make a packet stale themselves.
create or replace function public.risk_uncertainty_v2_digest_payload(
  p_analysis public.risk_uncertainty_analyses,p_input_binding_snapshot jsonb
) returns jsonb language plpgsql immutable
set search_path=public set timezone='UTC' as $$
begin
  return jsonb_build_object(
    'digestVersion',2,'analysisId',p_analysis.id,
    'organizationId',p_analysis.organization_id,'riskId',p_analysis.risk_id,
    'version',p_analysis.version,'authorId',p_analysis.author_id,'createdAt',p_analysis.created_at,
    'method',p_analysis.method,'basis',p_analysis.basis,
    'probability',jsonb_build_object('lower',p_analysis.probability_lower,
      'central',p_analysis.probability_central,'upper',p_analysis.probability_upper),
    'confidence',jsonb_build_object('level',p_analysis.confidence_level,
      'lower',p_analysis.confidence_interval_lower,'upper',p_analysis.confidence_interval_upper),
    'lossCases',jsonb_build_object('best',p_analysis.best_case_loss,
      'expected',p_analysis.expected_case_loss,'worst',p_analysis.worst_case_loss,'currency',p_analysis.currency),
    'sensitivityInputs',p_analysis.sensitivity_inputs,'sensitivityResults',p_analysis.sensitivity_results,
    'thresholdProfileId',p_analysis.threshold_profile_id,'decisionThresholds',p_analysis.decision_thresholds,
    'reassessmentTriggers',to_jsonb(p_analysis.reassessment_triggers),'reviewDueAt',p_analysis.review_due_at,
    'valueOfInformation',jsonb_build_object('action',p_analysis.voi_action,'informationCost',p_analysis.voi_information_cost,
      'decisionCostIfWrong',p_analysis.voi_decision_cost_if_wrong,'uncertaintyReduction',p_analysis.voi_uncertainty_reduction,
      'probabilityDecisionChanges',p_analysis.voi_probability_decision_changes,'expectedValue',p_analysis.voi_expected_value,
      'netValue',p_analysis.voi_net_value,'recommendation',p_analysis.voi_recommendation),
    'inputBindings',p_input_binding_snapshot
  );
end;
$$;

create or replace function public.risk_uncertainty_analysis_digest(
  p_organization_id uuid,p_analysis_id uuid
) returns text language plpgsql stable security definer set search_path=public as $$
declare a public.risk_uncertainty_analyses%rowtype; v_ids uuid[]; v_payload jsonb;
begin
  select * into a from public.risk_uncertainty_analyses
  where id=p_analysis_id and organization_id=p_organization_id;
  if not found then return null; end if;
  if a.digest_version=1 then
    return public.risk_uncertainty_analysis_digest_v1(p_organization_id,p_analysis_id);
  elsif a.digest_version=2 then
    select coalesce(array_agg(b.evidence_item_id order by b.evidence_item_id),'{}'::uuid[])
      into v_ids from public.risk_uncertainty_analysis_evidence b
      where b.organization_id=p_organization_id and b.analysis_id=a.id;
    v_payload:=public.risk_uncertainty_v2_digest_payload(a,
      public.risk_uncertainty_input_binding_snapshot(p_organization_id,a.risk_id,v_ids));
    return encode(extensions.digest(v_payload::text,'sha256'),'hex');
  end if;
  return null;
end $$;

-- Scoped policy CAS uses the existing UTC-pinned canonical projection. The
-- server hashes raw JSONB, never a client's lossy decoded numeric values.
create or replace function public.risk_uncertainty_current_policy_digest(
  p_org uuid,p_risk_id uuid
) returns text language plpgsql stable set search_path=public as $$
declare v_snapshot jsonb; v_policy jsonb; v_payload jsonb;
begin
  v_snapshot:=public.risk_uncertainty_input_binding_snapshot(p_org,p_risk_id,'{}'::uuid[]);
  v_policy:=v_snapshot->'currentCriteria';
  if v_policy is null or v_policy='null'::jsonb then return null; end if;
  v_payload:=jsonb_build_object('organizationId',p_org,'riskId',p_risk_id,
    'currentCriteriaProfileId',v_snapshot->'currentCriteriaProfileId',
    'currentCriteria',v_policy);
  return encode(extensions.digest(v_payload::text,'sha256'),'hex');
end $$;

-- Structural input/policy standing ONLY. Lifecycle, independent reviewer,
-- source-purpose approval and operating authority remain separate gates.
-- A legacy metadata digest can still be equal after its policy has changed.
create or replace function public.risk_uncertainty_review_standing(
  p_org uuid,p_analysis_id uuid
) returns text language plpgsql stable set search_path=public as $$
declare
  a public.risk_uncertainty_analyses%rowtype;
  c public.risk_criteria_profiles%rowtype; v_count integer;
begin
  select * into a from public.risk_uncertainty_analyses
  where id=p_analysis_id and organization_id=p_org;
  if not found then return null; end if;
  select cp.* into c from public.risks r join public.risk_criteria_profiles cp
    on cp.id=r.criteria_profile_id and cp.organization_id=p_org
  where r.id=a.risk_id and r.organization_id=p_org;
  if not found or c.status is distinct from 'adopted'
    or c.decision_thresholds is null or jsonb_typeof(c.decision_thresholds)<>'object'
    or c.decision_thresholds='{}'::jsonb then
    return 'policy_unavailable';
  end if;
  if c.id is distinct from a.threshold_profile_id
    or c.decision_thresholds is distinct from a.decision_thresholds then
    return 'replacement_required';
  end if;
  select count(*) into v_count from public.risk_uncertainty_analysis_evidence b
  where b.organization_id=p_org and b.analysis_id=a.id;
  if v_count not between 1 and 20 or (
    select count(*) from public.risk_uncertainty_analysis_evidence b
    join public.evidence_items e on e.id=b.evidence_item_id
    where b.organization_id=p_org and b.analysis_id=a.id
      and e.organization_id=p_org and e.risk_id=a.risk_id
      and e.verification_status='verified'
  )<>v_count or public.risk_uncertainty_analysis_digest(p_org,a.id)
    is distinct from a.analysis_digest then
    return 'replacement_required';
  end if;
  return 'reviewable';
end $$;

-- Transaction-scoped visibility fence, not a second permission model. Walk
-- the canonical origin, lock its actual dependencies, then ask can_read_risk
-- again. NOWAIT avoids tuple/FK inversions with outside writers; contention
-- refuses before writes and the exception subtransaction releases its locks.
create or replace function public.risk_uncertainty_lock_visibility_context(
  p_org uuid,p_risk_id uuid
) returns boolean language plpgsql volatile set search_path=public as $$
declare
  v_pass integer; v_cursor uuid; v_row public.risks%rowtype; v_origin jsonb;
  v_path uuid[]; v_scenarios uuid[]; v_origins jsonb;
  v_initial_path uuid[]; v_initial_origins jsonb; v_locked integer;
begin
  if auth.uid() is null or p_org is null or p_risk_id is null
    or public.app_current_org() is distinct from p_org
    or public.can_read_risk(p_risk_id) is distinct from true then return false; end if;
  for v_pass in 1..2 loop
    v_cursor:=p_risk_id; v_path:='{}'::uuid[];
    v_scenarios:='{}'::uuid[]; v_origins:='[]'::jsonb;
    while v_cursor is not null loop
      if v_cursor=any(v_path) then return false; end if;
      select * into v_row from public.risks
      where id=v_cursor and organization_id=p_org;
      if not found then return false; end if;
      v_path:=array_append(v_path,v_cursor);
      v_origin:=public.get_risk_secondary_origin_internal(v_row);
      if v_origin->'valid' is distinct from 'true'::jsonb then return false; end if;
      v_origins:=v_origins||jsonb_build_array(jsonb_build_object('risk',v_cursor,'origin',v_origin));
      if public.sync_text_as_uuid(v_origin->>'scenario_id') is not null then
        v_scenarios:=array_append(v_scenarios,public.sync_text_as_uuid(v_origin->>'scenario_id'));
      end if;
      v_cursor:=public.sync_text_as_uuid(v_origin->>'parent_id');
    end loop;
    if v_pass=1 then
      v_initial_path:=v_path; v_initial_origins:=v_origins;
      -- UPDATE, not NO KEY UPDATE: immediate view FKs request KEY SHARE.
      -- The complete set is ordered BEFORE either RPC's original target lock.
      perform r.id from public.risks r
      where r.organization_id=p_org and r.id=any(v_path)
      order by r.id for update of r nowait;
      get diagnostics v_locked=row_count;
      if v_locked<>cardinality(v_path) then return false; end if;
      -- Lock inverse references, not only today's matching actor/org grants.
      -- A wrong-org/user row can be corrected without changing its risk FK.
      -- No stakeholder content or foreign identity is returned to a caller.
      perform sv.id from public.risk_stakeholder_views sv
      join public.risks r on r.id=sv.risk_id
      where r.organization_id=p_org and r.id=any(v_path)
      order by sv.id for share of sv nowait;
      perform s.id from public.scenarios s
      where s.organization_id=p_org and s.id=any(v_scenarios)
      order by s.id for share of s nowait;
      get diagnostics v_locked=row_count;
      if v_locked<>(select count(distinct x) from unnest(v_scenarios) x) then return false; end if;
    elsif v_path is distinct from v_initial_path
      or v_origins is distinct from v_initial_origins then
      -- Never silently expand a held set after locks, in a different order.
      return false;
    end if;
  end loop;
  return public.can_read_risk(p_risk_id) is true
    and public.app_current_org() is not distinct from p_org;
exception when lock_not_available then
  return false;
end $$;
revoke all on function public.risk_uncertainty_lock_visibility_context(uuid,uuid) from public,anon,authenticated,service_role;

-- One private validated writer, reused by the unchanged public submit door.
-- Replacement will extend this path, not duplicate its validator or arithmetic.
create or replace function public.submit_risk_uncertainty_analysis_internal(
  p_risk_id uuid,p_analysis jsonb,p_evidence_item_ids uuid[],p_replacement jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_user uuid:=auth.uid();
  v_locked_org uuid; v_role text; r public.risks%rowtype;
  c public.risk_criteria_profiles%rowtype; v_id uuid; v_version integer; v_digest text;
  v_evidence_ids uuid[]; v_triggers text[]; v_sensitivity jsonb; v_sensitivity_results jsonb;
  v_probability_lower numeric; v_probability_central numeric; v_probability_upper numeric;
  v_confidence_level numeric; v_ci_lower numeric; v_ci_upper numeric;
  v_best numeric; v_expected numeric; v_worst numeric; v_currency text;
  v_info_cost numeric; v_wrong_cost numeric; v_uncertainty_reduction numeric; v_change_probability numeric;
  v_voi_expected_raw numeric; v_voi_net_raw numeric;
  v_voi_expected numeric; v_voi_net numeric; v_voi_recommendation text; v_review_due timestamptz;
  v_input_binding_snapshot jsonb; v_stored_digest text;
  v_packet public.risk_uncertainty_analyses%rowtype;
  v_predecessor public.risk_uncertainty_analyses%rowtype;
  v_intent uuid; v_fingerprint text; v_lock_evidence_ids uuid[]; v_cas jsonb;
  v_created_at timestamptz; v_count integer;
begin
  if v_user is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select role into v_role from public.user_profiles where id=v_user and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','risk uncertainty submission requires a named human engineering or management role');
  end if;
  if public.risk_uncertainty_lock_visibility_context(v_org,p_risk_id) is distinct from true then
    return jsonb_build_object('error','risk not found in this organization');
  end if;
  select * into r from public.risks
  where id=p_risk_id and organization_id=v_org and public.can_read_risk(id) for update;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if p_replacement is not null then
    v_intent:=(p_replacement->>'intentId')::uuid;
    v_fingerprint:=p_replacement->>'requestFingerprint';
    -- A committed historical receipt is resolved BEFORE mutable pending,
    -- criteria/evidence/date gates. No resend or second packet is created.
    select * into v_packet from public.risk_uncertainty_analyses
    where organization_id=v_org and author_id=v_user and replacement_intent_id=v_intent;
    if found then
      if v_packet.risk_id is distinct from r.id
        or v_packet.replacement_request_fingerprint is distinct from v_fingerprint then
        return jsonb_build_object('error','replacement intent is already bound to a different request');
      end if;
      select organization_id,role into v_locked_org,v_role from public.user_profiles
      where id=v_user for share;
      if not found or auth.uid() is distinct from v_user or v_locked_org is distinct from v_org
        or public.app_current_org() is distinct from v_org
        or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
        return jsonb_build_object('error','current named human engineering or management membership required');
      end if;
      if public.can_read_risk(r.id) is distinct from true then
        return jsonb_build_object('error','risk not found in this organization');
      end if;
      return public.risk_uncertainty_replacement_receipt_payload(v_packet);
    end if;
    select * into v_predecessor from public.risk_uncertainty_analyses
    where id=(p_replacement->'predecessor'->>'analysisId')::uuid
      and organization_id=v_org and risk_id=r.id for update;
    if not found or v_predecessor.author_id is distinct from v_user
      or v_predecessor.status is distinct from 'pending_review' then
      return jsonb_build_object('error','replacement requires the current pending packet and its original human author');
    end if;
    if v_predecessor.version is distinct from (p_replacement->'predecessor'->>'version')::numeric::integer
      or v_predecessor.digest_version is distinct from (p_replacement->'predecessor'->>'digestVersion')::numeric::integer
      or v_predecessor.analysis_digest is distinct from p_replacement->'predecessor'->>'analysisDigest'
      or exists(select 1 from public.risk_uncertainty_analyses a
        where a.organization_id=v_org and a.risk_id=r.id and a.version>v_predecessor.version) then
      return jsonb_build_object('error','replacement predecessor changed; reload the governed workspace');
    end if;
  end if;
  if r.status='archived' then return jsonb_build_object('error','archived risks cannot receive a new uncertainty analysis'); end if;
  select * into c from public.risk_criteria_profiles
  where id=r.criteria_profile_id and organization_id=v_org for share;
  if not found or c.status<>'adopted' or c.decision_thresholds='{}'::jsonb then
    return jsonb_build_object('error','criteria profile must be adopted with decision thresholds before uncertainty analysis');
  end if;
  if p_replacement is null and exists(select 1 from public.risk_uncertainty_analyses a
    where a.organization_id=v_org and a.risk_id=r.id and a.status='pending_review') then
    return jsonb_build_object('error','this risk already has an uncertainty analysis awaiting independent review');
  end if;
  if jsonb_typeof(p_analysis) is distinct from 'object' then
    return jsonb_build_object('error','uncertainty analysis must be an object');
  end if;
  begin
    v_probability_lower:=nullif(p_analysis->>'probability_lower','')::numeric;
    v_probability_central:=nullif(p_analysis->>'probability_central','')::numeric;
    v_probability_upper:=nullif(p_analysis->>'probability_upper','')::numeric;
    v_confidence_level:=nullif(p_analysis->>'confidence_level','')::numeric;
    v_ci_lower:=nullif(p_analysis->>'confidence_interval_lower','')::numeric;
    v_ci_upper:=nullif(p_analysis->>'confidence_interval_upper','')::numeric;
    v_best:=nullif(p_analysis->>'best_case_loss','')::numeric;
    v_expected:=nullif(p_analysis->>'expected_case_loss','')::numeric;
    v_worst:=nullif(p_analysis->>'worst_case_loss','')::numeric;
    v_info_cost:=nullif(p_analysis->>'voi_information_cost','')::numeric;
    v_wrong_cost:=nullif(p_analysis->>'voi_decision_cost_if_wrong','')::numeric;
    v_uncertainty_reduction:=nullif(p_analysis->>'voi_uncertainty_reduction','')::numeric;
    v_change_probability:=nullif(p_analysis->>'voi_probability_decision_changes','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('error','probability, confidence, loss and value-of-information inputs must be valid numbers');
  end;
  -- Numeric special values are valid PostgreSQL inputs, not cast exceptions.
  -- Reuse the canonical numeric::text refusal; never replace unsafe input.
  if v_probability_lower::text in ('NaN','Infinity','-Infinity')
     or v_probability_central::text in ('NaN','Infinity','-Infinity')
     or v_probability_upper::text in ('NaN','Infinity','-Infinity')
     or v_confidence_level::text in ('NaN','Infinity','-Infinity')
     or v_ci_lower::text in ('NaN','Infinity','-Infinity')
     or v_ci_upper::text in ('NaN','Infinity','-Infinity')
     or v_best::text in ('NaN','Infinity','-Infinity')
     or v_expected::text in ('NaN','Infinity','-Infinity')
     or v_worst::text in ('NaN','Infinity','-Infinity')
     or v_info_cost::text in ('NaN','Infinity','-Infinity')
     or v_wrong_cost::text in ('NaN','Infinity','-Infinity')
     or v_uncertainty_reduction::text in ('NaN','Infinity','-Infinity')
     or v_change_probability::text in ('NaN','Infinity','-Infinity') then
    return jsonb_build_object('error','probability, confidence, loss and value-of-information inputs must be finite numbers');
  end if;
  -- Keep the original timestamptz/session-timezone interpretation.
  begin
    v_review_due:=nullif(p_analysis->>'review_due_at','')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error','review due date must be a valid timestamp');
  end;
  if v_probability_lower is null or v_probability_central is null or v_probability_upper is null
     or v_probability_lower<0 or v_probability_upper>1
     or not (v_probability_lower<=v_probability_central and v_probability_central<=v_probability_upper) then
    return jsonb_build_object('error','probability range must satisfy 0 <= lower <= central <= upper <= 1');
  end if;
  if v_confidence_level is null or v_confidence_level<=0 or v_confidence_level>1
     or v_ci_lower is null or v_ci_upper is null or v_ci_lower<0 or v_ci_upper>1 or v_ci_lower>v_ci_upper then
    return jsonb_build_object('error','confidence interval must be ordered inside 0..1 with a stated confidence level');
  end if;
  if v_best is null or v_expected is null or v_worst is null or v_best<0
     or not (v_best<=v_expected and v_expected<=v_worst) then
    return jsonb_build_object('error','loss cases must be non-negative and ordered best <= expected <= worst');
  end if;
  v_currency:=upper(btrim(coalesce(p_analysis->>'currency',r.value_currency)));
  if v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('error','loss cases require one ISO currency'); end if;
  if length(btrim(coalesce(p_analysis->>'method','')))<3 or length(btrim(coalesce(p_analysis->>'basis','')))<20 then
    return jsonb_build_object('error','state the uncertainty method and a substantive source and assumption basis');
  end if;
  if not isfinite(v_review_due) then
    return jsonb_build_object('error','review due date must be a finite timestamp');
  end if;
  if v_review_due is null or v_review_due<=now() then
    return jsonb_build_object('error','review due date must be in the future');
  end if;
  if jsonb_typeof(coalesce(p_analysis->'reassessment_triggers','null'::jsonb))<>'array' then
    return jsonb_build_object('error','reassessment triggers must be an array');
  end if;
  select coalesce(array_agg(x order by x),'{}') into v_triggers
  from (select distinct btrim(value) x from jsonb_array_elements_text(p_analysis->'reassessment_triggers')
    where btrim(value)<>'') q;
  if cardinality(v_triggers) not between 1 and 20
     or exists(select 1 from unnest(v_triggers) x where length(x)<10 or length(x)>500) then
    return jsonb_build_object('error','record one to twenty measurable reassessment triggers');
  end if;
  v_sensitivity:=coalesce(p_analysis->'sensitivity','[]'::jsonb);
  if jsonb_typeof(v_sensitivity) is distinct from 'array' then
    return jsonb_build_object('error','record one to twenty sourced sensitivity factors');
  end if;
  if jsonb_array_length(v_sensitivity) not between 1 and 20 then
    return jsonb_build_object('error','record one to twenty sourced sensitivity factors');
  end if;
  if exists(select 1 from jsonb_array_elements(v_sensitivity) as q(item)
    where jsonb_typeof(item) is distinct from 'object') then
    return jsonb_build_object('error','each sensitivity factor must be an object');
  end if;
  begin
    if exists(select 1 from jsonb_to_recordset(v_sensitivity) as s(
      name text,basis text,low_input numeric,base_input numeric,high_input numeric,
      low_output numeric,base_output numeric,high_output numeric
    ) where low_input::text in ('NaN','Infinity','-Infinity')
      or base_input::text in ('NaN','Infinity','-Infinity')
      or high_input::text in ('NaN','Infinity','-Infinity')
      or low_output::text in ('NaN','Infinity','-Infinity')
      or base_output::text in ('NaN','Infinity','-Infinity')
      or high_output::text in ('NaN','Infinity','-Infinity')) then
      return jsonb_build_object('error','sensitivity factor ranges must contain finite numbers');
    end if;
    if exists(select 1 from jsonb_to_recordset(v_sensitivity) as s(
      name text,basis text,low_input numeric,base_input numeric,high_input numeric,
      low_output numeric,base_output numeric,high_output numeric
    ) where length(btrim(coalesce(name,'')))<2 or length(btrim(coalesce(basis,'')))<20
      or low_input is null or base_input is null or high_input is null
      or low_output is null or base_output is null or high_output is null
      or low_input>base_input or base_input>high_input
      or low_output<0 or base_output<0 or high_output<0) then
      return jsonb_build_object('error','each sensitivity factor requires a sourced ordered input range and non-negative outputs');
    end if;
    select jsonb_agg(jsonb_build_object(
      'name',btrim(name),'basis',btrim(basis),'lowInput',low_input,'baseInput',base_input,'highInput',high_input,
      'lowOutput',low_output,'baseOutput',base_output,'highOutput',high_output,
      'swing',round(abs(high_output-low_output),4)
    ) order by abs(high_output-low_output) desc,btrim(name)) into v_sensitivity_results
    from jsonb_to_recordset(v_sensitivity) as s(
      name text,basis text,low_input numeric,base_input numeric,high_input numeric,
      low_output numeric,base_output numeric,high_output numeric
    );
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('error','sensitivity factor ranges must contain valid numbers');
  end;
  if length(btrim(coalesce(p_analysis->>'voi_action','')))<10
     or v_info_cost is null or v_wrong_cost is null or v_info_cost<0 or v_wrong_cost<0
     or v_uncertainty_reduction is null or v_uncertainty_reduction not between 0 and 1
     or v_change_probability is null or v_change_probability not between 0 and 1 then
    return jsonb_build_object('error','value-of-information requires an action, non-negative costs and probability inputs inside 0..1');
  end if;
  select coalesce(array_agg(distinct x order by x),'{}') into v_evidence_ids
  from unnest(coalesce(p_evidence_item_ids,'{}')) x;
  if cardinality(v_evidence_ids) not between 1 and 20
     or (select count(*) from public.evidence_items e where e.id=any(v_evidence_ids)
       and e.organization_id=v_org and e.risk_id=r.id and e.verification_status='verified')<>cardinality(v_evidence_ids) then
    return jsonb_build_object('error','all cited inputs must be verified evidence linked to this exact risk');
  end if;
  -- Old IDs come ONLY from the trusted scoped predecessor bindings. Lock
  -- rebound rows too, without reading/projecting their foreign content.
  select array_agg(distinct x order by x) into v_lock_evidence_ids from (
    select unnest(v_evidence_ids) x
    union all select b.evidence_item_id from public.risk_uncertainty_analysis_evidence b
      where p_replacement is not null and b.organization_id=v_org and b.analysis_id=v_predecessor.id
  ) q;
  if p_replacement is not null then
    begin
      -- A restoration writer may already own evidence and need this held
      -- risk's FK lock. Never wait in the inverse direction. This exact
      -- exception subtransaction releases any partly acquired evidence union.
      perform 1 from public.evidence_items e
      where e.id=any(v_lock_evidence_ids)
      order by e.id for update of e nowait;
    exception when lock_not_available then
      return jsonb_build_object('error','replacement evidence is busy; reload the governed workspace');
    end;
  else
    perform 1 from public.evidence_items e
    where e.id=any(v_lock_evidence_ids)
    order by e.id for update of e;
  end if;
  -- All explicit input waits have completed. Lock and reread the CURRENT
  -- profile rather than trusting the role/organization captured before them.
  select organization_id,role into v_locked_org,v_role from public.user_profiles
  where id=v_user for share;
  if not found or auth.uid() is distinct from v_user or v_locked_org is distinct from v_org
    or public.app_current_org() is distinct from v_org
    or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','current named human engineering or management membership required');
  end if;
  if public.can_read_risk(r.id) is distinct from true then
    return jsonb_build_object('error','risk not found in this organization');
  end if;
  if (select count(*) from public.evidence_items e where e.id=any(v_evidence_ids)
    and e.organization_id=v_org and e.risk_id=r.id and e.verification_status='verified')<>cardinality(v_evidence_ids) then
    return jsonb_build_object('error','all cited inputs must be verified evidence linked to this exact risk');
  end if;
  if p_replacement is not null then
    if public.risk_uncertainty_current_policy_digest(v_org,r.id) is distinct from p_replacement->>'policyDigest'
      or public.risk_uncertainty_analysis_digest(v_org,v_predecessor.id) is distinct from
        p_replacement->'predecessor'->>'currentDigest' then
      return jsonb_build_object('error','replacement inputs or policy changed; reload the governed workspace');
    end if;
    if public.risk_uncertainty_review_standing(v_org,v_predecessor.id) is distinct from 'replacement_required' then
      return jsonb_build_object('error','replacement requires stale inputs under an available adopted policy');
    end if;
    v_cas:=(p_replacement->'predecessor')||jsonb_build_object('policyDigest',p_replacement->>'policyDigest');
  end if;
  v_input_binding_snapshot:=public.risk_uncertainty_input_binding_snapshot(v_org,r.id,v_evidence_ids);
  if v_input_binding_snapshot->'bindingComplete' is distinct from 'true'::jsonb then
    return jsonb_build_object('error','current uncertainty input bindings are incomplete');
  end if;
  -- Match canonical record_risk_value_of_information: classify the unrounded
  -- numeric benefit minus cost before independently rounding either display.
  v_voi_expected_raw:=v_wrong_cost*v_uncertainty_reduction*v_change_probability;
  v_voi_net_raw:=v_voi_expected_raw-v_info_cost;
  v_voi_recommendation:=case when v_voi_net_raw>0 then 'GATHER_INFORMATION' else 'DECIDE_WITH_CURRENT_INFORMATION' end;
  v_voi_expected:=round(v_voi_expected_raw,2);
  v_voi_net:=round(v_voi_net_raw,2);
  select coalesce(max(version),0)+1 into v_version from public.risk_uncertainty_analyses
  where organization_id=v_org and risk_id=r.id;
  v_id:=gen_random_uuid(); v_created_at:=now();
  perform set_config('app.risk_uncertainty_write','granted',true);
  if p_replacement is not null then
    update public.risk_uncertainty_analyses set status='superseded',
      superseded_by_analysis_id=v_id,superseded_at=v_created_at,superseded_by_user_id=v_user
    where id=v_predecessor.id and organization_id=v_org and risk_id=r.id
      and author_id=v_user and status='pending_review';
    get diagnostics v_count=row_count;
    if v_count<>1 then raise exception 'uncertainty predecessor changed during replacement'; end if;
  end if;
  insert into public.risk_uncertainty_analyses(
    id,created_at,organization_id,risk_id,version,method,basis,
    probability_lower,probability_central,probability_upper,
    confidence_level,confidence_interval_lower,confidence_interval_upper,
    best_case_loss,expected_case_loss,worst_case_loss,currency,
    sensitivity_inputs,sensitivity_results,threshold_profile_id,decision_thresholds,
    reassessment_triggers,review_due_at,voi_action,voi_information_cost,
    voi_decision_cost_if_wrong,voi_uncertainty_reduction,voi_probability_decision_changes,
    voi_expected_value,voi_net_value,voi_recommendation,analysis_digest,author_id,
    digest_version,input_binding_snapshot,replaces_analysis_id,replacement_intent_id,
    replacement_request_fingerprint,replacement_compare_and_swap,replacement_reason
  ) values(
    v_id,v_created_at,v_org,r.id,v_version,btrim(p_analysis->>'method'),btrim(p_analysis->>'basis'),
    v_probability_lower,v_probability_central,v_probability_upper,
    v_confidence_level,v_ci_lower,v_ci_upper,v_best,v_expected,v_worst,v_currency,
    v_sensitivity,v_sensitivity_results,c.id,c.decision_thresholds,v_triggers,v_review_due,
    btrim(p_analysis->>'voi_action'),v_info_cost,v_wrong_cost,v_uncertainty_reduction,v_change_probability,
    v_voi_expected,v_voi_net,v_voi_recommendation,repeat('0',64),v_user,
    2,v_input_binding_snapshot,v_predecessor.id,v_intent,v_fingerprint,v_cas,p_replacement->>'reason'
  ) returning * into v_packet;
  v_id:=v_packet.id;
  insert into public.risk_uncertainty_analysis_evidence(organization_id,analysis_id,evidence_item_id)
  select v_org,v_id,x from unnest(v_evidence_ids) x;
  v_stored_digest:=encode(extensions.digest(public.risk_uncertainty_v2_digest_payload(
    v_packet,v_input_binding_snapshot)::text,'sha256'),'hex');
  v_digest:=public.risk_uncertainty_analysis_digest(v_org,v_id);
  -- A mismatch after insertion must roll back, not return a normal error ACK
  -- that would leave an orphan pending packet or evidence binding.
  if v_digest is distinct from v_stored_digest then
    raise exception 'uncertainty input binding changed during submission';
  end if;
  update public.risk_uncertainty_analyses set analysis_digest=v_digest where id=v_id;
  update public.risks set value_of_information=jsonb_build_object(
    'information_action',btrim(p_analysis->>'voi_action'),'information_cost',v_info_cost,
    'decision_cost_if_wrong',v_wrong_cost,'uncertainty_reduction',v_uncertainty_reduction,
    'probability_decision_changes',v_change_probability,'expected_value',v_voi_expected,
    'net_value',v_voi_net,'recommendation',v_voi_recommendation,'currency',v_currency,
    'analysis_id',v_id,'validation_status','pending_review','recorded_at',now(),
    'human_decision_required',true,'operational_authorization',false
  ),updated_at=now() where id=r.id and organization_id=v_org;
  perform set_config('app.risk_uncertainty_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,case when p_replacement is null then 'risk_uncertainty_analysis_submitted'
    else 'risk_uncertainty_analysis_replaced' end,v_role,jsonb_build_object(
    'risk_id',r.id,'analysis_id',v_id,'version',v_version,'analysis_digest',v_digest,
    'evidence_item_ids',to_jsonb(v_evidence_ids),'threshold_profile_id',c.id,
    'operational_authorization',false)||case when p_replacement is null then '{}'::jsonb else
      jsonb_build_object('predecessor_analysis_id',v_predecessor.id,'replacement_intent_id',v_intent,
        'request_fingerprint',v_fingerprint,'compare_and_swap',v_cas,'reason',p_replacement->>'reason') end);
  if p_replacement is not null then
    v_packet.analysis_digest:=v_digest;
    return public.risk_uncertainty_replacement_receipt_payload(v_packet);
  end if;
  return jsonb_build_object('riskId',r.id,'analysisId',v_id,'version',v_version,
    'analysisDigest',v_digest,'validationStatus','pending_review',
    'valueOfInformation',jsonb_build_object(
      'informationCost',v_info_cost,'decisionCostIfWrong',v_wrong_cost,
      'uncertaintyReduction',v_uncertainty_reduction,'probabilityDecisionChanges',v_change_probability,
      'expectedValue',v_voi_expected,'netValue',v_voi_net,'recommendation',v_voi_recommendation),
    'operationalAuthorization',false);
end $$;

create or replace function public.submit_risk_uncertainty_analysis(
  p_risk_id uuid,p_analysis jsonb,p_evidence_item_ids uuid[]
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or public.app_current_org() is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  return public.submit_risk_uncertainty_analysis_internal(p_risk_id,p_analysis,p_evidence_item_ids);
end $$;

-- Immutable historical commit receipt. It intentionally does not assert the
-- successor is STILL pending, current, reviewable or operationally approved.
create or replace function public.risk_uncertainty_replacement_receipt_payload(
  p_packet public.risk_uncertainty_analyses
) returns jsonb language plpgsql stable set search_path=public as $$
begin
  return jsonb_build_object('commitStatus','committed','submittedStatus','pending_review',
    'organizationId',p_packet.organization_id,'actorId',p_packet.author_id,'riskId',p_packet.risk_id,
    'intentId',p_packet.replacement_intent_id,'requestFingerprint',p_packet.replacement_request_fingerprint,
    'predecessorAnalysisId',p_packet.replaces_analysis_id,'compareAndSwap',p_packet.replacement_compare_and_swap,
    'analysisId',p_packet.id,'version',p_packet.version,'analysisDigest',p_packet.analysis_digest,
    'digestVersion',p_packet.digest_version,'digestCoverage',case p_packet.digest_version
      when 1 then 'legacy_metadata' when 2 then 'evidence_content_and_current_criteria' else null end,
    'valueOfInformation',jsonb_build_object('informationCost',p_packet.voi_information_cost,
      'decisionCostIfWrong',p_packet.voi_decision_cost_if_wrong,'uncertaintyReduction',p_packet.voi_uncertainty_reduction,
      'probabilityDecisionChanges',p_packet.voi_probability_decision_changes,'expectedValue',p_packet.voi_expected_value,
      'netValue',p_packet.voi_net_value,'recommendation',p_packet.voi_recommendation),
    'operationalAuthorization',false);
end $$;

create or replace function public.replace_risk_uncertainty_analysis(
  p_risk_id uuid,p_request_text text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_user uuid:=auth.uid();
  v_request jsonb; v_predecessor jsonb; v_analysis jsonb; v_fingerprint text;
  v_evidence_ids uuid[]; v_field text; v_uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_user is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  if p_request_text is null or octet_length(convert_to(p_request_text,'UTF8'))>1048576 then
    return jsonb_build_object('error','replacement request must be bounded UTF-8 JSON text');
  end if;
  v_fingerprint:=encode(extensions.digest(convert_to(p_request_text,'UTF8'),'sha256'),'hex');
  begin v_request:=p_request_text::jsonb;
  exception when invalid_text_representation or untranslatable_character or numeric_value_out_of_range then
    return jsonb_build_object('error','replacement request must be bounded UTF-8 JSON text');
  end;
  if jsonb_typeof(v_request) is distinct from 'object' then
    return jsonb_build_object('error','replacement request must be a complete versioned object');
  end if;
  if v_request->'contractVersion' is distinct from '1'::jsonb
    or v_request->>'action' is distinct from 'replace'
    or (select count(*) from jsonb_object_keys(v_request))<>11
    or exists(select 1 from jsonb_object_keys(v_request) k where k not in
      ('contractVersion','action','intentId','organizationId','actorId','riskId','predecessor',
       'policyDigest','reason','analysis','evidenceItemIds')) then
    return jsonb_build_object('error','replacement request must be a complete versioned object');
  end if;
  foreach v_field in array array['intentId','organizationId','actorId','riskId'] loop
    if jsonb_typeof(v_request->v_field) is distinct from 'string'
      or coalesce(v_request->>v_field,'') !~ v_uuid_pattern then
      return jsonb_build_object('error','replacement identities must be canonical UUIDs');
    end if;
  end loop;
  if v_request->>'organizationId' is distinct from v_org::text
    or v_request->>'actorId' is distinct from v_user::text
    or v_request->>'riskId' is distinct from p_risk_id::text then
    return jsonb_build_object('error','replacement request must match the current organization, actor and risk');
  end if;
  v_predecessor:=v_request->'predecessor'; v_analysis:=v_request->'analysis';
  if jsonb_typeof(v_predecessor) is distinct from 'object' then
    return jsonb_build_object('error','replacement requires the exact predecessor and policy compare-and-swap');
  end if;
  if (select count(*) from jsonb_object_keys(v_predecessor))<>5
    or exists(select 1 from jsonb_object_keys(v_predecessor) k where k not in
      ('analysisId','version','digestVersion','analysisDigest','currentDigest'))
    or jsonb_typeof(v_predecessor->'analysisId') is distinct from 'string'
    or coalesce(v_predecessor->>'analysisId','') !~ v_uuid_pattern
    or jsonb_typeof(v_predecessor->'version') is distinct from 'number'
    or jsonb_typeof(v_predecessor->'digestVersion') is distinct from 'number'
    or v_predecessor->'digestVersion' not in ('1'::jsonb,'2'::jsonb)
    or jsonb_typeof(v_predecessor->'analysisDigest') is distinct from 'string'
    or jsonb_typeof(v_predecessor->'currentDigest') is distinct from 'string'
    or coalesce(v_predecessor->>'analysisDigest','') !~ '^[0-9a-f]{64}$'
    or coalesce(v_predecessor->>'currentDigest','') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(v_request->'policyDigest') is distinct from 'string'
    or coalesce(v_request->>'policyDigest','') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error','replacement requires the exact predecessor and policy compare-and-swap');
  end if;
  if (v_predecessor->>'version')::numeric not between 1 and 2147483647
    or trunc((v_predecessor->>'version')::numeric)<>(v_predecessor->>'version')::numeric then
    return jsonb_build_object('error','replacement predecessor version must be a positive PostgreSQL integer');
  end if;
  if jsonb_typeof(v_request->'reason') is distinct from 'string'
    or length(btrim(coalesce(v_request->>'reason','')))<20 then
    return jsonb_build_object('error','replacement requires a substantive retained reason');
  end if;
  if jsonb_typeof(v_analysis) is distinct from 'object' then
    return jsonb_build_object('error','uncertainty analysis must be an object');
  end if;
  if (select count(*) from jsonb_object_keys(v_analysis))<>20
    or exists(select 1 from jsonb_object_keys(v_analysis) k where k not in
      ('method','basis','probability_lower','probability_central','probability_upper',
       'confidence_level','confidence_interval_lower','confidence_interval_upper',
       'best_case_loss','expected_case_loss','worst_case_loss','currency','sensitivity',
       'reassessment_triggers','review_due_at','voi_action','voi_information_cost',
       'voi_decision_cost_if_wrong','voi_uncertainty_reduction','voi_probability_decision_changes')) then
    return jsonb_build_object('error','replacement requires the complete allowlisted analysis proposal');
  end if;
  foreach v_field in array array['method','basis','currency','review_due_at','voi_action'] loop
    if jsonb_typeof(v_analysis->v_field) is distinct from 'string' then
      return jsonb_build_object('error','replacement proposal text inputs must be JSON strings');
    end if;
  end loop;
  foreach v_field in array array['probability_lower','probability_central','probability_upper',
    'confidence_level','confidence_interval_lower','confidence_interval_upper',
    'best_case_loss','expected_case_loss','worst_case_loss','voi_information_cost',
    'voi_decision_cost_if_wrong','voi_uncertainty_reduction','voi_probability_decision_changes'] loop
    if jsonb_typeof(v_analysis->v_field) is distinct from 'number' then
      return jsonb_build_object('error','replacement proposal numeric inputs must be JSON numbers');
    end if;
  end loop;
  if jsonb_typeof(v_analysis->'sensitivity') is distinct from 'array'
    or jsonb_typeof(v_analysis->'reassessment_triggers') is distinct from 'array' then
    return jsonb_build_object('error','replacement proposal factors and triggers must be arrays');
  end if;
  if exists(select 1 from jsonb_array_elements(v_analysis->'reassessment_triggers') t
      where jsonb_typeof(t) is distinct from 'string') then
    return jsonb_build_object('error','replacement proposal triggers must be JSON strings');
  end if;
  if exists(select 1 from jsonb_array_elements(v_analysis->'sensitivity') s
      where jsonb_typeof(s) is distinct from 'object') then
    return jsonb_build_object('error','each sensitivity factor must be an object');
  end if;
  if exists(select 1 from jsonb_array_elements(v_analysis->'sensitivity') s
    where (select count(*) from jsonb_object_keys(s))<>8
      or exists(select 1 from jsonb_object_keys(s) k where k not in
        ('name','basis','low_input','base_input','high_input','low_output','base_output','high_output'))
      or jsonb_typeof(s->'name') is distinct from 'string' or jsonb_typeof(s->'basis') is distinct from 'string'
      or exists(select 1 from unnest(array['low_input','base_input','high_input','low_output','base_output','high_output']) k
        where jsonb_typeof(s->k) is distinct from 'number')) then
    return jsonb_build_object('error','replacement sensitivity requires complete typed factors');
  end if;
  if jsonb_typeof(v_request->'evidenceItemIds') is distinct from 'array' then
    return jsonb_build_object('error','replacement requires one to twenty canonical evidence UUIDs');
  end if;
  if jsonb_array_length(v_request->'evidenceItemIds') not between 1 and 20
    or exists(select 1 from jsonb_array_elements(v_request->'evidenceItemIds') e
      where jsonb_typeof(e) is distinct from 'string' or coalesce(e#>>'{}','') !~ v_uuid_pattern) then
    return jsonb_build_object('error','replacement requires one to twenty canonical evidence UUIDs');
  end if;
  select array_agg(distinct value::uuid order by value::uuid) into v_evidence_ids
  from jsonb_array_elements_text(v_request->'evidenceItemIds');
  return public.submit_risk_uncertainty_analysis_internal(
    p_risk_id,v_analysis,v_evidence_ids,v_request||jsonb_build_object('requestFingerprint',v_fingerprint));
end $$;

create or replace function public.get_risk_uncertainty_replacement_receipt(
  p_risk_id uuid,p_intent_id uuid,p_request_fingerprint text
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_user uuid:=auth.uid();
  v_packet public.risk_uncertainty_analyses%rowtype;
begin
  if v_user is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  if public.can_read_risk(p_risk_id) is distinct from true
    or not exists(select 1 from public.risks r where r.id=p_risk_id and r.organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization');
  end if;
  select a.* into v_packet from public.risk_uncertainty_analyses a
  where a.organization_id=v_org and a.risk_id=p_risk_id and a.author_id=v_user
    and a.replacement_intent_id=p_intent_id
    and a.replacement_request_fingerprint=p_request_fingerprint;
  if not found then return jsonb_build_object('error','no matching committed replacement receipt is visible'); end if;
  return public.risk_uncertainty_replacement_receipt_payload(v_packet);
end $$;

create or replace function public.review_risk_uncertainty_analysis(
  p_analysis_id uuid,p_decision text,p_review_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_user uuid:=auth.uid();
  v_locked_org uuid; v_role text; v_risk_id uuid; r public.risks%rowtype;
  c public.risk_criteria_profiles%rowtype;
  a public.risk_uncertainty_analyses%rowtype; v_binding_count integer;
  v_current text; v_approval uuid; v_evidence uuid; v_approval_status text;
begin
  if v_user is null or v_org is null then return jsonb_build_object('error','authenticated organization member required'); end if;
  select role into v_role from public.user_profiles where id=v_user and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','uncertainty analysis review requires a named human engineering or management role');
  end if;
  if p_decision not in ('validated','rejected') then return jsonb_build_object('error','decision must be validated or rejected'); end if;
  if length(btrim(coalesce(p_review_note,'')))<20 then return jsonb_build_object('error','independent review basis requires at least 20 characters'); end if;
  -- Obtain only the scoped pointer before taking locks. Both submission and
  -- review lock the canonical risk first, avoiding packet/risk inversion.
  select risk_id into v_risk_id from public.risk_uncertainty_analyses
  where id=p_analysis_id and organization_id=v_org and public.can_read_risk(risk_id);
  if not found then return jsonb_build_object('error','same-tenant uncertainty analysis is not awaiting review'); end if;
  if public.risk_uncertainty_lock_visibility_context(v_org,v_risk_id) is distinct from true then
    return jsonb_build_object('error','risk not found in this organization');
  end if;
  select * into r from public.risks
  where id=v_risk_id and organization_id=v_org and public.can_read_risk(id) for update;
  if not found then return jsonb_build_object('error','same-tenant uncertainty analysis is not awaiting review'); end if;
  select * into a from public.risk_uncertainty_analyses
  where id=p_analysis_id and organization_id=v_org and risk_id=r.id for update;
  if not found or a.status<>'pending_review' then return jsonb_build_object('error','same-tenant uncertainty analysis is not awaiting review'); end if;
  if a.author_id=v_user then return jsonb_build_object('error','analysis author cannot independently review the same packet'); end if;
  -- Retain the CURRENT same-org policy through approval/evidence/audit commit.
  -- The risk lock stabilizes its pointer; this shared lock prevents a policy
  -- change after the digest check. Legacy metadata digests must also match the
  -- actual submitted policy instead of silently inheriting today's thresholds.
  select * into c from public.risk_criteria_profiles
  where id=r.criteria_profile_id and organization_id=v_org for share;
  if not found or c.status is distinct from 'adopted'
    or c.id is distinct from a.threshold_profile_id or c.decision_thresholds='{}'::jsonb
    or c.decision_thresholds is distinct from a.decision_thresholds then
    return jsonb_build_object('error','analysis changed after submission; submit a new version against the current evidence and thresholds');
  end if;
  perform 1 from public.evidence_items e join public.risk_uncertainty_analysis_evidence b on b.evidence_item_id=e.id
  where b.organization_id=v_org and b.analysis_id=a.id
    and e.organization_id=v_org and e.risk_id=r.id order by e.id for update of e;
  select organization_id,role into v_locked_org,v_role from public.user_profiles
  where id=v_user for share;
  if not found or auth.uid() is distinct from v_user or v_locked_org is distinct from v_org
    or public.app_current_org() is distinct from v_org
    or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','current named human engineering or management membership required');
  end if;
  if public.can_read_risk(r.id) is distinct from true then
    return jsonb_build_object('error','same-tenant uncertainty analysis is not awaiting review');
  end if;
  select count(*) into v_binding_count from public.risk_uncertainty_analysis_evidence b
  where b.organization_id=v_org and b.analysis_id=a.id;
  if v_binding_count not between 1 and 20 or (
    select count(*) from public.risk_uncertainty_analysis_evidence b
    join public.evidence_items e on e.id=b.evidence_item_id
    where b.organization_id=v_org and b.analysis_id=a.id
      and e.organization_id=v_org and e.risk_id=r.id and e.verification_status='verified'
  )<>v_binding_count then
    return jsonb_build_object('error','linked evidence is no longer verified; submit a new analysis version');
  end if;
  v_current:=public.risk_uncertainty_analysis_digest(v_org,a.id);
  if v_current is distinct from a.analysis_digest
    or public.risk_uncertainty_review_standing(v_org,a.id) is distinct from 'reviewable' then
    return jsonb_build_object('error','analysis changed after submission; submit a new version against the current evidence and thresholds');
  end if;
  if exists(select 1 from public.risk_uncertainty_analysis_evidence b
    join public.evidence_items e on e.id=b.evidence_item_id
    where b.organization_id=v_org and b.analysis_id=a.id and e.verification_status<>'verified') then
    return jsonb_build_object('error','linked evidence is no longer verified; submit a new analysis version');
  end if;
  v_approval_status:=case when p_decision='validated' then 'approved' else 'rejected' end;
  insert into public.approvals(
    organization_id,risk_id,status,owner_role,approver,reason,consequence_of_wrong,
    required_validation,decided_at,approver_user_id,approval_scope
  ) values(
    v_org,a.risk_id,v_approval_status,v_role,v_role,btrim(p_review_note),
    'An unsourced or stale uncertainty packet can conceal tail exposure, sensitivity and decision-critical evidence gaps.',
    'Independent review of the exact range, interval, case, sensitivity, value-of-information, threshold, trigger and evidence digest.',
    now(),v_user,jsonb_build_object('kind','risk_uncertainty_analysis','analysisId',a.id,
      'riskId',a.risk_id,'version',a.version,'analysisDigest',v_current,'operationalAuthorization',false)
  ) returning id into v_approval;
  if p_decision='validated' then
    insert into public.evidence_items(
      organization_id,risk_id,source_system,evidence_type,description,confidence_contribution,
      data_quality,ts,signal_kind,source_reference,provenance,evidence_class
    ) values(
      v_org,a.risk_id,'risk_operating_system','uncertainty_analysis',
      format('Validated uncertainty analysis v%s: probability %s–%s, %s confidence interval %s–%s, loss cases %s/%s/%s %s, VOI %s.',
        a.version,a.probability_lower,a.probability_upper,a.confidence_level,
        a.confidence_interval_lower,a.confidence_interval_upper,a.best_case_loss,
        a.expected_case_loss,a.worst_case_loss,a.currency,a.voi_recommendation),
      0,'unknown',now(),'uncertainty_analysis',a.id::text,
      jsonb_build_object('analysisId',a.id,'analysisDigest',a.analysis_digest,
        'approvalId',v_approval,'reviewedBy',v_user,'operationalAuthorization',false),
      'CALCULATED'
    ) returning id into v_evidence;
  end if;
  perform set_config('app.risk_uncertainty_write','granted',true);
  update public.risk_uncertainty_analyses set status=p_decision,reviewer_id=v_user,
    reviewed_at=now(),review_note=btrim(p_review_note),approval_id=v_approval,
    derived_evidence_item_id=v_evidence where id=a.id;
  update public.risks set value_of_information=value_of_information || jsonb_build_object(
    'analysis_id',a.id,'validation_status',p_decision,'reviewed_at',now(),
    'reviewed_by',v_user,'operational_authorization',false
  ),updated_at=now() where id=a.risk_id and organization_id=v_org;
  perform set_config('app.risk_uncertainty_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_uncertainty_analysis_reviewed',v_role,jsonb_build_object(
    'risk_id',a.risk_id,'analysis_id',a.id,'decision',p_decision,
    'analysis_digest',v_current,'approval_id',v_approval,'derived_evidence_item_id',v_evidence,
    'operational_authorization',false));
  return jsonb_build_object('riskId',a.risk_id,'analysisId',a.id,'decision',p_decision,
    'analysisDigest',v_current,'approvalId',v_approval,'derivedEvidenceItemId',v_evidence,
    'operationalAuthorization',false);
end $$;

create or replace function public.get_risk_uncertainty_workspace(p_risk_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); r public.risks%rowtype; c public.risk_criteria_profiles%rowtype;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','authenticated organization member required'); end if;
  select * into r from public.risks
  where id=p_risk_id and organization_id=v_org and public.can_read_risk(id);
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  select * into c from public.risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org;
  return jsonb_build_object(
    'organizationId',v_org,'actorId',auth.uid(),
    'risk',jsonb_build_object('id',r.id,'organizationId',r.organization_id,'title',r.title,'status',r.status,'currency',r.value_currency),
    'criteria',case when c.id is null then null else jsonb_build_object('id',c.id,'organizationId',c.organization_id,'name',c.name,
      'version',c.version,'status',c.status,'decisionThresholds',c.decision_thresholds,
      'policyDigest',public.risk_uncertainty_current_policy_digest(v_org,r.id)) end,
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'organizationId',e.organization_id,'riskId',e.risk_id,
      'description',e.description,'sourceSystem',e.source_system,'sourceReference',e.source_reference,
      'verificationStatus',e.verification_status,'verifiedBy',e.verified_by,'verifiedAt',e.verified_at,
      'evidenceClass',e.evidence_class,'qualityGrade',e.quality_grade,'applicabilityGrade',e.applicability_grade
    ) order by e.ts desc) from public.evidence_items e where e.organization_id=v_org and e.risk_id=r.id),'[]'::jsonb),
    'analyses',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'organizationId',a.organization_id,'riskId',a.risk_id,
      'version',a.version,'storedStatus',a.status,'validationStatus',case
        when a.analysis_digest is distinct from v_current then 'stale'
        else a.status end,'reviewStanding',a.review_standing,'method',a.method,'basis',a.basis,
      'probability',jsonb_build_object('lower',a.probability_lower,'central',a.probability_central,'upper',a.probability_upper),
      'confidence',jsonb_build_object('level',a.confidence_level,'lower',a.confidence_interval_lower,'upper',a.confidence_interval_upper),
      'lossCases',jsonb_build_object('best',a.best_case_loss,'expected',a.expected_case_loss,'worst',a.worst_case_loss,'currency',a.currency),
      'sensitivityInputs',a.sensitivity_inputs,'sensitivityResults',a.sensitivity_results,
      'thresholdProfileId',a.threshold_profile_id,'decisionThresholds',a.decision_thresholds,
      'reassessmentTriggers',to_jsonb(a.reassessment_triggers),'reviewDueAt',a.review_due_at,
      'valueOfInformation',jsonb_build_object('action',a.voi_action,'informationCost',a.voi_information_cost,
        'decisionCostIfWrong',a.voi_decision_cost_if_wrong,'uncertaintyReduction',a.voi_uncertainty_reduction,
        'probabilityDecisionChanges',a.voi_probability_decision_changes,'expectedValue',a.voi_expected_value,
        'netValue',a.voi_net_value,'recommendation',a.voi_recommendation),
      'analysisDigest',a.analysis_digest,'currentDigest',v_current,
      'digestVersion',a.digest_version,'digestCoverage',case a.digest_version
        when 1 then 'legacy_metadata' when 2 then 'evidence_content_and_current_criteria' else null end,
      'authorId',a.author_id,'createdAt',a.created_at,'reviewerId',a.reviewer_id,
      'reviewedAt',a.reviewed_at,'reviewNote',a.review_note,'approvalId',a.approval_id,
      'derivedEvidenceItemId',a.derived_evidence_item_id,
      'replacement',case when a.replaces_analysis_id is null then null else jsonb_build_object(
        'predecessorAnalysisId',a.replaces_analysis_id,'intentId',a.replacement_intent_id,
        'requestFingerprint',a.replacement_request_fingerprint,'compareAndSwap',a.replacement_compare_and_swap,
        'reason',a.replacement_reason) end,
      'supersession',case when a.superseded_by_analysis_id is null then null else jsonb_build_object(
        'successorAnalysisId',a.superseded_by_analysis_id,'at',a.superseded_at,'byUserId',a.superseded_by_user_id) end,
      'evidenceItemIds',coalesce((select jsonb_agg(b.evidence_item_id order by b.evidence_item_id)
        from public.risk_uncertainty_analysis_evidence b where b.organization_id=v_org and b.analysis_id=a.id),'[]'::jsonb),
      'operationalAuthorization',false
    ) order by a.version desc) from (
      select x.*,public.risk_uncertainty_analysis_digest(v_org,x.id) as v_current,
        public.risk_uncertainty_review_standing(v_org,x.id) as review_standing
      from public.risk_uncertainty_analyses x
      where x.organization_id=v_org and x.risk_id=r.id
    ) a),'[]'::jsonb),
    'boundary','Independent review validates the analysis packet. It does not verify an unverified source, accept risk, authorize operation, release work or commit spend.',
    'operationalAuthorization',false
  );
end $$;

revoke all on function public.enforce_risk_uncertainty_analysis_write() from public,anon,authenticated,service_role;
revoke all on function public.enforce_risk_uncertainty_replacement_pair() from public,anon,authenticated,service_role;
revoke all on function public.enforce_risk_uncertainty_evidence_link() from public,anon,authenticated,service_role;
revoke all on function public.refuse_risk_uncertainty_truncate() from public,anon,authenticated,service_role;
revoke all on function public.risk_uncertainty_analysis_digest(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.risk_uncertainty_analysis_digest_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.risk_uncertainty_current_policy_digest(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.risk_uncertainty_review_standing(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.risk_uncertainty_input_binding_snapshot(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.risk_uncertainty_evidence_digest_projection(public.evidence_items) from public,anon,authenticated,service_role;
revoke all on function public.risk_uncertainty_v2_digest_payload(public.risk_uncertainty_analyses,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.submit_risk_uncertainty_analysis_internal(uuid,jsonb,uuid[],jsonb) from public,anon,authenticated,service_role;
revoke all on function public.risk_uncertainty_replacement_receipt_payload(public.risk_uncertainty_analyses) from public,anon,authenticated,service_role;
revoke all on function public.replace_risk_uncertainty_analysis(uuid,text) from public,anon,service_role;
revoke all on function public.get_risk_uncertainty_replacement_receipt(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.replace_risk_uncertainty_analysis(uuid,text) to authenticated;
grant execute on function public.get_risk_uncertainty_replacement_receipt(uuid,uuid,text) to authenticated;
revoke all on function public.submit_risk_uncertainty_analysis(uuid,jsonb,uuid[]) from public,anon,service_role;
revoke all on function public.review_risk_uncertainty_analysis(uuid,text,text) from public,anon,service_role;
revoke all on function public.get_risk_uncertainty_workspace(uuid) from public,anon,service_role;
grant execute on function public.submit_risk_uncertainty_analysis(uuid,jsonb,uuid[]) to authenticated;
grant execute on function public.review_risk_uncertainty_analysis(uuid,text,text) to authenticated;
grant execute on function public.get_risk_uncertainty_workspace(uuid) to authenticated;

comment on table public.risk_uncertainty_analyses is
  'U18.02 versioned uncertainty packets on canonical risks. Independent review validates the analysis packet, never the operational decision.';
comment on column public.risk_uncertainty_analyses.decision_thresholds is
  'Exact snapshot of the adopted risk_criteria_profiles decision thresholds used by this analysis; never client-authored.';

-- Extend the ONE canonical restrictive risk-event policy, preserving every
-- existing family and secondary-parent guard. Tenant membership alone is not
-- permission to read a risk-bearing uncertainty receipt. This extension MUST
-- be the final composed definition, after risk_decision_preview_context.
drop policy if exists risk_decision_audit_sensitivity on public.audit_events;
create policy risk_decision_audit_sensitivity on public.audit_events
as restrictive
for select to authenticated
using (
  entity_type not in (
    'risk_analysis', 'risk_value_of_information', 'risk_treatment',
    'risk_treatment_readiness_correction', 'risk_secondary_created',
    'risk_uncertainty_analysis_submitted', 'risk_uncertainty_analysis_reviewed',
    'risk_uncertainty_analysis_replaced'
  )
  or (
    organization_id = public.app_current_org()
    and public.can_read_risk(public.sync_text_as_uuid(event_data->>'risk_id'))
    and (
      entity_type <> 'risk_secondary_created'
      or public.can_read_risk(public.sync_text_as_uuid(event_data->>'parent_risk_id'))
    )
  )
);
