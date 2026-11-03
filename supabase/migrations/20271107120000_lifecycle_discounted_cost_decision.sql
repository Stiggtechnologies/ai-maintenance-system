-- ============================================================================
-- C8.09 — make the repair/replace/redesign/defer comparison a governed
-- life-cycle-cost method.
--
-- The customer surface already stored an undiscounted ranking and a human
-- decision. It did not call the discounted kernel, and it had no finance-owned
-- discount rate to call it with. This migration does not add a second cost
-- store or a second audit log:
--
--   * financial_assumptions remains the ONE numeric-assumption series. The
--     lifecycle real discount rate is the key `lifecycle.real_discount_rate`,
--     kind `discount_rate`. A trigger refuses every other writer, including
--     upsert_financial_assumption and the AI-operator identity.
--   * asset_economics remains the ONE economic-input snapshot. Cash flows are
--     built in TypeScript from those supplied values. This migration does not
--     read SAP, a connector, or any other external ledger.
--   * lifecycle_evaluations remains the frozen evaluation. The server binds
--     the current tenant policy into the inputs and does not reimplement the
--     present-value kernel in SQL.
--   * audit_events records both the policy write and the evaluation.
--   * decide_lifecycle_evaluation remains the human accept/reject/defer act.
--
-- No function here creates work, spends money, changes an operating limit, or
-- returns equipment to service.
-- ============================================================================

create or replace function public.guard_lifecycle_discount_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.assumption_key = 'lifecycle.real_discount_rate'
       and coalesce(current_setting('app.lifecycle_discount_writer', true), '') <> 'governed' then
      raise exception 'The lifecycle discount rate can change only through record_lifecycle_discount_policy';
    end if;
    return old;
  end if;

  if new.assumption_key = 'lifecycle.real_discount_rate' then
    if coalesce(current_setting('app.lifecycle_discount_writer', true), '') <> 'governed' then
      raise exception 'The lifecycle discount rate can change only through record_lifecycle_discount_policy';
    end if;
    if new.kind is distinct from 'discount_rate' then
      raise exception 'The lifecycle discount series must stay kind discount_rate';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_guard_lifecycle_discount_rate
  on public.financial_assumptions;
create trigger trg_guard_lifecycle_discount_rate
  before insert or update or delete on public.financial_assumptions
  for each row execute function public.guard_lifecycle_discount_rate();

revoke all on function public.guard_lifecycle_discount_rate()
  from public, anon, authenticated, service_role;

create or replace function public.get_lifecycle_discount_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  fa financial_assumptions%rowtype;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select * into fa
  from financial_assumptions
  where organization_id = v_org
    and assumption_key = 'lifecycle.real_discount_rate'
    and kind = 'discount_rate'
    and effective_from <= current_date
  order by effective_from desc, id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'assumptionId', null,
      'rateText', null,
      'owner', null,
      'basis', null,
      'effectiveFrom', null,
      'reviewDue', null,
      'refusal', 'No governed real discount rate is recorded for this tenant. An executive or administrator must record one with a named finance owner and a stated basis before repair, replace, redesign and defer can be ranked on life-cycle cost. The rate is not assumed.'
    );
  end if;

  if not public.sync_is_finite_numeric(fa.value)
     or fa.value < 0
     or fa.value >= 1
     or coalesce(length(btrim(fa.label)), 0) < 3
     or coalesce(length(btrim(fa.source)), 0) < 15
     or fa.review_due is null
     or fa.review_due < current_date then
    return jsonb_build_object(
      'assumptionId', fa.id::text,
      'rateText', null,
      'owner', null,
      'basis', null,
      'effectiveFrom', fa.effective_from,
      'reviewDue', fa.review_due,
      'refusal', 'The recorded lifecycle discount rate is not usable. It must be a finite rate in [0, 1), name an owner, carry a basis of at least 15 characters, and sit inside its review window. A stale or unowned rate is refused rather than applied.'
    );
  end if;

  return jsonb_build_object(
    'assumptionId', fa.id::text,
    'rateText', fa.value::text,
    'owner', btrim(fa.label),
    'basis', btrim(fa.source),
    'effectiveFrom', fa.effective_from,
    'reviewDue', fa.review_due,
    'refusal', null
  );
