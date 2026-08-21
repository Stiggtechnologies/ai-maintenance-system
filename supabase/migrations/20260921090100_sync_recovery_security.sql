-- Sync Recovery privileged RPCs are authenticated-only. PostgreSQL grants
-- EXECUTE to PUBLIC on new functions by default, so every SECURITY DEFINER
-- entry point is explicitly revoked from PUBLIC/anon. Grants to authenticated
-- remain in the defining migration and server-side role checks remain the
-- authorization boundary.

revoke all on function public.recovery_role_allowed(text[]) from public, anon;
revoke all on function public.open_restoration_event(uuid,text,text) from public, anon;
revoke all on function public.set_restoration_baseline(uuid,timestamptz,text,text) from public, anon;
revoke all on function public.add_restoration_work(uuid,uuid,text) from public, anon;
revoke all on function public.include_restoration_candidate(uuid,text) from public, anon;
revoke all on function public.sequence_restoration_work(uuid,int) from public, anon;
revoke all on function public.verify_restoration_parallel_group(uuid,uuid[],text,text) from public, anon;
revoke all on function public.add_restoration_constraint(uuid,uuid,text,text,boolean,text,text,text,uuid) from public, anon;
revoke all on function public.set_restoration_constraint_state(uuid,text,text) from public, anon;
revoke all on function public.record_restoration_blocker(uuid,uuid,text,text,text,text,timestamptz,numeric,text) from public, anon;
revoke all on function public.resolve_restoration_blocker(uuid,text) from public, anon;
revoke all on function public.generate_restoration_plan(uuid) from public, anon;
revoke all on function public.submit_restoration_plan_for_approval(uuid) from public, anon;
revoke all on function public.release_restoration_plan(uuid) from public, anon;
revoke all on function public.start_restoration_work(uuid) from public, anon;
revoke all on function public.complete_restoration_work(uuid,numeric,text,jsonb) from public, anon;
revoke all on function public.close_restoration_event(uuid,text) from public, anon;
revoke all on function public.get_recovery_board() from public, anon;
revoke all on function public.get_recovery_event(uuid) from public, anon;
revoke all on function public.get_recovery_opportunities(uuid,numeric) from public, anon;