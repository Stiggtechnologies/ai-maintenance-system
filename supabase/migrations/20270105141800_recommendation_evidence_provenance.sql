-- U17.01 / U17.02 — governed recommendation evidence provenance.
--
-- Canonical reuse:
--   * evidence_items remains the ONE evidence store;
--   * recommendations remains the ONE recommendation store;
--   * approvals and audit_events remain the authority and audit ledgers;
--   * compute_evidence_confidence remains the tenant-configured Q x A x F x V
--     calculation, including its named refusals.
--
-- The nine evidence LEVELS below answer what basis supports a recommendation.
-- They do not replace evidence_class, which answers what FORM the evidence
-- takes. Neither vocabulary is an ordinal trust score. Classification review
-- validates the label and source metadata; it does not verify the evidence's
-- truth, approve the recommendation, release work or authorize operation.

alter table public.evidence_items
  add column if not exists recommendation_evidence_level text
    check (recommendation_evidence_level is null or recommendation_evidence_level in (
      'verified_measurement','approved_inspection','confirmed_history',
      'engineering_calculation','oem_recommendation','industry_reference',
      'similar_asset_inference','expert_judgment','ai_hypothesis'
    )),
  add column if not exists recommendation_claim_role text
    check (recommendation_claim_role is null or recommendation_claim_role in (
      'supporting','contradicting','context'
    )),
  add column if not exists source_date date,
  add column if not exists recommendation_provenance_status text not null default 'unclassified'
    check (recommendation_provenance_status in (
      'unclassified','pending_review','validated','rejected'
    )),
  add column if not exists recommendation_provenance_recorded_by uuid references auth.users(id) on delete restrict,
  add column if not exists recommendation_provenance_recorded_at timestamptz,
  add column if not exists recommendation_provenance_reviewed_by uuid references auth.users(id) on delete restrict,
  add column if not exists recommendation_provenance_reviewed_at timestamptz,
  add column if not exists recommendation_provenance_review_note text,
  add column if not exists recommendation_provenance_approval_id uuid references public.approvals(id) on delete restrict;

alter table public.evidence_items
  drop constraint if exists evidence_recommendation_provenance_lifecycle;
alter table public.evidence_items
  add constraint evidence_recommendation_provenance_lifecycle check (
    (recommendation_provenance_status='unclassified'
      and recommendation_evidence_level is null
      and recommendation_claim_role is null
      and recommendation_provenance_recorded_by is null
      and recommendation_provenance_recorded_at is null
      and recommendation_provenance_reviewed_by is null
      and recommendation_provenance_reviewed_at is null
      and recommendation_provenance_review_note is null
      and recommendation_provenance_approval_id is null)
    or
    (recommendation_provenance_status<>'unclassified'
      and recommendation_id is not null
      and recommendation_evidence_level is not null
      and recommendation_claim_role is not null
      and length(btrim(coalesce(source_system,'')))>=2
      and length(btrim(coalesce(source_reference,'')))>=3
      and length(btrim(coalesce(revision,'')))>=1
      and source_date is not null
      and length(btrim(coalesce(applicability,'')))>=20
      and recommendation_provenance_recorded_by is not null
      and recommendation_provenance_recorded_at is not null)
  );

alter table public.evidence_items
  drop constraint if exists evidence_recommendation_provenance_reviewed;
alter table public.evidence_items
  add constraint evidence_recommendation_provenance_reviewed check (
    (recommendation_provenance_status in ('unclassified','pending_review')
      and recommendation_provenance_reviewed_by is null
      and recommendation_provenance_reviewed_at is null
      and recommendation_provenance_approval_id is null)
    or
    (recommendation_provenance_status in ('validated','rejected')
      and recommendation_provenance_reviewed_by is not null
      and recommendation_provenance_reviewed_by<>recommendation_provenance_recorded_by
      and recommendation_provenance_reviewed_at is not null
      and length(btrim(coalesce(recommendation_provenance_review_note,'')))>=20
      and recommendation_provenance_approval_id is not null)
  );

