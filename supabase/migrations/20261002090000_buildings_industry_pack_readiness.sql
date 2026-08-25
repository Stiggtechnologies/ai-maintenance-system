-- Buildings & Infrastructure now has both a governed template pack and an
-- executable IndustryProfile. Advance only its readiness provenance from
-- focus_draft to kernel_bound. Content remains draft and still requires
-- authorized domain, customer, legal and jurisdictional review.
--
-- The underlying ISO 31000 setup RPC is intentionally not copied wholesale
-- into this migration. Patch the one allowlisted branch in the deployed
-- definition and refuse to proceed if the expected predecessor is not present.

do $migration$
declare
  v_signature regprocedure :=
    'public.start_iso31000_implementation(jsonb)'::regprocedure;
  v_definition text;
  v_before text :=
    'when ''buildings_infrastructure'' then v_expected_label := ''Buildings & Infrastructure''; v_expected_readiness := ''focus_draft''; v_expected_focus_source := ''curated'';';
  v_after text :=
    'when ''buildings_infrastructure'' then v_expected_label := ''Buildings & Infrastructure''; v_expected_readiness := ''kernel_bound''; v_expected_focus_source := ''curated'';';
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if position(v_after in v_definition) > 0 then
    return;
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception
      'Refusing Buildings readiness patch: expected focus_draft predecessor is absent';
  end if;

  execute replace(v_definition, v_before, v_after);
end
$migration$;

revoke execute on function public.start_iso31000_implementation(jsonb)
  from public, anon;
grant execute on function public.start_iso31000_implementation(jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';
