-- Run with psql against the intended database before rollout and after migration.
-- Read-only, aggregate-only audit; never repairs or exposes customer records.
\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;
set local statement_timeout = '60s';
set local row_security = off;
do $$
declare
  failures bigint;
  component_failures bigint := 0;
begin
  -- A tenant-scoped session could otherwise falsely report a clean database.
  if not exists (select 1 from pg_roles where rolname = current_user
    and (rolsuper or rolbypassrls)) then
    raise exception 'Audit requires a database role with full RLS visibility';
  end if;
  select count(*) into failures from (
    select ms.id::text from public.material_suppliers ms
    where not exists (select 1 from public.materials m
      where m.id = ms.material_id and m.organization_id = ms.organization_id)
      or not exists (select 1 from public.suppliers s
        where s.id = ms.supplier_id and s.organization_id = ms.organization_id)
    union all
    select b.id::text from public.bom_lines b
    where not exists (select 1 from public.materials m
      where m.id = b.material_id and m.organization_id = b.organization_id)
      or (b.asset_id is not null and not exists (select 1 from public.assets a
        where a.id = b.asset_id and a.organization_id = b.organization_id))
      or b.qty_per is null or b.qty_per <= 0
      or b.qty_per::text in ('NaN', 'Infinity', '-Infinity')
  ) invalid_relationships;
  -- The component column is introduced by this slice, so preflight also works
  -- on the previous production schema. Post-migration it must be checked.
  if exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'bom_lines' and column_name = 'component_id') then
    execute 'select count(*) from public.bom_lines b
      where b.component_id is not null and not exists (
        select 1 from public.components c where c.id = b.component_id
          and c.organization_id = b.organization_id and c.asset_id = b.asset_id)'
      into component_failures;
  else
    raise notice 'Component references not yet deployed; rerun after migration';
  end if;
  if failures > 0 or component_failures > 0 then
    raise exception 'Historical audit refused: % invalid supplier/BOM rows; % invalid component references. Investigate under governed tenant access; no records changed.',
      failures, component_failures;
  end if;
  raise notice 'Historical material relationship audit passed for this database snapshot; no records changed';
end
$$;
rollback;
