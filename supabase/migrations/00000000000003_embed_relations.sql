-- ============================================================================
-- FK-embedded relations required by PostgREST resource embedding
-- (OEE production lines/loss categories, research variants, template packs).
-- ============================================================================

-- ---- OEE relations -----------------------------------------------------------
create table if not exists production_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  code text,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists oee_loss_categories (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null
);

alter table oee_measurements
  drop constraint if exists oee_measurements_production_line_id_fkey;
alter table oee_measurements
  add constraint oee_measurements_production_line_id_fkey
  foreign key (production_line_id) references production_lines(id);

alter table oee_loss_events add column if not exists category_id uuid references oee_loss_categories(id);
alter table oee_loss_events add column if not exists asset_id uuid references assets(id);

-- ---- Research variants ---------------------------------------------------------
create table if not exists research_variants (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references research_programs(id) on delete cascade,
  variant_code text,
  description text,
  status text default 'active',
  change_payload jsonb default '{}',
  created_at timestamptz not null default now()
);

alter table research_runs
  drop constraint if exists research_runs_variant_id_fkey;
alter table research_runs
  add constraint research_runs_variant_id_fkey
  foreign key (variant_id) references research_variants(id);

alter table promotion_candidates
  drop constraint if exists promotion_candidates_variant_id_fkey;
alter table promotion_candidates
  add constraint promotion_candidates_variant_id_fkey
  foreign key (variant_id) references research_variants(id);

-- ---- Deployment template pack relations ------------------------------------------
create table if not exists kpi_packs (
  id uuid primary key default gen_random_uuid(),
  pack_name text,
  kpi_count int default 0
);
create table if not exists industry_asset_libraries (
  id uuid primary key default gen_random_uuid(),
  library_name text,
  asset_class_count int default 0
);
create table if not exists industry_criticality_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_name text
);
create table if not exists industry_governance_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_name text,
  default_autonomy_mode text default 'advisory'
);
create table if not exists industry_failure_mode_packs (
  id uuid primary key default gen_random_uuid(),
  pack_name text,
  failure_mode_count int default 0
);
create table if not exists industry_oee_models (
  id uuid primary key default gen_random_uuid(),
  model_name text
);

alter table deployment_templates add column if not exists template_type text default 'derived';
alter table deployment_templates add column if not exists kpi_pack_id uuid references kpi_packs(id);
alter table deployment_templates add column if not exists asset_library_id uuid references industry_asset_libraries(id);
alter table deployment_templates add column if not exists criticality_profile_id uuid references industry_criticality_profiles(id);
alter table deployment_templates add column if not exists governance_profile_id uuid references industry_governance_profiles(id);
alter table deployment_templates add column if not exists failure_mode_pack_id uuid references industry_failure_mode_packs(id);
alter table deployment_templates add column if not exists oee_model_id uuid references industry_oee_models(id);

-- ---- RLS ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'production_lines','oee_loss_categories','research_variants','kpi_packs',
    'industry_asset_libraries','industry_criticality_profiles','industry_governance_profiles',
    'industry_failure_mode_packs','industry_oee_models'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_authed_rw', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_authed_rw', t);
  end loop;
end $$;
