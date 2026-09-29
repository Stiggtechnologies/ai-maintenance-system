-- Focused PostgreSQL execution test ONLY. Run in a disposable empty database.
-- Minimal dependency fixtures do not replace the full Supabase migration smoke.
\set ON_ERROR_STOP on
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
create function public.app_current_org() returns uuid language sql stable as
  $$ select nullif(current_setting('test.org', true), '')::uuid $$;
create table public.user_profiles(id uuid, organization_id uuid, role text);
create table public.materials(id uuid primary key default gen_random_uuid(), organization_id uuid,
  material_code text, description text, unit_of_measure text, basis text,
  source_system text, is_template boolean, unique(organization_id, material_code));
create table public.suppliers(id bigint primary key, organization_id uuid,
  name text default 'Fixture supplier', supplier_code text default 'FIXTURE', approved_vendor boolean default false);
create table public.assets(id uuid primary key, organization_id uuid, asset_class text);
create table public.components(id uuid primary key, organization_id uuid, asset_id uuid references assets(id), name text default 'Fixture bearing');
create table public.material_suppliers(id bigserial primary key, organization_id uuid,
  material_id uuid references materials(id), supplier_id bigint references suppliers(id),
  supplier_part_number text, approved_for_this_material boolean default false,
  unique(material_id, supplier_id));
create table public.bom_lines(id uuid primary key default gen_random_uuid(), organization_id uuid,
  material_id uuid references materials(id), asset_id uuid references assets(id), asset_class text,
  qty_per numeric, position_note text, source_system text);
create table public.audit_events(organization_id uuid, entity_type text, actor text,
  event_data jsonb, previous_state jsonb, new_state jsonb);
create table public.work_orders(organization_id uuid, asset_id uuid, actual_failure_mode text, work_type text, created_at timestamptz default now());
create table public.design_requirements(organization_id uuid, derived_from_failure_mode text,
  id bigint generated always as identity, requirement_ref text default 'FIXTURE-REQ',
  requirement text default 'Fixture requirement', category text default 'reliability', verification_status text default 'draft');
create table public.contract_packages(id bigint primary key, organization_id uuid,
  awarded_at timestamptz, awarded_supplier_id bigint, package_code text, title text, contract_currency text);
create table public.contract_package_specifications(organization_id uuid, package_id bigint, requirement_id bigint, basis text);
create table public.contract_bids(package_id bigint, withdrawn_at timestamptz);
-- Cost calculation is outside this focused traversal test.
create function public.contract_current_value(bigint) returns numeric language sql as $$ select 0::numeric $$;
\ir ../supabase/migrations/20261225170000_material_commercial_feedback.sql
\ir ../supabase/migrations/20261225170100_material_catalogue_write.sql
\ir ../supabase/migrations/20261225170200_material_supplier_link.sql
\ir ../supabase/migrations/20261225170300_material_bom_link.sql
\ir ../supabase/migrations/20261225170500_material_relationship_tenant_keys.sql
\ir ../supabase/migrations/20261225170400_material_commercial_component_thread.sql

