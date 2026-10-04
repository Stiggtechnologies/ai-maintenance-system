-- C2.18 — governed SAP S/4HANA G/L actuals read adapter.
--
-- One connector binds one exact ledger/company/currency and cumulative posting
-- window to one same-tenant development case. Administrator-approved
-- WBS-internal-ID/G-L-account pairs map only to existing coded cost lines.
-- The adapter extends the ONE connector/run/staging/watermark contract and
-- calls the existing ingest_cost_actual_batch -> record_cost_item path. It
-- creates no finance store, no project structure, no baseline and no SAP write.

create or replace function public.is_valid_sap_s4_gl_cost_mapping(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  v_item jsonb;
  v_pair text;
  v_pairs text[]:='{}';
begin
  if coalesce(jsonb_typeof(p_value),'')<>'array'
     or jsonb_array_length(p_value) not between 1 and 40 then return false; end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item)<>'object'
       or exists(select 1 from jsonb_object_keys(v_item) k
         where k not in ('wbsElementInternalId','glAccount','costItemRef'))
       or nullif(btrim(v_item->>'wbsElementInternalId'),'') is null
       or nullif(btrim(v_item->>'glAccount'),'') is null
       or nullif(btrim(v_item->>'costItemRef'),'') is null
       or length(btrim(v_item->>'wbsElementInternalId'))>40
       or length(btrim(v_item->>'glAccount'))>40
       or length(btrim(v_item->>'costItemRef'))>120
       or btrim(v_item->>'wbsElementInternalId') !~ '^[A-Za-z0-9._/-]+$'
       or btrim(v_item->>'glAccount') !~ '^[A-Za-z0-9._/-]+$' then return false; end if;
    v_pair:=btrim(v_item->>'wbsElementInternalId')||chr(31)||btrim(v_item->>'glAccount');
    if v_pair=any(v_pairs) then return false; end if;
    v_pairs:=v_pairs||v_pair;
  end loop;
  return true;
end
$$;

revoke all on function public.is_valid_sap_s4_gl_cost_mapping(jsonb) from public,anon,authenticated;

alter table public.connectors
  add column if not exists financial_case_id uuid
    references public.development_cases(id) on delete set null,
  add column if not exists financial_ledger text,
  add column if not exists financial_company_code text,
  add column if not exists financial_currency text,
  add column if not exists financial_posting_start_date date,
  add column if not exists financial_cost_mappings jsonb,
  add column if not exists financial_max_rows int,
  add column if not exists financial_page_size int;

alter table public.connectors drop constraint if exists connectors_financial_read_profile_check;
alter table public.connectors add constraint connectors_financial_read_profile_check check (
  connector_type is distinct from 'financial_read'
  or (
    system_kind='financial'
    and connector_profile='sap_s4_gl_actuals'
    and financial_case_id is not null
    and length(btrim(financial_ledger)) between 1 and 10
    and length(btrim(financial_company_code)) between 1 and 20
    and financial_currency ~ '^[A-Z]{3}$'
    and financial_posting_start_date is not null
    and public.is_valid_sap_s4_gl_cost_mapping(financial_cost_mappings)
    and financial_max_rows between 1 and 25000
    and financial_page_size between 1 and 5000
    and pagination_mode='next_url'
    and pagination_next_path='d.__next'
    and pagination_max_pages between 2 and 100
    and direction='read_only'
    and not write_enabled
  )
);

comment on column public.connectors.financial_case_id is
  'Same-tenant development case whose existing coded cost lines receive this SAP actual snapshot.';
comment on column public.connectors.financial_cost_mappings is
  'Human-approved SAP WBS internal ID + G/L account to existing project_cost_items.cost_item_ref mappings; source pairs are unique.';
comment on column public.connectors.financial_posting_start_date is
  'Human-approved cumulative posting boundary. SyncAI does not infer project accounting inception.';

