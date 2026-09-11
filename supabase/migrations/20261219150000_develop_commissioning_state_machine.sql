-- D8.07 / III.§29 — the seven-state commissioning lifecycle.
-- Human transitions are evidence-backed. READY_FOR_ENERGIZATION reads the
-- canonical equipment_releases and asset_energy_states stores; this migration
-- deliberately creates no competing isolation or energy-state record.

alter table public.commissioning_systems
  add column if not exists commissioning_state text,
  add column if not exists state_changed_at timestamptz,
  add column if not exists state_changed_by uuid references auth.users(id) on delete restrict;

alter table public.commissioning_systems drop constraint if exists commissioning_systems_state_valid;
alter table public.commissioning_systems add constraint commissioning_systems_state_valid check (
  commissioning_state is null or commissioning_state in (
    'CONSTRUCTION_COMPLETE','MECHANICAL_COMPLETE','READY_FOR_ENERGIZATION',
    'PRECOMMISSIONED','COMMISSIONED','PERFORMANCE_VERIFIED','ACCEPTED'
  )
);

create or replace function public.commissioning_energy_types_valid(p_types text[])
returns boolean language sql immutable as $$
  select coalesce(cardinality(p_types),0)>0
    and p_types <@ array['electrical','hydraulic','pneumatic','mechanical','thermal','gravity','chemical','process','other']::text[]
    and cardinality(p_types)=(select count(distinct value) from unnest(p_types) value);
$$;

