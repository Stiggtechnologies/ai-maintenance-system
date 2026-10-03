-- Azure Marketplace Gate A7: durable preview-certification receipt.
--
-- The live harness performs the Microsoft calls and human-evidence checks. This
-- service-only RPC independently verifies the canonical subscription,
-- lifecycle, unsubscribe and accepted-meter records before appending a compact,
-- non-secret receipt to the ONE audit ledger. It stores fingerprints, never raw
-- purchase tokens, bearer tokens, external links or preview subscription IDs.

create or replace function public.record_marketplace_preview_certification(
  p_primary_subscription_id text,
  p_unsubscribe_subscription_id text,
  p_report_sha256 text,
  p_external_evidence_sha256 text,
  p_external_reference_fingerprint text,
  p_witness_fingerprint text,
  p_reviewer_fingerprint text,
  p_git_sha text,
  p_github_run_id text,
  p_evidence_captured_at timestamptz,
  p_checks jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org uuid;
  v_terminal_org uuid;
  v_publisher text;
  v_offer text;
  v_plan text;
  v_dimension text;
  v_meter_id uuid;
  v_meter_submitted_at timestamptz;
  v_audit_id text;
  v_required_check_ids constant text[] := array[
    'distinct-preview-subscriptions','primary-canonical-entitlement',
    'primary-governed-activation','primary-live-lifecycle',
    'terminal-unsubscribe','microsoft-authoritative-primary',
    'accepted-canonical-meter','included-quantity-reconciliation',
    'exact-duplicate-witness','deliberate-rejection-witness',
    'canonical-audit-lineage','partner-center-usage-view'
  ];
begin
  if btrim(coalesce(p_primary_subscription_id,''))=''
    or btrim(coalesce(p_unsubscribe_subscription_id,''))=''
    or p_primary_subscription_id=p_unsubscribe_subscription_id then
    raise exception 'Two distinct preview subscription identifiers are required';
  end if;
  if p_report_sha256 !~ '^[0-9a-f]{64}$'
    or p_external_evidence_sha256 !~ '^[0-9a-f]{64}$'
    or p_external_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_witness_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reviewer_fingerprint !~ '^[0-9a-f]{64}$'
    or p_witness_fingerprint=p_reviewer_fingerprint then
    raise exception 'Certification digests or independent witnesses are invalid';
  end if;
  if p_git_sha !~ '^[0-9a-f]{40}$'
    or p_github_run_id !~ '^[0-9]{1,30}$'
    or p_evidence_captured_at is null
    or p_evidence_captured_at<now()-interval '24 hours'
    or p_evidence_captured_at>now()+interval '5 minutes' then
    raise exception 'Certification execution provenance is invalid';
  end if;
  if jsonb_typeof(p_checks)<>'array' or jsonb_array_length(p_checks)<>12
    or (select count(distinct value->>'id') from jsonb_array_elements(p_checks))<>12
    or (select array_agg(value->>'id' order by value->>'id')
        from jsonb_array_elements(p_checks))
       <>(select array_agg(id order by id)
          from unnest(v_required_check_ids) as required(id))
    or exists (
      select 1 from jsonb_array_elements(p_checks) value
      where jsonb_typeof(value)<>'object'
        or coalesce(value->>'id','')=''
        or value->>'passed'<>'true'
    ) then
    raise exception 'All twelve preview-certification checks must pass';
  end if;

  select organization_id,marketplace_publisher_id,marketplace_offer_id,marketplace_plan_id
    into v_org,v_publisher,v_offer,v_plan
  from public.billing_subscriptions
  where marketplace_subscription_id=p_primary_subscription_id
    and billing_source='azure_marketplace'
    and status='active' and marketplace_status='Subscribed';
  if v_org is null then raise exception 'Active primary Marketplace entitlement is absent'; end if;

  if not exists (
    select 1 from public.marketplace_fulfillment_resolutions
    where marketplace_subscription_id=p_primary_subscription_id
      and organization_id=v_org and publisher_id=v_publisher
      and offer_id=v_offer and plan_id=v_plan
      and internal_status='active' and marketplace_status='Subscribed'
      and activated_at is not null
  ) then raise exception 'Governed primary activation evidence is absent'; end if;

  if (
    select count(distinct action)
    from public.marketplace_fulfillment_operations
    where marketplace_subscription_id=p_primary_subscription_id
      and organization_id=v_org
      and action in ('ChangePlan','ChangeQuantity','Renew','Suspend','Reinstate')
      and microsoft_status='Succeeded' and processing_state='completed'
  )<>5 then raise exception 'The complete primary lifecycle witness is absent'; end if;

  select organization_id into v_terminal_org
  from public.billing_subscriptions
  where marketplace_subscription_id=p_unsubscribe_subscription_id
    and billing_source='azure_marketplace'
    and marketplace_publisher_id=v_publisher and marketplace_offer_id=v_offer
    and status='cancelled' and marketplace_status='Unsubscribed';
  if v_terminal_org is null or v_terminal_org<>v_org then
    raise exception 'Terminal unsubscribe must belong to the same preview tenant';
  end if;
  if not exists (
    select 1 from public.marketplace_fulfillment_resolutions
    where marketplace_subscription_id=p_unsubscribe_subscription_id
      and organization_id=v_org and internal_status='unsubscribed'
      and marketplace_status='Unsubscribed'
  ) or not exists (
    select 1 from public.marketplace_fulfillment_operations
    where marketplace_subscription_id=p_unsubscribe_subscription_id
      and organization_id=v_org and action='Unsubscribe'
      and microsoft_status='Succeeded' and processing_state='completed'
  ) then raise exception 'Governed unsubscribe evidence is absent'; end if;

  select id,dimension,submitted_at into v_meter_id,v_dimension,v_meter_submitted_at
  from public.marketplace_hourly_metering_events
  where marketplace_subscription_id=p_primary_subscription_id
    and organization_id=v_org and plan_id=v_plan
    and status='accepted' and microsoft_status='Accepted'
    and microsoft_usage_event_id is not null
    and request_id is not null and correlation_id is not null
    and usage_hour>=date_trunc('hour',now()-interval '23 hours')
  order by usage_hour desc limit 1;
  if v_dimension is null then raise exception 'Recent accepted metering evidence is absent'; end if;
  if v_meter_submitted_at is null or p_evidence_captured_at<v_meter_submitted_at then
    raise exception 'Partner Center evidence must be captured after the accepted metering event';
  end if;
  if not exists (
    select 1 from public.audit_events
    where organization_id=v_org
      and entity_type='azure_marketplace_subscription'
      and event_data->>'event'='activation_requested'
      and event_data->>'marketplaceSubscriptionId'=p_primary_subscription_id
  ) or not exists (
    select 1 from public.audit_events
    where organization_id=v_org
      and entity_type='azure_marketplace_metering'
      and event_data->>'event'='usage_emission_completed'
      and event_data->>'marketplaceSubscriptionId'=p_primary_subscription_id
      and event_data->>'meteringRecordId'=v_meter_id::text
      and event_data->>'status'='accepted'
      and event_data->>'microsoftStatus'='Accepted'
  ) then raise exception 'Exact activation and accepted-meter audit lineage is absent'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_report_sha256,0));
  select id::text into v_audit_id from public.audit_events
  where entity_type='azure_marketplace_certification'
    and event_data->>'reportSha256'=p_report_sha256
  limit 1;
  if v_audit_id is not null then
    return jsonb_build_object('auditEventId',v_audit_id,'recorded',false,'idempotent',true);
  end if;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values (v_org,'azure_marketplace_certification','azure_marketplace_preview_certification',jsonb_build_object(
    'event','preview_certification_passed',
    'reportSha256',p_report_sha256,
    'externalEvidenceSha256',p_external_evidence_sha256,
    'externalReferenceFingerprint',p_external_reference_fingerprint,
    'witnessFingerprint',p_witness_fingerprint,
    'reviewerFingerprint',p_reviewer_fingerprint,
    'gitSha',p_git_sha,'githubRunId',p_github_run_id,
    'evidenceCapturedAt',p_evidence_captured_at,
    'publisherFingerprint',encode(digest(v_publisher,'sha256'),'hex'),
    'offerFingerprint',encode(digest(v_offer,'sha256'),'hex'),
    'primarySubscriptionFingerprint',encode(digest(lower(p_primary_subscription_id),'sha256'),'hex'),
    'unsubscribeSubscriptionFingerprint',encode(digest(lower(p_unsubscribe_subscription_id),'sha256'),'hex'),
    'planId',v_plan,'dimension',v_dimension,'checks',p_checks
  )) returning id::text into v_audit_id;
  return jsonb_build_object('auditEventId',v_audit_id,'recorded',true,'idempotent',false);
end;
$$;

revoke all on function public.record_marketplace_preview_certification(
  text,text,text,text,text,text,text,text,text,timestamptz,jsonb
) from public,anon,authenticated;
grant execute on function public.record_marketplace_preview_certification(
  text,text,text,text,text,text,text,text,text,timestamptz,jsonb
) to service_role;

comment on function public.record_marketplace_preview_certification(
  text,text,text,text,text,text,text,text,text,timestamptz,jsonb
) is 'A7 service-only append to canonical audit_events after independently verifying live preview lifecycle, unsubscribe and recent accepted metering evidence.';

notify pgrst, 'reload schema';
