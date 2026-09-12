-- ============================================================================
-- U20.01 — governed layered capability packs.
--
-- This is a configuration resolver, not a second industry/site/asset model:
--   organizations + org_ancestry  -> enterprise and business-unit identity
--   organizations.industry        -> sector identity
--   organizations.jurisdiction    -> jurisdiction context
--   sites / assets                -> physical scope identity
--   approvals                     -> the ONE approval record for an override
--   audit_events                  -> the ONE governance audit ledger
--
-- Precedence is fixed and inspectable:
-- universal_core -> sector -> jurisdiction -> enterprise -> business_unit ->
-- site -> asset. A later layer may add a key. Changing an inherited value is
-- an override and cannot be adopted until a different authorized human
-- approves the exact captured diff. A pack never authorizes work, changes an
-- operating limit, or substitutes for jurisdictional/customer validation.
-- ============================================================================

create or replace function public.capability_pack_layer_rank(p_layer text)
returns int language sql immutable as $$
  select case p_layer
    when 'universal_core' then 1 when 'sector' then 2
    when 'jurisdiction' then 3 when 'enterprise' then 4
    when 'business_unit' then 5 when 'site' then 6 when 'asset' then 7
    else 0 end
$$;

revoke all on function public.capability_pack_layer_rank(text) from public, anon;
grant execute on function public.capability_pack_layer_rank(text) to authenticated, service_role;

-- Bind the canonical physical site to the canonical organization-tree site.
-- This is the missing join that lets an asset resolve its business-unit layer
-- without asking callers to restate organizational ancestry.
alter table public.sites
  add column if not exists organization_node_id uuid references public.organizations(id) on delete restrict;

create or replace function public.enforce_site_organization_node_integrity()
returns trigger language plpgsql security definer set search_path=public as $$
declare n public.organizations%rowtype;
begin
  if new.organization_node_id is null then return new; end if;
  select * into n from public.organizations where id=new.organization_node_id;
  if n.id is null or n.org_level<>'site' or not public.org_node_in_scope(n.id,new.organization_id) then
    raise exception 'physical site must bind to a site node inside its organization hierarchy' using errcode='check_violation';
  end if;
  return new;
end $$;

revoke all on function public.enforce_site_organization_node_integrity() from public, anon, authenticated;
drop trigger if exists trg_site_organization_node_integrity on public.sites;
create trigger trg_site_organization_node_integrity before insert or update of organization_node_id on public.sites
for each row execute function public.enforce_site_organization_node_integrity();

create table if not exists public.capability_pack_layers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  layer_kind text not null check (layer_kind in
    ('universal_core','sector','jurisdiction','enterprise','business_unit','site','asset')),
  scope_key text not null,
  title text not null,
  industry_code text,
  jurisdiction text,
  organization_node_id uuid references public.organizations(id) on delete restrict,
  site_id uuid references public.sites(id) on delete restrict,
  asset_id uuid references public.assets(id) on delete restrict,
  configuration jsonb not null check (jsonb_typeof(configuration)='object'),
  evidence_basis text not null,
  override_diff jsonb not null default '[]'::jsonb check (jsonb_typeof(override_diff)='array'),
  override_approval_id uuid references public.approvals(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','adopted','superseded','rejected')),
  version int not null check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  adoption_note text,
  register_ref text not null default 'U20.01',
  unique(organization_id,layer_kind,scope_key,version),
  check (
    (status='draft' and adopted_by is null and adopted_at is null)
    or (status in ('adopted','superseded') and adopted_by is not null and adopted_at is not null)
    or status='rejected'
  ),
  check (
    (jsonb_array_length(override_diff)=0 and override_approval_id is null)
    or (jsonb_array_length(override_diff)>0 and override_approval_id is not null)
  )
);

create unique index if not exists idx_one_adopted_capability_pack_scope
  on public.capability_pack_layers(organization_id,layer_kind,scope_key)
  where status='adopted';
