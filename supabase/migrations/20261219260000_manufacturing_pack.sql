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
  v_before text :=
    'when ''robot-health'' then array[''robot-controller-history'',''condition-monitoring'',''maintenance-history'',''approved-signal-model''] when ''haccp-verification'' then';
  v_after text :=
    'when ''robot-health'' then array[''robot-controller-history'',''condition-monitoring'',''maintenance-history'',''approved-signal-model''] '
    || 'when ''oee-loss-decomposition'' then array[''approved-oee-definition'',''production-calendar'',''downtime-event-history'',''production-and-quality-counts''] '
    || 'when ''quality-loss-reconciliation'' then array[''quality-inspection-records'',''production-genealogy'',''defect-ncr-and-rework-records'',''approved-quality-counting-rules''] '
    || 'when ''tooling-life-assurance'' then array[''tool-identity-and-configuration'',''authenticated-tool-usage'',''approved-tool-life-basis'',''inspection-calibration-and-quality-history''] '
    || 'when ''changeover-readiness'' then array[''approved-changeover-standard'',''configuration-and-recipe-history'',''tooling-and-safety-verification'',''first-off-quality-and-release-records''] '
    || 'when ''haccp-verification'' then';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('when ''oee-loss-decomposition'' then array[' in v_definition) > 0 then
    return;
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception
      'refusing manufacturing evidence patch: expected robot-to-HACCP predecessor is absent';
  end if;
  execute replace(v_definition, v_before, v_after);
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
