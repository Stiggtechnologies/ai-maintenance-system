-- U7.02/U7.04/U7.05/U7.07-U7.09/U7.11 — activate the existing configuration
-- family. Observations carry evidence; engineering permissions use canonical
-- approvals and an independent named human. Nothing here changes equipment.

alter table public.configuration_baselines
  add column if not exists evidence_basis text,
  add column if not exists engineering_change_reference text;
alter table public.red_line_markups
  add column if not exists evidence_basis text,
  add column if not exists disposition_basis text,
  add column if not exists disposed_by uuid references auth.users(id) on delete set null;
alter table public.configuration_reconciliations
  add column if not exists evidence_basis text,
  add column if not exists engineering_change_reference text;
alter table public.model_variants
  add column if not exists evidence_basis text,
  add column if not exists recorded_by uuid references auth.users(id) on delete set null;
alter table public.approved_substitutions
  add column if not exists status text not null default 'pending'
    check (status in ('pending','approved','rejected','superseded')),
  add column if not exists approval_id uuid references public.approvals(id) on delete restrict,
  add column if not exists evidence_basis text,
  add column if not exists proposed_by uuid references auth.users(id) on delete set null;
alter table public.interchangeability_rules
  add column if not exists status text not null default 'pending'
    check (status in ('pending','approved','rejected','superseded')),
  add column if not exists approval_id uuid references public.approvals(id) on delete restrict,
  add column if not exists evidence_basis text,
  add column if not exists proposed_by uuid references auth.users(id) on delete set null;

-- Legacy demo rows are demonstrations, never evidence-backed engineering
-- permissions. Keep them visible but do not let the comparison engine clear a
-- real difference from them.
update public.approved_substitutions set status='superseded'
where approval_id is null;
update public.interchangeability_rules set status='superseded'
where approval_id is null;

create or replace function public.configuration_human_role()
returns text language sql stable security definer set search_path=public as $$
  select role from public.user_profiles
  where id=auth.uid() and organization_id=public.app_current_org()
$$;
revoke all on function public.configuration_human_role() from public,anon,authenticated;

create or replace function public.get_configuration_authoring_workspace()
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'tag',tag,'serialNumber',serial_number) order by name)
      from public.assets where organization_id=public.app_current_org()),'[]'::jsonb),
    'materials',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',material_code,'description',description) order by material_code)
      from public.materials where organization_id=public.app_current_org() and not is_template),'[]'::jsonb),
    'variants',coalesce((select jsonb_agg(jsonb_build_object('id',id,'manufacturer',manufacturer,'model',model,'variantCode',variant_code,'distinguishingAttributes',distinguishing_attributes) order by manufacturer,model,variant_code)
      from public.model_variants where organization_id=public.app_current_org()),'[]'::jsonb),
    'pendingAuthority',coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from (
      select jsonb_build_object('kind','substitution','id',s.id,'label',ms.material_code||' → '||mu.material_code,'status',s.status,'createdAt',s.created_at,'proposedBy',s.proposed_by,'approvalId',s.approval_id) x
      from public.approved_substitutions s join public.materials ms on ms.id=s.specified_material_id join public.materials mu on mu.id=s.substitute_material_id
      where s.organization_id=public.app_current_org() and s.status='pending'
      union all
      select jsonb_build_object('kind','interchangeability','id',r.id,'label',vf.variant_code||' → '||vt.variant_code,'status',r.status,'createdAt',r.created_at,'proposedBy',r.proposed_by,'approvalId',r.approval_id)
      from public.interchangeability_rules r join public.model_variants vf on vf.id=r.from_variant_id join public.model_variants vt on vt.id=r.to_variant_id
      where r.organization_id=public.app_current_org() and r.status='pending') q),'[]'::jsonb),
    'controls',jsonb_build_object('authority','Records observations and controlled master data only; it cannot execute a configuration change.','approval','Substitution and interchangeability permissions require an independent reliability engineer, executive or administrator approval.')
  )
