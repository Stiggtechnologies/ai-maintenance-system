-- ============================================================================
-- Lock down SECURITY DEFINER helpers: only signed-in users may execute.
-- (authenticated needs EXECUTE: app_current_org() backs RLS policies and
-- get_current_user_context() is the app-shell RPC.)
-- ============================================================================
revoke execute on function public.app_current_org() from public, anon;
revoke execute on function public.get_current_user_context() from public, anon;
grant execute on function public.app_current_org() to authenticated;
grant execute on function public.get_current_user_context() to authenticated;
