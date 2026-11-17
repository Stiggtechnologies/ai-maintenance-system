-- ============================================================================
-- C8.04 — identify maintenance-induced failures without converting temporal
-- proximity into a causal claim.
--
-- Canonical reuse:
--   * work_orders — the preceding intervention and later corrective failure;
--   * damage_mechanisms — the named-human-coded failure identity;
--   * fracas_investigation_packs — the retained causal-investigation pack;
--   * evidence_items — the only evidence model;
--   * audit_events — the only audit trail.
--
-- The screen is intentionally only a candidate screen. A named reliability
-- authority may confirm the classification only with a retained FRACAS pack,
-- a verified evidence basis for the exposure window and verified supporting
-- evidence. Reviews are append-only revisions and have no work, approval,
-- risk-acceptance, spend, operating-limit or return-to-service authority.
-- ============================================================================

create table if not exists public.maintenance_induced_failure_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  failure_work_order_id uuid not null references public.work_orders(id) on delete restrict,
  preceding_work_order_id uuid not null references public.work_orders(id) on delete restrict,
  fracas_investigation_pack_id uuid not null references public.fracas_investigation_packs(id) on delete restrict,
  verdict text not null check (verdict in ('confirmed','rejected','inconclusive')),
  cause_code text check (cause_code is null or cause_code in
    ('workmanship','reassembly','foreign_material','incorrect_part','incorrect_setting','maintenance_procedure','other_maintenance_origin')),
  exposure_window_hours integer not null check (exposure_window_hours between 1 and 2160),
  observed_gap_hours numeric not null check (observed_gap_hours >= 0),
  window_basis_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  supporting_evidence_item_ids uuid[] not null default '{}'::uuid[],
  basis text not null check (length(btrim(basis)) between 20 and 4000),
  revision integer not null check (revision > 0),
  supersedes_id uuid references public.maintenance_induced_failure_reviews(id) on delete restrict,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  check (
    (verdict='confirmed' and cause_code is not null and cardinality(supporting_evidence_item_ids)>0)
    or (verdict<>'confirmed' and cause_code is null)
  ),
  unique (organization_id,failure_work_order_id,revision),
  unique (supersedes_id)
);

create index if not exists idx_maintenance_induced_reviews_current
  on public.maintenance_induced_failure_reviews
    (organization_id,failure_work_order_id,revision desc);

alter table public.maintenance_induced_failure_reviews enable row level security;
drop policy if exists maintenance_induced_failure_reviews_read
  on public.maintenance_induced_failure_reviews;
create policy maintenance_induced_failure_reviews_read
  on public.maintenance_induced_failure_reviews
  for select to authenticated
  using (organization_id=public.app_current_org() and exists (
    select 1 from public.work_orders w
    where w.id=maintenance_induced_failure_reviews.failure_work_order_id
      and w.organization_id=maintenance_induced_failure_reviews.organization_id
      and (w.risk_id is null or public.can_read_risk(w.risk_id))
  ));

revoke insert,update,delete,truncate
  on public.maintenance_induced_failure_reviews
  from public,anon,authenticated;
grant select on public.maintenance_induced_failure_reviews to authenticated;

