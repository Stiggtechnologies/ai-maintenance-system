-- Sync Recovery product wiring and tenant-feed ingestion.
--
-- This migration closes two database-level planning gaps without inventing
-- engineering truth:
--   * component life is a governed planning constraint only when the tenant has
--     recorded both an interval and the meter evidence needed to compute age;
--   * material lot condition, certification and staging now participate in the
--     planning/readiness contract and fail closed when evidence is absent.
--
-- It also gives external adapters a narrow, replay-safe path into the existing
-- connector run/staging contract. It does not contain a vendor client or a
-- credential. A connector stays disabled until an administrator records an
-- opaque secret-store binding and explicitly activates it.

alter table public.connectors
  add column if not exists credential_binding_ref text;

comment on column public.connectors.credential_binding_ref is
  'Opaque identifier of a credential in an external secret store. Never the credential value.';

-- Component-life evidence is a first-class planning constraint. Preserve every
-- existing constraint kind while extending the governed vocabulary explicitly;
-- using `other` here would hide the domain meaning from the product and audit
-- trail.
alter table public.restoration_constraints
  drop constraint if exists restoration_constraints_constraint_kind_check;
alter table public.restoration_constraints
  add constraint restoration_constraints_constraint_kind_check check (
    constraint_kind in (
      'precedence','resource','work_zone','material','labour','tooling','bay','crane',
      'vendor','weather','production','approval','permit','isolation','asset_state',
      'quality_hold','component_life','other'
    )
  );

