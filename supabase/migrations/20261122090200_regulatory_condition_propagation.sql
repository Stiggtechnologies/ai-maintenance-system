-- ============================================================================
-- Sync Develop Slice 3C — approval conditions PROPAGATE into delivery and
-- operations (D3.11, spec I.19: "Approval conditions connect into
-- engineering, construction, operating procedures, monitoring, reporting"),
-- and the ONE governance sweep escalates what lapses.
--
-- THE FAILURE THIS FILE EXISTS TO END: an approval is granted with fourteen
-- conditions, the conditions live in the permit PDF, and eighteen months
-- later an operator is running an asset under an obligation nobody in
-- operations has ever seen. The chain in 20261122090100 makes conditions
-- first-class; this file makes them LAND.
--
-- PRECEDENTS FOLLOWED (register row D3.11 names both):
--   * MOC re-review triggers (00000000000012:402) — a change in one record
--     forces re-examination in another, in the same transaction.
--   * propagate_risk_objective_change (20260921110102:629) — an adopted
--     record changing propagates to everything that depends on it, by
--     trigger, naming the reason.
--
-- RULINGS THIS FILE TAKES:
--
--   * ROUTING IS BY OBLIGATION DOMAIN, and the two destinations are the
--     platform's own canonical stores — no third "compliance obligations"
--     table (AGENTS invariant 8):
--       engineering | construction        -> design_requirements
--           (the ONE project requirement table; source='regulatory'). This
--           is literally I.19's own terminus: "→ Project requirement".
--       operating_procedure | monitoring | reporting -> work_orders
--           (the ONE work identity). A maintenance/operations user's list
--           of work IS where operations looks. A permit obligation that is
--           not in that list is not in operations.
--
--   * PROPAGATION FAILS CLOSED. An operational condition on a case with NO
--     asset bound to it has nowhere to land, and a silent success would be
--     the PDF failure with extra steps. propagate_regulatory_conditions
--     REFUSES, naming the condition and the missing binding
--     (bind_asset_to_development_case is the fix). Fail-closed on a missing
--     link is the 3B risk-ceiling posture, applied to a different link.
--
--   * PROPAGATION IS IDEMPOTENT AND RECORDED ON THE CONDITION ROW
--     (propagated_requirement_id / propagated_work_order_id / propagated_at).
--     Re-running lands nothing twice; "where did this condition go?" is
--     answered by the row.
--
--   * PROPAGATION IS AUTOMATIC AT GRANT. record_regulatory_approval calls it
--     in the SAME transaction: a conditional approval that is recorded but
--     not propagated cannot exist, because the two acts are one act.
--
--   * BREACH IS VISIBLE, THROUGH THE ONE SWEEP (ruling 15 — extend the
--     sweep, no second escalator). expire_governance_instruments is
--     RE-CREATED from its 20261121090200 definition with THREE marked
--     insertions and everything pre-existing byte-identical:
--       (a) overdue regulatory conditions -> 'missed' + breached_at +
--           security_events naming the permit, the regulator, the owner and
--           the recorded consequence;
--       (b) EXPIRED APPROVALS -> status 'expired' + an escalation stating
--           that the activity the permit authorized is NO LONGER
--           AUTHORIZED. A lapsed permit is not bookkeeping;
--       (c) overdue stakeholder commitments (D3.08) -> 'breached' +
--           breached_at + an escalation naming the stakeholder owed.
--     Overdue information requests (D3.10) ride the same pass.
--
--   * GATE READINESS CONSUMES BOTH FAMILIES — landed in 20261122090300,
--     where get_gate_readiness is re-created ONCE for all three of this
--     slice's consumers (regulatory conditions, uncovered commitments, and
--     D3.16 assurance) rather than twice in two files. A blocker names what
--     is wrong; it deliberately does NOT move the readiness percentage,
--     which stays Σ(w·r)/Σw over the gate's own criteria.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The propagation. SECURITY DEFINER, called from record_regulatory_approval
--    (below) and re-runnable by a governance role.
-- ---------------------------------------------------------------------------
create or replace function public.propagate_regulatory_conditions(p_approval_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  ap regulatory_approvals%rowtype;
  rr regulatory_requirements%rowtype;
  c development_cases%rowtype;
  rec record;
  v_asset uuid;
  v_asset_count int;
  v_req bigint;
  v_wo uuid;
  v_requirements int := 0;
  v_work_orders int := 0;
  v_already int := 0;
  v_landed jsonb := '[]'::jsonb;
  v_ref text;
  v_role text;
  v_wo_number text;
  v_dreq_ref text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- ROLE CHECK. Every other act in this family carries one; this function was
  -- shipped with none, and it WRITES design_requirements at source
  -- 'regulatory' (the highest-weight provenance this file's own header warns
  -- about) and work_orders. A technician refused at record_case_requirement
  -- was admitted here, which made the UI's button-gating the whole
  -- authorization. The list is close_regulatory_condition's, because landing
  -- a regulator's obligation into engineering and operations is the same
  -- class of act as discharging one.
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'propagating permit conditions requires a governance or engineering role');
  end if;
  select * into ap from regulatory_approvals where id = p_approval_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'regulatory approval not found');
  end if;
  -- A LAPSED OR REVOKED PERMIT AUTHORIZES NOTHING, so it mints nothing. The
  -- first draft never looked at the approval's status, so an expired permit
  -- could still create new design_requirements and work_orders as though it
  -- still authorized the activity — the exact sentence the sweep's own
  -- escalation writes ("NO LONGER AUTHORIZED"), contradicted by this act.
  if ap.status is distinct from 'active' then
    return jsonb_build_object('error',
      format('permit %s is %s — a permit that no longer authorizes the activity does not create new obligations against it. Renew through the approval chain (a new application against the same requirement).',
             ap.permit_number, coalesce(ap.status, 'in an unknown state')));
  end if;
  -- Alias deliberately NOT `rr`: that is the record variable's own name, and
  -- Postgres resolves the collision as an ambiguous column reference at run
  -- time rather than at create time.
  select req.* into rr
  from regulatory_applications a
  join regulatory_requirements req on req.id = a.requirement_id
  where a.id = ap.application_id;
  select * into c from development_cases where id = rr.development_case_id;

  -- Fail CLOSED before writing anything: if any operational condition has
  -- nowhere to land, the whole propagation refuses and names the fix. A
  -- partial landing would leave half a permit enforced and half of it in a
  -- PDF, which is worse than none, because it looks done.
  select count(*) into v_asset_count
  from development_case_assets dca
  where dca.organization_id = v_org and dca.development_case_id = c.id;

  -- STATUS FILTER IDENTICAL TO THE LOOP'S. The first draft guarded over
  -- status = 'open' while the loop processed ('open','missed'), so a
  -- condition the sweep had already breached slipped past the fail-closed
  -- check and landed a work order with a NULL asset — reported as
  -- landedAs: 'work_order' while reaching no operator's asset work list.
  -- A guard that does not cover what the loop does is not a guard.
  if v_asset_count = 0 and exists (
    select 1 from regulatory_conditions rc
    where rc.approval_id = ap.id and rc.status in ('open','missed')
      and rc.propagated_work_order_id is null
      and rc.obligation_domain in ('operating_procedure','monitoring','reporting'))
  then
    select string_agg(rc.condition_ref, ', ' order by rc.condition_ref) into v_ref
    from regulatory_conditions rc
    where rc.approval_id = ap.id and rc.status in ('open','missed')
      and rc.propagated_work_order_id is null
      and rc.obligation_domain in ('operating_procedure','monitoring','reporting');
    return jsonb_build_object('error',
      format('permit %s carries operational conditions (%s) and this case has no asset bound to it, so the obligation has nowhere in operations to land. Bind the delivered asset (bind_asset_to_development_case) and propagate again — a condition that reaches no operator is the permit-PDF failure spec I.19 exists to end.',
             ap.permit_number, v_ref));
  end if;

  for rec in
    select * from regulatory_conditions rc
    where rc.approval_id = ap.id and rc.status in ('open','missed')
    order by rc.condition_ref
  loop
    if rec.obligation_domain in ('engineering','construction') then
      if rec.propagated_requirement_id is not null then
        v_already := v_already + 1;
        continue;
      end if;
      -- The I.19 terminus: the condition becomes a project requirement, at
      -- the regulator's own provenance, on the ONE requirement table.
      --
      -- THE GENERATED REF IS COLLISION-CHECKED. `REG-<permit>-<condition>` is
      -- a ref a planner can also type through record_case_requirement — and
      -- naturally would, writing the requirement for a permit condition
      -- before the permit comes back. Without this check the regulator's
      -- decision could not be recorded AT ALL: idx_dreq_ref raised a raw
      -- 23505 naming a Postgres index, inside the approval act, after the
      -- approval row was written. The condition id disambiguates, and a
      -- collision on THAT is refused by name rather than guessed at again.
      v_dreq_ref := 'REG-' || ap.permit_number || '-' || rec.condition_ref;
      if exists (select 1 from design_requirements d
                 where d.organization_id = v_org and d.requirement_ref = v_dreq_ref) then
        v_dreq_ref := v_dreq_ref || '-' || rec.id::text;
      end if;
      if exists (select 1 from design_requirements d
                 where d.organization_id = v_org and d.requirement_ref = v_dreq_ref) then
        raise exception
          'Permit condition % cannot become a project requirement: the reference "%" is already used by another requirement in this organization. Rename that requirement, then propagate again — silently overwriting somebody else''s requirement with a regulator''s obligation is worse than refusing.',
          rec.condition_ref, v_dreq_ref
          using errcode = 'check_violation';
      end if;
      insert into design_requirements (
        organization_id, project_id, development_case_id, requirement_ref,
        category, requirement, source, verification_status, created_by)
      values (
        v_org, c.capital_project_id, c.id,
        v_dreq_ref,
        case rec.obligation_domain when 'engineering' then 'operability'
                                   else 'access' end,
        format('%s condition %s (%s, permit %s): %s',
               initcap(replace(rec.obligation_domain, '_', ' ')), rec.condition_ref,
               rr.regulator, ap.permit_number, rec.description),
        'regulatory', 'open', auth.uid())
      returning id into v_req;

      perform set_config('app.regulatory_chain_write', 'granted', true);
      update regulatory_conditions
      set propagated_requirement_id = v_req, propagated_at = now()
      where id = rec.id;
      perform set_config('app.regulatory_chain_write', '', true);
      v_requirements := v_requirements + 1;
      v_landed := v_landed || jsonb_build_array(jsonb_build_object(
        'conditionRef', rec.condition_ref, 'domain', rec.obligation_domain,
        'landedAs', 'design_requirement', 'targetId', v_req));

    else
      if rec.propagated_work_order_id is not null then
        v_already := v_already + 1;
        continue;
      end if;
      -- The operations terminus: the ONE work identity, against the case's
      -- bound asset, so a maintenance user meets the obligation in the list
      -- they already work from.
      select dca.asset_id into v_asset
      from development_case_assets dca
      where dca.organization_id = v_org and dca.development_case_id = c.id
      order by dca.created_at, dca.asset_id
      limit 1;

      -- FAIL CLOSED AT THE WRITE, not only at the pre-flight guard. The guard
      -- above answers "does this case have an asset?" once; this answers
      -- "does THIS obligation have somewhere to land?" immediately before
      -- landing it. A work order with a null asset appears on no operator's
      -- asset work list, and reporting it as landed is the permit-PDF failure
      -- with a success message on top.
      if v_asset is null then
        raise exception
          'Permit condition % (%) has no asset to land on: this case has no bound asset, so the obligation would reach no operator. Bind the delivered asset (bind_asset_to_development_case) and propagate again.',
          rec.condition_ref, rec.obligation_domain
          using errcode = 'check_violation';
      end if;

      -- The wo_number carries the PERIOD, because a recurring obligation is
      -- discharged every period and each period is its own work order.
      v_wo_number := 'REG-' || ap.permit_number || '-' || rec.condition_ref
        || case when rec.recurrence = 'one_time' then ''
                else '-' || to_char(rec.due_date, 'YYYYMMDD') end;

      insert into work_orders (
        organization_id, asset_id, wo_number, title, description, status,
        priority, type, scheduled_date, approval_required, safety_flag)
      values (
        v_org, v_asset,
        v_wo_number,
        format('Permit condition %s (%s): %s', rec.condition_ref, ap.permit_number,
               left(rec.description, 120)),
        format('Regulatory obligation propagated from permit %s issued by %s under %s.%s%s Owner: %s. Evidence required: %s. Consequence if missed: %s.',
               ap.permit_number, ap.deciding_authority, rr.instrument,
               chr(10), case rec.recurrence when 'one_time' then 'One-time obligation.'
                                            else initcap(rec.recurrence) || ' recurring obligation.' end,
               coalesce((select coalesce(p.full_name, p.email) from user_profiles p where p.id = rec.owner_id), rec.owner_id::text),
               rec.evidence_requirement, rec.consequence_if_missed),
        'pending', 'high', 'human_created', rec.due_date::text, true, false)
      returning id into v_wo;

      perform set_config('app.regulatory_chain_write', 'granted', true);
      update regulatory_conditions
      set propagated_work_order_id = v_wo, propagated_at = now()
      where id = rec.id;
      perform set_config('app.regulatory_chain_write', '', true);
      v_work_orders := v_work_orders + 1;
      v_landed := v_landed || jsonb_build_array(jsonb_build_object(
        'conditionRef', rec.condition_ref, 'domain', rec.obligation_domain,
        'landedAs', 'work_order', 'targetId', v_wo, 'assetId', v_asset));
    end if;
  end loop;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'regulatory_condition_propagation',
    coalesce((select role from user_profiles where id = auth.uid()), 'unknown'),
    jsonb_build_object('approval_id', ap.id, 'permit_number', ap.permit_number,
      'case_id', c.id, 'action', 'propagated',
      'requirements_created', v_requirements, 'work_orders_created', v_work_orders,
      'already_propagated', v_already, 'landed', v_landed),
    jsonb_build_object('propagated', v_already),
    jsonb_build_object('propagated', v_already + v_requirements + v_work_orders));

  return jsonb_build_object('approval_id', ap.id, 'permit_number', ap.permit_number,
    'case_id', c.id, 'requirements_created', v_requirements,
    'work_orders_created', v_work_orders, 'already_propagated', v_already,
    'landed', v_landed);
