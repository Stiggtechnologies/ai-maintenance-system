-- SC-01 — canonical Sync Context contracts.
--
-- This slice extends the ONE connector, geospatial, evidence and audit planes.
-- It deliberately creates no spatial-object, context-event, context-source,
-- source-health, asset, work, recommendation, approval or audit shadow store.

alter table public.connectors
  add column if not exists context_source_class text check (context_source_class is null or context_source_class in
    ('live_external','simulated_industrial','customer_operational')),
  add column if not exists context_source_authority text check (context_source_authority is null or context_source_authority in
    ('context_only','tenant_authorized','source_asserted')),
  add column if not exists context_purpose text,
  add column if not exists context_rights_state text check (context_rights_state is null or context_rights_state in
    ('unreviewed','not_required','demo_approved','production_approved','customer_authorized','blocked','expired')),
  add column if not exists context_rights_reference text,
  add column if not exists context_rights_basis text,
  add column if not exists context_rights_decided_by uuid references public.user_profiles(id) on delete restrict,
  add column if not exists context_rights_decided_at timestamptz,
  add column if not exists context_health_state text check (context_health_state is null or context_health_state in
    ('connected','live','simulated','not_connected','stale','unavailable','malformed','throttled','delayed','conflicting','partial_coverage','clock_skew')),
  add column if not exists context_checked_at timestamptz,
  add column if not exists context_observed_at timestamptz,
  add column if not exists context_health_detail text;

alter table public.connectors drop constraint if exists connectors_context_contract_complete;
alter table public.connectors add constraint connectors_context_contract_complete check (
  context_source_class is null or (
    organization_id is not null and connector_key is not null
    and context_source_authority is not null
    and length(btrim(coalesce(context_purpose,''))) >= 10
    and context_rights_state is not null
    and length(btrim(coalesce(context_rights_basis,''))) >= 40
    and context_rights_decided_by is not null
    and context_rights_decided_at is not null
    and (context_rights_state not in ('demo_approved','production_approved','customer_authorized')
      or length(btrim(coalesce(context_rights_reference,''))) >= 8)
    and context_health_state is not null
    and context_checked_at is not null
  )
);
alter table public.connectors drop constraint if exists connectors_context_live_freshness;
alter table public.connectors add constraint connectors_context_live_freshness check (
  context_health_state<>'live' or (expected_interval_minutes is not null and expected_interval_minutes>=1)
);

create or replace function public.enforce_context_source_identity()
returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(auth.role(),'') in ('authenticated','service_role')
     and coalesce(current_setting('app.sync_context_source_write',true),'')<>'granted' then
    if tg_op='INSERT' and new.context_source_class is not null then
      raise exception 'Context source governance fields are writable only through governed RPCs';
    elsif tg_op='UPDATE' and (
      new.context_source_class is distinct from old.context_source_class
      or new.context_source_authority is distinct from old.context_source_authority
      or new.context_purpose is distinct from old.context_purpose
      or new.context_rights_state is distinct from old.context_rights_state
      or new.context_rights_reference is distinct from old.context_rights_reference
      or new.context_rights_basis is distinct from old.context_rights_basis
      or new.context_rights_decided_by is distinct from old.context_rights_decided_by
      or new.context_rights_decided_at is distinct from old.context_rights_decided_at
      or new.context_health_state is distinct from old.context_health_state
      or new.context_checked_at is distinct from old.context_checked_at
      or new.context_observed_at is distinct from old.context_observed_at
      or new.context_health_detail is distinct from old.context_health_detail) then
      raise exception 'Context source governance fields are writable only through governed RPCs';
    end if;
  end if;
  if tg_op='UPDATE' and old.context_source_class is not null and
     (new.context_source_class is distinct from old.context_source_class
      or new.organization_id is distinct from old.organization_id
      or new.connector_key is distinct from old.connector_key) then
    raise exception 'Context source class, tenant and source key are immutable; retire the source and register a new identity';
  end if;
  return new;
end $$;
drop trigger if exists trg_context_source_identity on public.connectors;
create trigger trg_context_source_identity before insert or update on public.connectors
for each row execute function public.enforce_context_source_identity();
revoke all on function public.enforce_context_source_identity() from public,anon,authenticated;

create or replace function public.register_context_source(
  p_connector_id uuid,p_source_class text,p_authority text,p_purpose text,
  p_rights_state text,p_rights_reference text,p_basis text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_uid uuid:=auth.uid();
  v_actor_name text; c public.connectors%rowtype;
begin
  if v_org is null or v_uid is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','registering source rights requires an authenticated same-tenant human administrator');
  end if;
  select nullif(btrim(full_name),'') into v_actor_name from public.user_profiles
    where id=v_uid and organization_id=v_org and role='admin';
  if not found or v_actor_name is null then
    return jsonb_build_object('error','a named authenticated human administrator is required'); end if;
  select * into c from public.connectors where id=p_connector_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','connector not found in this organization'); end if;
  if c.context_source_class is not null then return jsonb_build_object('error','Context source identity is already classified and immutable'); end if;
  if coalesce(p_source_class,'') not in ('live_external','simulated_industrial','customer_operational')
     or coalesce(p_authority,'') not in ('context_only','tenant_authorized','source_asserted')
     or coalesce(p_rights_state,'') not in ('unreviewed','not_required','demo_approved','production_approved','customer_authorized','blocked','expired') then
    return jsonb_build_object('error','valid source class, authority and rights state are required');
  end if;
  if coalesce(length(btrim(p_purpose)),0)<10 or coalesce(length(btrim(p_basis)),0)<40 then
    return jsonb_build_object('error','source purpose and an auditable human classification basis of at least 40 characters are required');
  end if;
  if p_rights_state in ('demo_approved','production_approved','customer_authorized')
     and coalesce(length(btrim(p_rights_reference)),0)<8 then
    return jsonb_build_object('error','approved source rights require a dated or otherwise auditable reference');
  end if;
  if p_source_class='live_external' and p_rights_state not in ('demo_approved','production_approved','blocked','expired','unreviewed') then
    return jsonb_build_object('error','external source rights must be reviewed independently of software licensing');
  end if;
  if p_source_class='customer_operational' and p_rights_state not in ('customer_authorized','blocked','expired','unreviewed') then
    return jsonb_build_object('error','customer operational sources require customer authorization');
  end if;
  if p_source_class='simulated_industrial' and p_rights_state<>'not_required' then
    return jsonb_build_object('error','simulated industrial sources use the not_required rights state');
  end if;
  perform set_config('app.sync_context_source_write','granted',true);
  update public.connectors set context_source_class=p_source_class,
    context_source_authority=p_authority,context_purpose=btrim(p_purpose),
    context_rights_state=p_rights_state,context_rights_reference=nullif(btrim(coalesce(p_rights_reference,'')),''),
    context_rights_basis=btrim(p_basis),context_rights_decided_by=v_uid,context_rights_decided_at=now(),
    context_health_state=case when p_source_class='simulated_industrial' then 'simulated' else 'not_connected' end,
    context_checked_at=now(),context_observed_at=null,
    context_health_detail='Source registered; no live observation has been asserted.' where id=c.id;
  perform set_config('app.sync_context_source_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'sync_context_source_registered',v_uid::text,jsonb_build_object('connector_id',c.id,'basis',btrim(p_basis),
      'actor_name',v_actor_name,'actor_role',v_role,'operational_authority',false),jsonb_build_object(),jsonb_build_object('source_class',p_source_class,
      'authority',p_authority,'rights_state',p_rights_state));
  return jsonb_build_object('connector_id',c.id,'source_class',p_source_class,'status','registered','operational_authority',false);
end $$;
revoke all on function public.register_context_source(uuid,text,text,text,text,text,text) from public,anon;
grant execute on function public.register_context_source(uuid,text,text,text,text,text,text) to authenticated;

