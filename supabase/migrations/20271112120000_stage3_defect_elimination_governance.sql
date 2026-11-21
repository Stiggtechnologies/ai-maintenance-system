-- Stage 3 defect-elimination governance (C9.03).
--
-- FRACAS capture, named RCA assignment, asset-strategy PM optimization and
-- retained Weibull life-data reports already exist. This migration does not
-- recompute those engines, does not adopt block, opportunistic or
-- multi-component PM policies, and does not write a physical-life identity.
-- A named human freezes one same-tenant evidence set and an explicit
-- disposition. The record grants no work, interval, strategy, risk, spend
-- or return-to-service authority.

create table if not exists public.defect_elimination_governances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  fracas_investigation_pack_id uuid not null
    references public.fracas_investigation_packs(id) on delete restrict,
  fracas_assignment_id uuid not null
    references public.fracas_investigation_assignments(id) on delete restrict,
  asset_strategy_assessment_id uuid not null
    references public.asset_strategy_assessments(id) on delete restrict,
  reliability_life_data_report_id uuid not null
    references public.reliability_life_data_reports(id) on delete restrict,
  disposition text not null check (
    disposition in ('pursue_elimination', 'retain_and_monitor', 'defer_for_evidence')
  ),
  basis_note text not null check (length(btrim(basis_note)) between 20 and 4000),
  evidence_snapshot jsonb not null check (jsonb_typeof(evidence_snapshot) = 'object'),
  elimination_snapshot jsonb not null check (jsonb_typeof(elimination_snapshot) = 'object'),
  governed_by uuid not null references auth.users(id),
  governed_at timestamptz not null default now()
);

create index if not exists idx_defect_elimination_governances_asset
  on public.defect_elimination_governances (organization_id, asset_id, governed_at desc);

create unique index if not exists uq_defect_elimination_governance_decision
  on public.defect_elimination_governances (
    organization_id,
    asset_id,
    fracas_investigation_pack_id,
    fracas_assignment_id,
    asset_strategy_assessment_id,
    reliability_life_data_report_id,
    disposition,
    governed_by
  );

alter table public.defect_elimination_governances enable row level security;

drop policy if exists defect_elimination_governances_read
  on public.defect_elimination_governances;
create policy defect_elimination_governances_read
  on public.defect_elimination_governances
  for select to authenticated
  using (organization_id = public.app_current_org());

revoke insert, update, delete, truncate on public.defect_elimination_governances
  from public, anon, authenticated;
grant select on public.defect_elimination_governances to authenticated;

create or replace function public.protect_defect_elimination_governance()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_marker text := coalesce(current_setting('app.defect_elimination_governance_write', true), '');
begin
  if tg_op <> 'INSERT' then
    raise exception 'defect-elimination governance records are append-only';
  end if;
  if v_marker <> 'granted' then
    raise exception 'defect-elimination governance is written only by the named-human governance workflow';
  end if;
  if new.organization_id is distinct from public.app_current_org() then
    raise exception 'defect-elimination governance cannot cross a tenant boundary';
  end if;
  if new.governed_by is distinct from auth.uid() then
    raise exception 'defect-elimination governance must name the signed-in human';
  end if;
  return new;
end
$function$;

revoke all on function public.protect_defect_elimination_governance()
  from public, anon, authenticated;

drop trigger if exists trg_protect_defect_elimination_governance
  on public.defect_elimination_governances;
create trigger trg_protect_defect_elimination_governance
  before insert or update or delete on public.defect_elimination_governances
  for each row execute function public.protect_defect_elimination_governance();

drop trigger if exists trg_defect_elimination_governance_no_truncate
  on public.defect_elimination_governances;
create trigger trg_defect_elimination_governance_no_truncate
  before truncate on public.defect_elimination_governances
  for each statement execute function public.protect_defect_elimination_governance();

