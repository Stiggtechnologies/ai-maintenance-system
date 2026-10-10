-- #75: extend canonical deployments; billing remains the sole commercial authority.
-- No new queue, importer, approval store, evidence store or customer assets.
alter table public.deployment_instances
  add column if not exists implementation_billing_id uuid references public.billing_subscriptions(id) on delete restrict,
  add column if not exists implementation jsonb;
create unique index if not exists deployment_implementation_purchase_uq
  on public.deployment_instances(implementation_billing_id)
  where implementation_billing_id is not null;
create unique index if not exists audit_events_implementation_command_uq
  on public.audit_events(organization_id, (event_data->>'commandId'))
  where entity_type='implementation_command';

-- Helpers are private: every entry point derives current tenancy and human authority.
create or replace function public.implementation_evidence(p_id uuid, p_asset uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.evidence_items%rowtype; v_org uuid := app_current_org();
begin
  select * into e from public.evidence_items
    where id=p_id and organization_id=v_org for share;
  if not found or e.verification_status<>'verified' or e.verified_by is null
    or e.verified_at is null or e.evidence_class is null or e.evidence_class='AI_INFERENCE'
    or nullif(btrim(e.description),'') is null
    or (p_asset is not null and e.asset_id is distinct from p_asset)
    or (e.risk_id is not null and not public.can_read_risk(e.risk_id)) then
    raise exception 'verified visible same-tenant evidence required';
  end if;
  return to_jsonb(e);
end $$;
revoke all on function public.implementation_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.implementation_manifest(p_scope jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_org uuid := app_current_org(); x jsonb; a public.assets%rowtype;
  r public.connector_runs%rowtype; t public.asset_twin_templates%rowtype;
  s public.asset_onboarding_state%rowtype; twin public.asset_twin_instances%rowtype;
  v_assets jsonb := '[]'; v_runs jsonb := '[]'; v_ready boolean := true; v_map jsonb;
  v_checklist jsonb; v_seen uuid[] := '{}'; v_run_seen uuid[] := '{}'; v_readiness jsonb;
begin
  if v_org is null or v_org='11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'customer organization required';
  end if;
  if jsonb_typeof(p_scope->'assets') is distinct from 'array'
    or jsonb_array_length(p_scope->'assets') not between 1 and 100
    or jsonb_typeof(p_scope->'runIds') is distinct from 'array'
    or jsonb_array_length(p_scope->'runIds') > 100 then
    raise exception 'select 1 to 100 customer assets and at most 100 import runs';
  end if;
  for x in select value from jsonb_array_elements(p_scope->'assets') loop
    if jsonb_typeof(x) is distinct from 'object' or
       (x - array['assetId','templateId','mappingEvidenceId']) <> '{}'::jsonb then
      raise exception 'unsupported mapping fields';
    end if;
    select * into a from public.assets where id=(x->>'assetId')::uuid and organization_id=v_org for share;
    if not found or a.id=any(v_seen) or coalesce(a.area,'')='Starter Pack' then
      raise exception 'unique real customer assets required';
    end if;
    v_seen := array_append(v_seen,a.id);
    v_map := public.implementation_evidence((x->>'mappingEvidenceId')::uuid,a.id);
    if v_map->>'verified_by'=auth.uid()::text then raise exception 'independent mapping review required'; end if;
    select * into t from public.asset_twin_templates where id=(x->>'templateId')::uuid for share;
    if not found or t.maturity<>'approved' or t.asset_class is distinct from a.asset_class then
      raise exception 'approved class-compatible twin template required; request engineering assistance';
    end if;
    select * into s from public.asset_onboarding_state where asset_id=a.id and organization_id=v_org for share;
    perform 1 from public.asset_onboarding_items where asset_id=a.id and organization_id=v_org for share;
    select coalesce(jsonb_agg(to_jsonb(i)-'filled_at'-'created_at' order by requirement_key),'[]') into v_checklist
      from public.asset_onboarding_items i where asset_id=a.id and organization_id=v_org;
    v_readiness := public.get_golive_readiness(a.id);
    -- Readiness is not implementation acceptance. Every required item and the human gate must stand.
    v_ready := v_ready and exists(select 1 from public.user_profiles p where p.id=s.approved_by
      and p.organization_id=v_org and p.role in ('admin','reliability_engineer','maintenance_manager')
      and nullif(btrim(p.full_name),'') is not null) and coalesce(s.status='live' and s.approved_by is not null
      and s.approved_at is not null and (v_readiness->>'ready')::boolean,false);
    select * into twin from public.asset_twin_instances where asset_id=a.id and organization_id=v_org
      and template_id=t.id and overlay_id is null and customer_overrides='{}'::jsonb
      and compiled_version=t.version||'+customer' and compiled_twin=t.template
      order by created_at limit 1 for share;
    v_assets := v_assets || jsonb_build_array(jsonb_build_object(
      'assetId',a.id,'assetRecord',to_jsonb(a)-array['health_score','risk_score','updated_at'],'checklist',v_checklist,'tag',a.tag,'name',a.name,'assetClass',a.asset_class,'siteId',a.site_id,
      'mapping',v_map,'template',jsonb_build_object('id',t.id,'version',t.version,'content',t.template),
      'twinId',twin.id,'twinContent',twin.compiled_twin,'twinStatus',twin.status,
      'onboarding',jsonb_build_object('status',s.status,'approvedBy',s.approved_by,'approvedAt',s.approved_at),
      'readiness',v_readiness));
  end loop;
  for x in select value from jsonb_array_elements(p_scope->'runIds') loop
    select * into r from public.connector_runs where id=(x#>>'{}')::uuid and organization_id=v_org for share;
    if not found or r.id=any(v_run_seen) or r.status<>'success' or r.finished_at is null
      or r.records_rejected<>0 or r.records_accepted<1 then
      raise exception 'clean completed same-tenant import run required; resolve retained rejects first';
    end if;
    v_run_seen := array_append(v_run_seen,r.id);
    v_runs := v_runs || jsonb_build_array(to_jsonb(r));
  end loop;
  return jsonb_build_object('assets',v_assets,'imports',v_runs,'assetsReady',v_ready,
    'infrastructure','human_assisted','operationalAuthority',false);
end $$;
revoke all on function public.implementation_manifest(jsonb) from public,anon,authenticated,service_role;

-- Owner execution is necessary to protect these fields from legacy blanket policies.
-- GUC alone is insufficient: an authenticated SQL caller cannot impersonate the owner.
create or replace function public.guard_implementation_records()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_owned boolean; v_protected boolean;
begin
  if TG_TABLE_NAME='audit_events' then
    v_protected := coalesce((case when TG_OP='INSERT' then new.entity_type='implementation_command'
      when TG_OP='DELETE' then old.entity_type='implementation_command'
      else old.entity_type='implementation_command' or new.entity_type='implementation_command' end),false);
    if not v_protected then return coalesce(new,old); end if;
    if TG_OP<>'INSERT' then raise exception 'implementation receipts are append-only'; end if;
  else
    v_protected := (case when TG_OP='INSERT' then new.implementation is not null or new.implementation_billing_id is not null
      when TG_OP='DELETE' then old.implementation is not null or old.implementation_billing_id is not null
      else old.implementation is not null or new.implementation is not null
        or old.implementation_billing_id is not null or new.implementation_billing_id is not null end);
    if not v_protected then return coalesce(new,old); end if;
    if TG_OP='DELETE' then raise exception 'retain implementation history; pause instead'; end if;
    if new.status is distinct from 'implementation' or new.implementation is null or new.implementation_billing_id is null then
      raise exception 'implementation binding cannot be removed or provisioned as a starter workspace';
    end if;
    if TG_OP='UPDATE' and (to_jsonb(new)-'implementation') is distinct from (to_jsonb(old)-'implementation') then
      raise exception 'implementation company, purchase and original outcome are immutable';
    end if;
  end if;
  select current_user=pg_get_userbyid(proowner) into v_owned from pg_proc
    where oid='public.command_implementation(uuid,uuid,uuid,integer,text,jsonb,boolean)'::regprocedure;
  if not coalesce(v_owned,false) or current_setting('syncai.implementation_command',true) is distinct from 'on'
    or auth.uid() is null or not exists(select 1 from public.user_profiles
      where id=auth.uid() and organization_id=app_current_org() and role='admin') then
    raise exception 'implementation writes require the authorized command boundary';
  end if;
  return new;
end $$;
revoke all on function public.guard_implementation_records() from public,anon,authenticated,service_role;
drop trigger if exists guard_implementation_records on public.deployment_instances;
create trigger guard_implementation_records before insert or update or delete on public.deployment_instances
  for each row execute function public.guard_implementation_records();
drop trigger if exists guard_implementation_receipts on public.audit_events;
create trigger guard_implementation_receipts before insert or update or delete on public.audit_events
  for each row execute function public.guard_implementation_records();

create or replace function public.command_implementation(
  p_command_id uuid, p_billing_id uuid, p_instance_id uuid, p_revision integer,
  p_action text, p_payload jsonb default '{}', p_dry_run boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_org uuid := app_current_org(); b public.billing_subscriptions%rowtype;
  d public.deployment_instances%rowtype; v_receipt jsonb; v_request jsonb;
  v_state jsonb; v_manifest jsonb; v_before jsonb; v_evidence jsonb; x jsonb; v_twin uuid;
  v_error text; v_id uuid; v_revision integer; v_other uuid;
begin
  if v_org is null or v_org='11111111-1111-1111-1111-111111111111'::uuid or auth.uid() is null
    or not exists(select 1 from public.user_profiles where id=auth.uid() and organization_id=v_org
      and role='admin' and nullif(btrim(full_name),'') is not null) then
    raise exception 'named customer organization administrator required';
  end if;
  if p_command_id is null or p_billing_id is null or p_revision is null or p_revision<0
    or p_action is null or p_action not in ('start','configure','prepare','result','accept','pause','resume')
    or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536 or p_dry_run is null then
    raise exception 'invalid implementation command';
  end if;
  -- Serializes starts and duplicate commands without inventing an inbox/worker queue.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||p_billing_id::text,75));
  perform 1 from public.marketplace_fulfillment_resolutions where billing_subscription_id=p_billing_id
    and organization_id=v_org for share;
  select * into b from public.billing_subscriptions where id=p_billing_id and organization_id=v_org for share;
  if not found or b.status<>'active'
    or (b.billing_source='azure_marketplace' and (b.marketplace_status is distinct from 'Subscribed'
      or not exists(select 1 from public.marketplace_fulfillment_resolutions f where f.billing_subscription_id=b.id
        and f.organization_id=v_org and f.marketplace_subscription_id=b.marketplace_subscription_id
        and f.internal_status='active' and f.marketplace_status='Subscribed' and f.activated_by is not null))) then
    raise exception 'active canonical purchased subscription and verified company binding required';
  end if;
  if b.billing_source='azure_marketplace' then
    perform 1 from public.marketplace_fulfillment_resolutions where billing_subscription_id=b.id
      and organization_id=v_org for share;
  end if;
  v_request := jsonb_build_object('commandId',p_command_id,'billingId',p_billing_id,'instanceId',p_instance_id,
    'revision',p_revision,'action',p_action,'payload',p_payload,'actorId',auth.uid());
  select event_data into v_receipt from public.audit_events where organization_id=v_org
    and entity_type='implementation_command' and event_data->>'commandId'=p_command_id::text;
  if found then
    if v_receipt->'request' is distinct from v_request then raise exception 'command replay conflicts with retained intent'; end if;
    return (v_receipt->'response') || jsonb_build_object('replayed',true);
  end if;
  select * into d from public.deployment_instances where implementation_billing_id=b.id
    and organization_id=v_org for update;
  if p_action='start' then
    if p_instance_id is not null or p_revision<>0 or nullif(btrim(p_payload->>'outcome'),'') is null
      or length(p_payload->>'outcome')>2000 or (p_payload-array['outcome'])<>'{}'::jsonb then
      raise exception 'start requires a preserved intended outcome';
    end if;
    if d.id is not null then
      if d.use_case is distinct from p_payload->>'outcome' then raise exception 'purchase already has a different implementation outcome'; end if;
      if p_dry_run then return jsonb_build_object('dryRun',true,'instanceId',d.id,'revision',p_revision,'writesPerformed',false); end if;
      v_receipt := jsonb_build_object('commandId',p_command_id,'instanceId',d.id,'revision',(d.implementation->>'revision')::integer,'phase',d.implementation->>'phase','existing',true);
      perform set_config('syncai.implementation_command','on',true);
      insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'implementation_command',auth.uid()::text,
        jsonb_build_object('commandId',p_command_id,'request',v_request,'response',v_receipt));
      perform set_config('syncai.implementation_command','off',true);
      return v_receipt;
    end if;
    v_id := gen_random_uuid();
    v_state := jsonb_build_object('version',1,'revision',0,'phase','planning','scope',null,'manifest',null);
  else
    if d.id is null or d.id is distinct from p_instance_id then raise exception 'implementation not found in current company'; end if;
    v_id := d.id; v_state := d.implementation; v_before := v_state;
    if (v_state->>'revision')::integer<>p_revision then raise exception 'implementation changed; reload before a new command'; end if;
    if v_state->>'phase'='accepted' and p_action not in ('pause','configure') then
      raise exception 'accepted implementation is immutable; configure a fresh review or pause';
    end if;
    if v_state->>'phase'='paused' and p_action<>'resume' then raise exception 'resume paused implementation first'; end if;
    case p_action
      when 'configure' then
        if (p_payload-array['assets','runIds'])<>'{}'::jsonb then raise exception 'unsupported scope fields'; end if;
        v_manifest := public.implementation_manifest(p_payload);
        v_state := v_state || jsonb_build_object('phase','planning','scope',p_payload,'manifest',v_manifest,
          'result',null,'acceptance',null,'failure',null);
      when 'prepare' then
        if p_payload<>'{}'::jsonb or v_state->'scope' is null or v_state->'scope'='null'::jsonb then raise exception 'review a mapped scope first'; end if;
        if not p_dry_run then
          -- The legacy compiler upserts by asset/version. Serialize its writes while checking
          -- existing twins so a racing compile cannot be silently overwritten.
          lock table public.asset_twin_instances in share row exclusive mode;
        end if;
        v_manifest := public.implementation_manifest(v_state->'scope');
        if not p_dry_run then
          -- One atomic bounded pass: an error rolls back ALL compilation/autofill writes,
          -- while a durable failure checkpoint lets a human repair and retry. No billable AI.
          begin
            for x in select value from jsonb_array_elements(v_state->'scope'->'assets') loop
              -- Existing version must match exactly: never overwrite another engineer's twin.
              select id into v_twin from public.asset_twin_instances where organization_id=v_org
                and asset_id=(x->>'assetId')::uuid and compiled_version=(select version||'+customer'
                  from public.asset_twin_templates where id=(x->>'templateId')::uuid) for update;
              if v_twin is null then
                v_twin := public.compile_asset_twin((x->>'assetId')::uuid,(x->>'templateId')::uuid,null,'{}');
              elsif not exists(select 1 from jsonb_array_elements(v_manifest->'assets') m
                where m->>'twinId'=v_twin::text) then
                raise exception 'existing twin differs; request engineering assistance';
              end if;
              v_evidence := public.run_asset_onboarding((x->>'assetId')::uuid);
              if v_evidence ? 'error' then raise exception 'onboarding pass failed'; end if;
            end loop;
            v_manifest := public.implementation_manifest(v_state->'scope');
            v_state := v_state || jsonb_build_object('phase','prepared','manifest',v_manifest,'failure',null,'result',null,'acceptance',null);
          exception when others then
            -- Retain a bounded code, not SQL text which may contain customer content.
            v_error := SQLSTATE;
            v_state := v_state || jsonb_build_object('phase','failed','failure',jsonb_build_object('code',v_error,
              'step','prepare','message','Preparation rolled back. Review twin compatibility and onboarding prerequisites.'));
          end;
        end if;
      when 'result' then
        if v_state->>'phase'<>'prepared' or (p_payload-array['evidenceId','statement'])<>'{}'::jsonb
          or nullif(btrim(p_payload->>'statement'),'') is null then raise exception 'prepared scope and explicit first-result review required'; end if;
        v_manifest := public.implementation_manifest(v_state->'scope');
        if not (v_manifest->>'assetsReady')::boolean or exists(select 1 from jsonb_array_elements(v_manifest->'assets') m
          where m->>'twinId' is null or m->>'twinStatus'='retired') then raise exception 'asset approval, readiness and compiled twins must stand'; end if;
        v_evidence := public.implementation_evidence((p_payload->>'evidenceId')::uuid);
        if v_evidence->>'asset_id' is null or not exists(select 1 from jsonb_array_elements(v_manifest->'assets') m
          where m->>'assetId'=v_evidence->>'asset_id') or v_evidence->>'verified_by'=auth.uid()::text then
          raise exception 'independent exact-asset first-result evidence required'; end if;
        v_state := v_state || jsonb_build_object('phase','result_reviewed','manifest',v_manifest,
          'result',jsonb_build_object('evidence',v_evidence,'statement',p_payload->>'statement','reviewedBy',auth.uid(),'reviewedAt',now()));
      when 'accept' then
        if v_state->>'phase'<>'result_reviewed' or (p_payload-array['acceptanceEvidenceId','trainingEvidenceId','supportEvidenceId','statement'])<>'{}'::jsonb
          or nullif(btrim(p_payload->>'statement'),'') is null then raise exception 'explicit customer acceptance and handoff evidence required'; end if;
        v_manifest := public.implementation_manifest(v_state->'scope');
        if v_manifest is distinct from v_state->'manifest' or public.implementation_evidence((v_state->'result'->'evidence'->>'id')::uuid)
          is distinct from v_state->'result'->'evidence' then raise exception 'source standing changed; review a fresh first result'; end if;
        if (select count(distinct value) from jsonb_each_text(p_payload-array['statement']))<>3
          or (v_state->'result'->'evidence'->>'id') in (p_payload->>'acceptanceEvidenceId',p_payload->>'trainingEvidenceId',p_payload->>'supportEvidenceId') then
          raise exception 'distinct acceptance, training and support evidence required'; end if;
        v_evidence := '{}'::jsonb;
        for x in select to_jsonb(j) from jsonb_each_text(p_payload-array['statement']) j loop
          v_manifest := public.implementation_evidence((x->>'value')::uuid);
          if v_manifest->>'evidence_type' is distinct from (case x->>'key'
              when 'acceptanceEvidenceId' then 'customer_acceptance'
              when 'trainingEvidenceId' then 'training_completion'
              when 'supportEvidenceId' then 'support_handoff' end)
            or v_manifest->>'verified_by'=auth.uid()::text
            or v_manifest->>'evidence_class' not in ('DOCUMENTED','TESTED','INSPECTED') then
            raise exception 'independently verified acceptance, completed training and support handoff records required';
          end if;
          v_evidence := v_evidence || jsonb_build_object(x->>'key',v_manifest);
        end loop;
        v_state := v_state || jsonb_build_object('phase','accepted','acceptance',jsonb_build_object('evidence',v_evidence,
          'statement',p_payload->>'statement','acceptedBy',auth.uid(),'acceptedAt',now()));
      when 'pause' then
        if p_payload<>'{}'::jsonb then raise exception 'unsupported pause fields'; end if;
        v_state := v_state || jsonb_build_object('phase','paused','resumePhase',v_state->>'phase');
      when 'resume' then
        if p_payload<>'{}'::jsonb or v_state->>'phase' not in ('paused','failed') then raise exception 'only paused or failed journeys can resume'; end if;
        -- Do not restore historical acceptance as current after a pause.
        v_state := v_state || jsonb_build_object('phase','planning','failure',null,'result',null,'acceptance',null);
      else raise exception 'unsupported command';
    end case;
    v_state := v_state || jsonb_build_object('revision',p_revision+1);
  end if;
  if p_dry_run then
    return jsonb_build_object('dryRun',true,'instanceId',d.id,'revision',p_revision,'manifest',v_manifest,
      'phase',v_state->>'phase','writesPerformed',false,'operationalAuthority',false);
  end if;
  perform set_config('syncai.implementation_command','on',true);
  if p_action='start' then
    insert into public.deployment_instances(id,organization_id,created_by,name,use_case,status,implementation_billing_id,implementation)
    values(v_id,v_org,auth.uid(),'Customer implementation',p_payload->>'outcome','implementation',b.id,v_state);
  else
    update public.deployment_instances set implementation=v_state where id=v_id and organization_id=v_org;
  end if;
  v_receipt := jsonb_build_object('commandId',p_command_id,'instanceId',v_id,'revision',(v_state->>'revision')::integer,
    'phase',v_state->>'phase','failure',v_state->'failure','operationalAuthority',false);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'implementation_command',auth.uid()::text,jsonb_build_object('commandId',p_command_id,
    'request',v_request,'before',v_before,'after',v_state,'response',v_receipt));
  perform set_config('syncai.implementation_command','off',true);
  return v_receipt;
