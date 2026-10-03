-- U24.01 — explicit ethical boundaries as a governed, evidence-backed register.
-- Existing controls are composed, never duplicated: evidence_items proves each
-- control, recommendations carries remediation, approvals carries independent
-- disposition, user_profiles names accountable humans, and audit_events keeps
-- the trail. This register does not pretend a keyword filter can prove ethics.

create table if not exists public.ethical_boundary_definitions (
  boundary_key text primary key check (boundary_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  title text not null,
  prohibition text not null check (length(btrim(prohibition)) >= 20),
  control_family text not null,
  verification_requirement text not null check (length(btrim(verification_requirement)) >= 20),
  platform_control_reference text not null check (length(btrim(platform_control_reference)) >= 3),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

insert into public.ethical_boundary_definitions(
  boundary_key,title,prohibition,control_family,verification_requirement,platform_control_reference)
values
('uncertainty_visibility','Expose uncertainty','Do not hide material uncertainty, limitations, conflicting evidence or applicability boundaries.','decision_quality','Verify that consequential outputs state uncertainty, limitations and evidence gaps before approval.','recommendation contract C8.19 and model applicability envelopes'),
('metric_integrity','Protect metric integrity','Do not manipulate definitions, populations, baselines, targets, observations or verification states to improve a reported result.','measurement_governance','Verify method, source, owner, unit, period and independent disposition for decision-relevant measures.','canonical value_metrics and verify_value_metric'),
('safe_staffing','Reject unsafe staffing','Do not recommend or reward staffing, workload, competence or fatigue conditions that bypass mandatory safety and readiness controls.','human_factors','Verify competence, capacity, fatigue, supervision and escalation controls before staffing advice is adopted.','resource balance, workforce readiness and HOP system-condition controls'),
('nondiscrimination','Prohibit discrimination','Do not use protected traits or unjustified proxies to allocate opportunity, work, scrutiny, discipline or adverse treatment.','fairness','Verify purpose, permitted attributes, proxy review, affected groups and a human appeal path.','data governance purpose/field approval and human review'),
('verified_surveillance','Refuse unverified surveillance','Do not use unverified surveillance, identity, location, image, audio or behavioral inference as decision-grade evidence.','privacy_and_evidence','Verify approved purpose, provenance, consent or lawful basis, retention, access and independent evidence status.','evidence_items verification and Sync Context non-surveillance contract'),
('individual_due_process','Protect individual due process','Do not punish, rank or make an adverse decision about an individual from model output alone.','human_accountability','Verify independent human investigation, corroborating evidence, notice, review and an appeal or correction path.','HOP no-person schema and human-final approval contract'),
('safety_over_finance','Keep mandatory safety ahead of finance','Do not optimize financial value, production or schedule by weakening mandatory safety, regulatory or barrier requirements.','safety_governance','Verify mandatory obligations and barrier decisions remain hard constraints outside economic optimization.','safety gatekeeper, risk acceptance and portfolio mandatory-obligation controls'),
('named_accountability','Keep accountability human and named','Do not obscure responsibility behind the algorithm, model, agent, vendor or automated workflow.','accountability','Verify a named accountable owner, decision authority, rationale and consequence-of-error path.','RACI, authority_limits, approvals and audit_events'),
('no_fabricated_authority','Never fabricate authority','Do not claim certification, approval, risk acceptance, legal compliance, safe-to-start, work release or other authority the system does not hold.','authority_boundary','Verify the determination comes from an authorized human or deterministic governed control and that AI remains advisory.','agent authority controls and deterministic section 70 boundaries')
on conflict (boundary_key) do update set
  title=excluded.title,prohibition=excluded.prohibition,control_family=excluded.control_family,
  verification_requirement=excluded.verification_requirement,
  platform_control_reference=excluded.platform_control_reference;

alter table public.ethical_boundary_definitions enable row level security;
drop policy if exists ethical_boundary_definitions_read on public.ethical_boundary_definitions;
create policy ethical_boundary_definitions_read on public.ethical_boundary_definitions
  for select to authenticated using (auth.uid() is not null);
revoke all on table public.ethical_boundary_definitions from public,anon,authenticated;
grant select on table public.ethical_boundary_definitions to authenticated;

create or replace function public.ethical_boundary_keys()
returns text[] language sql stable set search_path=public as $$
  select array_agg(boundary_key order by boundary_key) from public.ethical_boundary_definitions;
$$;
revoke all on function public.ethical_boundary_keys() from public,anon;
grant execute on function public.ethical_boundary_keys() to authenticated,service_role;

create table if not exists public.ethical_boundary_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 160),
  scope text not null check (length(btrim(scope)) between 20 and 2000),
  purpose text not null check (length(btrim(purpose)) between 20 and 2000),
  effective_on date not null,
  next_review_on date not null,
  status text not null default 'draft'
    check (status in ('draft','remediation_required','review_pending','adopted','rejected','superseded')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  check (next_review_on > effective_on),
  check (status not in ('review_pending','adopted','rejected') or submitted_by is not null),
  check (status not in ('adopted','rejected') or
    (reviewed_by is not null and reviewed_at is not null
     and length(btrim(coalesce(review_note,''))) >= 20)),
  unique (organization_id,id)
);

create unique index if not exists ethical_boundary_one_adopted
  on public.ethical_boundary_reviews(organization_id) where status='adopted';

create table if not exists public.ethical_boundary_determinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_id uuid not null,
  boundary_key text not null references public.ethical_boundary_definitions(boundary_key) on delete restrict,
  outcome text not null check (outcome in ('enforced','gap')),
  control_description text not null check (length(btrim(control_description)) between 20 and 4000),
  verification_procedure text not null check (length(btrim(verification_procedure)) between 20 and 4000),
  evidence_item_id uuid not null,
  accountable_owner_id uuid not null references public.user_profiles(id) on delete restrict,
  remediation text,
  assessed_by uuid not null references auth.users(id) on delete restrict,
  assessed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id,boundary_key),
  foreign key (organization_id,review_id)
    references public.ethical_boundary_reviews(organization_id,id) on delete cascade,
  foreign key (organization_id,evidence_item_id)
    references public.evidence_items(organization_id,id),
  check (outcome<>'gap' or length(btrim(coalesce(remediation,''))) >= 20)
);