create or replace function public.protect_maintenance_induced_failure_review()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_failure public.work_orders%rowtype;
  v_preceding public.work_orders%rowtype;
  v_pack public.fracas_investigation_packs%rowtype;
  v_verified_count integer;
  v_distinct_count integer;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'maintenance-induced failure reviews are append-only';
  end if;
  if coalesce(current_setting('app.maintenance_induced_review_write',true),'')<>'granted'
     or auth.uid() is null or new.reviewed_by is distinct from auth.uid() then
    raise exception 'maintenance-induced failure reviews require the governed named-human workflow';
  end if;

  select * into v_failure from public.work_orders
  where id=new.failure_work_order_id and organization_id=new.organization_id;
  select * into v_preceding from public.work_orders
  where id=new.preceding_work_order_id and organization_id=new.organization_id;
  select * into v_pack from public.fracas_investigation_packs
  where id=new.fracas_investigation_pack_id and organization_id=new.organization_id;

  if v_failure.id is null or v_preceding.id is null or v_pack.id is null then
    raise exception 'review provenance must resolve inside one organization';
  end if;
  if (v_failure.risk_id is not null and not public.can_read_risk(v_failure.risk_id))
     or (v_preceding.risk_id is not null and not public.can_read_risk(v_preceding.risk_id)) then
    raise exception 'review sources are outside the caller risk-visibility boundary';
  end if;
  if v_failure.asset_id is null or v_preceding.asset_id is distinct from v_failure.asset_id
     or v_pack.asset_id is distinct from v_failure.asset_id
     or v_pack.work_order_id is distinct from v_failure.id then
    raise exception 'failure, intervention and FRACAS pack must name the same asset and failure';
  end if;
  if v_failure.work_type is distinct from 'corrective' or v_failure.completed_at is null
     or v_failure.failure_mechanism_id is null or v_failure.mechanism_coded_by is null
     or v_failure.mechanism_coded_at is null
     or coalesce(length(btrim(v_failure.mechanism_note)),0)<10 then
    raise exception 'classification requires completed corrective work with governed mechanism coding';
  end if;
  if v_preceding.completed_at is null or v_preceding.id=v_failure.id
     or coalesce(v_preceding.work_type,'corrective') not in ('corrective','preventive')
     or v_preceding.completed_at>v_failure.created_at then
    raise exception 'preceding work must be completed maintenance on the same asset before the failure record';
  end if;
  if new.observed_gap_hours is distinct from
       round((extract(epoch from (v_failure.created_at-v_preceding.completed_at))/3600.0)::numeric,3)
     or new.observed_gap_hours>new.exposure_window_hours then
    raise exception 'stored exposure must exactly match the source records and remain inside the stated window';
  end if;
  if not exists (
    select 1 from public.evidence_items e
    where e.id=new.window_basis_evidence_item_id
      and e.organization_id=new.organization_id
      and e.verification_status='verified'
      and (e.risk_id is null or public.can_read_risk(e.risk_id))
  ) then
    raise exception 'the exposure window requires verified same-tenant evidence';
  end if;

  select count(distinct x.id),count(e.id)
  into v_distinct_count,v_verified_count
  from unnest(new.supporting_evidence_item_ids) x(id)
  left join public.evidence_items e
    on e.id=x.id and e.organization_id=new.organization_id
   and e.verification_status='verified'
   and (e.risk_id is null or public.can_read_risk(e.risk_id));
  if v_distinct_count<>cardinality(new.supporting_evidence_item_ids)
     or v_verified_count<>cardinality(new.supporting_evidence_item_ids) then
    raise exception 'supporting evidence must be unique, verified and same-tenant';
  end if;
  if new.verdict='confirmed' and not exists (
    select 1 from unnest(new.supporting_evidence_item_ids) x(id)
    join public.evidence_items e on e.id=x.id
      and e.organization_id=new.organization_id
      and e.verification_status='verified'
      and (e.risk_id is null or public.can_read_risk(e.risk_id))
      and e.verified_by is distinct from new.reviewed_by
  ) then
    raise exception 'confirmed maintenance origin requires independently verified supporting evidence';
  end if;
  if new.supersedes_id is null and new.revision<>1 then
    raise exception 'the first review revision must be one';
  end if;
  if new.supersedes_id is not null and not exists (
    select 1 from public.maintenance_induced_failure_reviews prior
    where prior.id=new.supersedes_id
      and prior.organization_id=new.organization_id
      and prior.failure_work_order_id=new.failure_work_order_id
      and prior.revision=new.revision-1
  ) then
    raise exception 'review revision must extend the exact preceding review';
  end if;
  return new;
end
$$;

revoke all on function public.protect_maintenance_induced_failure_review()
  from public,anon,authenticated;
drop trigger if exists trg_protect_maintenance_induced_failure_review
  on public.maintenance_induced_failure_reviews;
create trigger trg_protect_maintenance_induced_failure_review
before insert or update or delete on public.maintenance_induced_failure_reviews
for each row execute function public.protect_maintenance_induced_failure_review();

