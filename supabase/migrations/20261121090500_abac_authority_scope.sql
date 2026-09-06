-- ============================================================================
-- Sync Develop Slice 3B — ABAC attributes on the ONE authority store
-- (D3.32, spec III.§41). Ruling 14 unchanged: authority_limits is extended,
-- never twinned.
--
-- WHAT ALREADY EXISTS (register row D3.32 verified, and partly stale): RBAC
-- is deep; authority_limits already carries value/risk/downtime ceilings
-- (20260808210000), risk kinds + required_competency_keys + max_exposure
-- (20260921110101:516), jurisdictions + asset_criticality_levels +
-- max_decision_value + assurance thresholds (20260921110102:377) — consumed
-- today by the RISK decision/acceptance family
-- (enforce_extended_risk_decision_authority / _acceptance_authority,
-- decide_risk_decision, accept_risk seven-arg).
--
-- WHAT THIS FILE ADDS — the §41 attributes the GENERAL approval path
-- (enforce_authority_limit, the recommendation-approval BEFORE-trigger)
-- could not see:
--
--   1. org_node_id — site/BU scope on the 20261120090000 five-level tree
--      (THE org-node model; the legacy sites table remains a location
--      register, named honestly in the register as a remaining dimension).
--      The column lands in 20261121090100 §3 with the ONE selection rule
--      every act site repeats verbatim; here the GENERAL approval trigger
--      consumes it: among adopted ladders, only those whose scope COVERS
--      the act (null = org-wide; node = act org inside its subtree) are
--      selectable, the most specific covering scope wins with version as
--      tie-break, and adopted-rows-that-cover-nothing REFUSE by name. So a
--      node-scoped delegation governs inside its subtree, the org-wide
--      ladder keeps governing everywhere else (a site adoption cannot
--      shadow it into blanket refusal, whatever the version order), and
--      scoping can never silently DISARM enforcement — outside every
--      adopted scope is a refusal, never a fallback to nothing.
--      on delete restrict: a node anchoring a delegation is not silently
--      removable.
--   2. asset criticality — consumed by enforce_authority_limit for the
--      recommendation's named asset (empty list = unscoped, every existing
--      row unchanged).
--   3. competency — required_competency_keys now bind the general approval
--      path with the same roster join the risk family uses (current,
--      unexpired member_competencies).
--   4. adopt_authority_limit supersedes PER SCOPE (marked insertion): a
--      site-scoped adoption cannot silently retire the org-wide ladder.
--   5. configure_risk_authority_scope (the one scope-authoring RPC, already
--      UI-wired at RiskEnterprisePanels:1420) gains org_node_id with a
--      tree-membership refusal.
--
-- Attribute dimensions that REMAIN unenforced on the general path after
-- this file (named in the register row): jurisdiction (consumed by the risk
-- family only — recommendations carry no jurisdiction attribute to test),
-- project-value bands beyond max_commitment_usd, and per-site (sites table)
-- scoping. Each lands when its subject carries the attribute.
-- ============================================================================

-- The org_node_id column, its index and its comment land in 20261121090100
-- §3 (the same file that opens the authority store to this slice), so every
-- act site defined between there and here — waiver decide, accept_risk,
-- sanction — consumes the scope rule from its first definition. This file
-- adds the GENERAL-path enforcement and the scope-keyed adoption.

-- ---------------------------------------------------------------------------
-- 1. adopt_authority_limit, re-created from its 20261101090500 definition
--    with ONE marked insertion (scope-keyed supersession).
-- ---------------------------------------------------------------------------
create or replace function public.adopt_authority_limit(
  p_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l authority_limits%rowtype;
  v_role text;
begin
  select role into v_role from user_profiles where id = auth.uid();
  -- Adopting a delegation of authority is itself an act of authority.
  if v_role not in ('admin', 'ai_admin', 'executive') then
    return jsonb_build_object('error',
      'adopting a delegation-of-authority limit requires an executive or administrator');
  end if;

  select * into l from authority_limits
  where id = p_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'limit not found');
  end if;
  if l.status <> 'draft' then
    return jsonb_build_object('error', 'only drafts can be adopted');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error',
      'state the delegation instrument this limit comes from (10 characters minimum)');
  end if;

  update authority_limits
  set status = 'superseded', superseded_by = l.id
  where organization_id = l.organization_id and role_key = l.role_key
    and action_type = l.action_type
    -- D3.32 (20261121090500, marked insertion): a node-scoped delegation
    -- supersedes its own scope only — adopting a site limit must not
    -- silently retire the org-wide one, nor the reverse.
    and org_node_id is not distinct from l.org_node_id
    and status = 'adopted';

  update authority_limits
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      basis = basis || ' | Adopted: ' || trim(p_note)
  where id = l.id;

  return jsonb_build_object('adopted', l.id, 'role_key', l.role_key);
