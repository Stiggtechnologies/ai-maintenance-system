-- ============================================================================
-- Two demo-seed claims that survived the 20260921002000 honesty pass, both
-- about PROVENANCE rather than about a number being wrong.
--
-- A demo seed is allowed to hold synthetic data — that is what it is for. It
-- is not allowed to label synthetic data as measured, verified or connected,
-- because a reader has no way to tell the difference and the surfaces above it
-- present the label as fact.
--
-- 1. SIX SEEDED VALUE METRICS CLAIMED 'verified'.
--
--    20260921002000 deleted one of the seven rows in 00000000000004:163-170
--    (`autonomous_actions_executed`, 142) on the stated grounds that it was
--    "a 'verified' value metric ... from the same seed, verified by nobody".
--    That sentence is true of the other six verbatim, and they are the larger
--    claim: `operatingLoopService` sums every row where
--    `unit = 'usd' and status = 'verified'` into `valueCreated`, which
--    MissionControl renders as a headline tile captioned "verified MTD".
--    The three USD rows total $14,690,000 — a figure typed into a seed file
--    and displayed to a board as verified value.
--
--    The rows are kept and re-labelled rather than deleted. `value_metrics`
--    already carries `baseline_pending_validation` as a status
--    (00000000000001:281) and that is exactly what they are: a demo baseline
--    nothing has validated. The panels degrade honestly — ValueRealization
--    already renders "No verified value yet" and "No verified savings recorded
--    yet" for an empty verified set, and the MissionControl tile reports $0
--    verified, which is the true number.
--
-- 2. FOUR INTEGRATIONS REPORTED 'connected'.
--
--    SAP PM (18,422 records), OSIsoft PI (982,231), Maximo (degraded, 5,120)
--    and Bently Nevada (44,120), rendered by IntegrationHealthPanel under the
--    caption "Live status of connected systems" and by OperationalBriefing as
--    "N records synced". There is no connector code for any of the four —
--    no edge function, no client, no sync job. The record counts describe
--    synchronisations that never happened with systems that were never
--    reached. Same class as `maintenance_metrics`, which
--    20260911090000 purged for being seed-only with a single reader.
--
--    Deleted rather than re-labelled: unlike a value baseline, there is no
--    honest status for a connector that does not exist. The panel shows no
--    integrations, which is correct.
--
-- Canonical reuse: value_metrics and integrations as defined in
-- 00000000000001 and 00000000000004. No schema change, no policy change.
-- ============================================================================

update value_metrics
set status = 'baseline_pending_validation'
where status = 'verified'
  and recommendation_id is null
  and asset_id is null;

delete from integrations
where name in ('SAP PM', 'OSIsoft PI', 'Maximo', 'Bently Nevada')
  and category in ('CMMS', 'Historian', 'Condition Monitoring');
