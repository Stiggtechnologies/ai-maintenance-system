-- Canonical evidence mapping. Inert for intake until the independently approved
-- KB security/revision contract is installed; never infers a cleared receipt.
-- Historical source UUIDs remain retained after source deletion deliberately.
alter table public.evidence_items
  add column if not exists kb_document_id uuid,
  add column if not exists kb_source_revision bigint,
  add column if not exists kb_security_revision bigint,
  add column if not exists kb_content_sha256 text;
alter table public.evidence_items add constraint evidence_items_kb_basis_complete check (
  (num_nonnulls(kb_document_id,kb_source_revision,kb_security_revision,kb_content_sha256)=0)
  or (num_nonnulls(kb_document_id,kb_source_revision,kb_security_revision,kb_content_sha256)=4 and kb_source_revision>0 and kb_security_revision>0 and kb_content_sha256 ~ '^[0-9a-f]{64}$'));
create unique index evidence_items_kb_basis_identity on public.evidence_items(organization_id,kb_document_id,kb_source_revision,kb_security_revision)
  where kb_document_id is not null;

create or replace function public.guard_decision_case_kb_mapping()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if ((tg_op<>'INSERT' and old.kb_document_id is not null) or (tg_op<>'DELETE' and new.kb_document_id is not null))
    and coalesce(current_setting('syncai.decision_case_kb_mapping',true),'')<>'on' then
    raise exception using errcode='42501',message='Canonical document mappings are server-owned and retained for audit';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_decision_case_kb_mapping() from public,anon,authenticated,service_role;
create trigger decision_case_kb_mapping_guard before insert or update or delete on public.evidence_items
for each row execute function public.guard_decision_case_kb_mapping();

