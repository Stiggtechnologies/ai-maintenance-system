-- ============================================================================
-- Fix: the gate must not depend on there being a session.
--
-- check_recommendation_contract() scopes its read to app_current_org(), which
-- is correct for an RPC a user calls. The TRIGGER then called it — and a
-- trigger runs wherever the write comes from, including the service role, an
-- edge function and any background job, where app_current_org() is null. The
-- row came back "not found" and the trigger blocked EVERY approval while
-- reporting "the contract is incomplete", which is both wrong and misleading.
--
-- Same root cause as the knowledge-base retrieval defect earlier: a
-- session-scoped helper reused in a context that has no session.
--
-- The fix is to stop re-reading the row at all. A BEFORE UPDATE trigger already
-- holds it. So the field checks move into one function that takes the row, and
-- both callers use it — the trigger passing NEW, the RPC passing what it read
-- under the caller's own scope.
-- ============================================================================

create or replace function recommendation_contract_gaps(r recommendations)
returns text[]
language sql immutable set search_path = public as $$
  select array_remove(array[
    case when r.asset_id is null
      then 'asset and functional location (C8.11)' end,
    case when coalesce(btrim(r.issue),'') = ''
      then 'current condition or problem (C8.12)' end,
    case when coalesce(btrim(r.rationale),'') = ''
      then 'evidence used (C8.13)' end,
    case when coalesce(btrim(r.action),'') = ''
      then 'recommended action (C8.16)' end,
    case when r.confidence is null
      then 'confidence and uncertainty (C8.19)' end,
    case when coalesce(btrim(r.consequence_summary),'') = ''
      then 'consequence — safety, environmental, production, financial (C8.15): approving without it is a judgement about cost with the benefit left blank' end,
    case when coalesce(btrim(r.alternatives_considered),'') = ''
      then 'alternatives considered (C8.17): without it an approver cannot tell a recommendation from the only idea anybody had' end,
    case when r.required_completion_date is null
      then 'required completion date (C8.18): "soon" is not schedulable and can never be overdue' end,
    case when coalesce(btrim(r.required_approver_role),'') = ''
      then 'required approver (C8.20): unstated, it defaults to whoever happens to be looking' end,
    case when coalesce(btrim(r.verification_method),'') = ''
      then 'verification method (C8.21): without it the loop never closes and this returns next year' end
  ], null);
$$;

drop function if exists check_recommendation_contract(uuid);
create or replace function check_recommendation_contract(p_recommendation_id uuid)
returns table (releasable boolean, "missingFields" text[], completeness numeric, reason text)
language plpgsql stable security definer set search_path = public as $$
declare r recommendations%rowtype; v_missing text[]; v_present int;
begin
  select * into r from recommendations
  where id = p_recommendation_id and organization_id = app_current_org();
  if not found then
    -- Distinct from an incomplete contract, and says so.
    return query select false, array['(not visible in this organization)']::text[],
      0::numeric, 'No such recommendation in this organization.'::text;
    return;
  end if;

  v_missing := recommendation_contract_gaps(r);
  v_present := 10 - coalesce(array_length(v_missing,1), 0);

  return query select
    coalesce(array_length(v_missing,1),0) = 0,
    coalesce(v_missing, '{}'::text[]),
    round(v_present::numeric / 10, 2),
    case when coalesce(array_length(v_missing,1),0) = 0
      then 'Contract complete. Every field an approver needs is present.'
      else format('NOT RELEASABLE — %s required field(s) missing. Completeness is %s%%, '
        || 'reported and deliberately not used as the gate: releasing is binary, and '
        || 'missing fields do not become acceptable by being outnumbered.',
        array_length(v_missing,1), round(100.0 * v_present / 10)) end;
end;
$$;
grant execute on function check_recommendation_contract(uuid) to authenticated;

create or replace function enforce_recommendation_contract()
returns trigger language plpgsql set search_path = public as $$
declare v_missing text[];
begin
  if new.status is not distinct from old.status
     or new.status not in ('approved','released','scheduled') then
    return new;
  end if;
  -- NEW, not a re-read. The trigger has the row; going back to the table only
  -- introduced a dependency on a session that a trigger cannot assume.
  v_missing := recommendation_contract_gaps(new);
  if coalesce(array_length(v_missing,1),0) > 0 then
    raise exception
      'Recommendation cannot move to "%" — the contract is incomplete: %. These are '
      'the fields an approver needs and cannot supply for themselves.',
      new.status, array_to_string(v_missing, '; ')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_recommendation_contract on recommendations;
create trigger trg_recommendation_contract
  before update of status on recommendations
  for each row execute function enforce_recommendation_contract();

notify pgrst, 'reload schema';