$$;
revoke all on function public.get_configuration_authoring_workspace() from public,anon;
grant execute on function public.get_configuration_authoring_workspace() to authenticated;

create or replace function public.record_configuration_baseline(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.configuration_human_role(); v_asset uuid; v_kind text; v_items jsonb; v_old bigint; v_id bigint; item jsonb;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then return jsonb_build_object('error','named human configuration authority is required'); end if;
  begin v_asset:=(p_record->>'asset_id')::uuid; exception when others then return jsonb_build_object('error','valid asset is required'); end;
  v_kind:=p_record->>'baseline_kind'; v_items:=p_record->'items';
  if v_kind not in ('as_designed','as_built','as_maintained') then return jsonb_build_object('error','invalid baseline kind'); end if;
  if not exists(select 1 from public.assets where id=v_asset and organization_id=v_org) then return jsonb_build_object('error','asset not found in this tenant'); end if;
  if length(btrim(coalesce(p_record->>'source_reference','')))<3 or length(btrim(coalesce(p_record->>'evidence_basis','')))<20 then return jsonb_build_object('error','source reference and reviewable evidence basis are required'); end if;
  if jsonb_typeof(coalesce(v_items,'null'::jsonb))<>'array' or jsonb_array_length(v_items)=0 then return jsonb_build_object('error','at least one configuration item is required'); end if;
  if exists(select 1 from jsonb_array_elements(v_items) i group by lower(btrim(i->>'position_ref')) having count(*)>1) then return jsonb_build_object('error','configuration item positions must be unique'); end if;
  select id into v_old from public.configuration_baselines where organization_id=v_org and asset_id=v_asset and baseline_kind=v_kind and is_current for update;
  if v_old is not null and length(btrim(coalesce(p_record->>'engineering_change_reference','')))<3 then return jsonb_build_object('error','revising a current baseline requires an engineering change reference'); end if;
  -- Reuse the existing digital-maintainability write wall. This RPC applies
  -- equally strict named-human, tenant and evidence controls and therefore is
  -- an allowed governed workflow, not a direct-table bypass.
  perform set_config('app.digital_maintainability_write','allowed',true);
  update public.configuration_baselines set is_current=false where id=v_old;
  insert into public.configuration_baselines(organization_id,asset_id,baseline_kind,revision,is_current,effective_from,source_reference,established_by,notes,evidence_basis,engineering_change_reference)
  values(v_org,v_asset,v_kind,coalesce((select revision+1 from public.configuration_baselines where id=v_old),1),true,coalesce((p_record->>'effective_from')::timestamptz,now()),btrim(p_record->>'source_reference'),auth.uid(),nullif(btrim(p_record->>'notes'),''),btrim(p_record->>'evidence_basis'),nullif(btrim(p_record->>'engineering_change_reference'),'')) returning id into v_id;
  for item in select value from jsonb_array_elements(v_items) loop
    if length(btrim(coalesce(item->>'position_ref','')))<2 or coalesce((item->>'quantity')::numeric,0)<=0 then raise exception 'each item needs a position and positive quantity' using errcode='check_violation'; end if;
    if coalesce((item->>'safety_critical')::boolean,false) and length(btrim(coalesce(item->>'safety_basis','')))<10 then raise exception 'safety-critical items require a stated basis' using errcode='check_violation'; end if;
    insert into public.configuration_items(organization_id,baseline_id,position_ref,material_id,part_number,description,quantity,serial_number,firmware_version,software_version,safety_critical,safety_basis)
    values(v_org,v_id,btrim(item->>'position_ref'),nullif(item->>'material_id','')::uuid,nullif(btrim(item->>'part_number'),''),nullif(btrim(item->>'description'),''),(item->>'quantity')::numeric,nullif(btrim(item->>'serial_number'),''),nullif(btrim(item->>'firmware_version'),''),nullif(btrim(item->>'software_version'),''),coalesce((item->>'safety_critical')::boolean,false),nullif(btrim(item->>'safety_basis'),''));
  end loop;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'configuration_baseline',v_role,jsonb_build_object('action','baseline_recorded','baseline_id',v_id,'asset_id',v_asset,'kind',v_kind,'superseded_id',v_old,'engineering_change_reference',p_record->>'engineering_change_reference'));
  return jsonb_build_object('baseline_id',v_id,'status','recorded','revision',(select revision from public.configuration_baselines where id=v_id),'authority','observation only; no equipment change authorized');