create or replace function public.get_defect_elimination_governance()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_asset record;
  v_pack_id uuid;
  v_assignment_id uuid;
  v_assigned_to uuid;
  v_assessment_id uuid;
  v_recommendation_kind text;
  v_pm_kernel text;
  v_report_id uuid;
  v_component text;
  v_life_kernel text;
  v_work_order text;
  v_investigator text;
  v_gaps jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_decisions jsonb;
  v_elimination jsonb;
  v_method text;
  v_beta numeric;
  v_eta numeric;
  v_fitted boolean;
begin
  if v_org is null or v_uid is null then
    return jsonb_build_object('error', 'authentication required');
  end if;

  v_elimination := public.get_failure_mode_elimination_rate();
  if jsonb_typeof(v_elimination) is distinct from 'object' or v_elimination ? 'error' then
    v_elimination := jsonb_build_object(
      'available', false,
      'eliminationRatePct', null,
      'basis', 'The canonical elimination metric did not return a measurement. No rate was invented.'
    );
  end if;

  for v_asset in
    select a.id, coalesce(nullif(btrim(a.tag), ''), a.name) as asset_tag
    from public.assets a
    where a.organization_id = v_org
      and (
        exists (
          select 1 from public.fracas_investigation_packs p
          where p.organization_id = v_org and p.asset_id = a.id
        )
        or exists (
          select 1 from public.asset_strategy_assessments s
          where s.organization_id = v_org and s.asset_id = a.id
        )
        or exists (
          select 1 from public.reliability_life_data_reports r
          where r.organization_id = v_org
            and jsonb_typeof(r.source_snapshot) = 'array'
            and exists (
              select 1 from jsonb_array_elements(r.source_snapshot) elem
              where elem->>'assetId' = a.id::text
            )
        )
      )
    order by 2
    limit 40
  loop
    v_pack_id := null;
    v_assignment_id := null;
    v_assigned_to := null;
    v_assessment_id := null;
    v_recommendation_kind := null;
    v_pm_kernel := null;
    v_report_id := null;
    v_component := null;
    v_life_kernel := null;
    v_work_order := null;
    v_investigator := null;
    v_method := null;
    v_beta := null;
    v_eta := null;
    v_fitted := false;
    v_gaps := '[]'::jsonb;

    select p.id, wo.wo_number
      into v_pack_id, v_work_order
    from public.fracas_investigation_packs p
    left join public.work_orders wo
      on wo.id = p.work_order_id and wo.organization_id = p.organization_id
    where p.organization_id = v_org and p.asset_id = v_asset.id
    order by p.created_at desc
    limit 1;
    if v_pack_id is null then
      v_gaps := v_gaps || jsonb_build_array('missing_fracas');
    else
      select x.id, x.assigned_to,
             coalesce(nullif(btrim(up.full_name), ''), up.email)
        into v_assignment_id, v_assigned_to, v_investigator
      from public.fracas_investigation_assignments x
      left join public.user_profiles up
        on up.id = x.assigned_to and up.organization_id = x.organization_id
      where x.organization_id = v_org and x.investigation_pack_id = v_pack_id
      order by x.assigned_at desc
      limit 1;
      if v_assignment_id is null then
        v_gaps := v_gaps || jsonb_build_array('rca_unassigned');
      end if;
    end if;

    select s.id, s.recommendation->>'kind', s.kernel_version
      into v_assessment_id, v_recommendation_kind, v_pm_kernel
    from public.asset_strategy_assessments s
    where s.organization_id = v_org and s.asset_id = v_asset.id
    order by s.created_at desc
    limit 1;
    if v_assessment_id is null then
      v_gaps := v_gaps || jsonb_build_array('missing_pm_assessment');
    elsif coalesce(v_recommendation_kind, '') not in (
      'interval_change', 'inspection_interval', 'run_to_failure_review',
      'retain_current', 'evidence_gap', 'strategy_review'
    ) then
      v_gaps := v_gaps || jsonb_build_array('unrecognized_pm_recommendation');
    end if;

    select r.id, r.method_selection->>'method', r.component, r.kernel_version,
           case
             when jsonb_typeof(r.method_selection->'beta') = 'number'
               then (r.method_selection->>'beta')::numeric
             else null
           end,
           case
             when jsonb_typeof(r.method_selection->'eta') = 'number'
               then (r.method_selection->>'eta')::numeric
             else null
           end
      into v_report_id, v_method, v_component, v_life_kernel, v_beta, v_eta
    from public.reliability_life_data_reports r
    where r.organization_id = v_org
      and jsonb_typeof(r.source_snapshot) = 'array'
      and exists (
        select 1 from jsonb_array_elements(r.source_snapshot) elem
        where elem->>'assetId' = v_asset.id::text
      )
      and exists (
        select 1 from public.component_life_events e
        where e.organization_id = v_org
          and e.asset_id = v_asset.id
          and e.id = any(r.source_event_ids)
      )
    order by
      case
        when r.method_selection->>'method' in ('mle', 'mle_censored', 'rank_regression')
          then 0
        else 1
      end,
      r.created_at desc
    limit 1;
    if v_report_id is null then
      v_gaps := v_gaps || jsonb_build_array('missing_weibull');
    elsif v_method in ('mle', 'mle_censored', 'rank_regression')
          and coalesce(v_beta, 0) > 0
          and coalesce(v_eta, 0) > 0 then
      v_fitted := true;
    else
      v_beta := null;
      v_eta := null;
      v_gaps := v_gaps || jsonb_build_array('weibull_unidentified');
    end if;

    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'assetId', v_asset.id,
      'assetTag', v_asset.asset_tag,
      'ready', v_gaps = '[]'::jsonb and v_fitted,
      'gaps', v_gaps,
      'fracasPackId', v_pack_id,
      'workOrderNumber', v_work_order,
      'assignmentId', v_assignment_id,
      'investigatorName', v_investigator,
      'callerIsInvestigator', v_assigned_to is not null and v_assigned_to = v_uid,
      'strategyAssessmentId', v_assessment_id,
      'recommendationKind', v_recommendation_kind,
      'pmKernelVersion', v_pm_kernel,
      'lifeReportId', v_report_id,
      'weibullMethod', v_method,
      'beta', v_beta,
      'eta', v_eta,
      'component', v_component,
      'lifeKernelVersion', v_life_kernel
    ));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'assetId', g.asset_id,
    'assetTag', coalesce(nullif(btrim(a.tag), ''), a.name),
    'disposition', g.disposition,
    'basisNote', g.basis_note,
    'governedAt', g.governed_at,
    'recommendationKind', g.evidence_snapshot->>'recommendationKind',
    'weibullMethod', g.evidence_snapshot->>'weibullMethod',
    'component', g.evidence_snapshot->>'component',
    'boundaries', g.evidence_snapshot->'boundaries'
  ) order by g.governed_at desc), '[]'::jsonb)
  into v_decisions
  from (
    select *
    from public.defect_elimination_governances
    where organization_id = v_org
    order by governed_at desc
    limit 20
  ) g
  join public.assets a
    on a.id = g.asset_id and a.organization_id = g.organization_id;

  return jsonb_build_object(
    'basis', 'Stage 3 governance freezes a retained FRACAS pack, its named RCA assignment, the canonical asset-strategy PM assessment and a retained Weibull life-data report for the same asset. It does not refit Weibull, recompute PM policy, or treat an unidentified distribution as a fit.',
    'boundaries', jsonb_build_object(
      'mayCreateWork', false,
      'mayChangePmInterval', false,
      'mayApproveStrategy', false,
      'mayAcceptRisk', false,
      'mayCommitSpend', false,
      'mayReturnToService', false
    ),
    'reuse', jsonb_build_object(
      'fracas', 'Canonical investigation packs and named assignments. A root cause is not claimed by recording governance.',
      'pmOptimization', 'Canonical asset-strategy assessments. Block, opportunistic and multi-component policies are not recomputed here.',
      'weibull', 'Canonical reliability life-data reports. The retained fit is frozen, not refit, and physical-life identity is not written here.',
      'elimination', 'The organization elimination metric is snapshotted. An unavailable rate stays unavailable.'
    ),
    'elimination', v_elimination,
    'candidates', v_candidates,
    'decisions', coalesce(v_decisions, '[]'::jsonb)
  );
