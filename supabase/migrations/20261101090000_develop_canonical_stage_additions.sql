-- ============================================================================
-- Sync Develop Slice 1 — canonical stage additions (D3.23 / D11.10, ruling 2).
--
-- The overlap map's ruling 2 is binding here: `lifecycle_stages` is the ONE
-- stage vocabulary on this platform. The Sync Develop specification's
-- thirteen-stage lifecycle names five stages the EN 16646 whole-life model
-- does not carry as first-class rows — Assure, Sanction, Stabilize, Realize,
-- Learn. They are added HERE, to the canonical list, so that ProjectFramework
-- stages (20261101090100) can MAP onto stage_keys rather than fork a second
-- vocabulary. Two tables answering "what stage is this in" is the exact
-- two-answers failure AGENTS.md invariant 1 forbids.
--
-- Placement rationale (stage_order):
--   assure    44  pre_service — independent assurance sits between design
--                 definition and the sanction decision it informs.
--   sanction  46  pre_service — the capital commitment decision, before
--                 procurement spends against it. A §70 determination: the
--                 decision itself is only recordable through the authority-
--                 checked RPC shipped in 20261101090500.
--   stabilize 75  in_service  — ramp-up between handover and steady-state
--                 operation; not concurrent, because it precedes the
--                 operate/maintain/modify concurrency set.
--   realize   83  in_service  — benefits realization runs ALONGSIDE operation
--                 (concurrent), it does not interrupt it.
--   learn     84  in_service  — capturing what the outcome teaches the next
--                 case; concurrent for the same reason.
--
-- Canonical reuse: lifecycle_stages (20260816090000), sync_lifecycle_status.
-- Additive: no existing stage row changes; the coarse-status mapper learns
-- the three new in_service keys so an asset placed in them reads 'active'
-- rather than falling to the 'new' fallback.
-- ============================================================================

insert into lifecycle_stages
  (stage_key, stage_order, label, phase, is_concurrent, decision_owned, key_artifacts, register_ref)
values
  ('assure', 44, 'Assure', 'pre_service', false,
   'Has independent assurance confirmed the case is ready for the decision it approaches?',
   'Independent assurance review, readiness assessment, unresolved-finding list', 'D11.10'),
  ('sanction', 46, 'Sanction', 'pre_service', false,
   'Should the organization commit capital to this case, knowing what it knows today?',
   'Sanction decision record, sanctioned value, delegation-of-authority check', 'D1.05'),
  ('stabilize', 75, 'Stabilize', 'in_service', false,
   'Is the new capability ramping to its promised performance, and who still owns the gap?',
   'Ramp-up performance record, early-life failure log, punch-list closure', 'D11.10'),
  ('realize', 83, 'Realize', 'in_service', true,
   'Is the investment delivering the value the case promised, and if not, why not?',
   'Benefit measurements vs approved expectation, variance attribution', 'D11.10'),
  ('learn', 84, 'Learn', 'in_service', true,
   'What does this outcome teach the next investment decision?',
   'Lessons recorded against the case, framework and estimate feedback', 'D11.10')
on conflict (stage_key) do update set
  stage_order = excluded.stage_order,
  label = excluded.label,
  phase = excluded.phase,
  is_concurrent = excluded.is_concurrent,
  decision_owned = excluded.decision_owned,
  key_artifacts = excluded.key_artifacts,
  register_ref = excluded.register_ref;

-- The coarse-status mapper (20260816090000) resolved unknown keys to 'new',
-- which is wrong for the three in_service additions. Same body, extended
-- case list; nothing else changes.
create or replace function sync_lifecycle_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update assets set lifecycle_status = case
    when new.stage_key in ('operation', 'maintenance', 'modification',
                           'stabilize', 'realize', 'learn') then 'active'
    when new.stage_key in ('life_extension', 'replacement') then 'end_of_life'
    when new.stage_key = 'decommissioning' then 'decommissioned'
    when new.stage_key = 'disposal' then 'disposed'
    else 'new' end
  where id = new.asset_id;
  return new;
end;
$$;

-- Trigger functions are executed by the system, never called by a client;
-- the revoke keeps the definer-function ratchet honest (definerTenancy).
revoke all on function public.sync_lifecycle_status() from public, anon, authenticated;

notify pgrst, 'reload schema';
