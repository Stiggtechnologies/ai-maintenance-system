-- C2.09 — controlled drawings, P&IDs, manuals, procedures, inspection
-- records and engineering standards.
--
-- kb_intake_documents remains the ONE document/intake record. This migration
-- adds document-control metadata and lifecycle to that canonical row; it does
-- not create a second content repository. Procedure, engineering-standard and
-- inspection-record authority must additionally resolve to the existing
-- standard_work, governance_standards and evidence_items stores.
--
-- Upload/security clearance is not engineering approval. A named human
-- registers the exact uploaded revision for review, and a different named
-- human with a verified MFA factor and an AAL2 session decides effectivity.
-- Effectivity grants document standing only: it does not approve work, change
-- a procedure, certify an inspection, accept risk or return equipment to
-- service.

alter table public.kb_intake_documents
  add column if not exists controlled_kind text,
  add column if not exists document_number text,
  add column if not exists revision_label text,
  add column if not exists control_status text not null default 'unclassified',
  add column if not exists applicability text,
  add column if not exists effective_at timestamptz,
  add column if not exists review_due_at timestamptz,
  add column if not exists asset_id uuid references public.assets(id) on delete restrict,
  add column if not exists site_id uuid references public.sites(id) on delete restrict,
  add column if not exists standard_work_id bigint references public.standard_work(id) on delete restrict,
  add column if not exists governance_standard_id uuid references public.governance_standards(id) on delete restrict,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists inspection_plan_id bigint references public.inspection_plans(id) on delete restrict,
  add column if not exists supersedes_document_id uuid references public.kb_intake_documents(id) on delete restrict,
  add column if not exists superseded_by_document_id uuid references public.kb_intake_documents(id) on delete restrict,
  add column if not exists control_basis text,
  add column if not exists controlled_by uuid references auth.users(id) on delete restrict,
  add column if not exists controlled_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete restrict,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_basis text;

alter table public.kb_intake_documents
  drop constraint if exists kb_intake_controlled_kind_check,
  drop constraint if exists kb_intake_control_status_check,
  drop constraint if exists kb_intake_control_lifecycle_complete,
  drop constraint if exists kb_intake_control_canonical_source,
  drop constraint if exists kb_intake_control_supersession_self;

alter table public.kb_intake_documents
  add constraint kb_intake_controlled_kind_check check (
    controlled_kind is null or controlled_kind in (
      'drawing','pid','manual','procedure','inspection_record','engineering_standard'
    )
  ),
  add constraint kb_intake_control_status_check check (
    control_status in ('unclassified','under_review','effective','superseded','rejected')
  ),
  add constraint kb_intake_control_lifecycle_complete check (
    (control_status='unclassified'
      and controlled_kind is null and document_number is null
      and revision_label is null and applicability is null
      and effective_at is null and review_due_at is null
      and asset_id is null and site_id is null and standard_work_id is null
      and governance_standard_id is null and evidence_item_id is null
      and inspection_plan_id is null and supersedes_document_id is null
      and superseded_by_document_id is null and control_basis is null
      and controlled_by is null and controlled_at is null
      and reviewed_by is null and reviewed_at is null and review_basis is null)
    or
    (control_status='under_review'
      and controlled_kind is not null
      and length(btrim(coalesce(document_number,''))) between 2 and 200
      and length(btrim(coalesce(revision_label,''))) between 1 and 100
      and length(btrim(coalesce(applicability,''))) between 20 and 8000
      and length(btrim(coalesce(control_basis,''))) between 20 and 8000
      and controlled_by is not null and controlled_at is not null
      and reviewed_by is null and reviewed_at is null and review_basis is null
      and effective_at is null and superseded_by_document_id is null)
    or
    (control_status in ('effective','superseded','rejected')
      and controlled_kind is not null
      and length(btrim(coalesce(document_number,''))) between 2 and 200
      and length(btrim(coalesce(revision_label,''))) between 1 and 100
      and length(btrim(coalesce(applicability,''))) between 20 and 8000
      and length(btrim(coalesce(control_basis,''))) between 20 and 8000
      and controlled_by is not null and controlled_at is not null
      and reviewed_by is not null and reviewed_at is not null
      and reviewed_by<>controlled_by
      and length(btrim(coalesce(review_basis,''))) between 20 and 8000
      and (control_status='rejected' or effective_at is not null)
      and (control_status<>'superseded' or superseded_by_document_id is not null))
  ),
  add constraint kb_intake_control_canonical_source check (
    (controlled_kind is null)
    or (controlled_kind='procedure' and standard_work_id is not null
      and governance_standard_id is null and evidence_item_id is null
      and inspection_plan_id is null)
    or (controlled_kind='engineering_standard' and governance_standard_id is not null
      and standard_work_id is null and evidence_item_id is null
      and inspection_plan_id is null)
    or (controlled_kind='inspection_record' and evidence_item_id is not null
      and standard_work_id is null and governance_standard_id is null)
    or (controlled_kind in ('drawing','pid','manual')
      and standard_work_id is null and governance_standard_id is null
      and evidence_item_id is null and inspection_plan_id is null)
  ),
  add constraint kb_intake_control_supersession_self check (
    supersedes_document_id is null or supersedes_document_id<>id
  );

