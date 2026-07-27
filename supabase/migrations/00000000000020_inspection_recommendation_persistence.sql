-- ============================================================================
-- Atomic persistence for governed inspection recommendation packages.
--
-- One RPC commits the recommendation, required approval, and all evidence
-- records in a single PostgreSQL transaction. Any validation or insert failure
-- rolls the entire package back. A tenant-scoped source-finding identity makes
-- retries idempotent and prevents duplicate recommendations.
-- ============================================================================

alter table recommendations
  add column if not exists source_finding_id text;

create unique index if not exists recommendations_org_source_finding_uq
  on recommendations(organization_id, source_finding_id)
  where source_finding_id is not null;

create or replace function public.persist_inspection_recommendation_package(
  p_source_finding_id text,
  p_recommendation jsonb,
  p_approval jsonb,
  p_evidence_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_asset_id uuid;
  v_recommendation_id uuid;
  v_approval_id uuid;
  v_evidence_id uuid;
  v_evidence_ids uuid[] := array[]::uuid[];
  v_item jsonb;
  v_confidence numeric;
  v_existing boolean := false;
begin
  if v_org is null then
    raise exception 'Not signed in to an organization';
  end if;

  if nullif(btrim(p_source_finding_id), '') is null then
    raise exception 'Source finding ID is required';
  end if;

  if jsonb_typeof(p_recommendation) <> 'object' then
    raise exception 'Recommendation payload must be a JSON object';
  end if;
  if jsonb_typeof(p_approval) <> 'object' then
    raise exception 'Approval payload must be a JSON object';
  end if;
  if jsonb_typeof(p_evidence_items) <> 'array' or jsonb_array_length(p_evidence_items) = 0 then
    raise exception 'At least one evidence item is required';
  end if;

  begin
    v_asset_id := nullif(p_recommendation ->> 'asset_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Recommendation asset ID must be a valid UUID';
  end;

  if v_asset_id is null or not exists (
    select 1 from assets
    where id = v_asset_id and organization_id = v_org
  ) then
    raise exception 'Asset not found in current organization';
  end if;

  if coalesce(p_recommendation ->> 'status', '') <> 'pending' then
    raise exception 'Inspection recommendations must start pending';
  end if;
  if coalesce(p_approval ->> 'status', '') <> 'required' then
    raise exception 'Inspection recommendations require an approval record';
  end if;
  if nullif(p_recommendation ->> 'financial_impact', '') is not null then
    raise exception 'Financial impact requires separate site evidence';
  end if;
  if coalesce(p_recommendation ->> 'urgency', '') not in ('critical', 'action', 'advisory') then
    raise exception 'Unsupported recommendation urgency';
  end if;
  if coalesce(p_recommendation ->> 'risk_impact', '') not in ('High', 'Medium', 'Low') then
    raise exception 'Unsupported recommendation risk impact';
  end if;
  if coalesce(p_recommendation ->> 'approval_required', '') = ''
     or p_recommendation ->> 'approval_required' <> p_approval ->> 'owner_role' then
    raise exception 'Recommendation and approval ownership must match';
  end if;
  if (p_recommendation ->> 'confidence')::int not between 0 and 100 then
    raise exception 'Recommendation confidence must be between 0 and 100';
  end if;

  -- Serialize retries for the same organization/finding pair before checking the
  -- idempotency key. The lock is released automatically with the transaction.
  perform pg_advisory_xact_lock(
    hashtextextended(v_org::text || ':' || p_source_finding_id, 0)
  );

  select id into v_recommendation_id
  from recommendations
  where organization_id = v_org
    and source_finding_id = p_source_finding_id;

  if found then
    v_existing := true;

    select id into v_approval_id
    from approvals
    where organization_id = v_org
      and recommendation_id = v_recommendation_id
    order by created_at
    limit 1;

    select coalesce(array_agg(id order by created_at), array[]::uuid[])
      into v_evidence_ids
    from evidence_items
    where organization_id = v_org
      and recommendation_id = v_recommendation_id;

    if v_approval_id is null or cardinality(v_evidence_ids) = 0 then
      raise exception 'Existing inspection recommendation package is incomplete';
    end if;

    return jsonb_build_object(
      'recommendation_id', v_recommendation_id,
      'approval_id', v_approval_id,
      'evidence_item_ids', to_jsonb(v_evidence_ids),
      'created', false
    );
  end if;

  insert into recommendations (
    organization_id,
    asset_id,
    agent_id,
    source_finding_id,
    title,
    issue,
    action,
    impact,
    confidence,
    urgency,
    status,
    approval_required,
    accountable,
    responsible,
    consulted,
    informed,
    financial_impact,
    risk_impact,
    rationale
  ) values (
    v_org,
    v_asset_id,
    case
      when nullif(p_recommendation ->> 'agent_id', '') is null then null
      else (p_recommendation ->> 'agent_id')::uuid
    end,
    p_source_finding_id,
    p_recommendation ->> 'title',
    p_recommendation ->> 'issue',
    p_recommendation ->> 'action',
    p_recommendation ->> 'impact',
    (p_recommendation ->> 'confidence')::int,
    p_recommendation ->> 'urgency',
    'pending',
    p_recommendation ->> 'approval_required',
    p_recommendation ->> 'accountable',
    p_recommendation ->> 'responsible',
    p_recommendation ->> 'consulted',
    p_recommendation ->> 'informed',
    null,
    p_recommendation ->> 'risk_impact',
    p_recommendation ->> 'rationale'
  )
  returning id into v_recommendation_id;

  insert into approvals (
    organization_id,
    recommendation_id,
    work_order_id,
    status,
    owner_role,
    approver,
    reason,
    consequence_of_wrong,
    required_validation
  ) values (
    v_org,
    v_recommendation_id,
    null,
    'required',
    p_approval ->> 'owner_role',
    null,
    p_approval ->> 'reason',
    p_approval ->> 'consequence_of_wrong',
    p_approval ->> 'required_validation'
  )
  returning id into v_approval_id;

  for v_item in select value from jsonb_array_elements(p_evidence_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Every evidence item must be a JSON object';
    end if;
    if coalesce(v_item ->> 'source_system', '') <> 'inspection_intelligence' then
      raise exception 'Inspection evidence must use the inspection_intelligence source system';
    end if;
    if nullif(v_item ->> 'evidence_type', '') is null
       or nullif(v_item ->> 'description', '') is null then
      raise exception 'Evidence type and description are required';
    end if;
    if nullif(v_item ->> 'asset_id', '')::uuid <> v_asset_id then
      raise exception 'Evidence asset must match recommendation asset';
    end if;

    v_confidence := (v_item ->> 'confidence_contribution')::numeric;
    if v_confidence between 0 and 1 then
      v_confidence := round(v_confidence * 100);
    else
      v_confidence := round(v_confidence);
    end if;
    if v_confidence not between 0 and 100 then
      raise exception 'Evidence confidence contribution must resolve to 0 through 100';
    end if;

    insert into evidence_items (
      organization_id,
      recommendation_id,
      asset_id,
      source_system,
      evidence_type,
      description,
      confidence_contribution,
      data_quality,
      related_asset,
      ts
    ) values (
      v_org,
      v_recommendation_id,
      v_asset_id,
      'inspection_intelligence',
      v_item ->> 'evidence_type',
      v_item ->> 'description',
      v_confidence::int,
      coalesce(nullif(v_item ->> 'data_quality', ''), 'unverified'),
      coalesce(nullif(v_item ->> 'related_asset', ''), v_asset_id::text),
      coalesce(nullif(v_item ->> 'ts', '')::timestamptz, now())
    )
    returning id into v_evidence_id;

    v_evidence_ids := array_append(v_evidence_ids, v_evidence_id);
  end loop;

  return jsonb_build_object(
    'recommendation_id', v_recommendation_id,
    'approval_id', v_approval_id,
    'evidence_item_ids', to_jsonb(v_evidence_ids),
    'created', not v_existing
  );
end
$$;

revoke all on function public.persist_inspection_recommendation_package(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.persist_inspection_recommendation_package(text, jsonb, jsonb, jsonb) to authenticated;