alter table public.recommendations
  add column if not exists ethical_boundary_review_id uuid
    references public.ethical_boundary_reviews(id) on delete set null,
  add column if not exists ethical_boundary_key text;
alter table public.approvals
  add column if not exists ethical_boundary_review_id uuid
    references public.ethical_boundary_reviews(id) on delete set null;

alter table public.recommendations
  add constraint recommendations_ethical_boundary_pair_check
    check ((ethical_boundary_review_id is null) = (ethical_boundary_key is null)),
  add constraint recommendations_ethical_boundary_review_tenant_fk
    foreign key (organization_id,ethical_boundary_review_id)
    references public.ethical_boundary_reviews(organization_id,id),
  add constraint recommendations_ethical_boundary_key_fk
    foreign key (ethical_boundary_key)
    references public.ethical_boundary_definitions(boundary_key) on delete restrict;
alter table public.approvals
  add constraint approvals_ethical_boundary_review_tenant_fk
    foreign key (organization_id,ethical_boundary_review_id)
    references public.ethical_boundary_reviews(organization_id,id);

create index if not exists ethical_boundary_reviews_recent_idx
  on public.ethical_boundary_reviews(organization_id,created_at desc);
create index if not exists ethical_boundary_determinations_review_idx
  on public.ethical_boundary_determinations(organization_id,review_id,boundary_key);
create index if not exists recommendations_ethical_boundary_idx
  on public.recommendations(organization_id,ethical_boundary_review_id)
  where ethical_boundary_review_id is not null;
create unique index if not exists recommendations_ethical_boundary_gap_unique
  on public.recommendations(organization_id,ethical_boundary_review_id,ethical_boundary_key)
  where ethical_boundary_review_id is not null;

alter table public.ethical_boundary_reviews enable row level security;
alter table public.ethical_boundary_determinations enable row level security;
drop policy if exists ethical_boundary_reviews_read on public.ethical_boundary_reviews;
create policy ethical_boundary_reviews_read on public.ethical_boundary_reviews
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists ethical_boundary_determinations_read on public.ethical_boundary_determinations;
create policy ethical_boundary_determinations_read on public.ethical_boundary_determinations
  for select to authenticated using (organization_id=public.app_current_org());
revoke all on table public.ethical_boundary_reviews,public.ethical_boundary_determinations
  from public,anon,authenticated;
grant select on table public.ethical_boundary_reviews,public.ethical_boundary_determinations
  to authenticated;

