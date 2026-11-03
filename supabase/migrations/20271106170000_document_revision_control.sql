-- E12.10 — document revision control for governed controlled documents.
--
-- kb_intake_documents remains the ONE document identity. This migration
-- extends that canonical row so a policy, data standard, form, specification
-- or work instruction can carry an exact revision, an independent approval
-- and an atomic supersession. It does not create a second document store.
-- Drawings, P&IDs, manuals, procedures, inspection records and engineering
-- standards stay on the C2.09 writers.
--
-- Approval records controlled standing only. It does not approve work,
-- accept risk, change an operating limit or authorize return to service.

alter table public.kb_intake_documents
  drop constraint if exists kb_intake_controlled_kind_check,
  drop constraint if exists kb_intake_control_canonical_source;

alter table public.kb_intake_documents
  add constraint kb_intake_controlled_kind_check check (
    controlled_kind is null or controlled_kind in (
      'drawing','pid','manual','procedure','inspection_record','engineering_standard',
      'policy','data_standard','form','specification','work_instruction'
    )
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
    or (controlled_kind in (
        'drawing','pid','manual',
        'policy','data_standard','form','specification','work_instruction'
      )
      and standard_work_id is null and governance_standard_id is null
      and evidence_item_id is null and inspection_plan_id is null)
  );

