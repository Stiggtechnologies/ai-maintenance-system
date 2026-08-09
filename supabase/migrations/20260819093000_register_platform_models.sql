-- ============================================================================
-- Register this platform's own calculation engines (E5.09, E5.10).
--
-- THIS IS NOT DEMO DATA. Every row below describes a module that exists in
-- this repository, with a verification_reference naming the test file that
-- validates it and a test count taken from an actual run. That is the whole
-- point of E5.09 "calculation verification": the claim is checkable by opening
-- the file named.
--
-- EVERY ROW ARRIVES UNAPPROVED, and that is deliberate. Approval is an act by
-- an accountable person in a specific organisation deciding this engine may be
-- relied on for their decisions. Seeding an approval would manufacture
-- governance nobody performed — the same principle the tenant-provisioning
-- slice applies to standards and authority limits.
--
-- All are human_in_loop, because none of them acts: they compute and they
-- refuse, and a person decides. The posture function counts
-- "unapproved AND autonomous" separately for exactly this reason, and that
-- count is zero.
-- ============================================================================

insert into model_register (organization_id, model_key, version, model_kind, purpose,
  approved_for, approved_on, human_in_loop, verification_reference, limitations)
select o.id, v.model_key, v.version, v.kind, v.purpose, v.approved_for,
       null, true, v.verification, v.limitations
from organizations o
cross join (values
  ('reliability', '1', 'statistical',
   'Weibull censored MLE, Crow-AMSAA NHPP, repairable MTBF/MTTR and availability, Pareto.',
   array['bad-actor ranking','failure-pattern identification'],
   'src/lib/reliability/*.test.ts — 12 assertions',
   'Weibull assumes a single dominant failure mode. Mixed modes fit badly and the fit statistics do not always reveal it.'),
  ('lifecycle', '1', 'statistical',
   'Repair/replace/redesign economics and whole-life stage gates.',
   array['repair-versus-replace advice','stage-gate readiness'],
   'src/lib/lifecycle/*.test.ts — 26 assertions',
   'Requires asset economics that most registers do not hold; refuses rather than defaults.'),
  ('optimization', '1', 'statistical',
   'Barlow-Proschan age replacement and inspection-interval optimisation.',
   array['preventive interval advice'],
   'src/lib/optimization/*.test.ts — 21 assertions',
   'Refuses for beta <= 1: age replacement cannot help a constant or decreasing hazard.'),
  ('spares', '1', 'statistical',
   'Poisson lead-time demand, service ladder and cost-optimal holding.',
   array['spares holding advice'],
   'src/lib/spares/*.test.ts — 19 assertions',
   'Poisson suits slow-moving critical spares. Wrong for fast movers with lumpy demand.'),
  ('interdependency', '1', 'rule_based',
   'Cascade propagation, single points of failure, common cause, restoration order.',
   array['criticality review','outage impact'],
   'src/lib/interdependency/*.test.ts — 26 assertions',
   'Structural, not temporal: says what else is down, never how long until it is.'),
  ('asset-ontology', '1', 'rule_based',
   'Measurement basis, analysis applicability guard, linear defect density.',
   array['analysis gating','route defect ranking'],
   'src/lib/asset-ontology/*.test.ts — 19 assertions',
   'Refuses any analysis with no recorded applicability rule rather than allowing it.'),
  ('configuration', '1', 'rule_based',
   'As-designed versus as-maintained drift, substitution validity, temporary modifications.',
   array['configuration drift review'],
   'src/lib/configuration/*.test.ts — 20 assertions',
   'Compares recorded baselines only. Says nothing about a walkdown nobody performed.'),
  ('human-factors', '1', 'rule_based',
   'Fatigue exposure against labour rules, competency gaps, capacity reconciliation.',
   array['roster review','work assignment advice'],
   'src/lib/human-factors/*.test.ts — 19 assertions',
   'Only as good as roster completeness; reports thin rosters rather than scoring them.'),
  ('supply', '1', 'rule_based',
   'Sole-source exposure, obsolescence urgency, productivity-normalised bid comparison.',
   array['supply risk ranking','bid comparison'],
   'src/lib/supply/*.test.ts — 15 assertions',
   'Refuses to rank bids that state no productivity assumption.'),
  ('design', '1', 'statistical',
   'RAM availability allocation and early-life failure attribution.',
   array['availability target allocation'],
   'src/lib/design/*.test.ts — 19 assertions',
   'Series and parallel only. A mixed configuration must be decomposed by an engineer first.'),
  ('process-safety', '1', 'statistical',
   'PFD and achieved SIL, EEMUA 191 alarm rates, barrier verification.',
   array['SIL verification','barrier health','alarm performance'],
   'src/lib/process-safety/*.test.ts — 19 assertions',
   'Low-demand mode only. Does not replace a full SIL verification by a competent person.'),
  ('model-risk', '1', 'statistical',
   'Calibration, Brier skill and population stability index.',
   array['model monitoring'],
   'src/lib/model-risk/*.test.ts — 19 assertions',
   'Calibration is unmeasurable without recorded outcomes and refuses rather than estimating.'),
  ('fleet-import', '1', 'rule_based',
   'CSV parsing, column profiling, mapping suggestion and import preview.',
   array['onboarding data import'],
   'src/lib/fleet-import/*.test.ts — 18 assertions',
   'Suggests mappings; a human confirms every one before commit.'),
  ('fleet-analysis', '1', 'statistical',
   'Scoping analysis over an imported fleet.',
   array['onboarding scoping'],
   'src/lib/fleet-analysis/*.test.ts — 12 assertions',
   'Descriptive of the data supplied, which may not represent the whole fleet.')
) as v(model_key, version, kind, purpose, approved_for, verification, limitations)
on conflict (organization_id, model_key, version) do update set
  purpose = excluded.purpose,
  verification_reference = excluded.verification_reference,
  limitations = excluded.limitations;
