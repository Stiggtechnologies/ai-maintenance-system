-- D6.07 final rollout gate: validate the five tenant/parent foreign keys that
-- already protect every new material relationship write.
--
-- The deployment workflow runs the aggregate-only, read-only material-history
-- audit immediately before and after `supabase db push`. Production preflight
-- and post-migration audits also passed when the NOT VALID constraints were
-- introduced. VALIDATE CONSTRAINT changes only constraint metadata; it does not
-- repair, delete, or rewrite customer relationship history.

alter table public.material_suppliers
  validate constraint material_suppliers_material_tenant_fk;

alter table public.material_suppliers
  validate constraint material_suppliers_supplier_tenant_fk;

alter table public.bom_lines
  validate constraint bom_lines_material_tenant_fk;

alter table public.bom_lines
  validate constraint bom_lines_asset_tenant_fk;

alter table public.bom_lines
  validate constraint bom_lines_component_parent_fk;
