-- ============================================================================
-- Sync Recovery full close-out — explicit SECURITY DEFINER execution boundary
--
-- Postgres grants EXECUTE on newly-created functions to PUBLIC by default.
-- The preceding close-out migrations intentionally revoke/grant their browser
-- RPC surface, but several grants are expressed through dynamic SQL loops.
-- The repository security ratchet deliberately requires literal revokes so the
-- boundary is statically auditable and cannot become anonymous by accident.
--
-- This migration is intentionally repetitive. Do not collapse these statements
-- into dynamic SQL: the literal names are part of the security proof.
-- ============================================================================

-- CONTROL + LEARN: authenticated, tenant/role-gated RPCs.
revoke all on function public.register_operational_constraint_signal(text,text,text,timestamptz,timestamptz,text,text,uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.register_operational_constraint_signal(text,text,text,timestamptz,timestamptz,text,text,uuid,uuid,text,jsonb) to authenticated;

revoke all on function public.set_restoration_resource_requirement(uuid,uuid,text,text,text,boolean,text) from public, anon;
grant execute on function public.set_restoration_resource_requirement(uuid,uuid,text,text,text,boolean,text) to authenticated;

revoke all on function public.set_job_plan_energy_requirement(uuid,text,text,text) from public, anon;
grant execute on function public.set_job_plan_energy_requirement(uuid,text,text,text) to authenticated;

revoke all on function public.record_asset_energy_state(uuid,text,text,text,text,timestamptz,text) from public, anon;
grant execute on function public.record_asset_energy_state(uuid,text,text,text,text,timestamptz,text) to authenticated;

revoke all on function public.set_restoration_work_zone(uuid,text,text,text) from public, anon;
grant execute on function public.set_restoration_work_zone(uuid,text,text,text) to authenticated;

revoke all on function public.set_work_zone_relationship(uuid,text,text,boolean,text,text) from public, anon;
grant execute on function public.set_work_zone_relationship(uuid,text,text,boolean,text,text) to authenticated;

revoke all on function public.refresh_restoration_readiness(uuid) from public, anon;
grant execute on function public.refresh_restoration_readiness(uuid) to authenticated;

revoke all on function public.set_recovery_consequence(uuid,int,int,int,int,text) from public, anon;
grant execute on function public.set_recovery_consequence(uuid,int,int,int,int,text) to authenticated;

revoke all on function public.record_recovery_recommendation_feedback(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.record_recovery_recommendation_feedback(uuid,text,text,text,text,text) to authenticated;

revoke all on function public.refresh_recovery_recurrence_candidates(uuid,int) from public, anon;
grant execute on function public.refresh_recovery_recurrence_candidates(uuid,int) to authenticated;

revoke all on function public.classify_recovery_recurrence(uuid,text,text) from public, anon;
grant execute on function public.classify_recovery_recurrence(uuid,text,text) to authenticated;

revoke all on function public.get_recovery_ftr_metrics(int) from public, anon;
grant execute on function public.get_recovery_ftr_metrics(int) to authenticated;

revoke all on function public.add_recovery_field_evidence(uuid,uuid,text,text,uuid,jsonb,text) from public, anon;
grant execute on function public.add_recovery_field_evidence(uuid,uuid,text,text,uuid,jsonb,text) to authenticated;

revoke all on function public.set_recovery_economic_assumptions(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon;
grant execute on function public.set_recovery_economic_assumptions(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;

revoke all on function public.get_recovery_economics(uuid) from public, anon;
grant execute on function public.get_recovery_economics(uuid) to authenticated;

revoke all on function public.record_recovery_delay_attribution(uuid,text,numeric,text,text) from public, anon;
grant execute on function public.record_recovery_delay_attribution(uuid,text,numeric,text,text) to authenticated;

revoke all on function public.get_recovery_counterfactual_attribution(uuid) from public, anon;
grant execute on function public.get_recovery_counterfactual_attribution(uuid) to authenticated;

revoke all on function public.get_recovery_decision_queue() from public, anon;
grant execute on function public.get_recovery_decision_queue() to authenticated;

revoke all on function public.get_recovery_handoff(uuid) from public, anon;
grant execute on function public.get_recovery_handoff(uuid) to authenticated;

revoke all on function public.publish_recovery_cadence_snapshot(text,uuid) from public, anon;
grant execute on function public.publish_recovery_cadence_snapshot(text,uuid) to authenticated;

-- Trigger helper is not an RPC surface. Keep it owner-only. The trigger itself
-- remains the execution path for the energy-state gate.
revoke all on function public.enforce_recovery_energy_state() from public, anon, authenticated;

-- Escalation is a platform clock, not a tenant browser RPC.
revoke all on function public.run_recovery_escalation_clock() from public, anon, authenticated;
grant execute on function public.run_recovery_escalation_clock() to service_role;

-- OPTIMIZE: authenticated, tenant/role-gated RPCs.
revoke all on function public.record_asset_meter_reading(uuid,numeric,timestamptz,text,text,text,text) from public, anon;
grant execute on function public.record_asset_meter_reading(uuid,numeric,timestamptz,text,text,text,text) to authenticated;

revoke all on function public.record_component_installation(uuid,text,text,timestamptz,numeric,text,text,uuid,text,text) from public, anon;
grant execute on function public.record_component_installation(uuid,text,text,timestamptz,numeric,text,text,uuid,text,text) to authenticated;

revoke all on function public.record_component_removal(uuid,timestamptz,numeric,text) from public, anon;
grant execute on function public.record_component_removal(uuid,timestamptz,numeric,text) to authenticated;

revoke all on function public.upsert_material_stock_lot(uuid,uuid,text,numeric,text,text,text,text,text,uuid,text,timestamptz) from public, anon;
grant execute on function public.upsert_material_stock_lot(uuid,uuid,text,numeric,text,text,text,text,text,uuid,text,timestamptz) to authenticated;

revoke all on function public.set_material_substitution(uuid,uuid,text,text,text,timestamptz) from public, anon;
grant execute on function public.set_material_substitution(uuid,uuid,text,text,text,timestamptz) to authenticated;

revoke all on function public.get_recovery_component_life_context(uuid) from public, anon;
grant execute on function public.get_recovery_component_life_context(uuid) to authenticated;

revoke all on function public.get_recovery_parts_risk(uuid) from public, anon;
grant execute on function public.get_recovery_parts_risk(uuid) to authenticated;

revoke all on function public.get_recovery_cannibalization_options(uuid) from public, anon;
grant execute on function public.get_recovery_cannibalization_options(uuid) to authenticated;

revoke all on function public.propose_recovery_cannibalization(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.propose_recovery_cannibalization(uuid,uuid,uuid,text) to authenticated;

revoke all on function public.set_recovery_uncertainty_group(uuid,text,numeric,text) from public, anon;
grant execute on function public.set_recovery_uncertainty_group(uuid,text,numeric,text) to authenticated;

revoke all on function public.run_restoration_risk_simulation(uuid,int) from public, anon;
grant execute on function public.run_restoration_risk_simulation(uuid,int) to authenticated;

revoke all on function public.simulate_recovery_what_if(uuid,jsonb,text) from public, anon;
grant execute on function public.simulate_recovery_what_if(uuid,jsonb,text) to authenticated;

revoke all on function public.get_recovery_sequence_patterns(text,int) from public, anon;
grant execute on function public.get_recovery_sequence_patterns(text,int) to authenticated;

revoke all on function public.get_recovery_productivity_norms(uuid,int) from public, anon;
grant execute on function public.get_recovery_productivity_norms(uuid,int) to authenticated;

revoke all on function public.run_recovery_fleet_optimization(uuid) from public, anon;
grant execute on function public.run_recovery_fleet_optimization(uuid) to authenticated;

notify pgrst, 'reload schema';