create table if not exists public.commissioning_system_assets (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  commissioning_system_id bigint not null references public.commissioning_systems(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  required_energy_types text[] not null,
  basis text not null,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  bound_by uuid not null references auth.users(id) on delete restrict,
  bound_at timestamptz not null default now(),
  foreign key (organization_id,commissioning_system_id)
    references public.commissioning_systems(organization_id,id) on delete cascade,
  unique (organization_id,commissioning_system_id,asset_id),
  check (public.commissioning_energy_types_valid(required_energy_types)),
  check (length(btrim(basis)) >= 20)
);

create table if not exists public.commissioning_state_transitions (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  commissioning_system_id bigint not null references public.commissioning_systems(id) on delete cascade,
  from_state text,
  to_state text not null,
  rationale text not null,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  transitioned_by uuid not null references auth.users(id) on delete restrict,
  transitioned_at timestamptz not null default now(),
  foreign key (organization_id,commissioning_system_id)
    references public.commissioning_systems(organization_id,id) on delete cascade,
  check (length(btrim(rationale)) >= 20),
  check (from_state is null or from_state in ('CONSTRUCTION_COMPLETE','MECHANICAL_COMPLETE','READY_FOR_ENERGIZATION','PRECOMMISSIONED','COMMISSIONED','PERFORMANCE_VERIFIED','ACCEPTED')),
  check (to_state in ('CONSTRUCTION_COMPLETE','MECHANICAL_COMPLETE','READY_FOR_ENERGIZATION','PRECOMMISSIONED','COMMISSIONED','PERFORMANCE_VERIFIED','ACCEPTED'))
);

create index if not exists idx_commissioning_asset_system
  on public.commissioning_system_assets(organization_id,commissioning_system_id);
create index if not exists idx_commissioning_transition_system
  on public.commissioning_state_transitions(organization_id,commissioning_system_id,transitioned_at desc);

alter table public.commissioning_system_assets enable row level security;
alter table public.commissioning_state_transitions enable row level security;
drop policy if exists commissioning_system_assets_read on public.commissioning_system_assets;
create policy commissioning_system_assets_read on public.commissioning_system_assets
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists commissioning_state_transitions_read on public.commissioning_state_transitions;
create policy commissioning_state_transitions_read on public.commissioning_state_transitions
  for select to authenticated using (organization_id=public.app_current_org());

create or replace function public.commissioning_state_rank(p_state text)
returns integer language sql immutable as $$
  select case p_state
    when 'CONSTRUCTION_COMPLETE' then 1 when 'MECHANICAL_COMPLETE' then 2
    when 'READY_FOR_ENERGIZATION' then 3 when 'PRECOMMISSIONED' then 4
    when 'COMMISSIONED' then 5 when 'PERFORMANCE_VERIFIED' then 6
    when 'ACCEPTED' then 7 else 0 end;
$$;

create or replace function public.commissioning_next_state(p_state text)
returns text language sql immutable as $$
  select case
    when p_state is null then 'CONSTRUCTION_COMPLETE'
    when p_state='CONSTRUCTION_COMPLETE' then 'MECHANICAL_COMPLETE'
    when p_state='MECHANICAL_COMPLETE' then 'READY_FOR_ENERGIZATION'
    when p_state='READY_FOR_ENERGIZATION' then 'PRECOMMISSIONED'
    when p_state='PRECOMMISSIONED' then 'COMMISSIONED'
    when p_state='COMMISSIONED' then 'PERFORMANCE_VERIFIED'
    when p_state='PERFORMANCE_VERIFIED' then 'ACCEPTED'
    else null end;
$$;

create or replace function public.guard_commissioning_state_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.commissioning_state is not distinct from old.commissioning_state then return new; end if;
  if current_setting('app.commissioning_transition',true) is distinct from 'allowed' then
    raise exception 'commissioning state changes require the governed transition RPC' using errcode='check_violation';
  end if;
  if public.commissioning_next_state(old.commissioning_state) is distinct from new.commissioning_state then
    raise exception 'commissioning states cannot skip, regress or branch' using errcode='check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_commissioning_state on public.commissioning_systems;
create trigger trg_guard_commissioning_state before update of commissioning_state
  on public.commissioning_systems for each row execute function public.guard_commissioning_state_update();
revoke all on function public.guard_commissioning_state_update() from public,anon,authenticated;

create or replace function public.guard_commissioning_transition_ledger()
returns trigger language plpgsql as $$ begin
  raise exception 'commissioning transition history is append-only' using errcode='check_violation';
end $$;
drop trigger if exists trg_guard_commissioning_transition_ledger on public.commissioning_state_transitions;
create trigger trg_guard_commissioning_transition_ledger before update or delete
  on public.commissioning_state_transitions for each row execute function public.guard_commissioning_transition_ledger();

create or replace function public.guard_accepted_commissioning_results()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_system bigint;
begin
  if tg_op='INSERT' then v_system:=new.commissioning_system_id; else v_system:=old.commissioning_system_id; end if;
  if v_system is not null and exists(select 1 from commissioning_systems where id=v_system and commissioning_state='ACCEPTED') then
    raise exception 'accepted commissioning results are frozen; reopen is not an allowed state transition' using errcode='check_violation';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_guard_accepted_commissioning_results on public.acceptance_tests;
create trigger trg_guard_accepted_commissioning_results before insert or update or delete
  on public.acceptance_tests for each row execute function public.guard_accepted_commissioning_results();
revoke all on function public.guard_accepted_commissioning_results() from public,anon,authenticated;

create or replace function public.bind_commissioning_system_asset(
  p_system_id bigint,p_asset_id uuid,p_required_energy_types text[],p_basis text,p_evidence_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id bigint; v_state text;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if not public.commissioning_author_role(v_role) then return jsonb_build_object('error','human commissioning planning authority required'); end if;
  select commissioning_state into v_state from commissioning_systems where id=p_system_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','commissioning system not found'); end if;
  if public.commissioning_state_rank(v_state)>=3 then return jsonb_build_object('error','asset and energy scope is frozen once READY_FOR_ENERGIZATION is recorded'); end if;
  if not exists(select 1 from assets where id=p_asset_id and organization_id=v_org) then return jsonb_build_object('error','same-tenant asset is required'); end if;
  if not exists(select 1 from evidence_items where id=p_evidence_item_id and organization_id=v_org) then return jsonb_build_object('error','same-tenant binding evidence is required'); end if;
  if coalesce(cardinality(p_required_energy_types),0)=0 or coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','one or more required energy types and a substantive binding basis are required'); end if;
  insert into commissioning_system_assets(organization_id,commissioning_system_id,asset_id,required_energy_types,basis,evidence_item_id,bound_by)
  values(v_org,p_system_id,p_asset_id,p_required_energy_types,btrim(p_basis),p_evidence_item_id,auth.uid())
  on conflict(organization_id,commissioning_system_id,asset_id) do update set
    required_energy_types=excluded.required_energy_types,basis=excluded.basis,
    evidence_item_id=excluded.evidence_item_id,bound_by=auth.uid(),bound_at=now()
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'commissioning_system_asset',v_role,jsonb_build_object('id',v_id,'system_id',p_system_id,'asset_id',p_asset_id,'action','bound'));
  return jsonb_build_object('id',v_id,'status','bound');
exception when check_violation or unique_violation then
  return jsonb_build_object('error','energy types must be unique canonical values and the binding basis must be complete');
end $$;

create or replace function public.get_commissioning_transition_readiness(p_system_id bigint)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); s commissioning_systems%rowtype; v_next text;
  v_blockers jsonb:='[]'::jsonb; v_assets jsonb:='[]'::jsonb; r record; e text; v_energy text; v_release boolean; v_ok boolean;
