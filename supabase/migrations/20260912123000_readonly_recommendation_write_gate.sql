-- ============================================================================
-- Read-only roles cannot write recommendations — the server half of the
-- /mission-control reconciliation.
--
-- The 2026-08-17 owner decision record declares board read-only everywhere
-- and grants supervisor no approval authority. Verification found the claim
-- was client-deep only on /mission-control: recommendations_org_rw
-- (00000000000001:489) is a FOR ALL org-scoped policy, so either role could
-- UPDATE recommendations.status to 'approved' directly — the approve flow's
-- first and load-bearing write. Hiding the buttons (MissionControl's
-- RECOMMENDATION_ACT_ROLES) without this policy would be menu-only security.
--
-- The gate is a RESTRICTIVE policy per write command, which ANDs into the
-- existing permissive org policy: it can only deny, never widen. SELECT is
-- deliberately not restricted — reading the queue is the read-only grant.
--
-- The UPDATE gate lives in WITH CHECK, with USING left true, on purpose. A
-- restrictive USING would deny by filtering — zero rows updated, no error —
-- and the client would broadcast success on a rejection (the executive →
-- approvals failure mode this repo already removed once). WITH CHECK raises
-- "new row violates row-level security policy", so approveRecommendation
-- fails on its first write, the flow stops before logging a decision, and
-- MissionControl surfaces the server's own refusal sentence.
--
-- Deliberately NOT app_has_approval_authority() (migration 22): that list
-- excludes executive, planner, technician and operator, whose existing
-- mission-control actions (approve, dismiss, modify, escalate) predate this
-- branch. Narrowing THEIR authority is a real owner decision nobody has
-- made; this migration only makes true what the addendum already claims
-- about the two roles this branch created. Neither role loses anything it
-- ever had — both were born on this branch.
-- ============================================================================

drop policy if exists recommendations_readonly_role_no_insert on public.recommendations;
create policy recommendations_readonly_role_no_insert on public.recommendations
  as restrictive
  for insert
  to authenticated
  with check (public.app_current_role() not in ('board', 'supervisor'));

drop policy if exists recommendations_readonly_role_no_update on public.recommendations;
create policy recommendations_readonly_role_no_update on public.recommendations
  as restrictive
  for update
  to authenticated
  using (true)
  with check (public.app_current_role() not in ('board', 'supervisor'));

drop policy if exists recommendations_readonly_role_no_delete on public.recommendations;
create policy recommendations_readonly_role_no_delete on public.recommendations
  as restrictive
  for delete
  to authenticated
  using (public.app_current_role() not in ('board', 'supervisor'));
