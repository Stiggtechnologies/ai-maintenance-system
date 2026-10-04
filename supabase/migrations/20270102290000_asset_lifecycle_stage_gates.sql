-- U4.11 / U4.12 / U4.14 — governed lifecycle stage-gate execution.
--
-- Canonical reuse only. Asset gate determinations remain in
-- stage_gate_reviews/findings, economic basis remains in lifecycle_evaluations,
-- movement remains in asset_lifecycle_state/transitions, proof remains in
-- evidence_items, and physical closeout remains in disposal_records.
-- Exact canonical write/audit chain: public.asset_lifecycle_transitions is
-- still populated by the established internal transition implementation.

alter table public.stage_gate_reviews
  add column if not exists target_stage_key text
    references public.lifecycle_stages(stage_key) on delete restrict;

alter table public.stage_gate_findings
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict;

alter table public.disposal_records
  add column if not exists currency text,
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id) on delete restrict,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists version integer not null default 1;

alter table public.disposal_records
  drop constraint if exists disposal_records_currency_shape;
alter table public.disposal_records
  add constraint disposal_records_currency_shape check (
    currency is null or currency ~ '^[A-Z]{3}$'
  );
alter table public.disposal_records
  drop constraint if exists disposal_records_financial_currency;
alter table public.disposal_records
  add constraint disposal_records_financial_currency check (
    (recovered_value is null and disposal_cost is null) or currency is not null
  );
alter table public.disposal_records
  drop constraint if exists disposal_records_nonnegative_values;
alter table public.disposal_records
  add constraint disposal_records_nonnegative_values check (
    coalesce(recovered_value,0)>=0 and coalesce(disposal_cost,0)>=0
  );

create or replace function public.guard_asset_disposal_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' and not exists(
    select 1 from public.assets where id=old.asset_id
  ) then return old; end if;
  if coalesce(current_setting('app.asset_disposal_writer',true),'')<>'governed' then
    raise exception 'asset disposal records are RPC-only';
  end if;
  if tg_op='UPDATE' and (
    new.asset_id<>old.asset_id or new.organization_id<>old.organization_id
  ) then raise exception 'asset disposal identity and tenant are immutable'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_asset_disposal_write on public.disposal_records;
create trigger trg_guard_asset_disposal_write
  before insert or update or delete on public.disposal_records
  for each row execute function public.guard_asset_disposal_write();

revoke all on function public.guard_asset_disposal_write()
  from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.disposal_records
  from anon,authenticated,service_role;

-- The RPC is the readable door; this deferred persistence wall protects the
-- same asset-review invariants from audited service/backfill writes and later
-- child-row edits. It is deferred because the review is inserted before its
-- complete finding set in the governed transaction.
create or replace function public.enforce_asset_lifecycle_review_integrity()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_review_id bigint:=case when tg_table_name='stage_gate_reviews'
    then case when tg_op='DELETE' then old.id else new.id end
    else case when tg_op='DELETE' then old.review_id else new.review_id end end;
  r public.stage_gate_reviews%rowtype;
  v_criteria integer;
  v_findings integer;
  v_unique integer;
  v_bad integer;
