-- E12.01 / E12.02 — customer-reachable canonical asset-master governance.
-- Extends the canonical twin, class-map and numbering records. No parallel
-- asset model, audit ledger or approval store is introduced.

alter table public.asset_twin_templates
  add column if not exists owner_organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists sharing_scope text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_basis text,
  add column if not exists review_outcome text not null default 'pending';

update public.asset_twin_templates set sharing_scope='shared' where sharing_scope is null;
alter table public.asset_twin_templates alter column sharing_scope set default 'tenant_private';
alter table public.asset_twin_templates alter column sharing_scope set not null;
alter table public.asset_twin_templates drop constraint if exists asset_twin_templates_sharing_scope_check;
alter table public.asset_twin_templates add constraint asset_twin_templates_sharing_scope_check
  check ((sharing_scope='shared' and owner_organization_id is null)
      or (sharing_scope='tenant_private' and owner_organization_id is not null));
alter table public.asset_twin_templates drop constraint if exists asset_twin_templates_review_outcome_check;
alter table public.asset_twin_templates add constraint asset_twin_templates_review_outcome_check
  check (review_outcome in ('pending','engineer_reviewed','rejected'));

alter table public.asset_class_aliases
  add column if not exists evidence_basis text,
  add column if not exists configured_by uuid references auth.users(id),
  add column if not exists configured_at timestamptz;
alter table public.asset_class_twin_map
  add column if not exists evidence_basis text,
  add column if not exists configured_by uuid references auth.users(id),
  add column if not exists configured_at timestamptz;
alter table public.unit_numbering_rules
  add column if not exists evidence_basis text,
  add column if not exists configured_by uuid references auth.users(id),
  add column if not exists configured_at timestamptz;

drop policy if exists asset_twin_templates_read on public.asset_twin_templates;
create policy asset_twin_templates_read on public.asset_twin_templates for select to authenticated
  using (sharing_scope='shared' or owner_organization_id=public.app_current_org());
drop policy if exists asset_twin_model_overlays_read on public.asset_twin_model_overlays;
create policy asset_twin_model_overlays_read on public.asset_twin_model_overlays for select to authenticated
  using (exists(select 1 from public.asset_twin_templates t where t.id=asset_twin_model_overlays.template_id
    and (t.sharing_scope='shared' or t.owner_organization_id=public.app_current_org())));
drop policy if exists asset_twin_instances_org_rw on public.asset_twin_instances;
drop policy if exists asset_twin_instances_org_read on public.asset_twin_instances;
create policy asset_twin_instances_org_read on public.asset_twin_instances for select to authenticated
  using (organization_id=public.app_current_org());

revoke insert,update,delete on public.asset_twin_templates from authenticated;
revoke insert,update,delete on public.asset_class_aliases from authenticated;
revoke insert,update,delete on public.asset_class_twin_map from authenticated;
revoke insert,update,delete on public.unit_numbering_rules from authenticated;
revoke insert,update,delete on public.asset_twin_instances from authenticated;

