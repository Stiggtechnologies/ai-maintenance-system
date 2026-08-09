-- ============================================================================
-- Keep asset-scoped child rows in the same organisation as their asset.
--
-- Moving the auxiliary fleet to a private organisation re-pointed the assets
-- and left 144 onboarding-state rows and 21,024 onboarding-item rows behind in
-- the demo organisation. Nothing leaked — RLS on those tables is correct and
-- scoped on organization_id — but the rows became UNREACHABLE from both sides:
-- invisible to the new tenant that owns the assets, and dangling in the old
-- one whose assets were gone. The onboarding page crashed on the resulting
-- null embed.
--
-- An org move is not one UPDATE. Every table that carries its own
-- organization_id alongside an asset_id has to follow the asset, or the tenant
-- boundary and the data disagree. This makes that a callable operation rather
-- than something to remember.
-- ============================================================================

create or replace function public.reconcile_asset_org_scope()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  v_fixed int;
  v_total int := 0;
  v_out jsonb := '{}'::jsonb;
begin
  foreach t in array array[
    'asset_onboarding_state', 'asset_onboarding_items', 'asset_onboarding_runs'
  ] loop
    execute format(
      'update %I s set organization_id = a.organization_id
       from assets a
       where a.id = s.asset_id and s.organization_id is distinct from a.organization_id', t);
    get diagnostics v_fixed = row_count;
    v_total := v_total + v_fixed;
    v_out := v_out || jsonb_build_object(t, v_fixed);
  end loop;

  return jsonb_build_object('realigned', v_out, 'total', v_total,
    'note', 'Every asset-scoped child row now sits in the same organisation as its asset. An org move is not one UPDATE: a child row left behind is unreachable from both sides, which reads as missing data rather than as an error.');
end
$$;

revoke execute on function public.reconcile_asset_org_scope() from public, anon;
grant execute on function public.reconcile_asset_org_scope() to service_role;

notify pgrst, 'reload schema';
