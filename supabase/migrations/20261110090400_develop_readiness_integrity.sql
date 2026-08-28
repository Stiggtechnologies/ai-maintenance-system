-- ============================================================================
-- Sync Develop Slice 1 — readiness integrity repairs (rows 9–10 hardening).
--
-- Two functions from the #282 chunk are re-created with one delta each,
-- byte-identical otherwise (assembled from the prior definitions by exact
-- string replacement at authoring time). Both deltas close gaps an
-- adversarial review proved live against a real database; neither changes
-- any accepted behavior.
--
-- 1. record_case_gate_review (from 20261101090300) — REFUSES a review whose
--    p_findings carries two findings for one trimmed criterion text.
--
--    Nothing makes stage_gate_findings (review_id, criterion_text) unique,
--    and the mandatory-block's `exists (status = 'met')` test was satisfiable
--    by one of two CONTRADICTORY findings: a mandatory criterion recorded
--    met AND not_met in the same review still admitted a 'proceed', while
--    every honest reader — the client evaluator's one-finding-per-criterion
--    Map, get_gate_readiness's LATERAL — scores that criterion once. That is
--    enforced truth diverging from displayed truth, the exact break the
--    #282 principle exists to prevent. A refusal (not a silent dedup) is the
--    only answer consistent with this repository's no-silent-overwrite rule:
--    the review states a contradiction, so the review is not recordable.
--    With the RPC refusing duplicates, the only remaining duplicate door is
--    the service path, which the provenance trigger already admits-and-
--    audits — and whose rows get_gate_readiness now collapses latest-wins
--    rather than fanning out counts (20261110090100).
--
--    A UNIQUE index on (review_id, btrim(criterion_text)) would be the belt
--    here, and is deliberately NOT added: stage_gate_findings predates this
--    program (20260816090000) on the asset-scoped gate family, and an index
--    build that can abort the production merge-order deploy on legacy
--    duplicate rows is a deploy risk a repair migration must not take
--    (fresh-install CI would never see what production data does). The RPC
--    refusal plus the read-side collapse make duplicates non-injectable by
--    any authenticated path and harmless to every displayed number, which is
--    the invariant that matters.
--
-- 2. enforce_framework_requirement_immutability (from 20261101090400) —
--    `weight` joins the guarded content columns.
--
--    20261110090100 added stage_gate_criteria.weight as per-requirement
--    configuration that version cloning deliberately carries ("configuration
--    of THIS requirement"), but the adopted-framework immutability backstop
--    predates the column and did not guard it: an RLS-bypassed client could
--    re-weight an adopted framework's readiness arithmetic (weight = 0.0001
--    verified live), and a service write moved it with NO security_events
--    row — a silent, unaudited change to what an adopted version's readiness
--    percentage means, outside the change-arrives-as-a-new-version
--    discipline. Weight cannot move `blocked` (count-based, §45) — this
--    guards the PERCENTAGE's meaning and the audit trail. After this
--    migration a weight change on an adopted framework is refused for
--    clients (insufficient_privilege) and admitted-AND-audited for the
--    service path, exactly like every other guarded content column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. record_case_gate_review, re-created with the duplicate-finding refusal
--    (see header). Deltas vs 20261101090300: the v_seen_criteria declaration
--    and the duplicate check in the findings validation loop. CREATE OR
--    REPLACE on the same signature; grants restated for self-documentation.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_gate_review(
  p_case_id uuid,
  p_gate_id bigint,
  p_outcome text,
  p_note text,
  p_findings jsonb default '[]'::jsonb,
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
  c development_cases%rowtype;
  g stage_gates%rowtype;
  v_review_id bigint;
  v_mandatory_total int;
  v_criteria_total int;
  v_unmet text[];
  f jsonb;
  cond jsonb;
  v_cond_count int := 0;
  v_finding_count int := 0;
  v_seen_criteria text[] := '{}';
  v_owner uuid;
  v_conditions_text text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'a gate decision is a §70 human determination — the AI-operator identity cannot record one');
    end if;
    return jsonb_build_object('error', 'recording a gate decision requires a governance or engineering role');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'gates are not recordable on a ' || c.status || ' case');
  end if;

  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  if p_outcome in ('pass','pass_with_conditions') then
    return jsonb_build_object('error',
      'case gate reviews use the reconciled vocabulary — record ''proceed'' or ''proceed_with_conditions''');
  end if;
  if p_outcome not in ('proceed','proceed_with_conditions','hold','recycle','pivot','redesign','pause','terminate') then
    return jsonb_build_object('error',
      'outcome must be one of proceed, proceed_with_conditions, hold, recycle, pivot, redesign, pause, terminate');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for this gate decision (20 characters minimum)');
  end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then
    return jsonb_build_object('error', 'findings must be a json array');
  end if;
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' then
    return jsonb_build_object('error', 'conditions must be a json array');
  end if;

  -- Slice-1 segregation minimum on independent-assurance gates.
  if g.independent_assurance_required
     and p_outcome in ('proceed','proceed_with_conditions')
     and (auth.uid() = c.sponsor_id or auth.uid() = c.created_by) then
    return jsonb_build_object('error',
      'this gate requires independent assurance: the case sponsor or creator cannot record its decision (segregation of duties)');
  end if;

  -- Validate findings before anything is written.
  for f in select * from jsonb_array_elements(p_findings) loop
    if coalesce(btrim(f->>'criterion_text'), '') = '' then
      return jsonb_build_object('error', 'every finding names its criterion (criterion_text)');
    end if;
    if btrim(f->>'criterion_text') = any(v_seen_criteria) then
      return jsonb_build_object('error',
        format('duplicate finding for criterion "%s" — a review carries exactly one finding per criterion, because two findings on one criterion is a contradiction the gate would have to resolve silently', btrim(f->>'criterion_text')));
    end if;
    v_seen_criteria := v_seen_criteria || btrim(f->>'criterion_text');
    if coalesce(f->>'status', '') not in ('met','not_met','not_assessed') then
      return jsonb_build_object('error', 'finding status must be met, not_met or not_assessed');
    end if;
    if f ? 'criterion_id' and nullif(f->>'criterion_id','') is not null and not exists (
      select 1 from stage_gate_criteria sc
      where sc.id = (f->>'criterion_id')::bigint
        and sc.organization_id = v_org and sc.gate_id = p_gate_id
    ) then
      return jsonb_build_object('error', 'finding references a criterion that does not belong to this gate');
    end if;
    v_finding_count := v_finding_count + 1;
  end loop;

  -- THE MANDATORY BLOCK (assessGate's discipline, repeated at the DB).
  select count(*), count(*) filter (where is_mandatory)
    into v_criteria_total, v_mandatory_total
  from stage_gate_criteria
  where organization_id = v_org and gate_id = p_gate_id;

  if p_outcome in ('proceed','proceed_with_conditions') then
    if v_criteria_total = 0 then
      return jsonb_build_object('error',
        'this gate defines no criteria, so it can block nothing — define what it requires before recording a proceed through it');
    end if;
    select coalesce(array_agg(sc.criterion), '{}') into v_unmet
    from stage_gate_criteria sc
    where sc.organization_id = v_org and sc.gate_id = p_gate_id and sc.is_mandatory
      and not exists (
        select 1 from jsonb_array_elements(p_findings) pf
        where btrim(pf->>'criterion_text') = btrim(sc.criterion)
          and pf->>'status' = 'met'
      );
    if array_length(v_unmet, 1) > 0 then
      return jsonb_build_object('error',
        format('cannot record %s: %s mandatory criterion/criteria are not explicitly met in this review — silence and not-assessed block for the same reason a failure does', p_outcome, array_length(v_unmet, 1)),
        'unmet_mandatory', to_jsonb(v_unmet));
    end if;
  end if;

  -- Conditions: exactly with a conditional proceed, never otherwise.
  if p_outcome = 'proceed_with_conditions' then
    if jsonb_array_length(p_conditions) = 0 then
      return jsonb_build_object('error',
        'proceed_with_conditions requires at least one condition, each with owner, due date, evidence requirement and consequence-if-missed (spec II.16)');
    end if;
    for cond in select * from jsonb_array_elements(p_conditions) loop
      if coalesce(length(btrim(cond->>'description')), 0) < 10 then
        return jsonb_build_object('error', 'each condition states what must be done (10 characters minimum)');
      end if;
      v_owner := nullif(cond->>'owner_id','')::uuid;
      if v_owner is null or not exists (
        select 1 from user_profiles up where up.id = v_owner and up.organization_id = v_org
      ) then
        return jsonb_build_object('error', 'each condition names an owner who is a member of this organization');
      end if;
      if nullif(cond->>'due_date','') is null then
        return jsonb_build_object('error', 'each condition carries a due date');
      end if;
      if (cond->>'due_date')::date < current_date then
        return jsonb_build_object('error', 'a condition cannot be born overdue — its due date is today or later');
      end if;
      if coalesce(length(btrim(cond->>'evidence_requirement')), 0) < 5 then
        return jsonb_build_object('error', 'each condition states the evidence that will close it');
      end if;
      if coalesce(length(btrim(cond->>'consequence_if_missed')), 0) < 5 then
        return jsonb_build_object('error', 'each condition states the consequence if it is missed');
      end if;
      v_cond_count := v_cond_count + 1;
    end loop;
  elsif jsonb_array_length(p_conditions) > 0 then
    return jsonb_build_object('error', 'conditions attach to a proceed_with_conditions outcome only');
  end if;

  if p_outcome = 'proceed_with_conditions' then
    select string_agg(btrim(x->>'description'), '; ') into v_conditions_text
    from jsonb_array_elements(p_conditions) x;
  end if;

  -- The sanctioned write. Local marker: cannot outlive this transaction.
  perform set_config('app.gate_review_write', 'granted', true);

  insert into stage_gate_reviews
    (organization_id, development_case_id, gate_id, stage_key, outcome,
     conditions, reviewed_by, reviewed_at, note)
  values
    (v_org, c.id, g.id, g.stage_key, p_outcome,
     v_conditions_text, auth.uid(), now(), btrim(p_note))
  returning id into v_review_id;

  insert into stage_gate_findings
    (organization_id, review_id, criterion_id, criterion_text, status, evidence)
  select v_org, v_review_id,
         nullif(x->>'criterion_id','')::bigint,
         btrim(x->>'criterion_text'),
         x->>'status',
         nullif(btrim(coalesce(x->>'evidence','')), '')
  from jsonb_array_elements(p_findings) x;

  insert into gate_conditions
    (organization_id, review_id, description, owner_id, due_date,
     evidence_requirement, consequence_if_missed)
  select v_org, v_review_id,
         btrim(x->>'description'),
         (x->>'owner_id')::uuid,
         (x->>'due_date')::date,
         btrim(x->>'evidence_requirement'),
         btrim(x->>'consequence_if_missed')
  from jsonb_array_elements(p_conditions) x;

  perform set_config('app.gate_review_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_gate_review', coalesce(v_role, 'unknown'),
    jsonb_build_object('review_id', v_review_id, 'case_id', c.id, 'gate_id', g.id,
      'gate', g.name, 'decision_type', g.decision_type, 'outcome', p_outcome,
      'findings', v_finding_count, 'conditions', v_cond_count));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Gate decision "%s" recorded on %s (%s) for case %s as role %s.',
            p_outcome, g.name, g.decision_type, c.title, coalesce(v_role, 'none')));

  return jsonb_build_object(
    'review_id', v_review_id, 'outcome', p_outcome,
    'gate', g.name, 'decision_type', g.decision_type,
    'findings_recorded', v_finding_count, 'conditions_recorded', v_cond_count);