create or replace function public.enforce_ethical_boundary_write_wall()
returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(current_setting('app.ethical_boundary_write',true),'')<>'granted' then
    raise exception 'ethical boundary records move only through governed functions';
  end if;
  if tg_op='DELETE' then
    raise exception 'ethical boundary evidence is retained; supersede the review instead';
  end if;
  if tg_op='UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'ethical boundary records cannot change organization';
  end if;
  return new;
end $$;
drop trigger if exists trg_ethical_boundary_review_wall on public.ethical_boundary_reviews;
create trigger trg_ethical_boundary_review_wall before insert or update or delete
  on public.ethical_boundary_reviews for each row execute function public.enforce_ethical_boundary_write_wall();
drop trigger if exists trg_ethical_boundary_determination_wall on public.ethical_boundary_determinations;
create trigger trg_ethical_boundary_determination_wall before insert or update or delete
  on public.ethical_boundary_determinations for each row execute function public.enforce_ethical_boundary_write_wall();

create or replace function public.enforce_ethical_boundary_links()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then
    if new.ethical_boundary_review_id is not null
       and coalesce(current_setting('app.ethical_boundary_write',true),'')<>'granted' then
      raise exception 'ethical boundary links are created only by governed functions';
    end if;
  elsif new.ethical_boundary_review_id is distinct from old.ethical_boundary_review_id
        or (tg_table_name='recommendations'
            and (to_jsonb(new)->>'ethical_boundary_key') is distinct from
                (to_jsonb(old)->>'ethical_boundary_key')) then
    if coalesce(current_setting('app.ethical_boundary_write',true),'')<>'granted' then
      raise exception 'ethical boundary links are created only by governed functions';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_recommendation_ethical_boundary_link on public.recommendations;
create trigger trg_recommendation_ethical_boundary_link before insert or update
  on public.recommendations for each row execute function public.enforce_ethical_boundary_links();
drop trigger if exists trg_approval_ethical_boundary_link on public.approvals;
create trigger trg_approval_ethical_boundary_link before insert or update
  on public.approvals for each row execute function public.enforce_ethical_boundary_links();

create or replace function public.ethical_boundary_author_role(p_role text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_role,'')) in ('admin','executive','maintenance_manager','reliability_engineer');
$$;