-- These legacy definer functions were granted directly but had no app caller.
-- Closing them makes the governed workbench the only customer path.
revoke all on function public.compile_asset_twin(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.provision_twin_instances(boolean) from public,anon,authenticated;
revoke all on function public.apply_unit_numbering(boolean) from public,anon,authenticated;
revoke all on function public.promote_structural_contribution(bigint,text,text,text) from public,anon,authenticated;

create or replace function public.asset_master_role_allowed()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and public.app_current_role() in
    ('admin','executive','manager','maintenance_manager','reliability_engineer','data_steward');
$$;
revoke all on function public.asset_master_role_allowed() from public,anon;
grant execute on function public.asset_master_role_allowed() to authenticated;

create or replace function public.record_tenant_asset_twin_template(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id uuid; v_sup uuid;
  v_key text:=upper(btrim(p_record->>'template_key')); v_version text:=btrim(p_record->>'version');
  v_template jsonb:=coalesce(p_record->'template','{}'::jsonb); v_components integer;
begin
  if v_org is null or not public.asset_master_role_allowed() then return jsonb_build_object('error','a named asset-master human is required'); end if;
  if v_key !~ '^[A-Z0-9][A-Z0-9._-]{2,79}$' or length(v_version)<1 then return jsonb_build_object('error','template key and version are required'); end if;
  if length(btrim(coalesce(p_record->>'asset_family','')))<2 or length(btrim(coalesce(p_record->>'asset_class','')))<2 or length(btrim(coalesce(p_record->>'title','')))<2 then return jsonb_build_object('error','asset family, class and title are required'); end if;
  if jsonb_typeof(v_template->'components') is distinct from 'array' then return jsonb_build_object('error','template components must be an array'); end if;
  v_components:=jsonb_array_length(v_template->'components');
  if v_components=0 then return jsonb_build_object('error','a canonical template requires at least one component'); end if;
  if length(btrim(coalesce(p_record->>'evidence_reference','')))<3 or length(btrim(coalesce(p_record->>'evidence_basis','')))<20 then return jsonb_build_object('error','evidence reference and substantive evidence basis are required'); end if;
  if v_template::text ilike '%"organization_id"%' or v_template::text ilike '%"asset_name"%' or v_template::text ilike '%"serial_number"%' then return jsonb_build_object('error','template payload must describe a class, not identify a tenant asset'); end if;
  if exists(select 1 from public.asset_twin_templates where template_key=v_key and version=v_version) then return jsonb_build_object('error','that template key and version already exist'); end if;
  select id into v_sup from public.asset_twin_templates where template_key=v_key and (sharing_scope='shared' or owner_organization_id=v_org) order by created_at desc limit 1;
  insert into public.asset_twin_templates(template_key,version,asset_family,asset_class,title,description,maturity,template,evidence,supersedes_id,owner_organization_id,sharing_scope,created_by)
  values(v_key,v_version,btrim(p_record->>'asset_family'),btrim(p_record->>'asset_class'),btrim(p_record->>'title'),nullif(btrim(p_record->>'description'),''),'draft',v_template,
    jsonb_build_array(jsonb_build_object('reference',btrim(p_record->>'evidence_reference'),'basis',btrim(p_record->>'evidence_basis'),'recorded_at',now(),'recorded_by',v_actor)),v_sup,v_org,'tenant_private',v_actor)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'asset_twin_template',public.app_current_role(),jsonb_build_object('template_id',v_id,'template_key',v_key,'version',v_version,'action','draft_recorded','actor_user_id',v_actor,'sharing_scope','tenant_private'));
  return jsonb_build_object('template_id',v_id,'maturity','draft','sharing_scope','tenant_private','component_count',v_components);
end $$;

create or replace function public.review_tenant_asset_twin_template(p_template_id uuid,p_decision text,p_basis text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); t public.asset_twin_templates%rowtype;
begin
  if v_org is null or not public.asset_master_role_allowed() then return jsonb_build_object('error','a named asset-master human is required'); end if;
  if public.app_current_role() not in ('admin','maintenance_manager','reliability_engineer') then return jsonb_build_object('error','independent review requires accountable engineering authority'); end if;
  select * into t from public.asset_twin_templates where id=p_template_id and owner_organization_id=v_org and sharing_scope='tenant_private' for update;
  if t.id is null then return jsonb_build_object('error','tenant-private template not found'); end if;
  if t.maturity<>'draft' or t.review_outcome<>'pending' then return jsonb_build_object('error','only a pending draft template can be reviewed'); end if;
  if t.created_by=v_actor then return jsonb_build_object('error','independent review requires a reviewer other than the author'); end if;
  if p_decision not in ('engineer_reviewed','rejected') or length(btrim(coalesce(p_basis,'')))<20 then return jsonb_build_object('error','engineer_reviewed or rejected decision and substantive basis are required'); end if;
  update public.asset_twin_templates set maturity=case when p_decision='rejected' then 'draft' else 'engineer_reviewed' end,
    review_outcome=p_decision,reviewed_by=v_actor,reviewed_at=now(),review_basis=btrim(p_basis),updated_at=now() where id=t.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'asset_twin_template_review',public.app_current_role(),jsonb_build_object('template_id',t.id,'template_key',t.template_key,'version',t.version,'decision',p_decision,'basis',btrim(p_basis),'actor_user_id',v_actor,'sharing_scope','tenant_private'));
  return jsonb_build_object('template_id',t.id,'decision',p_decision,'maturity',case when p_decision='rejected' then 'draft' else 'engineer_reviewed' end);
end $$;

