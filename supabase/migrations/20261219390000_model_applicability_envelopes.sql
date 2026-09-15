-- U19.01 — independently reviewed, evidence-backed applicability envelopes.
-- Canonical reuse: model_register, engineering_model_mechanisms,
-- engineering_model_evidence_bindings, assets, evidence_items, approvals,
-- calculation_runs and audit_events. This adds no parallel model registry,
-- evidence store, approval queue or calculation ledger.

alter table public.model_register
  add column if not exists applicability_review_status text not null default 'not_reviewed',
  add column if not exists applicability_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists applicability_reviewed_at timestamptz,
  add column if not exists applicability_review_checksum text,
  add column if not exists applicability_review_evidence_item_id uuid references public.evidence_items(id) on delete set null,
  add column if not exists applicability_review_note text,
  add column if not exists applicability_valid_until date;

do $$ begin
  alter table public.model_register add constraint model_register_applicability_review_status_check
    check (applicability_review_status in ('not_reviewed','approved','rejected'));
exception when duplicate_object then null; end $$;

create or replace function public.engineering_model_nonempty_array(p_value jsonb)
returns boolean language sql immutable set search_path=public as $$
  select case when jsonb_typeof(p_value)='array' then jsonb_array_length(p_value)>0 else false end
$$;

create or replace function public.engineering_model_applicability_gaps(
  p_envelope jsonb,
  p_model_kind text
) returns text[]
language plpgsql immutable set search_path=public as $$
declare v_gaps text[]:='{}'; v_mode text; v_training text; v_valid_from date; v_valid_until date;
begin
  if jsonb_typeof(coalesce(p_envelope,'null'::jsonb))<>'object' then
    return array['applicability envelope must be an object'];
  end if;
  if not public.engineering_model_nonempty_array(p_envelope->'assetTypes') then v_gaps:=array_append(v_gaps,'asset type'); end if;
  if not public.engineering_model_nonempty_array(p_envelope->'assetFamilies') then v_gaps:=array_append(v_gaps,'asset family'); end if;
  if coalesce(jsonb_typeof(p_envelope->'makeModel'),'null')<>'object' then
    v_gaps:=array_append(v_gaps,'make/model policy');
  else
    v_mode:=p_envelope->'makeModel'->>'mode';
    if v_mode not in ('manufacturer_neutral','allowlist') then v_gaps:=array_append(v_gaps,'make/model mode'); end if;
    if length(btrim(coalesce(p_envelope->'makeModel'->>'basis','')))<20 then v_gaps:=array_append(v_gaps,'make/model basis'); end if;
    if v_mode='allowlist' then
      if not public.engineering_model_nonempty_array(p_envelope->'makeModel'->'entries') then
        v_gaps:=array_append(v_gaps,'make/model allowlist');
      elsif exists(
        select 1 from jsonb_array_elements(p_envelope->'makeModel'->'entries') e
        where jsonb_typeof(e)<>'object' or length(btrim(coalesce(e->>'manufacturer','')))<2
          or not public.engineering_model_nonempty_array(e->'models')
      ) then v_gaps:=array_append(v_gaps,'valid make/model allowlist entries'); end if;
    end if;
  end if;
  if coalesce(p_envelope->'mechanismScope'->>'mode','')<>'canonical_model_bindings'
     or length(btrim(coalesce(p_envelope->'mechanismScope'->>'basis','')))<20 then v_gaps:=array_append(v_gaps,'mechanism scope'); end if;
  if not public.engineering_model_nonempty_array(p_envelope->'dutyClasses') then v_gaps:=array_append(v_gaps,'duty'); end if;
  if not public.engineering_model_nonempty_array(p_envelope->'environmentClasses') then v_gaps:=array_append(v_gaps,'environment'); end if;
  if coalesce(jsonb_typeof(p_envelope->'dataQuality'),'null')<>'object'
     or coalesce((p_envelope->'dataQuality'->>'verifiedEvidenceRequired')::boolean,false)<>true
     or coalesce(p_envelope->'dataQuality'->>'minimumState','')<>'fit_for_use'
     or coalesce(p_envelope->'dataQuality'->>'maximumMissingFraction','') !~ '^(0([.][0-9]+)?|1([.]0+)?)$'
  then v_gaps:=array_append(v_gaps,'data quality'); end if;
  if not public.engineering_model_nonempty_array(p_envelope->'rules') then
    v_gaps:=array_append(v_gaps,'operating range');
  elsif exists(
    select 1 from jsonb_array_elements(p_envelope->'rules') r
    where jsonb_typeof(r)<>'object' or length(btrim(coalesce(r->>'inputCode','')))<1
      or length(btrim(coalesce(r->>'description','')))<3
      or (coalesce(jsonb_typeof(r->'range'),'null')<>'object' and not public.engineering_model_nonempty_array(r->'allowedValues'))
  ) then v_gaps:=array_append(v_gaps,'valid operating-range rules'); end if;
  if coalesce(jsonb_typeof(p_envelope->'trainingPopulation'),'null')<>'object' then
    v_gaps:=array_append(v_gaps,'training population');
  else
    v_training:=p_envelope->'trainingPopulation'->>'status';
    if p_model_kind='deterministic_physics' then
      if v_training<>'not_applicable_deterministic' or length(btrim(coalesce(p_envelope->'trainingPopulation'->>'basis','')))<20 then v_gaps:=array_append(v_gaps,'deterministic training-population basis'); end if;
    elsif v_training<>'documented'
       or length(btrim(coalesce(p_envelope->'trainingPopulation'->>'description','')))<20
       or length(btrim(coalesce(p_envelope->'trainingPopulation'->>'evidenceRequirementKey','')))<3 then
      v_gaps:=array_append(v_gaps,'documented training population');
    end if;
  end if;
  if coalesce(jsonb_typeof(p_envelope->'validationPeriod'),'null')<>'object' then
    v_gaps:=array_append(v_gaps,'validation period');
  else
    begin v_valid_from:=(p_envelope->'validationPeriod'->>'validFrom')::date; exception when others then v_valid_from:=null; end;
    begin v_valid_until:=(p_envelope->'validationPeriod'->>'validThrough')::date; exception when others then v_valid_until:=null; end;
    if v_valid_from is null or v_valid_until is null or v_valid_until<v_valid_from then v_gaps:=array_append(v_gaps,'valid validation dates'); end if;
    if not public.engineering_model_nonempty_array(p_envelope->'validationPeriod'->'revalidationTriggers') then v_gaps:=array_append(v_gaps,'revalidation triggers'); end if;
  end if;
  if not public.engineering_model_nonempty_array(p_envelope->'limitations') then
    v_gaps:=array_append(v_gaps,'limitations');
  elsif exists(select 1 from jsonb_array_elements_text(p_envelope->'limitations') l where length(btrim(l))<10) then
    v_gaps:=array_append(v_gaps,'limitations');
  end if;
  return v_gaps;