create or replace function public.get_decision_case_intake_mapping(p_workspace_id uuid,p_evidence_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_doc jsonb; v_case public.cowork_workspaces%rowtype;
  v_evidence public.evidence_items%rowtype; v_count integer; v_hash text;
begin
  if v_actor is null or v_org is null or not exists(select 1 from public.user_profiles where id=v_actor and organization_id=v_org) then
    raise exception using errcode='42501',message='Current tenant membership is required'; end if;
  if to_regprocedure('public.kb_document_review_fingerprint(uuid,text)') is null then
    raise exception using errcode='55000',message='Governed intake security contract is unavailable'; end if;
  select * into v_case from public.cowork_workspaces where id=p_workspace_id and organization_id=v_org and workspace_kind<>'sync';
  if not found or not exists(select 1 from jsonb_array_elements(coalesce(v_case.case_state->'evidence','[]'::jsonb)) e
    where e->>'durableReference'=p_evidence_id::text and e->>'persistence'='governed_reference') then
    raise exception using errcode='42501',message='Current case evidence mapping is unavailable'; end if;
  select * into v_evidence from public.evidence_items where id=p_evidence_id and organization_id=v_org and kb_document_id is not null;
  if not found then raise exception using errcode='42501',message='Canonical evidence mapping is unavailable'; end if;
  select to_jsonb(d) into v_doc from public.kb_intake_documents d where d.id=v_evidence.kb_document_id and d.organization_id=v_org;
  select count(*) into v_count from public.reliability_kb_chunks where organization_id=v_org and source_id=v_doc->>'source_id';
  if v_doc is null or v_doc->>'status' is distinct from 'indexed' or coalesce(v_doc->>'security_status','') not in ('cleared','released') or v_count=0 or v_count<>coalesce((v_doc->>'chunk_count')::integer,0)
    or coalesce((v_doc->>'content_revision')::bigint,0)<>v_evidence.kb_source_revision
    or coalesce((v_doc->>'security_revision')::bigint,0)<>v_evidence.kb_security_revision
    or v_doc->>'content_sha256' is distinct from v_evidence.kb_content_sha256 then
    raise exception using errcode='55000',message='Source basis changed or is unavailable; fresh human review is required'; end if;
  execute 'select public.kb_document_review_fingerprint($1,$2)' into v_hash using v_org,v_doc->>'source_id';
  if v_hash is distinct from v_evidence.kb_content_sha256 then
    raise exception using errcode='55000',message='Source content no longer matches its reviewed digest'; end if;
  return jsonb_build_object('organizationId',v_org,'caseId',v_case.id,'caseVersion',v_case.case_version,
    'documentId',v_evidence.kb_document_id,'evidenceItemId',v_evidence.id,'sourceId',v_doc->>'source_id',
    'sourceRevision',v_evidence.kb_source_revision,'securityRevision',v_evidence.kb_security_revision,'contentSha256',v_hash,
    'documentStatus',v_doc->>'status','securityStatus',v_doc->>'security_status','chunkCount',v_count);
end $$;
revoke all on function public.get_decision_case_intake_mapping(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_decision_case_intake_mapping(uuid,uuid) to authenticated;

create or replace function public.attach_decision_case_kb_source(p_workspace_id uuid,p_expected_version integer,p_source_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text; v_doc jsonb;
  v_case public.cowork_workspaces%rowtype; v_evidence_id uuid; v_binding jsonb; v_item jsonb; v_result jsonb;
  v_mapping jsonb; v_hash text; v_count integer; v_old_writer text:=coalesce(current_setting('syncai.decision_case_kb_mapping',true),'');
begin
  if v_actor is null or v_org is null then raise exception using errcode='42501',message='Authentication and tenant context required'; end if;
  if to_regprocedure('public.kb_document_review_fingerprint(uuid,text)') is null then
    raise exception using errcode='55000',message='Governed intake security contract is unavailable'; end if;
  if p_source_id is null or length(p_source_id) not between 3 and 160 then
    raise exception using errcode='22023',message='A bounded canonical source identity is required'; end if;
  -- Same gate as the independently reviewed KB proposal: before document or case row locks.
  perform pg_advisory_xact_lock(741881,569);
  select to_jsonb(d) into v_doc from public.kb_intake_documents d where d.organization_id=v_org and d.source_id=p_source_id for share;
  select * into v_case from public.cowork_workspaces where id=p_workspace_id and organization_id=v_org and workspace_kind<>'sync' for update;
  if not found then raise exception using errcode='42501',message='Decision Case is unavailable in this tenant'; end if;
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org for share;
  if coalesce(v_role,'') not in ('admin','reliability_engineer') or public.app_current_org() is distinct from v_org then
    raise exception using errcode='42501',message='Current named tenant administrator or reliability engineer required'; end if;
  if p_expected_version is null or p_expected_version<1 or v_case.case_version<>p_expected_version then
    raise exception using errcode='PT409',message='Decision Case conflict; reload before attaching evidence'; end if;
  select count(*) into v_count from public.reliability_kb_chunks where organization_id=v_org and source_id=p_source_id;
  if v_doc is null or v_doc->>'status' is distinct from 'indexed' or coalesce(v_doc->>'security_status','') not in ('cleared','released')
    or coalesce((v_doc->>'content_revision')::bigint,0)<1 or coalesce((v_doc->>'security_revision')::bigint,0)<1
    or coalesce(v_doc->>'content_sha256','') !~ '^[0-9a-f]{64}$' or v_count=0 or v_count<>coalesce((v_doc->>'chunk_count')::integer,0) then
    raise exception using errcode='55000',message='Source requires indexed, current, cleared or independently released security evidence'; end if;
  execute 'select public.kb_document_review_fingerprint($1,$2)' into v_hash using v_org,p_source_id;
  if v_hash is distinct from v_doc->>'content_sha256' then
    raise exception using errcode='55000',message='Source digest does not match current canonical content'; end if;
  select id into v_evidence_id from public.evidence_items where organization_id=v_org and kb_document_id=(v_doc->>'id')::uuid
    and kb_source_revision=(v_doc->>'content_revision')::bigint and kb_security_revision=(v_doc->>'security_revision')::bigint;
  if v_evidence_id is null then
    perform set_config('syncai.decision_case_kb_mapping','on',true);
    insert into public.evidence_items(organization_id,source_system,evidence_type,description,data_quality,
      kb_document_id,kb_source_revision,kb_security_revision,kb_content_sha256)
    values(v_org,'governed_kb','document','Canonical document reference; engineering interpretation requires human review','unreviewed',
      (v_doc->>'id')::uuid,(v_doc->>'content_revision')::bigint,(v_doc->>'security_revision')::bigint,v_hash) returning id into v_evidence_id;
    perform set_config('syncai.decision_case_kb_mapping',v_old_writer,true);
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v_case.case_state->'evidence','[]'::jsonb)) e where e->>'durableReference'=v_evidence_id::text) then
    raise exception using errcode='PT409',message='This exact source is already attached; reload the canonical case'; end if;
  v_binding:=jsonb_build_object('organizationId',v_org,'documentId',v_doc->>'id','evidenceItemId',v_evidence_id,
    'sourceId',p_source_id,'sourceRevision',(v_doc->>'content_revision')::bigint,'securityRevision',(v_doc->>'security_revision')::bigint,'contentSha256',v_hash);
  v_item:=jsonb_build_object('id','kb-'||v_evidence_id::text,'title','Governed document','summary','Canonical source reference recorded',
    'quality','medium','state','Indexed source; engineering approval separate','record','Knowledge source '||p_source_id,
    'finding','Canonical source and security review are recorded. Engineering interpretation requires review of the document.',
    'lineage','Tenant knowledge intake','sourceSystem','SyncAI governed document intake',
    'persistence','governed_reference','durableReference',v_evidence_id,'intakeBinding',v_binding);
  v_result:=public.apply_decision_case_command(p_workspace_id,p_expected_version,'add_evidence',
    jsonb_build_object('evidence',coalesce(v_case.case_state->'evidence','[]'::jsonb)||jsonb_build_array(v_item)));
  v_mapping:=public.get_decision_case_intake_mapping(p_workspace_id,v_evidence_id);
  return jsonb_build_object('mapping',v_mapping,'caseState',v_result->'caseState');