create or replace function public.record_asset_class_governance(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_local text:=btrim(p_record->>'local_class');
  v_catalogue text:=btrim(p_record->>'catalogue_class'); v_fit text:=p_record->>'fit'; v_key text:=nullif(upper(btrim(p_record->>'template_key')),'');
  v_previous jsonb;
begin
  if v_org is null or not public.asset_master_role_allowed() then return jsonb_build_object('error','a named asset-master human is required'); end if;
  if length(v_local)<2 or length(v_catalogue)<2 then return jsonb_build_object('error','local and canonical catalogue classes are required'); end if;
  if v_fit not in ('direct','approximate','none') then return jsonb_build_object('error','fit must be direct, approximate or none'); end if;
  if (v_fit='none' and v_key is not null) or (v_fit<>'none' and v_key is null) then return jsonb_build_object('error','none requires no template; other fits require a template key'); end if;
  if length(btrim(coalesce(p_record->>'source','')))<3 or length(btrim(coalesce(p_record->>'rationale','')))<20 or length(btrim(coalesce(p_record->>'evidence_basis','')))<20 then return jsonb_build_object('error','source, substantive rationale and evidence basis are required'); end if;
  if v_key is not null and not exists(select 1 from public.asset_twin_templates t where t.template_key=v_key and t.maturity in ('engineer_reviewed','field_validated','approved') and (t.sharing_scope='shared' or t.owner_organization_id=v_org)) then return jsonb_build_object('error','template key does not resolve to a reviewed template visible to this tenant'); end if;
  select jsonb_build_object('catalogue_class',a.catalogue_class,'template_key',m.template_key,'fit',m.fit,'rationale',m.rationale,'source',m.source) into v_previous
  from public.asset_class_aliases a left join public.asset_class_twin_map m on m.organization_id=a.organization_id and m.local_class=a.local_class
  where a.organization_id=v_org and a.local_class=v_local;
  insert into public.asset_class_aliases(organization_id,local_class,catalogue_class,source,evidence_basis,configured_by,configured_at)
  values(v_org,v_local,v_catalogue,btrim(p_record->>'source'),btrim(p_record->>'evidence_basis'),v_actor,now())
  on conflict(organization_id,local_class) do update set catalogue_class=excluded.catalogue_class,source=excluded.source,evidence_basis=excluded.evidence_basis,configured_by=excluded.configured_by,configured_at=excluded.configured_at;
  insert into public.asset_class_twin_map(organization_id,local_class,template_key,fit,rationale,source,evidence_basis,configured_by,configured_at)
  values(v_org,v_local,v_key,v_fit,btrim(p_record->>'rationale'),btrim(p_record->>'source'),btrim(p_record->>'evidence_basis'),v_actor,now())
  on conflict(organization_id,local_class) do update set template_key=excluded.template_key,fit=excluded.fit,rationale=excluded.rationale,source=excluded.source,evidence_basis=excluded.evidence_basis,configured_by=excluded.configured_by,configured_at=excluded.configured_at;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state) values(v_org,'asset_class_governance',public.app_current_role(),jsonb_build_object('local_class',v_local,'action','configured','actor_user_id',v_actor),v_previous,jsonb_build_object('catalogue_class',v_catalogue,'template_key',v_key,'fit',v_fit,'rationale',btrim(p_record->>'rationale'),'source',btrim(p_record->>'source')));
  return jsonb_build_object('local_class',v_local,'catalogue_class',v_catalogue,'template_key',v_key,'fit',v_fit);
end $$;

