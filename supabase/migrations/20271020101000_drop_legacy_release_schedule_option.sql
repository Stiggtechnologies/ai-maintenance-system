-- Drop the legacy one-argument overload public.release_schedule_option(uuid).
--
-- 20260806190000 created that overload. It releases a draft week immediately
-- and its role gate admits ai_admin. 20260811130000 added the governed
-- release_schedule_option(uuid, boolean) door. 20270105165300 revoked execute
-- on the one-argument form and made the two-argument door refuse ai_admin by
-- name before the planner, maintenance-manager and administrator check
-- (§70 / #630). The overload itself remained, so a one-argument call still
-- resolves to it instead of the governed door.
--
-- This migration removes only that signature. It does not replace, revoke, or
-- regrant release_schedule_option(uuid, boolean).

DROP FUNCTION IF EXISTS public.release_schedule_option(uuid);

notify pgrst, 'reload schema';