create or replace function public.submit_document_revision(
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
  v_kind text:=nullif(btrim(coalesce(p_record->>'kind','')),'');
  v_number text:=nullif(btrim(coalesce(p_record->>'documentNumber','')),'');
  v_revision text:=nullif(btrim(coalesce(p_record->>'revisionLabel','')),'');
  v_applicability text:=nullif(btrim(coalesce(p_record->>'applicability','')),'');
  v_basis text:=nullif(btrim(coalesce(p_record->>'basis','')),'');
  v_supersedes uuid;
  v_review_due timestamptz;
begin
  if v_org is null or v_actor is null or v_role='ai_admin'
     or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','Document revision control requires a named same-tenant human role; the AI operator is refused');
  end if;
  if v_kind in ('drawing','pid','manual','procedure','inspection_record','engineering_standard') then
    return jsonb_build_object('error','engineering document families stay on the technical-document door');
  end if;
  if v_kind not in ('policy','data_standard','form','specification','work_instruction')
     or length(coalesce(v_number,'')) not between 2 and 200
     or length(coalesce(v_revision,'')) not between 1 and 100
     or length(coalesce(v_applicability,'')) not between 20 and 8000
     or length(coalesce(v_basis,'')) not between 20 and 8000 then
    return jsonb_build_object('error','kind, bounded document number/revision, applicability and a 20-character control basis are required');
  end if;

  begin
    v_supersedes:=nullif(btrim(coalesce(p_record->>'supersedesDocumentId','')),'')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('error','supersedesDocumentId must be a document id when supplied');
  end;
  if nullif(btrim(coalesce(p_record->>'reviewDueAt','')),'') is not null then
    begin
      v_review_due:=btrim(p_record->>'reviewDueAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('error','review due must be a timestamp when supplied');
    end;
  end if;

  select * into v_doc from public.kb_intake_documents
  where id=p_document_id and organization_id=v_org for update;
  if not found then
    return jsonb_build_object('error','document is outside the active tenant');
  end if;
  if v_doc.controlled_kind is not null then
    return jsonb_build_object('error','this uploaded revision is already controlled and cannot be overwritten');
  end if;
  if v_doc.security_status not in ('cleared','released') then
    return jsonb_build_object('error','a quarantined or rejected upload cannot enter document revision control');
  end if;

  if v_supersedes is not null then
    select * into v_prior from public.kb_intake_documents
    where id=v_supersedes and organization_id=v_org for update;
    if not found or v_prior.control_status<>'effective'
       or v_prior.controlled_kind<>v_kind
       or lower(btrim(v_prior.document_number))<>lower(v_number) then
      return jsonb_build_object('error','supersession requires the currently effective same-tenant revision of the same document number and kind');
    end if;
  elsif exists(
    select 1 from public.kb_intake_documents d
    where d.organization_id=v_org and d.control_status='effective'
      and lower(btrim(d.document_number))=lower(v_number)
  ) then
    return jsonb_build_object('error','an effective revision already exists; identify it as superseded by this review candidate');
  end if;

  perform set_config('app.controlled_document_writer','governed',true);
  update public.kb_intake_documents set
    controlled_kind=v_kind,
    document_number=v_number,
    revision_label=v_revision,
    control_status='under_review',
    applicability=v_applicability,
    review_due_at=v_review_due,
    asset_id=null,
    site_id=null,
    standard_work_id=null,
    governance_standard_id=null,
    evidence_item_id=null,
    inspection_plan_id=null,
    supersedes_document_id=v_supersedes,
    superseded_by_document_id=null,
    control_basis=v_basis,
    controlled_by=v_actor,
    controlled_at=now(),
    reviewed_by=null,
    reviewed_at=null,
    review_basis=null
  where id=p_document_id and organization_id=v_org;

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(
    v_org,'document_revision',v_role,
    jsonb_build_object(
      'action','submitted_for_approval','documentId',p_document_id,
      'documentNumber',v_number,'revision',v_revision,'kind',v_kind,
      'actorId',v_actor,'basis',v_basis,'operationalAuthorization',false
    ),
    jsonb_build_object('controlStatus','unclassified'),
    jsonb_build_object('controlStatus','under_review','supersedesDocumentId',v_supersedes)
  );

  return jsonb_build_object(
    'documentId',p_document_id,
    'controlStatus','under_review',
    'documentNumber',v_number,
    'revisionLabel',v_revision,
    'kind',v_kind,
    'operationalAuthorization',false
  );
exception when unique_violation then
  return jsonb_build_object('error','this document number and revision already exists in the active tenant');
end $$;

revoke all on function public.submit_document_revision(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.submit_document_revision(uuid,jsonb)
  to authenticated;

create or replace function public.decide_document_revision(
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
  if v_org is null or v_actor is null or v_role='ai_admin'
     or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','Document revision approval requires a named same-tenant human role; the AI operator is refused');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','Document revision approval requires a verified factor and an AAL2 session');
  end if;
  if p_decision not in ('approved','rejected')
     or length(btrim(coalesce(p_basis,''))) not between 20 and 8000 then
    return jsonb_build_object('error','decision must be approved or rejected with 20-8000 characters of review basis');
  end if;

  select * into v_doc from public.kb_intake_documents
  where id=p_document_id and organization_id=v_org for update;
  if not found then
    return jsonb_build_object('error','document is outside the active tenant');
  end if;
  if v_doc.controlled_kind not in (
    'policy','data_standard','form','specification','work_instruction'
  ) then
    return jsonb_build_object('error','this door approves governed document revisions only');
  end if;
  if v_doc.control_status<>'under_review' then
    return jsonb_build_object('error','only an under-review document revision may be decided');
  end if;
  if v_doc.controlled_by=v_actor then
    return jsonb_build_object('error','the document controller cannot approve their own revision');
  end if;
  if v_doc.security_status not in ('cleared','released') then
    return jsonb_build_object('error','document security standing changed; approval is refused');
  end if;

  if p_decision='approved' and v_doc.supersedes_document_id is not null then
    select * into v_prior from public.kb_intake_documents
    where id=v_doc.supersedes_document_id and organization_id=v_org for update;
    if not found or v_prior.control_status<>'effective'
       or v_prior.controlled_kind<>v_doc.controlled_kind
       or lower(btrim(v_prior.document_number))<>lower(btrim(v_doc.document_number)) then
      return jsonb_build_object('error','the named prior revision is no longer the effective same-document revision');
    end if;
  elsif p_decision='approved' and exists(
    select 1 from public.kb_intake_documents d
    where d.organization_id=v_org and d.control_status='effective'
      and d.id<>v_doc.id
      and lower(btrim(d.document_number))=lower(btrim(v_doc.document_number))
    for update
  ) then
    return jsonb_build_object('error','another effective revision exists and was not named for supersession');
  end if;

  perform set_config('app.controlled_document_writer','governed',true);
  if p_decision='approved' and v_doc.supersedes_document_id is not null then
    update public.kb_intake_documents set
      control_status='superseded',
      superseded_by_document_id=v_doc.id
    where id=v_doc.supersedes_document_id and organization_id=v_org;
  end if;
  v_new_status:=case when p_decision='approved' then 'effective' else 'rejected' end;
  update public.kb_intake_documents set
    control_status=v_new_status,
    reviewed_by=v_actor,
    reviewed_at=now(),
    review_basis=btrim(p_basis),
    effective_at=case when p_decision='approved' then now() else null end
  where id=v_doc.id and organization_id=v_org;

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(
    v_org,'document_revision',v_role,
    jsonb_build_object(
      'action','revision_decided','documentId',v_doc.id,
      'documentNumber',v_doc.document_number,'revision',v_doc.revision_label,
      'decision',p_decision,'reviewerId',v_actor,'basis',btrim(p_basis),
      'segregationOfDuties',true,'aal','aal2','verifiedFactor',true,
      'operationalAuthorization',false
    ),
    jsonb_build_object('controlStatus','under_review'),
    jsonb_build_object(
      'controlStatus',v_new_status,
      'supersededDocumentId',v_doc.supersedes_document_id
    )
  );

  return jsonb_build_object(
    'documentId',v_doc.id,
    'controlStatus',v_new_status,
    'decision',p_decision,
    'supersededDocumentId',v_doc.supersedes_document_id,
    'segregationOfDuties',true,
    'operationalAuthorization',false
  );
exception when unique_violation then
  return jsonb_build_object('error','another revision of this document number is already effective in the active tenant');
end $$;

revoke all on function public.decide_document_revision(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.decide_document_revision(uuid,text,text)
  to authenticated;

create or replace function public.get_document_revision_register()
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
      and d.controlled_kind in (
        'policy','data_standard','form','specification','work_instruction'
      )
  ), kinds(kind) as (
    values ('policy'),('data_standard'),('form'),('specification'),('work_instruction')
  )
  select jsonb_build_object(
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'sourceId',d.source_id,'title',d.title,
      'documentClass',d.document_class,'kind',d.controlled_kind,
      'documentNumber',d.document_number,'revisionLabel',d.revision_label,
      'controlStatus',d.control_status,'securityStatus',d.security_status,
      'applicability',d.applicability,'effectiveAt',d.effective_at,
      'reviewDueAt',d.review_due_at,
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
      from kinds k where not exists(
        select 1 from docs d
        where d.controlled_kind=k.kind and d.control_status='effective'
      )),'[]'::jsonb),
    'decisionBoundary','Approving a document revision records controlled standing only. It does not approve work, accept risk, change an operating limit or authorize return to service.'
  )
$$;

revoke all on function public.get_document_revision_register()
  from public,anon,service_role;
grant execute on function public.get_document_revision_register()
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
      and d.controlled_kind in (
        'drawing','pid','manual','procedure','inspection_record','engineering_standard'
      )
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

comment on function public.submit_document_revision(uuid,jsonb) is
  'E12.10: submits one cleared tenant upload as a governed document revision. No operational authority.';
comment on function public.decide_document_revision(uuid,text,text) is
  'E12.10: independent AAL2 approval or rejection of an exact document revision, with atomic supersession.';
comment on function public.get_document_revision_register() is
  'E12.10: tenant document-revision register. Approval is controlled standing only.';

notify pgrst, 'reload schema';