end $$;

create or replace function public.review_engineering_model_applicability(
  p_model_register_id bigint,
  p_decision text,
  p_evidence_item_id uuid,
  p_review_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; m public.model_register%rowtype;
  e public.evidence_items%rowtype; v_gaps text[]; v_status text; v_valid_from date; v_valid_until date;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','authenticated organization member required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','reliability_engineer') then return jsonb_build_object('error','applicability review requires admin or reliability engineer'); end if;
  if p_decision not in ('approved','rejected') then return jsonb_build_object('error','decision must be approved or rejected'); end if;
  if length(btrim(coalesce(p_review_note,'')))<20 then return jsonb_build_object('error','record at least 20 characters of applicability review basis'); end if;
  select * into m from public.model_register where id=p_model_register_id and organization_id=v_org and is_engineering_model for update;
  if not found then return jsonb_build_object('error','engineering model not found in this organization'); end if;
  if auth.uid()=m.author_id then return jsonb_build_object('error','model author cannot independently review the applicability envelope'); end if;
  if not public.engineering_model_actor_has_role(auth.uid(),v_org,m.required_reviewer_role_key) then return jsonb_build_object('error','applicability reviewer requires assigned competency role '||m.required_reviewer_role_key); end if;
  select * into e from public.evidence_items where id=p_evidence_item_id and organization_id=v_org;
  if not found or e.verification_status<>'verified' or e.verified_by is null or e.verified_at is null then return jsonb_build_object('error','same-tenant independently verified applicability evidence is required'); end if;
  if not exists(select 1 from public.engineering_model_evidence_bindings b where b.organization_id=v_org and b.model_register_id=m.id and b.evidence_item_id=e.id and b.purpose='applicability') then
    return jsonb_build_object('error','verified evidence must be bound to this model version for applicability');
  end if;
  v_gaps:=public.engineering_model_applicability_gaps(m.applicability_envelope,m.model_kind);
  if not exists(select 1 from public.engineering_model_mechanisms where organization_id=v_org and model_register_id=m.id) then v_gaps:=array_append(v_gaps,'canonical mechanism binding'); end if;
  if m.model_kind<>'deterministic_physics' and not exists(
    select 1 from public.engineering_model_evidence_bindings b join public.evidence_items te on te.id=b.evidence_item_id
    where b.organization_id=v_org and b.model_register_id=m.id
      and b.requirement_key=m.applicability_envelope->'trainingPopulation'->>'evidenceRequirementKey'
      and te.organization_id=v_org and te.verification_status='verified'
  ) then v_gaps:=array_append(v_gaps,'verified training-population evidence'); end if;
  if p_decision='approved' and cardinality(v_gaps)>0 then return jsonb_build_object('error','applicability envelope is incomplete: '||array_to_string(v_gaps,', '),'gaps',to_jsonb(v_gaps)); end if;
  begin v_valid_from:=(m.applicability_envelope->'validationPeriod'->>'validFrom')::date; exception when others then v_valid_from:=null; end;
  begin v_valid_until:=(m.applicability_envelope->'validationPeriod'->>'validThrough')::date; exception when others then v_valid_until:=null; end;
  if p_decision='approved' and v_valid_from>current_date then return jsonb_build_object('error','the model validation period has not started'); end if;
  if p_decision='approved' and v_valid_until<current_date then return jsonb_build_object('error','the model validation period has expired'); end if;
  v_status:=p_decision;
  update public.model_register set
    applicability_review_status=v_status,applicability_reviewed_by=auth.uid(),applicability_reviewed_at=now(),
    applicability_review_checksum=manifest_checksum,applicability_review_evidence_item_id=e.id,
    applicability_review_note=btrim(p_review_note),applicability_valid_until=case when v_status='approved' then v_valid_until else null end,
    production_eligible=case when v_status='approved' then production_eligible else false end,
    lifecycle_state=case when v_status='rejected' and lifecycle_state='production_eligible' then 'revalidation_required' else lifecycle_state end,
    approved_on=case when v_status='rejected' then null else approved_on end,
    approved_by=case when v_status='rejected' then null else approved_by end
  where id=m.id;
  insert into public.approvals(organization_id,status,owner_role,approver,reason,consequence_of_wrong,required_validation,decided_at,model_register_id,required_competency_role_key,approver_user_id,approval_scope)
  values(v_org,v_status,m.required_reviewer_role_key,v_role,btrim(p_review_note),
    'Using a model outside its validated context can create unsafe confidence and misdirect maintenance.',
    'Asset type, make/model, mechanism, duty, environment, data quality, operating range, training population, validation period and limitations.',
    now(),m.id,m.required_reviewer_role_key,auth.uid(),jsonb_build_object('kind','applicability_envelope','manifestChecksum',m.manifest_checksum,'evidenceItemId',e.id,'operationalAuthorization',false));
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'engineering_model_applicability_review',v_role,jsonb_build_object('model_register_id',m.id,'decision',v_status,'manifest_checksum',m.manifest_checksum,'evidence_item_id',e.id,'gaps',to_jsonb(v_gaps),'operational_authorization',false));
  return jsonb_build_object('model_register_id',m.id,'decision',v_status,'valid_until',case when v_status='approved' then v_valid_until else null end,'gaps',to_jsonb(v_gaps),'operational_authorization',false);
