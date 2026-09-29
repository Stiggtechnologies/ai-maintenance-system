-- A recorded supply relationship is not an approval to procure or install.
create or replace function public.link_catalogue_supplier(
  p_material_id uuid,
  p_supplier_id bigint,
  p_supplier_part_number text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v_link public.material_suppliers%rowtype;
begin
  if v_org is null or v_actor is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
    where id = v_actor and organization_id = v_org;
  if coalesce(v_role, '') not in
    ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner') then
    return jsonb_build_object('error', 'a human planning, engineering or governance role is required');
  end if;
  if nullif(btrim(p_basis), '') is null or length(p_basis) > 8000
     or coalesce(length(p_supplier_part_number), 0) > 240 then
    return jsonb_build_object('error', 'a source basis is required within the supported field lengths');
  end if;
  -- Lock canonical parents through insertion so their tenant cannot change
  -- between reference validation and persistence.
  perform 1 from public.materials
    where id = p_material_id and organization_id = v_org for share;
  if not found then return jsonb_build_object('error', 'material not found'); end if;
  perform 1 from public.suppliers
    where id = p_supplier_id and organization_id = v_org for share;
  if not found then return jsonb_build_object('error', 'supplier not found'); end if;

  insert into public.material_suppliers (
    organization_id, material_id, supplier_id, supplier_part_number,
    approved_for_this_material
  ) values (
    v_org, p_material_id, p_supplier_id,
    nullif(btrim(p_supplier_part_number), ''), false
  ) on conflict (material_id, supplier_id) do nothing
  returning * into v_link;
  if not found then
    return jsonb_build_object('error', 'this supplier relationship already exists; its qualification has not been changed');
  end if;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'material_supplier', v_role,
    jsonb_build_object('action', 'linked', 'actorId', v_actor,
      'materialId', p_material_id, 'supplierId', p_supplier_id,
      'basis', btrim(p_basis)), null, to_jsonb(v_link)
  );
  return jsonb_build_object('linkId', v_link.id,
    'approvedForThisMaterial', v_link.approved_for_this_material);
end
$$;

revoke all on function public.link_catalogue_supplier(uuid,bigint,text,text)
  from public, anon, service_role;
grant execute on function public.link_catalogue_supplier(uuid,bigint,text,text)
  to authenticated;

notify pgrst, 'reload schema';
