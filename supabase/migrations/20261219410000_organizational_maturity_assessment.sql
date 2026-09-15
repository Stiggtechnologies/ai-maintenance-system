-- U22.01 — evidence-backed organizational maturity assessment.
--
-- Canonical reuse:
--   * evidence_items is the only evidence record;
--   * recommendations is the only improvement-action record;
--   * approvals is the only human disposition record;
--   * audit_events is the only audit trail;
--   * user_profiles/app_current_org remain the tenant and actor boundary.
-- Scores are assessor claims backed by verified evidence. SyncAI does not infer
-- maturity from feature presence, certify an organization, or authorize work.

create table if not exists public.organizational_maturity_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 160),
  scope text not null check (length(btrim(scope)) between 10 and 1000),
  evidence_summary text not null check (length(btrim(evidence_summary)) between 20 and 4000),
  status text not null default 'submitted'
    check (status in ('submitted','approved','rejected','superseded')),
  overall_level numeric(3,2) not null check (overall_level between 0 and 5),
  minimum_level integer not null check (minimum_level between 0 and 5),
  assessed_by uuid not null references auth.users(id),
  assessed_at timestamptz not null default now(),
  next_review date,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  check (
    (status = 'submitted' and reviewed_by is null and reviewed_at is null and review_note is null)
    or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null
        and reviewed_by <> assessed_by and length(btrim(coalesce(review_note,''))) >= 20)
    or status = 'superseded'
  ),
  unique (organization_id, id)
);

create table if not exists public.organizational_maturity_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null,
  domain_key text not null check (domain_key in (
    'leadership','hierarchy','work_management','planning_scheduling','failure_coding',
    'pm_quality','condition_monitoring','materials','engineering_governance',
    'data_quality','workforce','financial_integration','ai_governance')),
  score integer not null check (score between 0 and 5),
  finding text not null check (length(btrim(finding)) between 20 and 2000),
  evidence_item_id uuid not null,
  created_at timestamptz not null default now(),
  unique (assessment_id, domain_key),
  foreign key (organization_id, assessment_id)
    references public.organizational_maturity_assessments(organization_id, id) on delete cascade
);

create unique index if not exists evidence_items_org_id_uq
  on public.evidence_items(organization_id, id);

alter table public.organizational_maturity_domains
  drop constraint if exists organizational_maturity_domains_tenant_evidence_fk;
alter table public.organizational_maturity_domains
  add constraint organizational_maturity_domains_tenant_evidence_fk
  foreign key (organization_id, evidence_item_id)
  references public.evidence_items(organization_id, id);

alter table public.recommendations
  add column if not exists organizational_maturity_assessment_id uuid
    references public.organizational_maturity_assessments(id) on delete set null,
  add column if not exists maturity_domain_key text;

alter table public.approvals
  add column if not exists organizational_maturity_assessment_id uuid
    references public.organizational_maturity_assessments(id) on delete set null;

create index if not exists organizational_maturity_assessments_recent_idx
  on public.organizational_maturity_assessments(organization_id, assessed_at desc);
create index if not exists organizational_maturity_domains_assessment_idx
  on public.organizational_maturity_domains(organization_id, assessment_id, domain_key);
create index if not exists recommendations_maturity_idx
  on public.recommendations(organization_id, organizational_maturity_assessment_id)
  where organizational_maturity_assessment_id is not null;

alter table public.organizational_maturity_assessments enable row level security;
alter table public.organizational_maturity_domains enable row level security;

drop policy if exists organizational_maturity_assessments_org_read on public.organizational_maturity_assessments;
create policy organizational_maturity_assessments_org_read
  on public.organizational_maturity_assessments for select to authenticated
  using (organization_id = public.app_current_org());

drop policy if exists organizational_maturity_domains_org_read on public.organizational_maturity_domains;
create policy organizational_maturity_domains_org_read
  on public.organizational_maturity_domains for select to authenticated
  using (organization_id = public.app_current_org());

create or replace function public.enforce_organizational_maturity_immutability()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'maturity assessments are retained as evidence-bearing records'; end if;
  if current_setting('app.organizational_maturity_review', true) <> 'on' then
    raise exception 'maturity assessment state changes require the governed review function';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.title is distinct from old.title or new.scope is distinct from old.scope
     or new.evidence_summary is distinct from old.evidence_summary
     or new.overall_level is distinct from old.overall_level
     or new.minimum_level is distinct from old.minimum_level
     or new.assessed_by is distinct from old.assessed_by
     or new.assessed_at is distinct from old.assessed_at
     or new.next_review is distinct from old.next_review then
    raise exception 'submitted maturity evidence and scores are immutable; record a new assessment';
  end if;
  return new;
end $$;

