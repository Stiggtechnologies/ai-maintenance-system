-- E5.07 — governed data-loss prevention for supported tenant AI egress.
--
-- This migration extends THE canonical data_egress_rules register. It does not
-- create a second policy store or a second audit ledger. Every supported
-- server-side model call must obtain a decision here before opening the
-- provider connection. Missing, draft, rejected, stale, mismatched and
-- redaction-incomplete rules all deny by default.

alter table public.data_egress_rules
  add column if not exists version integer not null default 1,
  add column if not exists allowed_purposes text[] not null default array['model_inference']::text[],
  add column if not exists rule_status text not null default 'legacy_unverified',
  add column if not exists proposed_by uuid references auth.users(id) on delete set null,
  add column if not exists proposed_at timestamptz,
  add column if not exists proposal_reason text,
  add column if not exists decided_by uuid references auth.users(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_reason text,
  add column if not exists supersedes_rule_id bigint references public.data_egress_rules(id) on delete restrict,
  add column if not exists superseded_by_rule_id bigint references public.data_egress_rules(id) on delete restrict;

update public.data_egress_rules
set rule_status='legacy_unverified',
    proposed_at=coalesce(proposed_at,created_at),
    proposal_reason=coalesce(proposal_reason,'Legacy row retained for history; independent governed adoption required.'),
    decided_by=coalesce(decided_by,approved_by),
    decided_at=coalesce(decided_at,approved_at),
    decision_reason=coalesce(decision_reason,'Legacy approval cannot satisfy the governed DLP ratchet.')
where proposed_at is null or rule_status='legacy_unverified';

drop index if exists public.idx_egress_pair;
create unique index if not exists idx_data_egress_rule_version
  on public.data_egress_rules(organization_id,destination,data_class,version);
create unique index if not exists idx_data_egress_current_rule
  on public.data_egress_rules(organization_id,destination,data_class)
  where rule_status='adopted' and superseded_by_rule_id is null;
create index if not exists idx_data_egress_pending
  on public.data_egress_rules(organization_id,rule_status,created_at desc);

do $$ begin
  alter table public.data_egress_rules
    add constraint data_egress_rule_status_check check (
      rule_status in ('legacy_unverified','proposed','adopted','rejected','superseded'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.data_egress_rules
    add constraint data_egress_rule_version_check check (version > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.data_egress_rules
    add constraint data_egress_rule_purposes_check check (
      cardinality(allowed_purposes) > 0
      and allowed_purposes <@ array[
        'model_inference','embedding','document_extraction','realtime_voice',
        'speech_synthesis','onboarding_enrichment','agent_enrichment'
      ]::text[]);
exception when duplicate_object then null; end $$;

create or replace function public.guard_data_egress_rule_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if current_setting('app.data_egress_rule_writer',true)<>'governed' then
    raise exception 'Data egress rules require the governed proposal and independent review workflow';
  end if;
  if tg_op='DELETE' then
    raise exception 'Data egress rules are retained; supersede them instead of deleting them';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_data_egress_rule_write on public.data_egress_rules;
create trigger trg_guard_data_egress_rule_write
before insert or update or delete on public.data_egress_rules
for each row execute function public.guard_data_egress_rule_write();

revoke insert,update,delete on public.data_egress_rules from anon,authenticated,service_role;

create or replace function public.get_data_egress_rules()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in ('admin','executive','reliability_engineer') then
    return jsonb_build_object('error','An assured administrator, executive or reliability engineer is required');
  end if;
  return jsonb_build_object(
    'rules',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'version',r.version,
        'destination',r.destination,'destinationKind',r.destination_kind,
        'dataClass',r.data_class,'allowedPurposes',r.allowed_purposes,
        'permitted',r.permitted,'redactionRequired',r.redaction_required,
        'basis',r.basis,'status',r.rule_status,
        'proposedBy',r.proposed_by,
        'proposedByLabel',(select coalesce(p.full_name,p.email) from public.user_profiles p where p.id=r.proposed_by),
        'proposedAt',r.proposed_at,'proposalReason',r.proposal_reason,
        'decidedBy',r.decided_by,
        'decidedByLabel',(select coalesce(p.full_name,p.email) from public.user_profiles p where p.id=r.decided_by),
        'decidedAt',r.decided_at,'decisionReason',r.decision_reason,
        'supersedesRuleId',r.supersedes_rule_id,
        'supersededByRuleId',r.superseded_by_rule_id)
        order by r.destination,r.data_class,r.version desc)
      from public.data_egress_rules r where r.organization_id=v_org),
      '[]'::jsonb),
    'boundary','Rules govern supported server-mediated tenant AI-provider egress only. They do not authorize plant action or certify destination security.'
  );
