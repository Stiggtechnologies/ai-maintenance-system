-- C2.17 — governed SAP S/4HANA Material Stock read adapter.
--
-- One connector represents one exact SAP Plant + StorageLocation mapped to one
-- same-tenant canonical site. The adapter reads only unrestricted, non-special
-- stock (InventoryStockType 01), updates only qty_on_hand, and deliberately
-- preserves reservations, purchase-order quantities and receipt dates because
-- the Material Stock API does not prove those values. SAP remains read-only.

alter table public.connectors
  add column if not exists inventory_site_id uuid
    references public.sites(id) on delete set null,
  add column if not exists inventory_plant text,
  add column if not exists inventory_storage_location text,
  add column if not exists inventory_max_rows int,
  add column if not exists inventory_page_size int;

alter table public.connectors
  drop constraint if exists connectors_inventory_read_profile_check;
alter table public.connectors
  add constraint connectors_inventory_read_profile_check check (
    connector_type is distinct from 'inventory_read'
    or (
      system_kind='inventory'
      and connector_profile='sap_s4_material_stock'
      and inventory_site_id is not null
      and length(btrim(inventory_plant)) between 1 and 20
      and length(btrim(inventory_storage_location)) between 1 and 20
      and inventory_max_rows between 1 and 25000
      and inventory_page_size between 1 and 5000
      and pagination_mode='next_url'
      and pagination_next_path='d.__next'
      and pagination_max_pages between 2 and 100
      and direction='read_only'
      and not write_enabled
    )
  );

comment on column public.connectors.inventory_site_id is
  'Same-tenant canonical site receiving one exact inventory plant/storage-location snapshot.';
comment on column public.connectors.inventory_plant is
  'Administrator-approved SAP Plant; the request body cannot widen this scope.';
comment on column public.connectors.inventory_storage_location is
  'Administrator-approved SAP StorageLocation mapped to inventory_site_id.';
comment on column public.connectors.inventory_max_rows is
  'Hard maximum raw SAP stock rows transported in one pull.';
comment on column public.connectors.inventory_page_size is
  'Requested SAP OData page size; the server may return fewer rows.';

create or replace function public.configure_sap_s4_inventory_source(
  p_key text,
  p_name text,
  p_service_root text,
  p_plant text,
  p_storage_location text,
  p_site_id uuid,
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
  v_plant text:=btrim(coalesce(p_plant,''));
  v_storage text:=btrim(coalesce(p_storage_location,''));
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','a named human administrator must configure or enable an SAP inventory source');
  end if;
  if v_org is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','configuring an SAP inventory source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)),0) not between 3 and 160
     or coalesce(length(btrim(p_name)),0) not between 3 and 160 then
    return jsonb_build_object('error','connector key and name must be between 3 and 160 characters');
  end if;
  if coalesce(length(btrim(p_basis)),0) not between 20 and 2000 then
    return jsonb_build_object('error','record a substantive bounded SAP inventory activation and site-mapping basis');
  end if;
  if not exists(select 1 from public.sites s where s.id=p_site_id and s.organization_id=v_org) then
    return jsonb_build_object('error','the canonical inventory site is outside the active tenant or does not exist');
  end if;
  if length(v_plant) not between 1 and 20 or length(v_storage) not between 1 and 20
     or v_plant !~ '^[A-Za-z0-9._/-]+$' or v_storage !~ '^[A-Za-z0-9._/-]+$' then
    return jsonb_build_object('error','SAP plant and storage location must be short explicit identifiers');
  end if;
  if coalesce(p_max_rows,0) not between 1 and 25000 then
    return jsonb_build_object('error','maximum SAP stock rows must be between 1 and 25000');
  end if;
  if coalesce(p_page_size,0) not between 1 and least(coalesce(p_max_rows,0),5000) then
    return jsonb_build_object('error','SAP page size must be between 1 and the approved row maximum, capped at 5000');
  end if;
  if coalesce(p_max_pages,0) not between 2 and 100 then
    return jsonb_build_object('error','maximum SAP pages must be between 2 and 100');
  end if;
  if coalesce(p_expected_interval_minutes,0) not between 1 and 525600 then
    return jsonb_build_object('error','expected interval must be between one minute and one year');
  end if;
  if v_endpoint is null or length(v_endpoint)>2048
     or v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]?#]*)?$'
     or v_endpoint !~ '/API_MATERIAL_STOCK_SRV/?$'
     or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)' then
    return jsonb_build_object('error','SAP service root must be a credential-free public HTTPS URL ending in API_MATERIAL_STOCK_SRV without query or fragment; private/local targets are blocked');
  end if;
  if v_ref is null or length(v_ref)>500
     or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
     or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value, query or fragment');
  end if;
  if exists(select 1 from public.connectors where organization_id=v_org
    and connector_key=btrim(p_key) and connector_type is distinct from 'inventory_read') then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    connector_profile,endpoint_hint,expected_interval_minutes,
    credential_binding_ref,contract_note,register_ref,status,enabled,
    direction,write_enabled,pagination_mode,pagination_next_path,
    pagination_max_pages,inventory_site_id,inventory_plant,
    inventory_storage_location,inventory_max_rows,inventory_page_size
  ) values(
    v_org,btrim(p_key),btrim(p_name),'inventory_read','inventory',
    'sap_s4_material_stock',v_endpoint,p_expected_interval_minutes,v_ref,
    'Bounded SAP S/4HANA Material Stock GET for unrestricted non-special on-hand stock. No source write-back; reservations and on-order values are preserved.',
    'C2.17',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,'next_url','d.__next',p_max_pages,p_site_id,v_plant,
    v_storage,p_max_rows,p_page_size
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='inventory_read',system_kind='inventory',
    connector_profile='sap_s4_material_stock',endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.17',
    status=excluded.status,enabled=excluded.enabled,direction='read_only',
    write_enabled=false,pagination_mode='next_url',pagination_next_path='d.__next',
    pagination_max_pages=excluded.pagination_max_pages,
    inventory_site_id=excluded.inventory_site_id,
    inventory_plant=excluded.inventory_plant,
    inventory_storage_location=excluded.inventory_storage_location,
    inventory_max_rows=excluded.inventory_max_rows,
    inventory_page_size=excluded.inventory_page_size
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'sap_s4_inventory_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      ||' read-only SAP Plant '||v_plant||' StorageLocation '||v_storage
      ||' mapped to site '||p_site_id,
    'approved','manual',100,auth.uid()::text,btrim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,
    'source_profile','sap_s4_material_stock','plant',v_plant,
    'storage_location',v_storage,'site_id',p_site_id,
    'note',case when p_enabled
      then 'Enabled bounded user-triggered SAP on-hand reads. Reservations and on-order values remain untouched.'
      else 'Saved disabled. Deploy the approved host and OAuth binding before enabling.' end
  );
