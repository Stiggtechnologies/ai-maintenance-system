-- UNAPPLIED REVIEW PROPOSAL. No production authorization is implied.
-- Preserve canonical audit storage; use caller RLS for ordinary view reads.
alter view public.process_safety_control_events set (security_invoker = true);
-- Trigger-function EXECUTE revocation alone does not close view INSERT.
-- Existing guarded SECURITY DEFINER safety RPCs retain their owner write path.
revoke insert,update,delete on public.process_safety_control_events from public,anon,authenticated;
