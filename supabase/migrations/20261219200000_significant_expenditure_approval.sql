-- C5.16 — significant expenditure approval.
--
-- An approval in SyncAI authorizes a bounded commitment; it never creates a
-- purchase order, pays a supplier, or posts to a financial system.  The money
-- gate uses the canonical authority_limits store and the canonical approvals
-- trail.  Missing, blank, differently-denominated, out-of-scope, and exceeded
-- delegations all refuse.

alter table public.authority_limits
  drop constraint if exists authority_limits_action_type_check;
alter table public.authority_limits
  add constraint authority_limits_action_type_check
    check (action_type in ('general','sanction','regulatory_variance',
                           'gate_requirement_waiver','contingency_drawdown',
                           'change_approval','contract_award','commit_expenditure'));

insert into public.authority_limits
  (organization_id,role_key,tier_label,action_type,max_commitment_usd,
   max_risk_level,escalates_to_role,basis)
select o.id,v.role_key,v.tier_label,'commit_expenditure',null,v.risk,v.escalates,v.basis
from public.organizations o
cross join (values
  ('maintenance_manager','Budget holder','Medium','executive',
   'Proposed expenditure delegation. The amount is deliberately blank until a human states the organization-owned ceiling.'),
  ('executive','Executive','High','board',
   'Proposed executive expenditure delegation. State and independently adopt the organization-owned ceiling before use.'),
  ('board','Board','Critical',null,
   'Proposed top expenditure delegation. State and independently adopt the board-owned ceiling before use.')
) as v(role_key,tier_label,risk,escalates,basis)
where not exists (
  select 1 from public.authority_limits al
  where al.organization_id=o.id and al.role_key=v.role_key
    and al.action_type='commit_expenditure'
);

-- Extend the live money-delegation rules without reverting later hardening.
do $money$
declare v_def text; v_new text; v_fn text;
begin
  foreach v_fn in array array['adopt_authority_limit','state_authority_ceiling'] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_fn;
    if v_def is null then
      raise exception '% is missing; C5.16 will not create a parallel authority system',v_fn
        using errcode='check_violation';
    end if;
    if position('commit_expenditure' in v_def)>0 then continue; end if;
    v_new:=replace(v_def,
      $old$('contingency_drawdown','change_approval','contract_award')$old$,
      $new$('contingency_drawdown','change_approval','contract_award','commit_expenditure')$new$);
    -- Contract award extended the self-adoption and stated-ceiling clauses,
    -- but its migration did not extend this separate v_money predicate. Close
    -- that inherited AI-adoption hole while adding the new money act.
    if v_fn='adopt_authority_limit' then
      v_new:=replace(v_new,
        $old$v_money := l.action_type in ('contingency_drawdown','change_approval','sanction');$old$,
        $new$v_money := l.action_type in ('contingency_drawdown','change_approval','contract_award','commit_expenditure','sanction');$new$);
      if position($needle$v_money := l.action_type in ('contingency_drawdown','change_approval','contract_award','commit_expenditure','sanction');$needle$ in v_new)=0 then
        raise exception 'money predicate anchor moved in adopt_authority_limit; refusing to leave AI adoption open'
          using errcode='check_violation';
      end if;
    end if;
    if v_new=v_def then
      raise exception 'money-action anchor moved in %; refusing a blind authority change',v_fn
        using errcode='check_violation';
    end if;
    execute v_new;
  end loop;
end $money$;

do $screen$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_authority_delegations';
  if v_def is null then raise exception 'get_authority_delegations is missing'; end if;
  if position('commit_expenditure' in v_def)=0 then
    v_new:=replace(v_def,
      $old$al.action_type in ('contingency_drawdown','change_approval','contract_award')$old$,
      $new$al.action_type in ('contingency_drawdown','change_approval','contract_award','commit_expenditure')$new$);
    if v_new=v_def then
      raise exception 'delegation-screen anchor moved; the screen and money door must remain identical'
        using errcode='check_violation';
    end if;
    execute v_new;
  end if;
end $screen$;

create table if not exists public.expenditure_commitments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organization_node_id uuid references public.organizations(id) on delete restrict,
  title text not null check (length(btrim(title)) between 5 and 160),
  purpose text not null check (length(btrim(purpose)) between 20 and 4000),
  evidence_basis text not null check (length(btrim(evidence_basis)) between 20 and 4000),
  consequence_of_wrong text not null check (length(btrim(consequence_of_wrong)) between 20 and 2000),
  amount numeric not null check (amount>0 and amount<>'NaN'::numeric
    and amount<>'Infinity'::numeric and amount<>'-Infinity'::numeric),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  approval_id uuid references public.approvals(id) on delete restrict,
  authority_limit_id uuid references public.authority_limits(id) on delete restrict,
  authority_ceiling numeric,
  authority_currency text,
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  register_ref text not null default 'C5.16',
  check ((status='pending' and decided_by is null and decided_at is null)
      or (status in ('approved','rejected') and decided_by is not null and decided_at is not null)),
  check (status='pending' or
    (authority_limit_id is not null and authority_ceiling is not null and authority_currency is not null))
);

