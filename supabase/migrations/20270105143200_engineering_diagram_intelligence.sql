-- C2.09 — governed Engineering Diagram Intelligence.
--
-- The exact effective kb_intake_documents revision remains the ONE document
-- record. The private object below is its immutable inference input, not a
-- second document register. Provider output remains machine evidence until a
-- named human maps diagram nodes to canonical assets. Publication creates
-- dependency_candidates only; the existing independent human review is the
-- sole path into asset_dependencies and operational authority is always false.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'engineering-diagrams','engineering-diagrams',false,26214400,
  array['image/png','image/jpeg','image/webp']::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create unique index if not exists kb_intake_documents_id_org_unique
  on public.kb_intake_documents(id,organization_id);
create unique index if not exists assets_id_org_unique
  on public.assets(id,organization_id);

-- Storage key: organization_id / controlled_document_id / sha256 / filename.
-- There is intentionally no authenticated UPDATE or DELETE policy:
-- engineering diagram source objects are immutable evidence.
drop policy if exists engineering_diagrams_read on storage.objects;
create policy engineering_diagrams_read on storage.objects for select to authenticated
using(
  bucket_id='engineering-diagrams'
  and (storage.foldername(name))[1]=public.app_current_org()::text
  and exists(
    select 1 from public.kb_intake_documents d
    where d.id=case when (storage.foldername(name))[2]
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[2])::uuid else null end
      and d.organization_id=public.app_current_org()
      and d.controlled_kind in ('pid','drawing')
      and d.status='indexed'
      and d.control_status='effective'
      and d.security_status in ('cleared','released')
  )
);

drop policy if exists engineering_diagrams_insert on storage.objects;
create policy engineering_diagrams_insert on storage.objects for insert to authenticated
with check(
  bucket_id='engineering-diagrams'
  and (storage.foldername(name))[1]=public.app_current_org()::text
  and public.controlled_document_human_role_allowed()
  and exists(
    select 1 from public.kb_intake_documents d
    where d.id=case when (storage.foldername(name))[2]
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[2])::uuid else null end
      and d.organization_id=public.app_current_org()
      and d.controlled_kind in ('pid','drawing')
      and d.status='indexed'
      and d.control_status='effective'
      and d.security_status in ('cleared','released')
  )
);

-- The storage service evaluates the INSERT policy as the authenticated
-- uploader. The predicate is a read-only SECURITY DEFINER role check, so the
-- policy caller needs EXECUTE without receiving any document-write authority.
grant execute on function public.controlled_document_human_role_allowed()
  to authenticated;

