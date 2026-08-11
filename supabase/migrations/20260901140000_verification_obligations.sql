-- ============================================================================
-- Verification obligations: the loop between "we said how we'd know it worked"
-- and "we know whether it worked" (register C4.08 verify, C4.11 correct,
-- C4.12 update strategy; the northstar's closing question).
--
-- THE GAP, MEASURED.
--
-- 64 recommendations carry a verification_method — enforced at release by the
-- C8 contract gate. The number of recommendation outcomes ever verified: zero.
-- The platform requires everyone to SAY how they will know the action worked,
-- and then nothing tracks whether anyone looked. That is the loop standing
-- open while appearing closed, and it is the exact question the platform's own
-- target state ends on: "did the approved action produce the intended outcome
-- without increasing risk?"
--
-- WHAT EXISTS AND IS NOT DUPLICATED.
--
--   ca_verifications  — work-order level: did the corrective action physically
--                       hold, was the cause addressed, did the failure recur in
--                       the observation window. Reused, not rebuilt: an
--                       obligation can point at one.
--   value_metrics     — the financial claim. Separate concern, kept separate.
--   learning_events   — where a failed verification must land, because an
--                       outcome that did not materialise is exactly what the
--                       learning loop is for.
--
-- The new thing is RECOMMENDATION-level: the stated method, a due date, an
-- executed-or-not, and a result that feeds back.
--
-- TWO HONESTY RULES BUILT IN.
--
--   1. The method is SNAPSHOTTED at approval. A recommendation can be edited
--      after approval; the obligation records what was promised at the moment
--      of approval, so the promise cannot drift to match whatever was done.
--
--   2. A due date is required to be real or declared assumed. Free-text methods
--      say "at 500h" or "after two PM cycles" — unparseable. The obligation
--      defaults to completion date + 30 days MARKED AS ASSUMED, because an
--      obligation with no due date can never become overdue, and invisible is
--      the one thing an open verification must not be.
-- ============================================================================

create table if not exists verification_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  -- Snapshot of the promise, taken at approval.
  method text not null,
  intended_outcome text,
  due_date date not null,
  due_date_assumed boolean not null default true,
  -- Link to the WO-level corrective-action verification where one exists.
  ca_verification_id uuid references ca_verifications(id) on delete set null,
  status text not null default 'open'
    check (status in ('open','completed','waived')),
  -- Result, recorded only on completion.
  result text check (result in ('achieved','not_achieved','inconclusive')),
  measured_note text,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  -- Set when a not_achieved result raised a learning event, closing the loop.
  learning_event_id uuid references learning_events(id) on delete set null,
  waive_reason text,
  created_at timestamptz not null default now(),
  unique(recommendation_id),
  -- A completed obligation must carry a result and evidence; a waived one must
  -- say why. Statuses that carry nothing are how loops rot.
  constraint completed_needs_result
    check (status <> 'completed'
           or (result is not null and coalesce(btrim(measured_note),'') <> '')),
  constraint waived_needs_reason
    check (status <> 'waived' or coalesce(btrim(waive_reason),'') <> '')
);

create index if not exists idx_vobl_open
  on verification_obligations(organization_id, due_date)
  where status = 'open';

