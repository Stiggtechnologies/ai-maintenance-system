-- Sync Develop Slice 8 / D8.11 — governed Operational Readiness Index (§48).
-- The index reads the ONE canonical readiness truth (`asset_onboarding_items`)
-- through commissioning-system scope. This table stores policy/versioning only.

create table if not exists public.operational_readiness_index_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','adopted','superseded')),
  factors jsonb not null check (jsonb_typeof(factors)='array'),
  hard_requirement_keys text[] not null default '{}',
  basis text not null check (length(btrim(basis)) >= 20),
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  adopted_by uuid references auth.users(id) on delete restrict,
  adopted_at timestamptz,
  superseded_by uuid references public.operational_readiness_index_profiles(id),
  unique (development_case_id, version)
);
create unique index if not exists operational_readiness_index_one_adopted
  on public.operational_readiness_index_profiles(development_case_id)
  where status='adopted';
create unique index if not exists operational_readiness_index_one_draft
  on public.operational_readiness_index_profiles(development_case_id)
  where status='draft';
alter table public.operational_readiness_index_profiles enable row level security;
drop policy if exists operational_readiness_index_profiles_read on public.operational_readiness_index_profiles;
create policy operational_readiness_index_profiles_read
  on public.operational_readiness_index_profiles for select to authenticated
  using (organization_id=public.app_current_org());

create or replace function public.guard_operational_readiness_index_profile()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.development_cases%rowtype; e public.evidence_items%rowtype;
begin
  if current_setting('app.operational_readiness_index_write',true) is distinct from 'allowed' then
    raise exception 'operational-readiness index policy requires the governed human workflow';
  end if;
  if tg_op='DELETE' then raise exception 'operational-readiness index policy history is append-preserved'; end if;
  select * into c from public.development_cases where id=new.development_case_id;
  select * into e from public.evidence_items where id=new.evidence_item_id;
  if c.id is null or e.id is null or c.organization_id<>new.organization_id
     or e.organization_id<>new.organization_id
     or (e.development_case_id is not null and e.development_case_id<>new.development_case_id) then
    raise exception 'index policy, case, and evidence must remain in one tenant and case';
  end if;
  if not exists(select 1 from public.user_profiles p where p.id=new.created_by and p.organization_id=new.organization_id and p.role<>'ai_admin') then
    raise exception 'index policy author must be a named human in the tenant';
  end if;
  if new.adopted_by is not null and not exists(select 1 from public.user_profiles p where p.id=new.adopted_by and p.organization_id=new.organization_id and p.role in ('admin','executive')) then
    raise exception 'index policy adoption requires a named human admin or executive';
  end if;
  if tg_op='UPDATE' and old.status<>'draft'
     and (new.factors,new.hard_requirement_keys,new.basis,new.evidence_item_id)
       is distinct from (old.factors,old.hard_requirement_keys,old.basis,old.evidence_item_id) then
    raise exception 'adopted or superseded index policy content is immutable; create a new draft version';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_operational_readiness_index_profile on public.operational_readiness_index_profiles;
create trigger trg_guard_operational_readiness_index_profile
  before insert or update or delete on public.operational_readiness_index_profiles
  for each row execute function public.guard_operational_readiness_index_profile();
revoke all on function public.guard_operational_readiness_index_profile() from public,anon,authenticated;