create or replace function public.get_maintenance_induced_failure_candidates(
  p_exposure_window_hours integer default 168,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_window integer:=least(greatest(coalesce(p_exposure_window_hours,168),1),2160);
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  v_result jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  with candidate_pairs as (
    select f.id failure_id,f.wo_number failure_number,f.title failure_title,
      f.asset_id,a.tag asset_tag,a.name asset_name,dm.mechanism_key,dm.name mechanism_name,
      f.created_at failure_recorded_at,f.completed_at failure_completed_at,
      preceding.id preceding_id,preceding.wo_number preceding_number,
      preceding.title preceding_title,preceding.work_type preceding_type,
      preceding.completed_at preceding_completed_at,
      round((extract(epoch from (f.created_at-preceding.completed_at))/3600.0)::numeric,3) gap_hours,
      pack.id pack_id
    from public.work_orders f
    join public.assets a on a.id=f.asset_id and a.organization_id=f.organization_id
    join public.damage_mechanisms dm
      on dm.id=f.failure_mechanism_id and dm.organization_id=f.organization_id
    join lateral (
      select p.* from public.work_orders p
      where p.organization_id=f.organization_id and p.asset_id=f.asset_id
        and p.id<>f.id and p.completed_at is not null
        and (p.risk_id is null or public.can_read_risk(p.risk_id))
        and coalesce(p.work_type,'corrective') in ('corrective','preventive')
        and p.completed_at<=f.created_at
        and p.completed_at>=f.created_at-make_interval(hours=>v_window)
      order by p.completed_at desc,p.id desc limit 1
    ) preceding on true
    left join public.fracas_investigation_packs pack
      on pack.organization_id=f.organization_id and pack.work_order_id=f.id
    where f.organization_id=v_org and f.work_type='corrective'
      and (f.risk_id is null or public.can_read_risk(f.risk_id))
      and f.completed_at is not null and f.failure_mechanism_id is not null
      and f.mechanism_coded_by is not null and f.mechanism_coded_at is not null
      and coalesce(length(btrim(f.mechanism_note)),0)>=10
    order by f.created_at desc,f.id desc limit v_limit
  ), current_reviews as (
    select distinct on (r.failure_work_order_id) r.*
    from public.maintenance_induced_failure_reviews r
    where r.organization_id=v_org
      and exists (select 1 from public.work_orders visible_failure
        where visible_failure.id=r.failure_work_order_id
          and visible_failure.organization_id=v_org
          and (visible_failure.risk_id is null or public.can_read_risk(visible_failure.risk_id)))
    order by r.failure_work_order_id,r.revision desc
  ), totals as (
    select count(*)::int reviewed,
      count(*) filter(where verdict='confirmed')::int confirmed,
      count(*) filter(where verdict='rejected')::int rejected,
      count(*) filter(where verdict='inconclusive')::int inconclusive
    from current_reviews
  )
  select jsonb_build_object(
    'available',exists(select 1 from candidate_pairs),
    'exposureWindowHours',v_window,
    'candidateCount',(select count(*) from candidate_pairs),
    'reviewedCount',reviewed,'confirmedCount',confirmed,
    'rejectedCount',rejected,'inconclusiveCount',inconclusive,
    'basis','Candidates are completed, human-mechanism-coded corrective failures recorded after the latest completed maintenance on the same asset inside the selected screening window. Work-order created_at is the available detection/recording time, not a claimed physical failure time. Temporal proximity is never causation; only a named human may classify a case from a retained FRACAS pack and verified canonical evidence.',
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',e.description,'evidenceClass',e.evidence_class,
      'assetId',e.asset_id,'verifiedAt',e.verified_at,'verifiedBy',e.verified_by,
      'independentlyVerified',e.verified_by is distinct from auth.uid(),
      'verificationMethod',e.verification_method)
      order by e.verified_at desc,e.id)
      from (select * from public.evidence_items
        where organization_id=v_org and verification_status='verified'
          and (risk_id is null or public.can_read_risk(risk_id))
        order by verified_at desc,id limit 100) e),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(jsonb_build_object(
      'failureWorkOrderId',c.failure_id,'failureWorkOrderNumber',c.failure_number,
      'failureTitle',c.failure_title,'assetId',c.asset_id,'assetTag',c.asset_tag,
      'assetName',c.asset_name,'mechanismKey',c.mechanism_key,
      'mechanismName',c.mechanism_name,'failureRecordedAt',c.failure_recorded_at,
      'failureCompletedAt',c.failure_completed_at,
      'precedingWorkOrderId',c.preceding_id,'precedingWorkOrderNumber',c.preceding_number,
      'precedingTitle',c.preceding_title,'precedingWorkType',c.preceding_type,
      'precedingCompletedAt',c.preceding_completed_at,'observedGapHours',c.gap_hours,
      'fracasInvestigationPackId',c.pack_id,'readyForReview',c.pack_id is not null,
      'currentReview',case when r.id is null then null else jsonb_build_object(
        'id',r.id,'verdict',r.verdict,'causeCode',r.cause_code,
        'basis',r.basis,'revision',r.revision,'reviewedBy',r.reviewed_by,
        'reviewedAt',r.reviewed_at,'exposureWindowHours',r.exposure_window_hours,
        'windowBasisEvidenceItemId',r.window_basis_evidence_item_id,
        'supportingEvidenceItemIds',r.supporting_evidence_item_ids) end
    ) order by c.failure_recorded_at desc,c.failure_id) from candidate_pairs c
      left join current_reviews r on r.failure_work_order_id=c.failure_id),'[]'::jsonb)
  ) into v_result from totals;
  return v_result;
end
$$;

revoke all on function public.get_maintenance_induced_failure_candidates(integer,integer)
  from public,anon;
grant execute on function public.get_maintenance_induced_failure_candidates(integer,integer)
  to authenticated;