end $$;

create or replace function public.get_engineering_model_applicability_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','authenticated organization required'); end if;
  return jsonb_build_object(
    'models',coalesce((select jsonb_agg(jsonb_build_object(
      'modelRegisterId',m.id,'modelKey',m.model_key,'version',m.version,
      'envelope',m.applicability_envelope,
      'mechanismKeys',coalesce((select jsonb_agg(dm.mechanism_key order by dm.mechanism_key) from public.engineering_model_mechanisms em join public.damage_mechanisms dm on dm.id=em.mechanism_id where em.organization_id=v_org and em.model_register_id=m.id),'[]'::jsonb),
      'reviewStatus',m.applicability_review_status,
      'reviewedBy',m.applicability_reviewed_by,'reviewedAt',m.applicability_reviewed_at,
      'reviewEvidenceItemId',m.applicability_review_evidence_item_id,'reviewNote',m.applicability_review_note,
      'validUntil',m.applicability_valid_until,'manifestChecksum',m.manifest_checksum,
      'reviewChecksum',m.applicability_review_checksum,
      'gaps',to_jsonb(public.engineering_model_applicability_gaps(m.applicability_envelope,m.model_kind)
        || case when exists(select 1 from public.engineering_model_mechanisms em where em.organization_id=v_org and em.model_register_id=m.id) then '{}'::text[] else array['canonical mechanism binding'] end
        || case when m.applicability_review_status='approved' and m.applicability_valid_until<current_date then array['validation period expired'] else '{}'::text[] end),
      'humanApprovalRequired',true,'operationalAuthorization',false
    ) order by m.model_key,m.version) from public.model_register m where m.organization_id=v_org and m.is_engineering_model),'[]'::jsonb),
    'dimensions',jsonb_build_array('asset_type','make_model','mechanism','duty','environment','data_quality','operating_range','training_population','validation_period','limitations'),
    'basis','Applicability is version-specific, evidence-backed and independently reviewed. Unknown or expired context refuses use; approval never grants operational authority.'
  );
