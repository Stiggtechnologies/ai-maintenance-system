-- U5.04 — complete the governed Utilities / networks specialist family on the
-- existing utilities-storm-response module. These methods reuse canonical
-- dependency/restoration kernels or reconcile supplied evidence only. They
-- cannot isolate, switch, valve, dispatch, shed load, energize, restore
-- pressure/service, waive controls, release equipment, or authorize operation.

do $migration$
declare
  v_signature regprocedure :=
    'public.domain_specialist_method_is_registered(text,text)'::regprocedure;
  v_definition text;
  v_anchor text :=
    '(''utilities-storm-response'',''storm-crew-dispatch'')';
  v_next text := '(''manufacturing-operations'',''line-balancing'')';
  v_insert text :=
    '(''utilities-storm-response'',''network-reliability-impact''),'
    || '(''utilities-storm-response'',''outage-control-readiness''),'
    || '(''utilities-storm-response'',''network-load-capacity''),'
    || '(''utilities-storm-response'',''storm-mobilization-readiness''),'
    || '(''utilities-storm-response'',''network-restoration-prioritization''),';
  v_anchor_pos integer;
  v_after_anchor text;
  v_ws_len integer;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('(''utilities-storm-response'',''network-reliability-impact'')' in v_definition) > 0 then
    return;
  end if;
  v_anchor_pos := position(v_anchor in v_definition);
  if v_anchor_pos = 0 then
    raise exception
      'refusing utilities method patch: expected storm-crew-dispatch anchor is absent';
  end if;
  v_after_anchor := substr(v_definition, v_anchor_pos + char_length(v_anchor));
  v_ws_len := char_length(v_after_anchor)
    - char_length(ltrim(v_after_anchor, E' \t\n\r,'));
  if left(ltrim(v_after_anchor, E' \t\n\r,'), char_length(v_next))
     is distinct from v_next then
    raise exception
      'refusing utilities method patch: expected utilities-to-manufacturing successor is absent';
  end if;
  execute overlay(
    v_definition
    placing ',' || v_insert
    from v_anchor_pos + char_length(v_anchor)
    for v_ws_len
  );
end
$migration$;

do $migration$
declare
  v_signature regprocedure :=
    'public.domain_specialist_required_evidence(text)'::regprocedure;
  v_definition text;
  v_anchor text :=
    'when ''storm-crew-dispatch'' then array[''incident-feed'',''crew-roster'',''competency-records'',''travel-time-source'',''dispatch-policy'']';
  v_next text := 'when ''line-balancing'' then';
  v_insert text :=
    ' when ''network-reliability-impact'' then array[''controlled-network-model'',''network-dependency-evidence'',''confirmed-outage-state'',''service-and-consequence-register''] '
    || 'when ''outage-control-readiness'' then array[''controlled-outage-register'',''isolation-and-protection-status'',''approved-operating-plan'',''field-and-customer-communication-log''] '
    || 'when ''network-load-capacity'' then array[''certified-load-or-demand-snapshot'',''available-capacity-register'',''protection-and-configuration-status'',''approved-reserve-policy''] '
    || 'when ''storm-mobilization-readiness'' then array[''approved-storm-response-plan'',''current-hazard-forecast'',''mutual-aid-and-resource-status'',''emergency-logistics-and-communications-test''] '
    || 'when ''network-restoration-prioritization'' then array[''controlled-network-model'',''confirmed-damage-and-outage-state'',''restoration-resource-and-material-status'',''isolation-protection-and-field-verification'',''approved-restoration-policy''] ';
  v_anchor_pos integer;
  v_after_anchor text;
  v_ws_len integer;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('when ''network-reliability-impact'' then array[' in v_definition) > 0 then
    return;
  end if;
  v_anchor_pos := position(v_anchor in v_definition);
  if v_anchor_pos = 0 then
    raise exception
      'refusing utilities evidence patch: expected storm-crew-dispatch anchor is absent';
  end if;
  v_after_anchor := substr(v_definition, v_anchor_pos + char_length(v_anchor));
  v_ws_len := char_length(v_after_anchor)
    - char_length(ltrim(v_after_anchor, E' \t\n\r'));
  if left(ltrim(v_after_anchor, E' \t\n\r'), char_length(v_next))
     is distinct from v_next then
    raise exception
      'refusing utilities evidence patch: expected utilities-to-manufacturing successor is absent';
  end if;
  execute overlay(
    v_definition
    placing v_insert
    from v_anchor_pos + char_length(v_anchor)
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
  'Canonical governed domain-method allowlist. U5.04 adds non-authoritative network impact, outage readiness, exact-unit capacity, storm mobilization and dependency-safe restoration support; no isolation, switching, valving, dispatch, load shed, energization, service restoration, release or operating authority is delegated.';

notify pgrst, 'reload schema';