end
$$;

revoke all on function public.propagate_regulatory_conditions(bigint) from public, anon;
grant execute on function public.propagate_regulatory_conditions(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Recording the approval and its conditions — one act, one transaction,
--    propagation included. §70: the AI-operator identity is refused BY NAME
--    (backstopped on the table by trg_regulatory_approval_human_record).
-- ---------------------------------------------------------------------------
create or replace function public.record_regulatory_approval(
  p_application_id bigint,
  p_approval jsonb,
  p_conditions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  a regulatory_applications%rowtype;
  rr regulatory_requirements%rowtype;
  v_decision text := nullif(btrim(coalesce(p_approval->>'decision','')), '');
  v_permit text := nullif(btrim(coalesce(p_approval->>'permit_number','')), '');
  v_authority text := nullif(btrim(coalesce(p_approval->>'deciding_authority','')), '');
  -- Raw text beside the parsed value (20261122090000 section 0): a cast in a
  -- DECLARE executes before the first guard.
  v_decision_date_raw text := nullif(btrim(coalesce(p_approval->>'decision_date','')), '');
  v_decision_date date := coalesce(sync_text_as_date(v_decision_date_raw), current_date);
  v_expires_raw text := nullif(btrim(coalesce(p_approval->>'expires_at','')), '');
  v_expires date := sync_text_as_date(v_expires_raw);
  v_effective_raw text := nullif(btrim(coalesce(p_approval->>'effective_from','')), '');
  v_effective date := sync_text_as_date(v_effective_raw);
  v_perpetual_raw text := nullif(btrim(coalesce(p_approval->>'perpetual','')), '');
  v_perpetual boolean := coalesce(sync_text_as_boolean(v_perpetual_raw), false);
  v_document_raw text := nullif(btrim(coalesce(p_approval->>'document_id','')), '');
  v_document uuid := sync_text_as_uuid(v_document_raw);
  v_cond_ref text;
  v_seen_refs text[] := '{}';
  v_id bigint;
  v_cond jsonb;
  v_cond_id bigint;
  v_owner uuid;
  v_due date;
  v_created int := 0;
  v_prop jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording a regulatory approval asserts that a regulator has been satisfied — one of the seven §70 determinations reserved to authorized humans; the AI-operator identity cannot record it');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'recording a regulatory approval requires a governance or engineering role');
  end if;
  select * into a from regulatory_applications where id = p_application_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'regulatory application not found');
  end if;
  if a.status in ('draft','withdrawn') then
    return jsonb_build_object('error',
      format('this application is %s — a decision cannot be recorded against it', a.status));
  end if;
  -- ONE APPLICATION, ONE DECISION. 'decided' passed the filter above, so a
  -- second approval could be recorded against an already-decided
  -- application; the case surface then rendered only the newest permit
  -- (order by decision_date desc limit 1) while gate readiness kept naming
  -- blockers belonging to the older one and the sweep kept escalating them —
  -- the screen showing one permit and refusing over another. A regulator
  -- revisiting a decision is a NEW application against the same requirement.
  if a.status = 'decided' or exists (
    select 1 from regulatory_approvals ra where ra.application_id = a.id) then
    return jsonb_build_object('error',
      format('application %s already carries a decision — a regulator revisiting an instrument is a new application against the same requirement, not a second approval on this one', a.application_ref));
  end if;
  if v_decision_date_raw is not null and v_decision_date is null then
    return jsonb_build_object('error',
      format('decision_date must be a date (YYYY-MM-DD) — "%s" is not one', v_decision_date_raw));
  end if;
  if v_expires_raw is not null and v_expires is null then
    return jsonb_build_object('error',
      format('expires_at must be a date (YYYY-MM-DD) — "%s" is not one', v_expires_raw));
  end if;
  if v_effective_raw is not null and v_effective is null then
    return jsonb_build_object('error',
      format('effective_from must be a date (YYYY-MM-DD) — "%s" is not one', v_effective_raw));
  end if;
  if v_perpetual_raw is not null and v_perpetual is null then
    return jsonb_build_object('error',
      format('perpetual must be true or false — "%s" is neither', v_perpetual_raw));
  end if;
  if v_document_raw is not null and v_document is null then
    return jsonb_build_object('error',
      format('document_id must be a document id (uuid) — "%s" is not one', v_document_raw));
  end if;
  -- The permit document is validated against THIS organization, the
  -- record_case_evidence rule (D11.17). A cross-tenant document id attached
  -- to a permit is a link into another tenant's library.
  if v_document is not null and not exists (
    select 1 from kb_intake_documents d
    where d.id = v_document and d.organization_id = v_org) then
    return jsonb_build_object('error',
      'that permit document is not in this organization''s library — record the instrument as a document here and link it');
  end if;
  select * into rr from regulatory_requirements where id = a.requirement_id;
  if v_decision not in ('granted','granted_with_conditions','refused') then
    return jsonb_build_object('error',
      'decision must be granted, granted_with_conditions or refused');
  end if;
  if v_permit is null or v_authority is null then
    return jsonb_build_object('error',
      'a decision names the permit/instrument number and the deciding authority — an approval attributed to nobody is not an approval');
  end if;
  if v_decision <> 'refused' and not v_perpetual and v_expires is null then
    return jsonb_build_object('error',
      'state the expiry of this instrument, or record it as perpetual explicitly — a permit with an unstated expiry is a permanent authorization nobody decided to grant (D3.20)');
  end if;
  if v_decision = 'refused' and coalesce(btrim(p_approval->>'refusal_reason'), '') = '' then
    return jsonb_build_object('error', 'a refusal states the regulator''s reason');
  end if;
  if v_decision = 'granted_with_conditions'
     and coalesce(jsonb_array_length(p_conditions), 0) = 0 then
    return jsonb_build_object('error',
      'a conditional grant carries its conditions as first-class rows (owner, due date, evidence requirement, consequence-if-missed, obligation domain) — conditions recorded only as prose have no owner, no deadline and no escalation');
  end if;
  if v_decision <> 'granted_with_conditions'
     and coalesce(jsonb_array_length(p_conditions), 0) > 0 then
    return jsonb_build_object('error',
      'conditions were supplied but the decision is not granted_with_conditions — record the decision the regulator actually made');
  end if;
  if exists (select 1 from regulatory_approvals ra
             where ra.organization_id = v_org and ra.permit_number = v_permit) then
    return jsonb_build_object('error',
      format('permit number "%s" is already recorded in this organization', v_permit));
  end if;

  perform set_config('app.regulatory_chain_write', 'granted', true);
  insert into regulatory_approvals (
    organization_id, application_id, permit_number, deciding_authority, decision,
    decision_date, effective_from, expires_at, perpetual, refusal_reason,
    recorded_by, document_id)
  values (
    v_org, a.id, v_permit, v_authority, v_decision, v_decision_date,
    v_effective,
    case when v_perpetual then null else v_expires end,
    v_perpetual, nullif(btrim(coalesce(p_approval->>'refusal_reason','')), ''),
    auth.uid(), v_document)
  returning id into v_id;

  for v_cond in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) loop
    v_owner := nullif(v_cond->>'owner_id','')::uuid;
    v_due := nullif(v_cond->>'due_date','')::date;
    if coalesce(btrim(v_cond->>'condition_ref'), '') = ''
       or coalesce(length(btrim(coalesce(v_cond->>'description',''))), 0) < 10
       or coalesce(btrim(v_cond->>'evidence_requirement'), '') = ''
       or coalesce(btrim(v_cond->>'consequence_if_missed'), '') = ''
       or v_owner is null or v_due is null then
      raise exception
        'Every permit condition is born complete: reference, description, obligation domain, owner, due date, evidence requirement and consequence-if-missed (spec I.19 + II.16). Condition "%" is missing one of them.',
        coalesce(v_cond->>'condition_ref', '(unreferenced)')
        using errcode = 'check_violation';
    end if;
    if coalesce(v_cond->>'obligation_domain','') not in
       ('engineering','construction','operating_procedure','monitoring','reporting') then
      raise exception
        'Condition % states no routable obligation domain. Spec I.19 names five — engineering, construction, operating_procedure, monitoring, reporting — and a condition outside them has nowhere to land.',
        coalesce(v_cond->>'condition_ref', '(unreferenced)')
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from user_profiles where id = v_owner and organization_id = v_org) then
      raise exception
        'Condition % names an owner outside this organization. An unowned permit condition is nobody''s work.',
        v_cond->>'condition_ref'
        using errcode = 'check_violation';
    end if;
    -- REFERENCE COLLISIONS ARE NAMED, never a raw 23505. Every sibling act
    -- pre-checks its own ref (application_ref, requirement_ref, request_ref,
    -- permit_number, commitment_ref); this one did not, so two conditions
    -- sharing a reference — in one act or across two permits — surfaced a
    -- Postgres index name to the user.
    v_cond_ref := btrim(v_cond->>'condition_ref');
    if v_cond_ref = any(v_seen_refs) then
      raise exception
        'This decision lists condition reference "%" twice. A reference identifies one condition of one permit.',
        v_cond_ref using errcode = 'check_violation';
    end if;
    v_seen_refs := v_seen_refs || v_cond_ref;
    if exists (select 1 from regulatory_conditions rc0
               where rc0.organization_id = v_org and rc0.condition_ref = v_cond_ref) then
      raise exception
        'Condition reference "%" is already recorded in this organization. A reference identifies one condition, so give this one the reference the regulator used (permit-qualified if the authority reuses references across instruments).',
        v_cond_ref using errcode = 'check_violation';
    end if;
    insert into regulatory_conditions (
      organization_id, approval_id, condition_ref, description, obligation_domain,
      owner_id, due_date, evidence_requirement, consequence_if_missed, recurrence)
    values (
      v_org, v_id, v_cond_ref, btrim(v_cond->>'description'),
      v_cond->>'obligation_domain', v_owner, v_due,
      btrim(v_cond->>'evidence_requirement'), btrim(v_cond->>'consequence_if_missed'),
      coalesce(nullif(btrim(coalesce(v_cond->>'recurrence','')), ''), 'one_time'))
    returning id into v_cond_id;
    v_created := v_created + 1;
  end loop;

  update regulatory_applications set status = 'decided' where id = a.id;
  update regulatory_requirements
  set status = case when v_decision = 'refused' then 'refused' else 'granted' end
  where id = rr.id;
  perform set_config('app.regulatory_chain_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'regulatory_approval', coalesce(v_role, 'unknown'),
    jsonb_build_object('approval_id', v_id, 'action', 'recorded',
      'permit_number', v_permit, 'decision', v_decision,
      'deciding_authority', v_authority, 'case_id', rr.development_case_id,
      'conditions_created', v_created, 'expires_at', v_expires,
      'perpetual', v_perpetual),
    jsonb_build_object('application_status', a.status, 'requirement_status', rr.status),
    jsonb_build_object('application_status', 'decided',
      'requirement_status', case when v_decision = 'refused' then 'refused' else 'granted' end,
      'decision', v_decision));

  -- The same act, same transaction: a conditional approval that is recorded
  -- but not propagated cannot exist.
  if v_decision = 'granted_with_conditions' then
    v_prop := propagate_regulatory_conditions(v_id);
    if v_prop ? 'error' then
      raise exception '%', v_prop->>'error' using errcode = 'check_violation';
    end if;
  end if;

  return jsonb_build_object('approval_id', v_id, 'permit_number', v_permit,
    'decision', v_decision, 'conditions_created', v_created,
    'propagation', v_prop);