create or replace function public.save_case_operational_readiness_index_profile(
  p_case_id uuid,p_profile_id uuid,p_factors jsonb,p_hard_requirement_keys text[],
  p_basis text,p_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; c public.development_cases%rowtype;
  p public.operational_readiness_index_profiles%rowtype; v_id uuid; v_version int;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if not public.commissioning_author_role(v_role) then return jsonb_build_object('error','named-human planning or engineering authority required'); end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  if jsonb_typeof(p_factors) is distinct from 'array' then return jsonb_build_object('error','the nine-factor policy must be an array'); end if;
  if coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','a substantive weighting and hard-condition basis is required'); end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id and e.organization_id=v_org and (e.development_case_id is null or e.development_case_id=c.id)) then
    return jsonb_build_object('error','same-tenant evidence applicable to this case is required');
  end if;
  if p_profile_id is not null then
    select * into p from public.operational_readiness_index_profiles where id=p_profile_id and organization_id=v_org and development_case_id=c.id;
    if not found then return jsonb_build_object('error','operational-readiness index profile not found'); end if;
    if p.status<>'draft' then return jsonb_build_object('error','an adopted profile is immutable; save a new draft version'); end if;
    perform set_config('app.operational_readiness_index_write','allowed',true);
    update public.operational_readiness_index_profiles set factors=p_factors,
      hard_requirement_keys=coalesce(p_hard_requirement_keys,'{}'),basis=btrim(p_basis),evidence_item_id=p_evidence_item_id
      where id=p.id returning id,version into v_id,v_version;
  else
    if exists(select 1 from public.operational_readiness_index_profiles where development_case_id=c.id and status='draft') then
      return jsonb_build_object('error','this case already has a draft profile; edit that draft');
    end if;
    select coalesce(max(version),0)+1 into v_version from public.operational_readiness_index_profiles where development_case_id=c.id;
    perform set_config('app.operational_readiness_index_write','allowed',true);
    insert into public.operational_readiness_index_profiles(organization_id,development_case_id,version,factors,hard_requirement_keys,basis,evidence_item_id,created_by)
    values(v_org,c.id,v_version,p_factors,coalesce(p_hard_requirement_keys,'{}'),btrim(p_basis),p_evidence_item_id,auth.uid()) returning id into v_id;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operational_readiness_index_profile',v_role,jsonb_build_object('profile_id',v_id,'case_id',c.id,'version',v_version,'action','draft_saved','evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('profileId',v_id,'version',v_version,'status','draft');
exception when check_violation or unique_violation then return jsonb_build_object('error',sqlerrm);
end $$;
revoke all on function public.save_case_operational_readiness_index_profile(uuid,uuid,jsonb,text[],text,uuid) from public,anon;
grant execute on function public.save_case_operational_readiness_index_profile(uuid,uuid,jsonb,text[],text,uuid) to authenticated;

create or replace function public.adopt_case_operational_readiness_index_profile(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; p public.operational_readiness_index_profiles%rowtype;
  v_expected text[]:=array['people','procedures','asset_data','maintenance','spares','training','operations','safety','cyber'];
  v_categories text[]:=array['asset_master','bom','spares','pm','task_list','procedure','training','inspection','condition_monitoring','vendor_support','documentation','cyber','emergency_response'];
  v_keys text[]; v_seen text[]:='{}'; v_cat text; v_factor jsonb; v_weight numeric; v_missing text[]:='{}';
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive') then return jsonb_build_object('error','adopting the index policy requires a named human admin or executive'); end if;
  select * into p from public.operational_readiness_index_profiles where id=p_profile_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','operational-readiness index profile not found'); end if;
  if p.status<>'draft' then return jsonb_build_object('error','only a draft index profile can be adopted'); end if;
  if jsonb_array_length(p.factors)<>9 then v_missing:=array_append(v_missing,'exactly nine factors'); end if;
  for v_factor in select value from jsonb_array_elements(p.factors) loop
    if not (v_factor->>'key'=any(v_expected)) then v_missing:=array_append(v_missing,'unknown factor '||coalesce(v_factor->>'key','(missing)')); end if;
    if v_factor->>'key'=any(v_keys) then v_missing:=array_append(v_missing,'duplicate factor '||(v_factor->>'key')); end if;
    v_keys:=array_append(v_keys,v_factor->>'key');
    v_weight:=public.sync_text_as_numeric(v_factor->>'weight');
    if v_weight is null or v_weight<=0 or v_weight::text in ('NaN','Infinity','-Infinity') then v_missing:=array_append(v_missing,coalesce(v_factor->>'key','factor')||' finite positive weight'); end if;
    if jsonb_typeof(v_factor->'categories') is distinct from 'array' then
      v_missing:=array_append(v_missing,coalesce(v_factor->>'key','factor')||' category list');
    elsif jsonb_array_length(v_factor->'categories')=0 then
      v_missing:=array_append(v_missing,coalesce(v_factor->>'key','factor')||' at least one assigned category');
    else
      for v_cat in select jsonb_array_elements_text(v_factor->'categories') loop
        if not (v_cat=any(v_categories)) then v_missing:=array_append(v_missing,'unknown category '||v_cat);
        elsif v_cat=any(v_seen) then v_missing:=array_append(v_missing,'category assigned more than once: '||v_cat);
        else v_seen:=array_append(v_seen,v_cat); end if;
      end loop;
    end if;
  end loop;
  foreach v_cat in array v_expected loop if not (v_cat=any(v_keys)) then v_missing:=array_append(v_missing,'missing factor '||v_cat); end if; end loop;
  foreach v_cat in array v_categories loop if not (v_cat=any(v_seen)) then v_missing:=array_append(v_missing,'unassigned category '||v_cat); end if; end loop;
  if cardinality(p.hard_requirement_keys)=0 then v_missing:=array_append(v_missing,'at least one explicit hard-condition catalog item'); end if;
  if exists(select 1 from unnest(p.hard_requirement_keys) k where not exists(select 1 from public.onboarding_requirements r where r.key=k and r.ori_category is not null)) then
    v_missing:=array_append(v_missing,'every hard condition must be an operational-readiness catalog key');
  end if;
  if cardinality(v_missing)>0 then return jsonb_build_object('error','index policy cannot be adopted: '||array_to_string(v_missing,', '),'missing',to_jsonb(v_missing)); end if;
  perform set_config('app.operational_readiness_index_write','allowed',true);
  update public.operational_readiness_index_profiles set status='superseded',superseded_by=p.id
    where development_case_id=p.development_case_id and status='adopted';
  update public.operational_readiness_index_profiles set status='adopted',adopted_by=auth.uid(),adopted_at=now() where id=p.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operational_readiness_index_profile',v_role,jsonb_build_object('profile_id',p.id,'case_id',p.development_case_id,'version',p.version,'action','adopted','evidence_item_id',p.evidence_item_id));
  return jsonb_build_object('profileId',p.id,'version',p.version,'status','adopted');
exception when check_violation or unique_violation then return jsonb_build_object('error',sqlerrm);
end $$;
revoke all on function public.adopt_case_operational_readiness_index_profile(uuid) from public,anon;
grant execute on function public.adopt_case_operational_readiness_index_profile(uuid) to authenticated;

create or replace function public.get_case_operational_readiness_index(p_case_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); c public.development_cases%rowtype; p public.operational_readiness_index_profiles%rowtype;
  v_profiles jsonb; v_factors jsonb:='[]'; v_factor jsonb; v_cats text[]; v_total int; v_done int;
  v_weight numeric; v_weight_sum numeric:=0; v_weighted numeric:=0; v_empty text[]:='{}'; v_hard jsonb; v_hard_count int; v_score numeric;
begin
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('profileId',x.id,'version',x.version,'status',x.status,'factors',x.factors,'hardRequirementKeys',x.hard_requirement_keys,'basis',x.basis,'evidenceItemId',x.evidence_item_id,'createdBy',x.created_by,'createdAt',x.created_at,'adoptedBy',x.adopted_by,'adoptedAt',x.adopted_at) order by x.version desc),'[]') into v_profiles
    from public.operational_readiness_index_profiles x where x.organization_id=v_org and x.development_case_id=c.id;
  select * into p from public.operational_readiness_index_profiles where organization_id=v_org and development_case_id=c.id and status='adopted';
  if not found then return jsonb_build_object('caseId',c.id,'profiles',v_profiles,'calculation',jsonb_build_object('refusal','no_adopted_profile','error','No case-specific Operational Readiness Index policy is adopted. Author nine factor weights, category assignments, hard conditions, basis and evidence, then have a named human admin or executive adopt it. No universal weights are assumed.'),'readinessStore','asset_onboarding_items'); end if;
  for v_factor in select value from jsonb_array_elements(p.factors) loop
    select array_agg(value) into v_cats from jsonb_array_elements_text(v_factor->'categories');
    select count(*),count(*) filter(where i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)
      into v_total,v_done from public.commissioning_systems s
      join public.commissioning_system_readiness_scope q on q.organization_id=v_org and q.commissioning_system_id=s.id
      join public.asset_onboarding_items i on i.id=q.onboarding_item_id and i.organization_id=v_org
      join public.onboarding_requirements r on r.key=i.requirement_key
      where s.organization_id=v_org and s.development_case_id=c.id and r.ori_category=any(v_cats);
    v_weight:=public.sync_text_as_numeric(v_factor->>'weight');
    if v_total=0 then v_empty:=array_append(v_empty,v_factor->>'key');
    else v_weight_sum:=v_weight_sum+v_weight; v_weighted:=v_weighted+v_weight*(v_done::numeric/v_total); end if;
    v_factors:=v_factors||jsonb_build_array(jsonb_build_object('key',v_factor->>'key','weight',v_weight,'categories',v_factor->'categories','satisfied',v_done,'total',v_total,'percent',case when v_total=0 then null else round(100.0*v_done/v_total,1) end));
  end loop;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('systemId',s.id,'systemRef',s.system_ref,'itemId',i.id,'assetId',i.asset_id,'asset',a.name,'assetTag',a.tag,'requirementKey',i.requirement_key,'item',r.item_label,'category',r.ori_category,'status',i.status,'kind',case when r.safety_mission_critical then 'safety_mission_critical' else 'profile_hard_condition' end) order by s.system_ref,a.name,r.sort_order),'[]')
    into v_hard_count,v_hard from public.commissioning_systems s
    join public.commissioning_system_readiness_scope q on q.organization_id=v_org and q.commissioning_system_id=s.id
    join public.asset_onboarding_items i on i.id=q.onboarding_item_id and i.organization_id=v_org
    join public.assets a on a.id=i.asset_id
    join public.onboarding_requirements r on r.key=i.requirement_key
    where s.organization_id=v_org and s.development_case_id=c.id
      and (r.safety_mission_critical or i.requirement_key=any(p.hard_requirement_keys))
      and not(i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null);
  if cardinality(v_empty)>0 then return jsonb_build_object('caseId',c.id,'profiles',v_profiles,'calculation',jsonb_build_object('refusal','missing_factor_inputs','error','Operational Readiness Index cannot be computed because one or more adopted factors have no scoped canonical readiness items. Initialize system readiness rather than treating absence as zero or complete.','missingFactors',to_jsonb(v_empty),'factors',v_factors,'hardBlockers',v_hard),'readinessStore','asset_onboarding_items'); end if;
  v_score:=round(100.0*v_weighted/v_weight_sum,1);
  return jsonb_build_object('caseId',c.id,'profiles',v_profiles,'calculation',jsonb_build_object('index',v_score,'status',case when v_hard_count>0 then 'BLOCKED' when v_score=100 then 'READY' else 'NOT_READY' end,'hardConditionOverride',v_hard_count>0,'hardBlockerCount',v_hard_count,'hardBlockers',v_hard,'factors',v_factors,'profileId',p.id,'profileVersion',p.version,'basis',p.basis,'evidenceItemId',p.evidence_item_id,'formula','sum(weight * factor readiness) / sum(weight); any open effective hard condition forces BLOCKED'),'readinessStore','asset_onboarding_items','decisionBoundary','The index advises whether operations could take ownership. It cannot accept handover, approve go-live, authorize energization, or close a readiness item.');
end $$;
revoke all on function public.get_case_operational_readiness_index(uuid) from public,anon;
grant execute on function public.get_case_operational_readiness_index(uuid) to authenticated;

comment on table public.operational_readiness_index_profiles is 'D8.11 case-specific versioned weighting and hard-condition policy only; readiness status remains canonical in asset_onboarding_items.';
notify pgrst,'reload schema';