end $$;
revoke all on function public.command_implementation(uuid,uuid,uuid,integer,text,jsonb,boolean) from public,anon,service_role;
grant execute on function public.command_implementation(uuid,uuid,uuid,integer,text,jsonb,boolean) to authenticated;

create or replace function public.get_implementation_workspace()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid := app_current_org(); d record; v_rows jsonb := '[]'; v_current boolean; v_manifest jsonb; x jsonb;
begin
  if v_org is null or not exists(select 1 from public.user_profiles where id=auth.uid() and organization_id=v_org
    and role='admin' and nullif(btrim(full_name),'') is not null) then raise exception 'named organization administrator required'; end if;
  for d in select * from public.deployment_instances where organization_id=v_org and implementation is not null order by created_at desc loop
    v_current := false;
    begin
      if d.implementation->>'phase' in ('result_reviewed','accepted') then
        v_manifest := public.implementation_manifest(d.implementation->'scope');
        v_current := v_manifest=d.implementation->'manifest' and
          public.implementation_evidence((d.implementation->'result'->'evidence'->>'id')::uuid)=d.implementation->'result'->'evidence';
        if d.implementation->>'phase'='accepted' then
          for x in select value from jsonb_each(d.implementation->'acceptance'->'evidence') loop
            v_current := v_current and public.implementation_evidence((x->>'id')::uuid)=x;
          end loop;
        end if;
      end if;
    exception when others then v_current := false; end;
    -- Retained snapshots are not returned: changed risk visibility must not leak old evidence.
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('id',d.id,'billingId',d.implementation_billing_id,
      'outcome',d.use_case,'revision',d.implementation->'revision','phase',d.implementation->>'phase',
      'current',v_current,'scope',d.implementation->'scope','failure',d.implementation->'failure'));
  end loop;
  return jsonb_build_object('organizationId',v_org,'journeys',v_rows,'subscriptions',(
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'plan',plan,'status',status,'source',billing_source,
      'marketplaceStatus',marketplace_status,'periodEnd',current_period_end)),'[]')
    from public.billing_subscriptions where organization_id=v_org),'receipts',(
    select coalesce(jsonb_agg(response),'[]') from (select event_data->'response' response
      from public.audit_events where organization_id=v_org and entity_type='implementation_command'
        and event_data->'request'->>'actorId'=auth.uid()::text order by created_at desc limit 100) r),
    'operationalAuthority',false);