create or replace function public.transition_context_source_rights(
  p_connector_id uuid,p_rights_state text,p_rights_reference text,p_basis text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_uid uuid:=auth.uid();
  v_actor_name text; c public.connectors%rowtype;
begin
  if v_org is null or v_uid is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','changing source rights requires an authenticated same-tenant human administrator'); end if;
  select nullif(btrim(full_name),'') into v_actor_name from public.user_profiles
    where id=v_uid and organization_id=v_org and role='admin';
  if not found or v_actor_name is null then return jsonb_build_object('error','a named authenticated human administrator is required'); end if;
  select * into c from public.connectors where id=p_connector_id and organization_id=v_org
    and context_source_class is not null for update;
  if not found then return jsonb_build_object('error','classified Context source not found'); end if;
  if coalesce(p_rights_state,'') not in ('blocked','expired') then
    return jsonb_build_object('error','this transition retires or revokes rights; approved rights require a new governed classification review'); end if;
  if coalesce(length(btrim(p_basis)),0)<40 or coalesce(length(btrim(p_rights_reference)),0)<8 then
    return jsonb_build_object('error','revocation or expiry requires an auditable reference and basis of at least 40 characters'); end if;
  perform set_config('app.sync_context_source_write','granted',true);
  update public.connectors set context_rights_state=p_rights_state,
    context_rights_reference=btrim(p_rights_reference),context_rights_basis=btrim(p_basis),
    context_rights_decided_by=v_uid,context_rights_decided_at=now(),
    context_health_state=case when p_rights_state='blocked' then 'unavailable' else 'stale' end,
    context_checked_at=greatest(now(),coalesce(context_checked_at,'-infinity'::timestamptz)+interval '1 microsecond'),
    context_health_detail='Source rights no longer permit live display.' where id=c.id;
  perform set_config('app.sync_context_source_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'sync_context_source_rights_transition',v_uid::text,
    jsonb_build_object('connector_id',c.id,'basis',btrim(p_basis),'actor_name',v_actor_name,'actor_role',v_role,'operational_authority',false),
    jsonb_build_object('rights_state',c.context_rights_state,'health_state',c.context_health_state),
    jsonb_build_object('rights_state',p_rights_state,'health_state',case when p_rights_state='blocked' then 'unavailable' else 'stale' end,'display_as_live',false));
  return jsonb_build_object('connector_id',c.id,'rights_state',p_rights_state,'display_as_live',false);
end $$;
revoke all on function public.transition_context_source_rights(uuid,text,text,text) from public,anon;
grant execute on function public.transition_context_source_rights(uuid,text,text,text) to authenticated;

create or replace function public.record_context_source_health(
  p_connector_id uuid,p_state text,p_checked_at timestamptz,p_observed_at timestamptz,p_detail text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); c public.connectors%rowtype;
  v_live boolean; v_effective_observed timestamptz;
begin
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin','planner','reliability_engineer','maintenance_manager') then
    return jsonb_build_object('error','source health requires an authenticated same-tenant operator');
  end if;
  select * into c from public.connectors where id=p_connector_id and organization_id=v_org and context_source_class is not null for update;
  if not found then return jsonb_build_object('error','classified Context source not found'); end if;
  if coalesce(p_state,'') not in ('connected','live','simulated','not_connected','stale','unavailable','malformed','throttled','delayed','conflicting','partial_coverage','clock_skew') then
    return jsonb_build_object('error','unsupported normalized source-health state');
  end if;
  if p_checked_at is null or p_checked_at>now()+interval '5 minutes' then return jsonb_build_object('error','a valid source check time is required'); end if;
  if c.context_checked_at is not null and p_checked_at<=c.context_checked_at then
    return jsonb_build_object('error','source health check time must advance monotonically'); end if;
  if p_observed_at is not null and p_observed_at>p_checked_at+interval '5 minutes' then return jsonb_build_object('error','source observation cannot be later than its check'); end if;
  if p_state in ('live','simulated','delayed','conflicting','partial_coverage','clock_skew') and p_observed_at is null then
    return jsonb_build_object('error','this health state requires an observation time'); end if;
  if c.context_source_class='simulated_industrial' and p_state<>'simulated' then
    return jsonb_build_object('error','simulated industrial sources cannot be relabeled live or customer operational'); end if;
  if p_state='live' and (c.expected_interval_minutes is null or c.expected_interval_minutes<1) then
    return jsonb_build_object('error','live source health requires an enforced positive freshness interval'); end if;
  if p_state='live' and c.context_observed_at is not null and p_observed_at<c.context_observed_at then
    return jsonb_build_object('error','a later live check cannot regress the canonical observation time'); end if;
  if p_observed_at is not null and c.context_observed_at is not null and p_observed_at<c.context_observed_at
     and p_state not in ('delayed','conflicting') then
    return jsonb_build_object('error','out-of-order observations must be reported as delayed or conflicting evidence'); end if;
  if p_state='live' and ((c.context_source_class='live_external' and c.context_rights_state<>'production_approved')
      or (c.context_source_class='customer_operational' and c.context_rights_state<>'customer_authorized')) then
    return jsonb_build_object('error','source rights or customer authorization do not permit a live claim'); end if;
  v_effective_observed:=greatest(c.context_observed_at,p_observed_at);
  perform set_config('app.sync_context_source_write','granted',true);
  update public.connectors set context_health_state=p_state,context_checked_at=p_checked_at,
    context_observed_at=v_effective_observed,
    context_health_detail=nullif(btrim(coalesce(p_detail,'')),'') where id=c.id;
  perform set_config('app.sync_context_source_write','',true);
  v_live:=p_state='live' and c.context_source_class<>'simulated_industrial';
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'sync_context_source_health',v_role,jsonb_build_object('connector_id',c.id,'operational_authority',false),
    jsonb_build_object('state',c.context_health_state,'checked_at',c.context_checked_at,'observed_at',c.context_observed_at),
    jsonb_build_object('state',p_state,'checked_at',p_checked_at,'reported_observed_at',p_observed_at,
      'observed_at',v_effective_observed,
      'out_of_order_evidence',p_observed_at is not null and c.context_observed_at is not null and p_observed_at<c.context_observed_at,
      'display_as_live',v_live));
  return jsonb_build_object('connector_id',c.id,'state',p_state,'checked_at',p_checked_at,
    'observed_at',v_effective_observed,'display_as_live',v_live);