exception when check_violation or invalid_text_representation then return jsonb_build_object('error',sqlerrm); end $$;
revoke all on function public.record_configuration_baseline(jsonb) from public,anon;
grant execute on function public.record_configuration_baseline(jsonb) to authenticated;

create or replace function public.record_model_variant(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.configuration_human_role(); v_id bigint;
begin
 if v_org is null or auth.uid() is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then return jsonb_build_object('error','named human master-data authority is required'); end if;
 if length(btrim(coalesce(p_record->>'manufacturer','')))<2 or length(btrim(coalesce(p_record->>'model','')))<1 or length(btrim(coalesce(p_record->>'variant_code','')))<1 or length(btrim(coalesce(p_record->>'distinguishing_attributes','')))<10 or length(btrim(coalesce(p_record->>'evidence_basis','')))<20 then return jsonb_build_object('error','manufacturer, model, variant, distinguishing attributes and evidence basis are required'); end if;
 insert into public.model_variants(organization_id,manufacturer,model,variant_code,distinguishing_attributes,supersedes_variant_code,evidence_basis,recorded_by)
 values(v_org,btrim(p_record->>'manufacturer'),btrim(p_record->>'model'),btrim(p_record->>'variant_code'),btrim(p_record->>'distinguishing_attributes'),nullif(btrim(p_record->>'supersedes_variant_code'),''),btrim(p_record->>'evidence_basis'),auth.uid()) returning id into v_id;
 insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'model_variant',v_role,jsonb_build_object('action','variant_recorded','variant_id',v_id));
 return jsonb_build_object('variant_id',v_id,'status','recorded');
exception when unique_violation then return jsonb_build_object('error','that model variant already exists'); end $$;
revoke all on function public.record_model_variant(jsonb) from public,anon;
grant execute on function public.record_model_variant(jsonb) to authenticated;

create or replace function public.propose_configuration_authority(p_kind text,p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.configuration_human_role(); v_approval uuid; v_id bigint; v_from bigint; v_to bigint; v_spec uuid; v_sub uuid;
begin
 if v_org is null or auth.uid() is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then return jsonb_build_object('error','named human configuration authority is required'); end if;
 if length(btrim(coalesce(p_record->>'evidence_basis','')))<20 then return jsonb_build_object('error','reviewable evidence basis is required'); end if;
 insert into public.approvals(organization_id,status,owner_role,reason,consequence_of_wrong,required_validation)
 values(v_org,'required','reliability_engineer','Independent configuration authority review','An invalid equivalence can silently place an incompatible item or variant in service.','Compare ratings, interfaces, duty, safety, warranty and stated conditions against controlled evidence.') returning id into v_approval;
 if p_kind='substitution' then
   begin v_spec:=(p_record->>'specified_material_id')::uuid; v_sub:=(p_record->>'substitute_material_id')::uuid; exception when others then return jsonb_build_object('error','valid material identifiers are required'); end;
   if v_spec=v_sub or not exists(select 1 from public.materials where id=v_spec and organization_id=v_org) or not exists(select 1 from public.materials where id=v_sub and organization_id=v_org) then return jsonb_build_object('error','two different tenant materials are required'); end if;
   if length(btrim(coalesce(p_record->>'conditions','')))<10 or nullif(p_record->>'expires_at','') is null then return jsonb_build_object('error','substitution conditions and review expiry are required'); end if;
   insert into public.approved_substitutions(organization_id,specified_material_id,substitute_material_id,conditions,expires_at,is_bidirectional,status,approval_id,evidence_basis,proposed_by)
   values(v_org,v_spec,v_sub,btrim(p_record->>'conditions'),(p_record->>'expires_at')::timestamptz,coalesce((p_record->>'is_bidirectional')::boolean,false),'pending',v_approval,btrim(p_record->>'evidence_basis'),auth.uid()) returning id into v_id;
 elsif p_kind='interchangeability' then
   begin v_from:=(p_record->>'from_variant_id')::bigint; v_to:=(p_record->>'to_variant_id')::bigint; exception when others then return jsonb_build_object('error','valid variant identifiers are required'); end;
   if v_from=v_to or not exists(select 1 from public.model_variants where id=v_from and organization_id=v_org) or not exists(select 1 from public.model_variants where id=v_to and organization_id=v_org) then return jsonb_build_object('error','two different tenant variants are required'); end if;
   if p_record->>'interchange_kind' not in ('full','one_way','conditional') or (p_record->>'interchange_kind'='conditional' and length(btrim(coalesce(p_record->>'conditions','')))<10) then return jsonb_build_object('error','valid interchange kind and conditions are required'); end if;
   insert into public.interchangeability_rules(organization_id,from_variant_id,to_variant_id,interchange_kind,conditions,status,approval_id,evidence_basis,proposed_by)
   values(v_org,v_from,v_to,p_record->>'interchange_kind',nullif(btrim(p_record->>'conditions'),''),'pending',v_approval,btrim(p_record->>'evidence_basis'),auth.uid()) returning id into v_id;
 else return jsonb_build_object('error','kind must be substitution or interchangeability'); end if;
 insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'configuration_authority',v_role,jsonb_build_object('action','authority_proposed','kind',p_kind,'record_id',v_id,'approval_id',v_approval));
 return jsonb_build_object('record_id',v_id,'approval_id',v_approval,'status','pending');
