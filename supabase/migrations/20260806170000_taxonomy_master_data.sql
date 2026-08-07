-- ============================================================================
-- Enterprise failure taxonomy as versioned, governed master data
-- (capability register C3.01–C3.12).
--
-- Spec §3: "A large maintenance organization cannot be run reliably when
-- every site describes failures differently… This master-data layer is more
-- important than adding another predictive model."
--
-- Governance model: definitions are DRAFTS until an accountable human adopts
-- them (adopter recorded). Revisions create a new version as draft; adoption
-- supersedes the prior version — approved truth is never silently rewritten.
-- Seed drafts state their conceptual basis (ISO 14224 / MIL-HDBK-338B FRACAS
-- practice and the enterprise-OS specification); no OEM or site-specific
-- values are invented.
-- ============================================================================

create table if not exists taxonomy_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  def_key text not null,
  title text not null,
  definition text not null,
  basis text,                       -- conceptual source stated, never implied
  register_ref text not null,
  version int not null default 1,
  status text not null default 'draft'
    check (status in ('draft', 'adopted', 'superseded')),
  adopted_at timestamptz,
  adopted_by uuid,
  superseded_by uuid references taxonomy_definitions(id),
  created_at timestamptz not null default now(),
  unique (organization_id, def_key, version)
);

create index if not exists idx_taxonomy_org_key on taxonomy_definitions(organization_id, def_key, status);

alter table taxonomy_definitions enable row level security;

drop policy if exists taxonomy_definitions_org on taxonomy_definitions;
create policy taxonomy_definitions_org on taxonomy_definitions
  for select to authenticated
  using (organization_id = app_current_org());
-- writes only through the governed RPCs below

-- ----------------------------------------------------------------------------
-- Adoption: an accountable human makes a draft the governed definition.
-- ----------------------------------------------------------------------------
create or replace function public.adopt_taxonomy_definition(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d taxonomy_definitions%rowtype;
  v_role text;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('admin', 'ai_admin', 'reliability_engineer', 'maintenance_manager') then
    return jsonb_build_object('error', 'adoption requires an accountable role');
  end if;

  select * into d from taxonomy_definitions
  where id = p_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'definition not found');
  end if;
  if d.status <> 'draft' then
    return jsonb_build_object('error', 'only drafts can be adopted');
  end if;

  -- supersede any currently adopted version of the same key
  update taxonomy_definitions
  set status = 'superseded', superseded_by = d.id
  where organization_id = d.organization_id and def_key = d.def_key
    and status = 'adopted';

  update taxonomy_definitions
  set status = 'adopted', adopted_at = now(), adopted_by = auth.uid()
  where id = d.id;

  return jsonb_build_object('ok', true, 'adopted', d.def_key, 'version', d.version);
end
$$;