select set_config('test.org', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.actor', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
insert into user_profiles values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','planner');
insert into suppliers(id,organization_id) values (1,'11111111-1111-1111-1111-111111111111'),
 (2,'22222222-2222-2222-2222-222222222222');
insert into assets values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','pump'),
 ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','pump');
insert into components(id,organization_id,asset_id) values
 ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001'),
 ('cccccccc-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000002');

do $$
declare r jsonb; m uuid; n int;
begin
  r := create_catalogue_material(' SEAL-1 ', ' Seal ', ' each ', ' Drawing 4 ');
  if r ? 'error' then raise exception 'catalogue failed: %', r; end if;
  m := (r->>'materialId')::uuid;
  if r->>'materialCode' <> 'SEAL-1' then raise exception 'code not normalized'; end if;
  if not (create_catalogue_material('SEAL-1','Other','each','Source') ? 'error') then raise exception 'duplicate accepted'; end if;
  if not (create_catalogue_material('EMPTY','Other','each',' ') ? 'error') then raise exception 'blank basis accepted'; end if;
  if not (link_catalogue_supplier(m,2,'SP','Quote') ? 'error') then raise exception 'foreign supplier accepted'; end if;
  r := link_catalogue_supplier(m,1,'SP','Quote');
  if r ? 'error' or (r->>'approvedForThisMaterial')::boolean then raise exception 'supplier boundary failed: %', r; end if;
  update material_suppliers set approved_for_this_material=true where material_id=m;
  if not (link_catalogue_supplier(m,1,'NEW','Quote') ? 'error') then raise exception 'duplicate supplier accepted'; end if;
  if not (select approved_for_this_material from material_suppliers where material_id=m) then raise exception 'qualification overwritten'; end if;
  r := link_catalogue_bom(m,'aaaaaaaa-0000-0000-0000-000000000001',null,'cccccccc-0000-0000-0000-000000000001',2,'bearing','Drawing');
  if r ? 'error' then raise exception 'component BOM failed: %', r; end if;
  if not (link_catalogue_bom(m,'aaaaaaaa-0000-0000-0000-000000000001',null,'cccccccc-0000-0000-0000-000000000001',2,'bearing','Drawing') ? 'error') then raise exception 'duplicate BOM accepted'; end if;
  if not (link_catalogue_bom(m,'aaaaaaaa-0000-0000-0000-000000000002',null,null,2,'','Drawing') ? 'error') then raise exception 'foreign asset accepted'; end if;
  if not (link_catalogue_bom(m,'aaaaaaaa-0000-0000-0000-000000000001',null,'cccccccc-0000-0000-0000-000000000002',2,'','Drawing') ? 'error') then raise exception 'foreign component accepted'; end if;
  if not (link_catalogue_bom(m,null,'pump',null,'NaN'::numeric,'','Drawing') ? 'error') then raise exception 'NaN accepted'; end if;
  r := link_catalogue_bom(m,null,'pump',null,2,'','Drawing');
  if r ? 'error' then raise exception 'class BOM failed: %', r; end if;
  begin
    insert into bom_lines(organization_id,material_id,asset_id,component_id,qty_per)
    values('11111111-1111-1111-1111-111111111111',m,'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',1);
    raise exception 'guard failed to reject component';
  exception when raise_exception then
    if SQLERRM not like 'BOM component must belong%' then raise; end if;
  end;
  select count(*) into n from audit_events;
  if n <> 4 then raise exception 'expected four success audit records, got %', n; end if;
  begin
    update suppliers set organization_id='22222222-2222-2222-2222-222222222222' where id=1;
    raise exception 'supplier tenant mutation accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update components set asset_id='aaaaaaaa-0000-0000-0000-000000000002'
      where id='cccccccc-0000-0000-0000-000000000001';
    raise exception 'component parent mutation accepted';
  exception when foreign_key_violation then null;
  end;
  update user_profiles set role='ai_admin';
  if not (create_catalogue_material('AI','Other','each','Source') ? 'error') then raise exception 'AI write accepted'; end if;
  if not (link_catalogue_supplier(m,1,'SP','Quote') ? 'error') then raise exception 'AI supplier write accepted'; end if;
  if not (link_catalogue_bom(m,null,'pump',null,2,'new','Drawing') ? 'error') then raise exception 'AI BOM write accepted'; end if;
end
$$;

insert into work_orders(organization_id,asset_id,actual_failure_mode,work_type) select '11111111-1111-1111-1111-111111111111',
 'aaaaaaaa-0000-0000-0000-000000000001', 'mode-' || n, 'corrective' from generate_series(1,20) n;
insert into work_orders(organization_id,asset_id,actual_failure_mode,work_type) values ('22222222-2222-2222-2222-222222222222',
 'aaaaaaaa-0000-0000-0000-000000000002','foreign-mode','corrective');
insert into design_requirements(organization_id,derived_from_failure_mode) values ('11111111-1111-1111-1111-111111111111','mode-20');
do $$ begin
  if (select count(*) from get_design_feedback_loop()) <> 20 then raise exception 'reverse lookup truncated or leaked'; end if;
  if not (select loop_closed from get_design_feedback_loop() where failure_mode='mode-20') then raise exception 'low-frequency requirement lost'; end if;
end $$;
do $$
declare r jsonb;
begin
  r := get_specification_failure_thread('FIXTURE-REQ');
  if (r->>'answered')::boolean or jsonb_array_length(r->'backward') <> 1 then
    raise exception 'reverse history lost when forward thread refuses: %',r;
  end if;
  insert into contract_packages values(1,'11111111-1111-1111-1111-111111111111',now(),1,'P1','Fixture package','CAD');
  insert into contract_package_specifications select organization_id,1,id,'Fixture linkage' from design_requirements;
  r := get_specification_failure_thread('FIXTURE-REQ');
  if not (r->>'answered')::boolean or (r->>'bomAssets')::int <> 1
    or jsonb_array_length(r->'componentLinks') <> 1
    or (r->>'failureTotal')::int <> 20
    or r->>'historyScope' not like '%asset-level history%' then
    raise exception 'canonical component traversal failed: %',r;
  end if;
end $$;
\echo 'Focused material catalogue PostgreSQL assertions passed (not full migration/RLS qualification).'