create or replace function public.configure_sap_s4_financial_source(
  p_key text,
  p_name text,
  p_service_root text,
  p_development_case_id uuid,
  p_ledger text,
  p_company_code text,
  p_currency text,
  p_posting_start_date date,
  p_cost_mappings jsonb,
  p_max_rows int,
  p_page_size int,
  p_max_pages int,
  p_expected_interval_minutes int,
  p_credential_binding_ref text,
  p_enabled boolean,
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_id uuid;
  v_endpoint text:=nullif(btrim(coalesce(p_service_root,'')),'');
  v_ref text:=nullif(btrim(coalesce(p_credential_binding_ref,'')),'');
  v_ledger text:=upper(btrim(coalesce(p_ledger,'')));
  v_company text:=upper(btrim(coalesce(p_company_code,'')));
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_item jsonb;
  v_cost public.project_cost_items%rowtype;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','a named human administrator must configure or enable an SAP financial source');
  end if;
  if v_org is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','configuring an SAP financial source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)),0)<3 or coalesce(length(btrim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and name are required');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','record a substantive SAP finance activation, posting-window and mapping basis');
  end if;
  if not exists(select 1 from public.development_cases c
    where c.id=p_development_case_id and c.organization_id=v_org) then
    return jsonb_build_object('error','the development case is outside the active tenant or does not exist');
  end if;
  if length(v_ledger) not between 1 and 10 or v_ledger !~ '^[A-Z0-9._/-]+$'
     or length(v_company) not between 1 and 20 or v_company !~ '^[A-Z0-9._/-]+$' then
    return jsonb_build_object('error','ledger and company code must be short explicit SAP identifiers');
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error','company-code currency must be an explicit three-letter code');
  end if;
  if p_posting_start_date is null or p_posting_start_date>current_date then
    return jsonb_build_object('error','posting start date must be the approved project accounting inception on or before today');
  end if;
  if not public.is_valid_sap_s4_gl_cost_mapping(p_cost_mappings) then
    return jsonb_build_object('error','provide 1 to 40 unique SAP WBS/G-L pairs mapped to existing cost item references');
  end if;
  for v_item in select value from jsonb_array_elements(p_cost_mappings) loop
    select * into v_cost from public.project_cost_items
    where organization_id=v_org and development_case_id=p_development_case_id
      and cost_item_ref=btrim(v_item->>'costItemRef');
    if not found then
      return jsonb_build_object('error',format('cost item reference %s is not an existing coded line on this case',btrim(v_item->>'costItemRef')));
    end if;
    if v_cost.currency<>v_currency then
      return jsonb_build_object('error',format('cost item %s uses %s, not approved SAP company-code currency %s',v_cost.cost_item_ref,v_cost.currency,v_currency));
    end if;
  end loop;
  if coalesce(p_max_rows,0) not between 1 and 25000 then
    return jsonb_build_object('error','maximum SAP journal rows must be between 1 and 25000');
  end if;
  if coalesce(p_page_size,0) not between 1 and least(coalesce(p_max_rows,0),5000) then
    return jsonb_build_object('error','SAP page size must be between 1 and the approved row maximum, capped at 5000');
  end if;
  if coalesce(p_max_pages,0) not between 2 and 100 then
    return jsonb_build_object('error','maximum SAP pages must be between 2 and 100');
  end if;
  if coalesce(p_expected_interval_minutes,0)<1 then
    return jsonb_build_object('error','expected interval must be at least one minute');
  end if;
  if v_endpoint is null
     or v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]?#]*)?$'
     or v_endpoint !~ '/API_GLACCOUNTLINEITEM_SRV/?$'
     or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)' then
    return jsonb_build_object('error','SAP service root must be a credential-free public HTTPS URL ending in API_GLACCOUNTLINEITEM_SRV without query or fragment; private/local targets are blocked');
  end if;
  if v_ref is null or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$' or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value, query or fragment');
  end if;
  if exists(select 1 from public.connectors where organization_id=v_org
    and connector_key=btrim(p_key) and connector_type is distinct from 'financial_read') then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;
  if exists(select 1 from public.connectors c join public.connector_runs r
    on r.connector_id=c.id and r.organization_id=c.organization_id
    where c.organization_id=v_org and c.connector_key=btrim(p_key) and r.status='running') then
    return jsonb_build_object('error','wait for the active connector run before changing its governed SAP scope');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    connector_profile,endpoint_hint,expected_interval_minutes,
    credential_binding_ref,contract_note,register_ref,status,enabled,
    direction,write_enabled,pagination_mode,pagination_next_path,
    pagination_max_pages,financial_case_id,financial_ledger,
    financial_company_code,financial_currency,financial_posting_start_date,
    financial_cost_mappings,financial_max_rows,financial_page_size
  ) values(
    v_org,btrim(p_key),btrim(p_name),'financial_read','financial',
    'sap_s4_gl_actuals',v_endpoint,p_expected_interval_minutes,v_ref,
    'Bounded SAP S/4HANA G/L Account Line Items GET. Exact approved WBS/G-L pairs aggregate to existing cost lines through the canonical cost writer; no SAP write-back or baseline authority.',
    'C2.18',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,'next_url','d.__next',p_max_pages,p_development_case_id,
    v_ledger,v_company,v_currency,p_posting_start_date,p_cost_mappings,
    p_max_rows,p_page_size
  ) on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='financial_read',system_kind='financial',
    connector_profile='sap_s4_gl_actuals',endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.18',status=excluded.status,
    enabled=excluded.enabled,direction='read_only',write_enabled=false,
    pagination_mode='next_url',pagination_next_path='d.__next',
    pagination_max_pages=excluded.pagination_max_pages,
    financial_case_id=excluded.financial_case_id,
    financial_ledger=excluded.financial_ledger,
    financial_company_code=excluded.financial_company_code,
    financial_currency=excluded.financial_currency,
    financial_posting_start_date=excluded.financial_posting_start_date,
    financial_cost_mappings=excluded.financial_cost_mappings,
    financial_max_rows=excluded.financial_max_rows,
    financial_page_size=excluded.financial_page_size
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'sap_s4_financial_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      ||' read-only SAP ledger '||v_ledger||' company '||v_company
      ||' mapped to case '||p_development_case_id,
    'approved','manual',100,auth.uid()::text,btrim(p_basis),'executed'
  );
  return jsonb_build_object('ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,'source_profile','sap_s4_gl_actuals',
    'development_case_id',p_development_case_id,'mapping_count',jsonb_array_length(p_cost_mappings),
    'note',case when p_enabled
      then 'Enabled bounded user-triggered SAP G/L actual reads. Baselines, commitments, forecasts and source SAP remain unchanged.'
      else 'Saved disabled. Deploy the approved host and OAuth binding before enabling.' end);