comment on table public.expenditure_commitments is
  'C5.16: a proposed material financial commitment and its governed human decision. Approved means authorized within the quoted delegation; it does not execute procurement, payment, or a ledger posting.';

alter table public.approvals
  add column if not exists expenditure_commitment_id uuid
    references public.expenditure_commitments(id) on delete restrict;
create unique index if not exists idx_expenditure_commitment_approval
  on public.approvals(expenditure_commitment_id)
  where expenditure_commitment_id is not null;
create unique index if not exists idx_expenditure_approval_backref
  on public.expenditure_commitments(approval_id)
  where approval_id is not null;
create index if not exists idx_expenditure_commitment_queue
  on public.expenditure_commitments(organization_id,status,requested_at desc);

alter table public.expenditure_commitments enable row level security;
revoke all on table public.expenditure_commitments from public,anon,authenticated;
grant select on table public.expenditure_commitments to authenticated;
drop policy if exists expenditure_commitments_read on public.expenditure_commitments;
create policy expenditure_commitments_read on public.expenditure_commitments
  for select to authenticated using (organization_id=public.app_current_org());

-- Generic approval mutation may not decide this money workflow around its
-- amount, currency, independence, and delegation checks.
drop policy if exists approvals_expenditure_sensitive on public.approvals;
create policy approvals_expenditure_sensitive on public.approvals as restrictive
  for all to authenticated using (true)
  with check (expenditure_commitment_id is null);

create or replace function public.guard_expenditure_commitment_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if current_setting('syncai.expenditure_workflow',true) is distinct from '1' then
    raise exception 'expenditure commitments change only through the governed workflow'
      using errcode='insufficient_privilege';
  end if;
  if new.organization_node_id is not null and
     not public.org_node_in_scope(new.organization_node_id,new.organization_id) then
    raise exception 'expenditure scope is outside the organization' using errcode='check_violation';
  end if;
  if new.approval_id is not null and not exists (
    select 1 from public.approvals a where a.id=new.approval_id
      and a.organization_id=new.organization_id
      and a.expenditure_commitment_id=new.id
  ) then
    raise exception 'expenditure approval must be the canonical same-tenant approval back-reference'
      using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function public.guard_expenditure_commitment_write() from public,anon,authenticated;
drop trigger if exists trg_guard_expenditure_commitment on public.expenditure_commitments;
create trigger trg_guard_expenditure_commitment
before insert or update or delete on public.expenditure_commitments
for each row execute function public.guard_expenditure_commitment_write();

