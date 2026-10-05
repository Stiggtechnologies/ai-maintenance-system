-- C8.14 — every recommendation can name the failure mode or governed risk
-- scenario it addresses without creating another recommendation or risk store.
--
-- Canonical reuse:
--   * recommendations remains the ONE recommendation store;
--   * asset_failure_mode_libraries remains the ONE governed FMEA/RCM store;
--   * risks remains the ONE governed risk-scenario store;
--   * audit_events remains the ONE immutable act ledger.
--
-- Not every recommendation is failure-driven. A named human may therefore
-- record a substantive not-applicable disposition. C8.14 is visible in the
-- release-posture screen as advisory coverage; it does not silently turn an
-- organization-level commercial or workforce recommendation into an asset
-- failure claim.

alter table public.recommendations
  add column if not exists failure_mode_library_id uuid
    references public.asset_failure_mode_libraries(id) on delete restrict,
  add column if not exists failure_basis_kind text,
  add column if not exists failure_basis_note text,
  add column if not exists failure_basis_recorded_by uuid
    references auth.users(id) on delete restrict,
  add column if not exists failure_basis_recorded_at timestamptz;

alter table public.recommendations
  drop constraint if exists recommendation_failure_basis_shape;
alter table public.recommendations
  add constraint recommendation_failure_basis_shape check (
    (failure_basis_kind is null
      and failure_mode_library_id is null
      and failure_basis_note is null
      and failure_basis_recorded_by is null
      and failure_basis_recorded_at is null)
    or
    (failure_basis_kind in ('failure_mode','risk_scenario','not_applicable')
      and length(btrim(coalesce(failure_basis_note,''))) >= 20
      and failure_basis_recorded_by is not null
      and failure_basis_recorded_at is not null
      and case failure_basis_kind
        when 'failure_mode' then failure_mode_library_id is not null
        when 'risk_scenario' then risk_id is not null
        when 'not_applicable' then failure_mode_library_id is null and risk_id is null
        else false
      end)
  );

create index if not exists idx_recommendations_failure_mode
  on public.recommendations(organization_id, failure_mode_library_id)
  where failure_mode_library_id is not null;