create index if not exists idx_evidence_recommendation_provenance
  on public.evidence_items(
    organization_id,recommendation_id,recommendation_provenance_status,
    recommendation_claim_role
  ) where recommendation_id is not null;

alter table public.recommendations
  add column if not exists missing_evidence text[] not null default '{}',
  add column if not exists missing_evidence_basis text,
  add column if not exists evidence_packet_status text not null default 'unrecorded'
    check (evidence_packet_status in ('unrecorded','pending_review','validated','rejected')),
  add column if not exists evidence_packet_digest text,
  add column if not exists evidence_packet_recorded_by uuid references auth.users(id) on delete restrict,
  add column if not exists evidence_packet_recorded_at timestamptz,
  add column if not exists evidence_packet_reviewed_by uuid references auth.users(id) on delete restrict,
  add column if not exists evidence_packet_reviewed_at timestamptz,
  add column if not exists evidence_packet_review_note text,
  add column if not exists evidence_packet_approval_id uuid references public.approvals(id) on delete restrict;

alter table public.recommendations
  drop constraint if exists recommendation_evidence_packet_lifecycle;
alter table public.recommendations
  add constraint recommendation_evidence_packet_lifecycle check (
    (evidence_packet_status='unrecorded'
      and cardinality(missing_evidence)=0
      and missing_evidence_basis is null
      and evidence_packet_digest is null
      and evidence_packet_recorded_by is null
      and evidence_packet_recorded_at is null
      and evidence_packet_reviewed_by is null
      and evidence_packet_reviewed_at is null
      and evidence_packet_review_note is null
      and evidence_packet_approval_id is null)
    or
    (evidence_packet_status<>'unrecorded'
      and length(btrim(coalesce(missing_evidence_basis,'')))>=20
      and evidence_packet_digest ~ '^[0-9a-f]{64}$'
      and evidence_packet_recorded_by is not null
      and evidence_packet_recorded_at is not null)
  );

alter table public.recommendations
  drop constraint if exists recommendation_evidence_packet_reviewed;
alter table public.recommendations
  add constraint recommendation_evidence_packet_reviewed check (
    (evidence_packet_status in ('unrecorded','pending_review')
      and evidence_packet_reviewed_by is null
      and evidence_packet_reviewed_at is null
      and evidence_packet_approval_id is null)
    or
    (evidence_packet_status in ('validated','rejected')
      and evidence_packet_reviewed_by is not null
      and evidence_packet_reviewed_by<>evidence_packet_recorded_by
      and evidence_packet_reviewed_at is not null
      and length(btrim(coalesce(evidence_packet_review_note,'')))>=20
      and evidence_packet_approval_id is not null)
  );