end $$;
revoke all on function public.record_context_source_health(uuid,text,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.record_context_source_health(uuid,text,timestamptz,timestamptz,text) to authenticated;

alter table public.geospatial_features
  add column if not exists source_connector_id uuid references public.connectors(id) on delete restrict,
  add column if not exists validity_kind text check (validity_kind is null or validity_kind in ('permanent','temporary')),
  add column if not exists context_owner_id uuid references public.user_profiles(id) on delete restrict;
alter table public.geospatial_features drop constraint if exists geospatial_feature_context_validity;
alter table public.geospatial_features add constraint geospatial_feature_context_validity check (
  validity_kind is null or (validity_kind='permanent' and valid_until is null)
  or (validity_kind='temporary' and valid_until is not null)
);

alter table public.geospatial_subject_links
  add column if not exists work_order_id uuid references public.work_orders(id) on delete cascade,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists recommendation_id uuid references public.recommendations(id) on delete cascade,
  add column if not exists decision_id uuid references public.decisions(id) on delete restrict,
  add column if not exists approval_id uuid references public.approvals(id) on delete restrict,
  add column if not exists risk_id uuid references public.risks(id) on delete restrict,
  add column if not exists restoration_event_id uuid references public.restoration_events(id) on delete cascade,
  add column if not exists development_case_id uuid references public.development_cases(id) on delete cascade,
  add column if not exists capital_project_id bigint references public.capital_projects(id) on delete cascade,
  -- audit_events is an append-only ledger with its own UPDATE/DELETE/TRUNCATE
  -- refusal contract. A foreign key into it changes TRUNCATE into a generic FK
  -- error before that contract can run. The trigger below performs the
  -- same-tenant existence check without weakening the ledger invariant.
  add column if not exists audit_event_id uuid;
alter table public.geospatial_subject_links drop constraint if exists geospatial_subject_links_check;
alter table public.geospatial_subject_links add constraint geospatial_subject_links_check check (
  num_nonnulls(asset_id,site_id,linear_route_id,linear_segment_id,work_order_id,evidence_item_id,
    recommendation_id,decision_id,approval_id,risk_id,restoration_event_id,development_case_id,
    capital_project_id,audit_event_id)>=1
);

drop index if exists public.uq_geospatial_subject_link;
create unique index uq_geospatial_subject_link
  on public.geospatial_subject_links(organization_id,feature_id,relationship_type,
    coalesce(asset_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(linear_route_id,0),coalesce(linear_segment_id,0),
    coalesce(work_order_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(evidence_item_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(recommendation_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(decision_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(approval_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(risk_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(restoration_event_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(development_case_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(capital_project_id,0),
    coalesce(audit_event_id,'00000000-0000-0000-0000-000000000000'::uuid));

create or replace function public.enforce_sync_context_tenant_provenance()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_table_name='geospatial_features' then
    if new.source_connector_id is null or not exists(select 1 from public.connectors c where c.id=new.source_connector_id
      and c.organization_id=new.organization_id and c.context_source_class is not null) then
      raise exception 'a same-tenant classified Context source is required'; end if;
    if new.context_owner_id is null or not exists(select 1 from public.user_profiles u where u.id=new.context_owner_id and u.organization_id=new.organization_id) then
      raise exception 'a same-tenant human Context owner is required'; end if;
  else
    if not exists(select 1 from public.geospatial_features f where f.id=new.feature_id and f.organization_id=new.organization_id) then raise exception 'feature crosses the Context tenant boundary'; end if;
    if new.asset_id is not null and not exists(select 1 from public.assets x where x.id=new.asset_id and x.organization_id=new.organization_id) then raise exception 'asset crosses the Context tenant boundary'; end if;
    if new.site_id is not null and not exists(select 1 from public.sites x where x.id=new.site_id and x.organization_id=new.organization_id) then raise exception 'site crosses the Context tenant boundary'; end if;
    if new.linear_route_id is not null and not exists(select 1 from public.linear_asset_routes x where x.id=new.linear_route_id and x.organization_id=new.organization_id) then raise exception 'linear route crosses the Context tenant boundary'; end if;
    if new.linear_segment_id is not null and not exists(select 1 from public.linear_segments x where x.id=new.linear_segment_id and x.organization_id=new.organization_id) then raise exception 'linear segment crosses the Context tenant boundary'; end if;
    if new.work_order_id is not null and not exists(select 1 from public.work_orders x where x.id=new.work_order_id and x.organization_id=new.organization_id) then raise exception 'work order crosses the Context tenant boundary'; end if;
    if new.evidence_item_id is not null and not exists(select 1 from public.evidence_items x where x.id=new.evidence_item_id and x.organization_id=new.organization_id) then raise exception 'evidence crosses the Context tenant boundary'; end if;
    if new.recommendation_id is not null and not exists(select 1 from public.recommendations x where x.id=new.recommendation_id and x.organization_id=new.organization_id) then raise exception 'recommendation crosses the Context tenant boundary'; end if;
    if new.decision_id is not null and not exists(select 1 from public.decisions x where x.id=new.decision_id and x.organization_id=new.organization_id) then raise exception 'decision crosses the Context tenant boundary'; end if;
    if new.approval_id is not null and not exists(select 1 from public.approvals x where x.id=new.approval_id and x.organization_id=new.organization_id) then raise exception 'approval crosses the Context tenant boundary'; end if;
    if new.risk_id is not null and not exists(select 1 from public.risks x where x.id=new.risk_id and x.organization_id=new.organization_id) then raise exception 'risk crosses the Context tenant boundary'; end if;
    if new.restoration_event_id is not null and not exists(select 1 from public.restoration_events x where x.id=new.restoration_event_id and x.organization_id=new.organization_id) then raise exception 'recovery event crosses the Context tenant boundary'; end if;
    if new.development_case_id is not null and not exists(select 1 from public.development_cases x where x.id=new.development_case_id and x.organization_id=new.organization_id) then raise exception 'development case crosses the Context tenant boundary'; end if;
    if new.capital_project_id is not null and not exists(select 1 from public.capital_projects x where x.id=new.capital_project_id and x.organization_id=new.organization_id) then raise exception 'capital project crosses the Context tenant boundary'; end if;
    if new.audit_event_id is not null and not exists(select 1 from public.audit_events x where x.id=new.audit_event_id and x.organization_id=new.organization_id) then raise exception 'audit event crosses the Context tenant boundary'; end if;
    if new.work_order_id is not null and new.recommendation_id is not null and not exists(
      select 1 from public.work_orders w where w.id=new.work_order_id and w.recommendation_id=new.recommendation_id) then
      raise exception 'work order is not governed by the linked recommendation'; end if;
    if new.decision_id is not null and new.recommendation_id is not null and not exists(
      select 1 from public.decisions d where d.id=new.decision_id and d.recommendation_id=new.recommendation_id) then
      raise exception 'decision is not governed by the linked recommendation'; end if;
    if new.approval_id is not null and new.work_order_id is not null and not exists(
      select 1 from public.approvals a join public.work_orders w on w.id=new.work_order_id
      where a.id=new.approval_id and a.work_order_id=w.id
        and (a.recommendation_id is null or w.recommendation_id is null or a.recommendation_id=w.recommendation_id)) then
      raise exception 'approval does not govern the linked work order'; end if;
    if new.approval_id is not null and new.recommendation_id is not null and not exists(
      select 1 from public.approvals a where a.id=new.approval_id and a.recommendation_id=new.recommendation_id) then
      raise exception 'approval does not govern the linked recommendation'; end if;
    if new.approval_id is not null and new.decision_id is not null and not exists(
      select 1 from public.approvals a where a.id=new.approval_id and a.decision_id=new.decision_id) then
      raise exception 'approval does not govern the linked decision'; end if;
    if new.work_order_id is not null and new.decision_id is not null and not exists(
      select 1 from public.work_orders w join public.decisions d on d.id=new.decision_id
      where w.id=new.work_order_id and (w.recommendation_id is null or d.recommendation_id is null
        or w.recommendation_id=d.recommendation_id)) then
      raise exception 'work order and decision do not share their canonical recommendation'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_context_feature_tenant on public.geospatial_features;
create trigger trg_sync_context_feature_tenant before insert or update on public.geospatial_features
for each row when (new.source_connector_id is not null) execute function public.enforce_sync_context_tenant_provenance();
drop trigger if exists trg_sync_context_link_tenant on public.geospatial_subject_links;
create trigger trg_sync_context_link_tenant before insert or update on public.geospatial_subject_links
for each row execute function public.enforce_sync_context_tenant_provenance();
revoke all on function public.enforce_sync_context_tenant_provenance() from public,anon,authenticated;

create or replace function public.link_geospatial_subject(p_link jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid;
  v_feature uuid:=nullif(p_link->>'feature_id','')::uuid;
  v_asset uuid:=nullif(p_link->>'asset_id','')::uuid; v_site uuid:=nullif(p_link->>'site_id','')::uuid;
  v_route bigint:=nullif(p_link->>'linear_route_id','')::bigint; v_segment bigint:=nullif(p_link->>'linear_segment_id','')::bigint;
  v_work uuid:=nullif(p_link->>'work_order_id','')::uuid; v_evidence_subject uuid:=nullif(p_link->>'evidence_item_id','')::uuid;
  v_recommendation uuid:=nullif(p_link->>'recommendation_id','')::uuid; v_decision uuid:=nullif(p_link->>'decision_id','')::uuid;
  v_approval uuid:=nullif(p_link->>'approval_id','')::uuid; v_risk uuid:=nullif(p_link->>'risk_id','')::uuid;
  v_recovery uuid:=nullif(p_link->>'restoration_event_id','')::uuid; v_case uuid:=nullif(p_link->>'development_case_id','')::uuid;
  v_project bigint:=nullif(p_link->>'capital_project_id','')::bigint; v_audit uuid:=nullif(p_link->>'audit_event_id','')::uuid;
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_link->'evidence_item_ids','[]'))::uuid),'{}');
begin
  if v_org is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','planner','admin') then
    return jsonb_build_object('error','a named same-tenant human role must link geospatial context'); end if;
  if p_link->>'relationship_type' not in ('located_at','traverses','exposed_to','accessible_via','near_receptor','served_by','in_region')
    or coalesce(length(trim(p_link->>'basis')),0)<20 then return jsonb_build_object('error','valid relationship and substantive basis are required'); end if;
  if not exists(select 1 from public.geospatial_features where id=v_feature and organization_id=v_org and status='verified') then
    return jsonb_build_object('error','verified geospatial feature not found in this organization'); end if;
  if num_nonnulls(v_asset,v_site,v_route,v_segment,v_work,v_evidence_subject,v_recommendation,v_decision,
      v_approval,v_risk,v_recovery,v_case,v_project,v_audit)<1 then
    return jsonb_build_object('error','link at least one canonical Context subject'); end if;
  if v_asset is not null and not exists(select 1 from public.assets x where x.id=v_asset and x.organization_id=v_org) then
    return jsonb_build_object('error','asset not found in this organization'); end if;
  if v_site is not null and not exists(select 1 from public.sites x where x.id=v_site and x.organization_id=v_org) then
    return jsonb_build_object('error','site not found in this organization'); end if;
  if v_route is not null and not exists(select 1 from public.linear_asset_routes x where x.id=v_route and x.organization_id=v_org) then
    return jsonb_build_object('error','linear route not found in this organization'); end if;
  if v_segment is not null and not exists(select 1 from public.linear_segments x where x.id=v_segment and x.organization_id=v_org
      and (v_route is null or x.route_id=v_route)) then
    return jsonb_build_object('error','linear segment not found in this organization'); end if;
  if v_work is not null and not exists(select 1 from public.work_orders x where x.id=v_work and x.organization_id=v_org) then
    return jsonb_build_object('error','work order not found in this organization'); end if;
  if v_evidence_subject is not null and not exists(select 1 from public.evidence_items x where x.id=v_evidence_subject and x.organization_id=v_org) then
    return jsonb_build_object('error','evidence item not found in this organization'); end if;
  if v_recommendation is not null and not exists(select 1 from public.recommendations x where x.id=v_recommendation and x.organization_id=v_org) then
    return jsonb_build_object('error','recommendation not found in this organization'); end if;
  if v_decision is not null and not exists(select 1 from public.decisions x where x.id=v_decision and x.organization_id=v_org) then
    return jsonb_build_object('error','decision not found in this organization'); end if;
  if v_approval is not null and not exists(select 1 from public.approvals x where x.id=v_approval and x.organization_id=v_org) then
    return jsonb_build_object('error','approval not found in this organization'); end if;
  if v_risk is not null and not exists(select 1 from public.risks x where x.id=v_risk and x.organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_recovery is not null and not exists(select 1 from public.restoration_events x where x.id=v_recovery and x.organization_id=v_org) then
    return jsonb_build_object('error','recovery event not found in this organization'); end if;
  if v_case is not null and not exists(select 1 from public.development_cases x where x.id=v_case and x.organization_id=v_org) then
    return jsonb_build_object('error','development case not found in this organization'); end if;
  if v_project is not null and not exists(select 1 from public.capital_projects x where x.id=v_project and x.organization_id=v_org) then
    return jsonb_build_object('error','capital project not found in this organization'); end if;
  if v_audit is not null and not exists(select 1 from public.audit_events x where x.id=v_audit and x.organization_id=v_org) then
    return jsonb_build_object('error','audit event not found in this organization'); end if;
  if exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e on e.id=x.id and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','link evidence must belong to this organization'); end if;
  if v_work is not null and v_recommendation is not null and not exists(
    select 1 from public.work_orders w where w.id=v_work and w.organization_id=v_org and w.recommendation_id=v_recommendation) then
    return jsonb_build_object('error','work order is not governed by the linked recommendation'); end if;
  if v_decision is not null and v_recommendation is not null and not exists(
    select 1 from public.decisions d where d.id=v_decision and d.organization_id=v_org and d.recommendation_id=v_recommendation) then
    return jsonb_build_object('error','decision is not governed by the linked recommendation'); end if;
  if v_approval is not null and v_work is not null and not exists(
    select 1 from public.approvals a join public.work_orders w on w.id=v_work and w.organization_id=v_org
    where a.id=v_approval and a.organization_id=v_org and a.work_order_id=w.id
      and (a.recommendation_id is null or w.recommendation_id is null or a.recommendation_id=w.recommendation_id)) then
    return jsonb_build_object('error','approval does not govern the linked work order'); end if;
  if v_approval is not null and v_recommendation is not null and not exists(
    select 1 from public.approvals a where a.id=v_approval and a.organization_id=v_org and a.recommendation_id=v_recommendation) then
    return jsonb_build_object('error','approval does not govern the linked recommendation'); end if;
  if v_approval is not null and v_decision is not null and not exists(
    select 1 from public.approvals a where a.id=v_approval and a.organization_id=v_org and a.decision_id=v_decision) then
    return jsonb_build_object('error','approval does not govern the linked decision'); end if;
  if v_work is not null and v_decision is not null and not exists(
    select 1 from public.work_orders w join public.decisions d on d.id=v_decision and d.organization_id=v_org
    where w.id=v_work and w.organization_id=v_org and (w.recommendation_id is null or d.recommendation_id is null
      or w.recommendation_id=d.recommendation_id)) then
    return jsonb_build_object('error','work order and decision do not share their canonical recommendation'); end if;
  insert into public.geospatial_subject_links(organization_id,feature_id,relationship_type,asset_id,site_id,
    linear_route_id,linear_segment_id,work_order_id,evidence_item_id,recommendation_id,decision_id,approval_id,
    risk_id,restoration_event_id,development_case_id,capital_project_id,audit_event_id,from_measure,to_measure,
    basis,evidence_item_ids,recorded_by)
  values(v_org,v_feature,p_link->>'relationship_type',v_asset,v_site,v_route,v_segment,v_work,v_evidence_subject,
    v_recommendation,v_decision,v_approval,v_risk,v_recovery,v_case,v_project,v_audit,
    nullif(p_link->>'from_measure','')::numeric,nullif(p_link->>'to_measure','')::numeric,
    trim(p_link->>'basis'),v_evidence,auth.uid()) returning id into v_id;
  return jsonb_build_object('link_id',v_id,'status','recorded');
exception when unique_violation then return jsonb_build_object('error','the active feature-to-subject link already exists');
  when invalid_text_representation then return jsonb_build_object('error','canonical subject identifiers must use their declared identifier types');
  when others then return jsonb_build_object('error','unable to link geospatial context; review the governed input fields');
end $$;

-- Preserve approval decisions as canonical audit facts so event governance is
-- evaluated as-of the event time rather than from the approval's current row.
create or replace function public.audit_sync_context_approval_decision()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('approved','rejected') and new.decided_at is not null and
     (tg_op='INSERT' or new.status is distinct from old.status or new.decided_at is distinct from old.decided_at) then
    insert into public.audit_events(organization_id,entity_type,actor,event_time,event_data,previous_state,new_state)
    values(new.organization_id,'approval_decision',coalesce(auth.uid()::text,'migration'),new.decided_at,
      jsonb_build_object('approval_id',new.id,'work_order_id',new.work_order_id,
        'recommendation_id',new.recommendation_id,'decision_id',new.decision_id),
      case when tg_op='UPDATE' then jsonb_build_object('status',old.status,'decided_at',old.decided_at) else '{}'::jsonb end,
      jsonb_build_object('status',new.status,'decided_at',new.decided_at));
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_context_approval_decision on public.approvals;
create trigger trg_sync_context_approval_decision after insert or update of status,decided_at on public.approvals
for each row execute function public.audit_sync_context_approval_decision();
revoke all on function public.audit_sync_context_approval_decision() from public,anon,authenticated;

insert into public.audit_events(organization_id,entity_type,actor,event_time,event_data,previous_state,new_state)
select a.organization_id,'approval_decision','migration',a.decided_at,
  jsonb_build_object('approval_id',a.id,'work_order_id',a.work_order_id,
    'recommendation_id',a.recommendation_id,'decision_id',a.decision_id),
  '{}'::jsonb,jsonb_build_object('status',a.status,'decided_at',a.decided_at)
from public.approvals a
where a.status in ('approved','rejected') and a.decided_at is not null
  and not exists(select 1 from public.audit_events e where e.organization_id=a.organization_id
    and e.entity_type='approval_decision' and e.event_data->>'approval_id'=a.id::text
    and e.event_time=a.decided_at and e.new_state->>'status'=a.status);

create or replace function public.sync_context_source_rights_permit(p_source public.connectors)
returns boolean language sql stable security definer set search_path=public as $$
  select case p_source.context_source_class
    when 'live_external' then p_source.context_rights_state in ('demo_approved','production_approved')
    when 'customer_operational' then p_source.context_rights_state='customer_authorized'
    when 'simulated_industrial' then p_source.context_rights_state='not_required'
    else false
  end
$$;
revoke all on function public.sync_context_source_rights_permit(public.connectors) from public,anon,authenticated,service_role;

-- Direct table reads are narrower than the security-definer projections.
drop policy if exists connectors_org_read on public.connectors;
create policy connectors_org_read on public.connectors for select to authenticated
using (organization_id=public.app_current_org() and public.app_current_role() in
  ('planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin'));

drop policy if exists geospatial_features_read on public.geospatial_features;
create policy geospatial_features_read on public.geospatial_features for select to authenticated
using (organization_id=public.app_current_org()
  and public.app_current_role() in ('planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin')
  and exists(select 1 from public.connectors c where c.id=public.geospatial_features.source_connector_id
    and c.organization_id=public.geospatial_features.organization_id and public.sync_context_source_rights_permit(c)));

drop policy if exists geospatial_subject_links_read on public.geospatial_subject_links;
create policy geospatial_subject_links_read on public.geospatial_subject_links for select to authenticated
using (organization_id=public.app_current_org()
  and public.app_current_role() in ('planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin')
  and exists(select 1 from public.geospatial_features f join public.connectors c
    on c.id=f.source_connector_id and c.organization_id=f.organization_id
    where f.id=public.geospatial_subject_links.feature_id
      and f.organization_id=public.geospatial_subject_links.organization_id and public.sync_context_source_rights_permit(c))
  and (risk_id is null or public.can_read_risk(risk_id)));

drop policy if exists geospatial_assessments_read on public.geospatial_operational_assessments;
create policy geospatial_assessments_read on public.geospatial_operational_assessments for select to authenticated
using (organization_id=public.app_current_org()
  and public.app_current_role() in ('planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin')
  and (recommendation_id is null or exists(select 1 from public.recommendations r
    where r.id=public.geospatial_operational_assessments.recommendation_id
      and r.organization_id=public.geospatial_operational_assessments.organization_id
      and (r.risk_id is null or public.can_read_risk(r.risk_id))))
  and (access_route_feature_id is null or exists(select 1 from public.geospatial_features f
    join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
    where f.id=public.geospatial_operational_assessments.access_route_feature_id
      and f.organization_id=public.geospatial_operational_assessments.organization_id
      and public.sync_context_source_rights_permit(c)))
  and not exists(select 1 from unnest(input_feature_ids) x(id)
    left join public.geospatial_features f on f.id=x.id
      and f.organization_id=public.geospatial_operational_assessments.organization_id
    left join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
    where f.id is null or c.id is null or not public.sync_context_source_rights_permit(c)));

create or replace function public.enforce_context_feature_verification()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='verified' and (new.source_connector_id is null or new.context_owner_id is null
      or new.validity_kind is null or (new.valid_until is not null and new.valid_until<=now())) then
    raise exception 'verified Context features require classified source, named owner and current explicit validity';
  end if;
  return new;
end $$;
drop trigger if exists trg_context_feature_verification on public.geospatial_features;
create trigger trg_context_feature_verification before insert or update on public.geospatial_features
for each row execute function public.enforce_context_feature_verification();
revoke all on function public.enforce_context_feature_verification() from public,anon,authenticated;

update public.geospatial_features set status='superseded'
where status='verified' and (source_connector_id is null or context_owner_id is null or validity_kind is null
  or (valid_until is not null and valid_until<=now()));

create or replace function public.enforce_context_assessment_inputs()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status in ('draft','verified') and new.access_route_feature_id is not null and not exists(select 1 from public.geospatial_features f
    where f.id=new.access_route_feature_id and f.organization_id=new.organization_id and f.status='verified'
      and f.source_connector_id is not null and f.context_owner_id is not null and f.validity_kind is not null
      and (f.valid_until is null or f.valid_until>now())) then
    raise exception 'assessment access route is not a current governed Context feature'; end if;
  if new.status in ('draft','verified') and exists(select 1 from unnest(new.input_feature_ids) x(id) left join public.geospatial_features f
    on f.id=x.id and f.organization_id=new.organization_id and f.status='verified'
      and f.source_connector_id is not null and f.context_owner_id is not null and f.validity_kind is not null
      and (f.valid_until is null or f.valid_until>now()) where f.id is null) then
    raise exception 'assessment input contains a legacy, expired or ungoverned geospatial feature'; end if;
  return new;
end $$;
drop trigger if exists trg_context_assessment_inputs on public.geospatial_operational_assessments;
create trigger trg_context_assessment_inputs before insert or update on public.geospatial_operational_assessments
for each row execute function public.enforce_context_assessment_inputs();
revoke all on function public.enforce_context_assessment_inputs() from public,anon,authenticated;

update public.geospatial_operational_assessments a set status='superseded'
where a.status in ('draft','verified') and (
  (a.access_route_feature_id is not null and not exists(select 1 from public.geospatial_features f
    where f.id=a.access_route_feature_id and f.organization_id=a.organization_id and f.status='verified'
      and f.source_connector_id is not null and f.context_owner_id is not null and f.validity_kind is not null
      and (f.valid_until is null or f.valid_until>now())))
  or exists(select 1 from unnest(a.input_feature_ids) x(id) left join public.geospatial_features f
    on f.id=x.id and f.organization_id=a.organization_id and f.status='verified'
      and f.source_connector_id is not null and f.context_owner_id is not null and f.validity_kind is not null
      and (f.valid_until is null or f.valid_until>now()) where f.id is null));

-- New records resolve source identity from connectors. Legacy free-text source
-- rows remain readable through the old workspace but are intentionally omitted
-- from the normalized Context projection until an administrator classifies them.
create or replace function public.record_geospatial_feature(p_feature jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid; v_source public.connectors%rowtype;
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_feature->'evidence_item_ids','[]'))::uuid),'{}');
  v_missing text[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_feature->'missing_evidence','[]'))),'{}');
begin
  if v_org is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','planner','executive','admin') then return jsonb_build_object('error','a named same-tenant human role must record geospatial evidence; AI identity is not accepted'); end if;
  select * into v_source from public.connectors where id=nullif(p_feature->>'source_connector_id','')::uuid and organization_id=v_org and context_source_class is not null;
  if not found then return jsonb_build_object('error','select a same-tenant classified Context source; free-text source authority is not accepted'); end if;
  if (v_source.context_source_class='live_external' and v_source.context_rights_state not in ('demo_approved','production_approved'))
    or (v_source.context_source_class='customer_operational' and v_source.context_rights_state<>'customer_authorized')
    or (v_source.context_source_class='simulated_industrial' and v_source.context_rights_state<>'not_required') then
    return jsonb_build_object('error','source rights review does not permit this Context use'); end if;
  if p_feature->>'feature_type' not in ('site','asset','linear_route','access_route','hazard_zone','weather_cell','receptor','logistics_hub','spares_region','failure_cluster') then return jsonb_build_object('error','unsupported geospatial feature type'); end if;
  if p_feature->>'geometry_type' not in ('Point','LineString','Polygon','MultiPoint','MultiLineString','MultiPolygon') or jsonb_typeof(p_feature->'geometry')<>'object' or p_feature->'geometry'->>'type'<>p_feature->>'geometry_type' or jsonb_typeof(p_feature->'geometry'->'coordinates')<>'array' then return jsonb_build_object('error','source-supplied GeoJSON geometry and matching geometry type are required'); end if;
  if coalesce(length(trim(p_feature->>'feature_key')),0)<2 or coalesce(length(trim(p_feature->>'name')),0)<2 or coalesce(length(trim(p_feature->>'source_reference')),0)<2 or nullif(p_feature->>'observed_at','') is null then return jsonb_build_object('error','feature identity, source reference and observation time are required'); end if;
  if p_feature->>'data_quality' not in ('unknown','poor','fair','good','verified') then return jsonb_build_object('error','state the source data quality'); end if;
  if p_feature->>'validity_kind' not in ('permanent','temporary') or (p_feature->>'validity_kind'='temporary' and nullif(p_feature->>'valid_until','') is null) or (p_feature->>'validity_kind'='permanent' and nullif(p_feature->>'valid_until','') is not null) then return jsonb_build_object('error','state permanent or bounded temporary validity'); end if;
  if cardinality(v_evidence)=0 and cardinality(v_missing)=0 then return jsonb_build_object('error','cite canonical evidence or name missing evidence; SyncAI will not invent coordinates or source authority'); end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct unnest(v_evidence))) or exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e on e.id=x.id and e.organization_id=v_org where e.id is null) then return jsonb_build_object('error','evidence ids must be unique and belong to this organization'); end if;
  update public.geospatial_features set status='superseded' where organization_id=v_org and feature_key=trim(p_feature->>'feature_key') and status in ('draft','verified');
  insert into public.geospatial_features(organization_id,feature_key,feature_type,name,geometry_type,geometry,
    source_system,source_reference,source_connector_id,observed_at,valid_until,validity_kind,data_quality,
    evidence_item_ids,missing_evidence,recorded_by,context_owner_id)
  values(v_org,trim(p_feature->>'feature_key'),p_feature->>'feature_type',trim(p_feature->>'name'),p_feature->>'geometry_type',p_feature->'geometry',
    v_source.connector_key,trim(p_feature->>'source_reference'),v_source.id,(p_feature->>'observed_at')::timestamptz,
    nullif(p_feature->>'valid_until','')::timestamptz,p_feature->>'validity_kind',p_feature->>'data_quality',v_evidence,v_missing,auth.uid(),auth.uid()) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'geospatial_feature',v_role,
    jsonb_build_object('feature_id',v_id,'source_connector_id',v_source.id,'source_class',v_source.context_source_class,
      'status','draft','boundary','source geometry recorded only; no dispatch, approval or work release'));
  return jsonb_build_object('feature_id',v_id,'status','draft','source_class',v_source.context_source_class,'operational_authority',false);