alter table verification_obligations enable row level security;
drop policy if exists vobl_read on verification_obligations;
create policy vobl_read on verification_obligations
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Create the obligation at the same transition the contract gate watches.
-- The gate guarantees verification_method exists at this moment; the trigger
-- turns it from a statement into a debt.
-- ---------------------------------------------------------------------------
create or replace function create_verification_obligation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved','released','scheduled')
     and coalesce(btrim(new.verification_method),'') <> '' then
    insert into verification_obligations (
      organization_id, recommendation_id, asset_id, method, intended_outcome,
      due_date, due_date_assumed
    ) values (
      new.organization_id, new.id, new.asset_id,
      new.verification_method,
      new.consequence_summary,
      -- Real horizon is inside free text ("at 500h") and not parseable.
      -- Assumed date = required completion + 30 days, and SAYS it is assumed.
      coalesce(new.required_completion_date, current_date) + 30,
      true
    )
    on conflict (recommendation_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_verification_obligation on recommendations;
create trigger trg_create_verification_obligation
  after update of status on recommendations
  for each row execute function create_verification_obligation();

-- ---------------------------------------------------------------------------
-- Record the result. On not_achieved, the loop closes into learning_events and
-- the recommendation is flagged rather than quietly left "done".
-- ---------------------------------------------------------------------------
drop function if exists record_verification_result(uuid, text, text);
create or replace function record_verification_result(
  p_obligation_id uuid,
  p_result text,
  p_measured_note text
)
returns table (outcome text, "learningEventId" uuid, detail text)
language plpgsql security definer set search_path = public as $$
declare
  o verification_obligations%rowtype;
  r recommendations%rowtype;
  v_le uuid;
begin
  select * into o from verification_obligations
  where id = p_obligation_id and organization_id = app_current_org();
  if not found then
    return query select 'error'::text, null::uuid, 'No such obligation in this organization.'::text;
    return;
  end if;
  if o.status <> 'open' then
    return query select 'refused'::text, null::uuid,
      format('Obligation is already %s. A verification is recorded once; a second '
             || 'opinion belongs in a new observation, not an overwrite.', o.status);
    return;
  end if;
  if p_result not in ('achieved','not_achieved','inconclusive') then
    return query select 'error'::text, null::uuid,
      'Result must be achieved, not_achieved or inconclusive.'::text;
    return;
  end if;
  if coalesce(btrim(p_measured_note),'') = '' then
    return query select 'refused'::text, null::uuid,
      ('A result with no measurement is an opinion. Record what was measured, '
       || 'against what, and when.')::text;
    return;
  end if;

  select * into r from recommendations where id = o.recommendation_id;

  if p_result = 'not_achieved' then
    insert into learning_events (
      organization_id, recommendation_id, asset_id, event_type, title, detail
    ) values (
      o.organization_id, o.recommendation_id, o.asset_id,
      'verification_failed',
      format('Verification failed: %s', coalesce(r.title, 'recommendation')),
      format('The approved action did not produce the intended outcome. Method: %s. '
             || 'Measured: %s. The action was taken and the problem remains — the '
             || 'strategy that produced this recommendation needs re-examination, '
             || 'not a repeat of the same action.',
             o.method, p_measured_note)
    ) returning id into v_le;
  end if;

  update verification_obligations set
    status = 'completed',
    result = p_result,
    measured_note = p_measured_note,
    verified_by = auth.uid(),
    verified_at = now(),
    learning_event_id = v_le
  where id = p_obligation_id;

  return query select 'recorded'::text, v_le,
    case p_result
      when 'achieved' then
        'Outcome verified as achieved, with the measurement on record. This loop is closed.'
      when 'not_achieved' then
        format('Outcome NOT achieved — recorded honestly, and a learning event (%s) now '
               || 'carries it into strategy re-examination. A failed verification recorded '
               || 'is worth more than a passed one assumed.', v_le)
      else
        'Inconclusive, with the measurement on record. Inconclusive is a real result — '
        || 'it usually means the method was not measurable as written, which is itself '
        || 'feedback for the next recommendation.'
    end;
end;
$$;

grant execute on function record_verification_result(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Posture: the loop-closure numbers, with the two silent failure modes named —
-- actioned recommendations with NO obligation (pre-date the trigger), and
-- obligations sitting overdue.
-- ---------------------------------------------------------------------------
drop function if exists get_verification_posture();
create or replace function get_verification_posture()
returns table (
  "actionedRecommendations" int,
  "withObligation" int,
  "openObligations" int,
  overdue int,
  achieved int,
  "notAchieved" int,
  inconclusive int,
  waived int,
  "actionedWithoutObligation" int,
  basis text
)
language sql stable security definer set search_path = public as $$
  with r as (
    select * from recommendations
    where organization_id = app_current_org()
      and status in ('approved','released','scheduled','completed')
  ),
  o as (
    select * from verification_obligations where organization_id = app_current_org()
  )
  select
    (select count(*)::int from r),
    (select count(*)::int from r where exists (select 1 from o where o.recommendation_id = r.id)),
    (select count(*)::int from o where status = 'open'),
    (select count(*)::int from o where status = 'open' and due_date < current_date),
    (select count(*)::int from o where result = 'achieved'),
    (select count(*)::int from o where result = 'not_achieved'),
    (select count(*)::int from o where result = 'inconclusive'),
    (select count(*)::int from o where status = 'waived'),
    (select count(*)::int from r where not exists (select 1 from o where o.recommendation_id = r.id)),
    format(
      'Of %s actioned recommendation(s), %s carry a verification obligation and %s do not '
      || '— those predate the obligation trigger, and their loops are open with nothing '
      || 'watching. %s obligation(s) are open, %s of them past due. Results so far: '
      || '%s achieved, %s not achieved, %s inconclusive. A verification that never '
      || 'happens looks identical to one that passed, which is why the overdue count '
      || 'is the number to watch.',
      (select count(*) from r),
      (select count(*) from r where exists (select 1 from o where o.recommendation_id = r.id)),
      (select count(*) from r where not exists (select 1 from o where o.recommendation_id = r.id)),
      (select count(*) from o where status = 'open'),
      (select count(*) from o where status = 'open' and due_date < current_date),
      (select count(*) from o where result = 'achieved'),
      (select count(*) from o where result = 'not_achieved'),
      (select count(*) from o where result = 'inconclusive'));
$$;

grant execute on function get_verification_posture() to authenticated;

drop function if exists get_open_verifications(int);
create or replace function get_open_verifications(p_limit int default 50)
returns table (
  "obligationId" uuid,
  "recommendationTitle" text,
  "assetName" text,
  method text,
  "dueDate" date,
  "dueDateAssumed" boolean,
  "daysOverdue" int,
  "intendedOutcome" text
)
language sql stable security definer set search_path = public as $$
  select o.id, r.title, a.name, o.method, o.due_date, o.due_date_assumed,
         greatest(0, (current_date - o.due_date))::int,
         o.intended_outcome
  from verification_obligations o
  join recommendations r on r.id = o.recommendation_id
  left join assets a on a.id = o.asset_id
  where o.organization_id = app_current_org() and o.status = 'open'
  order by o.due_date, r.title
  limit greatest(1, p_limit);
$$;

grant execute on function get_open_verifications(int) to authenticated;

notify pgrst, 'reload schema';
