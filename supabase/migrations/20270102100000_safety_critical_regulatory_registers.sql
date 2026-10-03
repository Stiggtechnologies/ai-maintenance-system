-- C2.11 — safety-critical equipment and exact-version regulatory obligations.
--
-- Canonical reuse only:
--   * safety_critical_elements remains the ONE barrier/equipment register;
--   * capability_pack_layers remains the ONE jurisdiction-requirement store;
--   * evidence_items remains the ONE verification/provenance store;
--   * audit_events remains the ONE governance audit ledger.
--
-- The only new relation is the exact-version edge between an existing element
-- and an existing adopted jurisdiction requirement. A link records an
-- obligation; it does not assert compliance, approve work, accept risk, alter
-- an operating limit or authorize return to service.

alter table public.safety_critical_elements
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists effective_from date not null default current_date,
  add column if not exists review_due date,
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.safety_critical_elements
  drop constraint if exists safety_critical_elements_version_positive,
  drop constraint if exists safety_critical_elements_review_window;
alter table public.safety_critical_elements
  add constraint safety_critical_elements_version_positive check (version>0),
  add constraint safety_critical_elements_review_window check (
    review_due is null or review_due>=effective_from
  );

create index if not exists safety_critical_elements_evidence_idx
  on public.safety_critical_elements(organization_id,evidence_item_id)
  where evidence_item_id is not null;

create table if not exists public.safety_critical_element_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  safety_critical_element_id bigint not null
    references public.safety_critical_elements(id) on delete restrict,
  safety_critical_element_version integer not null check (safety_critical_element_version>0),
  capability_pack_layer_id uuid not null
    references public.capability_pack_layers(id) on delete restrict,
  capability_pack_layer_version integer not null check (capability_pack_layer_version>0),
  requirement_key text not null check (requirement_key~'^[a-z][a-z0-9_]{2,79}$'),
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  basis text not null check (length(btrim(basis)) between 20 and 4000),
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),
  register_ref text not null default 'C2.11',
  unique(
    organization_id,safety_critical_element_id,safety_critical_element_version,
    capability_pack_layer_id,capability_pack_layer_version,requirement_key
  )
);

create index if not exists safety_critical_obligations_element_idx
  on public.safety_critical_element_obligations(
    organization_id,safety_critical_element_id,linked_at desc
  );

alter table public.safety_critical_element_obligations enable row level security;
drop policy if exists safety_critical_element_obligations_read
  on public.safety_critical_element_obligations;
create policy safety_critical_element_obligations_read
  on public.safety_critical_element_obligations
  for select to authenticated
  using (organization_id=public.app_current_org());

create or replace function public.guard_safety_critical_element_governed_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if tg_op='UPDATE' and pg_trigger_depth()>1
     and old.asset_id is not null and new.asset_id is null
     and (to_jsonb(new)-'asset_id')=(to_jsonb(old)-'asset_id') then
    -- Preserve the pre-existing assets(id) ON DELETE SET NULL contract.
    return new;
  end if;
  if coalesce(current_setting('app.safety_critical_element_writer',true),'')<>'governed' then
    raise exception 'Safety-critical elements can change only through the governed C2.11 writer';
  end if;
  if tg_op='UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.sce_ref is distinct from old.sce_ref
    or new.asset_id is distinct from old.asset_id
  ) then
    raise exception 'Safety-critical element tenant, reference and asset identity are immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_guard_safety_critical_element_governed_write
  on public.safety_critical_elements;
create trigger trg_guard_safety_critical_element_governed_write
  before insert or update or delete on public.safety_critical_elements
  for each row execute function public.guard_safety_critical_element_governed_write();

revoke all on function public.guard_safety_critical_element_governed_write()
  from public,anon,authenticated,service_role;

create or replace function public.guard_safety_critical_obligation_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if coalesce(current_setting('app.safety_critical_obligation_writer',true),'')<>'governed' then
    raise exception 'Safety-critical regulatory obligation links are immutable and use the governed C2.11 writer';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_guard_safety_critical_obligation_write
  on public.safety_critical_element_obligations;
create trigger trg_guard_safety_critical_obligation_write
  before insert or update or delete on public.safety_critical_element_obligations
  for each row execute function public.guard_safety_critical_obligation_write();

revoke all on function public.guard_safety_critical_obligation_write()
  from public,anon,authenticated,service_role;