drop trigger if exists trg_organizational_maturity_immutable on public.organizational_maturity_assessments;
create trigger trg_organizational_maturity_immutable
before update or delete on public.organizational_maturity_assessments
for each row execute function public.enforce_organizational_maturity_immutability();

create or replace function public.enforce_maturity_canonical_links()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.organizational_maturity_assessment_id is not null
     and ((tg_op='INSERT') or (tg_op='UPDATE' and new.organizational_maturity_assessment_id is distinct from old.organizational_maturity_assessment_id))
     and current_setting('app.organizational_maturity_review',true)<>'on' then
    raise exception 'maturity links are created only by the governed review function';
  end if;
  if new.organizational_maturity_assessment_id is not null and not exists (
    select 1 from public.organizational_maturity_assessments a
    where a.id=new.organizational_maturity_assessment_id and a.organization_id=new.organization_id
      and a.status='approved'
  ) then raise exception 'maturity assessment link is outside this organization'; end if;
  if tg_table_name='recommendations' and new.organizational_maturity_assessment_id is not null
     and coalesce(new.maturity_domain_key,'') not in (
       'leadership','hierarchy','work_management','planning_scheduling','failure_coding',
       'pm_quality','condition_monitoring','materials','engineering_governance',
       'data_quality','workforce','financial_integration','ai_governance') then
    raise exception 'a canonical maturity domain is required';
  end if;
  if tg_table_name='recommendations' and new.organizational_maturity_assessment_id is not null
     and not exists(select 1 from public.organizational_maturity_domains d
       where d.assessment_id=new.organizational_maturity_assessment_id
         and d.organization_id=new.organization_id and d.domain_key=new.maturity_domain_key
         and d.score<4) then
    raise exception 'maturity recommendation requires an approved assessed gap';
  end if;
  return new;
end $$;

drop trigger if exists trg_recommendations_maturity_link on public.recommendations;
create trigger trg_recommendations_maturity_link before insert or update
on public.recommendations for each row execute function public.enforce_maturity_canonical_links();
drop trigger if exists trg_approvals_maturity_link on public.approvals;
create trigger trg_approvals_maturity_link before insert or update
on public.approvals for each row execute function public.enforce_maturity_canonical_links();