create index if not exists idx_capability_pack_resolution
  on public.capability_pack_layers(organization_id,layer_kind,status,scope_key,version desc);

-- Keep the approval in the canonical approvals family while preventing a
-- browser with generic approval authority from forging this exact-diff
-- outcome around the independent-review RPC.
alter table public.approvals
  add column if not exists capability_pack_layer_id uuid
    references public.capability_pack_layers(id) on delete restrict;
create unique index if not exists idx_capability_pack_approval_layer
  on public.approvals(capability_pack_layer_id)
  where capability_pack_layer_id is not null;
drop policy if exists approvals_capability_pack_sensitive on public.approvals;
create policy approvals_capability_pack_sensitive on public.approvals as restrictive
  for all to authenticated using (true)
  with check (capability_pack_layer_id is null);

alter table public.capability_pack_layers enable row level security;
drop policy if exists capability_pack_layers_read on public.capability_pack_layers;
create policy capability_pack_layers_read on public.capability_pack_layers
  for select to authenticated using (organization_id=public.app_current_org());

create or replace function public.enforce_capability_pack_layer_integrity()
returns trigger language plpgsql security definer set search_path=public as $$
declare n public.organizations%rowtype; s public.sites%rowtype; a public.assets%rowtype;
begin
  if public.capability_pack_layer_rank(new.layer_kind)=0 then raise exception 'invalid capability-pack layer'; end if;
  if new.organization_node_id is not null then
    if not public.org_node_in_scope(new.organization_node_id,new.organization_id) then
      raise exception 'organization node is outside the tenant hierarchy' using errcode='check_violation'; end if;
    select * into n from public.organizations where id=new.organization_node_id;
  end if;
  if new.site_id is not null then
    select * into s from public.sites where id=new.site_id;
    if s.id is null or s.organization_id<>new.organization_id then
      raise exception 'site is outside the tenant' using errcode='check_violation'; end if;
  end if;
  if new.asset_id is not null then
    select * into a from public.assets where id=new.asset_id;
    if a.id is null or a.organization_id<>new.organization_id then
      raise exception 'asset is outside the tenant' using errcode='check_violation'; end if;
    if new.site_id is not null and a.site_id is distinct from new.site_id then
      raise exception 'asset does not belong to the selected site' using errcode='check_violation'; end if;
  end if;
  if (new.layer_kind='sector' and coalesce(btrim(new.industry_code),'')='')
     or (new.layer_kind='jurisdiction' and coalesce(btrim(new.jurisdiction),'')='')
     or (new.layer_kind='business_unit' and (n.id is null or n.org_level<>'business_unit'))
     or (new.layer_kind='site' and s.id is null)
     or (new.layer_kind='asset' and a.id is null) then
    raise exception 'the selected layer is missing its canonical scope' using errcode='check_violation';
  end if;
  if new.layer_kind in ('universal_core','enterprise') and
     (new.industry_code is not null or new.jurisdiction is not null or new.organization_node_id is not null or new.site_id is not null or new.asset_id is not null) then
    raise exception 'universal and enterprise layers do not carry lower-level scope identifiers' using errcode='check_violation';
  end if;
  if (new.layer_kind='sector' and
      (new.jurisdiction is not null or new.organization_node_id is not null or new.site_id is not null or new.asset_id is not null))
     or (new.layer_kind='jurisdiction' and
      (new.industry_code is not null or new.organization_node_id is not null or new.site_id is not null or new.asset_id is not null))
     or (new.layer_kind='business_unit' and
      (new.industry_code is not null or new.jurisdiction is not null or new.site_id is not null or new.asset_id is not null))
     or (new.layer_kind='site' and
      (new.industry_code is not null or new.jurisdiction is not null or new.organization_node_id is not null or new.asset_id is not null))
     or (new.layer_kind='asset' and
      (new.industry_code is not null or new.jurisdiction is not null or new.organization_node_id is not null or new.site_id is not null)) then
    raise exception 'a pack layer may carry only its own canonical scope identifier' using errcode='check_violation';
  end if;
  if new.override_approval_id is not null and not exists(
    select 1 from public.approvals p where p.id=new.override_approval_id and p.organization_id=new.organization_id
  ) then raise exception 'override approval is outside the tenant' using errcode='check_violation'; end if;
  return new;