create or replace function public.engineering_diagram_valid_bbox(p_bbox jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare v_top_x numeric; v_top_y numeric; v_bottom_x numeric; v_bottom_y numeric;
begin
  if jsonb_typeof(p_bbox)<>'object'
     or jsonb_typeof(p_bbox->'topX')<>'number'
     or jsonb_typeof(p_bbox->'topY')<>'number'
     or jsonb_typeof(p_bbox->'bottomX')<>'number'
     or jsonb_typeof(p_bbox->'bottomY')<>'number' then return false; end if;
  v_top_x:=(p_bbox->>'topX')::numeric;
  v_top_y:=(p_bbox->>'topY')::numeric;
  v_bottom_x:=(p_bbox->>'bottomX')::numeric;
  v_bottom_y:=(p_bbox->>'bottomY')::numeric;
  return v_top_x between 0 and 1 and v_top_y between 0 and 1
    and v_bottom_x between 0 and 1 and v_bottom_y between 0 and 1
    and v_top_x<v_bottom_x and v_top_y<v_bottom_y;
exception when others then return false;
end $$;
revoke all on function public.engineering_diagram_valid_bbox(jsonb)
  from public,anon,authenticated;

create table if not exists public.engineering_diagram_runs(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null,
  source_object_path text not null,
  source_mime_type text not null check(source_mime_type in ('image/png','image/jpeg','image/webp')),
  source_size_bytes bigint not null check(source_size_bytes between 1 and 26214400),
  input_sha256 text not null check(input_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null default 'azure_pid_digitization'
    check(provider='azure_pid_digitization'),
  provider_pid_id text not null,
  provider_repository text not null default
    'https://github.com/Stiggtechnologies/digitization-of-piping-and-instrument-diagrams',
  provider_commit_sha text not null default
    'c51302e3ec34147c676ef6eedbdd7551ea908b05'
    check(provider_commit_sha ~ '^[0-9a-f]{40}$'),
  schema_version text not null default 'syncai-engineering-diagram-v1',
  idempotency_key text not null check(length(idempotency_key) between 8 and 200),
  status text not null default 'queued' check(status in(
    'queued','extracting','awaiting_graph','extracted','failed','superseded')),
  provider_job_id text,
  raw_result_sha256 text check(raw_result_sha256 is null or raw_result_sha256 ~ '^[0-9a-f]{64}$'),
  provider_manifest jsonb not null default '{}'::jsonb,
  node_count integer not null default 0 check(node_count between 0 and 5000),
  edge_count integer not null default 0 check(edge_count between 0 and 10000),
  error_code text,
  error_detail text,
  attempt_count integer not null default 0 check(attempt_count between 0 and 100),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint engineering_diagram_run_document_org_fk
    foreign key(document_id,organization_id)
    references public.kb_intake_documents(id,organization_id) on delete restrict,
  constraint engineering_diagram_provider_pid_is_run check(provider_pid_id=id::text),
  constraint engineering_diagram_run_terminal check(
    (status='extracted' and completed_at is not null and raw_result_sha256 is not null)
    or (status='failed' and completed_at is not null and error_code is not null)
    or status in ('queued','extracting','awaiting_graph','superseded'))
);
create unique index if not exists engineering_diagram_runs_id_org_unique
  on public.engineering_diagram_runs(id,organization_id);
create unique index if not exists engineering_diagram_run_idempotency_unique
  on public.engineering_diagram_runs(organization_id,idempotency_key);
create unique index if not exists engineering_diagram_run_input_unique
  on public.engineering_diagram_runs(organization_id,document_id,input_sha256,provider_commit_sha);
create index if not exists engineering_diagram_runs_org_status_idx
  on public.engineering_diagram_runs(organization_id,status,requested_at desc);

create table if not exists public.engineering_diagram_nodes(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  external_id text not null check(length(external_id) between 1 and 200),
  page_number integer not null default 1 check(page_number between 1 and 1000),
  node_kind text not null check(node_kind in(
    'equipment','instrument','connector','valve','piping','text','unknown')),
  symbol_class text not null check(length(symbol_class) between 1 and 500),
  label text,
  tag text,
  bbox jsonb not null check(public.engineering_diagram_valid_bbox(bbox)),
  confidence numeric not null check(confidence between 0 and 1),
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint engineering_diagram_node_run_org_fk
    foreign key(run_id,organization_id)
    references public.engineering_diagram_runs(id,organization_id) on delete cascade,
  unique(run_id,external_id)
);
create unique index if not exists engineering_diagram_nodes_id_org_unique
  on public.engineering_diagram_nodes(id,organization_id);

create table if not exists public.engineering_diagram_edges(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  external_id text not null check(length(external_id) between 1 and 240),
  source_node_id uuid not null,
  target_node_id uuid not null,
  flow_direction text not null check(flow_direction in('downstream','upstream','unknown')),
  relation_kind text not null default 'process_connection'
    check(relation_kind in('process_connection','instrument_signal','control_connection','unknown')),
  confidence numeric not null check(confidence between 0 and 1),
  segments jsonb not null default '[]'::jsonb check(jsonb_typeof(segments)='array'),
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint engineering_diagram_edge_run_org_fk
    foreign key(run_id,organization_id)
    references public.engineering_diagram_runs(id,organization_id) on delete cascade,
  constraint engineering_diagram_edge_source_org_fk
    foreign key(source_node_id,organization_id)
    references public.engineering_diagram_nodes(id,organization_id) on delete cascade,
  constraint engineering_diagram_edge_target_org_fk
    foreign key(target_node_id,organization_id)
    references public.engineering_diagram_nodes(id,organization_id) on delete cascade,
  check(source_node_id<>target_node_id),
  unique(run_id,external_id)
);
create unique index if not exists engineering_diagram_edges_id_org_unique
  on public.engineering_diagram_edges(id,organization_id);

create table if not exists public.engineering_diagram_asset_mappings(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  node_id uuid not null,
  asset_id uuid not null,
  status text not null default 'proposed' check(status in('proposed','accepted','rejected')),
  proposal_basis text not null check(length(btrim(proposal_basis)) between 20 and 8000),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_basis text,
  constraint engineering_diagram_mapping_run_org_fk
    foreign key(run_id,organization_id)
    references public.engineering_diagram_runs(id,organization_id) on delete cascade,
  constraint engineering_diagram_mapping_node_org_fk
    foreign key(node_id,organization_id)
    references public.engineering_diagram_nodes(id,organization_id) on delete cascade,
  constraint engineering_diagram_mapping_asset_org_fk
    foreign key(asset_id,organization_id)
    references public.assets(id,organization_id) on delete restrict,
  constraint engineering_diagram_mapping_review_complete check(
    (status='proposed' and reviewed_by is null and reviewed_at is null and review_basis is null)
    or (status in('accepted','rejected') and reviewed_by is not null
      and reviewed_at is not null and reviewed_by<>proposed_by
      and length(btrim(coalesce(review_basis,''))) between 20 and 8000))
);
create unique index if not exists engineering_diagram_mapping_open_unique
  on public.engineering_diagram_asset_mappings(node_id)
  where status in('proposed','accepted');

alter table public.engineering_diagram_runs enable row level security;
alter table public.engineering_diagram_nodes enable row level security;
alter table public.engineering_diagram_edges enable row level security;
alter table public.engineering_diagram_asset_mappings enable row level security;
drop policy if exists engineering_diagram_runs_read on public.engineering_diagram_runs;
create policy engineering_diagram_runs_read on public.engineering_diagram_runs
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists engineering_diagram_nodes_read on public.engineering_diagram_nodes;
create policy engineering_diagram_nodes_read on public.engineering_diagram_nodes
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists engineering_diagram_edges_read on public.engineering_diagram_edges;
create policy engineering_diagram_edges_read on public.engineering_diagram_edges
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists engineering_diagram_mappings_read on public.engineering_diagram_asset_mappings;
create policy engineering_diagram_mappings_read on public.engineering_diagram_asset_mappings
  for select to authenticated using(organization_id=public.app_current_org());
grant select on public.engineering_diagram_runs,public.engineering_diagram_nodes,
  public.engineering_diagram_edges,public.engineering_diagram_asset_mappings to authenticated;
revoke insert,update,delete,truncate on public.engineering_diagram_runs,
  public.engineering_diagram_nodes,public.engineering_diagram_edges,
  public.engineering_diagram_asset_mappings from anon,authenticated;

create or replace function public.prepare_engineering_diagram_upload(
  p_document_id uuid,p_filename text,p_mime_type text,p_size_bytes bigint,p_input_sha256 text
) returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_name text;
begin
  if v_org is null or v_actor is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','named same-tenant engineering authority is required'); end if;
  if p_mime_type not in('image/png','image/jpeg','image/webp')
     or p_size_bytes not between 1 and 26214400
     or coalesce(p_input_sha256,'') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error','a PNG, JPEG or WebP source up to 25 MB with lowercase SHA-256 is required'); end if;
  if not exists(select 1 from public.kb_intake_documents d
    where d.id=p_document_id and d.organization_id=v_org
      and d.controlled_kind in ('pid','drawing') and d.control_status='effective'
      and d.security_status in('cleared','released') and d.status='indexed') then
    return jsonb_build_object('error','source must be an effective security-cleared controlled P&ID or drawing revision'); end if;
  v_name:=left(regexp_replace(coalesce(nullif(btrim(p_filename),''),'diagram.png'),
    '[^A-Za-z0-9._-]+','-','g'),180);
  return jsonb_build_object('bucket','engineering-diagrams','objectPath',
    v_org::text||'/'||p_document_id::text||'/'||p_input_sha256||'/'||v_name,
    'immutable',true,'operationalAuthorization',false);
end $$;
revoke all on function public.prepare_engineering_diagram_upload(uuid,text,text,bigint,text)
  from public,anon,service_role;
grant execute on function public.prepare_engineering_diagram_upload(uuid,text,text,bigint,text)
  to authenticated;

create or replace function public.create_engineering_diagram_run(
  p_document_id uuid,p_object_path text,p_input_sha256 text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_run uuid;
  v_mime text; v_size bigint; v_existing public.engineering_diagram_runs%rowtype;
begin
  if v_org is null or v_actor is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','named same-tenant engineering authority is required; the AI operator is refused'); end if;
  if coalesce(p_input_sha256,'') !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_idempotency_key,''))) not between 8 and 200 then
    return jsonb_build_object('error','valid SHA-256 and idempotency key are required'); end if;
  if (storage.foldername(p_object_path))[1] is distinct from v_org::text
     or (storage.foldername(p_object_path))[2] is distinct from p_document_id::text
     or (storage.foldername(p_object_path))[3] is distinct from p_input_sha256 then
    return jsonb_build_object('error','source object path is not bound to this tenant, revision and checksum'); end if;
  if not exists(select 1 from public.kb_intake_documents d
    where d.id=p_document_id and d.organization_id=v_org
      and d.controlled_kind in('pid','drawing') and d.control_status='effective'
      and d.security_status in('cleared','released') and d.status='indexed') then
    return jsonb_build_object('error','source must remain an effective security-cleared controlled P&ID or drawing revision'); end if;
  select coalesce(o.metadata->>'mimetype',o.metadata->>'contentType'),
    coalesce(nullif(o.metadata->>'size','')::bigint,0)
    into v_mime,v_size from storage.objects o
    where o.bucket_id='engineering-diagrams' and o.name=p_object_path;
  if not found or v_mime not in('image/png','image/jpeg','image/webp')
     or v_size not between 1 and 26214400 then
    return jsonb_build_object('error','the private source object is missing or outside the bounded image contract'); end if;
  select * into v_existing from public.engineering_diagram_runs
    where organization_id=v_org and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.document_id<>p_document_id or v_existing.input_sha256<>p_input_sha256
       or v_existing.source_object_path<>p_object_path then
      return jsonb_build_object('error','idempotency key collision with different diagram input'); end if;
    return jsonb_build_object('runId',v_existing.id,'status',v_existing.status,
      'idempotentReplay',true,'operationalAuthorization',false);
  end if;
  v_run:=gen_random_uuid();
  insert into public.engineering_diagram_runs(
    id,organization_id,document_id,source_object_path,source_mime_type,
    source_size_bytes,input_sha256,provider_pid_id,idempotency_key,requested_by)
  values(v_run,v_org,p_document_id,p_object_path,v_mime,v_size,p_input_sha256,
    v_run::text,btrim(p_idempotency_key),v_actor);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'engineering_diagram_run',public.app_current_role(),jsonb_build_object(
    'action','queued','runId',v_run,'documentId',p_document_id,'inputSha256',p_input_sha256,
    'providerCommit','c51302e3ec34147c676ef6eedbdd7551ea908b05',
    'operationalAuthorization',false),null,jsonb_build_object('status','queued'));
  return jsonb_build_object('runId',v_run,'status','queued','idempotentReplay',false,
    'operationalAuthorization',false);
