-- ============================================================================
-- U1.02 — universal asset objectives inside the canonical mission model.
--
-- No parallel strategy or scorecard is introduced. Every organization-owned
-- mission/outcome model now carries the same four manufacturer-neutral lenses:
-- safety, reliability, resilience and lifecycle economics. They are principles
-- for framing decisions, not claims that an outcome has been achieved and not
-- permission to operate, spend, accept risk or trade mandatory duties for value.
-- ============================================================================

create or replace function public.universal_mission_asset_objectives()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'dimension', 'safety',
      'name', 'Safe assets',
      'objective', 'Prevent asset-related harm to people, communities and the environment within approved obligations and operating limits.',
      'evidenceRequirements', jsonb_build_array(
        'approved safety, environmental and regulatory obligations',
        'hazard, event, control-performance and assurance evidence'
      ),
      'decisionBoundary', 'Mandatory safety, environmental and regulatory duties cannot be traded for financial benefit.'
    ),
    jsonb_build_object(
      'dimension', 'reliability',
      'name', 'Reliable assets',
      'objective', 'Deliver the required asset function when needed at the service level adopted by the organization.',
      'evidenceRequirements', jsonb_build_array(
        'approved functional and service requirements',
        'failure, condition, work and performance evidence with stated exposure'
      ),
      'decisionBoundary', 'No reliability target, interval or achieved performance is inferred without approved requirements and measured evidence.'
    ),
    jsonb_build_object(
      'dimension', 'resilience',
      'name', 'Resilient assets',
      'objective', 'Anticipate, absorb, recover from and adapt to disruption while preserving the mission services that matter most.',
      'evidenceRequirements', jsonb_build_array(
        'verified dependencies, common causes and service consequences',
        'tested continuity, response, restoration and learning evidence'
      ),
      'decisionBoundary', 'Redundancy and recoverability remain unproven until dependencies, common causes and restoration performance are verified.'
    ),
    jsonb_build_object(
      'dimension', 'economics',
      'name', 'Economically responsible assets',
      'objective', 'Improve lifecycle value and stewardship across cost, risk, performance and resource use after mandatory obligations are satisfied.',
      'evidenceRequirements', jsonb_build_array(
        'stated cost, value, risk, performance and lifecycle assumptions',
        'currency, time horizon, uncertainty and realized-benefit evidence'
      ),
      'decisionBoundary', 'Economic optimization cannot override mandatory safety, environmental, regulatory or human-approval constraints.'
    )
  );
$$;

