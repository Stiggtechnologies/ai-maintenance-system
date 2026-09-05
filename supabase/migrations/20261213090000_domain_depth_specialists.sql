-- ============================================================================
-- Domain-depth specialist runs (serialized after the current migration head).
--
-- Canonical reuse:
--   risks                 -- the decision/risk boundary
--   evidence_items        -- source provenance
--   model_register        -- model approval and human-in-loop posture
--   user_profiles         -- tenant and role authority
--   audit_events          -- immutable operating trail
--
-- The deterministic evaluator executes in the authenticated Edge Function.
-- This migration stores its bounded input/result envelope and enforces the
-- controls that must remain true even if a caller bypasses the UI:
--   * same-tenant risk and evidence only;
--   * only registered module/method pairs;
--   * output is always non-authoritative and human-review-required;
--   * no run can approve a recommendation, dispatch a crew, certify a system,
--     release an asset/product/facility, or change an operating limit.
-- ============================================================================

create table if not exists public.domain_specialist_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  risk_id uuid not null references public.risks(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  module_key text not null,
  method_key text not null,
  model_key text not null,
  model_version text not null,
  input_envelope jsonb not null,
  result_envelope jsonb not null,
  evidence_item_ids uuid[] not null default '{}',
  run_status text not null check (run_status in ('blocked','draft','reviewed','needs_changes','rejected')),
  authoritative boolean not null default false check (not authoritative),
  human_approval_required boolean not null default true check (human_approval_required),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  review_outcome text check (review_outcome is null or review_outcome in ('reviewed','needs_changes','rejected')),
  check (model_key = 'domain.' || module_key || '.' || method_key),
  check (jsonb_typeof(input_envelope) = 'object'),
  check (jsonb_typeof(result_envelope) = 'object'),
  check (octet_length(input_envelope::text) <= 1048576),
  check (octet_length(result_envelope::text) <= 1048576),
  check (
    (reviewed_at is null and reviewed_by is null and review_note is null and review_outcome is null)
    or
    (reviewed_at is not null and reviewed_by is not null and coalesce(length(btrim(review_note)),0) >= 20 and review_outcome is not null)
  )
);

create index if not exists idx_domain_specialist_runs_risk
  on public.domain_specialist_runs(organization_id, risk_id, created_at desc);
create index if not exists idx_domain_specialist_runs_model
  on public.domain_specialist_runs(organization_id, model_key, created_at desc);

alter table public.domain_specialist_runs enable row level security;
drop policy if exists domain_specialist_runs_org_read on public.domain_specialist_runs;
create policy domain_specialist_runs_org_read on public.domain_specialist_runs
  for select to authenticated
  using (organization_id = public.app_current_org());

create or replace function public.domain_specialist_method_is_registered(
  p_module_key text,
  p_method_key text
)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $$
  select (p_module_key, p_method_key) in (
    ('oil-sands-tailings','tailings-geotechnical'),
    ('oil-gas-well-integrity','well-integrity'),
    ('petrochemical-rbi','rbi-corrosion-loop'),
    ('utilities-storm-response','storm-crew-dispatch'),
    ('manufacturing-operations','line-balancing'),
    ('manufacturing-operations','robot-health'),
    ('food-beverage-safety','haccp-verification'),
    ('food-beverage-safety','cip-validation'),
    ('food-beverage-safety','cold-chain'),
    ('pharmaceutical-quality','gxp-validation'),
    ('pharmaceutical-quality','batch-record'),
    ('transport-logistics','route-depot-optimization'),
    ('transport-logistics','inspection-scheduling'),
    ('aviation-airworthiness','airworthiness-compliance'),
    ('aviation-airworthiness','msg3-trace'),
    ('aviation-airworthiness','life-limited-part'),
    ('marine-shipping','class-survey-scheduling'),
    ('marine-shipping','propulsion-efficiency'),
    ('marine-shipping','voyage-optimization'),
    ('data-center-thermal','thermal-airflow'),
    ('defense-readiness','mission-readiness'),
    ('defense-readiness','milspec-configuration'),
    ('defense-readiness','classified-deployment'),
    ('aerospace-launch','reuse-life'),
    ('aerospace-launch','range-safety'),
    ('aerospace-launch','propellant-degradation'),
    ('buildings-infrastructure','code-compliance'),
    ('buildings-infrastructure','fire-life-safety'),
    ('buildings-infrastructure','occupancy-accessibility')
  );