end $$;
revoke all on function public.create_engineering_diagram_run(uuid,text,text,text)
  from public,anon,service_role;
grant execute on function public.create_engineering_diagram_run(uuid,text,text,text)
  to authenticated;

create or replace function public.authorize_engineering_diagram_dispatch(p_run_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_run public.engineering_diagram_runs%rowtype;
begin
  if v_org is null or auth.uid() is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','authorized same-tenant human required'); end if;
  select * into v_run from public.engineering_diagram_runs
    where id=p_run_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','diagram run is outside the active tenant'); end if;
  if p_action='start' and v_run.status<>'queued' then
    return jsonb_build_object('error','only a queued run may start'); end if;
  if p_action='poll' and v_run.status not in('awaiting_graph','extracted','failed') then
    return jsonb_build_object('error','run is not awaiting graph completion'); end if;
  return jsonb_build_object('runId',v_run.id,'status',v_run.status,'authorized',true);
end $$;
revoke all on function public.authorize_engineering_diagram_dispatch(uuid,text)
  from public,anon,service_role;
grant execute on function public.authorize_engineering_diagram_dispatch(uuid,text)
  to authenticated;

create or replace function public.claim_engineering_diagram_run(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.engineering_diagram_runs%rowtype;
begin
  select * into v_run from public.engineering_diagram_runs where id=p_run_id for update;
  if not found then return jsonb_build_object('error','diagram run not found'); end if;
  if v_run.status='queued' then
    update public.engineering_diagram_runs set status='extracting',
      attempt_count=attempt_count+1,started_at=now(),updated_at=now()
      where id=v_run.id returning * into v_run;
  elsif v_run.status not in('extracting','awaiting_graph','extracted','failed') then
    return jsonb_build_object('error','diagram run cannot be claimed in its current state');
  end if;
  return jsonb_build_object('runId',v_run.id,'organizationId',v_run.organization_id,
    'documentId',v_run.document_id,'objectPath',v_run.source_object_path,
    'mimeType',v_run.source_mime_type,'inputSha256',v_run.input_sha256,
    'providerPidId',v_run.provider_pid_id,'status',v_run.status,
    'attemptCount',v_run.attempt_count);
end $$;
revoke all on function public.claim_engineering_diagram_run(uuid)
  from public,anon,authenticated;
grant execute on function public.claim_engineering_diagram_run(uuid) to service_role;

create or replace function public.mark_engineering_diagram_graph_submitted(
  p_run_id uuid,p_provider_job_id text,p_manifest jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if octet_length(coalesce(p_manifest,'{}'::jsonb)::text)>1048576 then
    raise exception 'malformed or unbounded provider output'; end if;
  update public.engineering_diagram_runs set status='awaiting_graph',
    provider_job_id=left(coalesce(p_provider_job_id,id::text),240),
    provider_manifest=coalesce(p_manifest,'{}'::jsonb),updated_at=now()
    where id=p_run_id and status='extracting';
  if not found then raise exception 'diagram run is not extracting'; end if;
end $$;
revoke all on function public.mark_engineering_diagram_graph_submitted(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.mark_engineering_diagram_graph_submitted(uuid,text,jsonb)
  to service_role;

create or replace function public.record_engineering_diagram_inference(
  p_run_id uuid,p_raw_result_sha256 text,p_nodes jsonb,p_edges jsonb,p_manifest jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.engineering_diagram_runs%rowtype; v_node_count int; v_edge_count int;
begin
  select * into v_run from public.engineering_diagram_runs where id=p_run_id for update;
  if not found or v_run.status not in('extracting','awaiting_graph') then
    raise exception 'diagram run is not accepting inference'; end if;
  if coalesce(p_raw_result_sha256,'') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_nodes)<>'array' or jsonb_typeof(p_edges)<>'array'
     or jsonb_typeof(coalesce(p_manifest,'{}'::jsonb))<>'object'
     or jsonb_array_length(p_nodes) not between 1 and 5000
     or jsonb_array_length(p_edges)>10000
     or octet_length(p_nodes::text)>8388608 or octet_length(p_edges::text)>8388608
     or octet_length(coalesce(p_manifest,'{}'::jsonb)::text)>1048576 then
    raise exception 'malformed or unbounded provider output'; end if;
  if exists(select 1 from jsonb_array_elements(p_nodes) n where
    jsonb_typeof(n)<>'object' or length(btrim(coalesce(n->>'externalId',''))) not between 1 and 200
    or coalesce(n->>'pageNumber','1') !~ '^[0-9]{1,4}$'
    or (n->>'pageNumber')::integer not between 1 and 1000
    or not public.engineering_diagram_valid_bbox(n->'bbox')
    or jsonb_typeof(n->'confidence')<>'number'
    or (n->>'confidence')::numeric not between 0 and 1
    or coalesce(n->>'nodeKind','') not in('equipment','instrument','connector','valve','piping','text','unknown')
    or length(btrim(coalesce(n->>'symbolClass',''))) not between 1 and 500) then
    raise exception 'malformed or unbounded provider output: invalid node'; end if;
  if (select count(*) from jsonb_array_elements(p_nodes))<>(select count(distinct n->>'externalId') from jsonb_array_elements(p_nodes) n) then
    raise exception 'malformed or unbounded provider output: duplicate node id'; end if;
  if exists(select 1 from jsonb_array_elements(p_edges) e where
    jsonb_typeof(e)<>'object' or length(btrim(coalesce(e->>'externalId',''))) not between 1 and 240
    or coalesce(e->>'sourceExternalId','')=coalesce(e->>'targetExternalId','')
    or coalesce(e->>'flowDirection','') not in('downstream','upstream','unknown')
    or coalesce(e->>'relationKind','') not in('process_connection','instrument_signal','control_connection','unknown')
    or jsonb_typeof(e->'confidence')<>'number' or (e->>'confidence')::numeric not between 0 and 1
    or jsonb_typeof(coalesce(e->'segments','[]'::jsonb))<>'array'
    or jsonb_array_length(coalesce(e->'segments','[]'::jsonb))>200
    or not exists(select 1 from jsonb_array_elements(p_nodes) n where n->>'externalId'=e->>'sourceExternalId')
    or not exists(select 1 from jsonb_array_elements(p_nodes) n where n->>'externalId'=e->>'targetExternalId')) then
    raise exception 'malformed or unbounded provider output: invalid edge'; end if;
  if (select count(*) from jsonb_array_elements(p_edges))<>(select count(distinct e->>'externalId') from jsonb_array_elements(p_edges) e) then
    raise exception 'malformed or unbounded provider output: duplicate edge id'; end if;

  insert into public.engineering_diagram_nodes(
    organization_id,run_id,external_id,page_number,node_kind,symbol_class,label,tag,bbox,confidence,provider_payload)
  select v_run.organization_id,v_run.id,n->>'externalId',coalesce((n->>'pageNumber')::int,1),
    n->>'nodeKind',n->>'symbolClass',nullif(n->>'label',''),nullif(n->>'tag',''),
    n->'bbox',(n->>'confidence')::numeric,coalesce(n->'providerPayload','{}'::jsonb)
  from jsonb_array_elements(p_nodes) n;
  insert into public.engineering_diagram_edges(
    organization_id,run_id,external_id,source_node_id,target_node_id,
    flow_direction,relation_kind,confidence,segments,provider_payload)
  select v_run.organization_id,v_run.id,e->>'externalId',s.id,t.id,e->>'flowDirection',
    e->>'relationKind',(e->>'confidence')::numeric,coalesce(e->'segments','[]'::jsonb),
    coalesce(e->'providerPayload','{}'::jsonb)
  from jsonb_array_elements(p_edges) e
  join public.engineering_diagram_nodes s on s.run_id=v_run.id and s.external_id=e->>'sourceExternalId'
  join public.engineering_diagram_nodes t on t.run_id=v_run.id and t.external_id=e->>'targetExternalId';
  get diagnostics v_edge_count=row_count;
  select count(*) into v_node_count from public.engineering_diagram_nodes where run_id=v_run.id;
  if v_edge_count<>jsonb_array_length(p_edges) then
    raise exception 'malformed or unbounded provider output: unresolved edge endpoints'; end if;
  update public.engineering_diagram_runs set status='extracted',raw_result_sha256=p_raw_result_sha256,
    provider_manifest=coalesce(p_manifest,'{}'::jsonb),node_count=v_node_count,
    edge_count=v_edge_count,completed_at=now(),updated_at=now(),error_code=null,error_detail=null
    where id=v_run.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_run.organization_id,'engineering_diagram_run','service_role',jsonb_build_object(
    'action','inference_recorded','runId',v_run.id,'documentId',v_run.document_id,
    'inputSha256',v_run.input_sha256,'rawResultSha256',p_raw_result_sha256,
    'nodeCount',v_node_count,'edgeCount',v_edge_count,'machineGenerated',true,
    'operationalAuthorization',false),jsonb_build_object('status',v_run.status),
    jsonb_build_object('status','extracted'));
  return jsonb_build_object('runId',v_run.id,'status','extracted','nodeCount',v_node_count,
    'edgeCount',v_edge_count,'machineGenerated',true,'operationalAuthorization',false);
end $$;
revoke all on function public.record_engineering_diagram_inference(uuid,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_engineering_diagram_inference(uuid,text,jsonb,jsonb,jsonb)
  to service_role;

create or replace function public.fail_engineering_diagram_run(
  p_run_id uuid,p_error_code text,p_error_detail text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.engineering_diagram_runs%rowtype; v_code text; v_detail text;
begin
  select * into v_run from public.engineering_diagram_runs
    where id=p_run_id and status in('queued','extracting','awaiting_graph') for update;
  if not found then return; end if;
  v_code:=left(coalesce(nullif(btrim(p_error_code),''),'provider_error'),100);
  v_detail:=left(coalesce(p_error_detail,'Provider inference failed'),2000);
  update public.engineering_diagram_runs set status='failed',
    error_code=v_code,error_detail=v_detail,
    completed_at=now(),updated_at=now()
    where id=v_run.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_run.organization_id,'engineering_diagram_run','service_role',jsonb_build_object(
    'action','provider_failed','runId',v_run.id,'documentId',v_run.document_id,
    'errorCode',v_code,'attemptCount',v_run.attempt_count,
    'operationalAuthorization',false),jsonb_build_object('status',v_run.status),
    jsonb_build_object('status','failed','errorCode',v_code));
end $$;
revoke all on function public.fail_engineering_diagram_run(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.fail_engineering_diagram_run(uuid,text,text) to service_role;

create or replace function public.retry_engineering_diagram_run(
  p_run_id uuid,p_basis text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid();
  v_run public.engineering_diagram_runs%rowtype;
begin
  if v_org is null or v_actor is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','named same-tenant engineering authority is required; the AI operator is refused'); end if;
  if length(btrim(coalesce(p_basis,''))) not between 20 and 8000 then
    return jsonb_build_object('error','20-8000 characters of retry basis are required'); end if;
  select r.* into v_run from public.engineering_diagram_runs r
    join public.kb_intake_documents d on d.id=r.document_id and d.organization_id=r.organization_id
    where r.id=p_run_id and r.organization_id=v_org and r.status='failed'
      and d.controlled_kind in('pid','drawing') and d.status='indexed'
      and d.control_status='effective' and d.security_status in('cleared','released')
    for update of r;
  if not found then
    return jsonb_build_object('error','failed run is outside the active tenant or its controlled source is no longer effective'); end if;
  if v_run.attempt_count>=100 then
    return jsonb_build_object('error','the bounded retry limit has been reached; provider configuration requires administrator review'); end if;
  update public.engineering_diagram_runs set status='queued',provider_job_id=null,
    provider_manifest='{}'::jsonb,raw_result_sha256=null,node_count=0,edge_count=0,
    error_code=null,error_detail=null,started_at=null,completed_at=null,updated_at=now()
    where id=v_run.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'engineering_diagram_run',public.app_current_role(),jsonb_build_object(
    'action','retry_queued','runId',v_run.id,'documentId',v_run.document_id,
    'basis',btrim(p_basis),'nextAttempt',v_run.attempt_count+1,
    'operationalAuthorization',false),jsonb_build_object('status','failed',
      'errorCode',v_run.error_code,'errorDetail',v_run.error_detail,
      'attemptCount',v_run.attempt_count,'providerJobId',v_run.provider_job_id,
      'providerManifest',v_run.provider_manifest),jsonb_build_object(
      'status','queued','attemptCount',v_run.attempt_count));
  return jsonb_build_object('runId',v_run.id,'status','queued',
    'nextAttempt',v_run.attempt_count+1,'operationalAuthorization',false);
end $$;
revoke all on function public.retry_engineering_diagram_run(uuid,text)
  from public,anon,service_role;
grant execute on function public.retry_engineering_diagram_run(uuid,text)
  to authenticated;

create or replace function public.propose_engineering_diagram_asset_mapping(
  p_node_id uuid,p_asset_id uuid,p_basis text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_node public.engineering_diagram_nodes%rowtype; v_id uuid;
begin
  if v_org is null or v_actor is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','named same-tenant engineering authority is required; the AI operator is refused'); end if;
  if length(btrim(coalesce(p_basis,''))) not between 20 and 8000 then
    return jsonb_build_object('error','20-8000 characters of mapping basis are required'); end if;
  select n.* into v_node from public.engineering_diagram_nodes n
    join public.engineering_diagram_runs r on r.id=n.run_id and r.organization_id=n.organization_id
    join public.kb_intake_documents d on d.id=r.document_id and d.organization_id=r.organization_id
    where n.id=p_node_id and n.organization_id=v_org and r.status='extracted'
      and d.status='indexed' and d.control_status='effective'
      and d.security_status in('cleared','released');
  if not found then return jsonb_build_object('error','node is outside the active tenant or its source revision is not effective'); end if;
  if not exists(select 1 from public.assets a where a.id=p_asset_id and a.organization_id=v_org) then
    return jsonb_build_object('error','asset is outside the active tenant'); end if;
  insert into public.engineering_diagram_asset_mappings(
    organization_id,run_id,node_id,asset_id,proposal_basis,proposed_by)
  values(v_org,v_node.run_id,v_node.id,p_asset_id,btrim(p_basis),v_actor) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'engineering_diagram_asset_mapping',public.app_current_role(),jsonb_build_object(
    'action','proposed','mappingId',v_id,'nodeId',p_node_id,'assetId',p_asset_id,
    'basis',btrim(p_basis),'operationalAuthorization',false),null,jsonb_build_object('status','proposed'));
  return jsonb_build_object('mappingId',v_id,'status','proposed','operationalAuthorization',false);
exception when unique_violation then
  return jsonb_build_object('error','this node already has an open or accepted asset mapping');
end $$;
revoke all on function public.propose_engineering_diagram_asset_mapping(uuid,uuid,text)
  from public,anon,service_role;
grant execute on function public.propose_engineering_diagram_asset_mapping(uuid,uuid,text)
  to authenticated;

create or replace function public.review_engineering_diagram_asset_mapping(
  p_mapping_id uuid,p_decision text,p_basis text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid();
  v_mapping public.engineering_diagram_asset_mappings%rowtype;
begin
  if v_org is null or v_actor is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','named same-tenant engineering authority is required; the AI operator is refused'); end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','mapping review requires a verified factor and an AAL2 session'); end if;
  if p_decision not in('accepted','rejected') or length(btrim(coalesce(p_basis,''))) not between 20 and 8000 then
    return jsonb_build_object('error','decision must be accepted or rejected with 20-8000 characters of basis'); end if;
  select * into v_mapping from public.engineering_diagram_asset_mappings
    where id=p_mapping_id and organization_id=v_org and status='proposed' for update;
  if not found then return jsonb_build_object('error','open mapping is outside the active tenant'); end if;
  if v_mapping.proposed_by=v_actor then
    return jsonb_build_object('error','the mapping proposer cannot review their own mapping'); end if;
  if not exists(select 1 from public.engineering_diagram_runs r
    join public.kb_intake_documents d on d.id=r.document_id and d.organization_id=r.organization_id
    where r.id=v_mapping.run_id and r.organization_id=v_org and r.status='extracted'
      and d.status='indexed' and d.control_status='effective'
      and d.security_status in('cleared','released')) then
    return jsonb_build_object('error','controlled diagram standing changed; mapping review is refused'); end if;
  update public.engineering_diagram_asset_mappings set status=p_decision,
    reviewed_by=v_actor,reviewed_at=now(),review_basis=btrim(p_basis)
    where id=v_mapping.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'engineering_diagram_asset_mapping',public.app_current_role(),jsonb_build_object(
    'action','reviewed','mappingId',v_mapping.id,'decision',p_decision,
    'basis',btrim(p_basis),'segregationOfDuties',true,'aal','aal2',
    'operationalAuthorization',false),jsonb_build_object('status','proposed'),jsonb_build_object('status',p_decision));
  return jsonb_build_object('mappingId',v_mapping.id,'status',p_decision,
    'segregationOfDuties',true,'operationalAuthorization',false);
end $$;
revoke all on function public.review_engineering_diagram_asset_mapping(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.review_engineering_diagram_asset_mapping(uuid,text,text)
  to authenticated;

alter table public.dependency_candidates
  add column if not exists source_kind text not null default 'derived',
  add column if not exists source_ref jsonb not null default '{}'::jsonb,
  add column if not exists proposed_by uuid references auth.users(id) on delete set null;
alter table public.dependency_candidates drop constraint if exists dependency_candidates_source_kind_check;
alter table public.dependency_candidates add constraint dependency_candidates_source_kind_check
  check(source_kind in('derived','engineering_diagram'));
create unique index if not exists dependency_candidates_diagram_source_unique
  on public.dependency_candidates(organization_id,group_key)
  where source_kind='engineering_diagram';

create or replace function public.guard_engineering_diagram_candidate_review()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.source_kind='engineering_diagram' and old.status='open' and new.status in('confirmed','rejected') then
    if auth.uid() is null or auth.uid()=old.proposed_by then
      raise exception 'diagram candidate proposer cannot review their own candidate'; end if;
    if not public.controlled_document_human_role_allowed()
       or not public.app_actor_has_verified_mfa(auth.uid()) or public.app_current_aal()<>'aal2' then
      raise exception 'diagram candidate review requires independent named-human AAL2 authority'; end if;
    if coalesce(old.source_ref->>'runId','') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or not exists(
         select 1 from public.engineering_diagram_runs r
         join public.kb_intake_documents d
           on d.id=r.document_id and d.organization_id=r.organization_id
         where r.id=(old.source_ref->>'runId')::uuid
           and r.organization_id=old.organization_id
           and r.status='extracted'
           and d.controlled_kind in('pid','drawing')
           and d.status='indexed'
           and d.control_status='effective'
           and d.security_status in('cleared','released')
       ) then
      raise exception 'diagram candidate source revision is no longer effective and review is refused'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_engineering_diagram_candidate_review on public.dependency_candidates;
create trigger trg_guard_engineering_diagram_candidate_review before update of status
  on public.dependency_candidates for each row execute function public.guard_engineering_diagram_candidate_review();
revoke all on function public.guard_engineering_diagram_candidate_review()
  from public,anon,authenticated,service_role;

create or replace function public.publish_engineering_diagram_dependency_candidates(
  p_run_id uuid,p_candidates jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid();
  v_run public.engineering_diagram_runs%rowtype; v_item jsonb; v_edge public.engineering_diagram_edges%rowtype;
  v_dependent uuid; v_supplier uuid; v_kind text; v_basis text; v_count int:=0;
begin
  if v_org is null or v_actor is null or not public.controlled_document_human_role_allowed() then
    return jsonb_build_object('error','named same-tenant engineering authority is required; the AI operator is refused'); end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','diagram candidate publication requires a verified factor and an AAL2 session'); end if;
  if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates) not between 1 and 200 then
    return jsonb_build_object('error','1-200 explicitly oriented dependency candidates are required'); end if;
  select r.* into v_run from public.engineering_diagram_runs r
    join public.kb_intake_documents d on d.id=r.document_id and d.organization_id=r.organization_id
    where r.id=p_run_id and r.organization_id=v_org and r.status='extracted'
      and d.controlled_kind in('pid','drawing') and d.status='indexed'
      and d.control_status='effective'
      and d.security_status in('cleared','released');
  if not found then return jsonb_build_object('error','run is outside the active tenant or the exact controlled revision is no longer effective'); end if;
  -- Expected validation failures are caught outside this nested block so every
  -- insert in the batch is rolled back before an error envelope is returned.
  -- Without the subtransaction, a valid first candidate followed by an invalid
  -- second candidate would leave an unaudited partial publication behind.
  begin
    for v_item in select value from jsonb_array_elements(p_candidates) loop
      begin
        v_dependent:=(v_item->>'dependentAssetId')::uuid;
        v_supplier:=(v_item->>'supplierAssetId')::uuid;
      exception when others then
        raise exception using errcode='22023',message='candidate asset ids must be UUIDs';
      end;
      v_kind:=v_item->>'dependencyKind'; v_basis:=btrim(coalesce(v_item->>'basis',''));
      if v_dependent=v_supplier or v_kind not in('functional','utility','topological','control','geographic','logistical')
         or length(v_basis) not between 20 and 8000 then
        raise exception using errcode='22023',message='each candidate requires different endpoint assets, canonical dependency_kind and 20-8000 characters of basis'; end if;
      select * into v_edge from public.engineering_diagram_edges
        where id=case when coalesce(v_item->>'edgeId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (v_item->>'edgeId')::uuid else null end
          and run_id=v_run.id and organization_id=v_org;
      if not found then
        raise exception using errcode='22023',message='candidate edge is outside the selected run'; end if;
      if not exists(
        select 1 from public.engineering_diagram_asset_mappings sm
        join public.engineering_diagram_asset_mappings tm on tm.run_id=sm.run_id and tm.organization_id=sm.organization_id
        where sm.run_id=v_run.id and sm.organization_id=v_org and sm.status='accepted' and tm.status='accepted'
          and ((sm.node_id=v_edge.source_node_id and sm.asset_id=v_dependent and tm.node_id=v_edge.target_node_id and tm.asset_id=v_supplier)
            or (sm.node_id=v_edge.source_node_id and sm.asset_id=v_supplier and tm.node_id=v_edge.target_node_id and tm.asset_id=v_dependent))
      ) then
        raise exception using errcode='22023',message='publication requires accepted endpoint mappings for the explicitly oriented assets'; end if;
      insert into public.dependency_candidates(
        organization_id,dependent_asset_id,supplier_asset_id,suggested_kind,group_key,
        basis,confidence,status,source_kind,source_ref,proposed_by)
      values(v_org,v_dependent,v_supplier,v_kind,'diagram:'||v_run.id::text||':'||v_edge.id::text,
        v_basis,case when v_edge.confidence>=0.8 then 'strong' when v_edge.confidence>=0.5 then 'moderate' else 'weak' end,
        'open','engineering_diagram',jsonb_build_object('runId',v_run.id,'edgeId',v_edge.id,
          'documentId',v_run.document_id,'inputSha256',v_run.input_sha256,
          'rawResultSha256',v_run.raw_result_sha256,'provider',v_run.provider,
          'providerCommitSha',v_run.provider_commit_sha,'flowDirection',v_edge.flow_direction,
          'machineGenerated',true,'humanOriented',true),v_actor)
      on conflict do nothing;
      if found then v_count:=v_count+1; end if;
    end loop;
  exception when sqlstate '22023' then
    return jsonb_build_object('error',sqlerrm);
  end;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'engineering_diagram_publication',public.app_current_role(),jsonb_build_object(
    'action','dependency_candidates_published','runId',v_run.id,'documentId',v_run.document_id,
    'candidateCount',v_count,'machineGenerated',true,'humanOriented',true,
    'requiresIndependentGraphReview',true,'operationalAuthorization',false),null,
    jsonb_build_object('openCandidateCount',v_count));
  return jsonb_build_object('runId',v_run.id,'published',v_count,'destination','dependency_candidates',
    'requiresIndependentGraphReview',true,'operationalAuthorization',false);
end $$;
revoke all on function public.publish_engineering_diagram_dependency_candidates(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.publish_engineering_diagram_dependency_candidates(uuid,jsonb)
  to authenticated;

comment on table public.engineering_diagram_runs is
  'Machine extraction provenance for one immutable effective controlled diagram revision; never an engineering approval.';
comment on function public.publish_engineering_diagram_dependency_candidates(uuid,jsonb) is
  'Publishes independently mapped and human-oriented machine findings into the existing human review queue only; does not authorize plant work or write the canonical graph.';

notify pgrst,'reload schema';
