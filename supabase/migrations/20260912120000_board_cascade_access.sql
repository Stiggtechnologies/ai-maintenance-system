-- ============================================================================
-- Board seat — the third server filter, found by adversarial verification.
--
-- 20260912090000 executed the two edits the IA doc's §3 inventory named: the
-- four Board-accountable KPI audience arrays and the board_packs_read policy.
-- Verification then proved the board pack path still returned nothing to the
-- board, because get_accountability_cascade (20260808210000:471-516) carries
-- its OWN role filter inside the packs subquery —
--
--     and v_role in ('executive', 'admin', 'ai_admin')     (:512)
--
-- — so the role the policy now admits was still filtered out by the function
-- that actually serves /executive's board record (AccountabilityCascade.tsx
-- calls this RPC). A policy edit without the function edit is exactly the
-- menu-only access this repository's tests exist to catch, which is why
-- roleNavigation.test.ts now pins this migration's filter as text.
--
-- This migration recreates the function verbatim with 'board' added to that
-- one filter. Nothing else changes: limits, the enforcement note, ordering,
-- and every returned field are identical, and the function remains
-- security definer over app_current_org() so tenant scoping is unchanged.
-- The board still cannot prepare or attest a pack — generate_board_pack's
-- gate and the attestation trigger are untouched.
-- ============================================================================

create or replace function public.get_accountability_cascade()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();

  return jsonb_build_object(
    'role', v_role,
    'limits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'role_key', role_key, 'tier_label', tier_label,
        'max_commitment_usd', max_commitment_usd, 'max_risk_level', max_risk_level,
        'max_production_downtime_hours', max_production_downtime_hours,
        'escalates_to_role', escalates_to_role, 'basis', basis, 'status', status,
        'adopted_at', adopted_at
      ) order by coalesce(max_commitment_usd, 1e15)), '[]'::jsonb)
      from authority_limits
      where organization_id = v_org and status in ('draft', 'adopted')),
    'enforcement_note',
      'Only ADOPTED limits are enforced. Draft limits are a proposal awaiting the organization''s delegation instrument and block nothing.',
    'packs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'period_label', period_label, 'period_end', period_end,
        'status', status, 'attested_at', attested_at, 'attestation_note', attestation_note,
        'kpi_count', jsonb_array_length(kpi_snapshot),
        'measured_count', (select count(*) from jsonb_array_elements(kpi_snapshot) k
                           where (k->>'measured')::boolean),
        'governance', governance_snapshot
      ) order by period_end desc), '[]'::jsonb)
      from board_packs
      where organization_id = v_org
        and v_role in ('board', 'executive', 'admin', 'ai_admin'))
  );
end
$$;

grant execute on function public.get_accountability_cascade() to authenticated;

notify pgrst, 'reload schema';