create or replace function public.enforce_recommendation_evidence_provenance()
returns trigger language plpgsql set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.recommendation_evidence_write',true),'');
begin
  if tg_op<>'DELETE' then
    if new.recommendation_id is not null
       and not exists(select 1 from public.recommendations r
         where r.id=new.recommendation_id and r.organization_id=new.organization_id) then
      raise exception 'recommendation evidence must link to a recommendation in the same organization';
    end if;
    -- The recommendation row is the packet's concurrency lock. Evidence
    -- mutation and exact-digest submission/review therefore serialize: a
    -- concurrent item is either included in the reviewed digest or makes the
    -- stored digest visibly stale after the review commits.
    if new.recommendation_id is not null then
      perform 1 from public.recommendations r
      where r.id=new.recommendation_id and r.organization_id=new.organization_id
      for update;
    end if;
  elsif old.recommendation_id is not null then
    perform 1 from public.recommendations r
    where r.id=old.recommendation_id and r.organization_id=old.organization_id
    for update;
  end if;
  if tg_op='INSERT' then
    if (
      new.recommendation_evidence_level is not null
      or new.recommendation_claim_role is not null
      or new.source_date is not null
      or new.recommendation_provenance_status<>'unclassified'
      or new.recommendation_provenance_recorded_by is not null
      or new.recommendation_provenance_recorded_at is not null
      or new.recommendation_provenance_reviewed_by is not null
      or new.recommendation_provenance_reviewed_at is not null
      or new.recommendation_provenance_review_note is not null
      or new.recommendation_provenance_approval_id is not null
    ) and v_marker<>'granted' then
      raise exception 'recommendation evidence provenance must start unclassified and use the governed classification function';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.recommendation_provenance_status<>'unclassified' then
      raise exception 'governed recommendation evidence provenance is immutable; record a new evidence item';
    end if;
    return old;
  end if;
  if old.recommendation_provenance_status in ('validated','rejected') and (
    new.recommendation_id is distinct from old.recommendation_id
    or new.source_system is distinct from old.source_system
    or new.source_reference is distinct from old.source_reference
    or new.revision is distinct from old.revision
    or new.source_date is distinct from old.source_date
    or new.applicability is distinct from old.applicability
    or new.recommendation_evidence_level is distinct from old.recommendation_evidence_level
    or new.recommendation_claim_role is distinct from old.recommendation_claim_role
    or new.recommendation_provenance_recorded_by is distinct from old.recommendation_provenance_recorded_by
    or new.recommendation_provenance_recorded_at is distinct from old.recommendation_provenance_recorded_at
  ) then
    raise exception 'validated recommendation evidence provenance is immutable; record a new evidence item';
  end if;
  if (
    new.recommendation_evidence_level is distinct from old.recommendation_evidence_level
    or new.recommendation_claim_role is distinct from old.recommendation_claim_role
    or new.source_date is distinct from old.source_date
    or new.recommendation_provenance_status is distinct from old.recommendation_provenance_status
    or new.recommendation_provenance_recorded_by is distinct from old.recommendation_provenance_recorded_by
    or new.recommendation_provenance_recorded_at is distinct from old.recommendation_provenance_recorded_at
    or new.recommendation_provenance_reviewed_by is distinct from old.recommendation_provenance_reviewed_by
    or new.recommendation_provenance_reviewed_at is distinct from old.recommendation_provenance_reviewed_at
    or new.recommendation_provenance_review_note is distinct from old.recommendation_provenance_review_note
    or new.recommendation_provenance_approval_id is distinct from old.recommendation_provenance_approval_id
    or (old.recommendation_provenance_status<>'unclassified' and (
      new.source_reference is distinct from old.source_reference
      or new.revision is distinct from old.revision
      or new.applicability is distinct from old.applicability
    ))
  ) and v_marker<>'granted' then
    raise exception 'recommendation evidence provenance changes require the governed classification and review functions';
  end if;
  return new;
end $$;

drop trigger if exists trg_recommendation_evidence_provenance on public.evidence_items;
create trigger trg_recommendation_evidence_provenance
  before insert or update or delete on public.evidence_items
  for each row execute function public.enforce_recommendation_evidence_provenance();

create or replace function public.refuse_evidence_items_truncate()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'canonical evidence history is immutable; truncate refused';
end $$;

drop trigger if exists trg_refuse_evidence_items_truncate on public.evidence_items;
create trigger trg_refuse_evidence_items_truncate
  before truncate on public.evidence_items
  for each statement execute function public.refuse_evidence_items_truncate();