create or replace function public.recommendation_failure_basis_valid(
  r public.recommendations
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case r.failure_basis_kind
    when 'failure_mode' then exists (
      select 1
      from public.asset_failure_mode_libraries f
      where f.id = r.failure_mode_library_id
        and f.organization_id = r.organization_id
        and f.rcm_status = 'reviewed'
        and nullif(btrim(f.failure_mode), '') is not null
        and (r.asset_id is null or f.canonical_asset_id is null
          or f.canonical_asset_id = r.asset_id)
    )
    when 'risk_scenario' then exists (
      select 1
      from public.risks x
      where x.id = r.risk_id
        and x.organization_id = r.organization_id
        and x.status not in ('draft','archived')
        and length(btrim(coalesce(x.event_description,''))) >= 20
        and (r.asset_id is null or x.asset_id is null or x.asset_id = r.asset_id)
    )
    when 'not_applicable' then r.failure_mode_library_id is null and r.risk_id is null
    else false
  end
  and length(btrim(coalesce(r.failure_basis_note,''))) >= 20
  and r.failure_basis_recorded_by is not null
  and r.failure_basis_recorded_at is not null;
$$;

revoke all on function public.recommendation_failure_basis_valid(
  public.recommendations
) from public, anon, authenticated, service_role;

create or replace function public.enforce_recommendation_failure_basis_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.recommendation_failure_basis_write', true) = 'granted' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.failure_mode_library_id is not null
       or new.failure_basis_kind is not null
       or new.failure_basis_note is not null
       or new.failure_basis_recorded_by is not null
       or new.failure_basis_recorded_at is not null then
      raise exception 'recommendation failure basis must use record_recommendation_failure_basis()'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.failure_mode_library_id is distinct from old.failure_mode_library_id
     or new.failure_basis_kind is distinct from old.failure_basis_kind
     or new.failure_basis_note is distinct from old.failure_basis_note
     or new.failure_basis_recorded_by is distinct from old.failure_basis_recorded_by
     or new.failure_basis_recorded_at is distinct from old.failure_basis_recorded_at
     or (new.risk_id is distinct from old.risk_id
       and (old.failure_basis_kind is not null or new.failure_basis_kind is not null)) then
    raise exception 'recommendation failure basis must use record_recommendation_failure_basis()'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_recommendation_failure_basis_write
  on public.recommendations;
create trigger trg_recommendation_failure_basis_write
  before insert or update of failure_mode_library_id, failure_basis_kind,
    failure_basis_note, failure_basis_recorded_by, failure_basis_recorded_at,
    risk_id
  on public.recommendations
  for each row execute function public.enforce_recommendation_failure_basis_write();

create or replace function public.record_recommendation_failure_basis(
  p_recommendation_id uuid,
  p_kind text,
  p_subject_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_rec public.recommendations%rowtype;
  v_failure public.asset_failure_mode_libraries%rowtype;
  v_risk public.risks%rowtype;
  v_previous jsonb;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','forbidden');
  end if;

  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role,'') = 'ai_admin' then
    return jsonb_build_object('error',
      'failure-basis classification is a named-human engineering judgement; AI may propose candidates but may not attest the link');
  end if;
  if coalesce(v_role,'') not in
     ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error',
      'failure-basis classification requires reliability engineering, maintenance management, executive or administrative authority');
  end if;
  if p_kind not in ('failure_mode','risk_scenario','not_applicable') then
    return jsonb_build_object('error','kind must be failure_mode, risk_scenario or not_applicable');
  end if;
  if length(btrim(coalesce(p_note,''))) < 20 then
    return jsonb_build_object('error','record a substantive basis note of at least 20 characters');
  end if;

  select * into v_rec from public.recommendations
  where id = p_recommendation_id and organization_id = v_org for update;
  if not found then return jsonb_build_object('error','recommendation not found'); end if;
  if v_rec.status in ('approved','released','scheduled') then
    return jsonb_build_object('error',
      'an approved or released recommendation cannot have its failure basis rewritten; return it to governed review first');
  end if;

  if p_kind = 'failure_mode' then
    if p_subject_id is null then return jsonb_build_object('error','failure mode is required'); end if;
    select * into v_failure from public.asset_failure_mode_libraries
    where id = p_subject_id and organization_id = v_org;
    if not found then return jsonb_build_object('error','same-tenant failure mode not found'); end if;
    if v_failure.rcm_status is distinct from 'reviewed'
       or nullif(btrim(v_failure.failure_mode),'') is null then
      return jsonb_build_object('error','failure mode must be independently reviewed in the governed RCM library');
    end if;
    if v_rec.asset_id is not null and v_failure.canonical_asset_id is not null
       and v_rec.asset_id <> v_failure.canonical_asset_id then
      return jsonb_build_object('error','failure mode belongs to a different asset');
    end if;
  elsif p_kind = 'risk_scenario' then
    if p_subject_id is null then return jsonb_build_object('error','risk scenario is required'); end if;
    select * into v_risk from public.risks
    where id = p_subject_id and organization_id = v_org;
    if not found then return jsonb_build_object('error','same-tenant risk scenario not found'); end if;
    if v_risk.status in ('draft','archived')
       or length(btrim(coalesce(v_risk.event_description,''))) < 20 then
      return jsonb_build_object('error','risk scenario must be identified, current and state a substantive event');
    end if;
    if v_rec.asset_id is not null and v_risk.asset_id is not null
       and v_rec.asset_id <> v_risk.asset_id then
      return jsonb_build_object('error','risk scenario belongs to a different asset');
    end if;
  elsif p_subject_id is not null then
    return jsonb_build_object('error','not_applicable must not carry a failure-mode or risk identifier');
  end if;

  v_previous := jsonb_build_object(
    'kind',v_rec.failure_basis_kind,
    'failureModeLibraryId',v_rec.failure_mode_library_id,
    'riskId',v_rec.risk_id,
    'note',v_rec.failure_basis_note,
    'recordedBy',v_rec.failure_basis_recorded_by,
    'recordedAt',v_rec.failure_basis_recorded_at
  );

  perform set_config('app.recommendation_failure_basis_write','granted',true);
  update public.recommendations set
    failure_basis_kind = p_kind,
    failure_mode_library_id = case when p_kind='failure_mode' then p_subject_id else null end,
    risk_id = case when p_kind='risk_scenario' then p_subject_id
                   when p_kind='not_applicable' then null else risk_id end,
    failure_basis_note = btrim(p_note),
    failure_basis_recorded_by = auth.uid(),
    failure_basis_recorded_at = now(),
    updated_at = now()
  where id = p_recommendation_id and organization_id = v_org;
  perform set_config('app.recommendation_failure_basis_write','',true);

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values (
    v_org,'recommendation_failure_basis',v_role,
    jsonb_build_object('recommendation_id',p_recommendation_id,'kind',p_kind,
      'subject_id',p_subject_id,'recorded_by',auth.uid()),
    v_previous,
    jsonb_build_object('kind',p_kind,
      'failureModeLibraryId',case when p_kind='failure_mode' then p_subject_id end,
      'riskId',case when p_kind='risk_scenario' then p_subject_id end,
      'note',btrim(p_note),'recordedBy',auth.uid())
  );

  return jsonb_build_object(
    'recommendationId',p_recommendation_id,
    'kind',p_kind,
    'subjectId',p_subject_id,
    'valid',true,
    'recordedBy',auth.uid(),
    'boundary','This classification does not approve the recommendation, accept risk, create work, change an operating limit or authorize return to service.',
    'operationalAuthorization',false
  );