begin
  select * into r from public.stage_gate_reviews where id=v_review_id;
  if not found or r.asset_id is null or r.development_case_id is not null
     or r.target_stage_key is null then return null; end if;

  select count(*) into v_criteria from public.stage_gate_criteria c
  where c.organization_id=r.organization_id and c.stage_key=r.stage_key
    and c.gate_id is null;
  select count(*),count(distinct f.criterion_id) into v_findings,v_unique
  from public.stage_gate_findings f where f.review_id=r.id;
  if v_criteria=0 or v_findings<>v_criteria or v_unique<>v_criteria then
    raise exception 'Asset lifecycle review must cover every current-stage criterion exactly once'
      using errcode='check_violation';
  end if;

  select count(*) into v_bad
  from public.stage_gate_findings f
  left join public.stage_gate_criteria c on c.id=f.criterion_id
    and c.organization_id=r.organization_id and c.stage_key=r.stage_key
    and c.gate_id is null
  left join public.evidence_items e on e.id=f.evidence_item_id
    and e.organization_id=r.organization_id and e.asset_id=r.asset_id
    and e.verification_status='verified' and e.verified_at is not null
    and e.verified_by is not null and e.verified_by<>r.reviewed_by
  left join public.user_profiles verifier on verifier.id=e.verified_by
    and verifier.organization_id=r.organization_id and verifier.role<>'ai_admin'
  where f.review_id=r.id and (
    c.id is null
    or (f.status in ('met','not_met') and (e.id is null or verifier.id is null))
    or (f.status='not_assessed' and f.evidence_item_id is not null)
  );
  if v_bad>0 then
    raise exception 'Asset lifecycle findings require exact same-tenant independently verified asset evidence'
      using errcode='check_violation';
  end if;

  if r.outcome='pass' and exists(
    select 1 from public.stage_gate_criteria c
    left join public.stage_gate_findings f on f.review_id=r.id
      and f.criterion_id=c.id
    where c.organization_id=r.organization_id and c.stage_key=r.stage_key
      and c.gate_id is null and c.is_mandatory
      and coalesce(f.status,'')<>'met'
  ) then raise exception 'All mandatory asset lifecycle gate criteria must be met before pass'
    using errcode='check_violation'; end if;

  if r.outcome='pass' and r.target_stage_key in ('life_extension','replacement')
     and not exists(
       select 1 from public.lifecycle_evaluations e
       where e.id=r.evaluation_id and e.organization_id=r.organization_id
         and e.asset_id=r.asset_id and e.decision='accepted'
         and ((r.target_stage_key='replacement' and e.recommended='replace')
           or (r.target_stage_key='life_extension'
             and e.recommended in ('repair','redesign','defer')))
     ) then raise exception 'A passing life-extension or replacement gate requires a matching accepted same-asset evaluation'
       using errcode='check_violation'; end if;
  return null;
end $$;

revoke all on function public.enforce_asset_lifecycle_review_integrity()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_asset_lifecycle_review_integrity on public.stage_gate_reviews;
create constraint trigger trg_asset_lifecycle_review_integrity
  after insert or update on public.stage_gate_reviews
  deferrable initially deferred for each row
  execute function public.enforce_asset_lifecycle_review_integrity();
drop trigger if exists trg_asset_lifecycle_finding_integrity on public.stage_gate_findings;
create constraint trigger trg_asset_lifecycle_finding_integrity
  after insert or update or delete on public.stage_gate_findings
  deferrable initially deferred for each row
  execute function public.enforce_asset_lifecycle_review_integrity();

