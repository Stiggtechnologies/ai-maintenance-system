#!/usr/bin/env bash
# D7.12 live acceptance: the final three positions in the ONE ten-element
# field-readiness predicate. Every fixture is transactional and rolled back,
# so this transcript is repeatable on one database and leaves no test tenant.
set -euo pipefail
trap 'echo "D7.12 field-readiness evidence smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $smoke$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_foreign_org uuid := gen_random_uuid();
  v_planner uuid;
  v_ai uuid;
  v_plan uuid := gen_random_uuid();
  v_work uuid := gen_random_uuid();
  v_pred uuid := gen_random_uuid();
  v_member_one bigint;
  v_member_two bigint;
  v_foreign_member bigint;
  v_competency bigint;
  v_verified uuid := gen_random_uuid();
  v_unverified uuid := gen_random_uuid();
  v_assignment_one bigint;
  v_explicit_none bigint;
  v_edge bigint;
  v_result jsonb;
  v_element jsonb;
begin
  select id into strict v_planner from public.user_profiles
   where organization_id=v_org and email='planner@syncai.ca';
  select id into v_ai from public.user_profiles
   where organization_id=v_org and role='ai_admin' limit 1;
  if v_ai is null then
    select id into strict v_ai from public.user_profiles
     where organization_id=v_org and email='demo@syncai.ca';
    -- A pristine migration chain deliberately has no machine identity. This
    -- transactional role change creates the refusal fixture without making
    -- the smoke depend on another test having run first; rollback restores it.
    update public.user_profiles set role='ai_admin' where id=v_ai;
  end if;

  insert into public.organizations(id,name) values(v_foreign_org,'D7.12 transactional foreign tenant');
  insert into public.job_plans(id,organization_id,plan_key,title,scope,status,basis,adopted_by,adopted_at,created_by)
  values(v_plan,v_org,'D712-'||v_plan::text,'D7.12 evidence plan','Transactional field-readiness evidence proof','adopted',
    'A live acceptance plan proving canonical crew, access and predecessor positions.',v_planner,now(),v_planner);
  insert into public.job_plan_steps(organization_id,job_plan_id,step_number,description,craft,crew_size,estimated_hours)
  values(v_org,v_plan,1,'Execute the evidence-backed field task','D712-mech',2,8);
  insert into public.work_orders(id,organization_id,wo_number,title,status,type,job_plan_id)
  values(v_work,v_org,'D712-WORK','D7.12 successor work','pending','human_created',v_plan),
        (v_pred,v_org,'D712-PRED','D7.12 predecessor work','pending','human_created',v_plan);

  insert into public.workforce_members(organization_id,employee_ref,display_name,craft)
  values(v_org,'D712-M1-'||v_work::text,'D7.12 member one','D712-mech') returning id into v_member_one;
  insert into public.workforce_members(organization_id,employee_ref,display_name,craft)
  values(v_org,'D712-M2-'||v_work::text,'D7.12 member two','D712-mech') returning id into v_member_two;
  insert into public.workforce_members(organization_id,employee_ref,display_name,craft)
  values(v_foreign_org,'D712-F-'||v_work::text,'Foreign member','D712-mech') returning id into v_foreign_member;
  insert into public.competencies(organization_id,competency_key,title,kind,is_statutory)
  values(v_org,'D712-C-'||v_work::text,'D7.12 field qualification','certification',true) returning id into v_competency;
  insert into public.member_competencies(organization_id,member_id,competency_id,granted_on,expires_on,verified_by,evidence_reference)
  values(v_org,v_member_one,v_competency,current_date-30,current_date+30,v_planner,'D7.12 live qualification one'),
        (v_org,v_member_two,v_competency,current_date-30,current_date+1,v_planner,'D7.12 live qualification two');
  insert into public.competency_requirements(organization_id,competency_id,craft,min_holders,basis,recorded_by)
  values(v_org,v_competency,'D712-mech',2,'Both assigned crew members must hold the field qualification through the entire work window.',v_planner);

  insert into public.evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class,
    verification_status,verified_by,verified_at,verification_method)
  values(v_verified,v_org,'D7.12 smoke','inspection','Independently verified access and sequencing inspection.','INSPECTED',
      'verified',v_planner,now(),'Independent field inspection'),
    (v_unverified,v_org,'D7.12 smoke','inspection','Evidence deliberately left unverified for refusal proof.','INSPECTED','unverified',null,null,null);

  -- Missing canonical evidence is never interpreted as clearance.
  v_element:=public.sync_field_readiness_crew_element(v_work);
  if v_element->>'state'<>'blocked' then raise exception 'crew without assignments must be blocked: %',v_element; end if;
  v_element:=public.sync_field_readiness_access_element(v_work);
  if v_element->>'state'<>'unverifiable' then raise exception 'missing access must be unverifiable: %',v_element; end if;
  v_element:=public.sync_field_readiness_predecessor_element(v_work);
  if v_element->>'state'<>'unverifiable' then raise exception 'missing predecessor review must be unverifiable: %',v_element; end if;

  perform set_config('request.jwt.claims',json_build_object('sub',v_planner,'role','authenticated')::text,true);

  -- Tenant wall: a same-session human still cannot bind a foreign person.
  v_result:=public.assign_work_order_crew(jsonb_build_object('work_order_id',v_work,'member_id',v_foreign_member,
    'starts_at',now()+interval '1 day','ends_at',now()+interval '2 days',
    'basis','A deliberately foreign workforce member offered to the tenant wall.'));
  if coalesce(v_result->>'error','') not like '%work order organization%' then
    raise exception 'cross-tenant crew assignment was not refused: %',v_result;
  end if;

  -- AI may identify candidates but may not establish any of these facts.
  perform set_config('request.jwt.claims',json_build_object('sub',v_ai,'role','authenticated')::text,true);
  v_result:=public.assign_work_order_crew(jsonb_build_object('work_order_id',v_work,'member_id',v_member_one,
    'starts_at',now()+interval '1 day','ends_at',now()+interval '2 days',
    'basis','An AI-authored assignment that the human authority boundary must refuse.'));
  if coalesce(v_result->>'error','') not like '%named planning%' then raise exception 'AI crew authorship was not refused: %',v_result; end if;

  perform set_config('request.jwt.claims',json_build_object('sub',v_planner,'role','authenticated')::text,true);
  v_result:=public.assign_work_order_crew(jsonb_build_object('work_order_id',v_work,'member_id',v_member_one,
    'starts_at',now()+interval '1 day','ends_at',now()+interval '2 days',
    'basis','Planner assigns the first qualified person for the complete work window.'));
  if not coalesce((v_result->>'answered')::boolean,false) then raise exception 'first crew assignment failed: %',v_result; end if;
  v_assignment_one:=(v_result->>'assignmentId')::bigint;
  v_result:=public.assign_work_order_crew(jsonb_build_object('work_order_id',v_work,'member_id',v_member_two,
    'starts_at',now()+interval '1 day','ends_at',now()+interval '2 days',
    'basis','Planner assigns the second qualified person for the complete work window.'));
  if not coalesce((v_result->>'answered')::boolean,false) then raise exception 'second crew assignment failed: %',v_result; end if;
  v_element:=public.sync_field_readiness_crew_element(v_work);
  if v_element->>'state'<>'blocked' or v_element->>'detail' not like '%working shift%' then
    raise exception 'unrostered crew was not blocked: %',v_element;
  end if;

  insert into public.shift_assignments(organization_id,member_id,starts_at,ends_at,shift_kind)
  values(v_org,v_member_one,now()+interval '12 hours',now()+interval '3 days','day'),
        (v_org,v_member_two,now()+interval '12 hours',now()+interval '3 days','day');
  v_element:=public.sync_field_readiness_crew_element(v_work);
  if v_element->>'state'<>'blocked' or v_element->>'detail' not like '%competency requirement%' then
    raise exception 'expiring qualification was not blocked: %',v_element;
  end if;
  update public.member_competencies set expires_on=current_date+30 where member_id=v_member_two and competency_id=v_competency;
  v_element:=public.sync_field_readiness_crew_element(v_work);
  if v_element->>'state'<>'ready' then raise exception 'qualified rostered crew did not become ready: %',v_element; end if;

  -- Access refuses unverified provenance, then becomes ready on verified and current evidence.
  v_result:=public.record_work_face_access(jsonb_build_object('work_order_id',v_work,'access_state','clear',
    'valid_from',now()-interval '1 hour','valid_until',now()+interval '3 days','evidence_item_id',v_unverified,
    'basis','This unverified inspection must not establish physical access to the work face.'));
  if coalesce(v_result->>'error','') not like '%independently verified%' then raise exception 'unverified access evidence was not refused: %',v_result; end if;
  v_result:=public.record_work_face_access(jsonb_build_object('work_order_id',v_work,'access_state','clear',
    'valid_from',now()-interval '1 hour','valid_until',now()+interval '3 days','evidence_item_id',v_verified,
    'basis','The independently inspected route and work face are clear for this work window.'));
  if not coalesce((v_result->>'answered')::boolean,false) then raise exception 'verified access failed: %',v_result; end if;
  v_element:=public.sync_field_readiness_access_element(v_work);
  if v_element->>'state'<>'ready' then raise exception 'verified current access did not become ready: %',v_element; end if;

  -- Absence is not "none". A named review establishes explicit-none; an edge
  -- then blocks until the predecessor completes, and a reverse edge is a cycle.
  v_result:=public.record_work_order_predecessor(jsonb_build_object('successor_work_order_id',v_work,
    'evidence_item_id',v_verified,'basis','The planner reviewed the execution sequence and found no predecessor for this job.'));
  if not coalesce((v_result->>'answered')::boolean,false) then raise exception 'explicit-none review failed: %',v_result; end if;
  v_explicit_none:=(v_result->>'predecessorEvidenceId')::bigint;
  v_element:=public.sync_field_readiness_predecessor_element(v_work);
  if v_element->>'state'<>'not_applicable' then raise exception 'explicit-none was not distinguished: %',v_element; end if;
  v_result:=public.withdraw_work_order_predecessor(v_explicit_none,'New verified sequence evidence identifies an actual predecessor for this work.');
  if not coalesce((v_result->>'answered')::boolean,false) then raise exception 'explicit-none withdrawal failed: %',v_result; end if;
  v_result:=public.record_work_order_predecessor(jsonb_build_object('successor_work_order_id',v_work,
    'predecessor_work_order_id',v_pred,'evidence_item_id',v_verified,
    'basis','The verified execution sequence requires predecessor completion before this work starts.'));
  if not coalesce((v_result->>'answered')::boolean,false) then raise exception 'predecessor edge failed: %',v_result; end if;
  v_edge:=(v_result->>'predecessorEvidenceId')::bigint;
  v_element:=public.sync_field_readiness_predecessor_element(v_work);
  if v_element->>'state'<>'blocked' then raise exception 'open predecessor did not block: %',v_element; end if;
  v_result:=public.record_work_order_predecessor(jsonb_build_object('successor_work_order_id',v_pred,
    'predecessor_work_order_id',v_work,'evidence_item_id',v_verified,
    'basis','A reverse edge deliberately offered to prove the graph refuses dependency cycles.'));
  if coalesce(v_result->>'error','') not like '%cycle%' then raise exception 'predecessor cycle was not refused: %',v_result; end if;
  update public.work_orders set status='completed',completed_at=now() where id=v_pred;
  v_element:=public.sync_field_readiness_predecessor_element(v_work);
  if v_element->>'state'<>'ready' then raise exception 'completed predecessor did not become ready: %',v_element; end if;

  -- Withdrawal remains a traceable final state and never deletes evidence.
  v_result:=public.withdraw_work_order_crew_assignment(v_assignment_one,
    'The live transcript closes one assignment to prove evidence is withdrawn, never deleted.');
  if not coalesce((v_result->>'answered')::boolean,false) then raise exception 'crew withdrawal failed: %',v_result; end if;
  if not exists(select 1 from public.work_order_crew_assignments where id=v_assignment_one and withdrawn_at is not null) then
    raise exception 'withdrawn crew evidence was not retained';
  end if;
  if not exists(select 1 from public.work_order_predecessor_evidence where id=v_edge and withdrawn_at is null) then
    raise exception 'active predecessor evidence unexpectedly disappeared';
  end if;
end
$smoke$;

rollback;
SQL

echo "D7.12 field-readiness evidence smoke passed"