end
$$;

revoke all on function public.record_regulatory_approval(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.record_regulatory_approval(bigint, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2b. THE OPERATIONS TERMINUS IS NOT SEVERABLE.
--
--     `work_orders` carries a permissive `for all` policy, and
--     `regulatory_conditions.propagated_work_order_id` is ON DELETE SET NULL
--     — so any org member could DELETE a propagated work order, which nulled
--     the link while `propagated_at` stayed set and left `get_case_chains`
--     rendering `propagation: { at: <timestamp>, workOrder: null }`. A
--     "propagated" obligation with no target is precisely the half-landed
--     permit this file refuses to CREATE, arrived at by deletion instead.
--
--     The engineering terminus was already protected
--     (design_requirements_case_no_upd/no_del, 20261122090000); this is the
--     same treatment for the other one, on the D11.17 per-command restrictive
--     idiom. Ordinary work orders are untouched: the predicate is scoped to
--     rows a permit condition points at.
-- ---------------------------------------------------------------------------
create index if not exists idx_regulatory_conditions_propagated_wo
  on regulatory_conditions(propagated_work_order_id)
  where propagated_work_order_id is not null;

drop policy if exists work_orders_regulatory_landing_no_upd on public.work_orders;
create policy work_orders_regulatory_landing_no_upd on public.work_orders as restrictive
  for update to authenticated
  using (not exists (
    select 1 from regulatory_conditions rc
    where rc.propagated_work_order_id = work_orders.id))
  with check (not exists (
    select 1 from regulatory_conditions rc
    where rc.propagated_work_order_id = work_orders.id));

drop policy if exists work_orders_regulatory_landing_no_del on public.work_orders;
create policy work_orders_regulatory_landing_no_del on public.work_orders as restrictive
  for delete to authenticated
  using (not exists (
    select 1 from regulatory_conditions rc
    where rc.propagated_work_order_id = work_orders.id));

-- ---------------------------------------------------------------------------
-- 3. Closing a permit condition — evidence-gated, §70 human-only, breach
--    preserved through a late closure (the D3.18 contract, same shape).
--    A recurring condition RE-ARMS to its next period rather than closing
--    for good: a quarterly monitoring obligation discharged once is not
--    discharged forever, and letting it close would silently delete the
--    other three quarters.
-- ---------------------------------------------------------------------------
create or replace function public.close_regulatory_condition(
  p_condition_id bigint,
  p_evidence_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  rc regulatory_conditions%rowtype;
  ev evidence_items%rowtype;
  v_case uuid;
  v_next date;
  v_recurring boolean;
  v_prop jsonb;
  v_ap_status text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'discharging a permit condition asserts a regulatory obligation was met — a §70 human determination the AI-operator identity cannot record');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'discharging a permit condition requires a governance or engineering role');
  end if;
  select * into rc from regulatory_conditions where id = p_condition_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'regulatory condition not found');
  end if;
  if rc.status = 'satisfied' then
    return jsonb_build_object('error', 'this condition is already satisfied — a discharge is not overwritable');
  end if;
  if rc.status = 'superseded' then
    return jsonb_build_object('error', 'this condition was superseded — it is not discharged');
  end if;
  if p_evidence_id is null then
    return jsonb_build_object('error',
      format('discharging condition %s requires the evidence the permit demanded ("%s") — record it (record_case_evidence) and link it here',
             rc.condition_ref, rc.evidence_requirement));
  end if;
  v_case := regulatory_condition_case(rc.id);
  select * into ev from evidence_items where id = p_evidence_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence item not found in this organization');
  end if;
  if ev.development_case_id is distinct from v_case then
    return jsonb_build_object('error',
      'that evidence item is not recorded against this permit''s case — evidence for one case cannot discharge another case''s permit condition');
  end if;

  v_recurring := rc.recurrence <> 'one_time';
  v_next := case rc.recurrence
    when 'monthly' then rc.due_date + interval '1 month'
    when 'quarterly' then rc.due_date + interval '3 months'
    when 'annual' then rc.due_date + interval '1 year'
    end::date;

  perform set_config('app.regulatory_chain_write', 'granted', true);
  if v_recurring then
    -- Re-arm: this period is evidenced, the next period is now open. The
    -- discharge itself is in the ledger; the row keeps enforcing.
    --
    -- THE LANDING IS CLEARED TOO. Leaving propagated_work_order_id set made
    -- propagate_regulatory_conditions skip the condition forever
    -- (`propagated_work_order_id is not null -> already; continue`), so a
    -- quarterly obligation over a 25-year permit reached operations exactly
    -- once, carrying period 1's date for every period after it. That is this
    -- file's own opening failure ("an operator running an asset under an
    -- obligation nobody in operations has ever seen") arriving one period
    -- late instead of never.
    --
    -- The discharged period's evidence STAYS on the row rather than being
    -- nulled: the regulator demanded evidence for the period just closed, and
    -- surviving only in audit_events means the row itself cannot answer "what
    -- discharged the last period?". closed_at dates it, so a reader can tell
    -- the last discharge from the current period's silence.
    update regulatory_conditions
    set due_date = v_next, status = 'open', breached_at = null,
        closed_by = auth.uid(), closed_at = now(),
        closure_evidence_id = ev.id,
        closure_note = nullif(btrim(coalesce(p_note, '')), ''),
        propagated_work_order_id = null, propagated_at = null
    where id = rc.id;
  else
    update regulatory_conditions
    set status = 'satisfied', closed_by = auth.uid(), closed_at = now(),
        closure_evidence_id = ev.id,
        closure_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = rc.id;
  end if;
  perform set_config('app.regulatory_chain_write', '', true);

  -- The next period lands NOW, in this transaction — the same rule the grant
  -- follows. An obligation that re-arms but never re-reaches operations is a
  -- due date in a table nobody works from. Operational domains only: an
  -- engineering condition's project requirement is permanent, so
  -- propagate_regulatory_conditions leaves it alone.
  --
  -- A LAPSED PERMIT MINTS NO NEW WORK. If the approval is no longer active
  -- the period still re-arms (the obligation is a fact of the record and the
  -- lapse is escalated loudly by the sweep), but nothing new is pushed into
  -- operations under an authorization that no longer exists.
  select status into v_ap_status from regulatory_approvals where id = rc.approval_id;
  if v_recurring and v_ap_status = 'active'
     and rc.obligation_domain in ('operating_procedure','monitoring','reporting') then
    v_prop := propagate_regulatory_conditions(rc.approval_id);
    if v_prop ? 'error' then
      raise exception
        'Condition % is discharged for this period, but its next period (%) cannot reach operations: %',
        rc.condition_ref, v_next, v_prop->>'error'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'regulatory_condition', coalesce(v_role, 'unknown'),
    jsonb_build_object('condition_id', rc.id,
      'action', case when v_recurring then 'period_discharged' else 'satisfied' end,
      'condition_ref', rc.condition_ref, 'case_id', v_case, 'evidence_id', ev.id,
      'was_breached', rc.breached_at is not null,
      'recurrence', rc.recurrence, 'next_due', v_next),
    jsonb_build_object('status', rc.status, 'due_date', rc.due_date,
      'breached_at', rc.breached_at),
    case when v_recurring
      then jsonb_build_object('status', 'open', 'due_date', v_next, 'breached_at', null)
      else jsonb_build_object('status', 'satisfied', 'closed_by', auth.uid(),
             'closed_at', now(), 'closure_evidence_id', ev.id,
             'breached_at', rc.breached_at) end);

  return jsonb_build_object('condition_id', rc.id,
    'status', case when v_recurring then 'open' else 'satisfied' end,
    'evidence_id', ev.id, 'closed_late', rc.breached_at is not null,
    'recurring', v_recurring, 'next_due', v_next,
    'next_period_propagated', coalesce(v_prop ? 'landed', false),
    'permit_status', v_ap_status);
