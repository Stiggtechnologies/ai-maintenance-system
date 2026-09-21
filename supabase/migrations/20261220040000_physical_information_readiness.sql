-- D11.08: keep information readiness distinct from physical readiness at
-- project and commissioning-system scope. This is a read-only composition of
-- the existing commissioning, quality and onboarding stores.

create or replace function public.get_case_physical_information_readiness(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); c public.development_cases%rowtype; s record;
  v_systems jsonb:='[]'::jsonb; v_system_count int:=0;
  p_total int:=0; p_done int:=0; i_total int:=0; i_done int:=0;
  sp_total int; sp_done int; si_total int; si_done int;
  sp_gaps jsonb; si_gaps jsonb; v_unassessed_physical int:=0; v_unassessed_information int:=0;
begin
  if v_org is null then raise exception 'authentication required'; end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then raise exception 'development case not found in current tenant'; end if;

  for s in select id,system_ref,title,commissioning_state from public.commissioning_systems
    where organization_id=v_org and development_case_id=c.id order by system_ref
  loop
    v_system_count:=v_system_count+1;
    select count(*),count(*) filter(where release_status='released' and outcome in ('pass','pass_with_punch') and punch_items_open=0),
      coalesce(jsonb_agg(jsonb_build_object('testId',id,'testRef',test_ref,'releaseStatus',release_status,'outcome',outcome,'openPunchCount',punch_items_open)
        order by test_ref) filter(where release_status<>'released' or outcome not in ('pass','pass_with_punch') or punch_items_open>0),'[]'::jsonb)
      into sp_total,sp_done,sp_gaps from public.acceptance_tests
      where organization_id=v_org and commissioning_system_id=s.id;
    select count(*),count(*) filter(where i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null),
      coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'assetId',i.asset_id,'asset',a.name,'category',r.ori_category,'item',r.item_label,'status',i.status,'evidenceReady',i.evidence_item_id is not null)
        order by r.sort_order,a.name) filter(where not(i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)),'[]'::jsonb)
      into si_total,si_done,si_gaps
      from public.commissioning_system_readiness_scope q
      join public.asset_onboarding_items i on i.id=q.onboarding_item_id and i.organization_id=v_org
      join public.onboarding_requirements r on r.key=i.requirement_key
      join public.assets a on a.id=i.asset_id and a.organization_id=v_org
      where q.organization_id=v_org and q.commissioning_system_id=s.id
        and r.ori_category in ('asset_master','bom','task_list','procedure','documentation','cyber');
    p_total:=p_total+sp_total; p_done:=p_done+sp_done; i_total:=i_total+si_total; i_done:=i_done+si_done;
    if sp_total=0 then v_unassessed_physical:=v_unassessed_physical+1; end if;
    if si_total=0 then v_unassessed_information:=v_unassessed_information+1; end if;
    v_systems:=v_systems||jsonb_build_array(jsonb_build_object(
      'systemId',s.id,'systemRef',s.system_ref,'title',s.title,'commissioningState',s.commissioning_state,
      'physical',jsonb_build_object('status',case when s.commissioning_state in ('PERFORMANCE_VERIFIED','ACCEPTED') and sp_total>0 and sp_done=sp_total then 'READY' when sp_total=0 then 'NOT_ASSESSED' else 'NOT_READY' end,
        'satisfied',sp_done,'total',sp_total,'percent',case when sp_total=0 then null else round(100.0*sp_done/sp_total,1) end,'gaps',sp_gaps,'source','acceptance_tests + commissioning_systems'),
      'information',jsonb_build_object('status',case when si_total>0 and si_done=si_total then 'READY' when si_total=0 then 'NOT_ASSESSED' else 'NOT_READY' end,
        'satisfied',si_done,'total',si_total,'percent',case when si_total=0 then null else round(100.0*si_done/si_total,1) end,'gaps',si_gaps,
        'categories',jsonb_build_array('asset_master','bom','task_list','procedure','documentation','cyber'),'source','commissioning_system_readiness_scope + asset_onboarding_items')));
  end loop;

  return jsonb_build_object('caseId',c.id,'systemCount',v_system_count,
    'project',jsonb_build_object(
      'physical',jsonb_build_object('status',case when v_system_count=0 or p_total=0 or v_unassessed_physical>0 then 'NOT_ASSESSED' when p_done=p_total and not exists(select 1 from public.commissioning_systems x where x.organization_id=v_org and x.development_case_id=c.id and coalesce(x.commissioning_state,'') not in ('PERFORMANCE_VERIFIED','ACCEPTED')) then 'READY' else 'NOT_READY' end,
        'satisfied',p_done,'total',p_total,'percent',case when p_total=0 then null else round(100.0*p_done/p_total,1) end,'unassessedSystemCount',v_unassessed_physical,'source','acceptance_tests + commissioning_systems'),
      'information',jsonb_build_object('status',case when v_system_count=0 or i_total=0 or v_unassessed_information>0 then 'NOT_ASSESSED' when i_done=i_total then 'READY' else 'NOT_READY' end,
        'satisfied',i_done,'total',i_total,'percent',case when i_total=0 then null else round(100.0*i_done/i_total,1) end,'unassessedSystemCount',v_unassessed_information,'source','commissioning_system_readiness_scope + asset_onboarding_items')),
    'systems',v_systems,
    'composition','Physical readiness is independently released commissioning acceptance; information readiness is evidence-backed scoped asset information. Neither substitutes for the other.',
    'decisionBoundary','Readiness is evidence visibility only. It does not accept handover, release equipment, waive punch work or declare information complete; named humans retain those authorities.');
end $$;
revoke all on function public.get_case_physical_information_readiness(uuid) from public;
grant execute on function public.get_case_physical_information_readiness(uuid) to authenticated;
comment on function public.get_case_physical_information_readiness(uuid) is 'D11.08 project/system physical and information readiness kept separate over canonical sources.';
notify pgrst, 'reload schema';
