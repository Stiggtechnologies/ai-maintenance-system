-- Caller-supplied physics references are not checked against a stored result.
-- Flag every returned reference unverified. This does not add a result store,
-- and it does not name the governed retrieval objects.

alter function public.build_governed_engineering_context(
  text, text, text, text, text[], text[], text[], text[], jsonb, uuid[]
) rename to build_governed_engineering_context_core;

revoke all on function public.build_governed_engineering_context_core(
  text, text, text, text, text[], text[], text[], text[], jsonb, uuid[]
) from public, anon, authenticated;

create or replace function public.build_governed_engineering_context(
  p_claim_type text,
  p_query text,
  p_asset_class text default null,
  p_asset_twin_id text default null,
  p_component_codes text[] default null,
  p_failure_mode_codes text[] default null,
  p_physics_capability_codes text[] default null,
  p_retrieved_chunk_ids text[] default null,
  p_physics_results jsonb default null,
  p_evidence_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_package jsonb;
  v_item jsonb;
  v_physics jsonb := '[]'::jsonb;
begin
  v_package := public.build_governed_engineering_context_core(
    p_claim_type,
    p_query,
    p_asset_class,
    p_asset_twin_id,
    p_component_codes,
    p_failure_mode_codes,
    p_physics_capability_codes,
    p_retrieved_chunk_ids,
    p_physics_results,
    p_evidence_ids
  );
  if v_package ? 'error' or jsonb_typeof(v_package -> 'physicsResults') <> 'array' then
    return v_package;
  end if;
  for v_item in select value from jsonb_array_elements(v_package -> 'physicsResults')
  loop
    v_physics := v_physics || jsonb_build_array(
      v_item || jsonb_build_object('unverified', true)
    );
  end loop;
  return jsonb_set(v_package, '{physicsResults}', v_physics);
end;
$fn$;

revoke all on function public.build_governed_engineering_context(
  text, text, text, text, text[], text[], text[], text[], jsonb, uuid[]
) from public, anon;
grant execute on function public.build_governed_engineering_context(
  text, text, text, text, text[], text[], text[], text[], jsonb, uuid[]
) to authenticated;

comment on function public.build_governed_engineering_context(
  text, text, text, text, text[], text[], text[], text[], jsonb, uuid[]
) is
  'Packages governed engineering context. Caller-supplied physics references are returned unverified because no stored result is checked. Grants no permission, work release, or approval.';

notify pgrst, 'reload schema';
