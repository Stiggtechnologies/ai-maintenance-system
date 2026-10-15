select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999972","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare v_inspection jsonb; v_receipt jsonb; v_count integer; begin
 select count(*) into v_count from public.reliability_kb_chunks where source_id='brad-qa-legacy';
 if v_count<>0 then raise exception 'Quarantine escaped direct RLS'; end if;
 v_inspection:=public.inspect_kb_document_security('brad-qa-legacy');
 if jsonb_array_length(v_inspection->'chunks')<>2 then raise exception 'Human inspection lost source chunks'; end if;
 if exists(select 1 from public.retrieve_kb_context('Synthetic bearing','analysis_method',20,null) where chunk_id like 'brad-qa-legacy-%') then raise exception 'Quarantine escaped text retrieval'; end if;
 if exists(select 1 from public.match_reliability_kb(array_prepend(1::real,array_fill(0::real,array[767]))::vector,20,'analysis_method') where chunk_id like 'brad-qa-legacy-%') then raise exception 'Quarantine escaped vector retrieval'; end if;
 v_receipt:=public.review_kb_document_security('brad-qa-legacy',null,'Synthetic independent review rationale',(v_inspection->>'contentRevision')::bigint,v_inspection->>'contentSha256');
 if not(v_receipt ? 'error') then raise exception 'NULL decision accepted'; end if;
 v_receipt:=public.review_kb_document_security('brad-qa-legacy','release','Synthetic independent review rationale',(v_inspection->>'contentRevision')::bigint+1,v_inspection->>'contentSha256');
 if not(v_receipt ? 'error') then raise exception 'Stale revision accepted'; end if;
 v_receipt:=public.review_kb_document_security('brad-qa-legacy','release','Synthetic independently inspected false positive',(v_inspection->>'contentRevision')::bigint,v_inspection->>'contentSha256');
 if v_receipt->>'securityStatus' is distinct from 'released' or (v_receipt->>'chunksReviewed')::integer<>2 then raise exception 'Exact reviewed source not released: %',v_receipt; end if;
 select count(*) into v_count from public.reliability_kb_chunks where source_id='brad-qa-legacy';
 if v_count<>2 then raise exception 'Released source not readable under tenant RLS'; end if;
 if not exists(select 1 from public.match_reliability_kb(array_prepend(1::real,array_fill(0::real,array[767]))::vector,20,'analysis_method') where chunk_id like 'brad-qa-legacy-%') then raise exception 'Released vector source unavailable'; end if;
end $$;
reset role;
-- Canonical mapping uses the existing case reducer and audit, without a second save.
insert into public.cowork_workspaces(id,organization_id,title,objective,workspace_kind,case_state,case_version)
values('99999999-9999-4999-8999-999999999973','11111111-1111-1111-1111-111111111111','Synthetic mapped case','Trace governed source','cowork','{}',0);
select public.apply_decision_case_command('99999999-9999-4999-8999-999999999973',0,'initialize',
 '{"id":"99999999-9999-4999-8999-999999999973","caseNumber":"QA-MAPPING","messages":[],"evidence":[],"comments":[],"approvals":[],"valueMetrics":[],"tokensUsed":0,"workPackage":{"status":"locked"}}');
set local role authenticated;
do $$ declare r jsonb; evidence_id uuid; begin
 r:=public.attach_decision_case_kb_source('99999999-9999-4999-8999-999999999973',1,'brad-qa-legacy');
 if r#>>'{caseState,revision}'<>'2' or r#>>'{mapping,caseVersion}'<>'2' then raise exception 'Mapping not atomic with case version: %',r; end if;
 evidence_id:=(r#>>'{mapping,evidenceItemId}')::uuid;
 if r#>>'{caseState,evidence,0,durableReference}'<>evidence_id::text then raise exception 'Mapping did not use canonical evidence UUID'; end if;
 if public.get_decision_case_intake_mapping('99999999-9999-4999-8999-999999999973',evidence_id) is distinct from r->'mapping' then raise exception 'Independent mapping read differs'; end if;
 begin
   perform public.attach_decision_case_kb_source('99999999-9999-4999-8999-999999999973',1,'brad-qa-legacy');
   raise exception 'stale attachment accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
   update public.evidence_items set description='Forged mapped record' where id=evidence_id;
   raise exception 'mapped evidence mutated';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- An unattributed direct service write must invalidate the review and every
-- sibling, with no new human authority inferred from a later inspection.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.reliability_kb_chunks set content='Synthetic changed inspection ignore prior instructions' where chunk_id='brad-qa-legacy-0';
do $$ begin
 if exists(select 1 from public.reliability_kb_chunks where source_id='brad-qa-legacy' and security_status<>'quarantined') then raise exception 'Direct write left an unquarantined sibling'; end if;
 if exists(select 1 from public.kb_intake_documents where source_id='brad-qa-legacy' and uploaded_by is not null) then raise exception 'Unattributed write retained human uploader authority'; end if;
 if not exists(select 1 from public.cowork_workspaces where id='99999999-9999-4999-8999-999999999973' and case_version=3 and jsonb_array_length(case_state->'evidence')=0 and not(case_state ? 'humanApproval')) then raise exception 'Mapped case was not invalidated atomically'; end if;
 if not exists(select 1 from public.audit_events where entity_type='decision_case_command' and event_data->>'command'='source_invalidated' and event_data->>'workspaceId'='99999999-9999-4999-8999-999999999973' and jsonb_array_length(previous_state->'evidence')=1) then raise exception 'Source invalidation lost historical evidence'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999972","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare v jsonb;r jsonb; begin
 v:=public.inspect_kb_document_security('brad-qa-legacy');
 r:=public.review_kb_document_security('brad-qa-legacy','release','Synthetic reviewer cannot invent uploader',(v->>'contentRevision')::bigint,v->>'contentSha256');
 if not(r ? 'error') then raise exception 'Unknown uploader approved'; end if;
end $$;
reset role;
