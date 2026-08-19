-- Governed, versioned asset twin registry and customer instantiation records.

create table if not exists asset_twin_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version text not null,
  asset_family text not null,
  asset_class text not null,
  title text not null,
  description text,
  maturity text not null default 'draft' check (maturity in ('draft','ai_extracted','engineer_reviewed','field_validated','approved')),
  schema_version int not null default 1,
  template jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  supersedes_id uuid references asset_twin_templates(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(template_key, version)
);

create table if not exists asset_twin_model_overlays (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references asset_twin_templates(id) on delete cascade,
  manufacturer text not null,
  model text not null,
  version text not null,
  maturity text not null default 'draft' check (maturity in ('draft','ai_extracted','engineer_reviewed','field_validated','approved')),
  overlay jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(template_id, manufacturer, model, version)
);

create table if not exists asset_twin_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  asset_id uuid not null references assets(id) on delete cascade,
  template_id uuid not null references asset_twin_templates(id),
  overlay_id uuid references asset_twin_model_overlays(id),
  compiled_version text not null,
  compiled_twin jsonb not null,
  customer_overrides jsonb not null default '{}'::jsonb,
  compilation_log jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','review','active','retired')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(asset_id, compiled_version)
);

create index if not exists asset_twin_templates_class_idx on asset_twin_templates(asset_class, maturity);
create index if not exists asset_twin_instances_org_idx on asset_twin_instances(organization_id, asset_id);

alter table asset_twin_templates enable row level security;
alter table asset_twin_model_overlays enable row level security;
alter table asset_twin_instances enable row level security;

-- Drop guards so the chain can be applied more than once; without them a
-- replay aborts on the first of these three.
drop policy if exists asset_twin_templates_read on asset_twin_templates;
create policy asset_twin_templates_read on asset_twin_templates
  for select to authenticated using (true);
drop policy if exists asset_twin_model_overlays_read on asset_twin_model_overlays;
create policy asset_twin_model_overlays_read on asset_twin_model_overlays
  for select to authenticated using (true);
drop policy if exists asset_twin_instances_org_rw on asset_twin_instances;
create policy asset_twin_instances_org_rw on asset_twin_instances
  for all to authenticated
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());

create or replace function compile_asset_twin(
  p_asset_id uuid,
  p_template_id uuid,
  p_overlay_id uuid default null,
  p_customer_overrides jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_template asset_twin_templates%rowtype;
  v_overlay asset_twin_model_overlays%rowtype;
  v_compiled jsonb;
  v_version text;
  v_id uuid;
begin
  select organization_id into v_org from assets where id = p_asset_id;
  if v_org is null or v_org <> app_current_org() then
    raise exception 'asset not found in current organization';
  end if;

  select * into v_template from asset_twin_templates where id = p_template_id;
  if not found then raise exception 'template not found'; end if;

  if p_overlay_id is not null then
    select * into v_overlay from asset_twin_model_overlays
      where id = p_overlay_id and template_id = p_template_id;
    if not found then raise exception 'overlay does not belong to template'; end if;
  end if;

  v_compiled := v_template.template
    || coalesce(v_overlay.overlay, '{}'::jsonb)
    || coalesce(p_customer_overrides, '{}'::jsonb);
  v_version := v_template.version || coalesce('+' || v_overlay.version, '') || '+customer';

  insert into asset_twin_instances(
    organization_id, asset_id, template_id, overlay_id, compiled_version,
    compiled_twin, customer_overrides, compilation_log
  ) values (
    v_org, p_asset_id, p_template_id, p_overlay_id, v_version,
    v_compiled, coalesce(p_customer_overrides, '{}'::jsonb),
    jsonb_build_array(jsonb_build_object(
      'compiled_at', now(),
      'template_version', v_template.version,
      'overlay_version', v_overlay.version,
      'actor', auth.uid()
    ))
  )
  on conflict (asset_id, compiled_version) do update
    set compiled_twin = excluded.compiled_twin,
        customer_overrides = excluded.customer_overrides,
        compilation_log = asset_twin_instances.compilation_log || excluded.compilation_log,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function compile_asset_twin(uuid,uuid,uuid,jsonb) from public;
grant execute on function compile_asset_twin(uuid,uuid,uuid,jsonb) to authenticated;