end
$$;

revoke all on function public.record_recommendation_failure_basis(
  uuid,text,uuid,text
) from public, anon, service_role;
grant execute on function public.record_recommendation_failure_basis(
  uuid,text,uuid,text
) to authenticated;

create or replace function public.get_recommendation_failure_basis(
  p_recommendation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'recommendationId',r.id,
    'recommendationTitle',r.title,
    'kind',r.failure_basis_kind,
    'note',r.failure_basis_note,
    'recordedBy',r.failure_basis_recorded_by,
    'recordedAt',r.failure_basis_recorded_at,
    'valid',public.recommendation_failure_basis_valid(r),
    'failureMode',case when f.id is null then null else jsonb_build_object(
      'id',f.id,'failureMode',f.failure_mode,'functionalFailure',f.functional_failure,
      'assetId',f.canonical_asset_id,'status',f.rcm_status) end,
    'riskScenario',case when x.id is null then null else jsonb_build_object(
      'id',x.id,'title',x.title,'event',x.event_description,
      'assetId',x.asset_id,'status',x.status) end,
    'eligibleFailureModes',coalesce((select jsonb_agg(jsonb_build_object(
      'id',ef.id,'label',ef.failure_mode,'functionalFailure',ef.functional_failure,
      'assetId',ef.canonical_asset_id) order by ef.failure_mode)
      from public.asset_failure_mode_libraries ef
      where ef.organization_id=r.organization_id and ef.rcm_status='reviewed'
        and nullif(btrim(ef.failure_mode),'') is not null
        and (r.asset_id is null or ef.canonical_asset_id is null
          or ef.canonical_asset_id=r.asset_id)),'[]'::jsonb),
    'eligibleRiskScenarios',coalesce((select jsonb_agg(jsonb_build_object(
      'id',er.id,'label',er.title,'event',er.event_description,
      'assetId',er.asset_id,'status',er.status) order by er.title)
      from public.risks er
      where er.organization_id=r.organization_id
        and er.status not in ('draft','archived')
        and length(btrim(coalesce(er.event_description,'')))>=20
        and (r.asset_id is null or er.asset_id is null or er.asset_id=r.asset_id)),'[]'::jsonb),
    'boundary','Classification only; no operational or approval authority.',
    'operationalAuthorization',false
  )
  from public.recommendations r
  left join public.asset_failure_mode_libraries f
    on f.id=r.failure_mode_library_id and f.organization_id=r.organization_id
  left join public.risks x
    on x.id=r.risk_id and x.organization_id=r.organization_id
  where r.id=p_recommendation_id and r.organization_id=public.app_current_org();
$$;

revoke all on function public.get_recommendation_failure_basis(uuid)
  from public, anon;
grant execute on function public.get_recommendation_failure_basis(uuid)
  to authenticated, service_role;

