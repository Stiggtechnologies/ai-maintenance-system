-- System topology vocabulary for the canonical engineering graph.
--
-- Extends public.engineering_knowledge_relationships (no new table, no
-- parallel model) so facility system reference models can be stored as
-- canonical edges:
--   entities:  system, subsystem, equipment_unit, function, functional_failure,
--              redundancy_group
--   relations: performs, has_functional_failure, causes, modelled_by,
--              member_of, provides_redundancy_for, supplies_power_to, cools,
--              rejects_heat_to, backs_up, depends_on, protects, controls,
--              monitors, supplies_fuel_to, supplies_water_to, houses
--
-- Additive only: every previously allowed value stays allowed. Rows remain
-- draft through the existing steward-only insert path; an edge grants no
-- permission, work release, approval, or redundancy rating. Redundancy schemes
-- are not stored here; sites declare them separately under named approval.

-- Postgres names inline column checks <table>_<column>_check; the table was
-- created with inline checks, so these are the constraints being widened.
alter table public.engineering_knowledge_relationships
  drop constraint if exists engineering_knowledge_relationships_relationship_type_check;
alter table public.engineering_knowledge_relationships
  drop constraint if exists engineering_knowledge_relationships_from_entity_type_check;
alter table public.engineering_knowledge_relationships
  drop constraint if exists engineering_knowledge_relationships_to_entity_type_check;

alter table public.engineering_knowledge_relationships
  add constraint engineering_knowledge_relationships_relationship_type_check
  check (relationship_type in (
    'contains', 'composed_of', 'may_fail_by', 'governed_by', 'detected_by', 'verified_by',
    'explained_by', 'supported_by', 'contradicted_by', 'applies_to', 'observed_on',
    'resulted_in', 'resolved_by', 'similar_to', 'supersedes',
    'performs', 'has_functional_failure', 'causes', 'modelled_by', 'member_of',
    'provides_redundancy_for', 'supplies_power_to', 'cools', 'rejects_heat_to',
    'backs_up', 'depends_on', 'protects', 'controls', 'monitors',
    'supplies_fuel_to', 'supplies_water_to', 'houses'
  ));

alter table public.engineering_knowledge_relationships
  add constraint engineering_knowledge_relationships_from_entity_type_check
  check (from_entity_type in (
    'asset_class', 'asset_twin', 'component', 'shared_component', 'failure_mode',
    'physics_capability', 'inspection_method', 'sensor', 'evidence', 'document',
    'procedure', 'standard', 'work_order', 'root_cause_analysis', 'recommendation',
    'risk', 'verified_case',
    'system', 'subsystem', 'equipment_unit', 'function', 'functional_failure',
    'redundancy_group'
  ));

alter table public.engineering_knowledge_relationships
  add constraint engineering_knowledge_relationships_to_entity_type_check
  check (to_entity_type in (
    'asset_class', 'asset_twin', 'component', 'shared_component', 'failure_mode',
    'physics_capability', 'inspection_method', 'sensor', 'evidence', 'document',
    'procedure', 'standard', 'work_order', 'root_cause_analysis', 'recommendation',
    'risk', 'verified_case',
    'system', 'subsystem', 'equipment_unit', 'function', 'functional_failure',
    'redundancy_group'
  ));

comment on constraint engineering_knowledge_relationships_relationship_type_check
  on public.engineering_knowledge_relationships is
  'Includes system topology relations. A supply, cooling or backup edge describes design intent only; it is not a verified redundancy rating and grants no authority.';