exception when unique_violation then return jsonb_build_object('error','that controlled relationship already exists'); when invalid_datetime_format then return jsonb_build_object('error','valid expiry timestamp is required'); end $$;
revoke all on function public.propose_configuration_authority(text,jsonb) from public,anon;
grant execute on function public.propose_configuration_authority(text,jsonb) to authenticated;

create or replace function public.decide_configuration_authority(p_kind text,p_record_id bigint,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.configuration_human_role(); v_author uuid; v_approval uuid;
begin
 if v_org is null or auth.uid() is null or coalesce(v_role,'') not in ('reliability_engineer','executive','admin') then return jsonb_build_object('error','independent reliability engineering authority is required'); end if;
 if p_outcome not in ('approved','rejected') or length(btrim(coalesce(p_note,'')))<20 then return jsonb_build_object('error','approved or rejected with a review note of at least 20 characters is required'); end if;
 if p_kind='substitution' then select proposed_by,approval_id into v_author,v_approval from public.approved_substitutions where id=p_record_id and organization_id=v_org and status='pending' for update;
 elsif p_kind='interchangeability' then select proposed_by,approval_id into v_author,v_approval from public.interchangeability_rules where id=p_record_id and organization_id=v_org and status='pending' for update;
 else return jsonb_build_object('error','invalid authority kind'); end if;
 if v_approval is null then return jsonb_build_object('error','pending configuration authority not found'); end if;
 if v_author=auth.uid() then return jsonb_build_object('error','the proposer cannot approve their own configuration authority'); end if;
 update public.approvals set status=p_outcome,approver=auth.uid()::text,decided_at=now(),required_validation=required_validation||' Review note: '||btrim(p_note) where id=v_approval and organization_id=v_org and status='required';
 if not found then return jsonb_build_object('error','approval is no longer pending'); end if;
 if p_kind='substitution' then update public.approved_substitutions set status=p_outcome,approved_by=case when p_outcome='approved' then auth.uid() end,approved_at=case when p_outcome='approved' then now() end where id=p_record_id;
 else update public.interchangeability_rules set status=p_outcome,approved_by=case when p_outcome='approved' then auth.uid() end,approved_at=case when p_outcome='approved' then now() end where id=p_record_id; end if;
 insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'configuration_authority',v_role,jsonb_build_object('action','authority_decided','kind',p_kind,'record_id',p_record_id,'outcome',p_outcome,'approval_id',v_approval));
 return jsonb_build_object('record_id',p_record_id,'status',p_outcome,'approval_id',v_approval);
