-- U5.02 — complete the governed Manufacturing specialist family on the
-- existing manufacturing-operations module. These methods calculate only
-- from supplied approved evidence. They cannot change production controls,
-- quality disposition, tooling life, standard work, or release authority.

do $migration$
declare
  v_signature regprocedure :=
    'public.domain_specialist_method_is_registered(text,text)'::regprocedure;
  v_definition text;
  v_before text :=
    '(''manufacturing-operations'',''line-balancing''),(''manufacturing-operations'',''robot-health''),(''food-beverage-safety'',''haccp-verification'')';
  v_after text :=
    '(''manufacturing-operations'',''line-balancing''),'
    || '(''manufacturing-operations'',''robot-health''),'
    || '(''manufacturing-operations'',''oee-loss-decomposition''),'
    || '(''manufacturing-operations'',''quality-loss-reconciliation''),'
    || '(''manufacturing-operations'',''tooling-life-assurance''),'
    || '(''manufacturing-operations'',''changeover-readiness''),'
    || '(''food-beverage-safety'',''haccp-verification'')';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('(''manufacturing-operations'',''oee-loss-decomposition'')' in v_definition) > 0 then
    return;
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception
      'refusing manufacturing method patch: expected manufacturing-to-food predecessor is absent';
  end if;
  execute replace(v_definition, v_before, v_after);
end
$migration$;

do $migration$
declare
  v_signature regprocedure :=
    'public.domain_specialist_required_evidence(text)'::regprocedure;
  v_definition text;
  -- Civil U5.07 stores robot-health and HACCP on adjacent lines
  -- (`]\n when 'haccp-verification'`). Process-industry U5.01 recreates
  -- this function via pg_get_functiondef without changing that pair, so
  -- the same-line `] when` predecessor is absent on the live chain.
  v_robot text :=
    'when ''robot-health'' then array[''robot-controller-history'',''condition-monitoring'',''maintenance-history'',''approved-signal-model'']';
  v_haccp text := 'when ''haccp-verification'' then';
  v_insert text :=
    ' when ''oee-loss-decomposition'' then array[''approved-oee-definition'',''production-calendar'',''downtime-event-history'',''production-and-quality-counts''] '
    || 'when ''quality-loss-reconciliation'' then array[''quality-inspection-records'',''production-genealogy'',''defect-ncr-and-rework-records'',''approved-quality-counting-rules''] '
    || 'when ''tooling-life-assurance'' then array[''tool-identity-and-configuration'',''authenticated-tool-usage'',''approved-tool-life-basis'',''inspection-calibration-and-quality-history''] '
    || 'when ''changeover-readiness'' then array[''approved-changeover-standard'',''configuration-and-recipe-history'',''tooling-and-safety-verification'',''first-off-quality-and-release-records''] ';
  v_robot_pos integer;
  v_after_robot text;
  v_ws_len integer;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('when ''oee-loss-decomposition'' then array[' in v_definition) > 0 then
    return;
  end if;
  v_robot_pos := position(v_robot in v_definition);
  if v_robot_pos = 0 then
    raise exception
      'refusing manufacturing evidence patch: expected robot-health evidence predecessor is absent';
  end if;
  v_after_robot := substr(v_definition, v_robot_pos + char_length(v_robot));
  v_ws_len := char_length(v_after_robot)
    - char_length(ltrim(v_after_robot, E' \t\n\r'));
  if left(ltrim(v_after_robot, E' \t\n\r'), char_length(v_haccp))
     is distinct from v_haccp then
    raise exception
      'refusing manufacturing evidence patch: expected robot-to-HACCP predecessor is absent';
  end if;
  execute overlay(
    v_definition
    placing v_insert
    from v_robot_pos + char_length(v_robot)
    for v_ws_len
  );
end
$migration$;

revoke all on function public.domain_specialist_method_is_registered(text,text)
  from public, anon;
grant execute on function public.domain_specialist_method_is_registered(text,text)
  to authenticated, service_role;
revoke all on function public.domain_specialist_required_evidence(text)
  from public, anon, authenticated;
grant execute on function public.domain_specialist_required_evidence(text)
  to service_role;

comment on function public.domain_specialist_method_is_registered(text,text) is
  'Canonical governed domain-method allowlist. U5.02 adds non-authoritative Manufacturing OEE, quality, tooling and changeover evidence calculations; no production, quality, tool-life, configuration or release authority is delegated.';

notify pgrst, 'reload schema';
