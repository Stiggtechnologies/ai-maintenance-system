-- ============================================================================
-- Close the one-way door on equipment release (E3.05).
--
-- Slice 14 wired release_equipment into the work-order page and did not wire
-- return_equipment or accept_equipment, because neither had a caller and the
-- slice was scoped to planning. The consequence was not a missing feature. It
-- was a trap: release_equipment refuses a second release while a prior one is
-- open (20260812140000:90-95), so the FIRST release a person makes through the
-- product strands that asset permanently. No screen could return it, no screen
-- could accept it, and the only exit was a hand-written UPDATE.
--
-- The panel that displays this has been ready the whole time. OpsCoordination
-- renders an awaiting-acceptance state in amber, with the correct sentence —
-- "the equipment is in neither party's hands" — for a state no user could ever
-- produce, because the return that creates it had no caller.
--
-- What actually blocked the wiring is one line: get_ops_coordination returns
-- 'asset', a.name and no identifier, so a button had nothing to pass to
-- return_equipment(p_asset_id, ...). A display payload, shaped for reading
-- only. This adds the id, and the release id with it, so the row a person is
-- looking at is the row they act on.
--
-- The two functions are deliberately NOT changed, including their asymmetry:
-- return_equipment has no role gate, because handing equipment back is the
-- maintenance side of the handover and gating it would strand assets a second
-- way. accept_equipment is gated to operations and refuses the person who
-- returned it (:28-30) — the segregation of duties that makes the handover a
-- handover rather than a formality. Both refusals surface verbatim in the UI.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.get_ops_coordination_display()') is null then
    alter function public.get_ops_coordination()
      rename to get_ops_coordination_display;
  end if;
end $$;

create or replace function public.get_ops_coordination()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_base jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  v_base := get_ops_coordination_display();
  if v_base ? 'error' then
    return v_base;
  end if;

  -- Replace open_releases with the same rows plus the identifiers an action
  -- needs. Rebuilt rather than patched element-by-element so the shape stays
  -- defined in one place.
  return jsonb_set(
    v_base,
    '{open_releases}',
    (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'release_id', r.id,
          'asset_id', r.asset_id,
          'asset', a.name,
          'status', r.status,
          'released_at', r.released_at,
          'returned_at', r.returned_at,
          'isolation_confirmed', r.isolation_confirmed,
          'hours_out_of_service', round(extract(epoch from
            (coalesce(r.returned_at, now()) - r.released_at)) / 3600.0, 1),
          'awaiting_acceptance', r.status = 'returned',
          -- Surfaced so the panel can explain a refusal before it happens
          -- rather than after: the person who returned it cannot accept it.
          'returned_by_me', r.returned_by is not null and r.returned_by = auth.uid()
        ) order by r.released_at),
        '[]'::jsonb)
      from equipment_releases r
      join assets a on a.id = r.asset_id
      where r.organization_id = v_org
        and r.status in ('released', 'returned')
    )
  );
end
$$;

grant execute on function public.get_ops_coordination() to authenticated;

notify pgrst, 'reload schema';