create or replace function public.enforce_recommendation_evidence_packet()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then
    if (
      cardinality(new.missing_evidence)<>0
      or new.missing_evidence_basis is not null
      or new.evidence_packet_status<>'unrecorded'
      or new.evidence_packet_digest is not null
      or new.evidence_packet_recorded_by is not null
      or new.evidence_packet_recorded_at is not null
      or new.evidence_packet_reviewed_by is not null
      or new.evidence_packet_reviewed_at is not null
      or new.evidence_packet_review_note is not null
      or new.evidence_packet_approval_id is not null
    ) and coalesce(current_setting('app.recommendation_evidence_packet_write',true),'')<>'granted' then
      raise exception 'recommendation evidence packets must start unrecorded and use the governed packet functions';
    end if;
    return new;
  end if;
  if (
    new.missing_evidence is distinct from old.missing_evidence
    or new.missing_evidence_basis is distinct from old.missing_evidence_basis
    or new.evidence_packet_status is distinct from old.evidence_packet_status
    or new.evidence_packet_digest is distinct from old.evidence_packet_digest
    or new.evidence_packet_recorded_by is distinct from old.evidence_packet_recorded_by
    or new.evidence_packet_recorded_at is distinct from old.evidence_packet_recorded_at
    or new.evidence_packet_reviewed_by is distinct from old.evidence_packet_reviewed_by
    or new.evidence_packet_reviewed_at is distinct from old.evidence_packet_reviewed_at
    or new.evidence_packet_review_note is distinct from old.evidence_packet_review_note
    or new.evidence_packet_approval_id is distinct from old.evidence_packet_approval_id
  ) and coalesce(current_setting('app.recommendation_evidence_packet_write',true),'')<>'granted' then
    raise exception 'recommendation missing-evidence changes require the governed packet functions';
  end if;
  return new;
end $$;

drop trigger if exists trg_recommendation_evidence_packet on public.recommendations;
create trigger trg_recommendation_evidence_packet
  before insert or update on public.recommendations
  for each row execute function public.enforce_recommendation_evidence_packet();

create or replace function public.recommendation_evidence_packet_digest(
  p_organization_id uuid,p_recommendation_id uuid
) returns text language plpgsql stable security definer set search_path=public as $$
declare v_payload jsonb;
begin
  if not exists(select 1 from public.recommendations r
    where r.id=p_recommendation_id and r.organization_id=p_organization_id) then
    return null;
  end if;
  select jsonb_build_object(
    'recommendationId',r.id,
    'missingEvidence',to_jsonb(r.missing_evidence),
    'missingEvidenceBasis',r.missing_evidence_basis,
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'level',e.recommendation_evidence_level,
      'claimRole',e.recommendation_claim_role,
      'classificationStatus',e.recommendation_provenance_status,
      'sourceSystem',e.source_system,'sourceReference',e.source_reference,
      'revision',e.revision,'sourceDate',e.source_date,
      'applicability',e.applicability,'evidenceClass',e.evidence_class,
      'verificationStatus',e.verification_status
    ) order by e.id) from public.evidence_items e
      where e.organization_id=p_organization_id
        and e.recommendation_id=p_recommendation_id),'[]'::jsonb)
  ) into v_payload
  from public.recommendations r
  where r.id=p_recommendation_id and r.organization_id=p_organization_id;
  return encode(extensions.digest(v_payload::text,'sha256'),'hex');
end $$;