begin
  select * into s from commissioning_systems where id=p_system_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','commissioning system not found'); end if;
  v_next:=public.commissioning_next_state(s.commissioning_state);
  if v_next is null then return jsonb_build_object('systemId',s.id,'currentState',s.commissioning_state,'nextState',null,'canTransition',false,'blockers',jsonb_build_array('The commissioning system is already accepted.'),'assets','[]'::jsonb); end if;
  if v_next='READY_FOR_ENERGIZATION' then
    if not exists(select 1 from commissioning_system_assets where organization_id=v_org and commissioning_system_id=s.id) then
      v_blockers:=v_blockers||jsonb_build_array('Bind at least one same-tenant asset and declare its required energy types.');
    end if;
    for r in select b.*,a.tag,a.name from commissioning_system_assets b join assets a on a.id=b.asset_id and a.organization_id=b.organization_id where b.organization_id=v_org and b.commissioning_system_id=s.id order by a.name loop
      select exists(select 1 from equipment_releases x where x.organization_id=v_org and x.asset_id=r.asset_id and x.status='released' and x.isolation_confirmed) into v_release;
      v_ok:=v_release;
      if not v_release then v_blockers:=v_blockers||jsonb_build_array(format('%s has no open, isolation-confirmed canonical equipment release.',coalesce(r.tag,r.name))); end if;
      foreach e in array r.required_energy_types loop
        select x.state into v_energy from asset_energy_states x where x.organization_id=v_org and x.asset_id=r.asset_id and x.energy_type=e and x.observed_at<=now() and (x.valid_until is null or x.valid_until>=now()) order by x.observed_at desc limit 1;
        if coalesce(v_energy,'unknown') not in ('isolated','dissipated','verified_zero') then
          v_ok:=false; v_blockers:=v_blockers||jsonb_build_array(format('%s / %s energy is %s in asset_energy_states.',coalesce(r.tag,r.name),e,coalesce(v_energy,'missing')));
        end if;
      end loop;
      v_assets:=v_assets||jsonb_build_array(jsonb_build_object('assetId',r.asset_id,'tag',r.tag,'name',r.name,'requiredEnergyTypes',r.required_energy_types,'equipmentReleased',v_release,'ready',v_ok));
    end loop;
  elsif v_next in ('PRECOMMISSIONED','COMMISSIONED','PERFORMANCE_VERIFIED') then
    if not exists(select 1 from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.release_status='released' and a.outcome in ('pass','pass_with_punch') and a.punch_items_open=0 and
      ((v_next='PRECOMMISSIONED' and a.test_stage='pre_commissioning') or (v_next='COMMISSIONED' and a.test_stage='commissioning') or (v_next='PERFORMANCE_VERIFIED' and a.test_stage in ('performance_test','reliability_run')))) then
      v_blockers:=v_blockers||jsonb_build_array(case v_next when 'PRECOMMISSIONED' then 'A released, passing pre-commissioning result with zero open punch items is required.' when 'COMMISSIONED' then 'A released, passing commissioning result with zero open punch items is required.' else 'A released, passing performance-test or reliability-run result with zero open punch items is required.' end);
    end if;
  elsif v_next='ACCEPTED' then
    if not exists(select 1 from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id) then v_blockers:=v_blockers||jsonb_build_array('At least one canonical acceptance result is required.'); end if;
    if exists(select 1 from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id and (a.release_status<>'released' or a.outcome not in ('pass','pass_with_punch') or a.punch_items_open>0)) then v_blockers:=v_blockers||jsonb_build_array('Every commissioning result must be independently released, passing, and have zero open punch items.'); end if;
  end if;
  return jsonb_build_object('systemId',s.id,'currentState',s.commissioning_state,'nextState',v_next,'canTransition',jsonb_array_length(v_blockers)=0,'blockers',v_blockers,'assets',v_assets,'decisionBoundary','Readiness is advisory. Only transition_commissioning_system records a human decision; it never energizes equipment.');