end
$$;

revoke all on function public.configure_sap_s4_financial_source(
  text,text,text,uuid,text,text,text,date,jsonb,int,int,int,int,text,boolean,text
) from public,anon;
grant execute on function public.configure_sap_s4_financial_source(
  text,text,text,uuid,text,text,text,date,jsonb,int,int,int,int,text,boolean,text
) to authenticated;

-- Hash every field that controls transport or cost attribution. The Edge
-- transport must present this exact contract at run creation, preventing a
-- configuration or mapping change between source discovery and promotion.
create or replace function public.sap_s4_financial_contract_hash(p_connector_id uuid)
returns text language sql stable security definer set search_path=public
as $$
  select encode(digest(jsonb_build_object(
    'organizationId',c.organization_id,
    'connectorId',c.id,
    'connectorKey',c.connector_key,
    'serviceRoot',c.endpoint_hint,
    'credentialBindingRef',c.credential_binding_ref,
    'enabled',c.enabled,
    'direction',c.direction,
    'writeEnabled',c.write_enabled,
    'developmentCaseId',c.financial_case_id,
    'ledger',c.financial_ledger,
    'companyCode',c.financial_company_code,
    'currency',c.financial_currency,
    'postingStartDate',c.financial_posting_start_date,
    'costMappings',c.financial_cost_mappings,
    'maxRows',c.financial_max_rows,
    'pageSize',c.financial_page_size,
    'maxPages',c.pagination_max_pages
  )::text,'sha256'),'hex')
  from public.connectors c where c.id=p_connector_id
$$;

revoke all on function public.sap_s4_financial_contract_hash(uuid) from public,anon,authenticated;