create unique index if not exists kb_controlled_document_revision_unique
  on public.kb_intake_documents(
    organization_id,lower(btrim(document_number)),lower(btrim(revision_label))
  ) where controlled_kind is not null;

create unique index if not exists kb_controlled_document_one_effective
  on public.kb_intake_documents(organization_id,lower(btrim(document_number)))
  where control_status='effective';

create index if not exists kb_controlled_document_register_idx
  on public.kb_intake_documents(
    organization_id,controlled_kind,control_status,document_number
  ) where controlled_kind is not null;

create or replace function public.guard_controlled_technical_document()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_marker text:=coalesce(current_setting('app.controlled_document_writer',true),'');
begin
  if tg_op='DELETE' then
    if old.controlled_kind is not null and v_marker<>'governed' then
      raise exception 'Controlled technical-document history cannot be deleted or re-uploaded; register a superseding revision';
    end if;
    return old;
  end if;

  if old.controlled_kind is not null and v_marker<>'governed' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.source_id is distinct from old.source_id
    or new.title is distinct from old.title
    or new.document_class is distinct from old.document_class
    or new.document_type is distinct from old.document_type
    or new.original_filename is distinct from old.original_filename
    or new.status is distinct from old.status
    or new.page_count is distinct from old.page_count
    or new.chunk_count is distinct from old.chunk_count
    or new.uploaded_by is distinct from old.uploaded_by
    or new.uploaded_at is distinct from old.uploaded_at
    or new.error_message is distinct from old.error_message
    or new.controlled_kind is distinct from old.controlled_kind
    or new.document_number is distinct from old.document_number
    or new.revision_label is distinct from old.revision_label
    or new.control_status is distinct from old.control_status
    or new.applicability is distinct from old.applicability
    or new.effective_at is distinct from old.effective_at
    or new.review_due_at is distinct from old.review_due_at
    or new.asset_id is distinct from old.asset_id
    or new.site_id is distinct from old.site_id
    or new.standard_work_id is distinct from old.standard_work_id
    or new.governance_standard_id is distinct from old.governance_standard_id
    or new.evidence_item_id is distinct from old.evidence_item_id
    or new.inspection_plan_id is distinct from old.inspection_plan_id
    or new.supersedes_document_id is distinct from old.supersedes_document_id
    or new.superseded_by_document_id is distinct from old.superseded_by_document_id
    or new.control_basis is distinct from old.control_basis
    or new.controlled_by is distinct from old.controlled_by
    or new.controlled_at is distinct from old.controlled_at
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.review_basis is distinct from old.review_basis
  ) then
    raise exception 'Controlled technical-document content and lifecycle are immutable outside the governed review workflow';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_controlled_technical_document
  on public.kb_intake_documents;
create trigger trg_guard_controlled_technical_document
  before update or delete on public.kb_intake_documents
  for each row execute function public.guard_controlled_technical_document();

revoke all on function public.guard_controlled_technical_document()
  from public,anon,authenticated,service_role;

create or replace function public.controlled_document_human_role_allowed()
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1 from public.user_profiles p
    where p.id=auth.uid() and p.organization_id=public.app_current_org()
      and p.role in ('admin','maintenance_manager','reliability_engineer','planner')
      and p.role<>'ai_admin'
  )
$$;

revoke all on function public.controlled_document_human_role_allowed()
  from public,anon,authenticated,service_role;