end $$;

create or replace function public.enforce_model_applicability_eligibility()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and (new.applicability_envelope is distinct from old.applicability_envelope or new.manifest_checksum is distinct from old.manifest_checksum) then
    new.applicability_review_status:='not_reviewed'; new.applicability_reviewed_by:=null; new.applicability_reviewed_at:=null;
    new.applicability_review_checksum:=null; new.applicability_review_evidence_item_id:=null; new.applicability_review_note:=null;
    new.applicability_valid_until:=null; new.production_eligible:=false;
    if old.production_eligible then new.lifecycle_state:='revalidation_required'; new.approved_on:=null; new.approved_by:=null; end if;
  end if;
  if new.is_engineering_model and new.production_eligible and (
    new.applicability_review_status<>'approved' or new.applicability_review_checksum is distinct from new.manifest_checksum
    or new.applicability_valid_until is null or new.applicability_valid_until<current_date
  ) then raise exception 'production eligibility requires a current independently approved applicability envelope for this exact manifest'; end if;
  return new;
end $$;

drop trigger if exists trg_model_applicability_eligibility on public.model_register;
create trigger trg_model_applicability_eligibility before insert or update on public.model_register
for each row execute function public.enforce_model_applicability_eligibility();

-- Existing versions remain visible but cannot silently retain production status
-- without the newly required independent envelope review.
update public.model_register set production_eligible=false,
  lifecycle_state=case when lifecycle_state='production_eligible' then 'revalidation_required' else lifecycle_state end,
  approved_on=case when production_eligible then null else approved_on end,
  approved_by=case when production_eligible then null else approved_by end
where is_engineering_model and applicability_review_status<>'approved';