create or replace function public.configure_recovery_signal_connector(
  p_key text,
  p_name text,
  p_system_kind text,
  p_endpoint_hint text,
  p_expected_interval_minutes int,
  p_credential_binding_ref text,
  p_enabled boolean,
  p_basis text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_id uuid;
  v_ref text := nullif(trim(coalesce(p_credential_binding_ref,'')), '');
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then
    return jsonb_build_object('error','configuring a Recovery connector requires an administrator');
  end if;
  if coalesce(length(trim(p_key)),0)<3 or coalesce(length(trim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and name are required');
  end if;
  if p_system_kind not in ('historian','cmms','eam','erp','inventory','condition_monitoring','document','scheduling','data_lake','financial','file') then
    return jsonb_build_object('error','unsupported connector system kind');
  end if;
  if coalesce(length(trim(p_basis)),0)<15 then
    return jsonb_build_object('error','a substantive activation basis is required');
  end if;
  if p_endpoint_hint ~* '(password|token|api[_-]?key|bearer|secret[=:])' then
    return jsonb_build_object('error','endpoint hint appears to contain a credential');
  end if;
  if v_ref is not null and (v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$' or v_ref ~ '[@?=#]') then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value or query string');
  end if;
  if p_enabled and (
    coalesce(length(trim(p_endpoint_hint)),0)<3 or
    coalesce(p_expected_interval_minutes,0)<1 or
    v_ref is null
  ) then
    return jsonb_build_object('error','activation requires an endpoint hint, polling interval and external secret-store binding');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    endpoint_hint,expected_interval_minutes,credential_binding_ref,
    contract_note,status,enabled,direction,write_enabled
  ) values(
    v_org,trim(p_key),trim(p_name),'recovery_signal',p_system_kind,
    nullif(trim(p_endpoint_hint),''),p_expected_interval_minutes,v_ref,
    'Recovery operational-constraint signal feed. Read-only; every row is validated, staged and tenant-bound.',
    case when p_enabled then 'active' else 'configured' end,p_enabled,'read_only',false
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,
    connector_type=excluded.connector_type,
    system_kind=excluded.system_kind,
    endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,
    status=excluded.status,
    enabled=excluded.enabled,
    direction='read_only',
    write_enabled=false
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'recovery_connector_configuration',
    case when p_enabled then 'Activated' else 'Configured/disabled' end || ' Recovery signal connector ' || trim(p_key),
    'approved','manual',100,auth.uid()::text,trim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,'connector_id',v_id,'enabled',p_enabled,'direction','read_only',
    'credential_binding_recorded',v_ref is not null,
    'note',case when p_enabled
      then 'Connector contract is active. Health stays never run until an authenticated adapter completes a run.'
      else 'Connector is configured but disabled; no feed can begin a run.' end
  );
end $$;

alter table public.operational_constraint_signals
  add column if not exists external_id text;

create unique index if not exists uq_recovery_signal_external
  on public.operational_constraint_signals(
    organization_id,source_system,external_id,signal_kind
  ) where external_id is not null;

create or replace function public.ingest_recovery_signal_batch(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid := public.app_current_org();
  v_run public.connector_runs%rowtype;
  v_connector public.connectors%rowtype;
  v_row jsonb;
  v_external_id text;
  v_kind text;
  v_key text;
  v_state text;
  v_reason text;
  v_observed_at timestamptz;
  v_valid_until timestamptz;
  v_site uuid;
  v_asset uuid;
  v_read int := 0;
  v_ok int := 0;
  v_duplicate int := 0;
  v_rejected int := 0;
  v_max_ts timestamptz;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then
    return jsonb_build_object('error','signal ingestion authority denied');
  end if;
  if jsonb_typeof(p_rows)<>'array' then
    return jsonb_build_object('error','rows must be a JSON array');
  end if;
  select * into v_run from public.connector_runs
  where id=p_run_id and organization_id=v_org and status='running';
  if not found then return jsonb_build_object('error','running connector run not found'); end if;
  select * into v_connector from public.connectors
  where id=v_run.connector_id and organization_id=v_org;
  if not found or not v_connector.enabled or v_connector.connector_type<>'recovery_signal' then
    return jsonb_build_object('error','active Recovery signal connector not found');
  end if;
  if v_run.entity_type<>'operational_constraint_signal' then
    return jsonb_build_object('error','connector run entity type must be operational_constraint_signal');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1;
    v_reason:=null;
    v_external_id:=nullif(trim(v_row->>'external_id'),'');
    v_kind:=v_row->>'kind';
    v_key:=nullif(trim(v_row->>'key'),'');
    v_state:=v_row->>'state';
    v_observed_at:=null;
    v_valid_until:=null;
    v_site:=null;
    v_asset:=null;

    if v_external_id is null then v_reason:='missing external_id';
    elsif v_kind not in ('bay','crane','tooling','vendor','documentation','weather','production') then v_reason:='unsupported signal kind';
    elsif v_key is null then v_reason:='missing signal key';
    elsif v_state not in ('available','unavailable','unknown') then v_reason:='invalid signal state';
    elsif nullif(trim(v_row->>'observed_at'),'') is null then v_reason:='missing observed_at';
    elsif nullif(trim(v_row->>'valid_until'),'') is null then v_reason:='missing valid_until';
    elsif coalesce(length(trim(v_row->>'basis')),0)<10 then v_reason:='evidence basis must be at least 10 characters';
    end if;

    if v_reason is null then
      begin
        v_observed_at:=(v_row->>'observed_at')::timestamptz;
        v_valid_until:=(v_row->>'valid_until')::timestamptz;
      exception when others then
        v_reason:='invalid observed_at or valid_until';
      end;
      if v_reason is null then
        if v_observed_at>now()+interval '1 hour' then v_reason:='observed_at is in the future';
        elsif v_valid_until<v_observed_at then v_reason:='valid_until precedes observed_at';
        end if;
      end if;
    end if;

    if v_reason is null and nullif(v_row->>'site_id','') is not null then
      begin
        v_site:=(v_row->>'site_id')::uuid;
      exception when others then v_reason:='invalid site_id'; end;
      if v_reason is null and not exists(select 1 from public.sites where id=v_site and organization_id=v_org) then v_reason:='site_id is outside the active tenant'; end if;
    end if;
    if v_reason is null and nullif(v_row->>'asset_id','') is not null then
      begin
        v_asset:=(v_row->>'asset_id')::uuid;
      exception when others then v_reason:='invalid asset_id'; end;
      if v_reason is null and not exists(select 1 from public.assets where id=v_asset and organization_id=v_org) then v_reason:='asset_id is outside the active tenant'; end if;
    end if;

    if v_reason is null and exists(
      select 1 from public.operational_constraint_signals
      where organization_id=v_org and source_system=v_connector.connector_key
        and external_id=v_external_id and signal_kind=v_kind
    ) then
      v_duplicate:=v_duplicate+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_external_id,v_row,'duplicate');
      continue;
    end if;

    if v_reason is null then
      insert into public.operational_constraint_signals(
        organization_id,site_id,asset_id,signal_kind,signal_key,state,
        observed_at,valid_until,source_system,source_ref,external_id,basis,payload
      ) values(
        v_org,v_site,v_asset,v_kind,v_key,v_state,v_observed_at,v_valid_until,
        v_connector.connector_key,v_external_id,v_external_id,trim(v_row->>'basis'),
        coalesce(v_row->'payload','{}'::jsonb)
      );
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_external_id,v_row,'accepted');
      v_ok:=v_ok+1;
      v_max_ts:=greatest(coalesce(v_max_ts,v_observed_at),v_observed_at);
    else
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason
      ) values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_external_id,v_row,'rejected',v_reason);
      v_rejected:=v_rejected+1;
    end if;
  end loop;

  update public.connector_runs set
    records_read=records_read+v_read,
    records_accepted=records_accepted+v_ok,
    records_rejected=records_rejected+v_rejected,
    records_duplicate=records_duplicate+v_duplicate,
    watermark_to=greatest(coalesce(watermark_to,v_max_ts),v_max_ts)
  where id=p_run_id;

  return jsonb_build_object(
    'read',v_read,'accepted',v_ok,'duplicate',v_duplicate,'rejected',v_rejected
  );
end $$;

create or replace function public.refresh_recovery_planning_inputs(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid := public.app_current_org();
  v_event public.restoration_events%rowtype;
  v_readiness jsonb;
  v_life jsonb;
  v_parts jsonb;
  v_item jsonb;
  v_state text;
  v_basis text;
  v_hard boolean;
  v_event_work uuid;
  v_count int:=0;
  v_blocked int:=0;
  v_unknown int:=0;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','planning-input refresh authority denied');
  end if;
  select * into v_event from public.restoration_events
  where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;

  v_readiness:=public.refresh_restoration_readiness(p_event_id);
  if v_readiness ? 'error' then return v_readiness; end if;
  delete from public.restoration_constraints
  where organization_id=v_org and event_id=p_event_id
    and source_kind='derived' and source_ref like 'recovery-v3:%';

  v_life:=public.get_recovery_component_life_context(p_event_id);
  for v_item in select * from jsonb_array_elements(coalesce(v_life->'components','[]'::jsonb)) loop
    v_event_work:=(v_item->>'event_work_id')::uuid;
    v_hard:=(v_item->>'planned_interval_hours') is not null;
    if v_item->>'current_component_age_hours' is null or not v_hard then
      v_state:='unknown';
      v_basis:='Component age or a governed planned-life interval is missing; do-now/defer is not inferred.';
    elsif (v_item->>'age_pct_of_interval')::numeric>=100 then
      v_state:='blocked';
      v_basis:=format('Recorded component age is %s%% of the governed planned interval.',v_item->>'age_pct_of_interval');
    else
      v_state:='satisfied';
      v_basis:=format('Recorded component age is %s%% of the governed planned interval.',v_item->>'age_pct_of_interval');
    end if;
    insert into public.restoration_constraints(
      organization_id,event_id,event_work_id,constraint_kind,phase,is_hard,state,
      description,basis,source_kind,source_ref,owner_role,verified_by,verified_at
    ) values(
      v_org,p_event_id,v_event_work,'component_life','planning',v_hard,v_state,
      'Component-life planning evidence — '||coalesce(v_item->>'component','unspecified component'),
      v_basis,'derived','recovery-v3:component-life:'||v_event_work::text,
      'reliability_engineer',case when v_state='satisfied' then auth.uid() end,
      case when v_state='satisfied' then now() end
    );
    v_count:=v_count+1;
    if v_hard and v_state='blocked' then v_blocked:=v_blocked+1;
    elsif v_hard and v_state='unknown' then v_unknown:=v_unknown+1; end if;
  end loop;

  v_parts:=public.get_recovery_parts_risk(p_event_id);
  for v_item in select * from jsonb_array_elements(coalesce(v_parts->'lines','[]'::jsonb)) loop
    select id into v_event_work from public.restoration_event_work
    where organization_id=v_org and event_id=p_event_id
      and work_order_id=(v_item->>'work_order_id')::uuid limit 1;
    if v_item->>'risk'='ready' then
      v_state:='satisfied';
      v_basis:='Recorded material demand is ready with serviceable, certified and staged lot evidence.';
    elsif v_item->>'risk'='not_staged' then
      v_state:='unknown';
      v_basis:='Reserved material lacks enough recorded serviceable, certified and staged lot evidence.';
    else
      v_state:='blocked';
      v_basis:='Material demand is not ready or recorded lot condition/certification requires attention.';
    end if;
    insert into public.restoration_constraints(
      organization_id,event_id,event_work_id,constraint_kind,phase,is_hard,state,
      description,basis,source_kind,source_ref,owner_role,verified_by,verified_at
    ) values(
      v_org,p_event_id,v_event_work,'material','planning',true,v_state,
      'Material-lot readiness — '||coalesce(v_item->>'material_code','unknown material'),
      v_basis,'derived','recovery-v3:parts-risk:'||coalesce(v_item->>'work_order_id','')||':'||coalesce(v_item->>'material_id',''),
      'planner',case when v_state='satisfied' then auth.uid() end,
      case when v_state='satisfied' then now() end
    );
    v_count:=v_count+1;
    if v_state='blocked' then v_blocked:=v_blocked+1;
    elsif v_state='unknown' then v_unknown:=v_unknown+1; end if;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'base_readiness',v_readiness,
    'deeper_constraints_refreshed',v_count,
    'hard_blocked',coalesce((v_readiness->>'hard_blocked')::int,0)+v_blocked,
    'hard_unknown',coalesce((v_readiness->>'hard_unknown')::int,0)+v_unknown,
    'ready_for_plan',
      coalesce((v_readiness->>'hard_blocked')::int,0)+v_blocked=0 and
      coalesce((v_readiness->>'hard_unknown')::int,0)+v_unknown=0,
    'policy','Missing component-life and material-lot evidence is never inferred.'
  );
end $$;

revoke all on function public.configure_recovery_signal_connector(text,text,text,text,int,text,boolean,text) from public,anon;
revoke all on function public.ingest_recovery_signal_batch(uuid,jsonb) from public,anon;
revoke all on function public.refresh_recovery_planning_inputs(uuid) from public,anon;
grant execute on function public.configure_recovery_signal_connector(text,text,text,text,int,text,boolean,text) to authenticated;
grant execute on function public.ingest_recovery_signal_batch(uuid,jsonb) to authenticated;
grant execute on function public.refresh_recovery_planning_inputs(uuid) to authenticated;

notify pgrst, 'reload schema';