create or replace function public.create_ethical_boundary_review(p_review jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid;
  v_effective date:=public.sync_text_as_date(nullif(btrim(coalesce(p_review->>'effectiveOn','')),''));
  v_next date:=public.sync_text_as_date(nullif(btrim(coalesce(p_review->>'nextReviewOn','')),''));
begin
  if v_org is null or not public.ethical_boundary_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  if length(btrim(coalesce(p_review->>'title','')))<3
     or length(btrim(coalesce(p_review->>'scope','')))<20
     or length(btrim(coalesce(p_review->>'purpose','')))<20
     or v_effective is null or v_next is null or v_next<=v_effective then
    return jsonb_build_object('error','title, substantive scope/purpose and ordered review dates are required');
  end if;
  perform set_config('app.ethical_boundary_write','granted',true);
  insert into public.ethical_boundary_reviews(
    organization_id,title,scope,purpose,effective_on,next_review_on,created_by)
  values(v_org,btrim(p_review->>'title'),btrim(p_review->>'scope'),btrim(p_review->>'purpose'),
    v_effective,v_next,auth.uid()) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'ethical_boundary_review_created',v_role,jsonb_build_object(
    'review_id',v_id,'boundary_count',cardinality(public.ethical_boundary_keys()),
    'automation_authority',false));
  return jsonb_build_object('reviewId',v_id,'status','draft');
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.set_ethical_boundary_determination(
  p_review_id uuid,p_determination jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_review public.ethical_boundary_reviews%rowtype; v_key text:=p_determination->>'boundaryKey';
  v_outcome text:=p_determination->>'outcome'; v_evidence uuid; v_owner uuid; v_id uuid;
begin
  if v_org is null or not public.ethical_boundary_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  select * into v_review from public.ethical_boundary_reviews
    where id=p_review_id and organization_id=v_org;
  if not found or v_review.status not in ('draft','remediation_required') then
    return jsonb_build_object('error','editable ethical boundary review not found');
  end if;
  if not exists(select 1 from public.ethical_boundary_definitions where boundary_key=v_key)
     or v_outcome not in ('enforced','gap') then
    return jsonb_build_object('error','known boundary and enforced/gap outcome are required');
  end if;
  if length(btrim(coalesce(p_determination->>'controlDescription','')))<20
     or length(btrim(coalesce(p_determination->>'verificationProcedure','')))<20
     or (v_outcome='gap' and length(btrim(coalesce(p_determination->>'remediation','')))<20) then
    return jsonb_build_object('error','substantive control, verification and gap remediation are required');
  end if;
  begin v_evidence:=(p_determination->>'evidenceItemId')::uuid; exception when others then
    return jsonb_build_object('error','valid verified evidence is required'); end;
  begin v_owner:=(p_determination->>'accountableOwnerId')::uuid; exception when others then
    return jsonb_build_object('error','valid accountable owner is required'); end;
  if not exists(select 1 from public.evidence_items where id=v_evidence
      and organization_id=v_org and verification_status='verified'
      and verified_by is not null and verified_by is distinct from auth.uid()) then
    return jsonb_build_object('error','same-tenant canonical evidence independently verified by someone other than the assessor is required');
  end if;
  if not exists(select 1 from public.user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','accountable owner must belong to this organization');
  end if;
  perform set_config('app.ethical_boundary_write','granted',true);
  insert into public.ethical_boundary_determinations(
    organization_id,review_id,boundary_key,outcome,control_description,
    verification_procedure,evidence_item_id,accountable_owner_id,remediation,assessed_by)
  values(v_org,p_review_id,v_key,v_outcome,btrim(p_determination->>'controlDescription'),
    btrim(p_determination->>'verificationProcedure'),v_evidence,v_owner,
    nullif(btrim(coalesce(p_determination->>'remediation','')),''),auth.uid())
  on conflict(review_id,boundary_key) do update set
    outcome=excluded.outcome,control_description=excluded.control_description,
    verification_procedure=excluded.verification_procedure,evidence_item_id=excluded.evidence_item_id,
    accountable_owner_id=excluded.accountable_owner_id,remediation=excluded.remediation,
    assessed_by=auth.uid(),assessed_at=now(),updated_at=now()
  returning id into v_id;
  update public.ethical_boundary_reviews set status='draft',updated_at=now()
    where id=p_review_id and status='remediation_required';
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'ethical_boundary_determined',v_role,jsonb_build_object(
    'review_id',p_review_id,'determination_id',v_id,'boundary_key',v_key,
    'outcome',v_outcome,'owner_id',v_owner,'evidence_item_id',v_evidence));
  return jsonb_build_object('determinationId',v_id,'boundaryKey',v_key,'outcome',v_outcome);
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.submit_ethical_boundary_review(p_review_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_review public.ethical_boundary_reviews%rowtype; v_missing text[]; v_gap record; v_gaps int;
  v_boundary_count int:=cardinality(public.ethical_boundary_keys());
begin
  if v_org is null or not public.ethical_boundary_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  if length(btrim(coalesce(p_basis,'')))<20 then
    return jsonb_build_object('error','submission requires a substantive basis');
  end if;
  select * into v_review from public.ethical_boundary_reviews
    where id=p_review_id and organization_id=v_org;
  if not found or v_review.status not in ('draft','remediation_required') then
    return jsonb_build_object('error','editable ethical boundary review not found');
  end if;
  select array_agg(k order by k) into v_missing from unnest(public.ethical_boundary_keys()) k
  where not exists(select 1 from public.ethical_boundary_determinations d
    where d.review_id=p_review_id and d.organization_id=v_org and d.boundary_key=k);
  if v_missing is not null then
    return jsonb_build_object('error','every governed ethical boundary requires a determination','missing',to_jsonb(v_missing));
  end if;
  if exists(select 1 from public.ethical_boundary_determinations d
    join public.evidence_items e on e.id=d.evidence_item_id and e.organization_id=v_org
    where d.review_id=p_review_id and d.organization_id=v_org
      and (e.verification_status<>'verified' or e.verified_by is null
        or e.verified_by=d.assessed_by)) then
    return jsonb_build_object('error','every determination requires currently verified evidence independently verified from its assessor');
  end if;
  select count(*) into v_gaps from public.ethical_boundary_determinations
    where review_id=p_review_id and organization_id=v_org and outcome='gap';
  perform set_config('app.ethical_boundary_write','granted',true);
  if v_gaps>0 then
    update public.ethical_boundary_reviews set status='remediation_required',
      submitted_by=auth.uid(),submitted_at=now(),updated_at=now() where id=p_review_id;
    for v_gap in select d.boundary_key,d.remediation,b.title from public.ethical_boundary_determinations d
      join public.ethical_boundary_definitions b using(boundary_key)
      where d.review_id=p_review_id and d.organization_id=v_org and d.outcome='gap'
    loop
      insert into public.recommendations(
        organization_id,title,issue,action,impact,confidence,urgency,status,
        approval_required,accountable,rationale,ethical_boundary_review_id,ethical_boundary_key)
      values(v_org,'Close ethical boundary gap — '||v_gap.title,
        'The governed ethical boundary review found a control gap.',v_gap.remediation,
        'A prohibited use or outcome remains possible until independently verified.',null,
        'action','pending','Independent accountable-owner approval is required.',
        'Named ethical-boundary control owner',btrim(p_basis),p_review_id,v_gap.boundary_key)
      on conflict (organization_id,ethical_boundary_review_id,ethical_boundary_key)
        where ethical_boundary_review_id is not null
      do update set title=excluded.title,issue=excluded.issue,action=excluded.action,
        impact=excluded.impact,status='pending',approval_required=excluded.approval_required,
        accountable=excluded.accountable,rationale=excluded.rationale,updated_at=now();
    end loop;
    insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'ethical_boundary_remediation_required',v_role,jsonb_build_object(
      'review_id',p_review_id,'gap_count',v_gaps,'basis',btrim(p_basis)));
    return jsonb_build_object('reviewId',p_review_id,'status','remediation_required','gapCount',v_gaps);
  end if;
  update public.ethical_boundary_reviews set status='review_pending',
    submitted_by=auth.uid(),submitted_at=now(),reviewed_by=null,reviewed_at=null,
    review_note=null,updated_at=now() where id=p_review_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'ethical_boundary_review_submitted',v_role,jsonb_build_object(
    'review_id',p_review_id,'boundary_count',v_boundary_count,'basis',btrim(p_basis),
    'independent_review_required',true));
  return jsonb_build_object('reviewId',p_review_id,'status','review_pending','boundaryCount',v_boundary_count);
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.review_ethical_boundaries(
  p_review_id uuid,p_decision text,p_review_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_review public.ethical_boundary_reviews%rowtype; v_status text;
begin
  if v_org is null or v_role not in ('admin','executive') then
    return jsonb_build_object('error','independent review requires an administrator or executive');
  end if;
  if p_decision not in ('approved','rejected') or length(btrim(coalesce(p_review_note,'')))<20 then
    return jsonb_build_object('error','approved/rejected decision and substantive review note are required');
  end if;
  select * into v_review from public.ethical_boundary_reviews
    where id=p_review_id and organization_id=v_org and status='review_pending';
  if not found then return jsonb_build_object('error','review-pending ethical boundary review not found'); end if;
  if auth.uid()=v_review.created_by or auth.uid()=v_review.submitted_by then
    return jsonb_build_object('error','the author or submitter cannot perform independent ethical review');
  end if;
  if exists(select 1 from public.ethical_boundary_determinations
      where review_id=p_review_id and organization_id=v_org and assessed_by=auth.uid()) then
    return jsonb_build_object('error','a determination assessor cannot perform the independent ethical review');
  end if;
  if p_decision='approved' and (v_review.next_review_on<=current_date or exists(
    select 1 from public.ethical_boundary_determinations where review_id=p_review_id and outcome<>'enforced')) then
    return jsonb_build_object('error','adoption requires nine enforced boundaries and a future review date');
  end if;
  if p_decision='approved' and exists(select 1 from public.ethical_boundary_determinations d
    join public.evidence_items e on e.id=d.evidence_item_id and e.organization_id=v_org
    where d.review_id=p_review_id and d.organization_id=v_org
      and (e.verification_status<>'verified' or e.verified_by is null
        or e.verified_by=d.assessed_by)) then
    return jsonb_build_object('error','adoption requires currently verified evidence independently verified from every assessor');
  end if;
  v_status:=case when p_decision='approved' then 'adopted' else 'rejected' end;
  perform set_config('app.ethical_boundary_write','granted',true);
  if p_decision='approved' then
    update public.ethical_boundary_reviews set status='superseded',updated_at=now()
      where organization_id=v_org and status='adopted' and id<>p_review_id;
  end if;
  update public.ethical_boundary_reviews set status=v_status,reviewed_by=auth.uid(),
    reviewed_at=now(),review_note=btrim(p_review_note),updated_at=now() where id=p_review_id;
  if p_decision='approved' then
    update public.recommendations set status='dismissed',updated_at=now(),
      rationale=concat_ws(' ',nullif(btrim(rationale),''),
        'Closed by independent adoption of ethical-boundary review '||p_review_id||'.')
      where organization_id=v_org and ethical_boundary_review_id=p_review_id
        and status in ('pending','escalated','modified','approved');
  end if;
  insert into public.approvals(organization_id,status,owner_role,approver,reason,
    consequence_of_wrong,required_validation,decided_at,ethical_boundary_review_id)
  values(v_org,p_decision,v_role,auth.uid()::text,btrim(p_review_note),
    'A false ethical assurance can permit unsafe, discriminatory, manipulative, intrusive or unaccountable use.',
    'Independent review of all nine same-tenant evidence-backed boundary determinations.',now(),p_review_id);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'ethical_boundary_reviewed',v_role,jsonb_build_object(
    'review_id',p_review_id,'decision',p_decision,'status',v_status,
    'automation_authority',false));
  return jsonb_build_object('reviewId',p_review_id,'decision',p_decision,'status',v_status,
    'automationAuthority',false);
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.get_ethical_boundary_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'boundaries',(select jsonb_agg(jsonb_build_object(
      'key',b.boundary_key,'title',b.title,'prohibition',b.prohibition,
      'controlFamily',b.control_family,'verificationRequirement',b.verification_requirement,
      'platformControlReference',b.platform_control_reference,'version',b.version) order by b.boundary_key)
      from public.ethical_boundary_definitions b),
    'people',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',coalesce(nullif(p.full_name,''),p.email,p.id::text),'role',p.role)
      order by coalesce(nullif(p.full_name,''),p.email,p.id::text))
      from public.user_profiles p where p.organization_id=v_org),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',e.description,'sourceSystem',e.source_system,
      'evidenceType',e.evidence_type,'verifiedBy',e.verified_by,'verifiedAt',e.verified_at,
      'qualityGrade',e.quality_grade,'timestamp',e.ts) order by e.created_at desc)
      from (select * from public.evidence_items where organization_id=v_org
        and verification_status='verified' and verified_by is not null
        order by created_at desc limit 200) e),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'title',r.title,'scope',r.scope,'purpose',r.purpose,
      'effectiveOn',r.effective_on,'nextReviewOn',r.next_review_on,'status',r.status,
      'current',r.status='adopted' and r.next_review_on>current_date,
      'createdBy',r.created_by,'submittedBy',r.submitted_by,'reviewedBy',r.reviewed_by,
      'reviewedAt',r.reviewed_at,'reviewNote',r.review_note,
      'determinations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',d.id,'boundaryKey',d.boundary_key,'outcome',d.outcome,
        'controlDescription',d.control_description,'verificationProcedure',d.verification_procedure,
        'evidenceItemId',d.evidence_item_id,'accountableOwnerId',d.accountable_owner_id,
        'accountableOwner',coalesce(p.full_name,p.email,d.accountable_owner_id::text),
        'remediation',d.remediation,'assessedBy',d.assessed_by,'assessedAt',d.assessed_at)
        order by d.boundary_key) from public.ethical_boundary_determinations d
        left join public.user_profiles p on p.id=d.accountable_owner_id
        where d.review_id=r.id),'[]'::jsonb)) order by r.created_at desc)
      from public.ethical_boundary_reviews r where r.organization_id=v_org),'[]'::jsonb),
    'basis','A current posture requires all nine prohibitions, same-tenant verified evidence, named owners and independent human adoption. The register proves reviewed controls; it does not infer ethical behavior from product use or grant automated authority.'
  );
end $$;

revoke all on function public.ethical_boundary_author_role(text) from public,anon;
revoke all on function public.create_ethical_boundary_review(jsonb) from public,anon;
revoke all on function public.set_ethical_boundary_determination(uuid,jsonb) from public,anon;
revoke all on function public.submit_ethical_boundary_review(uuid,text) from public,anon;
revoke all on function public.review_ethical_boundaries(uuid,text,text) from public,anon;
revoke all on function public.get_ethical_boundary_workspace() from public,anon;
grant execute on function public.create_ethical_boundary_review(jsonb) to authenticated;
grant execute on function public.set_ethical_boundary_determination(uuid,jsonb) to authenticated;
grant execute on function public.submit_ethical_boundary_review(uuid,text) to authenticated;
grant execute on function public.review_ethical_boundaries(uuid,text,text) to authenticated;
grant execute on function public.get_ethical_boundary_workspace() to authenticated;

notify pgrst,'reload schema';