end
$$;

revoke all on function public.get_lifecycle_discount_policy() from public, anon;
grant execute on function public.get_lifecycle_discount_policy() to authenticated;

comment on function public.get_lifecycle_discount_policy() is
  'C8.09: current same-tenant lifecycle real discount rate, or a named refusal. Never a default rate.';

create or replace function public.record_lifecycle_discount_policy(
  p_rate numeric,
  p_owner text,
  p_basis text,
  p_effective_from date,
  p_review_due date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text := coalesce(public.app_current_role(), '');
  v_owner text := nullif(btrim(p_owner), '');
  v_basis text := nullif(btrim(p_basis), '');
  v_effective date := coalesce(p_effective_from, current_date);
  v_id bigint;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if v_role = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot set the discount rate that ranks a repair, replace, redesign or defer decision');
  end if;

  if v_role not in ('executive', 'admin') then
    return jsonb_build_object('error',
      'the lifecycle discount rate is a finance-owner act and requires an executive or administrator');
  end if;

  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal() <> 'aal2' then
    return jsonb_build_object('error',
      'Recording the lifecycle discount rate requires a verified factor and an AAL2 session');
  end if;

  if not public.sync_is_finite_numeric(p_rate) or p_rate < 0 or p_rate >= 1 then
    return jsonb_build_object('error',
      'discount rate must be a finite fraction in [0, 1)');
  end if;
  if v_owner is null or length(v_owner) < 3 then
    return jsonb_build_object('error',
      'name the finance owner of this rate (3 characters minimum)');
  end if;
  if v_basis is null or length(v_basis) < 15 then
    return jsonb_build_object('error',
      'state the basis of this rate (15 characters minimum)');
  end if;
  if p_review_due is null or p_review_due < v_effective or p_review_due < current_date then
    return jsonb_build_object('error',
      'the discount rate needs a review date on or after today and on or after its effective date');
  end if;

  if exists (
    select 1 from financial_assumptions
    where organization_id = v_org
      and assumption_key = 'lifecycle.real_discount_rate'
      and effective_from = v_effective
  ) then
    return jsonb_build_object('error',
      'a lifecycle discount rate effective on that date already exists; record a new effective date rather than overwriting the series');
  end if;

  perform set_config('app.lifecycle_discount_writer', 'governed', true);
  insert into financial_assumptions (
    organization_id, assumption_key, label, value, unit, source, kind,
    effective_from, review_due
  ) values (
    v_org, 'lifecycle.real_discount_rate', v_owner, p_rate, 'fraction', v_basis,
    'discount_rate', v_effective, p_review_due
  ) returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'lifecycle_discount_policy',
    v_role,
    jsonb_build_object(
      'assumption_id', v_id,
      'assumption_key', 'lifecycle.real_discount_rate',
      'rate', p_rate,
      'owner', v_owner,
      'effective_from', v_effective,
      'review_due', p_review_due,
      'execution', 'none'
    )
  );

  return jsonb_build_object(
    'assumptionId', v_id::text,
    'rateText', p_rate::text,
    'owner', v_owner,
    'basis', v_basis,
    'effectiveFrom', v_effective,
    'reviewDue', p_review_due,
    'operative', v_effective <= current_date,
    'refusal', null
  );
end
$$;

revoke all on function public.record_lifecycle_discount_policy(numeric, text, text, date, date)
  from public, anon;
grant execute on function public.record_lifecycle_discount_policy(numeric, text, text, date, date)
  to authenticated;

comment on function public.record_lifecycle_discount_policy(numeric, text, text, date, date) is
  'C8.09: executive or administrator records the tenant real discount rate. AI is refused. No operational or financial execution.';