create or replace function public.record_asset_lifecycle_gate_review(
  p_asset_id uuid,
  p_to_stage text,
  p_outcome text,
  p_note text,
  p_findings jsonb default '[]'::jsonb,
  p_evaluation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
  v_from_stage text;
  v_from_order integer;
  v_to_order integer;
  v_review_id bigint;
  v_criteria_count integer;
  v_unique_findings integer;
  v_missing_mandatory integer;
  v_bad_findings integer;
  v_evaluation public.lifecycle_evaluations%rowtype;
begin
  if v_org is null or v_actor is null or v_role='ai_admin'
     or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','A named lifecycle authority is required');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error',
      'Lifecycle gate review requires a verified factor and an AAL2 session');
  end if;
  if p_outcome not in ('pass','hold') then
    return jsonb_build_object('error',
      'Asset lifecycle review records pass or hold; conditional project-gate vocabulary is not reused as unowned prose');
  end if;
  if length(btrim(coalesce(p_note,''))) not between 20 and 4000 then
    return jsonb_build_object('error','Record a bounded gate basis of 20 to 4000 characters');
  end if;
  if jsonb_typeof(coalesce(p_findings,'null'::jsonb))<>'array' then
    return jsonb_build_object('error','Gate findings must be a JSON array');
  end if;

  perform 1 from public.assets
    where id=p_asset_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','Asset scope is outside the active tenant'); end if;

  select s.stage_key,ls.stage_order into v_from_stage,v_from_order
  from public.asset_lifecycle_state s
  join public.lifecycle_stages ls on ls.stage_key=s.stage_key
  where s.asset_id=p_asset_id and s.organization_id=v_org
  for update of s;
  if v_from_stage is null then
    return jsonb_build_object('error','Establish the initial lifecycle state before reviewing a stage gate');
  end if;
  select stage_order into v_to_order from public.lifecycle_stages where stage_key=p_to_stage;
  if v_to_order is null or v_to_order<=v_from_order then
    return jsonb_build_object('error','Target must be a later canonical lifecycle stage');
  end if;
  if not (
    (v_from_stage in ('operation','maintenance','modification')
      and p_to_stage in ('life_extension','replacement','decommissioning'))
    or (v_from_stage='life_extension' and p_to_stage in ('replacement','decommissioning'))
    or (v_from_stage='replacement' and p_to_stage='decommissioning')
    or (v_from_stage='decommissioning' and p_to_stage='disposal')
  ) then
    return jsonb_build_object('error',
      'That lifecycle jump is not an approved end-of-life transition path');
  end if;

  select count(*) into v_criteria_count
  from public.stage_gate_criteria c
  where c.organization_id=v_org and c.stage_key=v_from_stage and c.gate_id is null;
  if v_criteria_count=0 then
    return jsonb_build_object('error','A stage with no adopted criteria cannot pass');
  end if;

  select count(distinct nullif(x->>'criterion_id','')::bigint),count(*)
    into v_unique_findings,v_bad_findings
  from jsonb_array_elements(p_findings) x;
  if v_bad_findings<>v_criteria_count or v_unique_findings<>v_criteria_count then
    return jsonb_build_object('error',
      'Record every current-stage criterion exactly once; omissions and duplicates fail closed');
  end if;

  select count(*) into v_bad_findings
  from jsonb_array_elements(p_findings) x
  left join public.stage_gate_criteria c
    on c.id=nullif(x->>'criterion_id','')::bigint
    and c.organization_id=v_org and c.stage_key=v_from_stage and c.gate_id is null
  left join public.evidence_items e
    on e.id=nullif(x->>'evidence_item_id','')::uuid
    and e.organization_id=v_org and e.asset_id=p_asset_id
    and e.verification_status='verified' and e.verified_at is not null
    and e.verified_by is not null and e.verified_by<>v_actor
  left join public.user_profiles verifier
    on verifier.id=e.verified_by and verifier.organization_id=v_org
    and verifier.role<>'ai_admin'
  where c.id is null
     or coalesce(x->>'status','') not in ('met','not_met','not_assessed')
     or ((x->>'status') in ('met','not_met') and (e.id is null or verifier.id is null))
     or ((x->>'status')='not_assessed' and nullif(x->>'evidence_item_id','') is not null);
  if v_bad_findings>0 then
    return jsonb_build_object('error',
      'Each assessed criterion requires same-tenant, asset-specific canonical evidence independently verified by another named human; not-assessed criteria carry no evidence');
  end if;

  if p_outcome='pass' then
    select count(*) into v_missing_mandatory
    from public.stage_gate_criteria c
    left join jsonb_array_elements(p_findings) x
      on nullif(x->>'criterion_id','')::bigint=c.id
    where c.organization_id=v_org and c.stage_key=v_from_stage
      and c.gate_id is null and c.is_mandatory
      and coalesce(x->>'status','')<>'met';
    if v_missing_mandatory>0 then
      return jsonb_build_object('error','All mandatory gate criteria must be met before a pass');
    end if;
  end if;

  if p_outcome='pass' and p_to_stage in ('life_extension','replacement') then
    select * into v_evaluation from public.lifecycle_evaluations e
    where e.id=p_evaluation_id and e.organization_id=v_org
      and e.asset_id=p_asset_id and e.decision='accepted';
    if not found then
      return jsonb_build_object('error',
        'The evaluation asset and tenant must match, and its recorded human decision must be accepted');
    end if;
    if (p_to_stage='replacement' and v_evaluation.recommended<>'replace')
       or (p_to_stage='life_extension' and coalesce(v_evaluation.recommended,'') not in ('repair','redesign','defer')) then
      return jsonb_build_object('error',
        'The accepted evaluation recommendation does not support the selected target stage');
    end if;
  elsif p_evaluation_id is not null then
    return jsonb_build_object('error','An economic evaluation attaches only to a passing life-extension or replacement review');
  end if;

  perform set_config('app.gate_review_write','granted',true);
  insert into public.stage_gate_reviews(
    organization_id,asset_id,stage_key,target_stage_key,outcome,reviewed_by,
    reviewed_at,evaluation_id,note
  ) values(
    v_org,p_asset_id,v_from_stage,p_to_stage,p_outcome,v_actor,
    now(),p_evaluation_id,btrim(p_note)
  ) returning id into v_review_id;

  insert into public.stage_gate_findings(
    organization_id,review_id,criterion_id,criterion_text,status,evidence,
    evidence_item_id
  )
  select v_org,v_review_id,c.id,c.criterion,x->>'status',
    case when x->>'status'='not_assessed' then null
      else coalesce(nullif(btrim(x->>'evidence_note'),''),e.description) end,
    nullif(x->>'evidence_item_id','')::uuid
  from jsonb_array_elements(p_findings) x
  join public.stage_gate_criteria c
    on c.id=nullif(x->>'criterion_id','')::bigint
    and c.organization_id=v_org and c.stage_key=v_from_stage and c.gate_id is null
  left join public.evidence_items e
    on e.id=nullif(x->>'evidence_item_id','')::uuid and e.organization_id=v_org;
  perform set_config('app.gate_review_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_lifecycle_gate_review',v_role,jsonb_build_object(
    'review_id',v_review_id,'asset_id',p_asset_id,'from_stage',v_from_stage,
    'target_stage',p_to_stage,'outcome',p_outcome,'evaluation_id',p_evaluation_id,
    'recorded_by',v_actor,'aal','aal2','verified_factor',true,
    'operational_authority',false,'financial_authority',false));

  return jsonb_build_object('reviewId',v_review_id,'assetId',p_asset_id,
    'fromStage',v_from_stage,'targetStage',p_to_stage,'outcome',p_outcome,
    'mayAdvance',p_outcome='pass','operationalAuthority',false,
    'financialAuthority',false);