end
$$;


grant execute on function public.adopt_authority_limit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. enforce_authority_limit, re-created from its 20261101090500 definition
--    with the three marked ABAC insertions (org-node scope, criticality,
--    competency). Everything else is byte-identical.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_authority_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  l authority_limits%rowtype;
  e engineering_approval_rules%rowtype;
  v_accept risk_acceptances%rowtype;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select role into v_role from user_profiles where id = auth.uid();

  -- E4.06: engineering sign-off is required of everyone, administrators
  -- included. It is a competence requirement, not a permission one.
  if new.change_class is not null then
    select * into e from engineering_approval_rules
    where organization_id = new.organization_id and change_class = new.change_class;
    if found and new.engineering_signed_at is null then
      raise exception
        'Engineering approval: "%" requires sign-off by the % role before approval.',
        e.title, e.required_role using errcode = 'check_violation';
    end if;
  end if;

  if v_role in ('admin', 'ai_admin') then
    return new;   -- platform administration is audited separately
  end if;

  -- D3.32 (20261121090500, marked insertions): the ABAC attribute
  -- conditions of the adopted limit, refused in the extended-authority
  -- idiom (20260921110102:1896 — outside the scope is a refusal, never a
  -- silent fallback to a wider delegation).
  -- (a) org-node scope, enforced IN the selection (the 20261121090100 §3
  -- rule, stated once and repeated verbatim at every act site): only
  -- ladders whose scope covers this act are selectable — org-wide (null)
  -- or a node whose subtree contains the acting row's organization — with
  -- the most specific covering scope first and version as tie-break. A
  -- site-scoped adoption therefore governs its subtree while the org-wide
  -- ladder keeps governing everywhere else, whatever the version order;
  -- and if the role's ONLY adopted ladders are scoped to subtrees that do
  -- not cover this act, the act is refused by name — scoping never
  -- silently disarms the ladder into the no-delegation default.
  select al.* into l
  from authority_limits al
  left join org_ancestry(new.organization_id) anc on anc.node_id = al.org_node_id
  where al.organization_id = new.organization_id
    and al.role_key = v_role and al.action_type = 'general' and al.status = 'adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;

  if not found then
    if exists (select 1 from authority_limits
               where organization_id = new.organization_id
                 and role_key = v_role and action_type = 'general'
                 and status = 'adopted') then
      raise exception
        'Delegation of authority: every adopted general limit for % is scoped to one organization node, and this act sits outside every such subtree. Escalate to a higher authority, or adopt a delegation covering this node.',
        v_role
        using errcode = 'check_violation';
    end if;
    return new;   -- the organization has not delegated in amounts yet
  end if;
  -- (b) asset criticality: an approver scoped to given criticalities cannot
  -- clear work on assets outside them (or on no named asset at all).
  if jsonb_array_length(l.asset_criticality_levels) > 0 then
    if new.asset_id is null or not exists (
      select 1 from assets a
      where a.id = new.asset_id and a.organization_id = new.organization_id
        and l.asset_criticality_levels ? a.criticality
    ) then
      raise exception
        'Delegation of authority: the adopted % limit for % is scoped to asset criticality %, and this recommendation''s asset is outside that scope. Escalate to %.',
        l.tier_label, v_role, l.asset_criticality_levels::text,
        coalesce(l.escalates_to_role, 'a higher authority')
        using errcode = 'check_violation';
    end if;
  end if;
  -- (c) competency: approval under this delegation requires each named
  -- competency, current (the 20260921110101:2232 join, unchanged).
  declare
    v_item text;
  begin
    for v_item in select jsonb_array_elements_text(l.required_competency_keys) loop
      if not exists (
        select 1 from workforce_members wm
        join member_competencies mc on mc.member_id = wm.id
        join competencies co on co.id = mc.competency_id
        where wm.organization_id = new.organization_id and wm.user_id = auth.uid()
          and wm.active and co.competency_key = v_item
          and (mc.expires_on is null or mc.expires_on >= current_date)
      ) then
        raise exception
          'Delegation of authority: approving under the % limit requires the current "%" competency, which % does not hold on the roster. Escalate to %.',
          l.tier_label, v_item, v_role, coalesce(l.escalates_to_role, 'a higher authority')
          using errcode = 'check_violation';
      end if;
    end loop;
  end;

  if l.max_commitment_usd is not null then
    if new.estimated_cost_usd is null then
      raise exception
        'Delegation of authority: % holds a % ceiling of $%; this recommendation states no cost, so authority cannot be verified. Record estimated_cost_usd or escalate to %.',
        v_role, l.tier_label, l.max_commitment_usd, coalesce(l.escalates_to_role, 'a higher authority')
        using errcode = 'check_violation';
    end if;
    if new.estimated_cost_usd > l.max_commitment_usd then
      raise exception
        'Delegation of authority: $% exceeds the % ceiling of $% for %. Escalate to %.',
        new.estimated_cost_usd, l.tier_label, l.max_commitment_usd, v_role,
        coalesce(l.escalates_to_role, 'the board')
        using errcode = 'check_violation';
    end if;
  end if;

  if l.max_risk_level is not null and new.risk_impact is not null
     and risk_rank(new.risk_impact) > risk_rank(l.max_risk_level) then
    -- E4.04: an active, unexpired acceptance signed by someone whose own
    -- ceiling covers this risk is the legitimate way past the ceiling. Without
    -- one, the ceiling holds.
    select * into v_accept from risk_acceptances
    where organization_id = new.organization_id
      and subject_type = 'recommendation' and subject_id = new.id
      and status = 'active' and expires_at > now()
      and risk_rank(risk_level) >= risk_rank(new.risk_impact)
    order by accepted_at desc limit 1;

    if not found then
      raise exception
        'Delegation of authority: % risk exceeds the % ceiling of % for %. Escalate to %, or record a risk acceptance signed at that level.',
        new.risk_impact, l.tier_label, l.max_risk_level, v_role,
        coalesce(l.escalates_to_role, 'the board')
        using errcode = 'check_violation';
    end if;
  end if;

  new.authority_cleared_by := auth.uid();
  new.authority_cleared_at := now();
  return new;