end
$$;

revoke all on function public.close_regulatory_condition(bigint, uuid, text) from public, anon;
grant execute on function public.close_regulatory_condition(bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE ONE SWEEP, extended (ruling 15). Re-created from its 20261121090200
--    definition; everything pre-existing is byte-identical and the three new
--    passes are marked 20261122090200.
-- ---------------------------------------------------------------------------
create or replace function public.expire_governance_instruments()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_var int;
  v_risk int;
  -- D3.18/D3.20 (20261121090200, marked insertion): escalation counters.
  v_cond int;
  -- D3.11/D3.08 (20261122090200, marked insertion): regulatory + commitment.
  v_reg_cond int;
  v_permits int;
  v_rfi int;
  v_commit int;
  rec record;
begin
  with x as (
    update standard_site_variances set status = 'expired'
    where status = 'approved' and expires_at is not null and expires_at <= now()
    returning id, organization_id, subject_type, requirement_id, development_case_id, expires_at)
  select count(*) into v_var from x;

  with y as (
    update risk_acceptances set status = 'expired'
    where status = 'active' and expires_at <= now()
    returning 1)
  select count(*) into v_risk from y;

  -- D3.20 (20261121090200, marked insertion): an expired gate-requirement
  -- waiver stops satisfying what it waived THE MOMENT the predicate family
  -- reads it (case_binding_gate_demands / record_case_gate_review consult
  -- status+expiry live); this pass makes the reversion a RECORD, not only a
  -- predicate outcome. Rows already flipped above are found by timestamp.
  for rec in
    select w.id, w.organization_id, w.development_case_id, w.requirement_id,
           w.expires_at, sc.criterion
    from standard_site_variances w
    left join stage_gate_criteria sc on sc.id = w.requirement_id
    where w.subject_type = 'gate_requirement' and w.status = 'expired'
      and w.expires_at <= now()
      and not exists (
        select 1 from audit_events a
        where a.organization_id = w.organization_id
          and a.entity_type = 'gate_requirement_waiver'
          and a.event_data->>'action' = 'expired'
          and a.event_data->>'waiver_id' = w.id::text)
  loop
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (rec.organization_id, 'gate_requirement_waiver', 'system:expiry_sweep',
      jsonb_build_object('waiver_id', rec.id, 'action', 'expired',
        'case_id', rec.development_case_id, 'requirement_id', rec.requirement_id,
        'expired_at', rec.expires_at),
      jsonb_build_object('status', 'approved'),
      jsonb_build_object('status', 'expired'));
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (rec.organization_id, null, 'system (expiry sweep)',
       'admin_action', 'warning',
       format('Gate-requirement waiver expired for case %s, requirement "%s" — ENFORCEMENT REVERTED: the requirement binds again at every gate, advance and sanction from this moment. A temporary exception does not become a design decision by lapse of attention (spec II.16).',
              rec.development_case_id, coalesce(rec.criterion, rec.requirement_id::text)));
  end loop;

  -- D3.18 (20261121090200, marked insertion): overdue conditions escalate.
  v_cond := 0;
  perform set_config('app.gate_condition_lifecycle', 'granted', true);
  for rec in
    with escalated as (
      update gate_conditions gc
      set status = 'missed', breached_at = now()
      where gc.status = 'open' and gc.due_date < current_date
      returning gc.id, gc.organization_id, gc.review_id, gc.description,
                gc.owner_id, gc.due_date, gc.consequence_if_missed)
    select * from escalated
  loop
    v_cond := v_cond + 1;
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (rec.organization_id, 'gate_condition', 'system:expiry_sweep',
      jsonb_build_object('condition_id', rec.id, 'action', 'escalated_overdue',
        'review_id', rec.review_id, 'due_date', rec.due_date,
        'owner_id', rec.owner_id),
      jsonb_build_object('status', 'open', 'breached_at', null),
      jsonb_build_object('status', 'missed', 'breached_at', now()));
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (rec.organization_id, null, 'system (expiry sweep)',
       'admin_action', 'warning',
       format('Gate condition OVERDUE and escalated: "%s" (owner %s, due %s) on review %s. Recorded consequence if missed: %s. The condition was part of the gate decision — it is now breached, not forgotten.',
              rec.description,
              coalesce((select coalesce(p.full_name, p.email) from user_profiles p where p.id = rec.owner_id), rec.owner_id::text),
              rec.due_date, rec.review_id, rec.consequence_if_missed));
  end loop;
  perform set_config('app.gate_condition_lifecycle', '', true);

  -- The sweep writes the regulatory family through its own governed pass, so
  -- it carries the provenance marker (20261122090100 section 7b) exactly as
  -- it already carries the gate-condition and commitment markers.
  perform set_config('app.regulatory_chain_write', 'granted', true);

  -- D3.11 (20261122090200, marked insertion): overdue PERMIT conditions
  -- escalate on exactly the D3.18 contract. A permit obligation that lapses
  -- unnoticed is a regulatory breach, so the escalation names the permit,
  -- the regulator and the consequence the approval itself recorded.
  v_reg_cond := 0;
  for rec in
    with escalated as (
      update regulatory_conditions rc
      set status = 'missed', breached_at = now()
      where rc.status = 'open' and rc.due_date < current_date
      returning rc.id, rc.organization_id, rc.approval_id, rc.condition_ref,
                rc.description, rc.owner_id, rc.due_date, rc.consequence_if_missed,
                rc.obligation_domain, rc.propagated_work_order_id)
    select e.*, ap.permit_number, ap.deciding_authority, rr.regulator,
           rr.development_case_id
    from escalated e
    join regulatory_approvals ap on ap.id = e.approval_id
    join regulatory_applications a on a.id = ap.application_id
    join regulatory_requirements rr on rr.id = a.requirement_id
  loop
    v_reg_cond := v_reg_cond + 1;
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (rec.organization_id, 'regulatory_condition', 'system:expiry_sweep',
      jsonb_build_object('condition_id', rec.id, 'action', 'escalated_overdue',
        'condition_ref', rec.condition_ref, 'permit_number', rec.permit_number,
        'case_id', rec.development_case_id, 'due_date', rec.due_date,
        'owner_id', rec.owner_id, 'obligation_domain', rec.obligation_domain,
        'work_order_id', rec.propagated_work_order_id),
      jsonb_build_object('status', 'open', 'breached_at', null),
      jsonb_build_object('status', 'missed', 'breached_at', now()));
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (rec.organization_id, null, 'system (expiry sweep)',
       'admin_action', 'critical',
       format('REGULATORY CONDITION BREACHED: permit %s (%s, %s) condition %s "%s" was due %s and is unmet. Owner: %s. Domain: %s. Recorded consequence if missed: %s. This is a condition of the authorization the project operates under, not an internal action.',
              rec.permit_number, rec.deciding_authority, rec.regulator,
              rec.condition_ref, rec.description, rec.due_date,
              coalesce((select coalesce(p.full_name, p.email) from user_profiles p where p.id = rec.owner_id), rec.owner_id::text),
              rec.obligation_domain, rec.consequence_if_missed));
  end loop;

  -- D3.11 (20261122090200, marked insertion): a LAPSED PERMIT. The activity
  -- it authorized is no longer authorized, and that sentence is the whole
  -- reason this pass exists.
  v_permits := 0;
  for rec in
    with lapsed as (
      update regulatory_approvals ap
      set status = 'expired'
      where ap.status = 'active' and ap.perpetual = false
        and ap.expires_at is not null and ap.expires_at < current_date
      returning ap.id, ap.organization_id, ap.permit_number, ap.deciding_authority,
                ap.expires_at, ap.application_id)
    select l.*, rr.regulator, rr.permit_type, rr.development_case_id
    from lapsed l
    join regulatory_applications a on a.id = l.application_id
    join regulatory_requirements rr on rr.id = a.requirement_id
  loop
    v_permits := v_permits + 1;
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (rec.organization_id, 'regulatory_approval', 'system:expiry_sweep',
      jsonb_build_object('approval_id', rec.id, 'action', 'expired',
        'permit_number', rec.permit_number, 'case_id', rec.development_case_id,
        'expired_at', rec.expires_at),
      jsonb_build_object('status', 'active'),
      jsonb_build_object('status', 'expired'));
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (rec.organization_id, null, 'system (expiry sweep)',
       'admin_action', 'critical',
       format('PERMIT LAPSED: %s (%s, issued by %s) expired %s. The activity it authorized is NO LONGER AUTHORIZED. Renew through the approval chain (a new application against the same requirement) — a permit does not continue to authorize anything by lapse of attention.',
              rec.permit_number, rec.permit_type, rec.deciding_authority, rec.expires_at));
  end loop;

  -- D3.10 (20261122090200, marked insertion): an information request past
  -- its response date. The unowned RFI is where permits die; this makes the
  -- death loud.
  v_rfi := 0;
  for rec in
    with late as (
      update regulatory_information_requests q
      set status = 'overdue', breached_at = now()
      where q.status = 'open' and q.response_due < current_date
      returning q.id, q.organization_id, q.request_ref, q.owner_id,
                q.response_due, q.application_id)
    select l.*, a.application_ref, rr.regulator, rr.development_case_id
    from late l
    join regulatory_applications a on a.id = l.application_id
    join regulatory_requirements rr on rr.id = a.requirement_id
  loop
    v_rfi := v_rfi + 1;
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (rec.organization_id, 'regulatory_information_request', 'system:expiry_sweep',
      jsonb_build_object('request_id', rec.id, 'action', 'escalated_overdue',
        'request_ref', rec.request_ref, 'case_id', rec.development_case_id,
        'response_due', rec.response_due, 'owner_id', rec.owner_id),
      jsonb_build_object('status', 'open', 'breached_at', null),
      jsonb_build_object('status', 'overdue', 'breached_at', now()));
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (rec.organization_id, null, 'system (expiry sweep)',
       'admin_action', 'warning',
       format('Regulator information request OVERDUE: %s on application %s (%s), response was due %s. Owner: %s. The permit clock is not running while this sits unanswered — the delay is ours, not the regulator''s.',
              rec.request_ref, rec.application_ref, rec.regulator, rec.response_due,
              coalesce((select coalesce(p.full_name, p.email) from user_profiles p where p.id = rec.owner_id), rec.owner_id::text)));
  end loop;
  perform set_config('app.regulatory_chain_write', '', true);

  -- D3.08 (20261122090200, marked insertion): an overdue stakeholder
  -- commitment. Named with the stakeholder it was owed to, because "action
  -- 42 is late" and "we broke a promise to the Fort McKay community" are
  -- not the same sentence.
  v_commit := 0;
  perform set_config('app.stakeholder_commitment_write', 'granted', true);
  for rec in
    with breached as (
      update stakeholder_commitments sc
      set status = 'breached', breached_at = now()
      where sc.status = 'open' and sc.due_date < current_date
      returning sc.id, sc.organization_id, sc.development_case_id, sc.commitment_ref,
                sc.commitment, sc.owner_id, sc.due_date, sc.stakeholder_id,
                sc.requirement_id, sc.commitment_kind)
    select b.*, st.name as stakeholder_name, st.external_organization
    from breached b
    join risk_stakeholders st on st.id = b.stakeholder_id
  loop
    v_commit := v_commit + 1;
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (rec.organization_id, 'stakeholder_commitment', 'system:expiry_sweep',
      jsonb_build_object('commitment_id', rec.id, 'action', 'escalated_overdue',
        'commitment_ref', rec.commitment_ref, 'case_id', rec.development_case_id,
        'due_date', rec.due_date, 'owner_id', rec.owner_id,
        'covered', rec.requirement_id is not null),
      jsonb_build_object('status', 'open', 'breached_at', null),
      jsonb_build_object('status', 'breached', 'breached_at', now()));
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (rec.organization_id, null, 'system (expiry sweep)',
       'admin_action', 'warning',
       format('STAKEHOLDER COMMITMENT BREACHED: %s to %s%s — "%s" was due %s. Owner: %s.%s',
              rec.commitment_ref, rec.stakeholder_name,
              coalesce(' (' || rec.external_organization || ')', ''),
              rec.commitment, rec.due_date,
              coalesce((select coalesce(p.full_name, p.email) from user_profiles p where p.id = rec.owner_id), rec.owner_id::text),
              case when rec.requirement_id is null
                then ' This commitment was never carried by a project requirement (spec I.18) — it had nothing in the project delivering it.'
                else '' end));
  end loop;
  perform set_config('app.stakeholder_commitment_write', '', true);

  return jsonb_build_object('variances_expired', v_var, 'risk_acceptances_expired', v_risk,
    'gate_conditions_escalated', v_cond,
    -- D3.11/D3.10/D3.08 (20261122090200, marked insertion).
    'regulatory_conditions_escalated', v_reg_cond,
    'permits_expired', v_permits,
    'information_requests_overdue', v_rfi,
    'stakeholder_commitments_breached', v_commit);
end
$$;

revoke all on function public.expire_governance_instruments() from public, anon;
grant execute on function public.expire_governance_instruments() to service_role;

-- Same job, same slot (the 20260809140000 schedule, unchanged): re-schedule
-- so a fresh chain and an upgraded one carry the extended definition alike.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire-governance-instruments')
    where exists (select 1 from cron.job where jobname = 'expire-governance-instruments');
    perform cron.schedule('expire-governance-instruments', '7 * * * *',
      $cron$select public.expire_governance_instruments();$cron$);
  end if;
exception when others then null;
end $$;

notify pgrst, 'reload schema';