end;
$$;

create or replace function public.propose_data_egress_rule(
  p_destination text,
  p_destination_kind text,
  p_data_class text,
  p_allowed_purposes text[],
  p_permitted boolean,
  p_redaction_required boolean,
  p_basis text,
  p_supersedes_rule_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  v_destination text := lower(btrim(coalesce(p_destination,'')));
  v_purposes text[];
  v_version integer;
  v_id bigint;
  v_current public.data_egress_rules%rowtype;
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_org is null or v_uid is null or coalesce(v_role,'') not in ('admin','executive') then
    return jsonb_build_object('error','An assured named administrator or executive is required');
  end if;
  if v_destination !~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
     or position('.' in v_destination)=0 then
    return jsonb_build_object('error','Destination must be one exact lowercase provider hostname, without scheme, path or wildcard');
  end if;
  if p_destination_kind not in ('llm_gateway','analytics','vendor_support','regulator','corporate_it','other') then
    return jsonb_build_object('error','Unrecognized destination kind');
  end if;
  if p_data_class not in ('operational','personal','commercial','safety_critical','security_sensitive') then
    return jsonb_build_object('error','Unrecognized data class');
  end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into v_purposes
  from unnest(coalesce(p_allowed_purposes,'{}'::text[])) x
  where x=any(array[
    'model_inference','embedding','document_extraction','realtime_voice',
    'speech_synthesis','onboarding_enrichment','agent_enrichment']);
  if cardinality(v_purposes)=0 or cardinality(v_purposes)<>cardinality(p_allowed_purposes) then
    return jsonb_build_object('error','Select one or more recognized, non-duplicated purposes');
  end if;
  if length(btrim(coalesce(p_basis,'')))<30 then
    return jsonb_build_object('error','State a destination, purpose, data handling and residual-risk basis of at least 30 characters');
  end if;
  if exists(select 1 from public.data_egress_rules r
            where r.organization_id=v_org and r.destination=v_destination
              and r.data_class=p_data_class and r.rule_status='proposed') then
    return jsonb_build_object('error','Decide the current proposal for this destination and data class first');
  end if;
  select * into v_current from public.data_egress_rules r
  where r.organization_id=v_org and r.destination=v_destination
    and r.data_class=p_data_class and r.rule_status='adopted'
    and r.superseded_by_rule_id is null for update;
  if found and (p_supersedes_rule_id is null or p_supersedes_rule_id<>v_current.id) then
    return jsonb_build_object('error','A revision must explicitly supersede the exact current rule');
  end if;
  if not found and p_supersedes_rule_id is not null then
    return jsonb_build_object('error','No current rule exists to supersede for this exact destination and data class');
  end if;
  select coalesce(max(version),0)+1 into v_version
  from public.data_egress_rules r
  where r.organization_id=v_org and r.destination=v_destination and r.data_class=p_data_class;

  perform set_config('app.data_egress_rule_writer','governed',true);
  insert into public.data_egress_rules(
    organization_id,destination,destination_kind,data_class,permitted,
    redaction_required,basis,version,allowed_purposes,rule_status,
    proposed_by,proposed_at,proposal_reason,supersedes_rule_id)
  values(v_org,v_destination,p_destination_kind,p_data_class,p_permitted,
    p_redaction_required,btrim(p_basis),v_version,v_purposes,'proposed',
    v_uid,now(),btrim(p_basis),p_supersedes_rule_id)
  returning id into v_id;
  perform set_config('app.data_egress_rule_writer','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'data_egress_rule',v_role,jsonb_build_object(
    'event','data_egress_rule_proposed','rule_id',v_id,'version',v_version,
    'destination',v_destination,'data_class',p_data_class,'purposes',v_purposes,
    'permitted',p_permitted,'redaction_required',p_redaction_required,
    'proposed_by',v_uid,'operational_authority',false));
  insert into public.security_events(
    organization_id,actor_id,actor_label,event_type,severity,detail)
  values(v_org,v_uid,(select coalesce(full_name,email) from public.user_profiles where id=v_uid),
    'admin_action','notice','Proposed DLP rule version '||v_version||' for '||v_destination||' / '||p_data_class);

  return jsonb_build_object('ruleId',v_id,'version',v_version,'status','proposed',
    'independentReviewRequired',true,'operationalAuthority',false);
