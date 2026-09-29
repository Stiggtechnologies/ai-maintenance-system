-- Customer-owned material master. This creates a catalogue identity only:
-- no stock receipt, supplier approval, engineering limit or work authorization.
create or replace function public.create_catalogue_material(
  p_material_code text,
  p_description text,
  p_unit_of_measure text,
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
  v_material public.materials%rowtype;
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
  if nullif(btrim(p_material_code), '') is null
     or nullif(btrim(p_description), '') is null
     or nullif(btrim(p_unit_of_measure), '') is null
     or nullif(btrim(p_basis), '') is null then
    return jsonb_build_object('error', 'material code, description, unit and source basis are required');
  end if;
  if length(p_material_code) > 120 or length(p_description) > 2000
     or length(p_unit_of_measure) > 80 or length(p_basis) > 8000 then
    return jsonb_build_object('error', 'material details exceed the supported field lengths');
  end if;

  insert into public.materials (
    organization_id, material_code, description, unit_of_measure,
    basis, source_system, is_template
  ) values (
    v_org, btrim(p_material_code), btrim(p_description), btrim(p_unit_of_measure),
    btrim(p_basis), 'customer_catalogue', false
  ) on conflict (organization_id, material_code) do nothing
  returning * into v_material;
  if not found then
    return jsonb_build_object('error', 'this material code already exists; use its existing catalogue identity');
  end if;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'material_catalogue', v_role,
    jsonb_build_object('action', 'created', 'actorId', v_actor,
      'materialId', v_material.id, 'basis', btrim(p_basis)),
    null, to_jsonb(v_material)
  );
  return jsonb_build_object('materialId', v_material.id,
    'materialCode', v_material.material_code);
end
$$;

revoke all on function public.create_catalogue_material(text,text,text,text)
  from public, anon, service_role;
grant execute on function public.create_catalogue_material(text,text,text,text)
  to authenticated;

notify pgrst, 'reload schema';