create or replace function public.record_safety_critical_element(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid;
  v_role text:=public.app_current_role();
  v_id bigint;
  v_asset uuid;
  v_evidence uuid;
  v_expected integer;
  v_interval integer;
  v_last_test date;
  v_effective date;
  v_review date;
  v_existing public.safety_critical_elements%rowtype;
  v_version integer;
  v_before jsonb;
  v_after jsonb;
  v_kind text:=nullif(btrim(p_record->>'barrier_kind'),'');
  v_barrier_role text:=nullif(btrim(p_record->>'barrier_role'),'');
begin
  v_actor:=public.assert_safety_foundation_actor('record a safety-critical element');
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','Safety-critical equipment registration requires a verified factor and an AAL2 session');
  end if;
  begin
    v_id:=nullif(p_record->>'id','')::bigint;
    v_asset:=nullif(p_record->>'asset_id','')::uuid;
    v_evidence:=nullif(p_record->>'evidence_item_id','')::uuid;
    v_expected:=coalesce(nullif(p_record->>'expected_version','')::integer,0);
    v_interval:=nullif(p_record->>'test_interval_months','')::integer;
    v_last_test:=nullif(p_record->>'last_tested_on','')::date;
    v_effective:=coalesce(nullif(p_record->>'effective_from','')::date,current_date);
    v_review:=nullif(p_record->>'review_due','')::date;
  exception when others then
    return jsonb_build_object('error','Element, asset, evidence, version, interval and date fields must be valid');
  end;
  if v_expected<0 then return jsonb_build_object('error','Expected version cannot be negative'); end if;
  if length(btrim(coalesce(p_record->>'sce_ref','')))<2
     or length(btrim(coalesce(p_record->>'label','')))<3
     or length(btrim(coalesce(p_record->>'performance_standard','')))<20 then
    return jsonb_build_object('error','Reference, label and a testable performance standard of at least 20 characters are required');
  end if;
  if v_kind not in ('instrumented','mechanical','passive','procedural','human','structural','emergency_response')
     or v_barrier_role not in ('preventive','mitigative') then
    return jsonb_build_object('error','Choose a governed barrier kind and preventive or mitigative role');
  end if;
  if v_interval is not null and v_interval<=0 then
    return jsonb_build_object('error','Test interval must be positive when known');
  end if;
  if v_last_test>current_date or v_effective>current_date
     or (v_review is not null and v_review<v_effective) then
    return jsonb_build_object('error','Test and effective dates cannot be future-dated, and review due cannot precede effectivity');
  end if;
  if v_asset is not null and not exists(
    select 1 from public.assets a where a.id=v_asset and a.organization_id=v_org
  ) then return jsonb_build_object('error','Asset is outside the active tenant'); end if;
  if v_evidence is null or not exists(
    select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org
      and e.verification_status='verified' and e.verified_by is not null
      and e.verified_at is not null and e.verified_by<>v_actor
      and exists(select 1 from public.user_profiles verifier
        where verifier.id=e.verified_by and verifier.organization_id=v_org)
      and (e.asset_id is null or e.asset_id=v_asset)
  ) then
    return jsonb_build_object('error','Safety-critical registration requires same-tenant canonical evidence independently verified by another named human and applicable to the element asset');
  end if;

  if v_id is null then
    if v_expected<>0 then return jsonb_build_object('error','A new element must start at expected version zero'); end if;
    if exists(select 1 from public.safety_critical_elements s
      where s.organization_id=v_org and s.sce_ref=btrim(p_record->>'sce_ref')) then
      return jsonb_build_object('error','That safety-critical reference already exists; load it and revise by version');
    end if;
    v_version:=1;
    perform set_config('app.safety_critical_element_writer','governed',true);
    insert into public.safety_critical_elements(
      organization_id,asset_id,sce_ref,label,barrier_kind,barrier_role,
      performance_standard,test_interval_months,last_tested_on,evidence_item_id,
      effective_from,review_due,version,updated_by,updated_at
    ) values(
      v_org,v_asset,btrim(p_record->>'sce_ref'),btrim(p_record->>'label'),
      v_kind,v_barrier_role,btrim(p_record->>'performance_standard'),
      v_interval,v_last_test,v_evidence,v_effective,v_review,v_version,v_actor,now()
    ) returning id into v_id;
    v_before:=null;
  else
    select * into v_existing from public.safety_critical_elements s
    where s.id=v_id and s.organization_id=v_org for update;
    if not found then return jsonb_build_object('error','Safety-critical element not found in the active tenant'); end if;
    if v_existing.version<>v_expected then
      return jsonb_build_object('error','Safety-critical element changed after it was loaded; refresh before revising');
    end if;
    if v_existing.sce_ref<>btrim(p_record->>'sce_ref')
       or v_existing.asset_id is distinct from v_asset then
      return jsonb_build_object('error','Safety-critical reference and asset identity are immutable');
    end if;
    v_before:=to_jsonb(v_existing); v_version:=v_existing.version+1;
    perform set_config('app.safety_critical_element_writer','governed',true);
    update public.safety_critical_elements set
      label=btrim(p_record->>'label'),barrier_kind=v_kind,
      barrier_role=v_barrier_role,
      performance_standard=btrim(p_record->>'performance_standard'),
      test_interval_months=v_interval,last_tested_on=v_last_test,
      evidence_item_id=v_evidence,effective_from=v_effective,review_due=v_review,
      version=v_version,updated_by=v_actor,updated_at=now()
    where id=v_id and organization_id=v_org;
  end if;
  select to_jsonb(s) into v_after from public.safety_critical_elements s
    where s.id=v_id and s.organization_id=v_org;
  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(
    v_org,'safety_critical_element',v_role,
    jsonb_build_object('action',case when v_version=1 then 'created' else 'revised' end,
      'elementId',v_id,'version',v_version,'actorId',v_actor,
      'evidenceItemId',v_evidence,'complianceEstablished',false,
      'workAuthorized',false,'riskAccepted',false,
      'operatingLimitChanged',false,'returnToServiceAuthorized',false),
    v_before,v_after
  );
  return jsonb_build_object(
    'id',v_id,'version',v_version,'status','recorded',
    'complianceEstablished',false,'workAuthorized',false,'riskAccepted',false,
    'operatingLimitChanged',false,'returnToServiceAuthorized',false
  );
end $$;

create or replace function public.link_safety_critical_regulatory_obligation(
  p_link jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid;
  v_role text:=public.app_current_role();
  v_sce bigint;
  v_layer uuid;
  v_evidence uuid;
  v_key text:=nullif(btrim(p_link->>'requirement_key'),'');
  v_basis text:=nullif(btrim(p_link->>'basis'),'');
  s public.safety_critical_elements%rowtype;
  l public.capability_pack_layers%rowtype;
  req jsonb;
  v_id uuid;
begin
  v_actor:=public.assert_safety_foundation_actor('link a regulatory obligation to safety-critical equipment');
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','Regulatory obligation linkage requires a verified factor and an AAL2 session');
  end if;
  begin
    v_sce:=(p_link->>'safety_critical_element_id')::bigint;
    v_layer:=(p_link->>'capability_pack_layer_id')::uuid;
    v_evidence:=(p_link->>'evidence_item_id')::uuid;
  exception when others then
    return jsonb_build_object('error','Element, jurisdiction layer and evidence identifiers must be valid');
  end;
  if length(coalesce(v_basis,'')) not between 20 and 4000 or v_key is null then
    return jsonb_build_object('error','Requirement key and a 20-4000 character applicability basis are required');
  end if;
  select * into s from public.safety_critical_elements
    where id=v_sce and organization_id=v_org;
  if not found then return jsonb_build_object('error','Safety-critical element is outside the active tenant'); end if;
  if s.evidence_item_id is null then
    return jsonb_build_object('error','Legacy safety-critical elements require a governed evidence-backed revision before obligation linkage');
  end if;
  select * into l from public.capability_pack_layers
    where id=v_layer and organization_id=v_org and layer_kind='jurisdiction'
      and status='adopted' and jurisdiction=(
        select o.jurisdiction from public.organizations o where o.id=v_org
      );
  if not found then return jsonb_build_object('error','An adopted same-tenant jurisdiction layer is required'); end if;
  select value into req
  from jsonb_array_elements(l.configuration->'jurisdiction_requirements')
  where value->>'key'=v_key limit 1;
  if req is null then return jsonb_build_object('error','Requirement key is absent from that exact adopted jurisdiction layer'); end if;
  if req->>'requirement_class' not in ('regulatory','statutory')
     or req->>'applicability'<>'applicable'
     or req->>'obligation'<>'mandatory' then
    return jsonb_build_object('error','Only applicable mandatory regulatory or statutory requirements can be linked as obligations');
  end if;
  if not exists(
    select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org
      and e.verification_status='verified' and e.verified_by is not null
      and e.verified_at is not null and e.verified_by<>v_actor
      and exists(select 1 from public.user_profiles verifier
        where verifier.id=e.verified_by and verifier.organization_id=v_org)
      and (e.asset_id is null or e.asset_id=s.asset_id)
  ) then
    return jsonb_build_object('error','Obligation linkage requires same-tenant canonical evidence independently verified by another named human and applicable to the element asset');
  end if;
  perform set_config('app.safety_critical_obligation_writer','governed',true);
  insert into public.safety_critical_element_obligations(
    organization_id,safety_critical_element_id,safety_critical_element_version,
    capability_pack_layer_id,capability_pack_layer_version,requirement_key,
    evidence_item_id,basis,linked_by
  ) values(
    v_org,s.id,s.version,l.id,l.version,v_key,v_evidence,v_basis,v_actor
  ) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'safety_critical_regulatory_obligation',v_role,jsonb_build_object(
    'action','linked','linkId',v_id,'elementId',s.id,'elementVersion',s.version,
    'layerId',l.id,'layerVersion',l.version,'requirementKey',v_key,
    'evidenceItemId',v_evidence,'complianceEstablished',false,
    'workAuthorized',false,'riskAccepted',false,
    'operatingLimitChanged',false,'returnToServiceAuthorized',false));
  return jsonb_build_object(
    'id',v_id,'status','obligation_linked','elementVersion',s.version,
    'layerVersion',l.version,'complianceEstablished',false,
    'workAuthorized',false,'riskAccepted',false,
    'operatingLimitChanged',false,'returnToServiceAuthorized',false
  );
exception when unique_violation then
  return jsonb_build_object('error','That exact element, layer and requirement obligation is already linked');
end $$;

create or replace function public.get_safety_critical_regulatory_workspace()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with context as (
    select o.id org,o.jurisdiction from public.organizations o
    where o.id=public.app_current_org()
  ), current_layers as (
    select l.* from public.capability_pack_layers l,context c
    where l.organization_id=c.org and l.layer_kind='jurisdiction'
      and l.status='adopted' and l.jurisdiction=c.jurisdiction
  ), requirements as (
    select l.id layer_id,l.version layer_version,l.title,l.jurisdiction,
      r.value requirement
    from current_layers l
    cross join lateral jsonb_array_elements(
      l.configuration->'jurisdiction_requirements'
    ) r(value)
  ), elements as (
    select s.* from public.safety_critical_elements s,context c
    where s.organization_id=c.org
  ), bindings as (
    select b.* from public.safety_critical_element_obligations b,context c
    where b.organization_id=c.org
  )
  select jsonb_build_object(
    'elements',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'assetId',s.asset_id,'assetName',a.name,'reference',s.sce_ref,
      'label',s.label,'barrierKind',s.barrier_kind,'barrierRole',s.barrier_role,
      'performanceStandard',s.performance_standard,
      'testIntervalMonths',s.test_interval_months,'lastTestedOn',s.last_tested_on,
      'testStatus',case
        when s.test_interval_months is null then 'interval_unknown'
        when s.last_tested_on is null then 'never_tested'
        when s.last_tested_on<current_date-(s.test_interval_months||' months')::interval then 'overdue'
        else 'current' end,
      'evidenceItemId',s.evidence_item_id,'evidenceDescription',e.description,
      'evidenceVerifiedBy',e.verified_by,'evidenceVerifiedAt',e.verified_at,
      'effectiveFrom',s.effective_from,'reviewDue',s.review_due,
      'version',s.version,'updatedBy',s.updated_by,'updatedAt',s.updated_at
    ) order by s.sce_ref) from elements s
      left join public.assets a on a.id=s.asset_id and a.organization_id=(select org from context)
      left join public.evidence_items e on e.id=s.evidence_item_id
        and e.organization_id=(select org from context)),'[]'::jsonb),
    'regulatoryRequirements',coalesce((select jsonb_agg(jsonb_build_object(
      'layerId',r.layer_id,'layerVersion',r.layer_version,'layerTitle',r.title,
      'jurisdiction',r.jurisdiction,'key',r.requirement->>'key',
      'title',r.requirement->>'title','domain',r.requirement->>'domain',
      'requirementClass',r.requirement->>'requirement_class',
      'applicability',r.requirement->>'applicability',
      'obligation',r.requirement->>'obligation',
      'authorityReference',r.requirement->>'authority_reference',
      'applicabilityBasis',r.requirement->>'applicability_basis',
      'mandatoryBasis',r.requirement->>'mandatory_basis'
    ) order by r.requirement->>'key') from requirements r
      where r.requirement->>'requirement_class' in ('regulatory','statutory')),'[]'::jsonb),
    'bindings',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'elementId',b.safety_critical_element_id,
      'elementVersion',b.safety_critical_element_version,
      'currentElementVersion',s.version,'layerId',b.capability_pack_layer_id,
      'layerVersion',b.capability_pack_layer_version,
      'requirementKey',b.requirement_key,'evidenceItemId',b.evidence_item_id,
      'evidenceDescription',e.description,'basis',b.basis,
      'linkedBy',b.linked_by,'linkedAt',b.linked_at,
      'current',s.version=b.safety_critical_element_version
        and l.status='adopted' and l.version=b.capability_pack_layer_version
        and exists(select 1 from current_layers cl where cl.id=l.id)
        and exists(select 1 from requirements r where r.layer_id=l.id
          and r.requirement->>'key'=b.requirement_key)
    ) order by b.linked_at desc) from bindings b
      join elements s on s.id=b.safety_critical_element_id
      join public.capability_pack_layers l on l.id=b.capability_pack_layer_id
        and l.organization_id=(select org from context)
      join public.evidence_items e on e.id=b.evidence_item_id
        and e.organization_id=(select org from context)),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',e.description,'sourceSystem',e.source_system,
      'assetId',e.asset_id,'verifiedBy',e.verified_by,'verifiedAt',e.verified_at
    ) order by e.verified_at desc) from public.evidence_items e,context c
      where e.organization_id=c.org and e.verification_status='verified'
        and e.verified_by is not null and e.verified_at is not null),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'tag',a.tag) order by a.name)
      from public.assets a,context c where a.organization_id=c.org),'[]'::jsonb),
    'coverage',jsonb_build_object(
      'elements',(select count(*) from elements),
      'elementsWithVerifiedEvidence',(select count(*) from elements where evidence_item_id is not null),
      'overdueOrUntested',(select count(*) from elements s where s.test_interval_months is not null
        and (s.last_tested_on is null or s.last_tested_on<current_date-(s.test_interval_months||' months')::interval)),
      'mandatoryRegulatoryObligations',(select count(*) from requirements r
        where r.requirement->>'requirement_class' in ('regulatory','statutory')
          and r.requirement->>'applicability'='applicable'
          and r.requirement->>'obligation'='mandatory'),
      'currentBindings',(select count(*) from bindings b join elements s
        on s.id=b.safety_critical_element_id join public.capability_pack_layers l
        on l.id=b.capability_pack_layer_id where s.version=b.safety_critical_element_version
          and l.status='adopted' and l.version=b.capability_pack_layer_version
          and exists(select 1 from current_layers cl where cl.id=l.id)
          and exists(select 1 from requirements r where r.layer_id=l.id
            and r.requirement->>'key'=b.requirement_key)),
      'staleBindings',(select count(*) from bindings b join elements s
        on s.id=b.safety_critical_element_id join public.capability_pack_layers l
        on l.id=b.capability_pack_layer_id where s.version<>b.safety_critical_element_version
          or l.status<>'adopted' or l.version<>b.capability_pack_layer_version
          or not exists(select 1 from current_layers cl where cl.id=l.id)
          or not exists(select 1 from requirements r where r.layer_id=l.id
            and r.requirement->>'key'=b.requirement_key))
    ),
    'jurisdiction',(select jurisdiction from context),
    'decisionBoundary','A registered safety-critical element and a linked obligation are controlled evidence, not a compliance finding. They do not authorize work, accept risk, change an operating limit or authorize return to service.'
  )
