-- SC-02 canonical organization-source inventory. No persistence/RLS/ingest changes.
-- Architecture-steward reservation after all 75 open PRs on 2026-10-10T07:42:33Z:
-- deployed maximum 20270103040000, global open maximum 20270103160000, main c1b5e8ca.
-- Revalidated all 76 open PRs on 2026-10-10 (including all 103 files of #634):
-- remote open maximum remains 03160000; successful deployment 38015822249/head87667de5.
-- Local journey slots were moved after the Context/MFA/KB prerequisite reservations.

-- Pure value+server-time classification; no stored-row reads or identity lookup.
-- Preserve operating clock/rights/health predicates and disabled -> malformed ->
-- stale -> reported state precedence. Caller-supplied values grant no authority.
create or replace function public.sync_context_source_read_state(
  p_source public.connectors, p_generated_at timestamptz
) returns table(clock_ok boolean,rights_ok boolean,health_ok boolean,effective_state text)
language sql immutable set search_path=public as $$
  with checked as (
    select coalesce(isfinite(p_generated_at)
      and isfinite(p_source.context_checked_at) and p_source.context_checked_at<=p_generated_at
      and (p_source.context_observed_at is null or (isfinite(p_source.context_observed_at)
        and p_source.context_observed_at<=p_source.context_checked_at and p_source.context_observed_at<=p_generated_at))
      and (p_source.context_health_state not in ('live','simulated','delayed','conflicting','partial_coverage','clock_skew')
        or p_source.context_observed_at is not null),false) clock_ok,
      coalesce(public.sync_context_source_rights_permit(p_source)
        and isfinite(p_generated_at) and isfinite(p_source.context_rights_decided_at)
        and p_source.context_rights_decided_at<=p_generated_at,false) rights_ok,
      public.sync_context_source_health_permits_emission(p_source)
        and coalesce(p_source.enabled and p_source.status='active',false) health_ok
  )
  select clock_ok,rights_ok,health_ok,
    case when not coalesce(p_source.enabled and p_source.status='active',false) then 'unavailable'
      when not clock_ok then 'malformed'
      when p_source.context_health_state='live' and (p_source.expected_interval_minutes is null
        or p_source.expected_interval_minutes<1
        or p_source.context_observed_at<p_generated_at-p_source.expected_interval_minutes*interval '2 minutes') then 'stale'
      else p_source.context_health_state end effective_state from checked
$$;
revoke all on function public.sync_context_source_read_state(public.connectors,timestamptz) from public,anon,service_role;
-- Required by INVOKER inventory; pure supplied values, never a stored-row lookup.
grant execute on function public.sync_context_source_read_state(public.connectors,timestamptz) to authenticated;

-- Forward replacement retains signature, privacy/scope gates and wire shape;
-- only the source-classification CTE delegates to the shared pure classifier.
create or replace function public.get_sync_context_operating_picture(
  p_site_id uuid default null, p_object_limit integer default 250, p_event_limit integer default 250
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_generated_at timestamptz:=statement_timestamp(); v_result jsonb;
begin
  if auth.uid() is null or v_org is null or coalesce(v_role,'') not in
    ('technician','planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin')
    or not exists(select 1 from public.user_profiles u where u.id=auth.uid()
      and u.organization_id=v_org and u.role=v_role) then
    return jsonb_build_object('error','forbidden'); end if;
  if p_object_limit is null or p_object_limit<1 or p_object_limit>500
    or p_event_limit is null or p_event_limit<0 or p_event_limit>500 then
    return jsonb_build_object('error','invalid operating scope limits'); end if;
  if p_site_id is not null and not exists(select 1 from public.sites si
    where si.id=p_site_id and si.organization_id=v_org) then
    return jsonb_build_object('error','site not available in this organization'); end if;

  with effective_sources as materialized (
    select c.*, s.clock_ok, s.rights_ok, s.health_ok, s.effective_state
    from public.connectors c
    cross join lateral public.sync_context_source_read_state(c,v_generated_at) s
    where c.organization_id=v_org and c.context_source_class is not null and v_role<>'technician'
  ), raw_subjects as materialized (
    select l.id link_id,l.feature_id, s.subject_type, s.subject_uuid, s.subject_number
    from public.geospatial_subject_links l
    cross join lateral (values
      ('asset',l.asset_id,null::bigint),('site',l.site_id,null::bigint),
      ('linear_route',null::uuid,l.linear_route_id),('linear_segment',null::uuid,l.linear_segment_id),
      ('work_order',l.work_order_id,null::bigint),('evidence',l.evidence_item_id,null::bigint),
      ('recommendation',l.recommendation_id,null::bigint),('decision',l.decision_id,null::bigint),
      ('approval',l.approval_id,null::bigint),('risk',l.risk_id,null::bigint),
      ('recovery',l.restoration_event_id,null::bigint),('development_case',l.development_case_id,null::bigint),
      ('capital_project',null::uuid,l.capital_project_id),('audit_event',l.audit_event_id,null::bigint)
    ) s(subject_type,subject_uuid,subject_number)
    where l.organization_id=v_org and v_role<>'technician'
      and (s.subject_uuid is not null or s.subject_number is not null)
      -- Preserve privacy of the ENTIRE governed link before exploding it.
      -- SECURITY DEFINER must mirror risk_decision_audit_sensitivity, including
      -- malformed identities and secondary-risk parent sensitivity.
      and (l.audit_event_id is null or exists(select 1 from public.audit_events e
        where e.id=l.audit_event_id and e.organization_id=v_org
          and (e.entity_type not in ('risk_analysis','risk_value_of_information','risk_treatment',
            'risk_treatment_readiness_correction','risk_secondary_created')
            or (public.can_read_risk(public.sync_text_as_uuid(e.event_data->>'risk_id'))
              and (e.entity_type<>'risk_secondary_created'
                or public.can_read_risk(public.sync_text_as_uuid(e.event_data->>'parent_risk_id')))))))
      and (l.risk_id is null or exists(select 1 from public.risks r where r.id=l.risk_id and r.organization_id=v_org and public.can_read_risk(r.id)))
      and (l.evidence_item_id is null or exists(select 1 from public.evidence_items e where e.id=l.evidence_item_id and e.organization_id=v_org and (e.risk_id is null or public.can_read_risk(e.risk_id))))
      and (l.recommendation_id is null or exists(select 1 from public.recommendations r where r.id=l.recommendation_id and r.organization_id=v_org and (r.risk_id is null or public.can_read_risk(r.risk_id))))
      and (l.work_order_id is null or exists(select 1 from public.work_orders w
        left join public.recommendations r on r.id=w.recommendation_id and r.organization_id=v_org
        where w.id=l.work_order_id and w.organization_id=v_org and (w.risk_id is null or public.can_read_risk(w.risk_id))
          and (w.recommendation_id is null or (r.id is not null and (r.risk_id is null or public.can_read_risk(r.risk_id))))))
      and (l.decision_id is null or exists(select 1 from public.decisions d
        left join public.recommendations r on r.id=d.recommendation_id and r.organization_id=v_org
        where d.id=l.decision_id and d.organization_id=v_org and (d.risk_id is null or public.can_read_risk(d.risk_id))
          and (d.recommendation_id is null or (r.id is not null and (r.risk_id is null or public.can_read_risk(r.risk_id))))))
      and (l.approval_id is null or exists(select 1 from public.approvals ap
        left join public.work_orders w on w.id=ap.work_order_id and w.organization_id=v_org
        left join public.recommendations wr on wr.id=w.recommendation_id and wr.organization_id=v_org
        left join public.recommendations r on r.id=ap.recommendation_id and r.organization_id=v_org
        left join public.decisions d on d.id=ap.decision_id and d.organization_id=v_org
        left join public.recommendations dr on dr.id=d.recommendation_id and dr.organization_id=v_org
        where ap.id=l.approval_id and ap.organization_id=v_org and (ap.risk_id is null or public.can_read_risk(ap.risk_id))
          and (ap.work_order_id is null or (w.id is not null and (w.risk_id is null or public.can_read_risk(w.risk_id))
            and (w.recommendation_id is null or (wr.id is not null and (wr.risk_id is null or public.can_read_risk(wr.risk_id))))))
          and (ap.recommendation_id is null or (r.id is not null and (r.risk_id is null or public.can_read_risk(r.risk_id))))
          and (ap.decision_id is null or (d.id is not null and (d.risk_id is null or public.can_read_risk(d.risk_id))
            and (d.recommendation_id is null or (dr.id is not null and (dr.risk_id is null or public.can_read_risk(dr.risk_id))))))))
  ), resolved_subjects as materialized (
    select s.*, a.site_id, false scope_conflict from raw_subjects s
      join public.assets a on s.subject_type='asset' and a.id=s.subject_uuid and a.organization_id=v_org
    union all select s.*, si.id,false from raw_subjects s
      join public.sites si on s.subject_type='site' and si.id=s.subject_uuid and si.organization_id=v_org
    union all select s.*, a.site_id,false from raw_subjects s
      join public.linear_asset_routes r on s.subject_type='linear_route' and r.id=s.subject_number and r.organization_id=v_org
      join public.assets a on a.id=r.asset_id and a.organization_id=v_org
    union all select s.*, a.site_id,false from raw_subjects s
      join public.linear_segments seg on s.subject_type='linear_segment' and seg.id=s.subject_number and seg.organization_id=v_org
      join public.linear_asset_routes r on r.id=seg.route_id and r.organization_id=v_org
      join public.assets a on a.id=r.asset_id and a.organization_id=v_org
    union all select s.*,coalesce(w.site_id,a.site_id),
      w.site_id is not null and a.site_id is not null and w.site_id<>a.site_id from raw_subjects s
      join public.work_orders w on s.subject_type='work_order' and w.id=s.subject_uuid and w.organization_id=v_org
      left join public.assets a on a.id=w.asset_id and a.organization_id=v_org
      where (w.asset_id is null or a.id is not null) and (w.risk_id is null or public.can_read_risk(w.risk_id))
    union all select s.*,a.site_id,false from raw_subjects s
      join public.evidence_items e on s.subject_type='evidence' and e.id=s.subject_uuid and e.organization_id=v_org
      left join public.assets a on a.id=e.asset_id and a.organization_id=v_org
      where (e.asset_id is null or a.id is not null) and (e.risk_id is null or public.can_read_risk(e.risk_id))
    union all select s.*,a.site_id,false from raw_subjects s
      join public.recommendations r on s.subject_type='recommendation' and r.id=s.subject_uuid and r.organization_id=v_org
      left join public.assets a on a.id=r.asset_id and a.organization_id=v_org
      where (r.asset_id is null or a.id is not null) and (r.risk_id is null or public.can_read_risk(r.risk_id))
    union all select s.*,a.site_id,false from raw_subjects s
      join public.decisions d on s.subject_type='decision' and d.id=s.subject_uuid and d.organization_id=v_org
      left join public.assets a on a.id=d.asset_id and a.organization_id=v_org
      where (d.asset_id is null or a.id is not null) and (d.risk_id is null or public.can_read_risk(d.risk_id))
    union all select s.*,coalesce(w.site_id,wa.site_id,ra.site_id,da.site_id),
      (select count(distinct x) from unnest(array[w.site_id,wa.site_id,ra.site_id,da.site_id]) x)>1
      from raw_subjects s
      join public.approvals ap on s.subject_type='approval' and ap.id=s.subject_uuid and ap.organization_id=v_org
      left join public.work_orders w on w.id=ap.work_order_id and w.organization_id=v_org
      left join public.assets wa on wa.id=w.asset_id and wa.organization_id=v_org
      left join public.recommendations r on r.id=ap.recommendation_id and r.organization_id=v_org
      left join public.assets ra on ra.id=r.asset_id and ra.organization_id=v_org
      left join public.decisions d on d.id=ap.decision_id and d.organization_id=v_org
      left join public.assets da on da.id=d.asset_id and da.organization_id=v_org
      where (ap.risk_id is null or public.can_read_risk(ap.risk_id))
        and (ap.work_order_id is null or (w.id is not null and (w.risk_id is null or public.can_read_risk(w.risk_id))))
        and (ap.recommendation_id is null or (r.id is not null and (r.risk_id is null or public.can_read_risk(r.risk_id))))
        and (ap.decision_id is null or (d.id is not null and (d.risk_id is null or public.can_read_risk(d.risk_id))))
    union all select s.*,coalesce(r.site_id,a.site_id),
      r.site_id is not null and a.site_id is not null and r.site_id<>a.site_id from raw_subjects s
      join public.risks r on s.subject_type='risk' and r.id=s.subject_uuid and r.organization_id=v_org
      left join public.assets a on a.id=r.asset_id and a.organization_id=v_org
      where public.can_read_risk(r.id) and (r.asset_id is null or a.id is not null)
    union all select s.*,coalesce(r.site_id,a.site_id),
      r.site_id is not null and a.site_id is not null and r.site_id<>a.site_id from raw_subjects s
      join public.restoration_events r on s.subject_type='recovery' and r.id=s.subject_uuid and r.organization_id=v_org
      join public.assets a on a.id=r.asset_id and a.organization_id=v_org
    union all select s.*,d.site_id,false from raw_subjects s
      join public.development_cases d on s.subject_type='development_case' and d.id=s.subject_uuid and d.organization_id=v_org
    union all select s.*,p.site_id,false from raw_subjects s
      join public.capital_projects p on s.subject_type='capital_project' and p.id=s.subject_number and p.organization_id=v_org
    union all select s.*,null::uuid,false from raw_subjects s
      join public.audit_events e on s.subject_type='audit_event' and e.id=s.subject_uuid and e.organization_id=v_org
  ), consistent_links as materialized (
    -- A SINGLE link cannot bind an asset at Site A and a different Site B.
    -- Separate consistent links for deliberately multi-site features are legal.
    select link_id from resolved_subjects group by link_id
      having not bool_or(scope_conflict) and count(distinct site_id)<=1
  ), scoped_subjects as materialized (
    select distinct feature_id,subject_type,subject_uuid,subject_number from resolved_subjects s
    where exists(select 1 from consistent_links cl where cl.link_id=s.link_id)
      and (site_id is null or exists(select 1 from public.sites si where si.id=s.site_id and si.organization_id=v_org))
      and (p_site_id is null or site_id=p_site_id)
  ), feature_candidates as materialized (
    select f.*, case when f.feature_type in ('hazard_zone','weather_cell','receptor') then 'hazards_geofences' else 'assets_sites' end layer_id,
      c.id source_id,c.rights_ok,c.health_ok,c.clock_ok,c.effective_state,
      exists(select 1 from scoped_subjects s where s.feature_id=f.id) linked
    from public.geospatial_features f left join effective_sources c on c.id=f.source_connector_id and c.organization_id=f.organization_id
    where f.organization_id=v_org and v_role<>'technician' and f.status in ('draft','verified')
      and ((p_site_id is null and (not exists(select 1 from public.geospatial_subject_links l where l.feature_id=f.id and l.organization_id=v_org)
          or exists(select 1 from raw_subjects s where s.feature_id=f.id)))
        or exists(select 1 from resolved_subjects s where s.feature_id=f.id and s.site_id=p_site_id))
  ), classified_features as materialized (
    -- One disjoint exclusion per candidate, in this declared precedence.
    -- Conservative escaped-wire upper bound, computed WITHOUT building JSON
    -- arrays/projections. Six bytes per raw text byte covers JSON escaping.
    select f.*,b.payload_budget,case
      when f.status<>'verified' then 'draftExcluded'
      when f.valid_until is not null and f.valid_until<=v_generated_at then 'expiredExcluded'
      when not f.linked and exists(select 1 from resolved_subjects s where s.feature_id=f.id
        and not exists(select 1 from consistent_links cl where cl.link_id=s.link_id)) then 'scopeConflict'
      when not f.linked then 'unlinkedExcluded'
      when f.source_id is null then 'sourceMissing'
      when not f.rights_ok then 'rightsBlocked'
      when not f.health_ok or not f.clock_ok then 'healthBlocked'
      when not coalesce(isfinite(f.observed_at) and f.observed_at<=v_generated_at
        and isfinite(f.verified_at) and f.verified_at<=v_generated_at
        and f.observed_at<=f.verified_at
        and ((f.validity_kind='permanent' and f.valid_until is null)
          or (f.validity_kind='temporary' and isfinite(f.valid_until) and f.valid_until>v_generated_at)),false) then 'timeBlocked'
      when not coalesce(f.coordinate_reference_system='EPSG:4326' and f.coordinate_axis_order='longitude_latitude'
        and length(btrim(f.coordinate_basis))>=20 and length(f.coordinate_basis)<=4000
        and (f.horizontal_accuracy_m is null or f.horizontal_accuracy_m between 5e-324::numeric and 1.7976931348623157e308::numeric)
        and public.sync_context_geometry_is_valid(f.geometry,f.geometry_type),false) then 'coordinateContractMissing'
      when octet_length(f.geometry::text)>65536 or length(f.name)>4000 or length(f.source_reference)>4000
        or cardinality(f.evidence_item_ids)>256 or cardinality(f.missing_evidence)>256
        or exists(select 1 from unnest(f.missing_evidence) x(value) where length(x.value)>4000)
        or (select count(*) from scoped_subjects s where s.feature_id=f.id)>256
        or b.payload_budget>131072 then 'payloadBlocked'
      when f.context_owner_id is null or f.verified_by is null or f.verified_by=f.recorded_by
        or cardinality(f.evidence_item_ids)=0 or exists(select 1 from unnest(f.evidence_item_ids) x(id)
          left join public.evidence_items e on e.id=x.id and e.organization_id=v_org
          where e.id is null or e.verification_status is distinct from 'verified'
            or not coalesce(isfinite(e.ts) and isfinite(e.verified_at)
              and e.ts<=e.verified_at and e.verified_at<=f.verified_at,false)
            or (e.risk_id is not null and not public.can_read_risk(e.risk_id))) then 'evidenceBlocked'
      else null end exclusion
    from feature_candidates f cross join lateral (select
      4096::bigint+octet_length(f.geometry::text)
      +6::bigint*(coalesce(octet_length(f.name),0)+coalesce(octet_length(f.source_reference),0)
        +coalesce(octet_length(f.coordinate_basis),0)
        +coalesce((select sum(octet_length(x.value)::bigint) from unnest(f.missing_evidence) x(value)),0))
      +40::bigint*coalesce(cardinality(f.evidence_item_ids),0)
      +128::bigint*(select count(*) from scoped_subjects s where s.feature_id=f.id)
      +6::bigint*coalesce((select octet_length(c.connector_key) from effective_sources c where c.id=f.source_id),0)
      payload_budget) b
  ), eligible_features as materialized (
    select * from classified_features where exclusion is null
  ), returned_features as materialized (
    select * from eligible_features order by observed_at desc,id asc limit p_object_limit
  ), work_candidates as materialized (
    select h.id,h.changed_at,h.status_to,w.id work_id,w.title,w.organization_id,c.id source_id,c.rights_ok,c.health_ok,c.clock_ok,c.effective_state
    from public.work_order_status_history h join public.work_orders w on w.id=h.work_order_id and w.organization_id=v_org
    left join public.assets a on a.id=w.asset_id and a.organization_id=v_org
    left join public.recommendations r on r.id=w.recommendation_id and r.organization_id=v_org
    left join effective_sources c on c.connector_key=w.source_system and c.organization_id=w.organization_id
    where v_role<>'technician' and (w.risk_id is null or public.can_read_risk(w.risk_id))
      and (w.recommendation_id is null or (r.id is not null and (r.risk_id is null or public.can_read_risk(r.risk_id))))
      and (w.asset_id is null or a.id is not null)
      and not (w.site_id is not null and a.site_id is not null and w.site_id<>a.site_id)
      and (w.site_id is null or exists(select 1 from public.sites si where si.id=w.site_id and si.organization_id=v_org))
      and (p_site_id is null or coalesce(w.site_id,a.site_id)=p_site_id)
  ), eligible_work as materialized (
    select w.* from work_candidates w where w.source_id is not null and w.rights_ok and w.health_ok and w.clock_ok
      and isfinite(w.changed_at) and w.changed_at<=v_generated_at
      and coalesce(length(w.title)<=4000 and octet_length(w.title)<=16384,true)
  ), event_candidates as materialized (
    -- Counts/sorts carry ONLY fixed-width identities and timestamps. No full
    -- title/evidence/approval projection is allocated for omitted events.
    select 'feature:'||f.id::text id,f.observed_at occurred_at,f.id record_id,'feature'::text record_type
      from eligible_features f
    union all select 'work:'||w.id::text,w.changed_at,w.id,'work' from eligible_work w
  ), returned_event_candidates as materialized (
    select * from event_candidates order by occurred_at desc,id asc limit p_event_limit
  ), returned_event_features as materialized (
    select f.* from returned_event_candidates e join eligible_features f
      on e.record_type='feature' and e.record_id=f.id
  ), returned_event_work as materialized (
    select w.* from returned_event_candidates e join eligible_work w
      on e.record_type='work' and e.record_id=w.id
  ), returned_events as (
    select 'feature:'||f.id::text id,f.observed_at occurred_at,f.layer_id,f.source_id,
      jsonb_build_object('id','feature:'||f.id::text,'organizationId',v_org,'layerId',f.layer_id,
        'kind',case when f.feature_type='hazard_zone' then 'hazard' else 'observation' end,'title',f.name,
        'occurredAt',f.observed_at,'canonicalRecord',jsonb_build_object('type','geospatial_feature','id',f.id),
        'source',jsonb_build_object('id',c.id,'organizationId',v_org,'key',c.connector_key,'class',c.context_source_class),
        'governanceState','recommended','approvalId',null,'operationalAuthority',false,
        'evidenceIds',f.evidence_item_ids,'engineeringClaims','[]'::jsonb) record
    from returned_event_features f join effective_sources c on c.id=f.source_id
    union all
    select 'work:'||w.id::text,w.changed_at,'work_events',w.source_id,
      jsonb_build_object('id','work:'||w.id::text,'organizationId',v_org,'layerId','work_events','kind','work',
        'title',coalesce(w.title,'Work status changed'),'occurredAt',w.changed_at,
        'canonicalRecord',jsonb_build_object('type','work_order','id',w.work_id),
        'source',jsonb_build_object('id',c.id,'organizationId',v_org,'key',c.connector_key,'class',c.context_source_class),
        'governanceState',case when w.status_to in ('in_progress','completed') then 'executed'
          when ap.status='approved' then 'approved' when w.status_to in ('pending','draft') then 'draft' else 'recommended' end,
        'approvalId',case when ap.status='approved' then ap.approval_id else null end,
        'operationalAuthority',false,'evidenceIds','[]'::jsonb,'engineeringClaims','[]'::jsonb)
    from returned_event_work w join effective_sources c on c.id=w.source_id
    left join lateral (
      select e.new_state->>'status' status,a.id approval_id
      from public.audit_events e join public.approvals a on a.id::text=e.event_data->>'approval_id'
        and a.organization_id=v_org and a.work_order_id=w.work_id and (a.risk_id is null or public.can_read_risk(a.risk_id))
      left join public.recommendations r on r.id=a.recommendation_id and r.organization_id=v_org
      left join public.decisions d on d.id=a.decision_id and d.organization_id=v_org
      left join public.recommendations dr on dr.id=d.recommendation_id and dr.organization_id=v_org
      where e.organization_id=v_org and e.entity_type='approval_decision' and e.event_data->>'work_order_id'=w.work_id::text
        and isfinite(e.event_time) and e.event_time<=w.changed_at
        and (a.recommendation_id is null or (r.id is not null and (r.risk_id is null or public.can_read_risk(r.risk_id))))
        and (a.decision_id is null or (d.id is not null and (d.risk_id is null or public.can_read_risk(d.risk_id))))
        and (d.recommendation_id is null or (dr.id is not null and (dr.risk_id is null or public.can_read_risk(dr.risk_id))))
      order by e.event_time desc,e.created_at desc,e.id asc limit 1
    ) ap on true
  ), layer_definitions(id,label,render_mode) as (
    values('assets_sites','Assets and sites','object'),('hazards_geofences','Hazards and geofences','polygon'),('work_events','Work and operating events','event')
  ), layer_candidates as materialized (
    select layer_id,source_id,exclusion is null eligible from classified_features
    union all select 'work_events',w.source_id,exists(select 1 from eligible_work e where e.id=w.id) from work_candidates w
  ), layer_populations as materialized (
    select l.*,count(c.layer_id) candidate_count,count(c.layer_id) filter(where c.eligible) eligible_count,
      coalesce(array_agg(distinct c.source_id order by c.source_id) filter(where c.source_id is not null),'{}'::uuid[]) source_ids
    from layer_definitions l left join layer_candidates c on c.layer_id=l.id group by l.id,l.label,l.render_mode
  ), used_sources as materialized (
    select c.* from effective_sources c where exists(select 1 from layer_candidates l where l.source_id=c.id)
  )
  select case when (select count(*) from used_sources)>500 or exists(select 1 from used_sources c
    where length(c.connector_key)>256 or length(c.name)>4000 or length(c.context_purpose)>4000 or length(c.context_health_detail)>4000)
    then jsonb_build_object('error','operating query exceeds source display budget; narrow scope or repair source metadata')
    -- Pre-allocation budget: refuse the whole query, never silently slice
    -- evidence or change caller limits. The final exact-byte check is defense
    -- in depth, not the first allocation bound.
    when 65536::bigint
      +coalesce((select sum(payload_budget) from returned_features),0)
      +coalesce((select sum(payload_budget) from returned_event_features),0)
      +coalesce((select sum(4096::bigint+6::bigint*(coalesce(octet_length(w.title),0)
        +coalesce(octet_length(c.connector_key),0))) from returned_event_work w join effective_sources c on c.id=w.source_id),0)
      +coalesce((select sum(4096::bigint+6::bigint*(coalesce(octet_length(c.connector_key),0)
        +coalesce(octet_length(c.name),0)+coalesce(octet_length(c.context_purpose),0)
        +coalesce(octet_length(c.context_health_detail),0))) from used_sources c),0)>8388608
    then jsonb_build_object('error','operating query exceeds response budget; narrow scope or lower limits')
    else jsonb_build_object('organizationId',v_org,'generatedAt',v_generated_at,'operationalAuthority',false,
    'scope',jsonb_build_object('siteId',p_site_id,'objectLimit',p_object_limit,'eventLimit',p_event_limit),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'organizationId',v_org,'key',c.connector_key,'name',c.name,
      'class',c.context_source_class,'authority',c.context_source_authority,'purpose',c.context_purpose,'rightsState',c.context_rights_state,
      'state',c.effective_state,'checkedAt',c.context_checked_at,'observedAt',c.context_observed_at,'detail',c.context_health_detail,
      'displayAsLive',c.clock_ok and c.health_ok and c.rights_ok and c.effective_state='live' and c.context_source_class<>'simulated_industrial'
        and (c.context_rights_state in ('production_approved','customer_authorized'))
      ) order by c.name,c.id) from used_sources c),'[]'::jsonb),
    'layers',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,'renderMode',l.render_mode,
      'authorized',v_role<>'technician','sourceDependencies',l.source_ids,
      'healthStates',coalesce((select jsonb_agg(distinct c.effective_state order by c.effective_state) from used_sources c where c.id=any(l.source_ids)),'[]'::jsonb),
      'recordCount',l.candidate_count,'candidateCount',l.candidate_count,'eligibleCount',l.eligible_count,'empty',l.candidate_count=0,
      'degraded',v_role<>'technician' and l.candidate_count>0 and (l.eligible_count<l.candidate_count or exists(select 1 from used_sources c
        where c.id=any(l.source_ids) and c.effective_state not in ('live','connected','simulated'))),
      'availability',case when v_role='technician' then 'unauthorized' when l.candidate_count=0 then 'empty'
        when l.eligible_count=0 then 'unavailable' when l.eligible_count<l.candidate_count or exists(select 1 from used_sources c
          where c.id=any(l.source_ids) and c.effective_state not in ('live','connected','simulated')) then 'degraded' else 'available' end,
      'issues',case when v_role='technician' then jsonb_build_array('Layer is not authorized for this role.')
        when l.candidate_count=0 then jsonb_build_array('No canonically scoped records; this is not proof of complete source coverage.')
        when l.eligible_count=0 then jsonb_build_array('Candidates exist but governance, evidence, coordinates or source health prevent emission; not empty.')
        when l.eligible_count<l.candidate_count then jsonb_build_array('Partial eligible population; consult exclusion counts and source health.') else '[]'::jsonb end
      ) order by l.id) from layer_populations l),'[]'::jsonb),
    'objects',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'organizationId',v_org,'layerId',f.layer_id,'kind',f.feature_type,'name',f.name,
      'geometryType',f.geometry_type,'geometry',jsonb_build_object('type',f.geometry_type,'coordinates',f.geometry->'coordinates'),
      'coordinate',jsonb_build_object('referenceSystem',f.coordinate_reference_system,
        'axisOrder',f.coordinate_axis_order,'basis',f.coordinate_basis,'horizontalAccuracyM',f.horizontal_accuracy_m),
      'sourceReference',f.source_reference,'source',jsonb_build_object('id',c.id,'organizationId',v_org,'key',c.connector_key,
        'class',c.context_source_class,'authority',c.context_source_authority,'healthState',c.effective_state),
      'observedAt',f.observed_at,'validUntil',f.valid_until,'validityKind',f.validity_kind,'freshness','current',
      'dataQuality',f.data_quality,'evidenceIds',f.evidence_item_ids,'missingEvidence',f.missing_evidence,'evidenceState','verified',
      'authority',jsonb_build_object('operational',false,'label','Verified context evidence — no operational approval'),
      'subjects',(select jsonb_agg(jsonb_build_object('type',s.subject_type,'id',coalesce(s.subject_uuid::text,s.subject_number::text))
        order by s.subject_type,s.subject_uuid,s.subject_number) from scoped_subjects s where s.feature_id=f.id),
      'engineeringClaims','[]'::jsonb) order by f.observed_at desc,f.id asc)
      from returned_features f join effective_sources c on c.id=f.source_id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(e.record order by e.occurred_at desc,e.id asc) from returned_events e),'[]'::jsonb),
    'coverage',jsonb_build_object('objects',jsonb_build_object('eligible',(select count(*) from eligible_features),
      'returned',(select count(*) from returned_features),'truncated',(select count(*) from eligible_features)>(select count(*) from returned_features),
      'draftExcluded',(select count(*) from classified_features where exclusion='draftExcluded'),
      'expiredExcluded',(select count(*) from classified_features where exclusion='expiredExcluded'),
      'unlinkedExcluded',(select count(*) from classified_features where exclusion='unlinkedExcluded'),
      'scopeConflict',(select count(*) from classified_features where exclusion='scopeConflict'),
      'sourceMissing',(select count(*) from classified_features where exclusion='sourceMissing'),
      'rightsBlocked',(select count(*) from classified_features where exclusion='rightsBlocked'),
      'healthBlocked',(select count(*) from classified_features where exclusion='healthBlocked'),
      'timeBlocked',(select count(*) from classified_features where exclusion='timeBlocked'),
      'coordinateContractMissing',(select count(*) from classified_features where exclusion='coordinateContractMissing'),
      'payloadBlocked',(select count(*) from classified_features where exclusion='payloadBlocked'),
      'evidenceBlocked',(select count(*) from classified_features where exclusion='evidenceBlocked')),
      'events',jsonb_build_object('eligible',(select count(*) from event_candidates),'returned',(select count(*) from returned_event_candidates),
        'truncated',(select count(*) from event_candidates)>(select count(*) from returned_event_candidates)))
    ) end into v_result;
  -- Technical transport budget only. Never slice evidence/dependencies to fit.
  if octet_length(v_result::text)>8388608 then
    return jsonb_build_object('error','operating query exceeds response budget; narrow scope or lower limits'); end if;
  return v_result;