create or replace function public.record_unit_numbering_rule(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_prefix text:=btrim(p_record->>'number_prefix'); v_date date; v_id bigint; v_previous jsonb;
begin
  if v_org is null or not public.asset_master_role_allowed() then return jsonb_build_object('error','a named asset-master human is required'); end if;
  if v_prefix !~ '^[A-Za-z0-9._-]{1,16}$' then return jsonb_build_object('error','number prefix is invalid'); end if;
  begin v_date:=coalesce(nullif(p_record->>'effective_from','')::date,current_date); exception when others then return jsonb_build_object('error','effective date is invalid'); end;
  if length(btrim(coalesce(p_record->>'source','')))<3 or length(btrim(coalesce(p_record->>'evidence_basis','')))<20 then return jsonb_build_object('error','source and substantive evidence basis are required'); end if;
  if nullif(btrim(p_record->>'manufacturer'),'') is null and nullif(btrim(p_record->>'model'),'') is not null then return jsonb_build_object('error','a model cannot be asserted without a manufacturer'); end if;
  select jsonb_build_object('expected_class',expected_class,'manufacturer',manufacturer,'model',model,'ambiguity_note',ambiguity_note,'source',source) into v_previous from public.unit_numbering_rules where organization_id=v_org and number_prefix=v_prefix and effective_from=v_date;
  insert into public.unit_numbering_rules(organization_id,number_prefix,expected_class,manufacturer,model,ambiguity_note,source,effective_from,evidence_basis,configured_by,configured_at)
  values(v_org,v_prefix,nullif(btrim(p_record->>'expected_class'),''),nullif(btrim(p_record->>'manufacturer'),''),nullif(btrim(p_record->>'model'),''),nullif(btrim(p_record->>'ambiguity_note'),''),btrim(p_record->>'source'),v_date,btrim(p_record->>'evidence_basis'),v_actor,now())
  on conflict(organization_id,number_prefix,effective_from) do update set expected_class=excluded.expected_class,manufacturer=excluded.manufacturer,model=excluded.model,ambiguity_note=excluded.ambiguity_note,source=excluded.source,evidence_basis=excluded.evidence_basis,configured_by=excluded.configured_by,configured_at=excluded.configured_at returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state) values(v_org,'unit_numbering_rule',public.app_current_role(),jsonb_build_object('rule_id',v_id,'number_prefix',v_prefix,'effective_from',v_date,'action','configured','actor_user_id',v_actor),v_previous,jsonb_build_object('expected_class',nullif(btrim(p_record->>'expected_class'),''),'manufacturer',nullif(btrim(p_record->>'manufacturer'),''),'model',nullif(btrim(p_record->>'model'),''),'ambiguity_note',nullif(btrim(p_record->>'ambiguity_note'),''),'source',btrim(p_record->>'source')));
  return jsonb_build_object('rule_id',v_id,'number_prefix',v_prefix,'effective_from',v_date);
end $$;

create or replace function public.run_governed_unit_numbering(p_apply boolean,p_basis text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_row record;
begin
  if v_org is null or not public.asset_master_role_allowed() then return jsonb_build_object('error','a named asset-master human is required'); end if;
  if p_apply and length(btrim(coalesce(p_basis,'')))<20 then return jsonb_build_object('error','substantive application basis is required'); end if;
  select * into v_row from public.apply_unit_numbering(not p_apply);
  if p_apply then insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'unit_numbering_application',public.app_current_role(),jsonb_build_object('action','applied','actor_user_id',auth.uid(),'basis',btrim(p_basis),'assets_matched',v_row.assets_matched,'tags_set',v_row.tags_set,'makes_set',v_row.makes_set,'models_set',v_row.models_set,'class_mismatches',v_row.class_mismatches)); end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.run_governed_twin_provisioning(p_apply boolean,p_basis text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_created integer:=0; v_present integer:=0; v_skipped integer:=0; v_approx integer:=0; r record; v_version text;
begin
  if v_org is null or not public.asset_master_role_allowed() then return jsonb_build_object('error','a named asset-master human is required'); end if;
  if p_apply and length(btrim(coalesce(p_basis,'')))<20 then return jsonb_build_object('error','substantive provisioning basis is required'); end if;
  for r in
    select a.id asset_id,m.fit,m.rationale,t.id template_id,t.template_key,t.version,t.template
    from public.assets a left join public.asset_class_twin_map m on m.organization_id=a.organization_id and m.local_class=a.asset_class
    left join lateral(select x.* from public.asset_twin_templates x where x.template_key=m.template_key and x.maturity in ('engineer_reviewed','field_validated','approved') and (x.sharing_scope='shared' or x.owner_organization_id=v_org) order by case x.maturity when 'approved' then 3 when 'field_validated' then 2 else 1 end desc,x.created_at desc limit 1) t on true
    where a.organization_id=v_org
  loop
    if r.template_id is null then v_skipped:=v_skipped+1; continue; end if;
    v_version:=r.template_key||'@'||r.version||'+template-only';
    if exists(select 1 from public.asset_twin_instances i where i.asset_id=r.asset_id and i.compiled_version=v_version) then v_present:=v_present+1; continue; end if;
    if r.fit='approximate' then v_approx:=v_approx+1; end if;
    if p_apply then
      insert into public.asset_twin_instances(organization_id,asset_id,template_id,overlay_id,compiled_version,compiled_twin,customer_overrides,compilation_log,status,created_by)
      values(v_org,r.asset_id,r.template_id,null,v_version,r.template,'{}',jsonb_build_array(jsonb_build_object('compiled_at',now(),'template_version',r.version,'fit',r.fit,'rationale',r.rationale,'basis','Reviewed class mapping only; no OEM model overlay is asserted.','actor',v_actor)),'draft',v_actor);
    end if;
    v_created:=v_created+1;
  end loop;
  if p_apply then insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'asset_twin_provisioning',public.app_current_role(),jsonb_build_object('action','draft_twins_provisioned','actor_user_id',v_actor,'basis',btrim(p_basis),'created',v_created,'already_present',v_present,'skipped_no_template',v_skipped,'approximate',v_approx,'boundary','draft instances only; no OEM overlay or active status granted')); end if;
  return jsonb_build_object('outcome',case when p_apply then 'applied' else 'dry_run' end,'created',v_created,'already_present',v_present,'skipped_no_template',v_skipped,'approximate',v_approx,'detail','Only reviewed visible templates are eligible. Created twins remain draft; no OEM model is inferred.');