create or replace function public.get_sap_s4_financial_source(p_connector_key text)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','SAP financial source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_key=btrim(p_connector_key)
    and connector_type='financial_read' and system_kind='financial'
    and connector_profile='sap_s4_gl_actuals' and register_ref='C2.18';
  if not found then return jsonb_build_object('error','governed SAP financial source not found'); end if;
  if not exists(select 1 from public.development_cases c
    where c.id=v_connector.financial_case_id and c.organization_id=v_org) then
    return jsonb_build_object('error','configured development case is no longer available in this tenant');
  end if;
  return jsonb_build_object(
    'organization_id',v_org,'connector_key',v_connector.connector_key,
    'enabled',v_connector.enabled,'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,'source_profile',v_connector.connector_profile,
    'service_root',v_connector.endpoint_hint,'credential_binding_ref',v_connector.credential_binding_ref,
    'development_case_id',v_connector.financial_case_id,'ledger',v_connector.financial_ledger,
    'company_code',v_connector.financial_company_code,'currency',v_connector.financial_currency,
    'posting_date_from',v_connector.financial_posting_start_date,
    'cost_mappings',v_connector.financial_cost_mappings,
    'max_rows',v_connector.financial_max_rows,'page_size',v_connector.financial_page_size,
    'max_pages',v_connector.pagination_max_pages,
    'contract_hash',public.sap_s4_financial_contract_hash(v_connector.id));
end
$$;

revoke all on function public.get_sap_s4_financial_source(text) from public,anon;
grant execute on function public.get_sap_s4_financial_source(text) to authenticated;

-- Extend the canonical cost-actual importer for a service-attested financial
-- read. Authenticated callers still cannot invoke it; the transaction-local
-- grant exists only inside the service-only wrapper below.
do $cost_gate$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ingest_cost_actual_batch';
  if v_def is null then raise exception 'canonical ingest_cost_actual_batch is missing' using errcode='check_violation'; end if;
  if position('app.sap_financial_ingest' in v_def)=0 then
    v_new:=replace(v_def,
      $old$and connector_type = 'manual_upload';$old$,
      $new$and (connector_type = 'manual_upload'
       or (connector_type = 'financial_read'
         and coalesce(current_setting('app.sap_financial_ingest', true), '') = 'granted'));$new$);
    if v_new=v_def then raise exception 'canonical cost-actual source gate is not in the expected shape' using errcode='check_violation'; end if;
    execute v_new;
  end if;
end
$cost_gate$;

