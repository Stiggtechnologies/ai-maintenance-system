-- ============================================================================
-- Organisation provisioning and reference-data cloning
-- (capability register E1.x tenancy; enables real operator data to live apart
-- from the public demo).
--
-- WHY THIS EXISTS NOW. Real operator data — 144 auxiliary-fleet assets and
-- 21,450 down events from an Alberta oil sands mine — was loaded into the DEMO
-- organisation. This repository is public and the demo passwords are committed
-- in it, so that put a named operator's unit-level downtime history, and its
-- parts-supplier delay performance, one published password away from anyone.
-- The data is worth keeping; the location was wrong.
--
-- Moving it needs somewhere to move it TO, and a new organisation starts empty
-- of ELEVEN org-scoped reference tables — mechanisms, techniques, the
-- detectability matrix, taxonomy, authority limits, retention policies,
-- standards, engineering rules, P-F intervals, material templates and agents.
-- A tenant without them is not a tenant, it is a shell where every governance
-- check silently finds nothing to check against.
--
-- ONE RULE IN THE CLONING, AND IT MATTERS: everything arrives as DRAFT.
-- Adoption is an act by an accountable person in a specific organisation.
-- Copying one tenant's adopted taxonomy, authority ceilings or P-F intervals
-- into another as ALREADY ADOPTED would manufacture governance nobody
-- performed — the same failure the platform refuses everywhere else, just
-- committed at provisioning time where it is harder to see.
--
-- Canonical reuse: every reference table as it stands. Additive.
-- ============================================================================

create or replace function public.provision_organization(
  p_name text,
  p_template_org uuid default '11111111-1111-1111-1111-111111111111'::uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  if coalesce(length(trim(p_name)), 0) < 3 then
    return jsonb_build_object('error', 'an organisation needs a name');
  end if;
  if exists (select 1 from organizations where name = trim(p_name)) then
    return jsonb_build_object('error', 'an organisation with that name already exists');
  end if;

  insert into organizations (name) values (trim(p_name)) returning id into v_new;

  -- Independent reference data first.
  insert into damage_mechanisms (organization_id, mechanism_key, name, description)
  select v_new, mechanism_key, name, description
  from damage_mechanisms where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('damage_mechanisms', v_n);

  insert into detection_techniques (organization_id, technique_key, name, description)
  select v_new, technique_key, name, description
  from detection_techniques where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('detection_techniques', v_n);

  -- Then the matrix, remapped through the keys rather than the ids.
  insert into mechanism_detectability (organization_id, mechanism_id, technique_id,
    detectability, typical_warning, basis)
  select v_new, nm.id, nt.id, d.detectability, d.typical_warning, d.basis
  from mechanism_detectability d
  join damage_mechanisms om on om.id = d.mechanism_id
  join detection_techniques ot on ot.id = d.technique_id
  join damage_mechanisms nm on nm.organization_id = v_new and nm.mechanism_key = om.mechanism_key
  join detection_techniques nt on nt.organization_id = v_new and nt.technique_key = ot.technique_key
  where d.organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mechanism_detectability', v_n);

  insert into system_group_candidates (organization_id, source_label, mechanism_id, basis)
  select v_new, c.source_label, nm.id, c.basis
  from system_group_candidates c
  join damage_mechanisms om on om.id = c.mechanism_id
  join damage_mechanisms nm on nm.organization_id = v_new and nm.mechanism_key = om.mechanism_key
  where c.organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('system_group_candidates', v_n);

  -- Governance reference data, all reset to DRAFT. See the header: one
  -- tenant's adoption is not another's.
  insert into taxonomy_definitions (organization_id, def_key, title, definition, basis, register_ref, status, version)
  select v_new, def_key, title, definition, basis, register_ref, 'draft', 1
  from taxonomy_definitions where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('taxonomy_definitions', v_n);

  insert into authority_limits (organization_id, role_key, tier_label, max_commitment_usd,
    max_risk_level, max_production_downtime_hours, escalates_to_role, basis, status)
  select v_new, role_key, tier_label, max_commitment_usd, max_risk_level,
         max_production_downtime_hours, escalates_to_role, basis, 'draft'
  from authority_limits where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('authority_limits', v_n);

  insert into retention_policies (organization_id, record_class, table_name, timestamp_column,
    retain_years, basis, status)
  select v_new, record_class, table_name, timestamp_column, retain_years, basis, 'draft'
  from retention_policies where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('retention_policies', v_n);

  insert into governance_standards (organization_id, standard_key, title, requirement,
    mandatory, owner_role, variance_approver_role, basis, status, version)
  select v_new, standard_key, title, requirement, mandatory, owner_role,
         variance_approver_role, basis, 'draft', 1
  from governance_standards where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('governance_standards', v_n);

  insert into engineering_approval_rules (organization_id, change_class, title, required_role, basis, status)
  select v_new, change_class, title, required_role, basis, 'draft'
  from engineering_approval_rules where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('engineering_approval_rules', v_n);

  insert into pf_intervals (organization_id, asset_class, failure_mode, detection_technique,
    pf_interval_days, basis, status)
  select v_new, asset_class, failure_mode, detection_technique, pf_interval_days, basis, 'draft'
  from pf_intervals where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pf_intervals', v_n);

  -- Template materials only. Another tenant's real catalogue is their data.
  insert into materials (organization_id, material_code, description, category,
    unit_of_measure, lead_time_days, repairable, criticality, is_template, basis)
  select v_new, material_code, description, category, unit_of_measure, lead_time_days,
         repairable, criticality, true, basis
  from materials where organization_id = p_template_org and is_template;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('materials_templates', v_n);

  insert into ai_agents (organization_id, key, name, category, status, autonomy_mode)
  select v_new, key, name, category, 'active', autonomy_mode
  from ai_agents where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ai_agents', v_n);

  return jsonb_build_object('organization_id', v_new, 'name', trim(p_name),
    'cloned', v_counts,
    'note', 'All governance reference data arrives as DRAFT. Adoption is an act by an accountable person in THIS organisation; inheriting another tenant''s adoptions would manufacture governance nobody performed.');
end
$$;

revoke execute on function public.provision_organization(text, uuid) from public, anon;
grant execute on function public.provision_organization(text, uuid) to service_role;

notify pgrst, 'reload schema';