end $$;
revoke all on function public.get_implementation_workspace() from public,anon,service_role;
grant execute on function public.get_implementation_workspace() to authenticated;
comment on column public.deployment_instances.implementation is
  'Resumable post-purchase checkpoints referencing canonical imports, twins, onboarding and verified evidence. No infrastructure provision or operational authority.';
notify pgrst,'reload schema';

-- TRUNCATE bypasses row triggers; protect retained customer history at that door too.
create or replace function public.guard_implementation_truncate()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if TG_TABLE_NAME='deployment_instances' and exists(select 1 from public.deployment_instances where implementation is not null)
    or TG_TABLE_NAME='audit_events' and exists(select 1 from public.audit_events where entity_type='implementation_command') then
    raise exception 'cannot truncate retained implementation history';
  end if;
  return null;
end $$;
revoke all on function public.guard_implementation_truncate() from public,anon,authenticated,service_role;
drop trigger if exists guard_implementation_truncate on public.deployment_instances;
create trigger guard_implementation_truncate before truncate on public.deployment_instances
  for each statement execute function public.guard_implementation_truncate();
drop trigger if exists guard_implementation_truncate on public.audit_events;
create trigger guard_implementation_truncate before truncate on public.audit_events
  for each statement execute function public.guard_implementation_truncate();