$$;

create or replace function public.record_domain_specialist_run(
  p_organization_id uuid,
  p_actor_id uuid,
  p_risk_id uuid,
  p_run jsonb,
  p_evidence_item_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := p_organization_id;
  v_role text;
  v_asset uuid;
  v_id uuid;
  v_module text := btrim(coalesce(p_run->>'moduleKey',''));
  v_method text := btrim(coalesce(p_run->>'methodKey',''));
  v_model text := btrim(coalesce(p_run->>'modelKey',''));
  v_version text := btrim(coalesce(p_run->>'modelVersion',''));
  v_status text := btrim(coalesce(p_run->>'status',''));
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('error','specialist persistence is service-only; execute through the authenticated Edge Function');
  end if;
  select role into v_role
  from public.user_profiles
  where id = p_actor_id and organization_id = v_org;
  if p_actor_id is null or v_role is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select asset_id into v_asset
  from public.risks
  where id = p_risk_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error','risk not found in this organization');
  end if;
  if not public.domain_specialist_method_is_registered(v_module,v_method) then
    return jsonb_build_object('error','domain specialist module/method is not registered');
  end if;
  if v_model <> 'domain.' || v_module || '.' || v_method then
    return jsonb_build_object('error','model key does not match the registered module/method');
  end if;
  if v_version = '' then
    return jsonb_build_object('error','model version is required');
  end if;
  if v_status not in ('blocked','draft') then
    return jsonb_build_object('error','new specialist runs must be blocked or draft');
  end if;
  if coalesce((p_run->>'authoritative')::boolean,true)
     or not coalesce((p_run->>'humanApprovalRequired')::boolean,false) then
    return jsonb_build_object('error','specialist output must be non-authoritative and require human approval');
  end if;
  if jsonb_typeof(coalesce(p_run->'inputs','null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_run->'result','null'::jsonb)) <> 'object' then
    return jsonb_build_object('error','bounded input and result objects are required');
  end if;
  if octet_length((p_run->'inputs')::text) > 1048576
     or octet_length((p_run->'result')::text) > 1048576 then
    return jsonb_build_object('error','specialist input/result exceeds the 1 MiB envelope limit');
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_evidence_item_ids,'{}'::uuid[])) evidence_id
    left join public.evidence_items evidence
      on evidence.id = evidence_id and evidence.organization_id = v_org and evidence.risk_id = p_risk_id
    where evidence.id is null
  ) then
    return jsonb_build_object('error','one or more evidence items are outside this risk or organization');
  end if;
  if v_status = 'draft' and cardinality(coalesce(p_evidence_item_ids,'{}'::uuid[])) = 0 then
    return jsonb_build_object('error','a computed draft must link at least one canonical evidence item');
  end if;

  insert into public.model_register (
    organization_id,model_key,version,model_kind,purpose,approved_for,
    human_in_loop,verification_reference,limitations
  ) values (
    v_org,v_model,v_version,'rule_based',
    'Governed domain-depth specialist calculation or trace verification.',
    '{}'::text[],true,'src/lib/domain-specialists/domain-specialists.test.ts',
    'Non-authoritative draft. Tenant/OEM/authority inputs and qualified human review are mandatory. The model cannot certify, release, dispatch, approve limits, or authorize operation.'
  ) on conflict (organization_id,model_key,version) do nothing;

  insert into public.domain_specialist_runs (
    organization_id,risk_id,asset_id,module_key,method_key,model_key,model_version,
    input_envelope,result_envelope,evidence_item_ids,run_status,
    authoritative,human_approval_required,created_by
  ) values (
    v_org,p_risk_id,v_asset,v_module,v_method,v_model,v_version,
    p_run->'inputs',p_run->'result',coalesce(p_evidence_item_ids,'{}'::uuid[]),v_status,
    false,true,p_actor_id
  ) returning id into v_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values (
    v_org,'domain_specialist_run',v_role,
    jsonb_build_object(
      'run_id',v_id,'risk_id',p_risk_id,'module_key',v_module,
      'method_key',v_method,'model_key',v_model,'model_version',v_version,
      'status',v_status,'authoritative',false,'human_approval_required',true,
      'evidence_count',cardinality(coalesce(p_evidence_item_ids,'{}'::uuid[]))
    )
  );
  return jsonb_build_object(
    'run_id',v_id,'status',v_status,'model_key',v_model,
    'authoritative',false,'human_approval_required',true
  );