create or replace function public.record_organizational_maturity_assessment(p_assessment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_id uuid; v_domain jsonb;
  v_score_sum numeric:=0; v_min integer:=5; v_count integer:=0; v_evidence uuid;
  v_next_review date:=public.sync_text_as_date(nullif(btrim(coalesce(p_assessment->>'nextReview','')),''));
  v_allowed constant text[]:=array[
    'leadership','hierarchy','work_management','planning_scheduling','failure_coding',
    'pm_quality','condition_monitoring','materials','engineering_governance',
    'data_quality','workforce','financial_integration','ai_governance'];
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  if jsonb_typeof(p_assessment->'domains') <> 'array' then
    return jsonb_build_object('error','all 13 maturity domains are required');
  end if;
  if (select count(*) from jsonb_array_elements(p_assessment->'domains')) <> 13
     or (select count(distinct d->>'domainKey') from jsonb_array_elements(p_assessment->'domains') d) <> 13
     or exists(select 1 from jsonb_array_elements(p_assessment->'domains') d where not ((d->>'domainKey')=any(v_allowed))) then
    return jsonb_build_object('error','each of the 13 canonical maturity domains must appear exactly once');
  end if;
  if length(btrim(coalesce(p_assessment->>'title',''))) < 3
     or length(btrim(coalesce(p_assessment->>'scope',''))) < 10
     or length(btrim(coalesce(p_assessment->>'evidenceSummary',''))) < 20 then
    return jsonb_build_object('error','title, scope and evidence summary are required');
  end if;
  if length(btrim(p_assessment->>'title'))>160 or length(btrim(p_assessment->>'scope'))>1000
     or length(btrim(p_assessment->>'evidenceSummary'))>4000 then
    return jsonb_build_object('error','title, scope or evidence summary exceeds its governed length');
  end if;
  if nullif(btrim(coalesce(p_assessment->>'nextReview','')),'') is not null
     and v_next_review is null then return jsonb_build_object('error','next review must be a valid date'); end if;
  if v_next_review is not null and v_next_review<current_date then
    return jsonb_build_object('error','next review cannot be in the past');
  end if;
  for v_domain in select value from jsonb_array_elements(p_assessment->'domains') loop
    if jsonb_typeof(v_domain->'score') <> 'number'
       or (v_domain->>'score')::numeric <> trunc((v_domain->>'score')::numeric)
       or (v_domain->>'score')::numeric not between 0 and 5 then
      return jsonb_build_object('error',(v_domain->>'domainKey')||' score must be a whole number from 0 through 5');
    end if;
    if length(btrim(coalesce(v_domain->>'finding',''))) < 20 then
      return jsonb_build_object('error',(v_domain->>'domainKey')||' requires a specific evidence-backed finding');
    end if;
    if coalesce(v_domain->>'evidenceItemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('error',(v_domain->>'domainKey')||' requires a valid evidence item');
    end if;
    v_evidence:=(v_domain->>'evidenceItemId')::uuid;
    if not exists(select 1 from public.evidence_items e where e.id=v_evidence
      and e.organization_id=v_org and e.verification_status='verified') then
      return jsonb_build_object('error',(v_domain->>'domainKey')||' requires same-tenant verified canonical evidence');
    end if;
    v_score_sum:=v_score_sum+(v_domain->>'score')::integer;
    v_min:=least(v_min,(v_domain->>'score')::integer); v_count:=v_count+1;
  end loop;
  insert into public.organizational_maturity_assessments(
    organization_id,title,scope,evidence_summary,overall_level,minimum_level,
    assessed_by,next_review)
  values(v_org,btrim(p_assessment->>'title'),btrim(p_assessment->>'scope'),
    btrim(p_assessment->>'evidenceSummary'),round(v_score_sum/v_count,2),v_min,
    auth.uid(),v_next_review) returning id into v_id;
  for v_domain in select value from jsonb_array_elements(p_assessment->'domains') loop
    insert into public.organizational_maturity_domains(
      organization_id,assessment_id,domain_key,score,finding,evidence_item_id)
    values(v_org,v_id,v_domain->>'domainKey',(v_domain->>'score')::integer,
      btrim(v_domain->>'finding'),(v_domain->>'evidenceItemId')::uuid);
  end loop;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'organizational_maturity_assessment_submitted',v_role,
    jsonb_build_object('assessment_id',v_id,'domain_count',v_count,
      'overall_level',round(v_score_sum/v_count,2),'minimum_level',v_min,
      'claim','assessor-scored implementation maturity, not certification'));
  return jsonb_build_object('assessmentId',v_id,'status','submitted',
    'overallLevel',round(v_score_sum/v_count,2),'minimumLevel',v_min,
    'domainCount',v_count,'claim','implementation maturity assessment, not certification');
exception when others then
  return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.review_organizational_maturity_assessment(
  p_assessment_id uuid,p_decision text,p_review_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text;
  a public.organizational_maturity_assessments%rowtype; d record; v_action text;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive') then return jsonb_build_object('error','forbidden'); end if;
  if p_decision not in ('approved','rejected') then return jsonb_build_object('error','decision must be approved or rejected'); end if;
  if length(btrim(coalesce(p_review_note,'')))<20 then return jsonb_build_object('error','review note must explain the independent decision'); end if;
  select * into a from public.organizational_maturity_assessments
    where id=p_assessment_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','assessment not found in this organization'); end if;
  if a.status<>'submitted' then return jsonb_build_object('error','only a submitted assessment can be reviewed'); end if;
  if a.assessed_by=auth.uid() then return jsonb_build_object('error','the assessor cannot independently review their own assessment'); end if;
  if exists(select 1 from public.organizational_maturity_domains md
    join public.evidence_items e on e.id=md.evidence_item_id and e.organization_id=v_org
    where md.assessment_id=a.id and (e.verification_status<>'verified' or e.verified_by=a.assessed_by)) then
    return jsonb_build_object('error','each domain requires evidence independently verified by someone other than the assessor');
  end if;
  perform set_config('app.organizational_maturity_review','on',true);
  update public.organizational_maturity_assessments set status=p_decision,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_review_note) where id=a.id;
  insert into public.approvals(organization_id,status,owner_role,approver,reason,
    consequence_of_wrong,required_validation,decided_at,organizational_maturity_assessment_id)
  values(v_org,p_decision,'executive',v_role,btrim(p_review_note),
    'An unsupported maturity claim can misdirect investment and conceal control weaknesses.',
    'Independent review of all 13 domain scores and their verified evidence.',now(),a.id);
  if p_decision='approved' then
    for d in select * from public.organizational_maturity_domains where assessment_id=a.id and score<4 order by score,domain_key loop
      v_action:=case
        when d.score<=1 then 'Establish an accountable owner, minimum controlled process, and repeatable evidence capture.'
        when d.score=2 then 'Standardize the practice, train responsible roles, and define an outcome measure.'
        else 'Integrate the practice across workflows and verify effectiveness using recorded outcomes.' end;
      insert into public.recommendations(organization_id,title,issue,action,impact,confidence,
        urgency,status,approval_required,accountable,rationale,
        organizational_maturity_assessment_id,maturity_domain_key)
      values(v_org,'Improve '||replace(d.domain_key,'_',' ')||' maturity',d.finding,v_action,
        'Closes a reviewer-approved organizational maturity gap.',null,'advisory','pending',
        'Human accountable-owner approval is required before implementation.',replace(d.domain_key,'_',' '),
        'Generated from approved assessment '||a.id||' and linked verified evidence '||d.evidence_item_id||'.',
        a.id,d.domain_key);
    end loop;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'organizational_maturity_assessment_reviewed',v_role,
    jsonb_build_object('assessment_id',a.id,'decision',p_decision,
      'recommendations_created',case when p_decision='approved' then
        (select count(*) from public.recommendations r where r.organizational_maturity_assessment_id=a.id) else 0 end,
      'operational_authorization',false,'certification_claim',false));
  return jsonb_build_object('assessmentId',a.id,'decision',p_decision,
    'recommendationsCreated',case when p_decision='approved' then
      (select count(*) from public.recommendations r where r.organizational_maturity_assessment_id=a.id) else 0 end,
    'operationalAuthorization',false,'certificationClaim',false);
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.get_organizational_maturity_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','authenticated organization required'); end if;
  return jsonb_build_object(
    'dimensions',jsonb_build_array(
      'leadership','hierarchy','work_management','planning_scheduling','failure_coding',
      'pm_quality','condition_monitoring','materials','engineering_governance',
      'data_quality','workforce','financial_integration','ai_governance'),
    'scale',jsonb_build_array(
      jsonb_build_object('level',0,'label','Not evidenced'),
      jsonb_build_object('level',1,'label','Ad hoc'),
      jsonb_build_object('level',2,'label','Repeatable'),
      jsonb_build_object('level',3,'label','Defined'),
      jsonb_build_object('level',4,'label','Measured'),
      jsonb_build_object('level',5,'label','Continuously improved')),
    'assessments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'title',a.title,'scope',a.scope,'evidenceSummary',a.evidence_summary,
      'status',a.status,'overallLevel',a.overall_level,'minimumLevel',a.minimum_level,
      'assessedBy',a.assessed_by,'assessedAt',a.assessed_at,'nextReview',a.next_review,
      'reviewedBy',a.reviewed_by,'reviewedAt',a.reviewed_at,'reviewNote',a.review_note,
      'domains',coalesce((select jsonb_agg(jsonb_build_object(
        'domainKey',d.domain_key,'score',d.score,'finding',d.finding,
        'evidenceItemId',d.evidence_item_id,'evidenceDescription',e.description,
        'evidenceVerificationStatus',e.verification_status) order by d.domain_key)
        from public.organizational_maturity_domains d join public.evidence_items e on e.id=d.evidence_item_id
        where d.assessment_id=a.id and d.organization_id=v_org),'[]'::jsonb),
      'recommendations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'domainKey',r.maturity_domain_key,'title',r.title,'action',r.action,
        'status',r.status,'approvalRequired',r.approval_required) order by r.maturity_domain_key)
        from public.recommendations r where r.organization_id=v_org
        and r.organizational_maturity_assessment_id=a.id),'[]'::jsonb),
      'operationalAuthorization',false,'certificationClaim',false
    ) order by a.assessed_at desc) from public.organizational_maturity_assessments a
      where a.organization_id=v_org),'[]'::jsonb),
    'basis','All 13 dimensions require assessor-entered scores and independently verified canonical evidence. Recommendations appear only after independent approval and remain human-approved work proposals; this is not certification.');
