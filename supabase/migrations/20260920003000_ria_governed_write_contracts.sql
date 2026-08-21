-- ============================================================================
-- RIA governed write contracts — close the software-native commercial loop.
--
-- The assessment workspace deliberately denied browser writes to engineering
-- records. That is the right default, but it left the product unable to create
-- the records its own workspace renders. These RPCs are the narrow write paths:
--
--   accepted lead -> existing customer org -> one RIA assessment
--   assessment -> metric / criticality / finding+evidence / opportunity /
--                 decision / action / verification / phase transition
--
-- SECURITY MODEL
-- * Commercial activation is global sales administration. ai_admin may target
--   any existing organization. A tenant admin may only target their own org.
-- * Engineering authoring is NEVER cross-tenant: every object is resolved from
--   app_current_org(), and every referenced source/finding is re-checked against
--   the same assessment and organization before the definer write occurs.
-- * These functions do not bypass the governing triggers from 20260920000000;
--   they create draft/reviewable state and let those triggers remain the final
--   authority for publication, action execution and value-estimate integrity.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Commercial conversion provenance lives on the lead that originated it.
-- ---------------------------------------------------------------------------
alter table public.pilot_intake_requests
  add column if not exists ria_assessment_id uuid
    references public.ria_assessments(id) on delete set null;
alter table public.pilot_intake_requests
  add column if not exists activated_organization_id uuid
    references public.organizations(id) on delete set null;
alter table public.pilot_intake_requests
  add column if not exists activated_by uuid
    references public.user_profiles(id) on delete set null;
alter table public.pilot_intake_requests
  add column if not exists activated_at timestamptz;
alter table public.pilot_intake_requests
  add column if not exists activation_acceptance_reference text;

create index if not exists pilot_intake_requests_ria_assessment_idx
  on public.pilot_intake_requests (ria_assessment_id)
  where ria_assessment_id is not null;

-- Conversion state is all-or-none. This prevents a partial/manual update from
-- making the sales surface claim an activation that cannot be traced.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pilot_intake_ria_activation_is_complete'
  ) then
    alter table public.pilot_intake_requests
      add constraint pilot_intake_ria_activation_is_complete
      check (
        (ria_assessment_id is null
          and activated_organization_id is null
          and activated_by is null
          and activated_at is null
          and activation_acceptance_reference is null)
        or
        (ria_assessment_id is not null
          and activated_organization_id is not null
          and activated_by is not null
          and activated_at is not null
          and btrim(coalesce(activation_acceptance_reference, '')) <> '')
      );
  end if;
end $$;

