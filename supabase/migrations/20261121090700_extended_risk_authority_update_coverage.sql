-- Close the last INSERT-only enforcement trigger on risk_acceptances.
--
-- Slice 3B hardened SoD pair 4 (trg_treatment_owner_not_acceptor) to fire on
-- INSERT OR UPDATE, because an UPDATE that re-points accepted_by mints exactly
-- the conflict an INSERT would. The extended-authority ceiling trigger sits on
-- the SAME table one trigger over and still fired on INSERT only, so the same
-- verb-coverage hole was live beside the one we just closed:
--
--   insert risk_acceptances (risk_level => 'Low')            -- passes the ceiling
--   update risk_acceptances set risk_level = 'Critical'      -- ceiling never re-runs
--
-- Proven exploitable against a ladder carrying independent_assurance_above_level,
-- where a direct INSERT at 'Critical' is correctly refused. The path is not
-- client-reachable (risk_acceptances has no INSERT/UPDATE RLS policy for
-- authenticated) but IS reachable from the service/raw/owner path — the same
-- class the pair-4 repair was hardened for.
--
-- The function body is unchanged and still evaluated against NEW, so this is a
-- pure verb widening of WHEN it runs, never a loosening of WHAT it refuses.
drop trigger if exists trg_extended_risk_acceptance_authority on public.risk_acceptances;
create trigger trg_extended_risk_acceptance_authority
  before insert or update on public.risk_acceptances
  for each row execute function public.enforce_extended_risk_acceptance_authority();