exception when invalid_text_representation then return jsonb_build_object('error','feature identifiers and timestamps must use their declared formats');
  when others then return jsonb_build_object('error','unable to record geospatial feature; review geometry, validity and provenance'); end $$;

create or replace function public.sync_context_link_visible(p_link public.geospatial_subject_links)
returns boolean language sql stable security definer set search_path=public as $$
  select public.app_current_role()<>'technician' and (
    num_nonnulls(p_link.asset_id,p_link.site_id,p_link.linear_route_id,p_link.linear_segment_id,
      p_link.work_order_id,p_link.evidence_item_id,p_link.recommendation_id,p_link.decision_id,
      p_link.approval_id,p_link.restoration_event_id,p_link.development_case_id,
      p_link.capital_project_id,p_link.audit_event_id)>0
    or (p_link.risk_id is not null and public.can_read_risk(p_link.risk_id))
  )
$$;
revoke all on function public.sync_context_link_visible(public.geospatial_subject_links) from public,anon,authenticated;

create or replace function public.get_sync_context_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
begin
  if v_org is null or coalesce(v_role,'') not in ('technician','planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin') then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'organizationId',v_org,'generatedAt',now(),'operationalAuthority',false,
    'sources',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'organizationId',c.organization_id,'key',c.connector_key,'name',c.name,'class',c.context_source_class,
      'authority',c.context_source_authority,'purpose',c.context_purpose,'rightsState',c.context_rights_state,
      'state',case when c.context_health_state='live' and (c.expected_interval_minutes is null or
        c.context_observed_at<now()-make_interval(mins=>c.expected_interval_minutes*2)) then 'stale' else c.context_health_state end,
      'checkedAt',c.context_checked_at,'observedAt',c.context_observed_at,'detail',c.context_health_detail,
      'displayAsLive',c.context_health_state='live' and c.context_source_class<>'simulated_industrial'
        and c.expected_interval_minutes is not null
        and c.context_observed_at>=now()-make_interval(mins=>c.expected_interval_minutes*2)
        and ((c.context_source_class='live_external' and c.context_rights_state='production_approved')
          or (c.context_source_class='customer_operational' and c.context_rights_state='customer_authorized'))
      ) order by c.name) from public.connectors c where c.organization_id=v_org and c.context_source_class is not null
        and v_role<>'technician'),'[]'::jsonb),
    'layers',coalesce((with effective_sources as (
        select c.id,case when c.context_health_state='live' and (c.expected_interval_minutes is null
          or c.context_observed_at<now()-make_interval(mins=>c.expected_interval_minutes*2))
          then 'stale' else c.context_health_state end state
        from public.connectors c where c.organization_id=v_org and c.context_source_class is not null
      ),layer_inputs as (
        select 'assets_sites' id,'Assets and sites' label,'object' render_mode,v_role<>'technician' authorized,
          coalesce(array(select distinct f.source_connector_id from public.geospatial_features f
            where f.organization_id=v_org and v_role<>'technician' and f.status='verified' and f.source_connector_id is not null
              and f.context_owner_id is not null and f.validity_kind is not null and (f.valid_until is null or f.valid_until>now())
              and exists(select 1 from public.connectors c where c.id=f.source_connector_id
                and c.organization_id=f.organization_id and public.sync_context_source_rights_permit(c))
              and exists(select 1 from public.geospatial_subject_links sl where sl.organization_id=f.organization_id
                and sl.feature_id=f.id and public.sync_context_link_visible(sl))
              and f.feature_type in ('site','asset','linear_route','access_route','logistics_hub','spares_region','failure_cluster')),'{}'::uuid[]) source_ids,
          (select count(*) from public.geospatial_features f where f.organization_id=v_org and v_role<>'technician' and f.status='verified' and f.source_connector_id is not null
            and f.context_owner_id is not null and f.validity_kind is not null and (f.valid_until is null or f.valid_until>now())
            and exists(select 1 from public.connectors c where c.id=f.source_connector_id
              and c.organization_id=f.organization_id and public.sync_context_source_rights_permit(c))
            and exists(select 1 from public.geospatial_subject_links sl where sl.organization_id=f.organization_id
              and sl.feature_id=f.id and public.sync_context_link_visible(sl))
            and f.feature_type in ('site','asset','linear_route','access_route','logistics_hub','spares_region','failure_cluster')) record_count
        union all
        select 'hazards_geofences','Hazards and geofences','polygon',v_role<>'technician',
          coalesce(array(select distinct f.source_connector_id from public.geospatial_features f
            where f.organization_id=v_org and v_role<>'technician' and f.status='verified' and f.source_connector_id is not null
              and f.context_owner_id is not null and f.validity_kind is not null and (f.valid_until is null or f.valid_until>now())
              and exists(select 1 from public.connectors c where c.id=f.source_connector_id
                and c.organization_id=f.organization_id and public.sync_context_source_rights_permit(c))
              and exists(select 1 from public.geospatial_subject_links sl where sl.organization_id=f.organization_id
                and sl.feature_id=f.id and public.sync_context_link_visible(sl))
              and f.feature_type in ('hazard_zone','weather_cell','receptor')),'{}'::uuid[]),
          (select count(*) from public.geospatial_features f where f.organization_id=v_org and v_role<>'technician' and f.status='verified' and f.source_connector_id is not null
            and f.context_owner_id is not null and f.validity_kind is not null and (f.valid_until is null or f.valid_until>now())
            and exists(select 1 from public.connectors c where c.id=f.source_connector_id
              and c.organization_id=f.organization_id and public.sync_context_source_rights_permit(c))
            and exists(select 1 from public.geospatial_subject_links sl where sl.organization_id=f.organization_id
              and sl.feature_id=f.id and public.sync_context_link_visible(sl))
            and f.feature_type in ('hazard_zone','weather_cell','receptor'))
        union all
        select 'work_events','Work and operating events','event',v_role<>'technician',
          coalesce(array(select distinct c.id from public.work_order_status_history h join public.work_orders w on w.id=h.work_order_id
            join public.connectors c on c.organization_id=w.organization_id and c.connector_key=w.source_system and c.context_source_class is not null
            where w.organization_id=v_org and v_role<>'technician' and public.sync_context_source_rights_permit(c)),'{}'::uuid[]),
          (select count(*) from public.work_order_status_history h join public.work_orders w on w.id=h.work_order_id
            join public.connectors c on c.organization_id=w.organization_id and c.connector_key=w.source_system and c.context_source_class is not null
            where w.organization_id=v_org and v_role<>'technician' and public.sync_context_source_rights_permit(c))
      ) select jsonb_agg(jsonb_build_object(
          'id',li.id,'label',li.label,'renderMode',li.render_mode,'authorized',li.authorized,
          'sourceDependencies',to_jsonb(li.source_ids),'healthStates',to_jsonb(coalesce(h.states,'{}'::text[])),
          'recordCount',li.record_count,'empty',li.record_count=0,
          'degraded',li.authorized and li.record_count>0 and coalesce(h.degraded,false),
          'availability',case when not li.authorized then 'unauthorized' when li.record_count=0 then 'empty'
            when coalesce(h.all_unavailable,false) then 'unavailable' when coalesce(h.degraded,false) then 'degraded' else 'available' end,
          'issues',case when not li.authorized then jsonb_build_array('Layer is not authorized for this role.')
            when li.record_count=0 then jsonb_build_array('No canonical records are available for this layer.')
            when coalesce(h.all_unavailable,false) then jsonb_build_array('All dependent sources are unavailable.')
            when coalesce(h.degraded,false) then jsonb_build_array('One or more dependent sources report degraded health.')
            else '[]'::jsonb end
        ) order by li.id)
        from layer_inputs li left join lateral (
          select array_agg(distinct es.state order by es.state) states,
            bool_or(es.state in ('not_connected','stale','unavailable','malformed','throttled','delayed','conflicting','partial_coverage','clock_skew')) degraded,
            bool_and(es.state in ('not_connected','unavailable','malformed')) all_unavailable
          from effective_sources es where es.id=any(li.source_ids)
        ) h on true),'[]'::jsonb),
    'objects',coalesce((select jsonb_agg(object_record order by object_record->>'observedAt' desc) from (
      select jsonb_build_object(
      'id',f.id,'organizationId',f.organization_id,'layerId',case when f.feature_type in ('hazard_zone','weather_cell','receptor') then 'hazards_geofences' else 'assets_sites' end,
      'kind',f.feature_type,'name',f.name,
      'geometry',f.geometry,'geometryType',f.geometry_type,
      'source',jsonb_build_object('id',c.id,'organizationId',c.organization_id,'key',c.connector_key,'class',c.context_source_class,
        'authority',c.context_source_authority,'healthState',case when c.context_health_state='live' and (c.expected_interval_minutes is null or c.context_observed_at<now()-make_interval(mins=>c.expected_interval_minutes*2)) then 'stale' else c.context_health_state end),
      'observedAt',f.observed_at,'validUntil',f.valid_until,'validityKind',f.validity_kind,
      'freshness',case when f.valid_until is not null and f.valid_until<=now() then 'expired'
        when c.context_health_state='live' and (c.expected_interval_minutes is null or c.context_observed_at<now()-make_interval(mins=>c.expected_interval_minutes*2)) then 'stale'
        when c.context_health_state in ('stale','delayed','conflicting','clock_skew') then c.context_health_state else 'current' end,
      'dataQuality',f.data_quality,'evidenceIds',f.evidence_item_ids,'missingEvidence',f.missing_evidence,'engineeringClaims','[]'::jsonb,
      'evidenceState',f.status,'authority',jsonb_build_object('operational',false,
        'label',case when f.status='verified' then 'Verified evidence — no operational approval' else 'Draft evidence' end),
      'subjects',coalesce((select jsonb_agg(ref) from (
        select jsonb_build_object('type','asset','id',l.asset_id) ref from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.asset_id is not null union all
        select jsonb_build_object('type','site','id',l.site_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.site_id is not null union all
        select jsonb_build_object('type','linear_route','id',l.linear_route_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.linear_route_id is not null union all
        select jsonb_build_object('type','linear_segment','id',l.linear_segment_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.linear_segment_id is not null union all
        select jsonb_build_object('type','work_order','id',l.work_order_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.work_order_id is not null and v_role<>'technician' union all
        select jsonb_build_object('type','evidence','id',l.evidence_item_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.evidence_item_id is not null union all
        select jsonb_build_object('type','recommendation','id',l.recommendation_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.recommendation_id is not null and v_role<>'technician' union all
        select jsonb_build_object('type','decision','id',l.decision_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.decision_id is not null and v_role<>'technician' union all
        select jsonb_build_object('type','approval','id',l.approval_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.approval_id is not null and v_role<>'technician' union all
        select jsonb_build_object('type','risk','id',l.risk_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.risk_id is not null and v_role<>'technician' and public.can_read_risk(l.risk_id) union all
        select jsonb_build_object('type','recovery','id',l.restoration_event_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.restoration_event_id is not null union all
        select jsonb_build_object('type','development_case','id',l.development_case_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.development_case_id is not null union all
        select jsonb_build_object('type','capital_project','id',l.capital_project_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.capital_project_id is not null union all
        select jsonb_build_object('type','audit_event','id',l.audit_event_id) from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=f.organization_id and l.audit_event_id is not null
      ) q),'[]'::jsonb)
    ) object_record
    from public.geospatial_features f join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
    where f.organization_id=v_org and v_role<>'technician' and f.status='verified'
      and public.sync_context_source_rights_permit(c)
      and f.context_owner_id is not null and f.validity_kind is not null and (f.valid_until is null or f.valid_until>now())
      and exists(select 1 from public.geospatial_subject_links sl where sl.organization_id=f.organization_id
        and sl.feature_id=f.id and public.sync_context_link_visible(sl))
    ) context_objects),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(event order by event->>'occurredAt' desc) from (
      select jsonb_build_object('id','feature:'||f.id::text,'organizationId',f.organization_id,
        'kind',case when f.feature_type='hazard_zone' then 'hazard' else 'observation' end,
        'layerId',case when f.feature_type in ('hazard_zone','weather_cell','receptor') then 'hazards_geofences' else 'assets_sites' end,
        'title',f.name,'occurredAt',f.observed_at,'canonicalRecord',jsonb_build_object('type','geospatial_feature','id',f.id),
        'source',jsonb_build_object('id',c.id,'organizationId',c.organization_id,'key',c.connector_key,'class',c.context_source_class),
        'governanceState',case when f.status='draft' then 'draft' else 'recommended' end,
        'approvalId',null,'operationalAuthority',false,'evidenceIds',to_jsonb(f.evidence_item_ids),'engineeringClaims','[]'::jsonb) event
      from public.geospatial_features f join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
      where f.organization_id=v_org and v_role<>'technician' and f.status='verified' and f.validity_kind is not null
        and public.sync_context_source_rights_permit(c)
        and f.context_owner_id is not null and (f.valid_until is null or f.valid_until>now())
        and exists(select 1 from public.geospatial_subject_links sl where sl.organization_id=f.organization_id
          and sl.feature_id=f.id and public.sync_context_link_visible(sl))
      union all
      select jsonb_build_object('id','work:'||h.id::text,'organizationId',w.organization_id,'kind','work',
        'layerId','work_events','title',coalesce(w.title,'Work status changed'),'occurredAt',h.changed_at,
        'canonicalRecord',jsonb_build_object('type','work_order','id',w.id),
        'source',jsonb_build_object('id',c.id,'organizationId',c.organization_id,'key',c.connector_key,'class',c.context_source_class),
        'governanceState',case when h.status_to in ('in_progress','completed') then 'executed'
          when approval_at_event.status='approved' then 'approved'
          when h.status_to in ('pending','draft') then 'draft' else 'recommended' end,
        'approvalId',case when approval_at_event.status='approved' then approval_at_event.approval_id else null end,
        'operationalAuthority',false,'evidenceIds','[]'::jsonb,'engineeringClaims','[]'::jsonb)
      from public.work_order_status_history h join public.work_orders w on w.id=h.work_order_id
      join public.connectors c on c.organization_id=w.organization_id and c.connector_key=w.source_system and c.context_source_class is not null
      left join lateral (select e.new_state->>'status' status,e.event_data->>'approval_id' approval_id
        from public.audit_events e where e.organization_id=w.organization_id and e.entity_type='approval_decision'
          and e.event_data->>'work_order_id'=w.id::text and e.event_time<=h.changed_at
        order by e.event_time desc,e.created_at desc limit 1) approval_at_event on true
      where w.organization_id=v_org and v_role<>'technician' and public.sync_context_source_rights_permit(c)
    ) e),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_sync_context_snapshot() from public,anon;
grant execute on function public.get_sync_context_snapshot() to authenticated;

-- Re-project the legacy workspace explicitly. Never use to_jsonb(link) here:
-- that would silently expose every newly added canonical subject column.
create or replace function public.get_geospatial_operational_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
begin
  if v_org is null or coalesce(v_role,'') not in
    ('technician','planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin') then
    return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'feature_types',jsonb_build_array('site','asset','linear_route','access_route','hazard_zone','weather_cell','receptor','logistics_hub','spares_region','failure_cluster'),
    'assessment_types',jsonb_build_array('weather_hazard_exposure','access_route','crew_travel','remote_logistics','regional_spares','failure_clustering','hazard_overlay','linear_reference'),
    'features',case when v_role='technician' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'id',f.id,'feature_key',f.feature_key,'feature_type',f.feature_type,'name',f.name,
      'geometry_type',f.geometry_type,'geometry',f.geometry,'source_system',f.source_system,
      'source_connector_id',f.source_connector_id,'source_reference',f.source_reference,
      'observed_at',f.observed_at,'valid_until',f.valid_until,'validity_kind',f.validity_kind,
      'data_quality',f.data_quality,'evidence_item_ids',f.evidence_item_ids,
      'missing_evidence',f.missing_evidence,'status',f.status) order by f.recorded_at desc)
      from public.geospatial_features f join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
      where f.organization_id=v_org and f.status in ('draft','verified')
        and public.sync_context_source_rights_permit(c)),'[]'::jsonb) end,
    'links',case when v_role='technician' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'organization_id',l.organization_id,'feature_id',l.feature_id,'relationship_type',l.relationship_type,
      'asset_id',l.asset_id,'site_id',l.site_id,'linear_route_id',l.linear_route_id,'linear_segment_id',l.linear_segment_id,
      'from_measure',l.from_measure,'to_measure',l.to_measure,'basis',l.basis,'evidence_item_ids',l.evidence_item_ids,
      'recorded_at',l.recorded_at) order by l.recorded_at desc)
      from public.geospatial_subject_links l
      join public.geospatial_features f on f.id=l.feature_id and f.organization_id=l.organization_id
      join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
      where l.organization_id=v_org and public.sync_context_source_rights_permit(c)),'[]'::jsonb) end,
    'assessments',case when v_role='technician' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'assessment_type',a.assessment_type,'title',a.title,'asset_id',a.asset_id,
      'site_id',a.site_id,'recommendation_id',a.recommendation_id,'exposure_rating',a.exposure_rating,
      'basis',a.basis,'conclusion',a.conclusion,'evidence_item_ids',a.evidence_item_ids,
      'missing_evidence',a.missing_evidence,'status',a.status) order by a.recorded_at desc)
      from public.geospatial_operational_assessments a where a.organization_id=v_org and a.status in ('draft','verified')
        and (a.recommendation_id is null or exists(select 1 from public.recommendations r where r.id=a.recommendation_id
          and r.organization_id=a.organization_id and (r.risk_id is null or public.can_read_risk(r.risk_id))))
        and (a.access_route_feature_id is null or exists(select 1 from public.geospatial_features f
          join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
          where f.id=a.access_route_feature_id and f.organization_id=a.organization_id
            and public.sync_context_source_rights_permit(c)))
        and not exists(select 1 from unnest(a.input_feature_ids) x(id)
          left join public.geospatial_features f on f.id=x.id and f.organization_id=a.organization_id
          left join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
          where f.id is null or c.id is null or not public.sync_context_source_rights_permit(c))),'[]'::jsonb) end,
    'regional_stock',coalesce((select jsonb_agg(jsonb_build_object('material_id',s.material_id,'material_code',m.material_code,
      'description',m.description,'site_id',s.site_id,'site_name',si.name,'qty_on_hand',s.qty_on_hand,
      'qty_reserved',s.qty_reserved,'qty_on_order',s.qty_on_order,'last_counted_at',s.last_counted_at,
      'source_system',s.source_system) order by m.material_code,si.name) from public.material_stock s
      join public.materials m on m.id=s.material_id and m.organization_id=s.organization_id
      left join public.sites si on si.id=s.site_id and si.organization_id=s.organization_id where s.organization_id=v_org),'[]'::jsonb),
    'linear_routes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'asset_id',r.asset_id,'route_code',r.route_code,
      'measure_unit',r.measure_unit,'start_measure',r.start_measure,'end_measure',r.end_measure,
      'defect_count',(select count(*) from public.linear_defects d where d.organization_id=r.organization_id and d.route_id=r.id))
      order by r.route_code) from public.linear_asset_routes r where r.organization_id=v_org),'[]'::jsonb),
    'weather_signals',coalesce((select jsonb_agg(to_jsonb(s) order by s.observed_at desc)
      from public.operational_constraint_signals s where s.organization_id=v_org and s.signal_kind='weather'),'[]'::jsonb),
    'basis','Verified, source-supplied geospatial evidence is decision context only. SyncAI does not infer coordinates, exposure, travel, stock availability or cluster significance and never dispatches crews, approves a route or recommendation, or releases work.');
end $$;
revoke all on function public.get_geospatial_operational_workspace() from public,anon,service_role;
grant execute on function public.get_geospatial_operational_workspace() to authenticated;

revoke execute on function public.record_geospatial_feature(jsonb) from service_role;
revoke execute on function public.verify_geospatial_feature(uuid,text) from service_role;
revoke execute on function public.link_geospatial_subject(jsonb) from service_role;
revoke execute on function public.record_geospatial_operational_assessment(jsonb) from service_role;
revoke execute on function public.verify_geospatial_operational_assessment(uuid,text) from service_role;

notify pgrst,'reload schema';

comment on function public.get_sync_context_snapshot() is
  'SC-01 read-only projection over canonical connectors/geospatial/work records. It grants no approval, dispatch, release, execution or safety authority.';