end $$;

revoke all on table public.organizational_maturity_assessments from public,anon,authenticated;
revoke all on table public.organizational_maturity_domains from public,anon,authenticated;
grant select on table public.organizational_maturity_assessments to authenticated;
grant select on table public.organizational_maturity_domains to authenticated;
revoke all on function public.record_organizational_maturity_assessment(jsonb) from public,anon,service_role;
revoke all on function public.review_organizational_maturity_assessment(uuid,text,text) from public,anon,service_role;
revoke all on function public.get_organizational_maturity_workspace() from public,anon;
grant execute on function public.record_organizational_maturity_assessment(jsonb) to authenticated;
grant execute on function public.review_organizational_maturity_assessment(uuid,text,text) to authenticated;
grant execute on function public.get_organizational_maturity_workspace() to authenticated;
revoke all on function public.enforce_organizational_maturity_immutability() from public,anon,authenticated,service_role;
revoke all on function public.enforce_maturity_canonical_links() from public,anon,authenticated,service_role;

comment on function public.record_organizational_maturity_assessment(jsonb) is
  'Records a complete 13-domain assessor claim backed by same-tenant verified canonical evidence; it does not infer maturity or certify the organization.';
comment on function public.review_organizational_maturity_assessment(uuid,text,text) is
  'Independent human disposition of an immutable maturity assessment. Approved gaps create canonical pending recommendations but no operational authority.';