exception when others then
  perform set_config('app.gate_review_write','',true);
  raise;
end $$;

revoke all on function public.record_asset_lifecycle_gate_review(uuid,text,text,text,jsonb,uuid)
  from public,anon,service_role;
grant execute on function public.record_asset_lifecycle_gate_review(uuid,text,text,text,jsonb,uuid)
  to authenticated;

-- Reassert the customer transition boundary with target-specific, fresh gate
-- proof for every end-of-life move. The original internal function remains the
-- sole mutation implementation; this wrapper only strengthens admission.
create or replace function public.advance_lifecycle_stage(
  p_asset_id uuid,
  p_to_stage text,
  p_reason text default null
)
returns table(outcome text,detail text)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
  v_state public.asset_lifecycle_state%rowtype;
  v_from_order integer;
  v_to_order integer;
  v_review public.stage_gate_reviews%rowtype;
  v_evaluation public.lifecycle_evaluations%rowtype;
  v_outcome text;
  v_detail text;
begin
  if v_org is null or v_actor is null or v_role='ai_admin'
     or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return query select 'error'::text,'A named lifecycle authority is required.'::text; return;
  end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal()<>'aal2' then
    return query select 'error'::text,
      'Lifecycle movement requires a verified factor and an AAL2 session.'::text; return;
  end if;
  if length(btrim(coalesce(p_reason,'')))<20 then
    return query select 'error'::text,
      'State a lifecycle movement basis of at least 20 characters.'::text; return;
  end if;
  select * into v_state from public.asset_lifecycle_state
    where asset_id=p_asset_id and organization_id=v_org for update;
  if not found then
    return query select 'error'::text,
      'Initial lifecycle state requires the evidence-backed initial-state workflow.'::text; return;
  end if;
  select stage_order into v_from_order from public.lifecycle_stages where stage_key=v_state.stage_key;
  select stage_order into v_to_order from public.lifecycle_stages where stage_key=p_to_stage;
  if v_to_order is null or v_to_order<=v_from_order then
    return query select 'blocked'::text,'Target must be a later canonical lifecycle stage.'::text; return;
  end if;
  if not (
    (v_state.stage_key in ('operation','maintenance','modification')
      and p_to_stage in ('life_extension','replacement','decommissioning'))
    or (v_state.stage_key='life_extension' and p_to_stage in ('replacement','decommissioning'))
    or (v_state.stage_key='replacement' and p_to_stage='decommissioning')
    or (v_state.stage_key='decommissioning' and p_to_stage='disposal')
  ) then
    return query select 'blocked'::text,
      'That lifecycle jump is not an approved end-of-life transition path.'::text; return;
  end if;
  select r.* into v_review from public.stage_gate_reviews r
  where r.organization_id=v_org and r.asset_id=p_asset_id
    and r.stage_key=v_state.stage_key and r.target_stage_key=p_to_stage
    and r.outcome='pass' and r.reviewed_at>=v_state.entered_at
    and r.id=(select r2.id from public.stage_gate_reviews r2
      where r2.organization_id=v_org and r2.asset_id=p_asset_id
        and r2.stage_key=v_state.stage_key and r2.outcome='pass'
        and r2.reviewed_at>=v_state.entered_at
      order by r2.reviewed_at desc,r2.id desc limit 1)
  order by r.reviewed_at desc,r.id desc limit 1;
  if not found then
    return query select 'blocked'::text,
      'Record a fresh passing review for this asset, current stage and exact target before movement.'::text; return;
  end if;
  if p_to_stage in ('life_extension','replacement') then
    select * into v_evaluation from public.lifecycle_evaluations e
      where e.id=v_review.evaluation_id and e.organization_id=v_org
        and e.asset_id=p_asset_id and e.decision='accepted';
    if not found then
      return query select 'blocked'::text,
        'The linked lifecycle evaluation is absent, cross-tenant, asset-mismatched or not accepted.'::text; return;
    end if;
  end if;
  perform set_config('app.asset_lifecycle_state_writer','governed',true);
  select x.outcome,x.detail into v_outcome,v_detail
  from public.advance_lifecycle_stage_internal(p_asset_id,p_to_stage,p_reason) x;
  if v_outcome='moved' then
    update public.asset_lifecycle_transitions t set gate_review_id=v_review.id
    where t.id=(select t2.id from public.asset_lifecycle_transitions t2
      where t2.organization_id=v_org and t2.asset_id=p_asset_id
        and t2.from_stage=v_state.stage_key and t2.to_stage=p_to_stage
      order by t2.id desc limit 1);
  end if;
  perform set_config('app.asset_lifecycle_state_writer','',true);
  return query select v_outcome,v_detail;
