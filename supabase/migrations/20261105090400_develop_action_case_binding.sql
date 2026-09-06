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

-- ---------------------------------------------------------------------------
-- Case-binding provenance. `risks` case-binding needs no trigger because
-- `risks` has NO permissive client write policy — its development_case_id can
-- only move through the definer RPC. `recommendations` is different: it is the
-- canonical action store with a permissive `recommendations_org_rw` write
-- policy (the operating loop updates recommendation status directly), so a
-- client can `UPDATE recommendations SET development_case_id = NULL` and
-- silently pull an action off the case its gates were judged against, with no
-- audit — the same defect the RLS split closes on evidence/decisions, but here
-- the blunt "linked rows are read-only to clients" would break the legitimate
-- status writes the register keeps ("the action's own lifecycle stays exactly
-- where it lives today"). So the guard is COLUMN-scoped, not row-scoped: only a
-- change to development_case_id is governed; every other recommendation update
-- passes straight through. The one writer is bind_recommendation_to_case,
-- which sets a transaction-local marker. SECURITY INVOKER, the #282 idiom:
-- client (real or RLS-bypassed) refused; the true service path — including the
-- `on delete set null` cascade when a case is removed — admitted AND audited.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_recommendation_case_binding_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.recommendation_case_binding_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := new.organization_id;
  v_changed boolean;
  v_from text;
begin
  if tg_op = 'INSERT' then
    -- A pre-bound insert bypasses the audited bind exactly as an unlink does;
    -- normal recommendation inserts carry a null link and pass through.
    v_changed := new.development_case_id is not null;
    v_from := 'none';
  else
    v_changed := new.development_case_id is distinct from old.development_case_id;
    v_from := coalesce(old.development_case_id::text, 'none');
  end if;

  if not v_changed then
    return new;
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Recommendation ' || new.id::text || ' case binding written by a service '
           || 'caller (' || v_from || ' -> '
           || coalesce(new.development_case_id::text, 'none')
           || '), bypassing bind_recommendation_to_case().');
    end if;
    return new;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'An action''s case binding is an audited act. It cannot be written directly: '
      'call bind_recommendation_to_case(recommendation_id, case_id, reason), which '
      'records who bound or unbound it and when. A silent unlink erases the action '
      'from the case its gates were judged against.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$$;

drop trigger if exists trg_recommendation_case_binding_provenance on public.recommendations;
create trigger trg_recommendation_case_binding_provenance
  before insert or update on public.recommendations
  for each row execute function public.enforce_recommendation_case_binding_provenance();

revoke all on function public.enforce_recommendation_case_binding_provenance() from public, anon, authenticated;

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
    perform set_config('app.recommendation_case_binding_write', 'granted', true);
    update recommendations set development_case_id = null, updated_at = now() where id = r.id;
    perform set_config('app.recommendation_case_binding_write', '', true);
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

  perform set_config('app.recommendation_case_binding_write', 'granted', true);
  update recommendations set development_case_id = c.id, updated_at = now() where id = r.id;
  perform set_config('app.recommendation_case_binding_write', '', true);

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