-- The assumption attestation is bound to the exact failure/risk basis too.
create or replace function public.recommendation_assumption_context_digest(
  p_organization_id uuid,
  p_recommendation_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.recommendations%rowtype;
  v_payload jsonb;
begin
  select * into r from public.recommendations
  where id=p_recommendation_id and organization_id=p_organization_id;
  if not found then return null; end if;
  v_payload := jsonb_build_object(
    'recommendationId',r.id,'assetId',r.asset_id,'riskId',r.risk_id,
    'failureModeLibraryId',r.failure_mode_library_id,
    'failureBasisKind',r.failure_basis_kind,'failureBasisNote',r.failure_basis_note,
    'title',r.title,'issue',r.issue,'action',r.action,'impact',r.impact,
    'confidence',r.confidence,'rationale',r.rationale,
    'consequenceSummary',r.consequence_summary,
    'alternativesConsidered',r.alternatives_considered,
    'requiredCompletionDate',r.required_completion_date,
    'requiredApproverRole',r.required_approver_role,
    'verificationMethod',r.verification_method,
    'evidencePacketDigest',public.recommendation_evidence_packet_digest(
      r.organization_id,r.id)
  );
  return encode(extensions.digest(v_payload::text,'sha256'),'hex');
end
$$;

revoke all on function public.recommendation_assumption_context_digest(uuid,uuid)
  from public, anon, authenticated, service_role;

-- C8.14 is deliberately advisory. It is visible beside the binary fields and
-- cannot be mislabeled as a release blocker by the customer surface.
drop function if exists public.get_recommendation_contract_posture();
create or replace function public.get_recommendation_contract_posture()
returns table (
  register text,label text,blocking boolean,populated bigint,total bigint,
  share numeric,releasable_rows bigint,blocked_rows bigint
)
language sql stable security definer set search_path=public as $$
  with r as (select * from public.recommendations
    where organization_id=public.app_current_org()),
  t as (select count(*) n from r),
  rel as (select count(*) filter(where c.releasable) ok,
    count(*) filter(where not c.releasable) blocked
    from r,lateral public.check_recommendation_contract(r.id)c)
  select v.reg,v.lab,v.blk,v.pop,t.n,
    case when t.n>0 then round(v.pop::numeric/t.n,3) else 0 end,
    rel.ok,rel.blocked
  from t,rel,lateral(values
    ('C8.11','Asset/functional location or governed risk context',true,
      (select count(*) from r rr where rr.asset_id is not null or
        (rr.risk_id is not null and exists(select 1 from public.risks x
          where x.id=rr.risk_id and x.organization_id=rr.organization_id and x.context_id is not null)))),
    ('C8.12','Current condition or problem',true,(select count(*) from r rr where not public.contract_field_blank(rr.issue))),
    ('C8.13','Evidence used',true,(select count(*) from r rr where not public.contract_field_blank(rr.rationale))),
    ('C8.14','Failure mode, governed risk scenario or explicit not-applicable basis',false,
      (select count(*) from r rr where public.recommendation_failure_basis_valid(rr))),
    ('C5.24','Assumptions and validation plan',true,(select count(*) from r rr where
      public.recommendation_assumption_packet_valid(rr.assumption_packet) and
      rr.assumption_context_digest=public.recommendation_assumption_context_digest(rr.organization_id,rr.id))),
    ('C8.15','Consequence: safety, environmental, production, financial',true,(select count(*) from r rr where not public.contract_narrative_blank(rr.consequence_summary))),
    ('C8.16','Recommended action',true,(select count(*) from r rr where not public.contract_field_blank(rr.action))),
    ('C8.17','Alternative actions considered',true,(select count(*) from r rr where not public.contract_narrative_blank(rr.alternatives_considered))),
    ('C8.18','Required completion date',true,(select count(*) from r rr where rr.required_completion_date is not null)),
    ('C8.19','Confidence and uncertainty',true,(select count(*) from r rr where rr.confidence is not null)),
    ('C8.20','Required human approval (named authority)',true,(select count(*) from r rr where not public.contract_field_blank(rr.required_approver_role))),
    ('C8.21','Method for verifying effectiveness',true,(select count(*) from r rr where not public.contract_narrative_blank(rr.verification_method)))
  )v(reg,lab,blk,pop)
  order by 6,1;
$$;

revoke all on function public.get_recommendation_contract_posture()
  from public, anon;
grant execute on function public.get_recommendation_contract_posture()
  to authenticated, service_role;

notify pgrst,'reload schema';
