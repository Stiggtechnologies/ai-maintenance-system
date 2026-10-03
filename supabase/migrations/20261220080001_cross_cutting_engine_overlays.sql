-- D11.03 — all seven cross-cutting overlays composed over every one of the
-- eight Sync Develop engines. Read-only composition over canonical stores.

create or replace function public.get_case_engine_overlays(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); c public.development_cases%rowtype;
  v_risk int; v_risk_attention int; v_quality int; v_sustainability int;
  v_hop int; v_stakeholders int; v_stakeholder_attention int;
  v_evidence int; v_evidence_attention int; v_ai int; v_ai_attention int;
  v_overlays jsonb; v_engines jsonb; e jsonb;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','authenticated organization required'); end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;

  select count(*),count(*) filter(where status not in ('closed','retired') and current_risk_level in ('High','Critical'))
    into v_risk,v_risk_attention from public.risks where organization_id=v_org and development_case_id=c.id;
  select count(*) into v_quality from public.quality_requirements q
    join public.design_requirements d on d.id=q.design_requirement_id and d.organization_id=v_org
    where q.organization_id=v_org and d.development_case_id=c.id;
  select count(*) into v_sustainability from public.option_sustainability_observations s
    join public.business_case_options o on o.id=s.option_id and o.organization_id=v_org
    join public.business_cases b on b.id=o.case_id and b.organization_id=v_org
    where s.organization_id=v_org and b.development_case_id=c.id;
  select count(*) into v_hop from public.human_performance_events
    where organization_id=v_org and development_case_id=c.id;
  select count(*),count(*) filter(where status='breached') into v_stakeholders,v_stakeholder_attention
    from public.stakeholder_commitments where organization_id=v_org and development_case_id=c.id;
  select count(*),count(*) filter(where verification_status<>'verified') into v_evidence,v_evidence_attention
    from public.evidence_items where organization_id=v_org and development_case_id=c.id;
  select count(*),count(*) filter(where status in ('pending','proposed')) into v_ai,v_ai_attention
    from public.recommendations where organization_id=v_org and development_case_id=c.id;

  v_overlays:=jsonb_build_array(
    jsonb_build_object('key','risk','label','Risk','count',v_risk,'attentionCount',v_risk_attention,
      'state',case when v_risk_attention>0 then 'attention' when v_risk>0 then 'recorded' else 'missing' end,
      'basis','Canonical case risks; high/critical open risks require accountable review.','anchor','risk'),
    jsonb_build_object('key','quality','label','Quality','count',v_quality,'attentionCount',0,
      'state',case when v_quality>0 then 'recorded' else 'missing' end,
      'basis','Quality requirements linked through canonical design requirements.','anchor','design'),
    jsonb_build_object('key','sustainability','label','Sustainability','count',v_sustainability,'attentionCount',0,
      'state',case when v_sustainability>0 then 'recorded' else 'missing' end,
      'basis','Evidence-backed sustainability observations on this case’s options.','anchor','value'),
    jsonb_build_object('key','hop','label','HOP','count',v_hop,'attentionCount',0,
      'state',case when v_hop>0 then 'recorded' else 'missing' end,
      'basis','System-condition observations only; no worker score or surveillance.','anchor','controls'),
    jsonb_build_object('key','stakeholders','label','Stakeholders','count',v_stakeholders,'attentionCount',v_stakeholder_attention,
      'state',case when v_stakeholder_attention>0 then 'attention' when v_stakeholders>0 then 'recorded' else 'missing' end,
      'basis','Canonical stakeholder commitments; breached commitments require review.','anchor','stakeholders'),
    jsonb_build_object('key','evidence','label','Evidence','count',v_evidence,'attentionCount',v_evidence_attention,
      'state',case when v_evidence_attention>0 then 'attention' when v_evidence>0 then 'recorded' else 'missing' end,
      'basis','Case evidence with provenance and verification state preserved.','anchor','evidence'),
    jsonb_build_object('key','ai','label','AI','count',v_ai,'attentionCount',v_ai_attention,
      'state',case when v_ai_attention>0 then 'attention' when v_ai>0 then 'recorded' else 'missing' end,
      'basis','Advisory recommendations only; named humans retain approval and decision authority.','anchor','decisions')
  );

  v_engines:='[]'::jsonb;
  for e in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('key','frame','label','Frame','focus','Problem, opportunity, strategy and options','anchor','case-summary'),
    jsonb_build_object('key','value','label','Value','focus','Business case, economics, benefits and assumptions','anchor','value'),
    jsonb_build_object('key','govern','label','Govern','focus','Framework, tailoring, gates, decisions and assurance','anchor','governance'),
    jsonb_build_object('key','design','label','Design','focus','Requirements, interfaces, RAM, constructability and quality','anchor','design'),
    jsonb_build_object('key','control','label','Control','focus','Scope, cost, schedule, risk, resources and change','anchor','controls'),
    jsonb_build_object('key','deliver','label','Deliver','focus','Procurement, contractors, construction and constraint removal','anchor','procurement'),
    jsonb_build_object('key','ready','label','Ready','focus','Commissioning, operational readiness and handover','anchor','readiness'),
    jsonb_build_object('key','realize','label','Realize','focus','Ramp-up, benefits, reliability and learning','anchor','realize')
  )) loop
    v_engines:=v_engines||jsonb_build_array(e||jsonb_build_object('overlays',v_overlays));
  end loop;
  return jsonb_build_object(
    'caseId',c.id,'caseTitle',c.title,'engines',v_engines,
    'overlayKeys',jsonb_build_array('risk','quality','sustainability','hop','stakeholders','evidence','ai'),
    'composition','Cross-cutting read model over canonical case stores; no duplicate overlay records or synthetic score.',
    'authorityBoundary','Overlay state is visibility, not gate approval, risk acceptance, quality release, compliance certification or operational authorization.'
  );
end $$;

revoke all on function public.get_case_engine_overlays(uuid) from public,anon;
grant execute on function public.get_case_engine_overlays(uuid) to authenticated;
comment on function public.get_case_engine_overlays(uuid) is
  'D11.03: composes all seven cross-cutting overlays over all eight engines from canonical tenant-scoped case records.';
notify pgrst,'reload schema';