grant execute on function public.adopt_taxonomy_definition(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Revision proposal: creates the next version as a draft (never edits truth).
-- ----------------------------------------------------------------------------
create or replace function public.propose_taxonomy_revision(
  p_def_key text,
  p_definition text,
  p_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur taxonomy_definitions%rowtype;
  v_id uuid;
begin
  select * into cur from taxonomy_definitions
  where organization_id = app_current_org() and def_key = p_def_key
  order by version desc limit 1;
  if not found then
    return jsonb_build_object('error', 'unknown definition key');
  end if;
  if p_definition is null or length(trim(p_definition)) < 20 then
    return jsonb_build_object('error', 'a substantive definition text is required');
  end if;

  insert into taxonomy_definitions (organization_id, def_key, title, definition,
    basis, register_ref, version, status)
  values (cur.organization_id, cur.def_key, cur.title, p_definition,
    coalesce(p_basis, 'Proposed revision — basis to be stated on adoption'),
    cur.register_ref, cur.version + 1, 'draft')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'version', cur.version + 1);
end
$$;

grant execute on function public.propose_taxonomy_revision(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Seed the eleven spec definitions as v1 DRAFTS for every existing org.
-- Conceptual basis stated; adoption is a human act.
-- ----------------------------------------------------------------------------
insert into taxonomy_definitions (organization_id, def_key, title, definition, basis, register_ref)
select o.id, d.def_key, d.title, d.definition, d.basis, d.register_ref
from organizations o
cross join (values
  ('failure', 'What constitutes a failure',
   'An event in which an asset loses the ability to perform a required function to the stated standard. Recorded against the maintainable item at which the function is lost, coded with mechanism, mode and cause.',
   'ISO 14224 failure concept; DoD RAM Guide functional-failure framing', 'C3.01'),
  ('functional_vs_degraded', 'Functional failure versus degraded performance',
   'Functional failure: the required function is not delivered. Degraded performance: the function is delivered outside its performance standard but above total loss. Degraded states are recorded as potential failures and tracked; they do not enter failure-rate calculations unless the standard defines them as failures.',
   'RCM potential/functional failure distinction (SAE JA1011/12)', 'C3.02'),
  ('equipment_boundary', 'Equipment boundary',
   'The boundary of each equipment class defines which components, instrumentation and connections belong to the asset for failure attribution, history and KPI purposes. Boundary drawings or lists are part of asset master data; events at shared interfaces are attributed per the boundary rule, never duplicated.',
   'ISO 14224 boundary concept', 'C3.03'),
  ('downtime_start_end', 'Downtime start and end',
   'Downtime starts when the asset ceases to deliver its required function (or is removed from service), and ends when it is returned to service and accepted by operations. Waiting time (materials, labor, permits) is recorded within downtime as distinct components; standby without demand is not downtime.',
   'MIL-HDBK-338B maintainability/restoration-time components', 'C3.04'),
  ('maintenance_induced', 'Maintenance-induced failure',
   'A failure whose dominant cause originates in a preceding maintenance intervention (workmanship, reassembly, foreign material, incorrect parts or settings) within a defined post-maintenance exposure window. Coded distinctly so that maintenance quality is measurable.',
   'FRACAS cause-coding practice (MIL-HDBK-338B)', 'C3.05'),
  ('repeat_failure', 'Repeat failure',
   'A failure of the same maintainable item with the same failure mode within a defined window after the previous corrective action. Repeat failures indicate ineffective corrective action and are surfaced automatically for causal review.',
   'FRACAS recurrence tracking; enterprise-OS spec §4', 'C3.06'),
  ('emergency_work', 'Emergency work',
   'Work that must start immediately to control an active safety, environmental or major production consequence, bypassing normal planning and scheduling. Coded distinctly; its share of total work is a primary work-management health indicator.',
   'Maintenance work-management practice; enterprise-OS spec §6', 'C3.07'),
  ('deferral_risk', 'Deferral risk',
   'The documented risk accepted when planned work is postponed: the credible consequence, its likelihood over the deferral period, and the authority accepting it. Deferral of safety-critical work always requires the designated approval authority.',
   'Enterprise-OS spec §5 decision rights', 'C3.08'),
  ('mechanism_mode_cause_consequence', 'Failure mechanism, mode, cause and consequence',
   'Mechanism: the physical, chemical or human process producing damage. Mode: the observable manner of failure. Cause: the antecedent condition or event initiating the mechanism. Consequence: the safety, environmental, production and cost effect. All four are coded on every failure record from controlled code lists.',
   'ISO 14224 / FRACAS coding structure', 'C3.09'),
  ('loss_attribution', 'Production loss attribution',
   'Production losses are attributed to the causal asset and category (equipment failure, operations, external, planned) using one site-wide rule set, so that equipment-attributable loss is computed identically across sites and periods.',
   'Enterprise-OS spec §3/§6', 'C3.10'),
  ('criticality_dimensions', 'Safety-, environmental- and business-critical assets',
   'Asset criticality is assessed on three explicit dimensions — safety, environmental and business consequence of failure — each on its own scale. An asset is safety-critical if its failure can directly cause a defined safety consequence; classifications drive analysis depth, PM rigor and decision-rights routing.',
   'Criticality practice per DoD RAM Guide / enterprise-OS spec', 'C3.11')
) as d(def_key, title, definition, basis, register_ref)
on conflict (organization_id, def_key, version) do nothing;
