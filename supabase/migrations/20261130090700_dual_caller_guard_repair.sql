-- ============================================================================
-- Sync Develop Slice 4A repair — the dual-caller guard that could never fire.
--
-- THE DEFECT. Thirteen migrations across Slices 3C/3D/4A opened a read with:
--
--     if v_caller_org is null and current_user in ('authenticated', 'anon') then
--       return jsonb_build_object('error', 'forbidden');
--     end if;
--     select * into c from development_cases where id = p_case_id;
--     if not found or (v_caller_org is not null and c.organization_id <> v_caller_org) then …
--
-- Inside a SECURITY DEFINER owned by postgres, `current_user` IS postgres —
-- never 'authenticated' — so the refusal can never fire. And the org check
-- behind it is disabled by the very NULL the refusal was meant to catch. Net
-- effect: any JWT holder whose app_current_org() returns NULL (no
-- user_profiles row, or a null organization_id on one) reads ANY development
-- case in the database.
--
-- auth.uid() is the honest discriminator, because it reads the request's JWT
-- claims rather than the executing role: a caller holding a JWT but no
-- organization is refused; a caller holding no JWT at all is the definer /
-- service caller the dual-caller shape exists for, and reads through.
--
-- The Slice 4A functions are written correctly in their own migrations
-- (20261130090200/090300/090400/090500/090600). This file repairs the THREE
-- already-merged functions that still carry the dead form. It rewrites ONLY
-- that predicate, by transforming each function's own definition — copying
-- three 100-line bodies into a repair migration is how a repair silently
-- reverts a fix made between then and now. If the predicate is not found the
-- migration RAISES rather than applying a no-op, so a future body that no
-- longer matches fails loudly instead of leaving the hole open behind a
-- migration that claims to have closed it.
-- ============================================================================

do $repair$
declare
  r record;
  v_new text;
  v_fixed int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'get_case_commitment_coverage',      -- 20261122090000 (D3.09)
         'get_case_assurance_position',       -- 20261122090300 (D3.19)
         'case_gate_outstanding_obligations') -- 20261122090300 (D3.19)
  loop
    v_new := replace(
      r.def,
      'v_caller_org is null and current_user in (''authenticated'', ''anon'')',
      'auth.uid() is not null and v_caller_org is null');
    if v_new = r.def then
      raise exception
        'the dead caller guard was not found in %() — do not apply this repair blind; re-derive it against the current body.',
        r.proname
        using errcode = 'check_violation';
    end if;
    execute v_new;
    v_fixed := v_fixed + 1;
  end loop;

  if v_fixed <> 3 then
    raise exception
      'expected to repair 3 dual-caller guards, repaired % — the function set has changed and this repair no longer describes it.',
      v_fixed
      using errcode = 'check_violation';
  end if;
end
$repair$;

notify pgrst, 'reload schema';