create or replace function public.propose_recommendation_evidence_classification(
  p_evidence_id uuid,p_evidence_level text,p_claim_role text,
  p_source_reference text,p_revision text,p_source_date date,p_applicability text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; e public.evidence_items%rowtype;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','recommendation evidence classification requires a human governance or engineering role');
  end if;
  select * into e from public.evidence_items
  where id=p_evidence_id and organization_id=v_org for update;
  if not found or e.recommendation_id is null then
    return jsonb_build_object('error','same-tenant recommendation-linked evidence item not found');
  end if;
  if not exists(select 1 from public.recommendations r
    where r.id=e.recommendation_id and r.organization_id=v_org) then
    return jsonb_build_object('error','same-tenant recommendation-linked evidence item not found');
  end if;
  if e.recommendation_provenance_status<>'unclassified' then
    return jsonb_build_object('error','this recommendation evidence item already has a governed classification; record a new evidence item if the basis changed');
  end if;
  if p_evidence_level not in (
    'verified_measurement','approved_inspection','confirmed_history',
    'engineering_calculation','oem_recommendation','industry_reference',
    'similar_asset_inference','expert_judgment','ai_hypothesis'
  ) then return jsonb_build_object('error','select one of the nine governed recommendation evidence levels'); end if;
  if p_claim_role not in ('supporting','contradicting','context') then
    return jsonb_build_object('error','claim role must be supporting, contradicting or context');
  end if;
  if length(btrim(coalesce(e.source_system,'')))<2 then
    return jsonb_build_object('error','the evidence item has no source system; record source provenance before classification');
  end if;
  if length(btrim(coalesce(p_source_reference,'')))<3
     or length(btrim(coalesce(p_revision,'')))<1
     or p_source_date is null
     or length(btrim(coalesce(p_applicability,'')))<20 then
    return jsonb_build_object('error','source reference, revision, source date and substantive applicability are required');
  end if;
  if p_source_date>current_date then
    return jsonb_build_object('error','source date cannot be in the future');
  end if;
  perform set_config('app.recommendation_evidence_write','granted',true);
  update public.evidence_items set
    recommendation_evidence_level=p_evidence_level,
    recommendation_claim_role=p_claim_role,
    source_reference=btrim(p_source_reference),revision=btrim(p_revision),
    source_date=p_source_date,applicability=btrim(p_applicability),
    recommendation_provenance_status='pending_review',
    recommendation_provenance_recorded_by=auth.uid(),
    recommendation_provenance_recorded_at=now()
  where id=e.id;
  perform set_config('app.recommendation_evidence_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'recommendation_evidence_classification_proposed',v_role,jsonb_build_object(
    'evidence_id',e.id,'recommendation_id',e.recommendation_id,
    'evidence_level',p_evidence_level,'claim_role',p_claim_role,
    'source_reference',btrim(p_source_reference),'revision',btrim(p_revision),
    'source_date',p_source_date,'applicability',btrim(p_applicability),
    'operational_authorization',false));
  return jsonb_build_object('evidenceId',e.id,'recommendationId',e.recommendation_id,
    'evidenceLevel',p_evidence_level,'claimRole',p_claim_role,
    'classificationStatus','pending_review','operationalAuthorization',false);
end $$;

create or replace function public.review_recommendation_evidence_classification(
  p_evidence_id uuid,p_decision text,p_review_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; e public.evidence_items%rowtype;
  v_approval uuid; v_status text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','recommendation evidence review requires a human governance or engineering role');
  end if;
  if p_decision not in ('validated','rejected') then
    return jsonb_build_object('error','decision must be validated or rejected');
  end if;
  if length(btrim(coalesce(p_review_note,'')))<20 then
    return jsonb_build_object('error','independent review basis requires at least 20 characters');
  end if;
  select * into e from public.evidence_items
  where id=p_evidence_id and organization_id=v_org for update;
  if not found or e.recommendation_provenance_status<>'pending_review' then
    return jsonb_build_object('error','same-tenant recommendation evidence classification is not awaiting review');
  end if;
  if e.recommendation_provenance_recorded_by=auth.uid() then
    return jsonb_build_object('error','classification author cannot independently review the same evidence item');
  end if;
  v_status:=case when p_decision='validated' then 'approved' else 'rejected' end;
  insert into public.approvals(
    organization_id,recommendation_id,status,owner_role,approver,reason,
    consequence_of_wrong,required_validation,decided_at,approver_user_id,approval_scope
  ) values(
    v_org,e.recommendation_id,v_status,v_role,v_role,btrim(p_review_note),
    'Misclassified or inapplicable evidence can make a recommendation appear better supported than it is.',
    'Independent review of the exact evidence item, source, revision, date, applicability, level and claim role.',
    now(),auth.uid(),jsonb_build_object('kind','recommendation_evidence_classification',
      'evidenceId',e.id,'recommendationId',e.recommendation_id,
      'evidenceLevel',e.recommendation_evidence_level,'claimRole',e.recommendation_claim_role,
      'sourceReference',e.source_reference,'revision',e.revision,'sourceDate',e.source_date,
      'applicability',e.applicability,'operationalAuthorization',false)
  ) returning id into v_approval;
  perform set_config('app.recommendation_evidence_write','granted',true);
  update public.evidence_items set
    recommendation_provenance_status=p_decision,
    recommendation_provenance_reviewed_by=auth.uid(),
    recommendation_provenance_reviewed_at=now(),
    recommendation_provenance_review_note=btrim(p_review_note),
    recommendation_provenance_approval_id=v_approval
  where id=e.id;
  perform set_config('app.recommendation_evidence_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'recommendation_evidence_classification_reviewed',v_role,jsonb_build_object(
    'evidence_id',e.id,'recommendation_id',e.recommendation_id,
    'decision',p_decision,'approval_id',v_approval,'operational_authorization',false));
  return jsonb_build_object('evidenceId',e.id,'recommendationId',e.recommendation_id,
    'decision',p_decision,'approvalId',v_approval,'operationalAuthorization',false);