exception when others then
  perform set_config('app.data_egress_rule_writer','',true);
  raise;
end;
$$;

create or replace function public.decide_data_egress_rule(
  p_rule_id bigint,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  v_rule public.data_egress_rules%rowtype;
  v_current public.data_egress_rules%rowtype;
  v_status text;
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_org is null or v_uid is null or coalesce(v_role,'') not in ('admin','executive') then
    return jsonb_build_object('error','An assured named administrator or executive is required');
  end if;
  if p_decision not in ('adopt','reject') then
    return jsonb_build_object('error','Decision must be adopt or reject');
  end if;
  if length(btrim(coalesce(p_reason,'')))<30 then
    return jsonb_build_object('error','State an independent decision and residual-risk basis of at least 30 characters');
  end if;
  select * into v_rule from public.data_egress_rules
  where id=p_rule_id and organization_id=v_org and rule_status='proposed' for update;
  if not found then
    return jsonb_build_object('error','Proposed data egress rule not found in this tenant');
  end if;
  if v_rule.proposed_by=v_uid then
    return jsonb_build_object('error','The proposer cannot independently adopt or reject the same data egress rule');
  end if;
  if not public.app_actor_has_verified_mfa(v_uid) or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','Data egress disposition requires a verified factor and an AAL2 session');
  end if;
  if p_decision='adopt' then
    select * into v_current from public.data_egress_rules r
    where r.organization_id=v_org and r.destination=v_rule.destination
      and r.data_class=v_rule.data_class and r.rule_status='adopted'
      and r.superseded_by_rule_id is null for update;
    if found and v_rule.supersedes_rule_id is distinct from v_current.id then
      return jsonb_build_object('error','The proposal no longer supersedes the exact current rule; submit a new revision');
    end if;
    if not found and v_rule.supersedes_rule_id is not null then
      return jsonb_build_object('error','The rule selected for supersession is no longer current');
    end if;
  end if;

  v_status := case when p_decision='adopt' then 'adopted' else 'rejected' end;
  perform set_config('app.data_egress_rule_writer','governed',true);
  if p_decision='adopt' and v_current.id is not null then
    update public.data_egress_rules set
      rule_status='superseded',superseded_by_rule_id=v_rule.id
    where id=v_current.id;
  end if;
  update public.data_egress_rules set
    rule_status=v_status,decided_by=v_uid,decided_at=now(),
    decision_reason=btrim(p_reason),
    approved_by=case when p_decision='adopt' then v_uid else null end,
    approved_at=case when p_decision='adopt' then now() else null end
  where id=v_rule.id;
  perform set_config('app.data_egress_rule_writer','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'data_egress_rule',v_role,jsonb_build_object(
    'event','data_egress_rule_'||v_status,'rule_id',v_rule.id,
    'version',v_rule.version,'destination',v_rule.destination,
    'data_class',v_rule.data_class,'decision',p_decision,
    'proposed_by',v_rule.proposed_by,'decided_by',v_uid,
    'segregation_of_duties',true,'aal','aal2','verified_factor',true,
    'operational_authority',false));
  insert into public.security_events(
    organization_id,actor_id,actor_label,event_type,severity,detail)
  values(v_org,v_uid,(select coalesce(full_name,email) from public.user_profiles where id=v_uid),
    'admin_action','warning','DLP rule version '||v_rule.version||' for '||v_rule.destination||' '||v_status);

  return jsonb_build_object('ruleId',v_rule.id,'version',v_rule.version,
    'status',v_status,'segregationOfDuties',true,'operationalAuthority',false);
exception when others then
  perform set_config('app.data_egress_rule_writer','',true);
  raise;
end;
$$;

