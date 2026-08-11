-- ============================================================================
-- The recommendation contract, enforced (register C8.15, C8.17, C8.18, C8.20,
-- C8.21).
--
-- WHAT WAS ACTUALLY WRONG.
--
-- `recommendations` already carried consequence_summary,
-- alternatives_considered, required_completion_date, required_approver_role and
-- verification_method. Across the 70 rows in production they were populated
-- 0, 0, 0, 0 and 1 times respectively.
--
-- The schema was complete and the capability was not. That is the same shape as
-- a twin template with no components: it registers as present and reasons about
-- nothing. A column nobody fills is not a contract, so this stops treating the
-- column's existence as the capability and starts treating its CONTENT as the
-- gate.
--
-- WHY BLOCKING RATHER THAN SCORING.
--
-- The five unpopulated fields are precisely the ones an approver needs and
-- cannot supply for themselves — what happens if we do nothing, what else was
-- considered, by when, who may say yes, and how we will know it worked. Seven
-- of eleven fields present reads as 64% on any score and is missing all of
-- those. Releasing is a binary act, so the check is binary too.
--
-- WHAT THIS DOES NOT DO.
--
-- It does not fill the fields. There is no defensible way to derive "what else
-- was considered" from a row that never recorded it, and inventing one would
-- produce exactly the plausible fiction this register exists to keep out. The
-- backlog of 70 incomplete recommendations stays incomplete and stays visible.
--
-- Canonical reuse: recommendations, app_current_org(). Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Release gate. Refuses rather than warns.
-- ---------------------------------------------------------------------------
drop function if exists check_recommendation_contract(uuid);
create or replace function check_recommendation_contract(p_recommendation_id uuid)
returns table (
  releasable boolean,
  "missingFields" text[],
  completeness numeric,
  reason text
)
language plpgsql stable security definer set search_path = public as $$
declare
  r recommendations%rowtype;
  v_missing text[] := '{}';
  v_present int := 0;
  v_total int := 11;
begin
  select * into r from recommendations
  where id = p_recommendation_id and organization_id = app_current_org();

  if not found then
    return query select false, array['(not found)']::text[], 0::numeric,
      'No such recommendation in this organization.'::text;
    return;
  end if;

  -- btrim so a field holding a space does not pass. That is the commonest way
  -- a required field gets defeated: it satisfies NOT NULL and answers nothing.
  --
  -- array_append rather than ||: with a text containing commas, Postgres
  -- resolves `text[] || text` as array-literal concatenation and fails on the
  -- first message that reads like an array. Explicit is cheaper than clever.
  if r.asset_id is not null then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'asset and functional location (C8.11)'); end if;
  if coalesce(btrim(r.issue),'') <> '' then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'current condition or problem (C8.12)'); end if;
  if coalesce(btrim(r.rationale),'') <> '' then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'evidence used (C8.13)'); end if;
  if coalesce(btrim(r.action),'') <> '' then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'recommended action (C8.16)'); end if;
  if r.confidence is not null then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'confidence and uncertainty (C8.19)'); end if;
  if coalesce(btrim(r.consequence_summary),'') <> '' then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'consequence — safety, environmental, production, financial (C8.15): approving without it is a judgement about cost with the benefit left blank'); end if;
  if coalesce(btrim(r.alternatives_considered),'') <> '' then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'alternatives considered (C8.17): without it an approver cannot tell a recommendation from the only idea anybody had'); end if;
  if r.required_completion_date is not null then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'required completion date (C8.18): "soon" is not schedulable and can never be overdue'); end if;
  if coalesce(btrim(r.required_approver_role),'') <> '' then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'required approver (C8.20): unstated, it defaults to whoever happens to be looking'); end if;
  if coalesce(btrim(r.verification_method),'') <> '' then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'verification method (C8.21): without it the loop never closes and this returns next year'); end if;
  -- Advisory: not every recommendation is failure-driven.
  if coalesce(btrim(r.impact),'') <> '' then v_present := v_present + 1; end if;

  return query select
    array_length(v_missing, 1) is null,
    v_missing,
    round(v_present::numeric / v_total, 2),
    case when array_length(v_missing,1) is null
      then 'Contract complete. Every field an approver needs is present.'
      else format(
        'NOT RELEASABLE — %s required field(s) missing. Completeness is %s%%, reported '
        || 'and deliberately not used as the gate: releasing is binary, and missing '
        || 'fields do not become acceptable by being outnumbered.',
        array_length(v_missing,1), round(100.0 * v_present / v_total))
    end;
end;
$$;

grant execute on function check_recommendation_contract(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enforce it at the point of release.
--
-- A trigger rather than application code: the gate has to hold whatever writes
-- to the table, including the enrichment pipeline and any future connector.
-- ---------------------------------------------------------------------------
create or replace function enforce_recommendation_contract()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_missing text[];
begin
  -- Only on the transition INTO an actionable state. A draft may be incomplete;
  -- that is what draft means.
  if new.status is not distinct from old.status
     or new.status not in ('approved','released','scheduled') then
    return new;
  end if;

  select "missingFields" into v_missing
  from check_recommendation_contract(new.id);

  if array_length(v_missing, 1) > 0 then
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

-- ---------------------------------------------------------------------------
-- Posture. Per-field population across the backlog — the shell detector.
-- ---------------------------------------------------------------------------
drop function if exists get_recommendation_contract_posture();
create or replace function get_recommendation_contract_posture()
returns table (
  register text,
  label text,
  blocking boolean,
  populated bigint,
  total bigint,
  share numeric
)
language sql stable security definer set search_path = public as $$
  with r as (select * from recommendations where organization_id = app_current_org()),
  t as (select count(*) n from r)
  select v.reg, v.lab, v.blk, v.pop, t.n,
         case when t.n > 0 then round(v.pop::numeric / t.n, 3) else 0 end
  from t, lateral (values
    ('C8.11','Asset and functional location', true,
      (select count(*) from r where asset_id is not null)),
    ('C8.12','Current condition or problem', true,
      (select count(*) from r where coalesce(btrim(issue),'') <> '')),
    ('C8.13','Evidence used', true,
      (select count(*) from r where coalesce(btrim(rationale),'') <> '')),
    ('C8.15','Consequence: safety, environmental, production, financial', true,
      (select count(*) from r where coalesce(btrim(consequence_summary),'') <> '')),
    ('C8.16','Recommended action', true,
      (select count(*) from r where coalesce(btrim(action),'') <> '')),
    ('C8.17','Alternative actions considered', true,
      (select count(*) from r where coalesce(btrim(alternatives_considered),'') <> '')),
    ('C8.18','Required completion date', true,
      (select count(*) from r where required_completion_date is not null)),
    ('C8.19','Confidence and uncertainty', true,
      (select count(*) from r where confidence is not null)),
    ('C8.20','Required human approval (named authority)', true,
      (select count(*) from r where coalesce(btrim(required_approver_role),'') <> '')),
    ('C8.21','Method for verifying effectiveness', true,
      (select count(*) from r where coalesce(btrim(verification_method),'') <> ''))
  ) as v(reg, lab, blk, pop)
  order by 6, 1;
$$;

grant execute on function get_recommendation_contract_posture() to authenticated;

notify pgrst, 'reload schema';