create or replace function public.sync_expenditure_authority(
  p_org uuid,p_org_node uuid,p_role text,p_amount numeric,p_currency text
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare l public.authority_limits%rowtype; v_amount numeric:=abs(coalesce(p_amount,0));
begin
  select al.* into l from public.authority_limits al
  left join public.org_ancestry(p_org_node) anc on anc.node_id=al.org_node_id
  where al.organization_id=p_org and al.role_key=p_role
    and al.action_type='commit_expenditure' and al.status='adopted'
    and (al.org_node_id is null or (p_org_node is not null and anc.node_id is not null))
  order by (al.org_node_id is not null) desc,anc.depth asc nulls last,al.version desc limit 1;
  if not found then
    return jsonb_build_object('permitted',false,'refusal',format(
      'No adopted expenditure delegation covers role %s and this organization scope. Escalate or adopt a scoped delegation first.',coalesce(p_role,'unknown')));
  end if;
  if l.max_commitment_usd is null then
    return jsonb_build_object('permitted',false,'limitId',l.id,'refusal',
      'The adopted expenditure delegation has no stated money ceiling. Blank is unfinished, not unlimited.');
  end if;
  if upper(btrim(p_currency)) is distinct from l.max_commitment_currency then
    return jsonb_build_object('permitted',false,'limitId',l.id,'ceiling',l.max_commitment_usd,
      'ceilingCurrency',l.max_commitment_currency,'refusal',format(
      'The request is in %s and the delegation is in %s. SyncAI holds no exchange rate and will not compare unlike currencies.',
      upper(btrim(p_currency)),l.max_commitment_currency));
  end if;
  if v_amount>l.max_commitment_usd then
    return jsonb_build_object('permitted',false,'limitId',l.id,'ceiling',l.max_commitment_usd,
      'ceilingCurrency',l.max_commitment_currency,'escalatesTo',l.escalates_to_role,
      'refusal',format('%s %s exceeds the %s expenditure ceiling of %s %s for %s. Escalate to %s.',
       upper(btrim(p_currency)),v_amount,l.tier_label,l.max_commitment_currency,l.max_commitment_usd,p_role,
       coalesce(l.escalates_to_role,'the board')));
  end if;
  return jsonb_build_object('permitted',true,'limitId',l.id,'tierLabel',l.tier_label,
    'ceiling',l.max_commitment_usd,'ceilingCurrency',l.max_commitment_currency,
    'headroom',l.max_commitment_usd-v_amount,'escalatesTo',l.escalates_to_role);
end $$;
revoke all on function public.sync_expenditure_authority(uuid,uuid,text,numeric,text)
  from public,anon,authenticated,service_role;

create or replace function public.request_expenditure_commitment(p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid; v_approval uuid;
  v_amount numeric; v_currency text:=upper(btrim(coalesce(p_request->>'currency','')));
  v_node uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role is null then return jsonb_build_object('error','forbidden'); end if;
  if v_role='ai_admin' then return jsonb_build_object('error','An AI or system identity may prepare analysis but may not request or approve a financial commitment.'); end if;
  v_amount:=public.sync_finite_money(p_request->>'amount');
  if v_amount is null or v_amount<=0 then return jsonb_build_object('error','State a finite expenditure amount greater than zero.'); end if;
  if v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('error','State currency as a three-letter code such as CAD.'); end if;
  if coalesce(length(btrim(p_request->>'title')),0)<5 then return jsonb_build_object('error','State a title of at least 5 characters.'); end if;
  if coalesce(length(btrim(p_request->>'purpose')),0)<20 then return jsonb_build_object('error','State the business purpose in at least 20 characters.'); end if;
  if coalesce(length(btrim(p_request->>'evidence_basis')),0)<20 then return jsonb_build_object('error','State the supporting evidence in at least 20 characters.'); end if;
  if coalesce(length(btrim(p_request->>'consequence_of_wrong')),0)<20 then return jsonb_build_object('error','State the consequence of a wrong decision in at least 20 characters.'); end if;
  begin v_node:=nullif(p_request->>'organization_node_id','')::uuid;
  exception when invalid_text_representation then return jsonb_build_object('error','organization node is invalid'); end;
  perform set_config('syncai.expenditure_workflow','1',true);
  insert into public.expenditure_commitments(organization_id,organization_node_id,title,purpose,
    evidence_basis,consequence_of_wrong,amount,currency,requested_by)
  values(v_org,v_node,btrim(p_request->>'title'),btrim(p_request->>'purpose'),
    btrim(p_request->>'evidence_basis'),btrim(p_request->>'consequence_of_wrong'),v_amount,v_currency,auth.uid())
  returning id into v_id;
  insert into public.approvals(organization_id,status,owner_role,reason,consequence_of_wrong,
    required_validation,expenditure_commitment_id)
  values(v_org,'required','budget holder',format('%s — %s %s',btrim(p_request->>'title'),v_currency,v_amount),
    btrim(p_request->>'consequence_of_wrong'),
    'Independent named human; adopted commit_expenditure delegation covering the scope, amount, and currency.',v_id)
  returning id into v_approval;
  update public.expenditure_commitments set approval_id=v_approval where id=v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'expenditure_commitment',v_role,jsonb_build_object('action','requested','id',v_id,'approval_id',v_approval),
    jsonb_build_object('status','pending','amount',v_amount,'currency',v_currency,'requested_by',auth.uid()));
  return jsonb_build_object('commitment_id',v_id,'approval_id',v_approval,'status','pending',
    'amount',v_amount,'currency',v_currency,'execution','No purchase, payment, or ledger posting has occurred.');
end $$;
revoke all on function public.request_expenditure_commitment(jsonb) from public,anon,service_role;
grant execute on function public.request_expenditure_commitment(jsonb) to authenticated;

create or replace function public.decide_expenditure_commitment(
  p_id uuid,p_outcome text,p_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_email text;
  c public.expenditure_commitments%rowtype; a public.approvals%rowtype; v_auth jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role,email into v_role,v_email from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role is null then return jsonb_build_object('error','forbidden'); end if;
  if v_role='ai_admin' then return jsonb_build_object('error','Spec §70: an AI or system identity may not commit funds or approve expenditure.'); end if;
  if p_outcome not in ('approved','rejected') then return jsonb_build_object('error','outcome must be approved or rejected'); end if;
  if coalesce(length(btrim(p_note)),0)<20 then return jsonb_build_object('error','Record the decision basis in at least 20 characters.'); end if;
  select * into c from public.expenditure_commitments where id=p_id and organization_id=v_org for update;
  if c.id is null then return jsonb_build_object('error','pending expenditure commitment not found'); end if;
  if c.status<>'pending' then return jsonb_build_object('error',format('expenditure commitment is already %s',c.status)); end if;
  if c.requested_by=auth.uid() then return jsonb_build_object('error','The requester may not approve or reject their own expenditure request. Route it to an independent budget holder.'); end if;
  select * into a from public.approvals where id=c.approval_id and organization_id=v_org
    and expenditure_commitment_id=c.id for update;
  if a.id is null or a.status not in ('required','pending') then return jsonb_build_object('error','The canonical pending approval link is missing or already decided.'); end if;
  v_auth:=public.sync_expenditure_authority(v_org,c.organization_node_id,v_role,c.amount,c.currency);
  if not coalesce((v_auth->>'permitted')::boolean,false) then
    insert into public.security_events
      (organization_id,event_type,severity,actor_id,actor_label,detail)
    values(v_org,'admin_action','warning',auth.uid(),coalesce(v_email,v_role),format(
      'Expenditure commitment %s (%s %s) refused for role %s: %s',
      c.id,c.currency,c.amount,v_role,v_auth->>'refusal'));
    return v_auth || jsonb_build_object('error',v_auth->>'refusal','commitment_id',c.id);
  end if;
  perform set_config('syncai.expenditure_workflow','1',true);
  update public.approvals set status=p_outcome,approver=coalesce(v_email,auth.uid()::text),
    approver_user_id=auth.uid(),decided_at=now(),approval_scope=jsonb_build_object(
      'authority_limit_id',v_auth->>'limitId','amount',c.amount,'currency',c.currency,'decision_note',btrim(p_note))
  where id=a.id;
  update public.expenditure_commitments set status=p_outcome,
    authority_limit_id=(v_auth->>'limitId')::uuid,authority_ceiling=(v_auth->>'ceiling')::numeric,
    authority_currency=v_auth->>'ceilingCurrency',decided_by=auth.uid(),decided_at=now(),decision_note=btrim(p_note)
  where id=c.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'expenditure_commitment',v_role,jsonb_build_object('action',p_outcome,'id',c.id,
    'approval_id',a.id,'authority_limit_id',v_auth->>'limitId'),jsonb_build_object('status','pending'),
    jsonb_build_object('status',p_outcome,'amount',c.amount,'currency',c.currency,
      'ceiling',v_auth->>'ceiling','ceiling_currency',v_auth->>'ceilingCurrency','decided_by',auth.uid(),'note',btrim(p_note)));
  return jsonb_build_object('commitment_id',c.id,'approval_id',a.id,'status',p_outcome,
    'amount',c.amount,'currency',c.currency,'authority',v_auth,
    'execution','No purchase, payment, or ledger posting has occurred.');
end $$;
revoke all on function public.decide_expenditure_commitment(uuid,text,text) from public,anon,service_role;
grant execute on function public.decide_expenditure_commitment(uuid,text,text) to authenticated;

create or replace function public.get_expenditure_approval_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_rows jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role is null then return jsonb_build_object('error','forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'purpose',c.purpose,
    'evidenceBasis',c.evidence_basis,'consequenceOfWrong',c.consequence_of_wrong,
    'amount',c.amount,'currency',c.currency,'status',c.status,'requestedBy',rp.email,
    'requestedAt',c.requested_at,'approvalId',c.approval_id,'decidedBy',dp.email,'decidedAt',c.decided_at,
    'decisionNote',c.decision_note,'authorityLimitId',c.authority_limit_id,
    'authorityCeiling',c.authority_ceiling,'authorityCurrency',c.authority_currency,
    'isOwnRequest',c.requested_by=auth.uid()) order by c.requested_at desc),'[]'::jsonb)
  into v_rows from public.expenditure_commitments c
  left join public.user_profiles rp on rp.id=c.requested_by
  left join public.user_profiles dp on dp.id=c.decided_by
  where c.organization_id=v_org;
  return jsonb_build_object('commitments',v_rows,'callerRole',v_role,'canRequest',v_role<>'ai_admin',
    'control','Approval authorizes only this bounded commitment. SyncAI does not create a purchase order, pay a supplier, or post a ledger entry.',
    'delegations',public.get_authority_delegations('commit_expenditure'));
end $$;
revoke all on function public.get_expenditure_approval_workspace() from public,anon,service_role;
grant execute on function public.get_expenditure_approval_workspace() to authenticated;

update public.decision_rights set enforcement='enforced'
where right_key='commit_expenditure' and register_ref='C5.16';