end $$;

create or replace function public.get_asset_master_governance_workspace()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','workspace membership required'); end if;
  return jsonb_build_object('actor_role',public.app_current_role(),'can_manage',public.asset_master_role_allowed(),
    'governance',jsonb_build_object('templates','Tenant-authored templates remain private and draft until independent engineering review.','numbering','Rules fill blank identity fields only; disagreements are reported, never silently corrected.','twins','Provisioning creates draft instances without asserting an OEM model or operational approval.'),
    'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'template_key',t.template_key,'version',t.version,'asset_family',t.asset_family,'asset_class',t.asset_class,'title',t.title,'maturity',t.maturity,'review_outcome',t.review_outcome,'sharing_scope',t.sharing_scope,'created_by',t.created_by,'reviewed_by',t.reviewed_by,'review_basis',t.review_basis,'component_count',coalesce(jsonb_array_length(t.template->'components'),0)) order by t.created_at desc) from public.asset_twin_templates t where t.owner_organization_id=v_org),'[]'),
    'numbering_rules',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'number_prefix',r.number_prefix,'expected_class',r.expected_class,'manufacturer',r.manufacturer,'model',r.model,'ambiguity_note',r.ambiguity_note,'source',r.source,'effective_from',r.effective_from,'evidence_basis',r.evidence_basis) order by r.effective_from desc,r.number_prefix) from public.unit_numbering_rules r where r.organization_id=v_org),'[]'),
    'class_mappings',coalesce((select jsonb_agg(jsonb_build_object('local_class',a.local_class,'catalogue_class',a.catalogue_class,'template_key',m.template_key,'fit',m.fit,'rationale',m.rationale,'source',m.source,'evidence_basis',m.evidence_basis) order by a.local_class) from public.asset_class_aliases a left join public.asset_class_twin_map m on m.organization_id=a.organization_id and m.local_class=a.local_class where a.organization_id=v_org),'[]'),
    'available_templates',coalesce((select jsonb_agg(jsonb_build_object('template_key',x.template_key,'version',x.version,'title',x.title,'maturity',x.maturity,'sharing_scope',x.sharing_scope) order by x.template_key,x.created_at desc) from public.asset_twin_templates x where x.maturity in ('engineer_reviewed','field_validated','approved') and (x.sharing_scope='shared' or x.owner_organization_id=v_org)),'[]'));
end $$;

revoke all on function public.record_tenant_asset_twin_template(jsonb) from public,anon;
revoke all on function public.review_tenant_asset_twin_template(uuid,text,text) from public,anon;
revoke all on function public.record_asset_class_governance(jsonb) from public,anon;
revoke all on function public.record_unit_numbering_rule(jsonb) from public,anon;
revoke all on function public.run_governed_unit_numbering(boolean,text) from public,anon;
revoke all on function public.run_governed_twin_provisioning(boolean,text) from public,anon;
revoke all on function public.get_asset_master_governance_workspace() from public,anon;
grant execute on function public.record_tenant_asset_twin_template(jsonb) to authenticated;
grant execute on function public.review_tenant_asset_twin_template(uuid,text,text) to authenticated;
grant execute on function public.record_asset_class_governance(jsonb) to authenticated;
grant execute on function public.record_unit_numbering_rule(jsonb) to authenticated;
grant execute on function public.run_governed_unit_numbering(boolean,text) to authenticated;
grant execute on function public.run_governed_twin_provisioning(boolean,text) to authenticated;
grant execute on function public.get_asset_master_governance_workspace() to authenticated;

notify pgrst,'reload schema';