exception when others then
  perform set_config('app.asset_lifecycle_state_writer','',true);
  raise;
end $$;

revoke all on function public.advance_lifecycle_stage(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.advance_lifecycle_stage(uuid,text,text)
  to authenticated;

create or replace function public.record_asset_disposal(
  p_asset_id uuid,
  p_disposal_route text,
  p_disposed_at date,
  p_recovered_value numeric,
  p_disposal_cost numeric,
  p_currency text,
  p_site_restoration_required boolean,
  p_site_restoration_complete boolean,
  p_restoration_obligation text,
  p_hazardous_materials_removed boolean,
  p_certificate_reference text,
  p_evidence_item_id uuid,
  p_expected_version integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
  v_current_version integer;
  v_new_version integer;
begin
  if v_org is null or v_actor is null or v_role='ai_admin'
     or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','A named lifecycle authority is required');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error',
      'Disposal closeout requires a verified factor and an AAL2 session');
  end if;
  perform 1 from public.assets a
  join public.asset_lifecycle_state s on s.asset_id=a.id and s.organization_id=v_org
  where a.id=p_asset_id and a.organization_id=v_org and s.stage_key='disposal'
  for update of a,s;
  if not found then
    return jsonb_build_object('error','The same-tenant asset must be in the disposal lifecycle stage');
  end if;
  if p_disposal_route not in ('resale','redeployment','scrap_recycle',
    'return_to_vendor','hazardous_disposal','abandonment_in_place') then
    return jsonb_build_object('error','Unknown canonical disposal route');
  end if;
  if p_disposed_at is null or p_disposed_at>current_date then
    return jsonb_build_object('error','Disposed date is required and cannot be in the future');
  end if;
  if coalesce(p_recovered_value,0)<0 or coalesce(p_disposal_cost,0)<0 then
    return jsonb_build_object('error','Recovered value and disposal cost cannot be negative');
  end if;
  if (p_recovered_value is not null or p_disposal_cost is not null)
     and coalesce(upper(btrim(p_currency)),'') !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error','Financial amounts require a three-letter currency; currencies are never silently combined');
  end if;
  if p_site_restoration_required
     and length(btrim(coalesce(p_restoration_obligation,'')))<20 then
    return jsonb_build_object('error','State the site-restoration obligation in at least 20 characters');
  end if;
  if p_site_restoration_complete and not p_site_restoration_required then
    return jsonb_build_object('error','Restoration cannot be complete when no restoration obligation is recorded');
  end if;
  if p_disposal_route='hazardous_disposal'
     and (p_hazardous_materials_removed is distinct from true
       or length(btrim(coalesce(p_certificate_reference,'')))<3) then
    return jsonb_build_object('error','Hazardous disposal requires recorded material removal and a certificate reference');
  end if;
  if not exists(
    select 1 from public.evidence_items e
    join public.user_profiles verifier on verifier.id=e.verified_by
      and verifier.organization_id=v_org and verifier.role<>'ai_admin'
    where e.id=p_evidence_item_id and e.organization_id=v_org
      and e.asset_id=p_asset_id and e.verification_status='verified'
      and e.verified_at is not null and e.verified_by is not null
      and e.verified_by<>v_actor
  ) then return jsonb_build_object('error',
    'Disposal closeout requires same-tenant, asset-specific canonical evidence independently verified by another named human');
  end if;

  select version into v_current_version from public.disposal_records
    where asset_id=p_asset_id and organization_id=v_org for update;
  if found and p_expected_version<>v_current_version then
    return jsonb_build_object('error',
      'Expected version does not match the current disposal record; refresh before replacing it');
  end if;
  if not found and p_expected_version<>0 then
    return jsonb_build_object('error','Expected version must be zero for the first disposal record');
  end if;
  v_new_version:=coalesce(v_current_version,0)+1;

  perform set_config('app.asset_disposal_writer','governed',true);
  insert into public.disposal_records(
    asset_id,organization_id,disposal_route,disposed_at,recovered_value,
    disposal_cost,currency,site_restoration_required,site_restoration_complete,
    restoration_obligation,hazardous_materials_removed,certificate_reference,
    evidence_item_id,recorded_by,created_at,updated_at,version
  ) values(
    p_asset_id,v_org,p_disposal_route,p_disposed_at,p_recovered_value,
    p_disposal_cost,case when p_recovered_value is null and p_disposal_cost is null
      then null else upper(btrim(p_currency)) end,
    p_site_restoration_required,p_site_restoration_complete,
    nullif(btrim(p_restoration_obligation),''),p_hazardous_materials_removed,
    nullif(btrim(p_certificate_reference),''),p_evidence_item_id,v_actor,now(),now(),1
  ) on conflict(asset_id) do update set
    disposal_route=excluded.disposal_route,disposed_at=excluded.disposed_at,
    recovered_value=excluded.recovered_value,disposal_cost=excluded.disposal_cost,
    currency=excluded.currency,
    site_restoration_required=excluded.site_restoration_required,
    site_restoration_complete=excluded.site_restoration_complete,
    restoration_obligation=excluded.restoration_obligation,
    hazardous_materials_removed=excluded.hazardous_materials_removed,
    certificate_reference=excluded.certificate_reference,
    evidence_item_id=excluded.evidence_item_id,recorded_by=excluded.recorded_by,
    updated_at=now(),version=public.disposal_records.version+1;
  perform set_config('app.asset_disposal_writer','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_disposal',v_role,jsonb_build_object(
    'asset_id',p_asset_id,'version',v_new_version,'route',p_disposal_route,
    'evidence_item_id',p_evidence_item_id,'recorded_by',v_actor,
    'site_restoration_required',p_site_restoration_required,
    'site_restoration_complete',p_site_restoration_complete,
    'aal','aal2','verified_factor',true,'operational_authority',false,
    'financial_authority',false));
  return jsonb_build_object('assetId',p_asset_id,'version',v_new_version,
    'disposalRoute',p_disposal_route,'restorationComplete',p_site_restoration_complete,
    'operationalAuthority',false,'financialAuthority',false);
exception when others then
  perform set_config('app.asset_disposal_writer','',true);
  raise;
end $$;

revoke all on function public.record_asset_disposal(uuid,text,date,numeric,numeric,text,boolean,boolean,text,boolean,text,uuid,integer)
  from public,anon,service_role;
grant execute on function public.record_asset_disposal(uuid,text,date,numeric,numeric,text,boolean,boolean,text,boolean,text,uuid,integer)
  to authenticated;

create or replace function public.get_asset_lifecycle_gate_workspace(
  p_asset_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  if p_asset_id is not null and not exists(
    select 1 from public.assets where id=p_asset_id and organization_id=v_org
  ) then return jsonb_build_object('error','Asset scope is outside the active tenant'); end if;
  return jsonb_build_object(
    'authority',jsonb_build_object(
      'canAct',v_role<>'ai_admin' and v_role in
        ('admin','executive','maintenance_manager','reliability_engineer'),
      'requiredAal','aal2','verifiedFactorRequired',true,
      'operationalAuthority',false,'financialAuthority',false),
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'tag',coalesce(a.asset_tag,a.tag),
      'stageKey',s.stage_key,'stageLabel',ls.label,'enteredAt',s.entered_at,
      'inherited',s.inherited) order by a.name)
      from public.assets a
      left join public.asset_lifecycle_state s
        on s.asset_id=a.id and s.organization_id=v_org
      left join public.lifecycle_stages ls on ls.stage_key=s.stage_key
      where a.organization_id=v_org),'[]'::jsonb),
    'stages',coalesce((select jsonb_agg(jsonb_build_object(
      'stageKey',s.stage_key,'label',s.label,'phase',s.phase,
      'stageOrder',s.stage_order,'decisionOwned',s.decision_owned)
      order by s.stage_order) from public.lifecycle_stages s),'[]'::jsonb),
    'criteria',case when p_asset_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'criterion',c.criterion,'isMandatory',c.is_mandatory,
        'guidance',c.guidance) order by c.sort_order,c.id)
      from public.stage_gate_criteria c
      join public.asset_lifecycle_state s on s.asset_id=p_asset_id
        and s.organization_id=v_org and s.stage_key=c.stage_key
      where c.organization_id=v_org and c.gate_id is null),'[]'::jsonb) end,
    'evidence',case when p_asset_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'description',e.description,'sourceSystem',e.source_system,
        'evidenceClass',e.evidence_class,'verifiedAt',e.verified_at)
        order by e.verified_at desc)
      from public.evidence_items e
      join public.user_profiles verifier on verifier.id=e.verified_by
        and verifier.organization_id=v_org and verifier.role<>'ai_admin'
      where e.organization_id=v_org and e.asset_id=p_asset_id
        and e.verification_status='verified' and e.verified_at is not null
        and e.verified_by<>v_actor),'[]'::jsonb) end,
    'evaluations',case when p_asset_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'recommended',e.recommended,'uncertainty',e.uncertainty_level,
        'decision',e.decision,'decidedAt',e.decided_at,'rationale',e.rationale)
        order by e.evaluated_at desc)
      from public.lifecycle_evaluations e where e.organization_id=v_org
        and e.asset_id=p_asset_id and e.decision='accepted'),'[]'::jsonb) end,
    'reviews',case when p_asset_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'stageKey',r.stage_key,'targetStageKey',r.target_stage_key,
        'outcome',r.outcome,'reviewedAt',r.reviewed_at,'note',r.note,
        'evaluationId',r.evaluation_id) order by r.reviewed_at desc,r.id desc)
      from public.stage_gate_reviews r where r.organization_id=v_org
        and r.asset_id=p_asset_id and r.development_case_id is null),'[]'::jsonb) end,
    'disposal',case when p_asset_id is null then null else (
      select jsonb_build_object(
        'assetId',d.asset_id,'disposalRoute',d.disposal_route,
        'disposedAt',d.disposed_at,'recoveredValue',d.recovered_value,
        'disposalCost',d.disposal_cost,'currency',d.currency,
        'siteRestorationRequired',d.site_restoration_required,
        'siteRestorationComplete',d.site_restoration_complete,
        'restorationObligation',d.restoration_obligation,
        'hazardousMaterialsRemoved',d.hazardous_materials_removed,
        'certificateReference',d.certificate_reference,
        'evidenceItemId',d.evidence_item_id,'version',d.version,
        'updatedAt',d.updated_at)
      from public.disposal_records d where d.organization_id=v_org
        and d.asset_id=p_asset_id) end
  );
end $$;

revoke all on function public.get_asset_lifecycle_gate_workspace(uuid)
  from public,anon,service_role;
grant execute on function public.get_asset_lifecycle_gate_workspace(uuid)
  to authenticated;

comment on function public.record_asset_lifecycle_gate_review(uuid,text,text,text,jsonb,uuid) is
  'U4.11/U4.12 asset gate determination: exact current-stage criteria, independently verified asset evidence, accepted matching lifecycle evaluation where required, named AAL2 human, and no operating or financial authority.';
comment on function public.record_asset_disposal(uuid,text,date,numeric,numeric,text,boolean,boolean,text,boolean,text,uuid,integer) is
  'U4.14 versioned disposal/restoration closeout over the canonical disposal record with independent evidence and no operating, financial, compliance or risk-acceptance authority.';