create or replace function public.begin_sap_s4_financial_read_run(
  p_organization_id uuid,p_triggered_by uuid,p_connector_key text,
  p_contract_hash text,p_manifest jsonb,p_cursor_to jsonb,p_source_bytes bigint
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_role text; v_item jsonb; v_page int:=0; v_rows int:=0; v_bytes bigint:=0;
  v_run uuid; v_from timestamptz; v_observed timestamptz;
  v_hashes text[]:='{}'; v_digest text;
begin
  if coalesce(auth.role(),'')<>'service_role' then return jsonb_build_object('error','SAP financial transport attestation is service-only'); end if;
  select role into v_role from public.user_profiles where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP financial run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=btrim(p_connector_key)
    and connector_type='financial_read' and system_kind='financial'
    and connector_profile='sap_s4_gl_actuals' and register_ref='C2.18'
    and enabled and direction='read_only' and not write_enabled for update;
  if not found then return jsonb_build_object('error','active governed SAP financial source not found'); end if;
  if coalesce(p_contract_hash,'') !~ '^[0-9a-f]{64}$'
     or p_contract_hash<>public.sap_s4_financial_contract_hash(v_connector.id)
     or coalesce(p_cursor_to->>'contract_hash','')<>p_contract_hash then
    return jsonb_build_object('error','SAP financial connector contract changed after source discovery; fetch and validate the approved scope again');
  end if;
  if exists(select 1 from public.connector_runs r where r.connector_id=v_connector.id
    and r.organization_id=p_organization_id and r.entity_type='cost_actual' and r.status='running') then
    return jsonb_build_object('error','an SAP financial pull is already running for this connector');
  end if;
  if coalesce(jsonb_typeof(p_manifest),'')<>'array'
     or jsonb_array_length(p_manifest) not between 1 and v_connector.pagination_max_pages
     or coalesce(jsonb_typeof(p_cursor_to),'')<>'object'
     or coalesce(p_cursor_to->>'fetched_at','')=''
     or coalesce(p_cursor_to->>'source_digest','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_bytes,0)<=0 or p_source_bytes>26214400 then
    return jsonb_build_object('error','bounded SAP financial transport evidence is invalid');
  end if;
  begin v_observed:=(p_cursor_to->>'fetched_at')::timestamptz;
  exception when others then return jsonb_build_object('error','SAP financial transport timestamp is invalid'); end;
  if not isfinite(v_observed) or v_observed>now()+interval '5 minutes'
     or v_observed<now()-interval '10 minutes' then
    return jsonb_build_object('error','SAP financial timestamp is not a finite current observation');
  end if;
  if coalesce(p_cursor_to->>'posting_date_from','')<>v_connector.financial_posting_start_date::text
     or coalesce(p_cursor_to->>'posting_date_to','')<>(v_observed at time zone 'UTC')::date::text then
    return jsonb_build_object('error','SAP posting window does not match the approved cumulative boundary and fetch date');
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_page:=v_page+1;
    if jsonb_typeof(v_item)<>'object'
       or coalesce(v_item->>'transport','')<>'sap_s4_odata_v2'
       or coalesce(v_item->>'resource','')<>'GLAccountLineItem'
       or coalesce(v_item->>'page','')<>v_page::text
       or coalesce(v_item->>'ledger','')<>v_connector.financial_ledger
       or coalesce(v_item->>'company_code','')<>v_connector.financial_company_code
       or coalesce(v_item->>'posting_date_from','')<>v_connector.financial_posting_start_date::text
       or coalesce(v_item->>'posting_date_to','')<>(v_observed at time zone 'UTC')::date::text
       or coalesce(v_item->>'sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'bytes','') !~ '^[0-9]+$'
       or coalesce(v_item->>'row_count','') !~ '^[0-9]+$' then
      return jsonb_build_object('error','SAP financial manifest is missing bounded page provenance');
    end if;
    if (v_item->>'bytes')::bigint<=0 or (v_item->>'bytes')::bigint>10485760 then
      return jsonb_build_object('error','SAP financial source pages must contain no more than 10 MB');
    end if;
    if (v_item->>'row_count')::int<0 or (v_item->>'row_count')::int>v_connector.financial_page_size then
      return jsonb_build_object('error','SAP financial source page row count exceeds the approved page size');
    end if;
    v_hashes:=v_hashes||(v_item->>'sha256');
    v_bytes:=v_bytes+(v_item->>'bytes')::bigint; v_rows:=v_rows+(v_item->>'row_count')::int;
  end loop;
  v_digest:=encode(digest(array_to_string(v_hashes,':'),'sha256'),'hex');
  if v_bytes<>p_source_bytes or v_rows<1 or v_rows>v_connector.financial_max_rows
     or coalesce(p_cursor_to->>'raw_rows','')<>v_rows::text
     or coalesce(p_cursor_to->>'pages','')<>v_page::text
     or coalesce(p_cursor_to->>'source_digest','')<>v_digest
     or coalesce(p_cursor_to->>'mapped_rows','') !~ '^[1-9][0-9]*$'
     or (p_cursor_to->>'mapped_rows')::int>jsonb_array_length(v_connector.financial_cost_mappings) then
    return jsonb_build_object('error','SAP financial manifest does not reconcile to the complete mapped response');
  end if;
  select last_position into v_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='cost_actual';
  if v_from is not null and v_observed<=v_from then
    return jsonb_build_object('error','SAP financial observation does not advance the clean connector watermark');
  end if;
  perform set_config('app.sap_financial_transport','granted',true);
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    watermark_from,watermark_to,triggered_by,transport_manifest,
    transport_cursor_to,source_object_count,source_bytes
  ) values(
    p_organization_id,v_connector.id,'cost_actual','sync','running',now(),
    v_from,v_observed,p_triggered_by,p_manifest,p_cursor_to,v_page,p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from,'cursor_to',p_cursor_to);
end
$$;

revoke all on function public.begin_sap_s4_financial_read_run(uuid,uuid,text,text,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.begin_sap_s4_financial_read_run(uuid,uuid,text,text,jsonb,jsonb,bigint) to service_role;

create or replace function public.ingest_sap_s4_financial_read_batch(
  p_organization_id uuid,p_triggered_by uuid,p_run_id uuid,p_actor_aal text,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_connector public.connectors%rowtype; v_run public.connector_runs%rowtype;
  v_role text; v_row jsonb; v_result jsonb; v_expected int; v_observed timestamptz;
begin
  if coalesce(auth.role(),'')<>'service_role' then return jsonb_build_object('error','SAP financial ingestion is service-only'); end if;
  if coalesce(p_actor_aal,'') not in ('aal1','aal2') then return jsonb_build_object('error','SAP financial ingestion requires verified human session assurance'); end if;
  select role into v_role from public.user_profiles where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP financial ingest actor is not authorized for this tenant');
  end if;
  select r.* into v_run from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id and r.triggered_by=p_triggered_by
    and r.status='running' and r.entity_type='cost_actual' and r.records_read=0
    and c.connector_type='financial_read' and c.system_kind='financial'
    and c.connector_profile='sap_s4_gl_actuals' and c.register_ref='C2.18'
    and c.enabled and c.direction='read_only' and not c.write_enabled;
  if not found then return jsonb_build_object('error','running attested SAP financial run not found'); end if;
  select * into v_connector from public.connectors where id=v_run.connector_id and organization_id=p_organization_id;
  if coalesce(v_run.transport_cursor_to->>'contract_hash','')
       <>public.sap_s4_financial_contract_hash(v_connector.id) then
    return jsonb_build_object('error','SAP financial connector contract no longer matches the attested run');
  end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  v_observed:=(v_run.transport_cursor_to->>'fetched_at')::timestamptz;
  if coalesce(jsonb_typeof(p_rows),'')<>'array' or jsonb_array_length(p_rows)<>v_expected
     or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>40 then
    return jsonb_build_object('error','SAP financial rows must exactly reconcile to the attested mapped response');
  end if;
  if (select count(*) from jsonb_array_elements(p_rows))<>
     (select count(distinct btrim(value->>'cost_item_ref')) from jsonb_array_elements(p_rows)) then
    return jsonb_build_object('error','SAP financial mapped rows must contain each canonical cost line exactly once');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row)<>'object'
       or exists(select 1 from jsonb_object_keys(v_row) k where k not in
         ('external_id','development_case_id','cost_item_ref','actual_to_date','currency','as_of','basis'))
       or coalesce(v_row->>'external_id','')<>
          'sapgl:'||v_connector.financial_ledger||':'||v_connector.financial_company_code||':'||
          btrim(v_row->>'cost_item_ref')||':'||left(v_run.transport_cursor_to->>'source_digest',24)
       or coalesce(v_row->>'development_case_id','')<>v_connector.financial_case_id::text
       or upper(coalesce(v_row->>'currency',''))<>v_connector.financial_currency
       or coalesce(v_row->>'actual_to_date','') !~ '^-?[0-9]+(\.[0-9]+)?$'
       or coalesce(v_row->>'as_of','')<>v_run.transport_cursor_to->>'fetched_at'
       or not exists(select 1 from jsonb_array_elements(v_connector.financial_cost_mappings) m
         where btrim(m->>'costItemRef')=btrim(v_row->>'cost_item_ref')) then
      return jsonb_build_object('error','SAP financial mapped row escaped the approved case, currency, cost-line or field contract');
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub',p_triggered_by::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.aal',p_actor_aal,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_triggered_by,'role','authenticated','aal',p_actor_aal)::text,true);
  perform set_config('app.sap_financial_ingest','granted',true);
  v_result:=public.ingest_cost_actual_batch(p_run_id,p_rows);
  update public.connector_runs r set watermark_to=(r.transport_cursor_to->>'fetched_at')::timestamptz
  where r.id=p_run_id and r.organization_id=p_organization_id and r.status='running';
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(p_organization_id,'sap_s4_financial_read',v_role,
    jsonb_build_object('action','ingest_cumulative_actuals','runId',p_run_id,
      'connectorKey',v_connector.connector_key,'actorId',p_triggered_by,'sourceWriteBack',false,
      'baselineAuthority',false,'postingDateFrom',v_connector.financial_posting_start_date,
      'postingDateTo',v_run.transport_cursor_to->>'posting_date_to'),v_result);
  return v_result;
end
$$;

revoke all on function public.ingest_sap_s4_financial_read_batch(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_sap_s4_financial_read_batch(uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function public.enforce_sap_s4_financial_run_attestation()
returns trigger language plpgsql set search_path=public
as $$
begin
  if exists(select 1 from public.connectors c where c.id=new.connector_id
    and c.connector_type='financial_read' and c.system_kind='financial'
    and c.connector_profile='sap_s4_gl_actuals' and c.register_ref='C2.18') then
    if tg_op='INSERT' and coalesce(current_setting('app.sap_financial_transport',true),'')<>'granted' then
      raise exception 'governed SAP financial runs require service-attested complete transport evidence';
    end if;
    if tg_op='UPDATE'
       and coalesce(current_setting('app.sap_financial_ingest',true),'')<>'granted'
       and coalesce(current_setting('app.sap_financial_finish',true),'')<>'granted' then
      raise exception 'governed SAP financial runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_sap_s4_financial_run_attestation on public.connector_runs;
create trigger trg_sap_s4_financial_run_attestation before insert or update on public.connector_runs
for each row execute function public.enforce_sap_s4_financial_run_attestation();

create or replace function public.finish_sap_s4_financial_read_run(
  p_organization_id uuid,p_run_id uuid,p_status text,p_error text default null
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_run public.connector_runs%rowtype; v_clean boolean; v_advanced boolean:=false;
  v_expected int; v_rows int:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then return jsonb_build_object('error','SAP financial finish is service-only'); end if;
  if p_status not in ('success','partial','failed') then return jsonb_build_object('error','SAP financial status must be success, partial or failed'); end if;
  select r.* into v_run from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id and r.status='running'
    and c.connector_type='financial_read' and c.system_kind='financial'
    and c.connector_profile='sap_s4_gl_actuals' and c.register_ref='C2.18';
  if not found then return jsonb_build_object('error','running governed SAP financial run not found'); end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if p_status in ('success','partial') and v_run.records_read<>v_expected then
    return jsonb_build_object('error','SAP financial run rows do not reconcile to the attested mapped response');
  end if;
  if p_status='success' and v_run.records_rejected>0 then
    return jsonb_build_object('error','an SAP financial run with rejected rows cannot finish as success');
  end if;
  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.transport_manifest is not null and v_run.transport_cursor_to is not null;
  perform set_config('app.sap_financial_finish','granted',true);
  update public.connector_runs set status=p_status,finished_at=now(),records_processed=records_accepted,
    error_message=case when p_error is null then null else left(p_error,500) end
  where id=p_run_id and organization_id=p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_position,last_cursor,last_run_id,updated_at
    ) values(p_organization_id,v_run.connector_id,'cost_actual',v_run.watermark_to,
      v_run.transport_cursor_to,p_run_id,now())
    on conflict(connector_id,entity_type) do update set
      last_position=greatest(public.ingest_watermarks.last_position,excluded.last_position),
      last_cursor=excluded.last_cursor,last_run_id=excluded.last_run_id,updated_at=now();
    get diagnostics v_rows=row_count; v_advanced:=v_rows=1;
  end if;
  update public.connectors set
    last_success_at=case when v_clean then now() else last_success_at end,
    last_failure_at=case when not v_clean then now() else last_failure_at end
  where id=v_run.connector_id and organization_id=p_organization_id;
  return jsonb_build_object('ok',true,'run_id',p_run_id,'status',p_status,
    'watermark_advanced',v_advanced,'records_read',v_run.records_read,
    'records_accepted',v_run.records_accepted,'records_duplicate',v_run.records_duplicate,
    'records_rejected',v_run.records_rejected);
end
$$;

revoke all on function public.finish_sap_s4_financial_read_run(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_sap_s4_financial_read_run(uuid,uuid,text,text) to service_role;

notify pgrst,'reload schema';
