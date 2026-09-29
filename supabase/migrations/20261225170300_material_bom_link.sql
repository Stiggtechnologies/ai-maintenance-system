-- Extend the canonical BOM, not a second installed-material registry.
alter table public.bom_lines add column if not exists component_id uuid
  references public.components(id) on delete restrict;

create or replace function public.guard_material_bom_scope()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.materials m
    where m.id = new.material_id and m.organization_id = new.organization_id) then
    raise exception 'BOM material must belong to the same organization';
  end if;
  if new.asset_id is not null and not exists (select 1 from public.assets a
    where a.id = new.asset_id and a.organization_id = new.organization_id) then
    raise exception 'BOM asset must belong to the same organization';
  end if;
  if new.component_id is not null and not exists (select 1 from public.components c
    where c.id = new.component_id and c.organization_id = new.organization_id
      and c.asset_id = new.asset_id) then
    raise exception 'BOM component must belong to the selected asset and organization';
  end if;
  if new.qty_per is null or new.qty_per <= 0
     or new.qty_per::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'BOM quantity must be finite and positive';
  end if;
  return new;
end
$$;
revoke all on function public.guard_material_bom_scope() from public, anon, authenticated;
create trigger material_bom_scope before insert or update on public.bom_lines
  for each row execute function public.guard_material_bom_scope();

create or replace function public.link_catalogue_bom(
  p_material_id uuid,
  p_asset_id uuid,
  p_asset_class text,
  p_component_id uuid,
  p_qty_per numeric,
  p_position_note text,
  p_basis text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v_class text := nullif(btrim(p_asset_class), '');
  v_line public.bom_lines%rowtype;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error', 'forbidden'); end if;
  select role into v_role from public.user_profiles where id = v_actor and organization_id = v_org;
  if coalesce(v_role, '') not in
    ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner') then
    return jsonb_build_object('error', 'a human planning, engineering or governance role is required');
  end if;
  if (p_asset_id is null) = (v_class is null) then
    return jsonb_build_object('error', 'select exactly one asset or asset class');
  end if;
  if p_component_id is not null and p_asset_id is null then
    return jsonb_build_object('error', 'a component requires its parent asset');
  end if;
  if p_qty_per is null or p_qty_per <= 0 or p_qty_per::text in ('NaN', 'Infinity', '-Infinity') then
    return jsonb_build_object('error', 'quantity must be finite and positive');
  end if;
  if nullif(btrim(p_basis), '') is null or length(p_basis) > 8000
     or coalesce(length(p_position_note), 0) > 2000 then
    return jsonb_build_object('error', 'a source basis is required within supported field lengths');
  end if;
  -- Serializes duplicate checks for this canonical material.
  perform 1 from public.materials where id = p_material_id and organization_id = v_org for update;
  if not found then return jsonb_build_object('error', 'material not found'); end if;
  if p_asset_id is not null then
    perform 1 from public.assets where id = p_asset_id and organization_id = v_org for share;
    if not found then return jsonb_build_object('error', 'asset not found'); end if;
  else
    perform 1 from public.assets where asset_class = v_class and organization_id = v_org for share;
    if not found then return jsonb_build_object('error', 'asset class has no assets in this organization'); end if;
  end if;
  if p_component_id is not null then
    perform 1 from public.components where id = p_component_id
      and asset_id = p_asset_id and organization_id = v_org for share;
    if not found then return jsonb_build_object('error', 'component not found on this asset'); end if;
  end if;
  if exists (select 1 from public.bom_lines b where b.organization_id = v_org
    and b.material_id = p_material_id and b.asset_id is not distinct from p_asset_id
    and b.asset_class is not distinct from v_class
    and b.component_id is not distinct from p_component_id
    and nullif(btrim(b.position_note), '') is not distinct from nullif(btrim(p_position_note), '')) then
    return jsonb_build_object('error', 'this BOM position already exists; no duplicate was created');
  end if;
  insert into public.bom_lines(organization_id, material_id, asset_id, asset_class,
    component_id, qty_per, position_note, source_system)
  values(v_org, p_material_id, p_asset_id, v_class, p_component_id, p_qty_per,
    nullif(btrim(p_position_note), ''), 'customer_catalogue') returning * into v_line;
  insert into public.audit_events(organization_id, entity_type, actor, event_data, previous_state, new_state)
  values(v_org, 'material_bom', v_role,
    jsonb_build_object('action', 'linked', 'actorId', v_actor, 'basis', btrim(p_basis)),
    null, to_jsonb(v_line));
  return jsonb_build_object('bomLineId', v_line.id);
end
$$;
revoke all on function public.link_catalogue_bom(uuid,uuid,text,uuid,numeric,text,text)
  from public, anon, service_role;
grant execute on function public.link_catalogue_bom(uuid,uuid,text,uuid,numeric,text,text)
  to authenticated;
notify pgrst, 'reload schema';