end
$function$;

revoke all on function public.get_defect_elimination_governance()
  from public, anon, authenticated;
grant execute on function public.get_defect_elimination_governance()
  to authenticated;

create or replace function public.record_defect_elimination_governance(
  p_asset_id uuid,
  p_fracas_pack_id uuid,
  p_strategy_assessment_id uuid,
  p_life_report_id uuid,
  p_disposition text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  v_pack public.fracas_investigation_packs%rowtype;
  v_assignment public.fracas_investigation_assignments%rowtype;
  v_assessment public.asset_strategy_assessments%rowtype;
  v_report public.reliability_life_data_reports%rowtype;
  v_saved public.defect_elimination_governances%rowtype;
  v_elimination jsonb;
  v_evidence jsonb;
  v_boundary jsonb := jsonb_build_object(
    'mayCreateWork', false,
    'mayChangePmInterval', false,
    'mayApproveStrategy', false,
    'mayAcceptRisk', false,
    'mayCommitSpend', false,
    'mayReturnToService', false
  );
begin
  if v_org is null or v_uid is null then
    return jsonb_build_object('error', 'authentication required');
  end if;

  select role into v_role
  from public.user_profiles
  where id = v_uid and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error', 'the AI-operator identity cannot govern defect elimination');
  end if;
  if coalesce(v_role, '') not in ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'defect-elimination governance requires a named reliability engineer, maintenance manager or administrator');
  end if;
  if p_disposition not in ('pursue_elimination', 'retain_and_monitor', 'defer_for_evidence') then
    return jsonb_build_object('error', 'disposition must be pursue elimination, retain and monitor, or defer for evidence');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 or length(btrim(p_basis)) > 4000 then
    return jsonb_build_object('error', 'governance basis must state what the retained evidence does and does not support');
  end if;
  if not exists (
    select 1 from public.assets
    where id = p_asset_id and organization_id = v_org
  ) then
    return jsonb_build_object('error', 'asset not found in this organization');
  end if;

  select * into v_pack
  from public.fracas_investigation_packs
  where id = p_fracas_pack_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'FRACAS investigation pack not found for this asset in this organization');
  end if;
  if v_pack.asset_id is distinct from p_asset_id then
    return jsonb_build_object('error', 'FRACAS investigation pack not found for this asset in this organization');
  end if;

  select * into v_assignment
  from public.fracas_investigation_assignments
  where investigation_pack_id = v_pack.id and organization_id = v_org
  order by assigned_at desc
  limit 1;
  if not found then
    return jsonb_build_object('error', 'RCA ownership is missing; assign a named investigator before governing defect elimination');
  end if;
  if v_assignment.assigned_to = v_uid then
    return jsonb_build_object('error', 'the assigned RCA investigator cannot govern their own defect-elimination decision');
  end if;

  select * into v_assessment
  from public.asset_strategy_assessments
  where id = p_strategy_assessment_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'PM optimization assessment not found for this asset in this organization');
  end if;
  if v_assessment.asset_id is distinct from p_asset_id then
    return jsonb_build_object('error', 'PM optimization assessment not found for this asset in this organization');
  end if;
  if coalesce(v_assessment.recommendation->>'kind', '') not in (
    'interval_change', 'inspection_interval', 'run_to_failure_review',
    'retain_current', 'evidence_gap', 'strategy_review'
  ) then
    return jsonb_build_object('error', 'the PM assessment recommendation is not a recognized asset-strategy kind');
  end if;

  select * into v_report
  from public.reliability_life_data_reports
  where id = p_life_report_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'Weibull life-data report not found in this organization');
  end if;
  if jsonb_typeof(v_report.source_snapshot) is distinct from 'array'
     or not exists (
       select 1 from jsonb_array_elements(v_report.source_snapshot) elem
       where elem->>'assetId' = p_asset_id::text
     )
     or not exists (
       select 1 from public.component_life_events e
       where e.organization_id = v_org
         and e.asset_id = p_asset_id
         and e.id = any(v_report.source_event_ids)
     ) then
    return jsonb_build_object('error', 'the Weibull report does not include a life event for this asset');
  end if;
  if coalesce(v_report.method_selection->>'method', '') not in
      ('mle', 'mle_censored', 'rank_regression') then
    return jsonb_build_object('error', 'a Weibull fit is required; an unidentified distribution cannot govern defect elimination');
  end if;
  if coalesce((v_report.method_selection->>'beta')::numeric, 0) <= 0
     or coalesce((v_report.method_selection->>'eta')::numeric, 0) <= 0 then
    return jsonb_build_object('error', 'the retained Weibull report has no positive beta and eta');
  end if;

  v_elimination := public.get_failure_mode_elimination_rate();
  if jsonb_typeof(v_elimination) is distinct from 'object' or v_elimination ? 'error' then
    v_elimination := jsonb_build_object(
      'available', false,
      'eliminationRatePct', null,
      'basis', 'The canonical elimination metric did not return a measurement. No rate was invented.'
    );
  end if;

  v_evidence := jsonb_build_object(
    'fracasPackId', v_pack.id,
    'assignmentId', v_assignment.id,
    'strategyAssessmentId', v_assessment.id,
    'lifeReportId', v_report.id,
    'recommendationKind', v_assessment.recommendation->>'kind',
    'pmKernelVersion', v_assessment.kernel_version,
    'weibullMethod', v_report.method_selection->>'method',
    'beta', v_report.method_selection->'beta',
    'eta', v_report.method_selection->'eta',
    'component', v_report.component,
    'lifeKernelVersion', v_report.kernel_version,
    'boundaries', v_boundary,
    'rootCauseClaimed', false,
    'enginesRecomputed', false
  );

  perform set_config('app.defect_elimination_governance_write', 'granted', true);
  insert into public.defect_elimination_governances (
    organization_id, asset_id, fracas_investigation_pack_id, fracas_assignment_id,
    asset_strategy_assessment_id, reliability_life_data_report_id, disposition,
    basis_note, evidence_snapshot, elimination_snapshot, governed_by
  ) values (
    v_org, p_asset_id, v_pack.id, v_assignment.id, v_assessment.id, v_report.id,
    p_disposition, btrim(p_basis), v_evidence, v_elimination, v_uid
  )
  returning * into v_saved;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org,
    'defect_elimination_governance',
    v_uid::text,
    jsonb_build_object(
      'action', 'recorded',
      'actor_role', v_role,
      'asset_id', p_asset_id,
      'disposition', p_disposition,
      'fracas_pack_id', v_pack.id,
      'assignment_id', v_assignment.id,
      'strategy_assessment_id', v_assessment.id,
      'life_report_id', v_report.id,
      'boundaries', v_boundary,
      'boundary', 'Governance freezes retained evidence only. It does not create work, change an interval, approve strategy, accept risk, spend or return equipment to service.'
    ),
    null,
    to_jsonb(v_saved)
  );
  perform set_config('app.defect_elimination_governance_write', '', true);

  return jsonb_build_object(
    'id', v_saved.id,
    'disposition', v_saved.disposition,
    'governedAt', v_saved.governed_at,
    'boundaries', v_boundary,
    'advisory', true
  );
exception
  when unique_violation then
    return jsonb_build_object('error', 'this exact governance decision is already recorded');
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('error', 'the retained Weibull report does not contain numeric beta and eta');
end
$function$;

revoke all on function public.record_defect_elimination_governance(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_defect_elimination_governance(uuid, uuid, uuid, uuid, text, text)
  to authenticated;

comment on table public.defect_elimination_governances is
  'Append-only Stage 3 governance. Freezes canonical FRACAS, RCA assignment, asset-strategy PM assessment and Weibull life-data evidence. No execution authority.';

notify pgrst, 'reload schema';
