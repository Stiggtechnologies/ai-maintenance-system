-- Composite references enforce tenant/parent scope under concurrent writes
-- and parent updates, including privileged writers outside the customer RPCs.
create unique index if not exists materials_org_identity on public.materials(organization_id,id);
create unique index if not exists suppliers_org_identity on public.suppliers(organization_id,id);
create unique index if not exists assets_org_identity on public.assets(organization_id,id);
create unique index if not exists components_org_asset_identity on public.components(organization_id,asset_id,id);

-- NOT VALID avoids silently rewriting or rejecting historical tenant data
-- during deployment. New writes and referenced-parent updates are enforced.
-- Historical validation is a separate explicit rollout gate.
alter table public.material_suppliers
  add constraint material_suppliers_material_tenant_fk
  foreign key(organization_id,material_id) references public.materials(organization_id,id) not valid,
  add constraint material_suppliers_supplier_tenant_fk
  foreign key(organization_id,supplier_id) references public.suppliers(organization_id,id) not valid;
alter table public.bom_lines
  add constraint bom_lines_material_tenant_fk
  foreign key(organization_id,material_id) references public.materials(organization_id,id) not valid,
  add constraint bom_lines_asset_tenant_fk
  foreign key(organization_id,asset_id) references public.assets(organization_id,id) not valid,
  add constraint bom_lines_component_parent_fk
  foreign key(organization_id,asset_id,component_id)
  references public.components(organization_id,asset_id,id) not valid;