create or replace function public.list_ria_activation_organizations()
returns table(id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_current_org uuid := public.app_current_org();
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role
  from public.user_profiles p
  where p.id = auth.uid();

  if v_role = 'ai_admin' then
    return query
      select o.id, o.name
      from public.organizations o
      order by o.name;
  elsif v_role = 'admin' and v_current_org is not null then
    return query
      select o.id, o.name
      from public.organizations o
      where o.id = v_current_org
      order by o.name;
  end if;

  raise exception 'RIA activation organization directory requires administrator authority'
    using errcode = 'insufficient_privilege';
end;
$$;

create or replace function public.activate_ria_from_intake(
  p_lead_id uuid,
  p_organization_id uuid,
  p_scope_label text,
  p_target_end_on date,
  p_acceptance_reference text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_current_org uuid := public.app_current_org();
  v_lead public.pilot_intake_requests%rowtype;
  v_assessment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role
  from public.user_profiles p
  where p.id = auth.uid();

  if v_role not in ('admin', 'ai_admin') then
    raise exception 'RIA activation requires administrator authority'
      using errcode = 'insufficient_privilege';
  end if;

  -- A tenant admin is powerful inside one tenant, not a platform-wide sales
  -- operator. Cross-tenant activation is restricted to ai_admin.
  if v_role = 'admin' and p_organization_id is distinct from v_current_org then
    raise exception 'Tenant administrators may activate an RIA only for their own organization'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Target organization does not exist' using errcode = 'foreign_key_violation';
  end if;

  if btrim(coalesce(p_scope_label, '')) = '' then
    raise exception 'A bounded assessment scope is required' using errcode = 'check_violation';
  end if;

  if btrim(coalesce(p_acceptance_reference, '')) = '' then
    raise exception 'A signed SOW, PO, invoice, or payment reference is required before activation'
      using errcode = 'check_violation';
  end if;

  select * into v_lead
  from public.pilot_intake_requests
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Pilot intake lead not found' using errcode = 'no_data_found';
  end if;

  if v_lead.ria_assessment_id is not null then
    if v_lead.activated_organization_id is distinct from p_organization_id then
      raise exception 'This lead is already activated for a different organization'
        using errcode = 'check_violation';
    end if;

    if exists (
      select 1 from public.ria_assessments a
      where a.id = v_lead.ria_assessment_id
        and a.organization_id = p_organization_id
    ) then
      return v_lead.ria_assessment_id;
    end if;

    raise exception 'Lead activation references an assessment that no longer exists in the target organization'
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.ria_assessments (
    organization_id,
    name,
    scope_label,
    status,
    commercial_model,
    tier,
    started_on,
    target_end_on,
    notes
  ) values (
    p_organization_id,
    'Reliability Intelligence Assessment',
    left(btrim(p_scope_label), 500),
    'active',
    'Standard - US$35,000 fixed fee',
    'standard_35k',
    current_date,
    p_target_end_on,
    'Activated from accepted public RIA intake lead ' || p_lead_id::text
  )
  returning id into v_assessment_id;

  update public.pilot_intake_requests
  set ria_assessment_id = v_assessment_id,
      activated_organization_id = p_organization_id,
      activated_by = auth.uid(),
      activated_at = now(),
      activation_acceptance_reference = left(btrim(p_acceptance_reference), 500),
      status = case when status = 'new' then 'accepted' else status end
  where id = p_lead_id;

  return v_assessment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Shared authoring guards. They are definer helpers and are deliberately
--    not executable by API roles directly.
-- ---------------------------------------------------------------------------
create or replace function public.ria_authoring_organization(p_assessment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_assessment_org uuid;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Authenticated organization context required'
      using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role
  from public.user_profiles p
  where p.id = auth.uid();

  if v_role not in ('reliability_engineer','maintenance_manager','admin','ai_admin') then
    raise exception 'RIA engineering authoring requires engineering, maintenance-manager, or administrator authority'
      using errcode = 'insufficient_privilege';
  end if;

  select a.organization_id into v_assessment_org
  from public.ria_assessments a
  where a.id = p_assessment_id;

  if v_assessment_org is null or v_assessment_org is distinct from v_org then
    raise exception 'Assessment not found in current organization'
      using errcode = 'insufficient_privilege';
  end if;

  return v_org;
end;
$$;

create or replace function public.ria_validate_source_ids(
  p_assessment_id uuid,
  p_organization_id uuid,
  p_source_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected integer := coalesce(array_length(p_source_ids, 1), 0);
  v_found integer := 0;
begin
  if v_expected = 0 then return; end if;

  select count(distinct s.id)::integer into v_found
  from public.ria_data_sources s
  where s.id = any(p_source_ids)
    and s.assessment_id = p_assessment_id
    and s.organization_id = p_organization_id
    and s.deleted_at is null;

  if v_found <> v_expected then
    raise exception 'One or more evidence sources are missing, retired, outside the assessment, or outside the current organization'
      using errcode = 'foreign_key_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Baseline metric. Support is a reviewed engineering judgement, so a human
--    caller is recorded whenever the metric is created/updated.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_ria_baseline_metric(
  p_assessment_id uuid,
  p_metric_key text,
  p_label text,
  p_value_text text,
  p_unit text,
  p_method text,
  p_population text,
  p_source_fields text[],
  p_exclusions text,
  p_evidence_grade text,
  p_evidence_source_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.ria_authoring_organization(p_assessment_id);
  v_id uuid;
begin
  if btrim(coalesce(p_metric_key, '')) = '' or btrim(coalesce(p_label, '')) = '' then
    raise exception 'Metric key and label are required' using errcode = 'check_violation';
  end if;

  if p_evidence_grade not in ('supported','partially_supported','unsupported') then
    raise exception 'Invalid evidence grade' using errcode = 'check_violation';
  end if;

  perform public.ria_validate_source_ids(
    p_assessment_id, v_org, coalesce(p_evidence_source_ids, '{}'::uuid[])
  );

  -- The governing constraint requires method/population/source fields before
  -- support can be claimed. Check explicitly so callers receive a useful error.
  if p_evidence_grade <> 'unsupported' and (
    btrim(coalesce(p_method, '')) = ''
    or btrim(coalesce(p_population, '')) = ''
    or coalesce(array_length(p_source_fields, 1), 0) = 0
  ) then
    raise exception 'Supported metrics require method, population, and source fields'
      using errcode = 'check_violation';
  end if;

  insert into public.ria_baseline_metrics (
    assessment_id, organization_id, metric_key, label, value_text, unit,
    method, population, source_fields, exclusions, evidence_grade,
    evidence_refs, reviewer_id, reviewed_at
  ) values (
    p_assessment_id, v_org, btrim(p_metric_key), btrim(p_label),
    nullif(btrim(coalesce(p_value_text,'')), ''),
    nullif(btrim(coalesce(p_unit,'')), ''),
    nullif(btrim(coalesce(p_method,'')), ''),
    nullif(btrim(coalesce(p_population,'')), ''),
    coalesce(p_source_fields, '{}'::text[]),
    nullif(btrim(coalesce(p_exclusions,'')), ''),
    p_evidence_grade,
    coalesce(p_evidence_source_ids, '{}'::uuid[]),
    auth.uid(), now()
  )
  on conflict (assessment_id, metric_key) do update set
    label = excluded.label,
    value_text = excluded.value_text,
    unit = excluded.unit,
    method = excluded.method,
    population = excluded.population,
    source_fields = excluded.source_fields,
    exclusions = excluded.exclusions,
    evidence_grade = excluded.evidence_grade,
    evidence_refs = excluded.evidence_refs,
    reviewer_id = auth.uid(),
    reviewed_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Draft criticality. Approval remains the existing guarded RPC.
-- ---------------------------------------------------------------------------
create or replace function public.create_ria_criticality_draft(
  p_assessment_id uuid,
  p_asset_ref text,
  p_asset_name text,
  p_criticality text,
  p_rationale text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.ria_authoring_organization(p_assessment_id);
  v_id uuid;
begin
  if btrim(coalesce(p_asset_name, '')) = '' or btrim(coalesce(p_rationale, '')) = '' then
    raise exception 'Asset name and criticality rationale are required'
      using errcode = 'check_violation';
  end if;
  if p_criticality not in ('critical','high','medium','low') then
    raise exception 'Invalid criticality' using errcode = 'check_violation';
  end if;

  insert into public.ria_criticality_items (
    assessment_id, organization_id, asset_ref, asset_name,
    criticality, rationale, review_state
  ) values (
    p_assessment_id, v_org,
    nullif(btrim(coalesce(p_asset_ref,'')), ''), btrim(p_asset_name),
    p_criticality, btrim(p_rationale), 'draft'
  ) returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Finding + evidence is one transaction. A finding is never returned to the
--    caller with half of its requested evidence links missing.
-- ---------------------------------------------------------------------------
create or replace function public.create_ria_finding_draft(
  p_assessment_id uuid,
  p_title text,
  p_statement text,
  p_severity text,
  p_confidence text,
  p_evidence_grade text,
  p_decision_boundary text,
  p_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.ria_authoring_organization(p_assessment_id);
  v_id uuid;
  v_item jsonb;
  v_source_id uuid;
begin
  if btrim(coalesce(p_title,'')) = ''
     or btrim(coalesce(p_statement,'')) = ''
     or btrim(coalesce(p_decision_boundary,'')) = '' then
    raise exception 'Finding title, statement, and decision boundary are required'
      using errcode = 'check_violation';
  end if;
  if p_severity not in ('critical','high','moderate','low') then
    raise exception 'Invalid finding severity' using errcode = 'check_violation';
  end if;
  if p_confidence not in ('high','medium','low') then
    raise exception 'Invalid finding confidence' using errcode = 'check_violation';
  end if;
  if p_evidence_grade not in ('supported','partially_supported','unsupported') then
    raise exception 'Invalid finding evidence grade' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array' then
    raise exception 'Finding evidence must be a JSON array' using errcode = 'check_violation';
  end if;

  insert into public.ria_findings (
    assessment_id, organization_id, title, statement, severity, confidence,
    evidence_grade, decision_boundary, review_state
  ) values (
    p_assessment_id, v_org, btrim(p_title), btrim(p_statement),
    p_severity, p_confidence, p_evidence_grade, btrim(p_decision_boundary), 'draft'
  ) returning id into v_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) loop
    begin
      v_source_id := nullif(v_item->>'data_source_id','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Finding evidence contains an invalid source identifier'
        using errcode = 'invalid_text_representation';
    end;

    if v_source_id is null or not exists (
      select 1 from public.ria_data_sources s
      where s.id = v_source_id
        and s.assessment_id = p_assessment_id
        and s.organization_id = v_org
        and s.deleted_at is null
    ) then
      raise exception 'Finding evidence source is not active in this assessment'
        using errcode = 'foreign_key_violation';
    end if;

    insert into public.ria_finding_evidence (
      organization_id, finding_id, data_source_id,
      record_reference, note, provenance, confidence, linked_by
    ) values (
      v_org, v_id, v_source_id,
      nullif(btrim(coalesce(v_item->>'record_reference','')), ''),
      nullif(btrim(coalesce(v_item->>'note','')), ''),
      nullif(btrim(coalesce(v_item->>'provenance','')), ''),
      case when v_item->>'confidence' in ('high','medium','low')
           then v_item->>'confidence' else 'medium' end,
      auth.uid()
    );
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Opportunity. The existing constraint is authoritative; this RPC gives a
--    clearer refusal before it gets there.
-- ---------------------------------------------------------------------------
create or replace function public.create_ria_opportunity_draft(
  p_assessment_id uuid,
  p_finding_id uuid,
  p_title text,
  p_priority text,
  p_rationale text,
  p_effort text,
  p_recommended_action text,
  p_owner text,
  p_value_low numeric,
  p_value_high numeric,
  p_value_currency text,
  p_method text,
  p_value_source text,
  p_assumptions text,
  p_confidence text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.ria_authoring_organization(p_assessment_id);
  v_id uuid;
begin
  if p_finding_id is not null and not exists (
    select 1 from public.ria_findings f
    where f.id = p_finding_id
      and f.assessment_id = p_assessment_id
      and f.organization_id = v_org
  ) then
    raise exception 'Opportunity finding is not in this assessment'
      using errcode = 'foreign_key_violation';
  end if;

  if btrim(coalesce(p_title,'')) = '' or btrim(coalesce(p_rationale,'')) = '' then
    raise exception 'Opportunity title and rationale are required'
      using errcode = 'check_violation';
  end if;
  if p_priority not in ('critical','high','medium','low') then
    raise exception 'Invalid opportunity priority' using errcode = 'check_violation';
  end if;
  if p_effort is not null and p_effort not in ('low','medium','high') then
    raise exception 'Invalid opportunity effort' using errcode = 'check_violation';
  end if;
  if p_confidence not in ('high','medium','low') then
    raise exception 'Invalid opportunity confidence' using errcode = 'check_violation';
  end if;

  if p_value_low is distinct from null or p_value_high is distinct from null then
    if p_value_low is null or p_value_high is null or p_value_low > p_value_high
       or btrim(coalesce(p_method,'')) = ''
       or btrim(coalesce(p_value_source,'')) = ''
       or btrim(coalesce(p_assumptions,'')) = '' then
      raise exception 'A quantified opportunity requires an ordered range, method, source, and assumptions'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.ria_opportunities (
    assessment_id, organization_id, finding_id, title, priority, rationale,
    effort, recommended_action, owner, value_low, value_high, value_currency,
    method, value_source, assumptions, confidence, status
  ) values (
    p_assessment_id, v_org, p_finding_id, btrim(p_title), p_priority,
    btrim(p_rationale), p_effort,
    nullif(btrim(coalesce(p_recommended_action,'')), ''),
    nullif(btrim(coalesce(p_owner,'')), ''),
    p_value_low, p_value_high,
    coalesce(nullif(btrim(coalesce(p_value_currency,'')), ''), 'USD'),
    nullif(btrim(coalesce(p_method,'')), ''),
    nullif(btrim(coalesce(p_value_source,'')), ''),
    nullif(btrim(coalesce(p_assumptions,'')), ''),
    p_confidence, 'candidate'
  ) returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Decision and action drafts. Authority and boundary are mandatory even at
--    draft time so downstream work cannot inherit an ungoverned object.
-- ---------------------------------------------------------------------------
create or replace function public.create_ria_decision_draft(
  p_assessment_id uuid,
  p_finding_id uuid,
  p_decision_required text,
  p_recommendation text,
  p_evidence_summary text,
  p_uncertainty text,
  p_authority_role text,
  p_boundary text,
  p_verification text,
  p_due_on date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.ria_authoring_organization(p_assessment_id);
  v_id uuid;
begin
  if p_finding_id is not null and not exists (
    select 1 from public.ria_findings f
    where f.id = p_finding_id
      and f.assessment_id = p_assessment_id
      and f.organization_id = v_org
  ) then
    raise exception 'Decision finding is not in this assessment'
      using errcode = 'foreign_key_violation';
  end if;

  if btrim(coalesce(p_decision_required,'')) = ''
     or btrim(coalesce(p_recommendation,'')) = ''
     or btrim(coalesce(p_evidence_summary,'')) = ''
     or btrim(coalesce(p_authority_role,'')) = ''
     or btrim(coalesce(p_boundary,'')) = ''
     or btrim(coalesce(p_verification,'')) = '' then
    raise exception 'Decision, recommendation, evidence, authority, boundary, and verification are required'
      using errcode = 'check_violation';
  end if;

  insert into public.ria_decisions (
    assessment_id, organization_id, finding_id, decision_required,
    recommendation, evidence_summary, uncertainty, authority_role,
    boundary, verification, due_on, status
  ) values (
    p_assessment_id, v_org, p_finding_id, btrim(p_decision_required),
    btrim(p_recommendation), btrim(p_evidence_summary),
    nullif(btrim(coalesce(p_uncertainty,'')), ''), btrim(p_authority_role),
    btrim(p_boundary), btrim(p_verification), p_due_on, 'pending'
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.create_ria_action_draft(
  p_assessment_id uuid,
  p_finding_id uuid,
  p_horizon text,
  p_action text,
  p_owner text,
  p_due_on date,
  p_verification_metric text,
  p_authority_role text,
  p_boundary text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.ria_authoring_organization(p_assessment_id);
  v_id uuid;
  v_severity text;
begin
  if p_finding_id is not null then
    select f.severity into v_severity
    from public.ria_findings f
    where f.id = p_finding_id
      and f.assessment_id = p_assessment_id
      and f.organization_id = v_org;
    if v_severity is null then
      raise exception 'Action finding is not in this assessment'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if p_horizon not in ('day_30','day_60','day_90') then
    raise exception 'Invalid action horizon' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_action,'')) = ''
     or btrim(coalesce(p_authority_role,'')) = ''
     or btrim(coalesce(p_boundary,'')) = '' then
    raise exception 'Action, authority, and boundary are required'
      using errcode = 'check_violation';
  end if;

  insert into public.ria_actions (
    assessment_id, organization_id, finding_id, horizon, action, owner, due_on,
    verification_metric, authority_role, boundary, approval_state, status
  ) values (
    p_assessment_id, v_org, p_finding_id, p_horizon, btrim(p_action),
    nullif(btrim(coalesce(p_owner,'')), ''), p_due_on,
    nullif(btrim(coalesce(p_verification_metric,'')), ''),
    btrim(p_authority_role), btrim(p_boundary),
    case when v_severity in ('critical','high') then 'pending' else 'not_required' end,
    'not_started'
  ) returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Verification. Evidence source UUIDs are validated before being stored in
--    the legacy evidence_refs array so that array cannot become a tenant leak.
-- ---------------------------------------------------------------------------
create or replace function public.record_ria_verification(
  p_assessment_id uuid,
  p_checkpoint text,
  p_metric text,
  p_baseline text,
  p_observed text,
  p_method text,
  p_evidence_source_ids uuid[],
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.ria_authoring_organization(p_assessment_id);
  v_id uuid;
begin
  if p_checkpoint not in ('day_30','day_60','day_90') then
    raise exception 'Invalid verification checkpoint' using errcode = 'check_violation';
  end if;
  if p_status not in ('pending','supported','partially_supported','unsupported') then
    raise exception 'Invalid verification status' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_metric,'')) = '' or btrim(coalesce(p_method,'')) = '' then
    raise exception 'Verification metric and method are required'
      using errcode = 'check_violation';
  end if;

  perform public.ria_validate_source_ids(
    p_assessment_id, v_org, coalesce(p_evidence_source_ids, '{}'::uuid[])
  );

  insert into public.ria_verifications (
    assessment_id, organization_id, checkpoint, metric, baseline, observed,
    method, evidence_refs, status, verified_by, verified_at
  ) values (
    p_assessment_id, v_org, p_checkpoint, btrim(p_metric),
    nullif(btrim(coalesce(p_baseline,'')), ''),
    nullif(btrim(coalesce(p_observed,'')), ''), btrim(p_method),
    coalesce(p_evidence_source_ids, '{}'::uuid[]), p_status,
    case when p_status = 'pending' then null else auth.uid() end,
    case when p_status = 'pending' then null else now() end
  ) returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Explicit phase state machine. Same-state calls are idempotent. The two
--    review loops are reversible; completion/closure are forward-only.
-- ---------------------------------------------------------------------------
create or replace function public.transition_ria_assessment_phase(
  p_assessment_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.ria_authoring_organization(p_assessment_id);
  v_current text;
begin
  select a.status into v_current
  from public.ria_assessments a
  where a.id = p_assessment_id and a.organization_id = v_org
  for update;

  if v_current is null then
    raise exception 'Assessment not found in current organization'
      using errcode = 'no_data_found';
  end if;

  if p_status = v_current then return; end if;

  if not (
    (v_current = 'active' and p_status = 'analysis')
    or (v_current = 'analysis' and p_status = 'customer_review')
    or (v_current = 'customer_review' and p_status in ('analysis','verification'))
    or (v_current = 'verification' and p_status in ('customer_review','complete'))
    or (v_current = 'complete' and p_status = 'closed')
  ) then
    raise exception 'Invalid RIA phase transition: % -> %', v_current, p_status
      using errcode = 'check_violation';
  end if;

  -- Completion must mean the verification loop exists, not merely that someone
  -- clicked through the state machine.
  if p_status = 'complete' and not exists (
    select 1 from public.ria_verifications v
    where v.assessment_id = p_assessment_id
      and v.organization_id = v_org
      and v.status in ('supported','partially_supported','unsupported')
  ) then
    raise exception 'Assessment cannot be completed before a verification conclusion is recorded'
      using errcode = 'check_violation';
  end if;

  update public.ria_assessments
  set status = p_status, updated_at = now()
  where id = p_assessment_id and organization_id = v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants. Every new definer is denied to PUBLIC/anon; only the intended API
--     contracts are executable by authenticated users. Helpers stay private.
-- ---------------------------------------------------------------------------
revoke all on function public.list_ria_activation_organizations() from public, anon;
revoke all on function public.activate_ria_from_intake(uuid,uuid,text,date,text) from public, anon;
revoke all on function public.ria_authoring_organization(uuid) from public, anon, authenticated;
revoke all on function public.ria_validate_source_ids(uuid,uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.upsert_ria_baseline_metric(uuid,text,text,text,text,text,text,text[],text,text,uuid[]) from public, anon;
revoke all on function public.create_ria_criticality_draft(uuid,text,text,text,text) from public, anon;
revoke all on function public.create_ria_finding_draft(uuid,text,text,text,text,text,text,jsonb) from public, anon;
revoke all on function public.create_ria_opportunity_draft(uuid,uuid,text,text,text,text,text,text,numeric,numeric,text,text,text,text,text) from public, anon;
revoke all on function public.create_ria_decision_draft(uuid,uuid,text,text,text,text,text,text,text,date) from public, anon;
revoke all on function public.create_ria_action_draft(uuid,uuid,text,text,text,date,text,text,text) from public, anon;
revoke all on function public.record_ria_verification(uuid,text,text,text,text,text,uuid[],text) from public, anon;
revoke all on function public.transition_ria_assessment_phase(uuid,text) from public, anon;

grant execute on function public.list_ria_activation_organizations() to authenticated;
grant execute on function public.activate_ria_from_intake(uuid,uuid,text,date,text) to authenticated;
grant execute on function public.upsert_ria_baseline_metric(uuid,text,text,text,text,text,text,text[],text,text,uuid[]) to authenticated;
grant execute on function public.create_ria_criticality_draft(uuid,text,text,text,text) to authenticated;
grant execute on function public.create_ria_finding_draft(uuid,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.create_ria_opportunity_draft(uuid,uuid,text,text,text,text,text,text,numeric,numeric,text,text,text,text,text) to authenticated;
grant execute on function public.create_ria_decision_draft(uuid,uuid,text,text,text,text,text,text,text,date) to authenticated;
grant execute on function public.create_ria_action_draft(uuid,uuid,text,text,text,date,text,text,text) to authenticated;
grant execute on function public.record_ria_verification(uuid,text,text,text,text,text,uuid[],text) to authenticated;
grant execute on function public.transition_ria_assessment_phase(uuid,text) to authenticated;
