-- ============================================================================
-- Sync Develop Slice 1 — Actions bound to a development case (D11.37).
--
-- PURE REUSE, BY RULING (register row D11.37, kept verbatim in spirit): the
-- canonical recommendation/action model + verification_obligations ARE the
-- action store (AGENTS.md invariant 3) — no new table is permitted and none
-- is created. The entire persistence change is ONE column and ONE index; the
-- rest of the register row's gap (rendering in the §44 Case Workspace actions
-- section) lands in the workspace read (20261105090500) and its surface.
--
-- An action reaches a case two ways, both rendered and labelled:
--   * DIRECT   — recommendations.development_case_id set through the binding
--                RPC below;
--   * VIA RISK — a recommendation whose risk_id belongs to a case-bound risk
--                (D5.22): treatments of the case's risks are the case's
--                actions without a second binding to maintain.
--
-- Binding is an audited act, not a §70 determination — no provenance trigger,
-- the same weight risk case-binding carries. The action's own lifecycle
-- (approval, verification obligation, closure) stays exactly where it lives
-- today: the recommendation approval machinery and verification_obligations
-- (20260901140000), consumed read-only by the workspace.
-- ============================================================================

alter table public.recommendations
  add column if not exists development_case_id uuid
    references development_cases(id) on delete set null;

create index if not exists idx_recommendations_case
  on recommendations(organization_id, development_case_id)
  where development_case_id is not null;

create or replace function public.bind_recommendation_to_case(
  p_recommendation_id uuid,
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
  r recommendations%rowtype;
  c development_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'binding an action to a case requires a planning, engineering or governance role');
  end if;
  select * into r from recommendations where id = p_recommendation_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'action (recommendation) not found in this organization');
  end if;

  if p_case_id is null then
    if r.development_case_id is null then
      return jsonb_build_object('error', 'this action is not bound to a case');
    end if;
    if coalesce(length(btrim(p_reason)), 0) < 10 then
      return jsonb_build_object('error',
        'unbinding an action from its case records why (10 characters minimum)');
    end if;
    update recommendations set development_case_id = null, updated_at = now() where id = r.id;
    insert into audit_events (organization_id, entity_type, actor, event_data)
    values (v_org, 'case_action_binding', coalesce(v_role, 'unknown'),
      jsonb_build_object('recommendation_id', r.id, 'action', 'unbound',
        'case_id', r.development_case_id, 'reason', btrim(p_reason)));
    return jsonb_build_object('recommendation_id', r.id, 'development_case_id', null);
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status in ('cancelled','completed') then
    return jsonb_build_object('error', 'actions are not bindable to a ' || c.status || ' case');
  end if;
  if r.development_case_id = c.id then
    return jsonb_build_object('error', 'this action is already bound to that case');
  end if;

  update recommendations set development_case_id = c.id, updated_at = now() where id = r.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_action_binding', coalesce(v_role, 'unknown'),
    jsonb_build_object('recommendation_id', r.id, 'action', 'bound',
      'case_id', c.id, 'title', r.title));

  return jsonb_build_object('recommendation_id', r.id, 'development_case_id', c.id);
end
$$;

revoke all on function public.bind_recommendation_to_case(uuid, uuid, text) from public, anon;
grant execute on function public.bind_recommendation_to_case(uuid, uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
