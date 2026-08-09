-- ============================================================================
-- Make the health score falsifiable (E5.08, E5.11).
--
-- The platform emits a health score per asset. Nothing anywhere states what
-- that number MEANS as a prediction, which is precisely why it has never been
-- checkable: an unstated claim cannot be wrong.
--
-- This migration does two things and deliberately not a third.
--
-- 1. It registers the interpretation EXPLICITLY as its own model entry:
--    P(corrective work order within 90 days) = (100 - health_score) / 100.
--    That interpretation is ASSERTED here, not derived from how health_score
--    is computed, and the limitations field says so. Writing it down is what
--    turns the score into a claim somebody can argue with or refute.
--
-- 2. It snapshots today's scores as predictions with that horizon, so the
--    clock starts and calibration becomes measurable in 90 days.
--
-- It does NOT fabricate outcomes. Every row lands with outcome null, the
-- posture line reports that none has an outcome, and assessCalibration refuses
-- to produce a Brier score until real outcomes exist. Seeding outcomes would
-- be the exact dishonesty this whole slice is about.
-- ============================================================================

insert into model_register (organization_id, model_key, version, model_kind, purpose,
  approved_for, approved_on, human_in_loop, verification_reference, limitations)
select o.id, 'health-score-as-probability', '1', 'hybrid',
  'Interprets the asset health score as P(corrective work order within 90 days) = (100 - health_score)/100.',
  array['calibration monitoring'],
  null, true,
  'src/lib/model-risk/*.test.ts — 19 assertions (the calibration method, not this mapping)',
  'THE MAPPING IS ASSERTED, NOT DERIVED. Nothing in how health_score is computed guarantees it behaves '
  || 'as a 90-day failure probability. The mapping is registered so the score becomes falsifiable: if '
  || 'calibration shows it is wrong, the right response is to fix or withdraw the interpretation, not to '
  || 'stop measuring.'
from organizations o
on conflict (organization_id, model_key, version) do update set
  limitations = excluded.limitations;

-- Snapshot today's scores. Outcomes stay null; the clock starts now.
insert into model_predictions (organization_id, model_key, model_version,
  subject_asset_id, predicted_at, predicted_probability, horizon_days)
select a.organization_id, 'health-score-as-probability', '1', a.id, now(),
       round(((100 - least(greatest(coalesce(a.health_score, 100), 0), 100))::numeric / 100), 4),
       90
from assets a
where not exists (
  select 1 from model_predictions p
  where p.subject_asset_id = a.id
    and p.model_key = 'health-score-as-probability'
);

-- A reference distribution of those scores, so drift has something to measure
-- against once the population moves.
insert into model_input_snapshots (organization_id, model_key, feature,
  snapshot_label, distribution, is_reference)
select a.organization_id, 'health-score-as-probability', 'health_score',
       'baseline ' || current_date,
       jsonb_object_agg(bucket, n),
       true
from (
  select organization_id,
         case when coalesce(health_score, 100) >= 90 then '90-100'
              when coalesce(health_score, 100) >= 75 then '75-89'
              when coalesce(health_score, 100) >= 50 then '50-74'
              else 'under-50' end bucket,
         count(*) n
  from assets group by 1, 2
) a
group by a.organization_id
on conflict do nothing;