end $$;

create or replace function public.set_recommendation_missing_evidence(
  p_recommendation_id uuid,p_missing_evidence text[],p_basis text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; r public.recommendations%rowtype;
  v_gaps text[]; v_digest text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','missing-evidence assessment requires a human governance or engineering role');
  end if;
  select * into r from public.recommendations
  where id=p_recommendation_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','recommendation not found in this organization'); end if;
  select coalesce(array_agg(x order by x),'{}') into v_gaps
  from (select distinct btrim(v) x from unnest(coalesce(p_missing_evidence,'{}')) v
        where btrim(v)<>'') q;
  if cardinality(v_gaps)>20
     or exists(select 1 from unnest(v_gaps) x where length(x)<5 or length(x)>500) then
    return jsonb_build_object('error','record at most twenty substantive missing-evidence statements');
  end if;
  if length(btrim(coalesce(p_basis,'')))<20 then
    return jsonb_build_object('error','state how completeness and the missing-evidence list were assessed');
  end if;
  perform set_config('app.recommendation_evidence_packet_write','granted',true);
  update public.recommendations set
    missing_evidence=v_gaps,missing_evidence_basis=btrim(p_basis),
    evidence_packet_status='pending_review',evidence_packet_digest=repeat('0',64),
    evidence_packet_recorded_by=auth.uid(),evidence_packet_recorded_at=now(),
    evidence_packet_reviewed_by=null,evidence_packet_reviewed_at=null,
    evidence_packet_review_note=null,evidence_packet_approval_id=null
  where id=r.id;
  v_digest:=public.recommendation_evidence_packet_digest(v_org,r.id);
  update public.recommendations set evidence_packet_digest=v_digest where id=r.id;
  perform set_config('app.recommendation_evidence_packet_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'recommendation_missing_evidence_recorded',v_role,jsonb_build_object(
    'recommendation_id',r.id,'missing_evidence',to_jsonb(v_gaps),
    'basis',btrim(p_basis),'packet_digest',v_digest,'operational_authorization',false));
  return jsonb_build_object('recommendationId',r.id,'missingEvidence',to_jsonb(v_gaps),
    'packetDigest',v_digest,'validationStatus','pending_review','operationalAuthorization',false);
end $$;