end $$;

revoke all on function public.enforce_capability_pack_layer_integrity() from public, anon, authenticated;
drop trigger if exists trg_capability_pack_layer_integrity on public.capability_pack_layers;
create trigger trg_capability_pack_layer_integrity before insert or update on public.capability_pack_layers
for each row execute function public.enforce_capability_pack_layer_integrity();

create or replace function public.resolve_capability_pack_stack(
  p_asset_id uuid default null,
  p_site_id uuid default null,
  p_node_id uuid default null,
  p_jurisdiction text default null,
  p_industry_code text default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_site uuid:=p_site_id; v_node uuid:=p_node_id;
  v_site_node uuid;
  v_industry text; v_jurisdiction text; v_effective jsonb:='{}'::jsonb; v_sources jsonb:='{}'::jsonb;
  v_stack jsonb:='[]'::jsonb; v_missing jsonb:='[]'::jsonb; a public.assets%rowtype; r record; kv record;
  kinds text[]:=array['universal_core','sector','jurisdiction','enterprise','business_unit','site','asset']; k text;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  if p_asset_id is not null then
    select * into a from public.assets where id=p_asset_id and organization_id=v_org;
    if a.id is null then return jsonb_build_object('error','asset not found in this tenant'); end if;
    v_site:=coalesce(v_site,a.site_id);
    if v_site is distinct from a.site_id then return jsonb_build_object('error','asset and site context conflict'); end if;
  end if;
  if v_site is not null then
    if not exists(select 1 from public.sites where id=v_site and organization_id=v_org) then
      return jsonb_build_object('error','site not found in this tenant'); end if;
    select organization_node_id into v_site_node from public.sites where id=v_site;
    if v_node is null then v_node:=v_site_node;
    elsif v_site_node is not null and v_node<>v_site_node then
      return jsonb_build_object('error','site and organization-node context conflict'); end if;
  end if;
  if v_node is not null and not public.org_node_in_scope(v_node,v_org) then
    return jsonb_build_object('error','organization node not found in this tenant hierarchy'); end if;
  select coalesce(nullif(btrim(p_industry_code),''),industry),
         coalesce(nullif(btrim(p_jurisdiction),''),jurisdiction)
    into v_industry,v_jurisdiction from public.organizations where id=v_org;

  for r in
    select l.* from public.capability_pack_layers l
    where l.organization_id=v_org and l.status='adopted' and (
      l.layer_kind in ('universal_core','enterprise')
      or (l.layer_kind='sector' and l.industry_code=v_industry)
      or (l.layer_kind='jurisdiction' and l.jurisdiction=v_jurisdiction)
      or (l.layer_kind='business_unit' and v_node is not null and l.organization_node_id in
          (select node_id from public.org_ancestry(v_node)))
      or (l.layer_kind='site' and l.site_id=v_site)
      or (l.layer_kind='asset' and l.asset_id=p_asset_id)
    ) order by public.capability_pack_layer_rank(l.layer_kind),l.version,l.created_at
  loop
    v_stack:=v_stack||jsonb_build_array(jsonb_build_object(
      'id',r.id,'layer',r.layer_kind,'scope_key',r.scope_key,'title',r.title,'version',r.version,
      'configuration',r.configuration,'evidence_basis',r.evidence_basis,
      'override_count',jsonb_array_length(r.override_diff),'adopted_at',r.adopted_at));
    for kv in select * from jsonb_each(r.configuration) loop
      v_effective:=jsonb_set(v_effective,array[kv.key],kv.value,true);
      v_sources:=jsonb_set(v_sources,array[kv.key],jsonb_build_object(
        'layer_id',r.id,'layer',r.layer_kind,'title',r.title,'value',kv.value),true);
    end loop;
  end loop;
  foreach k in array kinds loop
    if not exists(select 1 from jsonb_array_elements(v_stack) x where x->>'layer'=k) then
      v_missing:=v_missing||to_jsonb(k); end if;
  end loop;
  return jsonb_build_object(
    'context',jsonb_build_object('industry_code',v_industry,'jurisdiction',v_jurisdiction,
      'organization_node_id',v_node,'site_id',v_site,'asset_id',p_asset_id),
    'stack',v_stack,'effective_configuration',v_effective,'value_sources',v_sources,
    'missing_layers',v_missing,
    'authority','Configuration guidance only. This stack cannot approve work, change an operating limit, or establish regulatory compliance.');
end $$;

create or replace function public.author_capability_pack_layer(p_layer jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_kind text:=p_layer->>'layer_kind'; v_scope text;
  v_config jsonb:=p_layer->'configuration'; v_effective jsonb:='{}'::jsonb; v_diff jsonb:='[]'::jsonb;
  v_id uuid; v_approval uuid; v_version int; base jsonb; kv record; v_inherited jsonb;
  v_industry text; v_jurisdiction text; v_node uuid; v_site uuid; v_asset uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','authoring a capability pack requires named human governance authority'); end if;
  if v_role='ai_admin' then return jsonb_build_object('error','the AI-operator identity cannot author capability packs'); end if;
  if public.capability_pack_layer_rank(v_kind)=0 then return jsonb_build_object('error','invalid layer kind'); end if;
  if jsonb_typeof(coalesce(v_config,'null'::jsonb))<>'object' or v_config='{}'::jsonb then
    return jsonb_build_object('error','configuration must be a non-empty key/value object'); end if;
  if exists(select 1 from jsonb_each(v_config) x where x.value='null'::jsonb or x.key !~ '^[a-z][a-z0-9_]{2,79}$') then
    return jsonb_build_object('error','configuration keys require lowercase machine keys and non-null values'); end if;
  if coalesce(length(btrim(p_layer->>'title')),0)<5 or coalesce(length(btrim(p_layer->>'evidence_basis')),0)<20 then
    return jsonb_build_object('error','title and a reviewable evidence basis are required'); end if;
  begin v_node:=nullif(p_layer->>'organization_node_id','')::uuid; exception when others then return jsonb_build_object('error','invalid organization node'); end;
  begin v_site:=nullif(p_layer->>'site_id','')::uuid; exception when others then return jsonb_build_object('error','invalid site'); end;
  begin v_asset:=nullif(p_layer->>'asset_id','')::uuid; exception when others then return jsonb_build_object('error','invalid asset'); end;
  v_industry:=nullif(btrim(p_layer->>'industry_code'),''); v_jurisdiction:=nullif(btrim(p_layer->>'jurisdiction'),'');
  v_scope:=case v_kind when 'universal_core' then 'universal' when 'sector' then 'sector:'||coalesce(v_industry,'')
    when 'jurisdiction' then 'jurisdiction:'||coalesce(v_jurisdiction,'') when 'enterprise' then 'enterprise:'||v_org
    when 'business_unit' then 'business_unit:'||coalesce(v_node::text,'') when 'site' then 'site:'||coalesce(v_site::text,'')
    when 'asset' then 'asset:'||coalesce(v_asset::text,'') end;

  base:=public.resolve_capability_pack_stack(v_asset,v_site,v_node,v_jurisdiction,v_industry);
  if base ? 'error' then return base; end if;
  -- Only inherited layers precede the authored layer; same/lower layers cannot
  -- manufacture an override against themselves.
  for kv in select x.key,x.value from jsonb_each(base->'effective_configuration') x loop
    select s->'configuration'->kv.key into v_inherited from jsonb_array_elements(base->'stack') s
      where public.capability_pack_layer_rank(s->>'layer')<public.capability_pack_layer_rank(v_kind)
        and s->'configuration' ? kv.key order by public.capability_pack_layer_rank(s->>'layer') desc limit 1;
    if v_inherited is not null then v_effective:=jsonb_set(v_effective,array[kv.key],v_inherited,true); end if;
  end loop;
  for kv in select * from jsonb_each(v_config) loop
    if v_effective ? kv.key and v_effective->kv.key is distinct from kv.value then
      v_diff:=v_diff||jsonb_build_array(jsonb_build_object('key',kv.key,'inherited',v_effective->kv.key,'proposed',kv.value)); end if;
  end loop;
  if jsonb_array_length(v_diff)>0 then
    insert into public.approvals(organization_id,status,owner_role,reason,consequence_of_wrong,required_validation)
    values(v_org,'required','executive','Approve exact capability-pack override diff for '||v_scope,
      'An unreviewed lower layer could silently weaken enterprise, sector or jurisdiction controls.',
      'Compare every inherited and proposed value against the stated evidence and applicable authority.') returning id into v_approval;
  end if;
  select coalesce(max(version),0)+1 into v_version from public.capability_pack_layers
    where organization_id=v_org and layer_kind=v_kind and scope_key=v_scope;
  insert into public.capability_pack_layers(organization_id,layer_kind,scope_key,title,industry_code,jurisdiction,
    organization_node_id,site_id,asset_id,configuration,evidence_basis,override_diff,override_approval_id,version,created_by)
  values(v_org,v_kind,v_scope,btrim(p_layer->>'title'),v_industry,v_jurisdiction,v_node,v_site,v_asset,v_config,
    btrim(p_layer->>'evidence_basis'),v_diff,v_approval,v_version,auth.uid()) returning id into v_id;
  if v_approval is not null then
    update public.approvals set capability_pack_layer_id=v_id where id=v_approval;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'capability_pack_layer',v_role,
    jsonb_build_object('action','draft_authored','layer_id',v_id,'layer',v_kind,'scope_key',v_scope,
      'override_diff',v_diff,'approval_id',v_approval));
  return jsonb_build_object('layer_id',v_id,'status','draft','version',v_version,'override_diff',v_diff,'approval_id',v_approval);
exception when check_violation then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.decide_capability_pack_override(p_layer_id uuid,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; l public.capability_pack_layers%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('executive','admin') then return jsonb_build_object('error','override approval requires executive or administrator authority'); end if;
  if v_role='ai_admin' then return jsonb_build_object('error','the AI-operator identity cannot approve overrides'); end if;
  select * into l from public.capability_pack_layers where id=p_layer_id and organization_id=v_org for update;
  if l.id is null or l.status<>'draft' or l.override_approval_id is null then return jsonb_build_object('error','pending override layer not found'); end if;
  if l.created_by=auth.uid() then return jsonb_build_object('error','the override author cannot approve their own change'); end if;
  if p_outcome not in ('approved','rejected') or coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','record approved or rejected with a review note of at least 20 characters'); end if;
  update public.approvals set status=p_outcome,approver=auth.uid()::text,reason=reason||' Review: '||btrim(p_note),decided_at=now()
    where id=l.override_approval_id and organization_id=v_org and capability_pack_layer_id=l.id
      and status in ('required','pending');
  if not found then return jsonb_build_object('error','override approval is no longer pending'); end if;
  if p_outcome='rejected' then update public.capability_pack_layers set status='rejected' where id=l.id; end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'capability_pack_override',v_role,
    jsonb_build_object('action',p_outcome,'layer_id',l.id,'approval_id',l.override_approval_id,'exact_diff',l.override_diff,'note',btrim(p_note)));
  return jsonb_build_object('layer_id',l.id,'approval_id',l.override_approval_id,'status',p_outcome);
end $$;

create or replace function public.adopt_capability_pack_layer(p_layer_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; l public.capability_pack_layers%rowtype; p public.approvals%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','pack adoption requires named human governance authority'); end if;
  if v_role='ai_admin' then return jsonb_build_object('error','the AI-operator identity cannot adopt capability packs'); end if;
  if coalesce(length(btrim(p_note)),0)<20 then return jsonb_build_object('error','adoption requires a review note of at least 20 characters'); end if;
  select * into l from public.capability_pack_layers where id=p_layer_id and organization_id=v_org for update;
  if l.id is null or l.status<>'draft' then return jsonb_build_object('error','draft pack layer not found'); end if;
  if l.override_approval_id is not null then
    select * into p from public.approvals where id=l.override_approval_id and organization_id=v_org;
    if p.status<>'approved' or p.decided_at is null or p.approver is null or p.capability_pack_layer_id<>l.id then
      return jsonb_build_object('error','the exact override diff requires completed human approval'); end if;
  end if;
  update public.capability_pack_layers set status='superseded' where organization_id=v_org and layer_kind=l.layer_kind and scope_key=l.scope_key and status='adopted';
  update public.capability_pack_layers set status='adopted',adopted_by=auth.uid(),adopted_at=now(),adoption_note=btrim(p_note) where id=l.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'capability_pack_layer',v_role,
    jsonb_build_object('action','adopted','layer_id',l.id,'layer',l.layer_kind,'scope_key',l.scope_key,
      'override_approval_id',l.override_approval_id,'note',btrim(p_note)));
  return jsonb_build_object('layer_id',l.id,'status','adopted','layer',l.layer_kind,'scope_key',l.scope_key);
end $$;

create or replace function public.get_capability_pack_workspace()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.app_current_org() is null or auth.uid() is null then jsonb_build_object('error','forbidden') else jsonb_build_object(
    'layers',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'layer_kind',l.layer_kind,'scope_key',l.scope_key,
      'title',l.title,'configuration',l.configuration,'evidence_basis',l.evidence_basis,'override_diff',l.override_diff,
      'override_approval_id',l.override_approval_id,'approval_status',p.status,'status',l.status,'version',l.version,
      'created_by',l.created_by,'adopted_by',l.adopted_by,'adopted_at',l.adopted_at)
      order by public.capability_pack_layer_rank(l.layer_kind),l.scope_key,l.version desc)
      from public.capability_pack_layers l left join public.approvals p on p.id=l.override_approval_id
      where l.organization_id=public.app_current_org()),'[]'::jsonb),
    'sites',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'organization_node_id',organization_node_id) order by name) from public.sites where organization_id=public.app_current_org()),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'site_id',site_id,'asset_class',asset_class) order by name) from public.assets where organization_id=public.app_current_org()),'[]'::jsonb),
    'organization_nodes',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'org_level',o.org_level,'jurisdiction',o.jurisdiction) order by public.org_level_rank(o.org_level),o.name)
      from public.organizations o where public.org_node_in_scope(o.id,public.app_current_org())),'[]'::jsonb),
    'controls',jsonb_build_object('precedence','universal core → sector → jurisdiction → enterprise → business unit → site → asset',
      'override','Changing an inherited value requires exact-diff approval by a different authorized human.',
      'execution','Pack resolution is configuration guidance only and grants no operational authority.')
  ) end
$$;

revoke all on function public.resolve_capability_pack_stack(uuid,uuid,uuid,text,text) from public, anon;
revoke all on function public.author_capability_pack_layer(jsonb) from public, anon;
revoke all on function public.decide_capability_pack_override(uuid,text,text) from public, anon;
revoke all on function public.adopt_capability_pack_layer(uuid,text) from public, anon;
revoke all on function public.get_capability_pack_workspace() from public, anon;
grant execute on function public.resolve_capability_pack_stack(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.author_capability_pack_layer(jsonb) to authenticated;
grant execute on function public.decide_capability_pack_override(uuid,text,text) to authenticated;
grant execute on function public.adopt_capability_pack_layer(uuid,text) to authenticated;
grant execute on function public.get_capability_pack_workspace() to authenticated;
grant select on public.capability_pack_layers to authenticated;