end $$;
revoke all on function public.attach_decision_case_kb_source(uuid,integer,text) from public,anon,service_role;
grant execute on function public.attach_decision_case_kb_source(uuid,integer,text) to authenticated;

-- Source mutations invalidate current case authority in the SAME transaction.
-- Previous evidence/disposition remains in canonical audit_events snapshots.
create or replace function public.invalidate_decision_case_kb_source()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_doc jsonb; v_old jsonb:=to_jsonb(old); v_case record; v_evidence jsonb; v_state jsonb; v_now timestamptz:=clock_timestamp();
  v_writer text:=coalesce(current_setting('syncai.decision_case_command',true),'');
begin
  if tg_op='UPDATE' then
    v_doc:=to_jsonb(new);
    if not(v_doc ? 'content_revision') then return new; end if;
    if v_doc is not distinct from v_old then return new; end if;
  end if;
  for v_case in select w.* from public.cowork_workspaces w where w.organization_id=old.organization_id and w.workspace_kind<>'sync'
    and exists(select 1 from jsonb_array_elements(coalesce(w.case_state->'evidence','[]'::jsonb)) item
      join public.evidence_items e on e.id::text=item->>'durableReference' and e.organization_id=w.organization_id
      where e.kb_document_id=old.id) order by w.id for update loop
    select coalesce(jsonb_agg(item order by ordinality),'[]'::jsonb) into v_evidence
      from jsonb_array_elements(coalesce(v_case.case_state->'evidence','[]'::jsonb)) with ordinality x(item,ordinality)
      where not exists(select 1 from public.evidence_items e where e.organization_id=old.organization_id and e.kb_document_id=old.id
        and e.id::text=item->>'durableReference');
    v_state:=public.decision_case_clear_disposition(v_case.case_state)||jsonb_build_object('evidence',v_evidence,'stage','evidence',
      'evidenceScore',0,'recommendation','Recommendation requires reassessment after source change.',
      'recommendationDetail','Previously supporting source is no longer current; inspect updated evidence before deciding.',
      'decisionMetrics','[]'::jsonb,'statusLabel','Source changed or became unavailable; fresh evidence and human disposition required',
      'revision',v_case.case_version+1,'updatedAt',v_now);
    perform set_config('syncai.decision_case_command','on',true);
    update public.cowork_workspaces set case_state=v_state,case_version=v_case.case_version+1,progress=35,status='active',
      next_action=v_state->>'statusLabel',updated_at=v_now where id=v_case.id and organization_id=old.organization_id;
    insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
      values(old.organization_id,'decision_case_command','source_guard',jsonb_build_object('workspaceId',v_case.id,'command','source_invalidated',
        'documentId',old.id,'version',v_case.case_version+1,'reason','Canonical source revision or availability changed'),v_case.case_state,v_state);
  end loop;
  perform set_config('syncai.decision_case_command',v_writer,true);
  return null;
end $$;
revoke all on function public.invalidate_decision_case_kb_source() from public,anon,authenticated,service_role;
create trigger decision_case_kb_source_invalidation after update or delete on public.kb_intake_documents
for each row execute function public.invalidate_decision_case_kb_source();