end $$;

create or replace function public.transition_commissioning_system(p_system_id bigint,p_to_state text,p_rationale text,p_evidence_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; s commissioning_systems%rowtype; v_ready jsonb; v_id bigint; v_previous_actor uuid;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if not public.commissioning_author_role(v_role) and v_role<>'operator' then return jsonb_build_object('error','named-human commissioning transition authority required'); end if;
  select * into s from commissioning_systems where id=p_system_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','commissioning system not found'); end if;
  if public.commissioning_next_state(s.commissioning_state) is distinct from p_to_state then return jsonb_build_object('error','commissioning transitions must follow the seven-state sequence without skips or regressions'); end if;
  if not exists(select 1 from evidence_items where id=p_evidence_item_id and organization_id=v_org) then return jsonb_build_object('error','same-tenant transition evidence is required'); end if;
  if coalesce(length(btrim(p_rationale)),0)<20 then return jsonb_build_object('error','a substantive human transition rationale is required'); end if;
  v_ready:=public.get_commissioning_transition_readiness(p_system_id);
  if coalesce((v_ready->>'canTransition')::boolean,false)=false then return jsonb_build_object('error','transition prerequisites are not satisfied','blockers',v_ready->'blockers'); end if;
  if p_to_state='ACCEPTED' then
    if v_role not in ('operator','maintenance_manager','executive','admin') then return jsonb_build_object('error','final acceptance requires human operations or accountable management authority'); end if;
    select transitioned_by into v_previous_actor from commissioning_state_transitions where organization_id=v_org and commissioning_system_id=s.id order by transitioned_at desc,id desc limit 1;
    if v_previous_actor=auth.uid() then return jsonb_build_object('error','segregation of duties: the performance verifier cannot also record final acceptance'); end if;
  end if;
  perform set_config('app.commissioning_transition','allowed',true);
  update commissioning_systems set commissioning_state=p_to_state,state_changed_at=now(),state_changed_by=auth.uid() where id=s.id;
  insert into commissioning_state_transitions(organization_id,commissioning_system_id,from_state,to_state,rationale,evidence_item_id,transitioned_by)
  values(v_org,s.id,s.commissioning_state,p_to_state,btrim(p_rationale),p_evidence_item_id,auth.uid()) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'commissioning_state_transition',v_role,jsonb_build_object('id',v_id,'system_id',s.id,'from_state',s.commissioning_state,'to_state',p_to_state,'action','transitioned'));
  return jsonb_build_object('id',v_id,'systemId',s.id,'fromState',s.commissioning_state,'toState',p_to_state,'status','recorded','decisionBoundary','This records readiness state; it does not energize equipment.');
end $$;

