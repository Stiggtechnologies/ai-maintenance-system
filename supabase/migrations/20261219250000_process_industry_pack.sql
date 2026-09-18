-- U5.01 — complete the governed Process Industry specialist family on the
-- existing petrochemical-rbi module. These methods screen supplied approved
-- evidence only. They cannot perform HAZOP/LOPA/QRA, establish a pressure or
-- SIL basis, release turnaround work, accept risk, or authorize operation.

do $migration$
declare
  v_signature regprocedure :=
    'public.domain_specialist_method_is_registered(text,text)'::regprocedure;
  v_definition text;
  v_before text :=
    '(''petrochemical-rbi'',''rbi-corrosion-loop''),(''utilities-storm-response'',''storm-crew-dispatch'')';
  v_after text :=
    '(''petrochemical-rbi'',''rbi-corrosion-loop''),'
    || '(''petrochemical-rbi'',''process-safety-barriers''),'
    || '(''petrochemical-rbi'',''pressure-containment-assurance''),'
    || '(''petrochemical-rbi'',''sis-proof-test-assurance''),'
    || '(''petrochemical-rbi'',''turnaround-readiness''),'
    || '(''petrochemical-rbi'',''loss-of-containment-risk''),'
    || '(''utilities-storm-response'',''storm-crew-dispatch'')';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('(''petrochemical-rbi'',''process-safety-barriers'')' in v_definition) > 0 then
    return;
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception
      'refusing process-industry method patch: expected RBI-to-utilities predecessor is absent';
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
    'when ''rbi-corrosion-loop'' then array[''inspection-data'',''minimum-thickness-basis'',''damage-mechanism-review'',''approved-rbi-matrix''] when ''storm-crew-dispatch'' then';
  v_after text :=
    'when ''rbi-corrosion-loop'' then array[''inspection-data'',''minimum-thickness-basis'',''damage-mechanism-review'',''approved-rbi-matrix''] '
    || 'when ''process-safety-barriers'' then array[''approved-hazard-study'',''barrier-register'',''barrier-performance-standards'',''verification-and-impairment-records''] '
    || 'when ''pressure-containment-assurance'' then array[''pressure-equipment-register'',''approved-design-basis'',''inspection-and-anomaly-records'',''relief-protection-records''] '
    || 'when ''sis-proof-test-assurance'' then array[''approved-sil-determination'',''sif-register-and-srs'',''proof-test-and-demand-history'',''bypass-and-impairment-register''] '
    || 'when ''turnaround-readiness'' then array[''approved-turnaround-scope'',''work-package-and-constraint-register'',''isolation-and-permit-plan'',''resource-and-schedule-basis''] '
    || 'when ''loss-of-containment-risk'' then array[''approved-loss-of-containment-scenarios'',''approved-risk-criteria'',''barrier-verification-records'',''emergency-response-basis''] '
    || 'when ''storm-crew-dispatch'' then';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('when ''process-safety-barriers'' then array[' in v_definition) > 0 then
    return;
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception
      'refusing process-industry evidence patch: expected RBI-to-storm predecessor is absent';
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
  'Canonical governed domain-method allowlist. U5.01 adds non-authoritative process-industry evidence screens; no process-safety, pressure, SIS, turnaround or operating authority is delegated.';

notify pgrst, 'reload schema';