create or replace function public.review_recommendation_evidence_packet(
  p_recommendation_id uuid,p_decision text,p_review_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; r public.recommendations%rowtype;
  v_current text; v_approval uuid; v_status text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','evidence-packet review requires a human governance or engineering role');
  end if;
  if p_decision not in ('validated','rejected') then
    return jsonb_build_object('error','decision must be validated or rejected');
  end if;
  if length(btrim(coalesce(p_review_note,'')))<20 then
    return jsonb_build_object('error','independent packet review basis requires at least 20 characters');
  end if;
  select * into r from public.recommendations
  where id=p_recommendation_id and organization_id=v_org for update;
  if not found or r.evidence_packet_status<>'pending_review' then
    return jsonb_build_object('error','same-tenant recommendation evidence packet is not awaiting review');
  end if;
  if r.evidence_packet_recorded_by=auth.uid() then
    return jsonb_build_object('error','packet author cannot independently review the same missing-evidence assessment');
  end if;
  v_current:=public.recommendation_evidence_packet_digest(v_org,r.id);
  if v_current is distinct from r.evidence_packet_digest then
    return jsonb_build_object('error','evidence packet changed after submission; reassess missing evidence and submit a new digest');
  end if;
  v_status:=case when p_decision='validated' then 'approved' else 'rejected' end;
  insert into public.approvals(
    organization_id,recommendation_id,status,owner_role,approver,reason,
    consequence_of_wrong,required_validation,decided_at,approver_user_id,approval_scope
  ) values(
    v_org,r.id,v_status,v_role,v_role,btrim(p_review_note),
    'An incomplete or stale evidence packet can conceal conflict, uncertainty or a decision-critical gap.',
    'Independent review of the exact recommendation evidence digest, conflicts and declared missing evidence.',
    now(),auth.uid(),jsonb_build_object('kind','recommendation_evidence_packet',
      'recommendationId',r.id,'packetDigest',v_current,
      'missingEvidence',to_jsonb(r.missing_evidence),'operationalAuthorization',false)
  ) returning id into v_approval;
  perform set_config('app.recommendation_evidence_packet_write','granted',true);
  update public.recommendations set
    evidence_packet_status=p_decision,evidence_packet_reviewed_by=auth.uid(),
    evidence_packet_reviewed_at=now(),evidence_packet_review_note=btrim(p_review_note),
    evidence_packet_approval_id=v_approval
  where id=r.id;
  perform set_config('app.recommendation_evidence_packet_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'recommendation_evidence_packet_reviewed',v_role,jsonb_build_object(
    'recommendation_id',r.id,'decision',p_decision,'packet_digest',v_current,
    'approval_id',v_approval,'operational_authorization',false));
  return jsonb_build_object('recommendationId',r.id,'decision',p_decision,
    'packetDigest',v_current,'approvalId',v_approval,'operationalAuthorization',false);
end $$;

