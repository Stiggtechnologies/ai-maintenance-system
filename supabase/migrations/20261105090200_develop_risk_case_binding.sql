-- ============================================================================
-- Sync Develop Slice 1 — Risk case-binding (D5.22, overlap-map ruling on §12).
--
-- The ruling is binding and total: the spec's §12 Risk MUST be the `risks`
-- table (the live ISO 31000 spine, 20260921110101). ZERO new risk tables —
-- this file adds ONE column, one index, one restrictive-write nothing (risks
-- is already SELECT-only to clients; every mutation is a definer RPC), and
-- the governed binding RPC. A project-risk table would repeat the exact
-- parallel-store failure this repository spent last week demoting.
--
-- Consumption (the other half of the register row's named gap):
--   * the Case Workspace read (20261105090500) lists the case's risks and
--     rolls up OPEN High/Critical ones;
--   * the client-side readiness rollup (src/lib/develop gateRollup, the #282
--     rollup this slice extends) renders those as NAMED blockers on the
--     current stage's gates — "a gate with unresolved HIGH risks shows them
--     as named blockers", spec workflow 2. No percentage is invented; the
--     blockers are names, which is what a blocker is.
--
-- Binding/unbinding is an audited governed act through the RPC below. It is
-- NOT a §70 determination (nothing is passed, accepted or sanctioned by
-- binding), so it carries no provenance trigger — the same weight the ROS
-- gives objective linkage.
-- ============================================================================

alter table public.risks
  add column if not exists development_case_id uuid
    references development_cases(id) on delete set null;

create index if not exists idx_risks_case
  on risks(organization_id, development_case_id)
  where development_case_id is not null;

create or replace function public.bind_risk_to_development_case(
  p_risk_id uuid,
  p_case_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  r risks%rowtype;
  c development_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'binding a risk to a case requires a planning, engineering or governance role');
  end if;
  select * into r from risks where id = p_risk_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'risk not found in this organization');
  end if;

  if p_case_id is null then
    if r.development_case_id is null then
      return jsonb_build_object('error', 'this risk is not bound to a case');
    end if;
    if coalesce(length(btrim(p_reason)), 0) < 10 then
      return jsonb_build_object('error',
        'unbinding a risk from its case records why (10 characters minimum) — the case''s risk picture is what its gates were judged against');
    end if;
    update risks set development_case_id = null, updated_at = now() where id = r.id;
    insert into audit_events (organization_id, entity_type, actor, event_data)
    values (v_org, 'case_risk_binding', coalesce(v_role, 'unknown'),
      jsonb_build_object('risk_id', r.id, 'action', 'unbound',
        'case_id', r.development_case_id, 'reason', btrim(p_reason)));
    return jsonb_build_object('risk_id', r.id, 'development_case_id', null);
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status in ('cancelled','completed') then
    return jsonb_build_object('error', 'risks are not bindable to a ' || c.status || ' case');
  end if;
  if r.development_case_id = c.id then
    return jsonb_build_object('error', 'this risk is already bound to that case');
  end if;

  update risks set development_case_id = c.id, updated_at = now() where id = r.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_risk_binding', coalesce(v_role, 'unknown'),
    jsonb_build_object('risk_id', r.id, 'action', 'bound', 'case_id', c.id,
      'risk_title', r.title, 'current_risk_level', r.current_risk_level));

  return jsonb_build_object('risk_id', r.id, 'development_case_id', c.id);
end
$$;

revoke all on function public.bind_risk_to_development_case(uuid, uuid, text) from public, anon;
grant execute on function public.bind_risk_to_development_case(uuid, uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