end
$$;


-- ---------------------------------------------------------------------------
-- 3. configure_risk_authority_scope, re-created from its 20260921110102
--    definition with ONE marked insertion (org_node_id + tree refusal).
-- ---------------------------------------------------------------------------
create or replace function public.configure_risk_authority_scope(p_authority_limit_id uuid,p_scope jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; l authority_limits%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive') then return jsonb_build_object('error','forbidden'); end if;
  select * into l from authority_limits where id=p_authority_limit_id and organization_id=v_org and status='draft';
  if not found then return jsonb_build_object('error','draft authority limit not found'); end if;
  if p_scope->>'independent_assurance_above_level' is not null and
     p_scope->>'independent_assurance_above_level' not in ('Low','Medium','High','Critical') then
    return jsonb_build_object('error','invalid independent assurance threshold'); end if;
  -- D3.32 (20261121090500, marked insertion): org-node scope. The node must
  -- be this organization or one of its descendants — a delegation scoped to
  -- a node outside the tenant's own tree would be authority over someone
  -- else's organization.
  if nullif(p_scope->>'org_node_id','') is not null and not exists (
    select 1 from org_ancestry((p_scope->>'org_node_id')::uuid) a where a.node_id = v_org
  ) then
    return jsonb_build_object('error',
      'org_node_id must name this organization or a node inside its own tree');
  end if;
  update authority_limits set jurisdictions=coalesce(p_scope->'jurisdictions','[]'::jsonb),
    asset_criticality_levels=coalesce(p_scope->'asset_criticality_levels','[]'::jsonb),
    max_decision_value=nullif(p_scope->>'max_decision_value','')::numeric,
    independent_assurance_above_level=nullif(p_scope->>'independent_assurance_above_level',''),
    org_node_id=nullif(p_scope->>'org_node_id','')::uuid
  where id=l.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_authority_scope',v_role,jsonb_build_object('authority_limit_id',l.id,
    'jurisdictions',coalesce(p_scope->'jurisdictions','[]'::jsonb),
    'asset_criticality_levels',coalesce(p_scope->'asset_criticality_levels','[]'::jsonb)));
  return jsonb_build_object('authority_limit_id',l.id,'status','draft');
end;
$$;

grant execute on function public.configure_risk_authority_scope(uuid,jsonb) to authenticated,service_role;
revoke execute on function public.configure_risk_authority_scope(uuid,jsonb) from public, anon;

notify pgrst, 'reload schema';