create or replace function public.review_maintenance_induced_failure(
  p_failure_work_order_id uuid,
  p_preceding_work_order_id uuid,
  p_fracas_investigation_pack_id uuid,
  p_verdict text,
  p_cause_code text,
  p_exposure_window_hours integer,
  p_window_basis_evidence_item_id uuid,
  p_supporting_evidence_item_ids uuid[],
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_failure public.work_orders%rowtype;
  v_preceding public.work_orders%rowtype;
  v_prior public.maintenance_induced_failure_reviews%rowtype;
  v_id uuid;
  v_revision integer;
  v_gap numeric;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','a named reliability engineer, maintenance manager or administrator must review the classification');
  end if;
  if coalesce(p_verdict,'') not in ('confirmed','rejected','inconclusive') then
    return jsonb_build_object('error','verdict must be confirmed, rejected or inconclusive');
  end if;
  if p_verdict='confirmed' and coalesce(p_cause_code,'') not in
    ('workmanship','reassembly','foreign_material','incorrect_part','incorrect_setting','maintenance_procedure','other_maintenance_origin') then
    return jsonb_build_object('error','confirmed maintenance origin requires a governed cause code');
  end if;
  if p_verdict<>'confirmed' and nullif(btrim(coalesce(p_cause_code,'')),'') is not null then
    return jsonb_build_object('error','a rejected or inconclusive case cannot retain a confirmed maintenance-origin code');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','review basis must contain at least 20 characters');
  end if;
  if coalesce(p_exposure_window_hours,0) not between 1 and 2160 then
    return jsonb_build_object('error','exposure window must be between 1 and 2160 hours');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_failure_work_order_id::text,0));
  select * into v_failure from public.work_orders
  where id=p_failure_work_order_id and organization_id=v_org
    and (risk_id is null or public.can_read_risk(risk_id));
  select * into v_preceding from public.work_orders
  where id=p_preceding_work_order_id and organization_id=v_org
    and (risk_id is null or public.can_read_risk(risk_id));
  if v_failure.id is null or v_preceding.id is null then
    return jsonb_build_object('error','failure or preceding maintenance work was not found');
  end if;
  if v_preceding.completed_at is null then
    return jsonb_build_object('error','preceding maintenance must be completed');
  end if;
  v_gap:=round((extract(epoch from (v_failure.created_at-v_preceding.completed_at))/3600.0)::numeric,3);
  if v_gap<0 or v_gap>p_exposure_window_hours then
    return jsonb_build_object('error','preceding maintenance is not inside the stated exposure window');
  end if;

  select * into v_prior from public.maintenance_induced_failure_reviews
  where organization_id=v_org and failure_work_order_id=p_failure_work_order_id
  order by revision desc limit 1;
  v_revision:=coalesce(v_prior.revision,0)+1;

  perform set_config('app.maintenance_induced_review_write','granted',true);
  insert into public.maintenance_induced_failure_reviews(
    organization_id,failure_work_order_id,preceding_work_order_id,
    fracas_investigation_pack_id,verdict,cause_code,exposure_window_hours,
    observed_gap_hours,window_basis_evidence_item_id,supporting_evidence_item_ids,
    basis,revision,supersedes_id,reviewed_by)
  values(
    v_org,p_failure_work_order_id,p_preceding_work_order_id,
    p_fracas_investigation_pack_id,p_verdict,
    case when p_verdict='confirmed' then p_cause_code else null end,
    p_exposure_window_hours,v_gap,p_window_basis_evidence_item_id,
    coalesce(p_supporting_evidence_item_ids,'{}'::uuid[]),btrim(p_basis),
    v_revision,v_prior.id,auth.uid())
  returning id into v_id;
  perform set_config('app.maintenance_induced_review_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_induced_failure_review',v_role,jsonb_build_object(
    'action','classification_recorded','review_id',v_id,
    'failure_work_order_id',p_failure_work_order_id,
    'preceding_work_order_id',p_preceding_work_order_id,
    'fracas_investigation_pack_id',p_fracas_investigation_pack_id,
    'verdict',p_verdict,'revision',v_revision,'reviewed_by',auth.uid(),
    'no_operational_authority',true));
  return jsonb_build_object(
    'reviewId',v_id,'verdict',p_verdict,'revision',v_revision,
    'observedGapHours',v_gap,
    'humanDecisionRequired',true,'mayChangeWork',false,'mayApprove',false,
    'mayAcceptRisk',false,'mayCommitSpend',false,'mayChangeOperatingLimits',false,
    'mayReturnToService',false);
exception when others then
  perform set_config('app.maintenance_induced_review_write','',true);
  raise;
end
$$;

revoke all on function public.review_maintenance_induced_failure(
  uuid,uuid,uuid,text,text,integer,uuid,uuid[],text)
  from public,anon;
grant execute on function public.review_maintenance_induced_failure(
  uuid,uuid,uuid,text,text,integer,uuid,uuid[],text)
  to authenticated;

notify pgrst,'reload schema';