create or replace function public.record_lifecycle_evaluation(
  p_asset_id uuid,
  p_inputs jsonb,
  p_options jsonb,
  p_recommended text,
  p_uncertainty_level text,
  p_uncertainty_reasons jsonb,
  p_rationale text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text := coalesce(public.app_current_role(), '');
  v_policy jsonb;
  v_inputs jsonb;
  v_id uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if v_role not in (
    'reliability_engineer', 'maintenance_manager', 'executive', 'admin', 'ai_admin'
  ) then
    return jsonb_build_object('error',
      'recording a lifecycle evaluation requires an engineering, management or executive role');
  end if;

  if not exists (
    select 1 from assets where id = p_asset_id and organization_id = v_org
  ) then
    return jsonb_build_object('error', 'asset not found');
  end if;

  if p_inputs is null or p_inputs = '{}'::jsonb or jsonb_typeof(p_options) <> 'array' then
    return jsonb_build_object('error',
      'an evaluation must carry the inputs and options it used');
  end if;

  if p_recommended is not null
     and p_recommended not in ('repair', 'replace', 'redesign', 'defer') then
    return jsonb_build_object('error',
      'recommended must be repair, replace, redesign, defer, or null');
  end if;

  if p_uncertainty_level not in ('low', 'moderate', 'high') then
    return jsonb_build_object('error',
      'uncertainty must be low, moderate or high');
  end if;

  if coalesce(length(btrim(p_rationale)), 0) < 10 then
    return jsonb_build_object('error', 'record the rationale for this evaluation');
  end if;

  v_policy := public.get_lifecycle_discount_policy();
  if v_policy ? 'error' then
    return v_policy;
  end if;

  if p_recommended is not null then
    if v_policy->>'refusal' is not null
       or coalesce(v_policy->>'assumptionId', '') = ''
       or coalesce(v_policy->>'rateText', '') = '' then
      return jsonb_build_object('error',
        'a lifecycle-cost recommendation requires a current governed discount rate');
    end if;
    if coalesce(p_inputs #>> '{discountPolicy,assumptionId}', '')
         is distinct from v_policy->>'assumptionId'
       or coalesce(p_inputs #>> '{discountPolicy,rateText}', '')
         is distinct from v_policy->>'rateText'
       or coalesce(p_inputs #>> '{discountPolicy,owner}', '')
         is distinct from v_policy->>'owner'
       or coalesce(p_inputs #>> '{discountPolicy,basis}', '')
         is distinct from v_policy->>'basis' then
      return jsonb_build_object('error',
        'the evaluation was priced on a different discount policy than the one now in force');
    end if;
    if coalesce(p_inputs #>> '{discounted,preferred}', '') is distinct from p_recommended then
      return jsonb_build_object('error',
        'the stored preference does not match the discounted comparison');
    end if;
  elsif coalesce(length(btrim(p_inputs #>> '{discounted,refusal}')), 0) < 10 then
    return jsonb_build_object('error',
      'an unranked lifecycle evaluation must record why the discounted comparison was refused');
  end if;

  v_inputs := p_inputs || jsonb_build_object('discountPolicy', v_policy);

  insert into lifecycle_evaluations (
    organization_id, asset_id, inputs, options, recommended,
    uncertainty_level, uncertainty_reasons, rationale, engine_version, evaluated_by
  ) values (
    v_org, p_asset_id, v_inputs, p_options, p_recommended,
    p_uncertainty_level, coalesce(p_uncertainty_reasons, '[]'::jsonb),
    btrim(p_rationale), 'lifecycle/2-discounted', auth.uid()
  ) returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'lifecycle_evaluation',
    v_role,
    jsonb_build_object(
      'evaluation_id', v_id,
      'asset_id', p_asset_id,
      'recommended', p_recommended,
      'uncertainty', p_uncertainty_level,
      'discount_assumption_id', v_policy->>'assumptionId',
      'discount_rate', v_policy->>'rateText',
      'execution', 'none'
    )
  );

  return jsonb_build_object(
    'evaluation_id', v_id,
    'recommended', p_recommended,
    'note', 'Recorded as a decision aid. It changes nothing until a human decides on it.'
  );
end
$$;

revoke all on function public.record_lifecycle_evaluation(uuid, jsonb, jsonb, text, text, jsonb, text)
  from public, anon;
grant execute on function public.record_lifecycle_evaluation(uuid, jsonb, jsonb, text, text, jsonb, text)
  to authenticated;

create or replace function public.decide_lifecycle_evaluation(
  p_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text := coalesce(public.app_current_role(), '');
  e lifecycle_evaluations%rowtype;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if v_role = 'ai_admin' then
    return jsonb_build_object('error',
      'deciding a lifecycle evaluation is a §70 human determination — the AI-operator identity records the evaluation and states its uncertainty; a human decides what the organization does about the asset');
  end if;

  if v_role not in (
    'maintenance_manager',
    'reliability_engineer',
    'executive',
    'admin'
  ) then
    return jsonb_build_object('error',
      'repair/replace decisions require maintenance management, reliability engineering or executive authority');
  end if;

  select * into e
  from lifecycle_evaluations
  where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evaluation not found');
  end if;
  if e.decision is not null then
    return jsonb_build_object('error', 'this evaluation was already ' || e.decision);
  end if;
  if p_decision not in ('accepted', 'rejected', 'deferred_decision') then
    return jsonb_build_object('error',
      'decision must be accepted, rejected or deferred_decision');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record the reasoning for this decision');
  end if;

  if e.uncertainty_level = 'high' and p_decision = 'accepted'
     and v_role not in ('reliability_engineer', 'executive', 'admin') then
    return jsonb_build_object('error',
      'this evaluation is high-uncertainty; accepting it requires engineering or executive authority');
  end if;

  update lifecycle_evaluations
  set decision = p_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = btrim(p_note)
  where id = p_id and organization_id = v_org;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'lifecycle_decision',
    v_role,
    jsonb_build_object(
      'evaluation_id', p_id,
      'decision', p_decision,
      'recommended', e.recommended,
      'uncertainty', e.uncertainty_level,
      'discount_assumption_id', e.inputs #>> '{discountPolicy,assumptionId}',
      'discount_rate', e.inputs #>> '{discountPolicy,rateText}',
      'execution', 'none'
    )
  );

  return jsonb_build_object(
    'evaluation_id', p_id,
    'decision', p_decision
  );
end
$$;

revoke all on function public.decide_lifecycle_evaluation(uuid, text, text)
  from public, anon;
grant execute on function public.decide_lifecycle_evaluation(uuid, text, text)
  to authenticated;

create or replace function public.get_lifecycle_position()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_assets int;
  v_priced int;
  v_policy jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  v_policy := public.get_lifecycle_discount_policy();

  select count(*) into v_assets from assets where organization_id = v_org;
  select count(distinct a.id) into v_priced
  from assets a
  join asset_economics e on e.organization_id = v_org
    and (e.asset_id = a.id or (e.asset_id is null and e.asset_class = a.asset_class))
  where a.organization_id = v_org;

  return jsonb_build_object(
    'assets', v_assets,
    'assets_with_economics', v_priced,
    'economics_coverage_pct', case when v_assets > 0
      then round(100.0 * v_priced / v_assets, 1) end,
    'discountPolicy', v_policy,
    'evaluations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', le.id, 'asset', a.name, 'recommended', le.recommended,
        'uncertainty', le.uncertainty_level,
        'uncertainty_reasons', le.uncertainty_reasons,
        'rationale', le.rationale, 'evaluated_at', le.evaluated_at,
        'decision', le.decision, 'decision_note', le.decision_note,
        'options', le.options) order by le.evaluated_at desc), '[]'::jsonb)
      from lifecycle_evaluations le
      join assets a on a.id = le.asset_id
      where le.organization_id = v_org
      limit 20),
    'note', case when v_priced = 0
      then 'No asset carries economic inputs. Repair-versus-replace is a money question, and the platform will report options as unpriced rather than invent a replacement value — an invented one produces a recommendation with the authority of arithmetic behind a number nobody chose.'
      else 'Evaluations are decision aids: recorded with their inputs and the governed discount rate, adopted only by a human.' end
  );
end
$$;

revoke all on function public.get_lifecycle_position() from public, anon;
grant execute on function public.get_lifecycle_position() to authenticated;

notify pgrst, 'reload schema';
