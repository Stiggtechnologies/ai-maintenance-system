-- U5.03 — complete the governed Fleet / Transportation specialist family on
-- the existing transport-logistics module. The methods reconcile supplied
-- evidence and produce non-authoritative decision support only. They cannot
-- dispatch or release a vehicle, waive an inspection/defect/restriction,
-- approve a configuration change, defer a mandatory obligation, or commit
-- capital.

do $migration$
declare
  v_signature regprocedure :=
    'public.domain_specialist_method_is_registered(text,text)'::regprocedure;
  v_definition text;
  v_anchor text :=
    '(''transport-logistics'',''inspection-scheduling'')';
  v_next text := '(''aviation-airworthiness'',''airworthiness-compliance'')';
  v_insert text :=
    '(''transport-logistics'',''fleet-duty-exposure''),'
    || '(''transport-logistics'',''dispatch-availability''),'
    || '(''transport-logistics'',''fleet-configuration-trace''),'
    || '(''transport-logistics'',''fleet-replacement-prioritization''),';
  v_anchor_pos integer;
  v_after_anchor text;
  v_ws_len integer;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('(''transport-logistics'',''fleet-duty-exposure'')' in v_definition) > 0 then
    return;
  end if;
  v_anchor_pos := position(v_anchor in v_definition);
  if v_anchor_pos = 0 then
    raise exception
      'refusing transportation method patch: expected inspection-scheduling anchor is absent';
  end if;
  v_after_anchor := substr(v_definition, v_anchor_pos + char_length(v_anchor));
  v_ws_len := char_length(v_after_anchor)
    - char_length(ltrim(v_after_anchor, E' \t\n\r,'));
  if left(ltrim(v_after_anchor, E' \t\n\r,'), char_length(v_next))
     is distinct from v_next then
    raise exception
      'refusing transportation method patch: expected transport-to-aviation successor is absent';
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
    'when ''inspection-scheduling'' then array[''inspection-history'',''applicable-interval-register'',''fleet-status'',''qualified-inspector-capacity'']';
  v_next text := 'when ''airworthiness-compliance'' then';
  v_insert text :=
    ' when ''fleet-duty-exposure'' then array[''authenticated-fleet-counters'',''duty-cycle-segment-history'',''fleet-identity-and-configuration'',''approved-duty-classification''] '
    || 'when ''dispatch-availability'' then array[''live-fleet-status'',''open-defect-and-restriction-register'',''inspection-and-configuration-status'',''operator-and-hours-of-service-status'',''approved-dispatch-capability-requirements''] '
    || 'when ''fleet-configuration-trace'' then array[''controlled-fleet-identity'',''as-maintained-configuration-baseline'',''approved-substitution-and-deviation-records'',''configuration-reconciliation-review''] '
    || 'when ''fleet-replacement-prioritization'' then array[''fleet-condition-and-duty-history'',''approved-lifecycle-cost-basis'',''mandatory-obligation-register'',''approved-replacement-criteria-and-envelope''] ';
  v_anchor_pos integer;
  v_after_anchor text;
  v_ws_len integer;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('when ''fleet-duty-exposure'' then array[' in v_definition) > 0 then
    return;
  end if;
  v_anchor_pos := position(v_anchor in v_definition);
  if v_anchor_pos = 0 then
    raise exception
      'refusing transportation evidence patch: expected inspection-scheduling anchor is absent';
  end if;
  v_after_anchor := substr(v_definition, v_anchor_pos + char_length(v_anchor));
  v_ws_len := char_length(v_after_anchor)
    - char_length(ltrim(v_after_anchor, E' \t\n\r'));
  if left(ltrim(v_after_anchor, E' \t\n\r'), char_length(v_next))
     is distinct from v_next then
    raise exception
      'refusing transportation evidence patch: expected transport-to-aviation successor is absent';
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
  'Canonical governed domain-method allowlist. U5.03 adds non-authoritative fleet duty, dispatch-capacity, configuration-trace and replacement-priority calculations; no dispatch, release, waiver, configuration, deferral, disposal or expenditure authority is delegated.';

notify pgrst, 'reload schema';
