-- Execute inside an explicit transaction and roll it back. This exercises the
-- real functions without leaving test records in a developer or CI database.

insert into public.evidence_items(id,organization_id,source_system,evidence_type,description,data_quality)
values('7d100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',
  'transaction smoke','inspection','Controlled quality evidence for rollback-only smoke','good');
insert into public.work_orders(id,organization_id,wo_number,title,status,type)
values('7d100000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111',
  'Q7D-TXN-WO','Rollback-only rework order','in_progress','human_created');

do $$
declare
  v_demo constant uuid:='00000000-0000-0000-0000-000000000001';
  v_admin constant uuid:='00000000-0000-0000-0000-000000000006';
  v_evidence constant uuid:='7d100000-0000-4000-8000-000000000001';
  v_work constant uuid:='7d100000-0000-4000-8000-000000000002';
  v jsonb; v_req bigint; v_itp bigint; v_point bigint; v_witness bigint; v_ncr bigint;
  v_defect bigint; v_test bigint; v_legacy_test bigint; v_copq numeric; v_metric_count integer;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_demo,'role','authenticated')::text,true);
  v:=public.record_quality_requirement(jsonb_build_object(
    'requirementRef','Q7D-TXN-QR','title','Controlled dimensional acceptance',
    'requirementText','Completed item shall meet every controlled drawing dimension.',
    'sourceKind','design','sourceReference','Q7D-DWG revision C',
    'acceptanceCriterion','All controlled dimensions are within drawing tolerance.',
    'verificationMethod','measurement','severity','major','workOrderId',v_work));
  if v ? 'error' then raise exception 'requirement failed: %',v; end if;
  v_req:=(v->>'id')::bigint;
  v:=public.approve_quality_requirement(v_req,'Author cannot independently approve this requirement.');
  if v->>'error' not like '%independent requirement approval%' then raise exception 'self requirement approval was not refused: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v:=public.approve_quality_requirement(v_req,'Source and measurable acceptance criterion independently verified.');
  if v ? 'error' then raise exception 'requirement approval failed: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_demo,'role','authenticated')::text,true);
  v:=public.record_quality_itp(jsonb_build_object(
    'itpRef','Q7D-TXN-ITP','title','Fabrication ITP','revision','A',
    'scope','Fabrication through final release','procedureReference','Q7D-QP revision A',
    'workOrderId',v_work,'points',jsonb_build_array(
      jsonb_build_object(
        'sequenceNo',10,'requirementId',v_req,'controlType','hold',
        'activity','Final dimensional inspection',
        'acceptanceCriterion','All controlled dimensions are within drawing tolerance.',
        'inspectorRole','reliability_engineer','witnessRole','admin'),
      jsonb_build_object(
        'sequenceNo',20,'requirementId',v_req,'controlType','witness',
        'activity','Final functional demonstration',
        'acceptanceCriterion','Controlled functional test completes without a failed step.',
        'inspectorRole','reliability_engineer','witnessRole','admin'))));
  if v ? 'error' then raise exception 'ITP failed: %',v; end if;
  v_itp:=(v->>'id')::bigint;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v:=public.approve_quality_itp(v_itp,'Every point, criterion, role and requirement independently reviewed.');
  if v ? 'error' then raise exception 'ITP approval failed: %',v; end if;
  select id into v_point from public.quality_itp_points where itp_id=v_itp and sequence_no=10;
  select id into v_witness from public.quality_itp_points where itp_id=v_itp and sequence_no=20;

  v:=public.record_quality_itp_point_result(v_point,'pass',v_evidence,
    'Unassigned role attempts this controlled inspection.');
  if v->>'error' not like '%requires assigned role reliability_engineer%' then raise exception 'wrong inspector role was not refused: %',v; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_demo,'role','authenticated')::text,true);
  v:=public.record_quality_itp_point_result(v_point,'pass',v_evidence,
    'Measured result checked against the controlled criterion.');
  if v->>'status'<>'awaiting_release' then raise exception 'hold point did not stop: %',v; end if;
  v:=public.release_quality_itp_point(v_point,'release',true,
    'Author attempts to release their own hold-point inspection.');
  if v->>'error' not like '%independent actor%' then raise exception 'self hold release was not refused: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v:=public.release_quality_itp_point(v_point,'release',true,
    'Evidence and acceptance result independently checked before release.');
  if v->>'status'<>'passed' then raise exception 'hold release failed: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_demo,'role','authenticated')::text,true);
  v:=public.record_quality_itp_point_result(v_witness,'pass',v_evidence,
    'Functional demonstration result checked against the controlled criterion.');
  if v->>'status'<>'awaiting_release' then raise exception 'witness point did not stop: %',v; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v:=public.release_quality_itp_point(v_witness,'release',false,
    'Witness release attempted without the required witness attestation.');
  if v->>'error' not like '%witness attestation%' then raise exception 'unattested witness release was not refused: %',v; end if;
  v:=public.release_quality_itp_point(v_witness,'release',true,
    'Customer witness attendance and the acceptance evidence were recorded.');
  if v->>'status'<>'passed' then raise exception 'witness release failed: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_demo,'role','authenticated')::text,true);
  v:=public.record_quality_ncr(jsonb_build_object(
    'ncrRef','Q7D-TXN-NCR','requirementId',v_req,'workOrderId',v_work,
    'title','Controlled dimension out of tolerance',
    'description','Measured result exceeded the approved upper tolerance.',
    'severity','major','detectedAt','2026-09-01T12:00:00Z','dueAt','2026-09-10T12:00:00Z'));
  if v ? 'error' then raise exception 'NCR failed: %',v; end if;
  v_ncr:=(v->>'id')::bigint;
  v:=public.transition_quality_ncr(v_ncr,'contain',jsonb_build_object('containmentAction','Affected units segregated and processing stopped.'));
  if v ? 'error' then raise exception 'containment failed: %',v; end if;
  v:=public.transition_quality_ncr(v_ncr,'disposition',jsonb_build_object('disposition','rework','dispositionBasis','Approved engineering disposition.'));
  if v ? 'error' then raise exception 'disposition failed: %',v; end if;
  v:=public.transition_quality_ncr(v_ncr,'correct',jsonb_build_object('rootCause','Fixture datum was not reset after changeover.','correctiveAction','Reset datum and add independent setup verification.'));
  if v ? 'error' then raise exception 'correction failed: %',v; end if;
  v:=public.transition_quality_ncr(v_ncr,'verify',jsonb_build_object('effectivenessCriterion','Three consecutive lots pass the controlled dimensional check.'));
  if v ? 'error' then raise exception 'verification failed: %',v; end if;
  v:=public.transition_quality_ncr(v_ncr,'close',jsonb_build_object('evidenceItemId',v_evidence,'note','Author attempts to close their own NCR and evidence review.'));
  if v->>'error' not like '%independent NCR closure%' then raise exception 'self NCR closure was not refused: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v:=public.transition_quality_ncr(v_ncr,'close',jsonb_build_object('evidenceItemId',v_evidence,'note','Effectiveness result and closure evidence independently reviewed.'));
  if v->>'status'<>'closed' then raise exception 'NCR closure failed: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_demo,'role','authenticated')::text,true);
  v:=public.record_quality_defect(jsonb_build_object(
    'defectRef','Q7D-TXN-DEF','ncrId',v_ncr,'requirementId',v_req,'workOrderId',v_work,
    'sourceKind','in_process','defectCode','DIMENSIONAL',
    'description','Controlled dimension above upper limit.','detectedAt','2026-09-01T12:00:00Z',
    'inspectedQuantity',100,'defectiveQuantity',4,'firstPassAcceptedQuantity',96,
    'reworkedQuantity',3,'scrappedQuantity',1,'repeatDefect',false,
    'scrapCost',250,'currency','CAD','costSource','Approved material standard cost',
    'evidenceItemId',v_evidence));
  if v ? 'error' then raise exception 'defect failed: %',v; end if;
  v_defect:=(v->>'id')::bigint;
  v:=public.record_quality_rework(jsonb_build_object(
    'defectId',v_defect,'workOrderId',v_work,'startedAt','2026-09-02T12:00:00Z',
    'completedAt','2026-09-03T12:00:00Z','reworkedQuantity',3,'acceptedQuantity',3,
    'labourCost',300,'materialCost',150,'equipmentCost',75,'downtimeCost',600,
    'externalCost',0,'currency','CAD','costBasis','Actual time and issued materials',
    'costSource','ERP work-order actuals','evidenceItemId',v_evidence));
  if v ? 'error' then raise exception 'rework failed: %',v; end if;
  v:=public.record_quality_acceptance_test(jsonb_build_object(
    'workOrderId',v_work,'requirementId',v_req,'itpId',v_itp,'testRef','Q7D-TXN-FAT',
    'testStage','factory_acceptance','scheduledOn','2026-09-04','performedOn','2026-09-04',
    'outcome','pass','punchItemsRaised',0,'punchItemsOpen',0,'witnessedByOwner',true,
    'acceptanceCriteria','Every controlled test step passes with no open punch items.',
    'testProcedureReference','Q7D-FAT-PROC revision B','testedSamples',10,'passedSamples',10,
    'evidenceItemId',v_evidence));
  if v ? 'error' then raise exception 'acceptance test failed: %',v; end if;
  v_test:=(v->>'id')::bigint;
  v:=public.release_quality_acceptance_test(v_test,'release','Performer attempts release of their own acceptance test.');
  if v->>'error' not like '%independent acceptance release%' then raise exception 'self acceptance release was not refused: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v:=public.release_quality_acceptance_test(v_test,'release','Pass result, evidence and zero punch items independently verified.');
  if v->>'releaseStatus'<>'released' then raise exception 'acceptance release failed: %',v; end if;

  insert into public.acceptance_tests(
    organization_id,work_order_id,test_ref,test_stage,performed_on,outcome,
    acceptance_criteria,test_procedure_reference,evidence_item_id,performed_by)
  values(
    '11111111-1111-1111-1111-111111111111',v_work,'Q7D-TXN-LEGACY',
    'factory_acceptance','2026-09-04','pass',
    'Every controlled test step passes with no open punch items.',
    'Q7D-FAT-PROC legacy record',v_evidence,null)
  returning id into v_legacy_test;
  v:=public.release_quality_acceptance_test(v_legacy_test,'release','Legacy test without performer provenance must remain unreleased.');
  if v->>'error' not like '%performer provenance%' then raise exception 'missing performer provenance was not refused: %',v; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_demo,'role','authenticated')::text,true);
  v:=public.record_quality_cost(jsonb_build_object(
    'ncrId',v_ncr,'incurredAt','2026-09-04T12:00:00Z','category','external_failure',
    'amount',500,'currency','CAD','costType','Customer field correction',
    'sourceReference','Approved invoice Q7D-INV','evidenceItemId',v_evidence));
  if v ? 'error' then raise exception 'quality cost failed: %',v; end if;
  v:=public.get_quality_cockpit('2026-09-01T00:00:00Z','2026-10-01T00:00:00Z');
  select jsonb_array_length(v->'metrics') into v_metric_count;
  select (item->>'costOfPoorQuality')::numeric into v_copq
  from jsonb_array_elements(v->'costByCurrency') item where item->>'currency'='CAD';
  if v_metric_count<>7 then raise exception 'expected seven metrics: %',v; end if;
  if v_copq<>1875 then raise exception 'expected CAD COPQ 1875, got %',v_copq; end if;
  if (select count(*) from public.approvals where quality_requirement_id=v_req or quality_itp_id=v_itp
      or quality_itp_point_id in (v_point,v_witness) or quality_ncr_id=v_ncr or acceptance_test_id=v_test)<>6 then
    raise exception 'expected six canonical approval records';
  end if;
end $$;