create or replace function public.valid_universal_mission_asset_objectives(p_value jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(p_value) is distinct from 'array' then false
    else jsonb_array_length(p_value) = 4
      and p_value @> '[{"dimension":"safety"},{"dimension":"reliability"},{"dimension":"resilience"},{"dimension":"economics"}]'::jsonb
      and not exists (
        select 1
        from jsonb_array_elements(p_value) item
        where item->>'dimension' not in ('safety','reliability','resilience','economics')
          or length(btrim(coalesce(item->>'name',''))) < 3
          or length(btrim(coalesce(item->>'objective',''))) < 20
          or jsonb_typeof(item->'evidenceRequirements') is distinct from 'array'
          or case when jsonb_typeof(item->'evidenceRequirements') = 'array'
            then jsonb_array_length(item->'evidenceRequirements') else 0 end = 0
          or length(btrim(coalesce(item->>'decisionBoundary',''))) < 20
      )
  end;
$$;

revoke all on function public.universal_mission_asset_objectives()
  from public, anon, authenticated;
revoke all on function public.valid_universal_mission_asset_objectives(jsonb)
  from public, anon, authenticated;

alter table public.mission_outcome_model_templates
  add column if not exists asset_objectives jsonb not null
    default public.universal_mission_asset_objectives();
alter table public.organization_mission_outcome_models
  add column if not exists asset_objectives jsonb not null
    default public.universal_mission_asset_objectives();

update public.mission_outcome_model_templates
set asset_objectives = public.universal_mission_asset_objectives();

alter table public.mission_outcome_model_templates
  drop constraint if exists mission_outcome_templates_asset_objectives_check;
alter table public.mission_outcome_model_templates
  add constraint mission_outcome_templates_asset_objectives_check
  check (public.valid_universal_mission_asset_objectives(asset_objectives));

alter table public.organization_mission_outcome_models
  drop constraint if exists organization_mission_asset_objectives_check;
alter table public.organization_mission_outcome_models
  add constraint organization_mission_asset_objectives_check
  check (public.valid_universal_mission_asset_objectives(asset_objectives));

comment on column public.organization_mission_outcome_models.asset_objectives is
  'U1.02 universal safety, reliability, resilience and lifecycle-economics lenses adopted with the canonical mission model. They frame decisions but assert no achieved result and grant no execution or risk-acceptance authority.';

-- Preserve the existing governed author/adopt workflow; expose the new field
-- through the canonical workspace rather than a parallel reader.
create or replace function public.get_mission_outcome_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_templates jsonb;
  v_models jsonb;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'organizationType', organization_type,
    'title', title,
    'missionPattern', mission_pattern,
    'outcomes', outcomes,
    'measures', measures,
    'consequenceDimensions', consequence_dimensions,
    'evidenceRequirements', evidence_requirements,
    'assetObjectives', asset_objectives,
    'limitations', limitations,
    'version', version
  ) order by title), '[]'::jsonb)
  into v_templates
  from public.mission_outcome_model_templates
  where active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'organizationType', m.organization_type,
    'templateVersion', m.template_version,
    'title', m.title,
    'missionStatement', m.mission_statement,
    'outcomes', m.outcomes,
    'measures', m.measures,
    'consequenceDimensions', m.consequence_dimensions,
    'evidenceRequirements', m.evidence_requirements,
    'assetObjectives', m.asset_objectives,
    'evidenceBasis', m.evidence_basis,
    'applicabilityNotes', m.applicability_notes,
    'status', m.status,
    'version', m.version,
    'createdBy', cp.email,
    'createdAt', m.created_at,
    'approvalId', m.approval_id,
    'approvalStatus', a.status,
    'adoptedBy', ap.email,
    'adoptedAt', m.adopted_at,
    'decisionNote', m.decision_note,
    'isOwnDraft', m.created_by = auth.uid()
  ) order by m.version desc), '[]'::jsonb)
  into v_models
  from public.organization_mission_outcome_models m
  left join public.approvals a on a.id = m.approval_id
  left join public.user_profiles cp on cp.id = m.created_by
  left join public.user_profiles ap on ap.id = m.adopted_by
  where m.organization_id = v_org;

  return jsonb_build_object(
    'templates', v_templates,
    'models', v_models,
    'callerRole', public.app_current_role(),
    'canApprove', public.app_has_approval_authority()
      and public.app_current_role() <> 'ai_admin',
    'control', 'Only the latest independently adopted tenant model is effective. Its four asset objectives frame safety, reliability, resilience and lifecycle economics without inventing targets, claiming outcomes or granting work, operating, spending or risk-acceptance authority.'
  );
end
$$;

create or replace function public.resolve_mission_outcome_model()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  m public.organization_mission_outcome_models%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','forbidden');
  end if;

  select * into m
  from public.organization_mission_outcome_models
  where organization_id = v_org and status = 'adopted'
  order by version desc
  limit 1;

  if m.id is null then
    return jsonb_build_object('error',
      'No organization-owned mission/outcome model has been adopted. Template defaults are not authority.');
  end if;

  return jsonb_build_object(
    'modelId', m.id,
    'organizationType', m.organization_type,
    'version', m.version,
    'missionStatement', m.mission_statement,
    'outcomes', m.outcomes,
    'measures', m.measures,
    'consequenceDimensions', m.consequence_dimensions,
    'evidenceRequirements', m.evidence_requirements,
    'assetObjectives', m.asset_objectives,
    'evidenceBasis', m.evidence_basis,
    'applicabilityNotes', m.applicability_notes,
    'adoptedBy', m.adopted_by,
    'adoptedAt', m.adopted_at,
    'authority', 'Use the four asset objectives for consequence and value framing only. Separate governed evidence and human authority are required for targets, performance claims, work, operation, spending and risk acceptance.'
  );
end
$$;

revoke all on function public.get_mission_outcome_workspace()
  from public, anon, service_role;
grant execute on function public.get_mission_outcome_workspace()
  to authenticated;
revoke all on function public.resolve_mission_outcome_model()
  from public, anon, service_role;
grant execute on function public.resolve_mission_outcome_model()
  to authenticated;

notify pgrst, 'reload schema';