create or replace function public.enforce_model_applicability_on_calculation()
returns trigger language plpgsql set search_path=public as $$
declare m public.model_register%rowtype; a public.assets%rowtype; c jsonb; v_ref jsonb; v_match boolean; v_key text;
begin
  if new.model_register_id is null or new.calculation_key='engineering_model_verification' then return new; end if;
  select * into m from public.model_register where id=new.model_register_id and organization_id=new.organization_id and is_engineering_model;
  if not found then return new; end if;
  select * into a from public.assets where id=new.asset_id and organization_id=new.organization_id;
  c:=coalesce(new.inputs->'context','{}'::jsonb); v_ref:=coalesce(new.refusals,'[]'::jsonb);
  if m.applicability_review_status<>'approved' or m.applicability_review_checksum is distinct from m.manifest_checksum then
    v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','applicability_envelope_unapproved','message','This exact model-version envelope lacks independent approval.'));
  elsif coalesce(m.applicability_envelope->'validationPeriod'->>'validFrom','')>current_date::text then
    v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','applicability_validation_not_started','message','The approved model validation period has not started.'));
  elsif m.applicability_valid_until is null or m.applicability_valid_until<current_date then
    v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','applicability_validation_expired','message','The approved model validation period has expired.'));
  end if;
  if not exists(select 1 from jsonb_array_elements_text(coalesce(m.applicability_envelope->'assetTypes','[]'::jsonb)) x where lower(x)=lower(coalesce(a.asset_class,''))) then
    v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','asset_type_outside_envelope','message','Canonical asset type is outside the approved envelope.'));
  end if;
  if m.applicability_envelope->'makeModel'->>'mode'='allowlist' then
    select exists(select 1 from jsonb_array_elements(coalesce(m.applicability_envelope->'makeModel'->'entries','[]'::jsonb)) e
      where lower(e->>'manufacturer')=lower(coalesce(a.manufacturer,'')) and exists(select 1 from jsonb_array_elements_text(coalesce(e->'models','[]'::jsonb)) md where lower(md)=lower(coalesce(a.model,'')))) into v_match;
    if not v_match then v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','make_model_outside_envelope','message','Canonical asset make/model is outside the approved envelope.')); end if;
  end if;
  v_key:=c->>'mechanismKey';
  if coalesce(v_key,'')='' or not exists(select 1 from public.engineering_model_mechanisms em join public.damage_mechanisms dm on dm.id=em.mechanism_id where em.model_register_id=m.id and em.organization_id=new.organization_id and dm.mechanism_key=v_key) then
    v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','mechanism_outside_envelope','message','A canonical mechanism within the approved envelope is required.'));
  end if;
  if not exists(select 1 from jsonb_array_elements_text(coalesce(m.applicability_envelope->'dutyClasses','[]'::jsonb)) x where x=coalesce(c->>'dutyClass','')) then
    v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','duty_outside_envelope','message','Declared duty is outside the approved envelope.'));
  end if;
  if not public.engineering_model_nonempty_array(c->'environmentClasses') or exists(
    select 1 from jsonb_array_elements_text(coalesce(c->'environmentClasses','[]'::jsonb)) x
    where x not in (select jsonb_array_elements_text(coalesce(m.applicability_envelope->'environmentClasses','[]'::jsonb)))) then
    v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','environment_outside_envelope','message','Declared environment is missing or outside the approved envelope.'));
  end if;
  if c->'dataQuality'->>'state'<>'fit_for_use' or coalesce(c->'dataQuality'->>'evidenceItemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not exists(select 1 from public.evidence_items e join public.engineering_model_evidence_bindings b on b.evidence_item_id=e.id and b.model_register_id=m.id
       where e.id=case when coalesce(c->'dataQuality'->>'evidenceItemId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (c->'dataQuality'->>'evidenceItemId')::uuid else null end and e.organization_id=new.organization_id and e.verification_status='verified' and b.purpose in ('measurement_quality','applicability')) then
    v_ref:=v_ref||jsonb_build_array(jsonb_build_object('code','data_quality_outside_envelope','message','Fit-for-use data quality requires verified canonical evidence bound to this model.'));
  end if;
  if jsonb_array_length(v_ref)>jsonb_array_length(coalesce(new.refusals,'[]'::jsonb)) then new.status:='refused'; new.outputs:=null; new.refusals:=v_ref; end if;
  return new;
end $$;

drop trigger if exists trg_model_applicability_on_calculation on public.calculation_runs;
create trigger trg_model_applicability_on_calculation before insert on public.calculation_runs
for each row execute function public.enforce_model_applicability_on_calculation();

revoke all on function public.engineering_model_nonempty_array(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.engineering_model_applicability_gaps(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.review_engineering_model_applicability(bigint,text,uuid,text) from public,anon,service_role;
revoke all on function public.get_engineering_model_applicability_workspace() from public,anon;
revoke all on function public.enforce_model_applicability_eligibility() from public,anon,authenticated,service_role;
revoke all on function public.enforce_model_applicability_on_calculation() from public,anon,authenticated,service_role;
grant execute on function public.review_engineering_model_applicability(bigint,text,uuid,text) to authenticated;
grant execute on function public.get_engineering_model_applicability_workspace() to authenticated;

comment on function public.review_engineering_model_applicability(bigint,text,uuid,text) is
  'Independent human review of the exact model-version applicability envelope using canonical verified evidence and the canonical approvals/audit trails; grants no operational authority.';