$$;

revoke all on function public.record_safety_critical_element(jsonb)
  from public,anon,service_role;
grant execute on function public.record_safety_critical_element(jsonb)
  to authenticated;
revoke all on function public.link_safety_critical_regulatory_obligation(jsonb)
  from public,anon,service_role;
grant execute on function public.link_safety_critical_regulatory_obligation(jsonb)
  to authenticated;
revoke all on function public.get_safety_critical_regulatory_workspace()
  from public,anon,service_role;
grant execute on function public.get_safety_critical_regulatory_workspace()
  to authenticated;

revoke insert,update,delete,truncate on public.safety_critical_elements
  from anon,authenticated;
revoke insert,update,delete,truncate on public.safety_critical_element_obligations
  from anon,authenticated;

comment on function public.record_safety_critical_element(jsonb) is
  'C2.11: evidence-backed, AAL2 named-human, versioned writer over the canonical safety_critical_elements register; grants no compliance or operational authority.';
comment on function public.link_safety_critical_regulatory_obligation(jsonb) is
  'C2.11: immutable exact-version edge from a canonical safety-critical element to an applicable mandatory regulatory/statutory requirement in an adopted jurisdiction layer; not a compliance finding.';
comment on function public.get_safety_critical_regulatory_workspace() is
  'C2.11: tenant-scoped equipment, jurisdiction requirement and exact-version binding workspace with stale linkage made explicit.';

notify pgrst,'reload schema';