end;
$$;

create or replace function public.review_domain_specialist_run(
  p_run_id uuid,
  p_outcome text,
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
  v_run public.domain_specialist_runs%rowtype;
begin
  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','independent domain review requires an authorized technical or management role');
  end if;
  select * into v_run
  from public.domain_specialist_runs
  where id = p_run_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','specialist run not found in this organization'); end if;
  if p_outcome not in ('reviewed','needs_changes','rejected') then
    return jsonb_build_object('error','invalid review outcome');
  end if;
  if coalesce(length(btrim(p_note)),0) < 20 then
    return jsonb_build_object('error','record at least 20 characters of review basis');
  end if;
  if v_run.created_by = auth.uid() then
    return jsonb_build_object('error','independent review cannot be completed by the run author');
  end if;
  if p_outcome = 'reviewed' and cardinality(v_run.evidence_item_ids) = 0 then
    return jsonb_build_object('error','a run without canonical evidence cannot be reviewed complete');
  end if;

  update public.domain_specialist_runs
  set run_status = p_outcome,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = btrim(p_note),
      review_outcome = p_outcome,
      authoritative = false,
      human_approval_required = true
  where id = v_run.id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values (
    v_org,'domain_specialist_review',v_role,
    jsonb_build_object(
      'run_id',v_run.id,'risk_id',v_run.risk_id,'outcome',p_outcome,
      'independent_reviewer',true,'authoritative',false,
      'note',btrim(p_note)
    )
  );
  return jsonb_build_object(
    'run_id',v_run.id,'status',p_outcome,'independent_reviewer',true,
    'authoritative',false,'human_approval_required',true
  );
end;
$$;

revoke all on table public.domain_specialist_runs from anon;
revoke all on function public.domain_specialist_method_is_registered(text,text) from public,anon;
revoke all on function public.record_domain_specialist_run(uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.review_domain_specialist_run(uuid,text,text) from public,anon;
grant select on table public.domain_specialist_runs to authenticated;
grant execute on function public.domain_specialist_method_is_registered(text,text) to authenticated,service_role;
grant execute on function public.record_domain_specialist_run(uuid,uuid,uuid,jsonb,uuid[]) to service_role;
grant execute on function public.review_domain_specialist_run(uuid,text,text) to authenticated,service_role;

insert into public.standards_capability_map
  (designation,capability_ref,capability_label,dependency,note)
values
  ('API 580','domain.petrochemical-rbi.rbi-corrosion-loop','RBI corrosion-loop screening','normative','Method calculates measured corrosion rate and remaining-life screens from supplied inputs; it is not a full API 581 implementation.'),
  ('API 581','domain.petrochemical-rbi.rbi-corrosion-loop','RBI risk-matrix and remaining-life screening','normative','PoF, CoF, damage factors and minimum thickness are authority inputs, never inferred by this method.'),
  ('MIL-HDBK-338B','domain.defense-readiness.mission-readiness','Defense mission-readiness reliability support','informative','The method uses command-approved readiness definitions and does not infer mission authorization.')
on conflict (designation,capability_ref) do update
set capability_label=excluded.capability_label,
    dependency=excluded.dependency,
    note=excluded.note;

notify pgrst, 'reload schema';