end
$$;

revoke all on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. enforce_framework_requirement_immutability, re-created with `weight` in
--    the guarded UPDATE list (see header). Delta vs 20261101090400: one
--    `new.weight is distinct from old.weight` line. The trigger itself is
--    unchanged and stays bound to this function name.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_framework_requirement_immutability()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.framework_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_gate_id bigint := case when tg_op = 'DELETE' then old.gate_id else new.gate_id end;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_fw_status text;
  v_guarded boolean := false;
begin
  -- A re-scope between gates is judged against the stricter side.
  if tg_op = 'UPDATE' and new.gate_id is distinct from old.gate_id then
    if old.gate_id is not null then
      select f.status into v_fw_status
      from stage_gates g join project_frameworks f on f.id = g.framework_id
      where g.id = old.gate_id;
      if found and v_fw_status <> 'draft' then
        v_guarded := true;
      end if;
    end if;
  end if;

  if not v_guarded then
    if v_gate_id is null then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    select f.status into v_fw_status
    from stage_gates g join project_frameworks f on f.id = g.framework_id
    where g.id = v_gate_id;
    if not found or v_fw_status = 'draft' then
      -- Draft framework, or gate mid-cascade-delete: not this boundary.
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    if tg_op = 'UPDATE' then
      v_guarded := new.criterion is distinct from old.criterion
                or new.is_mandatory is distinct from old.is_mandatory
                or new.guidance is distinct from old.guidance
                or new.sort_order is distinct from old.sort_order
                or new.category is distinct from old.category
                or new.evidence_type is distinct from old.evidence_type
                or new.minimum_confidence is distinct from old.minimum_confidence
                or new.weight is distinct from old.weight
                or new.stage_key is distinct from old.stage_key
                or new.gate_id is distinct from old.gate_id;
    else
      v_guarded := true;
    end if;
  end if;

  if not v_guarded then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Adopted-framework requirement content on stage_gate_criteria (' || lower(tg_op)
           || ', row ' || (case when tg_op = 'DELETE' then old.id::text else new.id::text end)
           || ') written by a service caller outside the framework RPCs. An adopted '
           || 'framework version''s requirements are immutable to clients; a service '
           || 'rewrite is recorded because it changes what past gate decisions required.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'An adopted framework version is immutable — its requirements (text, mandatory '
      'flag, thresholds, scope) are the record of what its gates demanded. Change '
      'arrives as a new version (create_project_framework_version); provenance moves '
      'only through its own governed machinery (promote_requirement_authority).'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

notify pgrst, 'reload schema';