end $$;
revoke all on function public.decide_configuration_authority(text,bigint,text,text) from public,anon;
grant execute on function public.decide_configuration_authority(text,bigint,text,text) to authenticated;

create or replace function public.record_red_line(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.configuration_human_role(); v_asset uuid; v_id bigint;
begin
 if v_org is null or auth.uid() is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then return jsonb_build_object('error','named human configuration authority is required'); end if;
 begin v_asset:=nullif(p_record->>'asset_id','')::uuid; exception when others then return jsonb_build_object('error','invalid asset'); end;
 if v_asset is not null and not exists(select 1 from public.assets where id=v_asset and organization_id=v_org) then return jsonb_build_object('error','asset not found in this tenant'); end if;
 if length(btrim(coalesce(p_record->>'drawing_reference','')))<3 or length(btrim(coalesce(p_record->>'change_description','')))<10 or length(btrim(coalesce(p_record->>'evidence_basis','')))<20 then return jsonb_build_object('error','drawing reference, change description and evidence basis are required'); end if;
 insert into public.red_line_markups(organization_id,asset_id,drawing_reference,drawing_revision,change_description,raised_by,evidence_basis)
 values(v_org,v_asset,btrim(p_record->>'drawing_reference'),nullif(btrim(p_record->>'drawing_revision'),''),btrim(p_record->>'change_description'),auth.uid(),btrim(p_record->>'evidence_basis')) returning id into v_id;
 insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'red_line_markup',v_role,jsonb_build_object('action','red_line_recorded','red_line_id',v_id)); return jsonb_build_object('red_line_id',v_id,'status','open'); end $$;
revoke all on function public.record_red_line(jsonb) from public,anon;
grant execute on function public.record_red_line(jsonb) to authenticated;

create or replace function public.dispose_red_line(p_red_line_id bigint,p_outcome text,p_incorporated_revision text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.configuration_human_role(); v_author uuid;
begin
 if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then return jsonb_build_object('error','named human disposition authority is required'); end if;
 if p_outcome not in ('in_review','incorporated','rejected') or length(btrim(coalesce(p_note,'')))<20 then return jsonb_build_object('error','valid disposition and reviewable basis are required'); end if;
 select raised_by into v_author from public.red_line_markups where id=p_red_line_id and organization_id=v_org and status in ('open','in_review') for update;
 if not found then return jsonb_build_object('error','open red-line not found'); end if;
 if p_outcome in ('incorporated','rejected') and v_author=auth.uid() then return jsonb_build_object('error','the author cannot close their own red-line'); end if;
 if p_outcome='incorporated' and length(btrim(coalesce(p_incorporated_revision,'')))<1 then return jsonb_build_object('error','incorporation requires the resulting drawing revision'); end if;
 update public.red_line_markups set status=p_outcome,incorporated_at=case when p_outcome='incorporated' then now() end,incorporated_revision=case when p_outcome='incorporated' then btrim(p_incorporated_revision) end,disposition_basis=btrim(p_note),disposed_by=auth.uid() where id=p_red_line_id;
 insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'red_line_markup',v_role,jsonb_build_object('action','red_line_disposed','red_line_id',p_red_line_id,'outcome',p_outcome)); return jsonb_build_object('red_line_id',p_red_line_id,'status',p_outcome); end $$;
revoke all on function public.dispose_red_line(bigint,text,text,text) from public,anon;
grant execute on function public.dispose_red_line(bigint,text,text,text) to authenticated;