end $$;
revoke all on function public.get_sync_context_operating_picture(uuid,integer,integer) from public,anon,service_role;
grant execute on function public.get_sync_context_operating_picture(uuid,integer,integer) to authenticated;
comment on function public.get_sync_context_operating_picture(uuid,integer,integer) is
  'SC-02 read-only tenant/role and canonical-site scoped projection. Candidate counts precede eligibility gates; eligible counts precede limits. Does not grant operational authority or certify source geometry.';


-- Separate metadata read, never an operating fallback or a site-coverage claim.
create or replace function public.get_sync_context_source_inventory()
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_generated_at timestamptz:=statement_timestamp(); v_count bigint; v_bytes bigint;
  v_invalid boolean; v_result jsonb;
begin
  if auth.uid() is null or v_org is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin')
    or not exists(select 1 from public.user_profiles u where u.id=auth.uid()
      and u.organization_id=v_org and u.role=v_role) then
    return jsonb_build_object('error','forbidden'); end if;
  -- Complete-or-refuse. Conservative escaped-wire bound BEFORE JSON allocation.
  select count(*),coalesce(sum(4096::bigint+6::bigint*(
    coalesce(octet_length(c.connector_key),0)+coalesce(octet_length(c.name),0)
    +coalesce(octet_length(c.context_purpose),0)+coalesce(octet_length(c.context_health_detail),0)
    +coalesce(octet_length(c.status),0))),0),
    coalesce(bool_or(c.connector_key is null or length(c.connector_key)>256
      or c.name is null or length(c.name)>4000
      or c.context_purpose is null or length(c.context_purpose)>4000
      or length(c.context_health_detail)>4000 or length(c.status)>256),false)
    into v_count,v_bytes,v_invalid
    from public.connectors c where c.organization_id=v_org and c.context_source_class is not null;
  if v_count>500 or v_bytes>8388608 or v_invalid then
    return jsonb_build_object('error','source inventory exceeds response budget; organization inventory unavailable'); end if;
  with source_states as materialized (
    select c.*,s.*,
      case when isfinite(c.context_checked_at) and c.context_checked_at<=v_generated_at
        then c.context_checked_at end safe_checked_at,
      case when isfinite(c.context_observed_at) and isfinite(c.context_checked_at)
        and c.context_checked_at<=v_generated_at and c.context_observed_at<=c.context_checked_at
        and c.context_observed_at<=v_generated_at then c.context_observed_at end safe_observed_at
    from public.connectors c
    cross join lateral public.sync_context_source_read_state(c,v_generated_at) s
    where c.organization_id=v_org and c.context_source_class is not null
  )
  select jsonb_build_object('organizationId',v_org,'generatedAt',v_generated_at,
    'scope','organization','complete',true,'operationalAuthority',false,
    'sources',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'organizationId',v_org,'key',c.connector_key,'name',c.name,
      'class',c.context_source_class,'authority',c.context_source_authority,'purpose',c.context_purpose,
      'rightsState',c.context_rights_state,'reportedHealthState',c.context_health_state,
      'state',c.effective_state,'enabled',c.enabled,'registryStatus',c.status,
      'checkedAt',c.safe_checked_at,'observedAt',c.safe_observed_at,
      'checkAgeSeconds',case when c.safe_checked_at is not null
        then extract(epoch from v_generated_at-c.safe_checked_at) end,
      'observationAgeSeconds',case when c.safe_observed_at is not null
        then extract(epoch from v_generated_at-c.safe_observed_at) end,
      'detail',c.context_health_detail,'clockValid',c.clock_ok,'rightsPermit',c.rights_ok,'healthPermit',c.health_ok,
      'canEmit',c.clock_ok and c.rights_ok and c.health_ok,
      'displayAsLive',c.clock_ok and c.rights_ok and c.health_ok and c.effective_state='live'
        and ((c.context_source_class='live_external' and c.context_rights_state='production_approved')
          or (c.context_source_class='customer_operational' and c.context_rights_state='customer_authorized')),
      'lastSuccessfulCheckAt',null,'lastSuccessfulCheckBasis','unknown_no_transport_receipt',
      'coverage',jsonb_build_object('state','unknown','basis','no_governed_coverage_measurement'),
      'issues',to_jsonb(array_remove(array[
        case when not c.clock_ok then 'invalid_source_clock' end,
        case when not c.rights_ok then 'rights_not_permitted' end,
        case when not c.health_ok then 'health_not_permitted' end,
        case when not coalesce(c.enabled and c.status='active',false) then 'disabled_or_inactive' end,
        case when c.effective_state='stale' then 'stale_observation' end
      ],null)),
      'operationalAuthority',false
    ) order by c.name collate "C",c.id) from source_states c),'[]'::jsonb)) into v_result;
  if octet_length(v_result::text)>8388608 then
    return jsonb_build_object('error','source inventory exceeds response budget; organization inventory unavailable'); end if;
  return v_result;
end $$;
revoke all on function public.get_sync_context_source_inventory() from public,anon,service_role;
grant execute on function public.get_sync_context_source_inventory() to authenticated;
comment on function public.get_sync_context_source_inventory() is
  'Read-only complete-or-refuse canonical classified organization sources including disconnected/blocked entries. Unknown coverage and transport-check success. No site coverage, geometry, actions or operational authority.';
notify pgrst,'reload schema';