create or replace function public.get_recommendation_evidence_workspace(
  p_recommendation_id uuid
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); r public.recommendations%rowtype;
  v_current text; v_status text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select * into r from public.recommendations
  where id=p_recommendation_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','recommendation not found in this organization'); end if;
  v_current:=public.recommendation_evidence_packet_digest(v_org,r.id);
  v_status:=case
    when r.evidence_packet_status='unrecorded' then 'unrecorded'
    when r.evidence_packet_digest is distinct from v_current then 'stale'
    else r.evidence_packet_status end;
  return jsonb_build_object(
    'recommendation',jsonb_build_object('id',r.id,'title',r.title,'status',r.status),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',e.description,'evidenceType',e.evidence_type,
      'evidenceClass',e.evidence_class,'evidenceLevel',e.recommendation_evidence_level,
      'claimRole',e.recommendation_claim_role,'classificationStatus',e.recommendation_provenance_status,
      'sourceSystem',e.source_system,'sourceReference',e.source_reference,
      'revision',e.revision,'sourceDate',e.source_date,'observedAt',e.ts,
      'applicability',e.applicability,'verificationStatus',e.verification_status,
      'verifiedBy',e.verified_by,'verifiedAt',e.verified_at,
      'qualityGrade',e.quality_grade,'applicabilityGrade',e.applicability_grade,
      'confidence',public.compute_evidence_confidence(e.id),
      'recordedBy',e.recommendation_provenance_recorded_by,
      'reviewedBy',e.recommendation_provenance_reviewed_by,
      'reviewedAt',e.recommendation_provenance_reviewed_at,
      'reviewNote',e.recommendation_provenance_review_note
    ) order by case e.recommendation_claim_role when 'contradicting' then 1 when 'supporting' then 2 else 3 end,e.created_at)
      from public.evidence_items e where e.organization_id=v_org and e.recommendation_id=r.id),'[]'::jsonb),
    'missingEvidence',to_jsonb(r.missing_evidence),
    'missingEvidenceBasis',r.missing_evidence_basis,
    'packet',jsonb_build_object(
      'validationStatus',v_status,'storedDigest',r.evidence_packet_digest,
      'currentDigest',v_current,'recordedBy',r.evidence_packet_recorded_by,
      'reviewedBy',r.evidence_packet_reviewed_by,'reviewedAt',r.evidence_packet_reviewed_at,
      'reviewNote',r.evidence_packet_review_note),
    'posture',jsonb_build_object(
      'linkedEvidence',(select count(*) from public.evidence_items e where e.organization_id=v_org and e.recommendation_id=r.id),
      'validatedClassifications',(select count(*) from public.evidence_items e where e.organization_id=v_org and e.recommendation_id=r.id and e.recommendation_provenance_status='validated'),
      'supporting',(select count(*) from public.evidence_items e where e.organization_id=v_org and e.recommendation_id=r.id and e.recommendation_claim_role='supporting'),
      'contradicting',(select count(*) from public.evidence_items e where e.organization_id=v_org and e.recommendation_id=r.id and e.recommendation_claim_role='contradicting'),
      'context',(select count(*) from public.evidence_items e where e.organization_id=v_org and e.recommendation_id=r.id and e.recommendation_claim_role='context'),
      'unclassified',(select count(*) from public.evidence_items e where e.organization_id=v_org and e.recommendation_id=r.id and e.recommendation_provenance_status='unclassified'),
      'missingCount',cardinality(r.missing_evidence)),
    'levels',to_jsonb(array[
      'verified_measurement','approved_inspection','confirmed_history',
      'engineering_calculation','oem_recommendation','industry_reference',
      'similar_asset_inference','expert_judgment','ai_hypothesis']),
    'boundary','Evidence classification and packet validation make provenance, conflict and gaps visible. They do not verify an unverified source, approve the recommendation, release work, accept risk, commit spend or authorize operation.',
    'operationalAuthorization',false
  );
end $$;

revoke all on function public.enforce_recommendation_evidence_provenance() from public,anon,authenticated,service_role;
revoke all on function public.refuse_evidence_items_truncate() from public,anon,authenticated,service_role;
revoke all on function public.enforce_recommendation_evidence_packet() from public,anon,authenticated,service_role;
revoke all on function public.recommendation_evidence_packet_digest(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.propose_recommendation_evidence_classification(uuid,text,text,text,text,date,text) from public,anon,service_role;
revoke all on function public.review_recommendation_evidence_classification(uuid,text,text) from public,anon,service_role;
revoke all on function public.set_recommendation_missing_evidence(uuid,text[],text) from public,anon,service_role;
revoke all on function public.review_recommendation_evidence_packet(uuid,text,text) from public,anon,service_role;
revoke all on function public.get_recommendation_evidence_workspace(uuid) from public,anon,service_role;
grant execute on function public.propose_recommendation_evidence_classification(uuid,text,text,text,text,date,text) to authenticated;
grant execute on function public.review_recommendation_evidence_classification(uuid,text,text) to authenticated;
grant execute on function public.set_recommendation_missing_evidence(uuid,text[],text) to authenticated;
grant execute on function public.review_recommendation_evidence_packet(uuid,text,text) to authenticated;
grant execute on function public.get_recommendation_evidence_workspace(uuid) to authenticated;

comment on column public.evidence_items.recommendation_evidence_level is
  'U17.01 recommendation-support basis. Orthogonal to evidence_class and never an ordinal trust score.';
comment on column public.recommendations.missing_evidence is
  'U17.02 explicit decision-relevant gaps. Missing evidence is never fabricated as an evidence_items row.';
