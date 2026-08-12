-- ============================================================================
-- Give the demo recommendations a complete contract.
--
-- WHAT BROKE AND WHY.
--
-- 20260829090000 added a trigger refusing the transition into
-- approved/released/scheduled when any of the five contract fields is missing.
-- Every recommendation in the database predates that gate and has none of them,
-- including "Reschedule PM on Conveyor C-22" — which is the recommendation the
-- golden-path E2E approves. So the buyer-value loop test failed, and correctly:
-- the gate did exactly what it was built to do, to data that could not satisfy
-- it.
--
-- Enforcing a contract on a system whose existing rows cannot meet it is the
-- predictable cost of adding a gate, and the honest options were to weaken the
-- gate or to fix the data. Weakening it would have made the C8 items green
-- while changing nothing.
--
-- WHY ONLY THE DEMO ORGANIZATION.
--
-- Demo recommendations SHOULD carry a complete contract — they are what the
-- product shows a buyer, and a demo of a governance feature that cannot satisfy
-- its own governance is worse than no demo. Real operator recommendations are
-- left untouched: there is no defensible way to write "what alternatives were
-- considered" for a decision somebody else made and did not record, and
-- inventing it would put fabricated reasoning into a live register. That
-- backlog stays incomplete and stays visible in
-- get_recommendation_contract_posture().
--
-- Canonical reuse: recommendations, check_recommendation_contract. Data only.
-- ============================================================================

update recommendations r set
  consequence_summary = coalesce(r.consequence_summary, case
    when r.title ilike '%conveyor%' then
      'Production: an unplanned conveyor stop halts the feed to downstream processing '
      || 'for the duration of the repair. Safety: no personnel exposure at this stage. '
      || 'Environmental: none. Financial: bounded by the downtime rate for this asset.'
    when r.title ilike '%vibration%' or r.title ilike '%temperature%' then
      'Production: progressive degradation ends in an unplanned outage at a time not of '
      || 'our choosing. Safety: none at current severity. Financial: intervention now is '
      || 'planned work; intervention after failure is not.'
    else
      'Production: degradation continues and the failure occurs unplanned. Safety: no '
      || 'immediate personnel exposure identified. Environmental: none identified. '
      || 'Financial: the cost difference between planned and unplanned execution.'
  end),
  alternatives_considered = coalesce(r.alternatives_considered, case
    when r.title ilike '%reschedule%' then
      'Leave the PM at its current date — rejected: the condition evidence indicates the '
      || 'interval no longer matches the observed degradation rate. Bring the whole PM '
      || 'forward — rejected: unnecessary scope for a single-parameter finding. '
      || 'Run to failure — rejected: consequence exceeds tolerance for this asset.'
    else
      'Run to failure — rejected on consequence. Defer to the next scheduled window — '
      || 'rejected: the degradation rate does not support waiting. Increase monitoring '
      || 'frequency without intervening — retained as a fallback if resources are '
      || 'unavailable, at higher residual risk.'
  end),
  required_completion_date = coalesce(r.required_completion_date,
    (current_date + case
      when coalesce(r.urgency,'') ilike '%critical%' then 7
      when coalesce(r.urgency,'') ilike '%high%' then 14
      else 30 end)),
  -- Authority scales with consequence. safety_flag lives on work_orders, not
  -- here, and financial_impact on this table is TEXT rather than a number — so
  -- the routing uses risk_impact and urgency, which are the fields that
  -- actually carry a comparable signal. Casting free text to numeric to make a
  -- threshold work would be inventing precision.
  required_approver_role = coalesce(r.required_approver_role, case
    when coalesce(r.risk_impact,'') ilike '%safety%' then 'executive'
    when coalesce(r.risk_impact,'') ilike '%critical%' then 'executive'
    when coalesce(r.urgency,'') ilike '%critical%' then 'executive'
    else 'maintenance_manager'
  end),
  verification_method = coalesce(r.verification_method, case
    when r.title ilike '%vibration%' then
      'Re-measure vibration at the same point and load 168 hours after the intervention; '
      || 'confirm the reading has returned below the alarm threshold and has not risen '
      || 'again at 720 hours.'
    when r.title ilike '%temperature%' then
      'Trend bearing temperature for 168 hours post-intervention against the pre-'
      || 'intervention baseline at equivalent load; confirm the differential has closed.'
    when r.title ilike '%reschedule%' or r.title ilike '%pm%' then
      'Confirm at the next two PM cycles that the revised interval catches the condition '
      || 'before the alarm threshold is reached. If it does not, the interval is still wrong.'
    else
      'Confirm the reported condition parameter returns to and remains within its normal '
      || 'band for 720 operating hours, and that no repeat work order is raised against '
      || 'the same component in that period.'
  end)
where r.organization_id = '11111111-1111-1111-1111-111111111111';

-- The golden path approves this one. Prove the gate now passes it, and fail the
-- migration loudly if it does not — a green migration that leaves the E2E
-- broken would just move the discovery to CI again.
do $$
declare v_missing text[]; v_title text;
begin
  select r.title, recommendation_contract_gaps(r.*) into v_title, v_missing
  from recommendations r
  where r.organization_id = '11111111-1111-1111-1111-111111111111'
    and r.title = 'Reschedule PM on Conveyor C-22'
  limit 1;

  if v_title is null then
    raise notice 'Golden-path recommendation not present in this database; nothing to verify.';
  elsif coalesce(array_length(v_missing,1),0) > 0 then
    raise exception
      'Backfill did not complete the contract for "%": still missing %.',
      v_title, array_to_string(v_missing, '; ');
  else
    raise notice 'Contract complete for "%" — the golden path can approve it.', v_title;
  end if;
end $$;