create or replace function public.record_configuration_reconciliation(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.configuration_human_role(); v_asset uuid; v_diff int; v_safety int; v_id bigint;
begin
 if v_org is null or auth.uid() is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then return jsonb_build_object('error','named human reconciliation authority is required'); end if;
 begin v_asset:=(p_record->>'asset_id')::uuid; v_diff:=(p_record->>'differences_found')::int; v_safety:=(p_record->>'safety_critical_differences')::int; exception when others then return jsonb_build_object('error','valid asset and difference counts are required'); end;
 if not exists(select 1 from public.assets where id=v_asset and organization_id=v_org) then return jsonb_build_object('error','asset not found in this tenant'); end if;
 if p_record->>'trigger' not in ('outage','project','audit','incident','scheduled','onboarding') or v_diff<0 or v_safety<0 or v_safety>v_diff then return jsonb_build_object('error','valid trigger and consistent difference counts are required'); end if;
 if length(btrim(coalesce(p_record->>'summary','')))<10 or length(btrim(coalesce(p_record->>'evidence_basis','')))<20 then return jsonb_build_object('error','summary and reviewable evidence basis are required'); end if;
 if v_diff>0 and length(btrim(coalesce(p_record->>'engineering_change_reference','')))<3 then return jsonb_build_object('error','differences require an engineering change reference'); end if;
 insert into public.configuration_reconciliations(organization_id,asset_id,performed_by,trigger,differences_found,safety_critical_differences,summary,evidence_basis,engineering_change_reference)
 values(v_org,v_asset,auth.uid(),p_record->>'trigger',v_diff,v_safety,btrim(p_record->>'summary'),btrim(p_record->>'evidence_basis'),nullif(btrim(p_record->>'engineering_change_reference'),'')) returning id into v_id;
 insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'configuration_reconciliation',v_role,jsonb_build_object('action','reconciliation_recorded','reconciliation_id',v_id,'asset_id',v_asset,'differences',v_diff,'engineering_change_reference',p_record->>'engineering_change_reference')); return jsonb_build_object('reconciliation_id',v_id,'status','recorded','authority','observation only; differences remain under engineering change control'); end $$;
revoke all on function public.record_configuration_reconciliation(jsonb) from public,anon;
grant execute on function public.record_configuration_reconciliation(jsonb) to authenticated;

-- Only independently approved substitutions can clear a configuration drift.
create or replace function public.get_asset_configuration(p_asset_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_build_object('assetId',p_asset_id,
    'baselines',coalesce((select jsonb_agg(jsonb_build_object('kind',b.baseline_kind,'revision',b.revision,'effectiveFrom',b.effective_from,'sourceReference',b.source_reference,'items',coalesce((select jsonb_agg(jsonb_build_object('positionRef',i.position_ref,'partNumber',i.part_number,'materialId',i.material_id,'description',i.description,'quantity',i.quantity,'serialNumber',i.serial_number,'firmwareVersion',i.firmware_version,'softwareVersion',i.software_version,'safetyCritical',i.safety_critical,'safetyBasis',i.safety_basis) order by i.position_ref) from public.configuration_items i where i.baseline_id=b.id),'[]'::jsonb))) from public.configuration_baselines b where b.asset_id=p_asset_id and b.is_current and b.organization_id=public.app_current_org()),'[]'::jsonb),
    'substitutions',coalesce((select jsonb_agg(jsonb_build_object('specified',ms.material_code,'substitute',mu.material_code,'conditions',s.conditions,'expiresAt',s.expires_at,'bidirectional',s.is_bidirectional)) from public.approved_substitutions s join public.materials ms on ms.id=s.specified_material_id join public.materials mu on mu.id=s.substitute_material_id where s.organization_id=public.app_current_org() and s.status='approved'),'[]'::jsonb),
    'lastReconciliation',(select jsonb_build_object('performedAt',r.performed_at,'trigger',r.trigger,'differencesFound',r.differences_found) from public.configuration_reconciliations r where r.asset_id=p_asset_id and r.organization_id=public.app_current_org() order by r.performed_at desc limit 1))
$$;
revoke all on function public.get_asset_configuration(uuid) from public,anon;
grant execute on function public.get_asset_configuration(uuid) to authenticated;

notify pgrst,'reload schema';
