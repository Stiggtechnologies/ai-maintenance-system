-- Governed read-only CMMS work-order adapter (C2.02/C2.13).
-- Reuses connectors, connector runs, staged rejects, watermarks and ingest_batch.
-- It never writes to the customer CMMS and accepts only an administrator-approved
-- mapping into the existing canonical work_orders contract.

create or replace function public.cmms_work_order_allowed_fields()
returns text[] language sql immutable set search_path=public as $$
  select array['external_id','title','asset_external_id','wo_number','status',
    'priority','work_type','planned_hours','created_at','completed_at',
    'failure_mode','downtime_hours'];
$$;
create or replace function public.cmms_work_order_required_fields()
returns text[] language sql immutable set search_path=public as $$
  select array['external_id','title','asset_external_id'];
$$;
revoke all on function public.cmms_work_order_allowed_fields() from public, anon, authenticated;
revoke all on function public.cmms_work_order_required_fields() from public, anon, authenticated;

create or replace function public.configure_cmms_read_source(
  p_key text, p_name text, p_system_kind text, p_endpoint_url text,
  p_expected_interval_minutes int, p_credential_binding_ref text,
  p_enabled boolean, p_basis text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
  v_endpoint text:=nullif(trim(coalesce(p_endpoint_url,'')), '');
  v_ref text:=nullif(trim(coalesce(p_credential_binding_ref,'')), '');
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then return jsonb_build_object('error','configuring a CMMS source requires an administrator'); end if;
  if coalesce(length(trim(p_key)),0)<3 or coalesce(length(trim(p_name)),0)<3 then return jsonb_build_object('error','connector key and name are required'); end if;
  if p_system_kind not in ('sap_pm','maximo','oracle_eam','generic_cmms') then return jsonb_build_object('error','CMMS kind must be sap_pm, maximo, oracle_eam or generic_cmms'); end if;
  if coalesce(length(trim(p_basis)),0)<20 then return jsonb_build_object('error','record a substantive CMMS activation authority and basis'); end if;
  if exists(select 1 from public.connectors where organization_id=v_org and connector_key=trim(p_key) and connector_type is distinct from 'cmms_read') then return jsonb_build_object('error','connector key already belongs to another governed integration contract'); end if;
  if v_endpoint is not null and (v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' or v_endpoint ~* '(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|169\\.254\\.|\\[?::1\\]?|@|password|token|api[_-]?key|bearer|secret)') then return jsonb_build_object('error','CMMS endpoints must be credential-free public HTTPS URLs; private/local targets are blocked'); end if;
  if v_ref is not null and (v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$' or v_ref ~ '[@?=]') then return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value or query string'); end if;
  if p_enabled and (v_endpoint is null or coalesce(p_expected_interval_minutes,0)<1 or v_ref is null) then return jsonb_build_object('error','an enabled CMMS source requires an HTTPS endpoint, expected interval and secret-store binding'); end if;
  insert into public.connectors(organization_id,connector_key,name,connector_type,system_kind,endpoint_hint,expected_interval_minutes,credential_binding_ref,contract_note,register_ref,status,enabled,direction,write_enabled)
  values(v_org,trim(p_key),trim(p_name),'cmms_read',p_system_kind,v_endpoint,p_expected_interval_minutes,v_ref,'Thin read-only CMMS work-order pull. No source-system write-back, execute, or autonomous control.','C2.02',case when p_enabled then 'active' else 'configured' end,p_enabled,'read_only',false)
  on conflict (organization_id,connector_key) where connector_key is not null do update set name=excluded.name,connector_type='cmms_read',system_kind=excluded.system_kind,endpoint_hint=excluded.endpoint_hint,expected_interval_minutes=excluded.expected_interval_minutes,credential_binding_ref=excluded.credential_binding_ref,contract_note=excluded.contract_note,register_ref='C2.02',status=excluded.status,enabled=excluded.enabled,direction='read_only',write_enabled=false
  returning id into v_id;
  insert into public.decisions(organization_id,decision_type,action_taken,approval_status,autonomy_mode,confidence_score,human_actor,rationale,outcome_status) values(v_org,'cmms_read_source',case when p_enabled then 'Activated' else 'Configured/disabled' end||' read-only CMMS source '||trim(p_key),'approved','manual',100,auth.uid()::text,trim(p_basis),'executed');
  return jsonb_build_object('ok',true,'connector_id',v_id,'enabled',p_enabled,'direction','read_only','write_enabled',false,'note',case when p_enabled then 'Enabled read-only CMMS pull. It is user-triggered, not unattended.' else 'Saved disabled. Approve a mapping before activation.' end);
end $$;
revoke all on function public.configure_cmms_read_source(text,text,text,text,int,text,boolean,text) from public, anon;
grant execute on function public.configure_cmms_read_source(text,text,text,text,int,text,boolean,text) to authenticated;

create or replace function public.save_cmms_work_order_mapping(
  p_connector_key text,p_source_array_path text,p_column_mapping jsonb,p_approve boolean,p_basis text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_connector public.connectors%rowtype; v_key text; v_value jsonb; v_missing text[]; v_id uuid;
begin
 select role into v_role from public.user_profiles where id=auth.uid();
 if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then return jsonb_build_object('error','approving a CMMS mapping requires an administrator'); end if;
 if coalesce(length(trim(p_basis)),0)<20 then return jsonb_build_object('error','record a substantive mapping basis'); end if;
 if coalesce(p_source_array_path,'') !~ '^[A-Za-z0-9_-]*(\\.[A-Za-z0-9_-]+)*$' then return jsonb_build_object('error','source array path is not a safe dotted identifier'); end if;
 select * into v_connector from public.connectors where organization_id=v_org and connector_key=trim(p_connector_key) and connector_type='cmms_read';
 if not found then return jsonb_build_object('error','CMMS source not found'); end if;
 if jsonb_typeof(coalesce(p_column_mapping,'null'::jsonb))<>'object' then return jsonb_build_object('error','column mapping must be a JSON object'); end if;
 for v_key,v_value in select * from jsonb_each(p_column_mapping) loop
   if not(v_key=any(public.cmms_work_order_allowed_fields())) then return jsonb_build_object('error',format('mapping target "%s" is outside the work_order contract',v_key)); end if;
   if jsonb_typeof(v_value)<>'string' or length(trim(v_value#>>'{}'))=0 or trim(v_value#>>'{}') !~ '^[A-Za-z0-9_-]+$' then return jsonb_build_object('error','each mapping value must be a simple source field name'); end if;
 end loop;
 select array_agg(field) into v_missing from unnest(public.cmms_work_order_required_fields()) field where not(p_column_mapping ? field);
 if v_missing is not null then return jsonb_build_object('error','mapping is missing required work_order fields','missing_fields',to_jsonb(v_missing)); end if;
 insert into public.connector_entity_mappings(organization_id,connector_id,entity_type,source_array_path,column_mapping,value_mappings,constants,status,basis,created_by,approved_by,approved_at)
 values(v_org,v_connector.id,'work_order',coalesce(p_source_array_path,''),p_column_mapping,'{}'::jsonb,'{}'::jsonb,case when p_approve then 'approved' else 'draft' end,trim(p_basis),auth.uid(),case when p_approve then auth.uid() end,case when p_approve then now() end)
 on conflict(connector_id,entity_type) do update set source_array_path=excluded.source_array_path,column_mapping=excluded.column_mapping,status=excluded.status,basis=excluded.basis,approved_by=excluded.approved_by,approved_at=excluded.approved_at,updated_at=now() returning id into v_id;
 return jsonb_build_object('ok',true,'mapping_id',v_id,'entity_type','work_order','status',case when p_approve then 'approved' else 'draft' end,'note',case when p_approve then 'Mapping approved. A user-triggered pull can now promote canonical work orders.' else 'Draft mapping saved. Approve it before a pull can write canonical rows.' end);
end $$;
revoke all on function public.save_cmms_work_order_mapping(text,text,jsonb,boolean,text) from public, anon;
grant execute on function public.save_cmms_work_order_mapping(text,text,jsonb,boolean,text) to authenticated;

create or replace function public.get_cmms_read_source(p_connector_key text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_connector public.connectors%rowtype; v_mapping public.connector_entity_mappings%rowtype;
begin
 select role into v_role from public.user_profiles where id=auth.uid();
 if v_org is null or coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then return jsonb_build_object('error','CMMS source access denied'); end if;
 select * into v_connector from public.connectors where organization_id=v_org and connector_key=trim(p_connector_key) and connector_type='cmms_read'; if not found then return jsonb_build_object('error','CMMS source not found'); end if;
 select * into v_mapping from public.connector_entity_mappings where organization_id=v_org and connector_id=v_connector.id and entity_type='work_order'; if not found then return jsonb_build_object('error','work_order mapping not found'); end if;
 return jsonb_build_object('enabled',v_connector.enabled,'direction',v_connector.direction,'write_enabled',v_connector.write_enabled,'endpoint_url',v_connector.endpoint_hint,'credential_binding_ref',v_connector.credential_binding_ref,'mapping_status',v_mapping.status,'source_array_path',v_mapping.source_array_path,'column_mapping',v_mapping.column_mapping);
end $$;
revoke all on function public.get_cmms_read_source(text) from public, anon;
grant execute on function public.get_cmms_read_source(text) to authenticated;

create or replace function public.begin_cmms_read_run(p_connector_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_connector public.connectors%rowtype; v_run uuid; v_from timestamptz;
begin
 select role into v_role from public.user_profiles where id=auth.uid(); if v_org is null or coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then return jsonb_build_object('error','CMMS pull authority denied'); end if;
 select * into v_connector from public.connectors where organization_id=v_org and connector_key=trim(p_connector_key) and connector_type='cmms_read';
 if not found or not v_connector.enabled or v_connector.direction<>'read_only' or v_connector.write_enabled then return jsonb_build_object('error','active read-only CMMS source not found'); end if;
 if not exists(select 1 from public.connector_entity_mappings where organization_id=v_org and connector_id=v_connector.id and entity_type='work_order' and status='approved') then return jsonb_build_object('error','an administrator must approve the work_order mapping before pull'); end if;
 select last_position into v_from from public.ingest_watermarks where connector_id=v_connector.id and entity_type='work_order';
 insert into public.connector_runs(organization_id,connector_id,entity_type,run_type,status,started_at,watermark_from,triggered_by) values(v_org,v_connector.id,'work_order','sync','running',now(),v_from,auth.uid()) returning id into v_run;
 return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from);
end $$;
revoke all on function public.begin_cmms_read_run(text) from public, anon;
grant execute on function public.begin_cmms_read_run(text) to authenticated;

create or replace function public.ingest_cmms_read_batch(p_run_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_run public.connector_runs%rowtype;
begin
 select role into v_role from public.user_profiles where id=auth.uid();
 if v_org is null or coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then return jsonb_build_object('error','CMMS ingest authority denied'); end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then return jsonb_build_object('error','CMMS rows must be a JSON array of at most 500 rows'); end if;
 select cr.* into v_run from public.connector_runs cr join public.connectors c on c.id=cr.connector_id where cr.id=p_run_id and cr.organization_id=v_org and c.organization_id=v_org and c.connector_type='cmms_read' and c.direction='read_only' and not c.write_enabled and cr.entity_type='work_order';
 if not found then return jsonb_build_object('error','CMMS run not found'); end if;
 return public.ingest_batch(p_run_id,p_rows);
end $$;
revoke all on function public.ingest_cmms_read_batch(uuid,jsonb) from public, anon;
grant execute on function public.ingest_cmms_read_batch(uuid,jsonb) to authenticated;

create or replace function public.preview_cmms_work_order_batch(p_connector_key text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_connector public.connectors%rowtype; v_row jsonb; v_read int:=0; v_ok int:=0; v_rejected int:=0; v_reason text; v_results jsonb:='[]'::jsonb;
begin
 select role into v_role from public.user_profiles where id=auth.uid();
 if v_org is null or coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then return jsonb_build_object('error','CMMS preview authority denied'); end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then return jsonb_build_object('error','CMMS rows must be a JSON array of at most 500 rows'); end if;
 select * into v_connector from public.connectors where organization_id=v_org and connector_key=trim(p_connector_key) and connector_type='cmms_read'; if not found then return jsonb_build_object('error','CMMS source not found'); end if;
 if not exists(select 1 from public.connector_entity_mappings where organization_id=v_org and connector_id=v_connector.id and entity_type='work_order') then return jsonb_build_object('error','save the work_order mapping before dry-run validation'); end if;
 for v_row in select * from jsonb_array_elements(p_rows) loop
  v_read:=v_read+1; v_reason:=null;
  if nullif(trim(coalesce(v_row->>'external_id','')),'') is null then v_reason:='missing external_id';
  elsif nullif(trim(coalesce(v_row->>'title','')),'') is null then v_reason:='missing title';
  elsif nullif(trim(coalesce(v_row->>'asset_external_id','')),'') is null then v_reason:='missing asset_external_id'; end if;
  if v_reason is null then v_ok:=v_ok+1; else v_rejected:=v_rejected+1; end if;
  if v_read<=100 then v_results:=v_results || jsonb_build_array(jsonb_build_object('row_number',v_read,'ok',v_reason is null,'reason',v_reason,'external_id',v_row->>'external_id')); end if;
 end loop;
 return jsonb_build_object('dry_run',true,'read',v_read,'accepted',v_ok,'duplicate',0,'rejected',v_rejected,'results',v_results,'note','A dry run never writes canonical or staging rows. Fix every rejected identity before commit.');
end $$;
revoke all on function public.preview_cmms_work_order_batch(text,jsonb) from public, anon;
grant execute on function public.preview_cmms_work_order_batch(text,jsonb) to authenticated;