create or replace function public.register_controlled_technical_document(
  p_document_id uuid,p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
  v_doc public.kb_intake_documents%rowtype;
  v_prior public.kb_intake_documents%rowtype;
  v_kind text:=nullif(btrim(p_record->>'kind'),'');
  v_number text:=nullif(btrim(p_record->>'documentNumber'),'');
  v_revision text:=nullif(btrim(p_record->>'revisionLabel'),'');
  v_applicability text:=nullif(btrim(p_record->>'applicability'),'');
  v_basis text:=nullif(btrim(p_record->>'basis'),'');
  v_asset uuid:=nullif(p_record->>'assetId','')::uuid;
  v_site uuid:=nullif(p_record->>'siteId','')::uuid;
  v_standard_work bigint:=nullif(p_record->>'standardWorkId','')::bigint;
  v_governance_standard uuid:=nullif(p_record->>'governanceStandardId','')::uuid;
  v_evidence uuid:=nullif(p_record->>'evidenceItemId','')::uuid;
  v_inspection_plan bigint:=nullif(p_record->>'inspectionPlanId','')::bigint;
  v_supersedes uuid:=nullif(p_record->>'supersedesDocumentId','')::uuid;
  v_review_due timestamptz:=nullif(p_record->>'reviewDueAt','')::timestamptz;
begin
  if v_org is null or v_actor is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','Controlled technical-document registration requires a named same-tenant human role; the AI operator is refused');
  end if;
  if v_kind not in ('drawing','pid','manual','procedure','inspection_record','engineering_standard')
     or length(coalesce(v_number,'')) not between 2 and 200
     or length(coalesce(v_revision,'')) not between 1 and 100
     or length(coalesce(v_applicability,'')) not between 20 and 8000
     or length(coalesce(v_basis,'')) not between 20 and 8000 then
    return jsonb_build_object('error','kind, bounded document number/revision, applicability and a 20-character control basis are required');
  end if;

  select * into v_doc from public.kb_intake_documents
  where id=p_document_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','document is outside the active tenant'); end if;
  if v_doc.controlled_kind is not null then
    return jsonb_build_object('error','this uploaded revision is already in the controlled register and cannot be overwritten');
  end if;
  if v_doc.security_status not in ('cleared','released') then
    return jsonb_build_object('error','a quarantined or rejected upload cannot enter engineering document control');
  end if;

  if v_asset is not null and not exists(select 1 from public.assets a where a.id=v_asset and a.organization_id=v_org) then
    return jsonb_build_object('error','asset applicability is outside the active tenant');
  end if;
  if v_site is not null and not exists(select 1 from public.sites s where s.id=v_site and s.organization_id=v_org) then
    return jsonb_build_object('error','site applicability is outside the active tenant');
  end if;
  if v_kind='procedure' then
    if v_standard_work is null or not exists(select 1 from public.standard_work s where s.id=v_standard_work and s.organization_id=v_org) then
      return jsonb_build_object('error','procedure control requires the canonical same-tenant standard_work record');
    end if;
  elsif v_standard_work is not null then
    return jsonb_build_object('error','standardWorkId is valid only for a controlled procedure');
  end if;
  if v_kind='engineering_standard' then
    if v_governance_standard is null or not exists(select 1 from public.governance_standards s where s.id=v_governance_standard and s.organization_id=v_org) then
      return jsonb_build_object('error','engineering-standard control requires the canonical same-tenant governance_standards record');
    end if;
  elsif v_governance_standard is not null then
    return jsonb_build_object('error','governanceStandardId is valid only for a controlled engineering standard');
  end if;
  if v_kind='inspection_record' then
    if v_evidence is null or not exists(select 1 from public.evidence_items e where e.id=v_evidence and e.organization_id=v_org and e.document_id=p_document_id) then
      return jsonb_build_object('error','inspection-record control requires canonical same-tenant evidence linked to this exact uploaded document');
    end if;
  elsif v_evidence is not null then
    return jsonb_build_object('error','evidenceItemId is valid only for a controlled inspection record');
  end if;
  if v_inspection_plan is not null and not exists(select 1 from public.inspection_plans i where i.id=v_inspection_plan and i.organization_id=v_org) then
    return jsonb_build_object('error','inspection plan is outside the active tenant');
  end if;
  if v_kind<>'inspection_record' and v_inspection_plan is not null then
    return jsonb_build_object('error','inspectionPlanId is valid only for a controlled inspection record');
  end if;

  if v_supersedes is not null then
    select * into v_prior from public.kb_intake_documents
    where id=v_supersedes and organization_id=v_org for update;
    if not found or v_prior.control_status<>'effective'
       or v_prior.controlled_kind<>v_kind
       or lower(btrim(v_prior.document_number))<>lower(v_number) then
      return jsonb_build_object('error','supersession requires the currently effective same-tenant revision of the same document number and kind');
    end if;
  elsif exists(select 1 from public.kb_intake_documents d
    where d.organization_id=v_org and d.control_status='effective'
      and lower(btrim(d.document_number))=lower(v_number)) then
    return jsonb_build_object('error','an effective revision already exists; identify it as superseded by this review candidate');
  end if;

  perform set_config('app.controlled_document_writer','governed',true);
  update public.kb_intake_documents set
    controlled_kind=v_kind,document_number=v_number,revision_label=v_revision,
    control_status='under_review',applicability=v_applicability,
    review_due_at=v_review_due,asset_id=v_asset,site_id=v_site,
    standard_work_id=v_standard_work,governance_standard_id=v_governance_standard,
    evidence_item_id=v_evidence,inspection_plan_id=v_inspection_plan,
    supersedes_document_id=v_supersedes,control_basis=v_basis,
    controlled_by=v_actor,controlled_at=now()
  where id=p_document_id;

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(v_org,'controlled_technical_document',v_role,
    jsonb_build_object('action','registered_for_review','documentId',p_document_id,
      'documentNumber',v_number,'revision',v_revision,'kind',v_kind,
      'actorId',v_actor,'basis',v_basis,'operationalAuthorization',false),
    jsonb_build_object('controlStatus','unclassified'),
    jsonb_build_object('controlStatus','under_review','supersedesDocumentId',v_supersedes));

  return jsonb_build_object('documentId',p_document_id,'controlStatus','under_review',
    'documentNumber',v_number,'revisionLabel',v_revision,'engineeringAuthority',false,
    'operationalAuthorization',false);
exception when unique_violation then
  return jsonb_build_object('error','this document number and revision already exists in the active tenant');
end $$;

revoke all on function public.register_controlled_technical_document(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.register_controlled_technical_document(uuid,jsonb)
  to authenticated;

create or replace function public.review_controlled_technical_document(
  p_document_id uuid,p_decision text,p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
  v_doc public.kb_intake_documents%rowtype;
  v_prior public.kb_intake_documents%rowtype;
  v_new_status text;
begin
  if v_org is null or v_actor is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','Controlled technical-document review requires a named same-tenant human role; the AI operator is refused');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','Document effectivity review requires a verified factor and an AAL2 session');
  end if;
  if p_decision not in ('effective','rejected')
     or length(btrim(coalesce(p_basis,''))) not between 20 and 8000 then
    return jsonb_build_object('error','decision must be effective or rejected with 20-8000 characters of review basis');
  end if;

  select * into v_doc from public.kb_intake_documents
  where id=p_document_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','document is outside the active tenant'); end if;
  if v_doc.control_status<>'under_review' then
    return jsonb_build_object('error','only an under-review document revision may be decided');
  end if;
  if v_doc.controlled_by=v_actor then
    return jsonb_build_object('error','the document controller cannot review their own revision');
  end if;
  if v_doc.security_status not in ('cleared','released') then
    return jsonb_build_object('error','document security standing changed; effectivity is refused');
  end if;

  if p_decision='effective' and v_doc.controlled_kind='procedure' and not exists(
    select 1 from public.standard_work s
    join public.procedure_translations t on t.standard_work_id=s.id
    where s.id=v_doc.standard_work_id and s.organization_id=v_org
      and t.organization_id=v_org and t.translation_status='human_verified'
      and t.verified_by is not null and t.verified_at is not null
  ) then
    return jsonb_build_object('error','a procedure document cannot be effective until its canonical standard_work content is human verified');
  end if;
  if p_decision='effective' and v_doc.controlled_kind='engineering_standard' and not exists(
    select 1 from public.governance_standards s
    where s.id=v_doc.governance_standard_id and s.organization_id=v_org
      and s.status='adopted' and s.adopted_by is not null and s.adopted_at is not null
  ) then
    return jsonb_build_object('error','an engineering-standard document cannot be effective until the canonical governance standard is adopted');
  end if;
  if p_decision='effective' and v_doc.controlled_kind='inspection_record' and not exists(
    select 1 from public.evidence_items e
    where e.id=v_doc.evidence_item_id and e.organization_id=v_org
      and e.document_id=v_doc.id and e.verification_status='verified'
  ) then
    return jsonb_build_object('error','an inspection record cannot be effective until its exact canonical evidence item is human verified');
  end if;

  if p_decision='effective' and v_doc.supersedes_document_id is not null then
    select * into v_prior from public.kb_intake_documents
    where id=v_doc.supersedes_document_id and organization_id=v_org for update;
    if not found or v_prior.control_status<>'effective'
       or v_prior.controlled_kind<>v_doc.controlled_kind
       or lower(btrim(v_prior.document_number))<>lower(btrim(v_doc.document_number)) then
      return jsonb_build_object('error','the named prior revision is no longer the effective same-document revision');
    end if;
  elsif p_decision='effective' and exists(
    select 1 from public.kb_intake_documents d
    where d.organization_id=v_org and d.control_status='effective'
      and lower(btrim(d.document_number))=lower(btrim(v_doc.document_number))
  ) then
    return jsonb_build_object('error','another effective revision exists and was not named for supersession');
  end if;

  perform set_config('app.controlled_document_writer','governed',true);
  if p_decision='effective' and v_doc.supersedes_document_id is not null then
    update public.kb_intake_documents set
      control_status='superseded',superseded_by_document_id=v_doc.id
    where id=v_doc.supersedes_document_id and organization_id=v_org;
  end if;
  v_new_status:=case when p_decision='effective' then 'effective' else 'rejected' end;
  update public.kb_intake_documents set
    control_status=v_new_status,reviewed_by=v_actor,reviewed_at=now(),
    review_basis=btrim(p_basis),
    effective_at=case when p_decision='effective' then now() else null end
  where id=v_doc.id;

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(v_org,'controlled_technical_document',v_role,
    jsonb_build_object('action','reviewed','documentId',v_doc.id,
      'documentNumber',v_doc.document_number,'revision',v_doc.revision_label,
      'decision',p_decision,'reviewerId',v_actor,'basis',btrim(p_basis),
      'segregationOfDuties',true,'aal','aal2','verifiedFactor',true,
      'operationalAuthorization',false),
    jsonb_build_object('controlStatus','under_review'),
    jsonb_build_object('controlStatus',v_new_status,
      'supersededDocumentId',v_doc.supersedes_document_id));

  return jsonb_build_object('documentId',v_doc.id,'controlStatus',v_new_status,
    'supersededDocumentId',v_doc.supersedes_document_id,
    'segregationOfDuties',true,'engineeringAuthority',false,
    'operationalAuthorization',false);
end $$;

revoke all on function public.review_controlled_technical_document(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.review_controlled_technical_document(uuid,text,text)
  to authenticated;

create or replace function public.get_controlled_technical_document_register()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with context as (select public.app_current_org() org),
  docs as (
    select d.* from public.kb_intake_documents d,context c
    where c.org is not null and d.organization_id=c.org
      and d.controlled_kind is not null
  ), kinds(kind) as (values
    ('drawing'),('pid'),('manual'),('procedure'),
    ('inspection_record'),('engineering_standard')
  )
  select jsonb_build_object(
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'sourceId',d.source_id,'title',d.title,
      'documentClass',d.document_class,'kind',d.controlled_kind,
      'documentNumber',d.document_number,'revisionLabel',d.revision_label,
      'controlStatus',d.control_status,'securityStatus',d.security_status,
      'applicability',d.applicability,'effectiveAt',d.effective_at,
      'reviewDueAt',d.review_due_at,'assetId',d.asset_id,'siteId',d.site_id,
      'standardWorkId',d.standard_work_id,
      'governanceStandardId',d.governance_standard_id,
      'evidenceItemId',d.evidence_item_id,'inspectionPlanId',d.inspection_plan_id,
      'supersedesDocumentId',d.supersedes_document_id,
      'supersededByDocumentId',d.superseded_by_document_id,
      'controlBasis',d.control_basis,'controlledBy',d.controlled_by,
      'controlledAt',d.controlled_at,'reviewedBy',d.reviewed_by,
      'reviewedAt',d.reviewed_at,'reviewBasis',d.review_basis
    ) order by d.document_number,d.controlled_at desc) from docs d),'[]'::jsonb),
    'coverage',coalesce((select jsonb_object_agg(k.kind,
      (select count(*) from docs d where d.controlled_kind=k.kind
        and d.control_status='effective')) from kinds k),'{}'::jsonb),
    'missingEffectiveKinds',coalesce((select jsonb_agg(k.kind order by k.kind)
      from kinds k where not exists(select 1 from docs d
        where d.controlled_kind=k.kind and d.control_status='effective')),'[]'::jsonb),
    'decisionBoundary','Document effectivity records controlled standing only. It does not approve work, alter standard work, certify inspection truth, accept risk, change operating limits or authorize return to service.'
  )
$$;

revoke all on function public.get_controlled_technical_document_register()
  from public,anon,service_role;
grant execute on function public.get_controlled_technical_document_register()
  to authenticated;

revoke insert,update,delete,truncate on public.kb_intake_documents
  from anon,authenticated;

comment on function public.register_controlled_technical_document(uuid,jsonb) is
  'C2.09: registers one existing tenant KB upload as a controlled technical-document revision under named-human authorship; no engineering or operational approval.';
comment on function public.review_controlled_technical_document(uuid,text,text) is
  'C2.09: independent AAL2 human disposition of exact document effectivity with canonical source and supersession gates.';

notify pgrst, 'reload schema';