create or replace function public.evaluate_data_egress(
  p_organization_id uuid,
  p_destination text,
  p_data_class text,
  p_purpose text,
  p_redaction_applied boolean,
  p_actor_id uuid,
  p_actor_label text,
  p_channel text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_rule public.data_egress_rules%rowtype;
  v_allowed boolean := false;
  v_reason text := 'no_current_rule';
begin
  select der.* into v_rule from public.data_egress_rules der
  where der.organization_id=p_organization_id
    and der.destination=p_destination
    and der.data_class=p_data_class
    and p_purpose=any(der.allowed_purposes)
    and der.rule_status='adopted'
    and der.superseded_by_rule_id is null
  order by der.version desc limit 1;

  if not found then
    v_reason := 'no_current_matching_rule';
  elsif not v_rule.permitted then
    v_reason := 'current_rule_denies';
  elsif v_rule.redaction_required and not p_redaction_applied then
    v_reason := 'required_redaction_not_applied';
  else
    v_allowed := true;
    v_reason := 'current_rule_allows';
  end if;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(p_organization_id,'data_egress_decision',left(coalesce(p_actor_label,p_channel,'unknown'),200),
    jsonb_build_object('event','data_egress_decision','allowed',v_allowed,
      'reason',v_reason,'rule_id',v_rule.id,'rule_version',v_rule.version,
      'destination',p_destination,'data_class',p_data_class,
      'purpose',p_purpose,'redaction_applied',p_redaction_applied,
      'channel',p_channel,'operational_authority',false));
  insert into public.security_events(
    organization_id,actor_id,actor_label,event_type,severity,detail)
  values(p_organization_id,p_actor_id,left(p_actor_label,400),
    case when v_allowed then 'data_egress_allowed' else 'data_egress_denied' end,
    case when v_allowed then 'info' else 'warning' end,
    left('destination='||p_destination||'; class='||p_data_class||'; purpose='||p_purpose||'; reason='||v_reason,2000));

  return jsonb_build_object('allowed',v_allowed,'reason',v_reason,
    'ruleId',v_rule.id,'ruleVersion',v_rule.version,
    'redactionRequired',coalesce(v_rule.redaction_required,false),
    'operationalAuthority',false);
end;
$$;

create or replace function public.authorize_data_egress(
  p_destination text,
  p_data_class text,
  p_purpose text,
  p_redaction_applied boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_label text;
begin
  if v_org is null or v_uid is null then
    return jsonb_build_object('allowed',false,'reason','assured_tenant_session_required');
  end if;
  select coalesce(full_name,email) into v_label from public.user_profiles
  where id=v_uid and organization_id=v_org;
  return public.evaluate_data_egress(v_org,lower(btrim(p_destination)),p_data_class,
    p_purpose,coalesce(p_redaction_applied,false),v_uid,v_label,'authenticated');
end;
$$;

create or replace function public.authorize_service_data_egress(
  p_organization_id uuid,
  p_destination text,
  p_data_class text,
  p_purpose text,
  p_redaction_applied boolean default false,
  p_service_label text default 'edge-function'
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
begin
  if auth.role()<>'service_role' then
    return jsonb_build_object('allowed',false,'reason','service_role_required');
  end if;
  if not exists(select 1 from public.organizations where id=p_organization_id) then
    return jsonb_build_object('allowed',false,'reason','tenant_not_found');
  end if;
  return public.evaluate_data_egress(p_organization_id,lower(btrim(p_destination)),
    p_data_class,p_purpose,coalesce(p_redaction_applied,false),null,
    left(coalesce(p_service_label,'edge-function'),400),'service');
end;
$$;

revoke all on function public.guard_data_egress_rule_write() from public,anon,authenticated,service_role;
revoke all on function public.get_data_egress_rules() from public,anon;
revoke all on function public.propose_data_egress_rule(text,text,text,text[],boolean,boolean,text,bigint) from public,anon;
revoke all on function public.decide_data_egress_rule(bigint,text,text) from public,anon;
revoke all on function public.evaluate_data_egress(uuid,text,text,text,boolean,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.authorize_data_egress(text,text,text,boolean) from public,anon,service_role;
revoke all on function public.authorize_service_data_egress(uuid,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.get_data_egress_rules() to authenticated;
grant execute on function public.propose_data_egress_rule(text,text,text,text[],boolean,boolean,text,bigint) to authenticated;
grant execute on function public.decide_data_egress_rule(bigint,text,text) to authenticated;
grant execute on function public.authorize_data_egress(text,text,text,boolean) to authenticated;
grant execute on function public.authorize_service_data_egress(uuid,text,text,text,boolean,text) to service_role;

comment on table public.data_egress_rules is
  'Canonical versioned tenant DLP register. One named human proposes; a different verified AAL2 human adopts. Exact current rules fail closed at supported server-mediated AI egress.';
comment on function public.authorize_service_data_egress(uuid,text,text,text,boolean,text) is
  'Service-only fail-closed authorization for supported tenant AI-provider egress. It records destination/class/purpose decisions but never payload content.';

notify pgrst,'reload schema';