end
$$;

revoke all on function public.configure_sap_s4_inventory_source(
  text,text,text,text,text,uuid,int,int,int,int,text,boolean,text
) from public,anon;
grant execute on function public.configure_sap_s4_inventory_source(
  text,text,text,text,text,uuid,int,int,int,int,text,boolean,text
) to authenticated;

create or replace function public.get_sap_s4_inventory_source(p_connector_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('planner','inventory_manager','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP inventory source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_key=btrim(p_connector_key)
    and connector_type='inventory_read' and system_kind='inventory'
    and connector_profile='sap_s4_material_stock' and register_ref='C2.17';
  if not found then return jsonb_build_object('error','governed SAP inventory source not found'); end if;
  if not exists(select 1 from public.sites s where s.id=v_connector.inventory_site_id
    and s.organization_id=v_org) then
    return jsonb_build_object('error','configured inventory site is no longer available in this tenant');
  end if;
  return jsonb_build_object(
    'organization_id',v_org,'connector_key',v_connector.connector_key,
    'enabled',v_connector.enabled,'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,
    'source_profile',v_connector.connector_profile,
    'service_root',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'site_id',v_connector.inventory_site_id,'plant',v_connector.inventory_plant,
    'storage_location',v_connector.inventory_storage_location,
    'max_rows',v_connector.inventory_max_rows,
    'page_size',v_connector.inventory_page_size,
    'max_pages',v_connector.pagination_max_pages
  );
end
$$;

revoke all on function public.get_sap_s4_inventory_source(text) from public,anon;
grant execute on function public.get_sap_s4_inventory_source(text) to authenticated;

create or replace function public.begin_sap_s4_inventory_read_run(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_connector_key text,
  p_manifest jsonb,
  p_cursor_to jsonb,
  p_source_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_role text;
  v_item jsonb;
  v_page int:=0;
  v_rows int:=0;
  v_bytes bigint:=0;
  v_run uuid;
  v_from timestamptz;
  v_observed_at timestamptz;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP inventory transport attestation is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in
    ('planner','inventory_manager','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP inventory run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=btrim(p_connector_key)
    and connector_type='inventory_read' and system_kind='inventory'
    and connector_profile='sap_s4_material_stock' and register_ref='C2.17'
    and enabled and direction='read_only' and not write_enabled
  for update;
  if not found then return jsonb_build_object('error','active governed SAP inventory source not found'); end if;
  if exists(select 1 from public.connector_runs r where r.connector_id=v_connector.id
    and r.organization_id=p_organization_id and r.entity_type='material_stock'
    and r.status='running') then
    return jsonb_build_object('error','an SAP inventory pull is already running for this connector');
  end if;
  if coalesce(jsonb_typeof(p_manifest),'')<>'array'
     or jsonb_array_length(p_manifest) not between 1 and v_connector.pagination_max_pages
     or coalesce(jsonb_typeof(p_cursor_to),'')<>'object'
     or coalesce(p_cursor_to->>'fetched_at','')=''
     or coalesce(p_source_bytes,0)<=0 or p_source_bytes>26214400 then
    return jsonb_build_object('error','bounded SAP inventory transport evidence is invalid');
  end if;
  begin v_observed_at:=(p_cursor_to->>'fetched_at')::timestamptz;
  exception when others then
    return jsonb_build_object('error','SAP inventory transport timestamp is invalid');
  end;
  if not isfinite(v_observed_at) or v_observed_at>now()+interval '5 minutes' then
    return jsonb_build_object('error','SAP inventory timestamp is not a finite current observation');
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_page:=v_page+1;
    if jsonb_typeof(v_item)<>'object'
       or coalesce(v_item->>'transport','')<>'sap_s4_odata_v2'
       or coalesce(v_item->>'resource','')<>'A_MatlStkInAcctMod'
       or coalesce(v_item->>'page','')<>v_page::text
       or coalesce(v_item->>'plant','')<>v_connector.inventory_plant
       or coalesce(v_item->>'storage_location','')<>v_connector.inventory_storage_location
       or coalesce(v_item->>'sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'bytes','') !~ '^[0-9]+$'
       or coalesce(v_item->>'row_count','') !~ '^[0-9]+$' then
      return jsonb_build_object('error','SAP inventory manifest is missing bounded page provenance');
    end if;
    if (v_item->>'bytes')::bigint<=0
       or (v_item->>'bytes')::bigint>10485760 then
      return jsonb_build_object('error','SAP inventory source pages must contain no more than 10 MB');
    end if;
    if (v_item->>'row_count')::int>v_connector.inventory_page_size then
      return jsonb_build_object('error','SAP inventory source page exceeds the approved row size');
    end if;
    v_bytes:=v_bytes+(v_item->>'bytes')::bigint;
    v_rows:=v_rows+(v_item->>'row_count')::int;
  end loop;
  if v_bytes<>p_source_bytes or v_rows<1 or v_rows>v_connector.inventory_max_rows
     or coalesce(p_cursor_to->>'raw_rows','')<>v_rows::text
     or coalesce(p_cursor_to->>'pages','')<>v_page::text
     or coalesce(p_cursor_to->>'mapped_rows','') !~ '^[1-9][0-9]*$'
     or (p_cursor_to->>'mapped_rows')::int>v_rows then
    return jsonb_build_object('error','SAP inventory manifest does not reconcile to the complete mapped response');
  end if;
  select last_position into v_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='material_stock';
  if v_from is not null and v_observed_at<=v_from then
    return jsonb_build_object('error','SAP inventory observation does not advance the clean connector watermark');
  end if;
  perform set_config('app.sap_inventory_transport','granted',true);
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    watermark_from,watermark_to,triggered_by,transport_manifest,
    transport_cursor_to,source_object_count,source_bytes
  ) values(
    p_organization_id,v_connector.id,'material_stock','sync','running',now(),
    v_from,v_observed_at,p_triggered_by,p_manifest,p_cursor_to,v_page,p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from,
    'cursor_to',p_cursor_to);
end
$$;

revoke all on function public.begin_sap_s4_inventory_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) from public,anon,authenticated;
grant execute on function public.begin_sap_s4_inventory_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) to service_role;

create or replace function public.ingest_sap_s4_inventory_read_batch(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_run_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_run public.connector_runs%rowtype;
  v_role text;
  v_row jsonb;
  v_ext text;
  v_material public.materials%rowtype;
  v_existing public.material_stock%rowtype;
  v_qty numeric;
  v_observed timestamptz;
  v_read int:=0;
  v_ok int:=0;
  v_duplicate int:=0;
  v_rejected int:=0;
  v_reason text;
  v_expected int;
  v_seen_external_ids text[]:='{}';
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP inventory ingestion is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in
    ('planner','inventory_manager','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP inventory ingest actor is not authorized for this tenant');
  end if;
  select r.* into v_run
  from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id
    and r.triggered_by=p_triggered_by and r.status='running'
    and r.entity_type='material_stock' and r.records_read=0
    and c.connector_type='inventory_read' and c.system_kind='inventory'
    and c.connector_profile='sap_s4_material_stock' and c.register_ref='C2.17'
    and c.enabled and c.direction='read_only' and not c.write_enabled;
  if not found then return jsonb_build_object('error','running attested SAP inventory run not found'); end if;
  select * into v_connector from public.connectors c
  where c.id=v_run.connector_id and c.organization_id=p_organization_id;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if coalesce(jsonb_typeof(p_rows),'')<>'array'
     or jsonb_array_length(p_rows)<>v_expected
     or jsonb_array_length(p_rows)<1
     or jsonb_array_length(p_rows)>v_connector.inventory_max_rows then
    return jsonb_build_object('error','SAP inventory rows must exactly reconcile to the attested mapped response');
  end if;

  perform set_config('app.sap_inventory_ingest','granted',true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1; v_reason:=null;
    v_ext:=nullif(btrim(v_row->>'external_id'),'');
    if jsonb_typeof(v_row)<>'object'
       or exists(select 1 from jsonb_object_keys(v_row) k
         where k not in ('external_id','material_code','unit_of_measure','qty_on_hand','site_id','observed_at')) then
      v_reason:='row contains fields outside the governed SAP stock contract';
    elsif v_ext is null or nullif(btrim(v_row->>'material_code'),'') is null
       or nullif(btrim(v_row->>'unit_of_measure'),'') is null
       or length(v_ext)>320
       or length(btrim(v_row->>'material_code'))>255
       or length(btrim(v_row->>'unit_of_measure'))>40
       or coalesce(v_row->>'site_id','')<>v_connector.inventory_site_id::text
       or jsonb_typeof(v_row->'qty_on_hand')<>'number' then
      v_reason:='material code, UOM, non-negative quantity, exact site and external identity are required';
    else
      begin
        v_qty:=(v_row->>'qty_on_hand')::numeric;
        v_observed:=(v_row->>'observed_at')::timestamptz;
        if v_qty<0 or v_qty='NaN'::numeric or v_qty>='Infinity'::numeric
           or not isfinite(v_observed) or v_observed<>v_run.watermark_to then
          v_reason:='quantity or observation timestamp does not match the attested SAP snapshot';
        end if;
      exception when others then
        v_reason:='quantity or observation timestamp is invalid';
      end;
    end if;
    if v_reason is null and v_ext is distinct from
       v_connector.inventory_plant||':'||v_connector.inventory_storage_location||':'||btrim(v_row->>'material_code') then
      v_reason:='external identity does not match the approved SAP plant/storage/material scope';
    end if;
    if v_reason is null and v_ext=any(v_seen_external_ids) then
      v_reason:='mapped SAP inventory response repeats a material balance';
    elsif v_reason is null then
      v_seen_external_ids:=v_seen_external_ids||v_ext;
    end if;
    if v_reason is null then
      select * into v_material from public.materials m
      where m.organization_id=p_organization_id
        and m.material_code=btrim(v_row->>'material_code') and not m.is_template;
      if not found then
        v_reason:='material code is absent from the governed tenant catalogue';
      elsif v_material.unit_of_measure is distinct from btrim(v_row->>'unit_of_measure') then
        v_reason:='SAP base unit does not exactly match the governed catalogue UOM';
      end if;
    end if;
    if v_reason is not null then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason
      ) values(p_organization_id,v_connector.id,p_run_id,'material_stock',v_ext,v_row,'rejected',v_reason);
      continue;
    end if;
    select * into v_existing from public.material_stock s
    where s.organization_id=p_organization_id and s.material_id=v_material.id
      and s.site_id=v_connector.inventory_site_id for update;
    if found and v_existing.qty_on_hand=v_qty
       and v_existing.source_system=v_connector.connector_key then
      v_duplicate:=v_duplicate+1;
      update public.material_stock set last_counted_at=v_observed,updated_at=now(),
        external_id=v_ext
      where id=v_existing.id and organization_id=p_organization_id;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(p_organization_id,v_connector.id,p_run_id,'material_stock',v_ext,v_row,'duplicate');
    else
      insert into public.material_stock(
        organization_id,material_id,site_id,qty_on_hand,last_counted_at,
        source_system,external_id,updated_at
      ) values(
        p_organization_id,v_material.id,v_connector.inventory_site_id,v_qty,
        v_observed,v_connector.connector_key,v_ext,now()
      ) on conflict(material_id,site_id) do update set
        qty_on_hand=excluded.qty_on_hand,last_counted_at=excluded.last_counted_at,
        source_system=excluded.source_system,external_id=excluded.external_id,
        updated_at=now();
      v_ok:=v_ok+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(p_organization_id,v_connector.id,p_run_id,'material_stock',v_ext,v_row,'accepted');
    end if;
  end loop;
  update public.connector_runs set records_read=v_read,records_accepted=v_ok,
    records_rejected=v_rejected,records_duplicate=v_duplicate
  where id=p_run_id and organization_id=p_organization_id;
  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,new_state
  ) values(
    p_organization_id,'sap_s4_inventory_read',v_role,
    jsonb_build_object('action','ingest_snapshot','runId',p_run_id,
      'connectorKey',v_connector.connector_key,'actorId',p_triggered_by,
      'sourceWriteBack',false),
    jsonb_build_object('read',v_read,'accepted',v_ok,'duplicate',v_duplicate,
      'rejected',v_rejected,'preservedFields',jsonb_build_array(
        'qty_reserved','qty_on_order','expected_receipt_date'))
  );
  return jsonb_build_object('read',v_read,'accepted',v_ok,
    'duplicate',v_duplicate,'rejected',v_rejected);
end
$$;

revoke all on function public.ingest_sap_s4_inventory_read_batch(
  uuid,uuid,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.ingest_sap_s4_inventory_read_batch(
  uuid,uuid,uuid,jsonb
) to service_role;

create or replace function public.enforce_sap_s4_inventory_run_attestation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists(select 1 from public.connectors c where c.id=new.connector_id
    and c.connector_type='inventory_read' and c.system_kind='inventory'
    and c.connector_profile='sap_s4_material_stock' and c.register_ref='C2.17') then
    if tg_op='INSERT'
       and coalesce(current_setting('app.sap_inventory_transport',true),'')<>'granted' then
      raise exception 'governed SAP inventory runs require service-attested complete transport evidence';
    end if;
    if tg_op='UPDATE'
       and coalesce(current_setting('app.sap_inventory_ingest',true),'')<>'granted'
       and coalesce(current_setting('app.sap_inventory_finish',true),'')<>'granted' then
      raise exception 'governed SAP inventory runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_sap_s4_inventory_run_attestation on public.connector_runs;
create trigger trg_sap_s4_inventory_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_sap_s4_inventory_run_attestation();

create or replace function public.finish_sap_s4_inventory_read_run(
  p_organization_id uuid,
  p_run_id uuid,
  p_status text,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run public.connector_runs%rowtype;
  v_clean boolean;
  v_advanced boolean:=false;
  v_expected int;
  v_rows int:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP inventory finish is service-only');
  end if;
  if p_status not in ('success','partial','failed') then
    return jsonb_build_object('error','SAP inventory status must be success, partial or failed');
  end if;
  select r.* into v_run from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id and r.status='running'
    and c.connector_type='inventory_read' and c.system_kind='inventory'
    and c.connector_profile='sap_s4_material_stock' and c.register_ref='C2.17';
  if not found then return jsonb_build_object('error','running governed SAP inventory run not found'); end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if p_status in ('success','partial') and v_run.records_read<>v_expected then
    return jsonb_build_object('error','SAP inventory run rows do not reconcile to the attested mapped response');
  end if;
  if p_status='success' and v_run.records_rejected>0 then
    return jsonb_build_object('error','an SAP inventory run with rejected rows cannot finish as success');
  end if;
  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.transport_manifest is not null and v_run.transport_cursor_to is not null;
  perform set_config('app.sap_inventory_finish','granted',true);
  update public.connector_runs set status=p_status,finished_at=now(),
    records_processed=records_accepted,
    error_message=case when p_error is null then null else left(p_error,500) end
  where id=p_run_id and organization_id=p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_position,last_cursor,last_run_id,updated_at
    ) values(
      p_organization_id,v_run.connector_id,'material_stock',v_run.watermark_to,
      v_run.transport_cursor_to,p_run_id,now()
    ) on conflict(connector_id,entity_type) do update set
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
    'records_accepted',v_run.records_accepted,
    'records_duplicate',v_run.records_duplicate,
    'records_rejected',v_run.records_rejected);
end
$$;

revoke all on function public.finish_sap_s4_inventory_read_run(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.finish_sap_s4_inventory_read_run(
  uuid,uuid,text,text
) to service_role;

notify pgrst,'reload schema';