create or replace function public.get_case_commissioning(p_case_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_result jsonb;
begin
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then return jsonb_build_object('error','development case not found'); end if;
  select jsonb_build_object(
    'caseId',p_case_id,
    'systems',coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'ref',s.system_ref,'title',s.title,'description',s.description,'ownerId',s.owner_id,
      'currentState',s.commissioning_state,'nextState',public.commissioning_next_state(s.commissioning_state),
      'transitionReadiness',public.get_commissioning_transition_readiness(s.id),
      'assetBindings',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'assetId',b.asset_id,'tag',a.tag,'name',a.name,'requiredEnergyTypes',b.required_energy_types,'basis',b.basis,'evidenceItemId',b.evidence_item_id) order by a.name),'[]'::jsonb) from commissioning_system_assets b join assets a on a.id=b.asset_id and a.organization_id=b.organization_id where b.organization_id=v_org and b.commissioning_system_id=s.id),
      'stateHistory',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'fromState',t.from_state,'toState',t.to_state,'rationale',t.rationale,'evidenceItemId',t.evidence_item_id,'transitionedBy',t.transitioned_by,'transitionedAt',t.transitioned_at) order by t.transitioned_at desc,t.id desc),'[]'::jsonb) from commissioning_state_transitions t where t.organization_id=v_org and t.commissioning_system_id=s.id),
      'subsystems',(select coalesce(jsonb_agg(jsonb_build_object('id',ss.id,'ref',ss.subsystem_ref,'title',ss.title,'description',ss.description,'ownerId',ss.owner_id) order by ss.subsystem_ref),'[]'::jsonb) from commissioning_subsystems ss where ss.system_id=s.id),
      'testPackages',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'ref',p.package_ref,'title',p.title,'scope',p.scope,'subsystemId',p.subsystem_id,'requiredBy',p.required_by,
        'procedures',(select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'ref',pr.procedure_ref,'title',pr.title,'acceptanceCriteria',pr.acceptance_criteria,'sourceReference',pr.source_reference,'evidenceClass',pr.evidence_class,'assessmentBasis',pr.assessment_basis) order by pr.procedure_ref),'[]'::jsonb) from commissioning_procedures pr where pr.test_package_id=p.id)) order by p.package_ref),'[]'::jsonb) from commissioning_test_packages p where p.system_id=s.id),
      'rollup',jsonb_build_object(
        'resultCount',(select count(*) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id),
        'releasedCount',(select count(*) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.release_status='released'),
        'failedCount',(select count(*) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.outcome='fail'),
        'openPunchCount',(select coalesce(sum(a.punch_items_open),0) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id),
        'pendingReleaseCount',(select count(*) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.release_status='pending'))
    ) order by s.system_ref),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'systemId',a.commissioning_system_id,'subsystemId',a.commissioning_subsystem_id,'testPackageId',a.commissioning_test_package_id,'procedureId',a.commissioning_procedure_id,'testRef',a.test_ref,'testStage',a.test_stage,'performedOn',a.performed_on,'outcome',a.outcome,'punchItemsOpen',a.punch_items_open,'witnessedByOwner',a.witnessed_by_owner,'releaseStatus',a.release_status) order by a.created_at desc) from acceptance_tests a join commissioning_systems sx on sx.id=a.commissioning_system_id where sx.development_case_id=p_case_id and a.organization_id=v_org),'[]'::jsonb),
    'resultStore','acceptance_tests',
    'decisionBoundary','Commissioning results, rollups and state are human-recorded evidence. Independent quality release remains separate and neither this read nor its writers authorize energization, operation, acceptance or handover. READY_FOR_ENERGIZATION reads canonical equipment release and energy state; no transition energizes equipment.'
  ) into v_result from commissioning_systems s where s.organization_id=v_org and s.development_case_id=p_case_id;
  return v_result;
end $$;

revoke all on function public.bind_commissioning_system_asset(bigint,uuid,text[],text,uuid) from public,anon;
revoke all on function public.get_commissioning_transition_readiness(bigint) from public,anon;
revoke all on function public.transition_commissioning_system(bigint,text,text,uuid) from public,anon;
grant execute on function public.bind_commissioning_system_asset(bigint,uuid,text[],text,uuid) to authenticated;
grant execute on function public.get_commissioning_transition_readiness(bigint) to authenticated;
grant execute on function public.transition_commissioning_system(bigint,text,text,uuid) to authenticated;

comment on column public.commissioning_systems.commissioning_state is 'D8.07 seven-state monotonic commissioning lifecycle; null means no completion state has yet been evidenced.';
comment on table public.commissioning_system_assets is 'D8.07 system-to-asset scope and declared energy types; energy truth remains in asset_energy_states.';
comment on table public.commissioning_state_transitions is 'D8.07 append-only human evidence trail for the seven-state commissioning lifecycle.';
