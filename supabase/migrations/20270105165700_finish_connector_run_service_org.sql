-- 20270105163300 replaced finish_connector_run and resolved the tenant only
-- through app_current_org(). Azure IoT Operations ingress finishes the run as
-- service_role, with the tenant in app.service_organization_id. That lookup
-- missed the run, so a clean delivery reported success without advancing the
-- watermark. Keep the named-human gate for CMMS and historian pulls, and
-- restore the service-role tenant the Azure receipt already established.

create or replace function public.finish_connector_run(
  p_run_id uuid,
  p_status text default 'success',
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := case
    when coalesce(auth.role(),'') = 'service_role'
      then nullif(current_setting('app.service_organization_id', true), '')::uuid
    else public.app_current_org()
  end;
  v_role text;
  r public.connector_runs%rowtype;
  c public.connectors%rowtype;
begin
  select * into r
  from public.connector_runs
  where id = p_run_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  select * into c
  from public.connectors
  where id = r.connector_id and organization_id = v_org;

  if c.connector_type in ('cmms_read', 'plant_historian') then
    select role into v_role from public.user_profiles where id = auth.uid();
    if coalesce(v_role, '') not in (
      'planner', 'reliability_engineer', 'maintenance_manager', 'admin'
    ) or r.triggered_by is distinct from auth.uid() then
      return jsonb_build_object(
        'error', 'the named human who triggered this governed pull must finish it'
      );
    end if;
    if r.status <> 'running' then
      return jsonb_build_object('error', 'governed connector run is not running');
    end if;
  end if;
  if p_status not in ('success', 'partial', 'failure') then
    return jsonb_build_object('error', 'run status must be success, partial or failure');
  end if;

  update public.connector_runs
  set status = p_status,
      finished_at = now(),
      error_message = p_error,
      records_processed = records_accepted
  where id = p_run_id and organization_id = v_org;

  if p_status = 'success'
     and r.records_rejected = 0
     and r.watermark_to is not null then
    insert into public.ingest_watermarks (
      organization_id, connector_id, entity_type, last_position, last_run_id
    ) values (
      v_org, r.connector_id, r.entity_type, r.watermark_to, p_run_id
    )
    on conflict (connector_id, entity_type) do update set
      last_position = greatest(
        public.ingest_watermarks.last_position, excluded.last_position
      ),
      last_run_id = excluded.last_run_id,
      updated_at = now();
  end if;

  update public.connectors
  set last_success_at = case
        when p_status = 'success' then now() else last_success_at end,
      last_failure_at = case
        when p_status <> 'success' then now() else last_failure_at end
  where id = r.connector_id and organization_id = v_org;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', p_status,
    'watermark_advanced',
      p_status = 'success'
      and r.records_rejected = 0
      and r.watermark_to is not null,
    'records_rejected', r.records_rejected
  );
end
$$;

revoke all on function public.finish_connector_run(uuid, text, text)
  from public, anon;
grant execute on function public.finish_connector_run(uuid, text, text)
  to authenticated, service_role;
