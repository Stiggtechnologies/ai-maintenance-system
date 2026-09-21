-- D11.23 / spec §47: accepted required information objects divided by
-- required information objects, with safety-critical and regulatory gaps as
-- hard blockers. Extend the canonical onboarding catalog; do not fork it.

alter table public.onboarding_requirements
  add column if not exists information_readiness_required boolean not null default false,
  add column if not exists regulatory_information boolean not null default false;

update public.onboarding_requirements set information_readiness_required=true
 where ori_category in ('asset_master','bom','task_list','procedure','documentation','cyber');
update public.onboarding_requirements set information_readiness_required=true
 where key in ('s16_safety_critical','s16_regulatory_requirements','s16_hazardous_area','s16_loto_requirements');
update public.onboarding_requirements set regulatory_information=true
 where key in ('s16_regulatory_requirements','s16_hazardous_area','s15_certificates');

create or replace function public.get_case_information_readiness_index(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); c public.development_cases%rowtype; s record;
  v_systems jsonb:='[]'::jsonb; v_blockers jsonb:='[]'::jsonb; v_system_count int:=0;
  v_total int:=0; v_accepted int:=0; v_hard int:=0; v_unassessed int:=0;
  st int; sa int; sh int; sb jsonb;
begin
  if v_org is null then raise exception 'authentication required'; end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then raise exception 'development case not found in current tenant'; end if;
  for s in select id,system_ref,title from public.commissioning_systems where organization_id=v_org and development_case_id=c.id order by system_ref loop
    v_system_count:=v_system_count+1;
    select count(*),count(*) filter(where i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null),
      count(*) filter(where (r.safety_mission_critical or r.regulatory_information) and not(i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)),
      coalesce(jsonb_agg(jsonb_build_object('systemId',s.id,'systemRef',s.system_ref,'itemId',i.id,'assetId',i.asset_id,'asset',a.name,'requirementKey',r.key,'item',r.item_label,
        'class',case when r.safety_mission_critical and r.regulatory_information then 'safety_and_regulatory' when r.safety_mission_critical then 'safety_critical' else 'regulatory' end,
        'status',i.status,'evidenceReady',i.evidence_item_id is not null) order by a.name,r.sort_order)
        filter(where (r.safety_mission_critical or r.regulatory_information) and not(i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)),'[]'::jsonb)
      into st,sa,sh,sb
      from public.commissioning_system_readiness_scope q
      join public.asset_onboarding_items i on i.id=q.onboarding_item_id and i.organization_id=v_org
      join public.onboarding_requirements r on r.key=i.requirement_key and r.information_readiness_required
      join public.assets a on a.id=i.asset_id and a.organization_id=v_org
      where q.organization_id=v_org and q.commissioning_system_id=s.id;
    v_total:=v_total+st; v_accepted:=v_accepted+sa; v_hard:=v_hard+sh; v_blockers:=v_blockers||sb;
    if st=0 then v_unassessed:=v_unassessed+1; end if;
    v_systems:=v_systems||jsonb_build_array(jsonb_build_object('systemId',s.id,'systemRef',s.system_ref,'title',s.title,
      'required',st,'accepted',sa,'index',case when st=0 then null else round(100.0*sa/st,1) end,'hardBlockerCount',sh,'hardBlockers',sb,
      'status',case when st=0 then 'NOT_ASSESSED' when sh>0 then 'BLOCKED' when sa=st then 'READY' else 'NOT_READY' end));
  end loop;
  return jsonb_build_object('caseId',c.id,'systemCount',v_system_count,
    'project',jsonb_build_object('required',v_total,'accepted',v_accepted,'index',case when v_total=0 then null else round(100.0*v_accepted/v_total,1) end,
      'hardBlockerCount',v_hard,'unassessedSystemCount',v_unassessed,
      'status',case when v_system_count=0 or v_total=0 or v_unassessed>0 then 'NOT_ASSESSED' when v_hard>0 then 'BLOCKED' when v_accepted=v_total then 'READY' else 'NOT_READY' end),
    'systems',v_systems,'hardBlockers',v_blockers,
    'formula','Accepted evidence-backed required information objects / scoped required information objects. No weights and no imputation.',
    'hardBlockerRule','Any unaccepted scoped regulatory or safety-critical information object blocks readiness regardless of the index.',
    'decisionBoundary','The index is evidence visibility, not regulatory certification, safety adequacy, handover acceptance or information waiver. Named humans retain those determinations.');
end $$;
revoke all on function public.get_case_information_readiness_index(uuid) from public;
grant execute on function public.get_case_information_readiness_index(uuid) to authenticated;
comment on function public.get_case_information_readiness_index(uuid) is 'D11.23 §47 project/system information readiness index with regulatory and safety-critical hard blockers.';
notify pgrst, 'reload schema';
