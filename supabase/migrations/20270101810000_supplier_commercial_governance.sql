-- ============================================================================
-- E7.01 / E7.02 / E7.07 / E7.09 / E7.11 / E7.12 — supplier governance.
--
-- Extend the ONE supplier-management family. Contract scope, measured
-- contractor performance and warranty recovery already have governed product
-- writers in the Sync Develop commercial workspace. This slice closes the
-- remaining operational doors for delivery evidence, suspect parts and vendor
-- advisories, then makes the whole family visible from Materials & Spares.
--
-- No supplier score, approval queue, evidence store or audit ledger is added.
-- Facts cite the canonical evidence_items store; decisions stay named-human;
-- audit_events retains every accepted act. Delivery events are append-only.
-- Suspect-part cases and advisory assessments retain immutable versions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Supplier deliveries: immutable, evidence-backed receipt events.
-- ---------------------------------------------------------------------------
alter table public.supplier_deliveries
  add column if not exists delivery_reference text,
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now();

create unique index if not exists uq_supplier_delivery_reference
  on public.supplier_deliveries(organization_id,delivery_reference)
  where delivery_reference is not null;

create or replace function public.enforce_supplier_delivery_governance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id) then
      return old;
    end if;
    raise exception 'supplier delivery evidence is retained and cannot be deleted';
  end if;
  if tg_op='UPDATE' then
    raise exception 'supplier delivery events are immutable; record a correction as a new referenced event';
  end if;
  if coalesce(current_setting('app.supplier_delivery_write',true),'')<>'granted'
     or auth.uid() is null then
    raise exception 'supplier deliveries are written only by the governed named-human workflow';
  end if;
  if length(btrim(coalesce(new.delivery_reference,'')))<3
     or length(btrim(coalesce(new.basis,'')))<20
     or new.evidence_item_id is null then
    raise exception 'a delivery event requires a reference, substantive basis and verified evidence';
  end if;
  if not exists(select 1 from public.evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id
      and e.verification_status='verified') then
    raise exception 'delivery evidence must be independently verified and belong to the same organization';
  end if;
  if not exists(select 1 from public.suppliers s
    where s.id=new.supplier_id and s.organization_id=new.organization_id) then
    raise exception 'delivery supplier must belong to the same organization';
  end if;
  if new.material_id is not null and not exists(select 1 from public.materials m
    where m.id=new.material_id and m.organization_id=new.organization_id) then
    raise exception 'delivery material must belong to the same organization';
  end if;
  if new.promised_on is null or new.received_on is null or new.quality_outcome is null then
    raise exception 'a reliability event requires promised, received and inspected-quality outcomes';
  end if;
  if new.ordered_on>new.received_on or new.promised_on<new.ordered_on then
    raise exception 'delivery dates are inconsistent with the order lifecycle';
  end if;
  if new.received_on>current_date then
    raise exception 'a supplier delivery cannot be received in the future';
  end if;
  if new.quantity is not null and (new.quantity='NaN'::numeric
     or new.quantity='Infinity'::numeric or new.quantity='-Infinity'::numeric
     or new.quantity<=0) then
    raise exception 'delivery quantity must be a finite value greater than zero';
  end if;
  new.recorded_by:=auth.uid(); new.recorded_at:=now();
  return new;
end
$$;
revoke all on function public.enforce_supplier_delivery_governance()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_supplier_delivery_governance on public.supplier_deliveries;
create trigger trg_supplier_delivery_governance
  before insert or update or delete on public.supplier_deliveries
  for each row execute function public.enforce_supplier_delivery_governance();

create or replace function public.record_supplier_delivery(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_ref text:=btrim(coalesce(p_payload->>'deliveryReference',''));
  v_basis text:=btrim(coalesce(p_payload->>'basis',''));
  v_supplier bigint:=public.sync_text_as_bigint(p_payload->>'supplierId');
  v_material uuid:=public.sync_text_as_uuid(p_payload->>'materialId');
  v_evidence uuid:=public.sync_text_as_uuid(p_payload->>'evidenceItemId');
  v_ordered date:=public.sync_text_as_date(p_payload->>'orderedOn');
  v_promised date:=public.sync_text_as_date(p_payload->>'promisedOn');
  v_received date:=public.sync_text_as_date(p_payload->>'receivedOn');
  v_quantity numeric:=public.sync_finite_money(p_payload->>'quantity');
  v_quality text:=btrim(coalesce(p_payload->>'qualityOutcome',''));
  v_id bigint;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'')='ai_admin'
     or coalesce(v_role,'') not in ('admin','executive','maintenance_manager',
       'reliability_engineer','planner','technician','supervisor') then
    return jsonb_build_object('answered',false,'refusal',
      'recording supplier delivery evidence requires an authorized named human');
  end if;
  if length(v_ref)<3 or length(v_basis)<20 then
    return jsonb_build_object('answered',false,'refusal',
      'delivery reference and a substantive evidence basis are required');
  end if;
  if v_supplier is null or not exists(select 1 from public.suppliers s
    where s.id=v_supplier and s.organization_id=v_org) then
    return jsonb_build_object('answered',false,'refusal','supplier does not belong to this organization');
  end if;
  if v_material is not null and not exists(select 1 from public.materials m
    where m.id=v_material and m.organization_id=v_org) then
    return jsonb_build_object('answered',false,'refusal','material does not belong to this organization');
  end if;
  if v_evidence is null or not exists(select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,'refusal',
      'supplier delivery requires same-tenant independently verified canonical evidence');
  end if;
  if v_ordered is null or v_promised is null or v_received is null then
    return jsonb_build_object('answered',false,'refusal',
      'ordered, promised and received dates are all required for delivery reliability');
  end if;
  if v_quality not in ('accepted','accepted_with_deviation','rejected_wrong_item',
      'rejected_quality','rejected_documentation') then
    return jsonb_build_object('answered',false,'refusal','select the inspected delivery quality outcome');
  end if;
  if nullif(btrim(coalesce(p_payload->>'quantity','')),'') is not null
     and (v_quantity is null or v_quantity<=0) then
    return jsonb_build_object('answered',false,'refusal','quantity must be a finite value greater than zero');
  end if;
  if exists(select 1 from public.supplier_deliveries d
    where d.organization_id=v_org and d.delivery_reference=v_ref) then
    return jsonb_build_object('answered',false,'refusal','that delivery reference is already recorded');
  end if;
  perform set_config('app.supplier_delivery_write','granted',true);
  insert into public.supplier_deliveries(organization_id,supplier_id,material_id,
    delivery_reference,ordered_on,promised_on,received_on,quantity,quality_outcome,
    note,basis,evidence_item_id)
  values(v_org,v_supplier,v_material,v_ref,v_ordered,v_promised,v_received,v_quantity,
    v_quality,nullif(btrim(p_payload->>'note'),''),v_basis,v_evidence)
  returning id into v_id;
  perform set_config('app.supplier_delivery_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'supplier_delivery',v_role,jsonb_build_object(
    'deliveryId',v_id,'deliveryReference',v_ref,'supplierId',v_supplier,
    'evidenceItemId',v_evidence,'humanRecorded',true),null,jsonb_build_object(
    'promisedOn',v_promised,'receivedOn',v_received,'qualityOutcome',v_quality));
  return jsonb_build_object('answered',true,'deliveryId',v_id,
    'deliveryReference',v_ref,'onTime',v_received<=v_promised,
    'note','Verified delivery evidence recorded. It updates observed supplier reliability but does not approve the supplier.');
exception when unique_violation then
  perform set_config('app.supplier_delivery_write','',true);
  return jsonb_build_object('answered',false,'refusal','that delivery reference is already recorded');
when others then
  perform set_config('app.supplier_delivery_write','',true); raise;
end
$$;
revoke all on function public.record_supplier_delivery(jsonb) from public,anon,service_role;
grant execute on function public.record_supplier_delivery(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Suspect parts: retained case versions; quarantine release is a human act.
-- ---------------------------------------------------------------------------
alter table public.suspect_parts
  add column if not exists case_reference text,
  add column if not exists status text not null default 'open',
  add column if not exists version integer not null default 1,
  add column if not exists active boolean not null default false,
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists supersedes_suspect_part_id bigint
    references public.suspect_parts(id) on delete restrict;

alter table public.suspect_parts drop constraint if exists suspect_part_status_check;
alter table public.suspect_parts add constraint suspect_part_status_check
  check(status in ('open','investigating','confirmed','cleared','closed'));
alter table public.suspect_parts drop constraint if exists suspect_part_version_check;
alter table public.suspect_parts add constraint suspect_part_version_check check(version>=1);
create unique index if not exists uq_suspect_part_case_version
  on public.suspect_parts(organization_id,case_reference,version)
  where case_reference is not null;
create unique index if not exists uq_suspect_part_case_active
  on public.suspect_parts(organization_id,case_reference) where active;

create or replace function public.enforce_suspect_part_governance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_marker text:=coalesce(current_setting('app.suspect_part_write',true),'');
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id) then return old; end if;
    raise exception 'suspect-part case versions are retained and cannot be deleted';
  end if;
  if v_marker<>'granted' or auth.uid() is null then
    raise exception 'suspect-part cases are written only by the governed named-human workflow';
  end if;
  if tg_op='UPDATE' then
    if old.active is true and new.active is false
       and (to_jsonb(new)-'active') is not distinct from (to_jsonb(old)-'active') then
      return new;
    end if;
    raise exception 'suspect-part case versions are immutable; record the next retained version';
  end if;
  if not new.active or length(btrim(coalesce(new.case_reference,'')))<3
     or length(btrim(coalesce(new.basis,'')))<20 or new.evidence_item_id is null then
    raise exception 'an active suspect-part case requires a reference, basis and verified evidence';
  end if;
  if not exists(select 1 from public.evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id
      and e.verification_status='verified') then
    raise exception 'suspect-part evidence must be independently verified and same-tenant';
  end if;
  if new.material_id is null or not exists(select 1 from public.materials m
    where m.id=new.material_id and m.organization_id=new.organization_id) then
    raise exception 'a suspect-part case requires a same-tenant material';
  end if;
  if new.supplier_id is not null and not exists(select 1 from public.suppliers s
    where s.id=new.supplier_id and s.organization_id=new.organization_id) then
    raise exception 'suspect-part supplier must belong to the same organization';
  end if;
  new.recorded_by:=auth.uid(); new.recorded_at:=now();
  return new;
end
$$;
revoke all on function public.enforce_suspect_part_governance()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_suspect_part_governance on public.suspect_parts;
create trigger trg_suspect_part_governance
  before insert or update or delete on public.suspect_parts
  for each row execute function public.enforce_suspect_part_governance();

create or replace function public.record_suspect_part_case(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_ref text:=btrim(coalesce(p_payload->>'caseReference',''));
  v_status text:=lower(btrim(coalesce(p_payload->>'status','open')));
  v_basis text:=btrim(coalesce(p_payload->>'basis',''));
  v_evidence uuid:=public.sync_text_as_uuid(p_payload->>'evidenceItemId');
  v_material uuid:=public.sync_text_as_uuid(p_payload->>'materialId');
  v_supplier bigint:=public.sync_text_as_bigint(p_payload->>'supplierId');
  v_detected date:=public.sync_text_as_date(p_payload->>'detectedOn');
  v_concern text:=btrim(coalesce(p_payload->>'concern',''));
  v_quantity numeric:=public.sync_finite_money(p_payload->>'quantityAffected');
  v_units integer:=coalesce(public.sync_text_as_int(p_payload->>'unitsAlreadyInstalled'),0);
  v_identified boolean:=coalesce(public.sync_text_as_boolean(p_payload->>'affectedAssetsIdentified'),false);
  v_quarantined boolean:=coalesce(public.sync_text_as_boolean(p_payload->>'quarantined'),true);
  v_reported boolean:=coalesce(public.sync_text_as_boolean(p_payload->>'reportedExternally'),false);
  v_outcome text:=nullif(btrim(coalesce(p_payload->>'outcome','')),'');
  v_expected integer:=public.sync_text_as_int(p_payload->>'expectedVersion');
  v_previous public.suspect_parts%rowtype; v_version integer; v_id bigint;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'')='ai_admin'
     or coalesce(v_role,'') not in ('admin','executive','maintenance_manager',
       'reliability_engineer','planner','technician','supervisor') then
    return jsonb_build_object('answered',false,'refusal',
      'recording a suspect-part case requires an authorized named human');
  end if;
  if length(v_ref)<3 or length(v_basis)<20 then
    return jsonb_build_object('answered',false,'refusal',
      'suspect-part case reference and a substantive evidence basis are required');
  end if;
  if v_concern not in ('counterfeit_suspected','unapproved_source','documentation_missing',
      'documentation_falsified','specification_mismatch') then
    return jsonb_build_object('answered',false,'refusal','select the controlled suspect-part concern');
  end if;
  if v_status not in ('open','investigating','confirmed','cleared','closed') then
    return jsonb_build_object('answered',false,'refusal','select the controlled suspect-part status');
  end if;
  if v_detected is null or v_detected>current_date then
    return jsonb_build_object('answered',false,'refusal','detection date must be recorded and cannot be in the future');
  end if;
  if v_material is null or not exists(select 1 from public.materials m
    where m.id=v_material and m.organization_id=v_org) then
    return jsonb_build_object('answered',false,'refusal','select a material belonging to this organization');
  end if;
  if v_supplier is not null and not exists(select 1 from public.suppliers s
    where s.id=v_supplier and s.organization_id=v_org) then
    return jsonb_build_object('answered',false,'refusal','supplier does not belong to this organization');
  end if;
  if v_evidence is null or not exists(select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,'refusal',
      'suspect-part action requires same-tenant independently verified canonical evidence');
  end if;
  if nullif(btrim(coalesce(p_payload->>'quantityAffected','')),'') is not null
     and (v_quantity is null or v_quantity<=0) then
    return jsonb_build_object('answered',false,'refusal','affected quantity must be a finite value greater than zero');
  end if;
  if v_units<0 then
    return jsonb_build_object('answered',false,'refusal','installed-unit count cannot be negative');
  end if;

  perform 1 from public.organizations where id=v_org for update;
  select * into v_previous from public.suspect_parts
    where organization_id=v_org and case_reference=v_ref and active for update;
  if v_previous.id is null then
    if v_status<>'open' or not v_quarantined then
      return jsonb_build_object('answered',false,'refusal',
        'a new suspect-part case starts open and quarantined; investigation changes are retained as later versions');
    end if;
    v_version:=1;
  else
    if v_expected is null or v_expected<>v_previous.version then
      return jsonb_build_object('answered',false,'refusal',
        'suspect-part case changed since it was loaded; refresh before recording the next version');
    end if;
    if v_previous.status in ('cleared','closed') then
      return jsonb_build_object('answered',false,'refusal','a terminal suspect-part case is retained and cannot be reopened');
    end if;
    if (v_previous.status='open' and v_status not in ('investigating','confirmed','cleared'))
       or (v_previous.status='investigating' and v_status not in ('confirmed','cleared'))
       or (v_previous.status='confirmed' and v_status<>'closed') then
      return jsonb_build_object('answered',false,'refusal','that suspect-part lifecycle transition is not permitted');
    end if;
    if v_status in ('confirmed','cleared','closed')
       and not coalesce(public.app_has_approval_authority(),false) then
      return jsonb_build_object('answered',false,'refusal',
        'confirming or closing a suspect-part case requires named human approval authority');
    end if;
    if v_status in ('cleared','closed') and length(coalesce(v_outcome,''))<20 then
      return jsonb_build_object('answered',false,'refusal',
        'terminal suspect-part status requires a substantive recorded outcome');
    end if;
    if v_units>0 and v_status in ('cleared','closed') and not v_identified then
      return jsonb_build_object('answered',false,'refusal',
        'affected installed assets must be identified before a case with installed units can close');
    end if;
    if not v_quarantined and v_status not in ('cleared','closed') then
      return jsonb_build_object('answered',false,'refusal',
        'quarantine release is refused until an authorized terminal determination is recorded');
    end if;
    v_version:=v_previous.version+1;
  end if;

  perform set_config('app.suspect_part_write','granted',true);
  if v_previous.id is not null then update public.suspect_parts set active=false where id=v_previous.id; end if;
  insert into public.suspect_parts(organization_id,case_reference,material_id,supplier_id,
    detected_on,detection_method,concern,quantity_affected,units_already_installed,
    affected_assets_identified,quarantined,reported_externally,outcome,status,version,
    active,basis,evidence_item_id,supersedes_suspect_part_id)
  values(v_org,v_ref,v_material,v_supplier,v_detected,
    nullif(btrim(p_payload->>'detectionMethod'),''),v_concern,v_quantity,v_units,
    v_identified,v_quarantined,v_reported,v_outcome,v_status,v_version,true,
    v_basis,v_evidence,v_previous.id) returning id into v_id;
  perform set_config('app.suspect_part_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'suspect_part_case',v_role,jsonb_build_object(
    'suspectPartId',v_id,'caseReference',v_ref,'version',v_version,
    'evidenceItemId',v_evidence,'humanRecorded',true),
    case when v_previous.id is null then null else jsonb_build_object(
      'suspectPartId',v_previous.id,'status',v_previous.status,'version',v_previous.version,
      'quarantined',v_previous.quarantined) end,
    jsonb_build_object('status',v_status,'quarantined',v_quarantined,
      'reportedExternally',v_reported,'outcome',v_outcome));
  return jsonb_build_object('answered',true,'suspectPartId',v_id,
    'caseReference',v_ref,'status',v_status,'version',v_version,
    'note',case when v_status='open' then
      'Suspect part recorded and quarantined. SyncAI has not declared it counterfeit.'
      else 'Retained suspect-part case version recorded by a named human.' end);
exception when unique_violation then
  perform set_config('app.suspect_part_write','',true);
  return jsonb_build_object('answered',false,'refusal','suspect-part case changed concurrently; refresh and retry');
when others then
  perform set_config('app.suspect_part_write','',true); raise;
end
$$;
revoke all on function public.record_suspect_part_case(jsonb) from public,anon,service_role;
grant execute on function public.record_suspect_part_case(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Vendor advisories: immutable source plus retained human assessments.
-- ---------------------------------------------------------------------------
drop index if exists public.idx_adv_ref;
alter table public.vendor_advisories
  add column if not exists version integer not null default 1,
  add column if not exists active boolean not null default false,
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists supersedes_advisory_id bigint
    references public.vendor_advisories(id) on delete restrict;
alter table public.vendor_advisories drop constraint if exists vendor_advisory_version_check;
alter table public.vendor_advisories add constraint vendor_advisory_version_check check(version>=1);
create unique index if not exists uq_vendor_advisory_version
  on public.vendor_advisories(organization_id,advisory_reference,version);
create unique index if not exists uq_vendor_advisory_active
  on public.vendor_advisories(organization_id,advisory_reference) where active;

create or replace function public.enforce_vendor_advisory_governance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_marker text:=coalesce(current_setting('app.vendor_advisory_write',true),'');
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id) then return old; end if;
    raise exception 'vendor advisory versions are retained and cannot be deleted';
  end if;
  if v_marker<>'granted' or auth.uid() is null then
    raise exception 'vendor advisories are written only by the governed named-human workflow';
  end if;
  if tg_op='UPDATE' then
    if old.active is true and new.active is false
       and (to_jsonb(new)-'active') is not distinct from (to_jsonb(old)-'active') then
      return new;
    end if;
    raise exception 'vendor advisory versions are immutable; record a retained assessment version';
  end if;
  if not new.active or length(btrim(coalesce(new.basis,'')))<20
     or new.evidence_item_id is null then
    raise exception 'an active vendor advisory requires a substantive basis and verified evidence';
  end if;
  if not exists(select 1 from public.evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id
      and e.verification_status='verified') then
    raise exception 'vendor advisory evidence must be independently verified and same-tenant';
  end if;
  if new.supplier_id is null or not exists(select 1 from public.suppliers s
    where s.id=new.supplier_id and s.organization_id=new.organization_id) then
    raise exception 'vendor advisory supplier must belong to the same organization';
  end if;
  if new.assessment_status='unassessed' then
    if new.assessed_by is not null or new.assessed_at is not null or new.disposition is not null then
      raise exception 'an unassessed advisory cannot carry an assessment determination';
    end if;
  elsif new.assessed_by is null or new.assessed_at is null
     or length(btrim(coalesce(new.disposition,'')))<20 then
    raise exception 'an advisory assessment requires a named human, time and substantive disposition';
  end if;
  new.recorded_by:=auth.uid(); new.recorded_at:=now();
  return new;
end
$$;
revoke all on function public.enforce_vendor_advisory_governance()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_vendor_advisory_governance on public.vendor_advisories;
create trigger trg_vendor_advisory_governance
  before insert or update or delete on public.vendor_advisories
  for each row execute function public.enforce_vendor_advisory_governance();

create or replace function public.record_vendor_advisory(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_ref text:=btrim(coalesce(p_payload->>'advisoryReference',''));
  v_title text:=btrim(coalesce(p_payload->>'title',''));
  v_kind text:=btrim(coalesce(p_payload->>'advisoryKind',''));
  v_supplier bigint:=public.sync_text_as_bigint(p_payload->>'supplierId');
  v_evidence uuid:=public.sync_text_as_uuid(p_payload->>'evidenceItemId');
  v_issued date:=public.sync_text_as_date(p_payload->>'issuedOn');
  v_required date:=public.sync_text_as_date(p_payload->>'requiredBy');
  v_mandatory boolean:=coalesce(public.sync_text_as_boolean(p_payload->>'mandatory'),false);
  v_basis text:=btrim(coalesce(p_payload->>'basis','')); v_id bigint;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'')='ai_admin'
     or coalesce(v_role,'') not in ('admin','executive','maintenance_manager',
       'reliability_engineer','planner','technician','supervisor') then
    return jsonb_build_object('answered',false,'refusal',
      'recording a vendor advisory requires an authorized named human');
  end if;
  if length(v_ref)<3 or length(v_title)<5 or length(v_basis)<20 then
    return jsonb_build_object('answered',false,'refusal',
      'advisory reference, title and substantive source basis are required');
  end if;
  if v_kind not in ('safety_bulletin','service_bulletin','recall',
      'product_change_notice','obsolescence_notice','cybersecurity_advisory') then
    return jsonb_build_object('answered',false,'refusal','select the controlled advisory kind');
  end if;
  if v_issued is null or v_issued>current_date then
    return jsonb_build_object('answered',false,'refusal','issue date is required and cannot be in the future');
  end if;
  if nullif(btrim(coalesce(p_payload->>'appliesToManufacturer','')),'') is null
     and nullif(btrim(coalesce(p_payload->>'appliesToModel','')),'') is null then
    return jsonb_build_object('answered',false,'refusal',
      'state the manufacturer or model population the advisory applies to');
  end if;
  if v_mandatory and v_required is null then
    return jsonb_build_object('answered',false,'refusal',
      'a mandatory advisory requires the vendor or regulator due date; SyncAI will not invent one');
  end if;
  if v_supplier is null or not exists(select 1 from public.suppliers s
    where s.id=v_supplier and s.organization_id=v_org) then
    return jsonb_build_object('answered',false,'refusal','supplier does not belong to this organization');
  end if;
  if v_evidence is null or not exists(select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,'refusal',
      'vendor advisory requires same-tenant independently verified canonical evidence');
  end if;
  if exists(select 1 from public.vendor_advisories a
    where a.organization_id=v_org and a.advisory_reference=v_ref and a.active) then
    return jsonb_build_object('answered',false,'refusal',
      'that advisory reference is already active; assess the retained advisory instead of replacing its source');
  end if;
  perform set_config('app.vendor_advisory_write','granted',true);
  insert into public.vendor_advisories(organization_id,supplier_id,advisory_reference,
    issued_on,title,advisory_kind,applies_to_manufacturer,applies_to_model,mandatory,
    required_by,assessment_status,version,active,basis,evidence_item_id)
  values(v_org,v_supplier,v_ref,v_issued,v_title,v_kind,
    nullif(btrim(p_payload->>'appliesToManufacturer'),''),
    nullif(btrim(p_payload->>'appliesToModel'),''),v_mandatory,v_required,
    'unassessed',1,true,v_basis,v_evidence) returning id into v_id;
  perform set_config('app.vendor_advisory_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'vendor_advisory',v_role,jsonb_build_object(
    'advisoryId',v_id,'advisoryReference',v_ref,'version',1,
    'evidenceItemId',v_evidence,'humanRecorded',true),null,jsonb_build_object(
    'assessmentStatus','unassessed','mandatory',v_mandatory,'requiredBy',v_required));
  return jsonb_build_object('answered',true,'advisoryId',v_id,
    'advisoryReference',v_ref,'version',1,'status','unassessed',
    'note','Verified vendor advisory recorded as unassessed. SyncAI has not declared applicability or completion.');
exception when unique_violation then
  perform set_config('app.vendor_advisory_write','',true);
  return jsonb_build_object('answered',false,'refusal','that advisory reference is already recorded');
when others then
  perform set_config('app.vendor_advisory_write','',true); raise;
end
$$;
revoke all on function public.record_vendor_advisory(jsonb) from public,anon,service_role;
grant execute on function public.record_vendor_advisory(jsonb) to authenticated;

create or replace function public.assess_vendor_advisory(
  p_advisory_id bigint,p_expected_version integer,p_status text,p_disposition text,
  p_basis text,p_evidence_item_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_status text:=lower(btrim(coalesce(p_status,'')));
  v_disposition text:=btrim(coalesce(p_disposition,''));
  v_basis text:=btrim(coalesce(p_basis,''));
  v_previous public.vendor_advisories%rowtype; v_id bigint; v_version integer;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'')='ai_admin'
     or not coalesce(public.app_has_approval_authority(),false) then
    return jsonb_build_object('answered',false,'refusal',
      'vendor advisory assessment requires a named human with approval authority');
  end if;
  if v_status not in ('not_applicable','planned','complete') then
    return jsonb_build_object('answered',false,'refusal',
      'assessment must be not applicable, planned or complete');
  end if;
  if length(v_disposition)<20 or length(v_basis)<20 then
    return jsonb_build_object('answered',false,'refusal',
      'assessment requires a substantive disposition and evidence basis');
  end if;
  if p_evidence_item_id is null or not exists(select 1 from public.evidence_items e
    where e.id=p_evidence_item_id and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,'refusal',
      'advisory assessment requires same-tenant independently verified canonical evidence');
  end if;
  select * into v_previous from public.vendor_advisories
    where id=p_advisory_id and organization_id=v_org and active for update;
  if not found then
    return jsonb_build_object('answered',false,'refusal','active vendor advisory not found');
  end if;
  if p_expected_version is null or p_expected_version<>v_previous.version then
    return jsonb_build_object('answered',false,'refusal',
      'vendor advisory changed since it was loaded; refresh before assessing it');
  end if;
  if v_previous.assessment_status in ('complete','not_applicable') then
    return jsonb_build_object('answered',false,'refusal',
      'a terminal advisory assessment is retained and cannot be replaced');
  end if;
  v_version:=v_previous.version+1;
  perform set_config('app.vendor_advisory_write','granted',true);
  update public.vendor_advisories set active=false where id=v_previous.id;
  insert into public.vendor_advisories(organization_id,supplier_id,advisory_reference,
    issued_on,title,advisory_kind,applies_to_manufacturer,applies_to_model,mandatory,
    required_by,assessment_status,assessed_by,assessed_at,disposition,version,active,
    basis,evidence_item_id,supersedes_advisory_id)
  values(v_org,v_previous.supplier_id,v_previous.advisory_reference,v_previous.issued_on,
    v_previous.title,v_previous.advisory_kind,v_previous.applies_to_manufacturer,
    v_previous.applies_to_model,v_previous.mandatory,v_previous.required_by,
    v_status,auth.uid(),now(),v_disposition,v_version,true,v_basis,
    p_evidence_item_id,v_previous.id) returning id into v_id;
  perform set_config('app.vendor_advisory_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'vendor_advisory_assessment',v_role,jsonb_build_object(
    'advisoryId',v_id,'advisoryReference',v_previous.advisory_reference,
    'version',v_version,'evidenceItemId',p_evidence_item_id,'humanApproved',true),
    jsonb_build_object('advisoryId',v_previous.id,'version',v_previous.version,
      'assessmentStatus',v_previous.assessment_status),
    jsonb_build_object('assessmentStatus',v_status,'disposition',v_disposition));
  return jsonb_build_object('answered',true,'advisoryId',v_id,
    'advisoryReference',v_previous.advisory_reference,'version',v_version,
    'status',v_status,'note',case when v_status='complete' then
      'Advisory completion was recorded by a named human against verified evidence; SyncAI did not execute the work.'
      else 'Retained vendor-advisory assessment recorded.' end);
exception when unique_violation then
  perform set_config('app.vendor_advisory_write','',true);
  return jsonb_build_object('answered',false,'refusal','vendor advisory changed concurrently; refresh and retry');
when others then
  perform set_config('app.vendor_advisory_write','',true); raise;
end
$$;
revoke all on function public.assess_vendor_advisory(bigint,integer,text,text,text,uuid)
  from public,anon,service_role;
grant execute on function public.assess_vendor_advisory(bigint,integer,text,text,text,uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- One customer workspace over the canonical family. The three existing
-- commercial writers remain on the case workspace; this read names their
-- records and gaps beside the new operational writers.
-- ---------------------------------------------------------------------------
create or replace function public.get_supplier_governance_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then
    return jsonb_build_object('answered',false,'refusal','an authenticated organization is required');
  end if;
  return jsonb_build_object(
    'answered',true,
    'boundary','Observed delivery and contractor records inform human decisions. SyncAI does not approve a supplier, release quarantine, accept a settlement or declare an advisory complete.',
    'suppliers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'supplierCode',s.supplier_code,'name',s.name,'kind',s.supplier_kind,
      'approvedVendor',s.approved_vendor) order by s.name)
      from public.suppliers s where s.organization_id=v_org),'[]'::jsonb),
    'materials',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'materialCode',m.material_code,'description',m.description) order by m.material_code)
      from (select * from public.materials where organization_id=v_org order by material_code limit 250) m),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',coalesce(e.description,e.evidence_type,e.id::text)) order by e.created_at desc)
      from (select * from public.evidence_items where organization_id=v_org
        and verification_status='verified' order by created_at desc limit 150) e),'[]'::jsonb),
    'deliveries',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'deliveryReference',d.delivery_reference,'supplierId',d.supplier_id,
      'supplier',s.name,'materialId',d.material_id,'materialCode',m.material_code,
      'promisedOn',d.promised_on,'receivedOn',d.received_on,
      'onTime',d.received_on<=d.promised_on,'qualityOutcome',d.quality_outcome,
      'basis',d.basis,'evidenceItemId',d.evidence_item_id) order by d.received_on desc,d.id desc)
      from public.supplier_deliveries d join public.suppliers s on s.id=d.supplier_id
      left join public.materials m on m.id=d.material_id
      where d.organization_id=v_org and d.delivery_reference is not null),'[]'::jsonb),
    'suspectCases',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'caseReference',p.case_reference,'materialId',p.material_id,
      'materialCode',m.material_code,'supplierId',p.supplier_id,'supplier',s.name,
      'detectedOn',p.detected_on,'detectionMethod',p.detection_method,
      'concern',p.concern,'status',p.status,'version',p.version,
      'quarantined',p.quarantined,'unitsAlreadyInstalled',p.units_already_installed,
      'affectedAssetsIdentified',p.affected_assets_identified,
      'reportedExternally',p.reported_externally,'outcome',p.outcome,
      'basis',p.basis,'evidenceItemId',p.evidence_item_id) order by p.detected_on desc,p.id desc)
      from public.suspect_parts p join public.materials m on m.id=p.material_id
      left join public.suppliers s on s.id=p.supplier_id
      where p.organization_id=v_org and p.active),'[]'::jsonb),
    'advisories',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'advisoryReference',a.advisory_reference,'supplierId',a.supplier_id,
      'supplier',s.name,'issuedOn',a.issued_on,'title',a.title,'kind',a.advisory_kind,
      'manufacturer',a.applies_to_manufacturer,'model',a.applies_to_model,
      'mandatory',a.mandatory,'requiredBy',a.required_by,
      'assessmentStatus',a.assessment_status,'disposition',a.disposition,
      'version',a.version,'basis',a.basis,'evidenceItemId',a.evidence_item_id)
      order by a.issued_on desc,a.id desc)
      from public.vendor_advisories a join public.suppliers s on s.id=a.supplier_id
      where a.organization_id=v_org and a.active),'[]'::jsonb),
    'contractPackages',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'packageCode',p.package_code,'title',p.title,
      'developmentCaseId',p.development_case_id,'supplierId',p.awarded_supplier_id,
      'scopeComplete',length(btrim(coalesce(p.scope_of_work,'')))>=20
        and length(btrim(coalesce(p.acceptance_criteria,'')))>=10,
      'scopeGaps',jsonb_strip_nulls(jsonb_build_object(
        'scopeOfWork',case when length(btrim(coalesce(p.scope_of_work,'')))<20 then 'missing or too brief' end,
        'acceptanceCriteria',case when length(btrim(coalesce(p.acceptance_criteria,'')))<10 then 'missing or too brief' end,
        'exclusions',case when nullif(btrim(coalesce(p.exclusions,'')),'') is null then 'not stated' end,
        'interfaces',case when nullif(btrim(coalesce(p.interfaces,'')),'') is null then 'not stated' end,
        'siteConditions',case when not p.site_conditions_stated then 'not stated' end)))
      order by p.created_at desc)
      from public.contract_packages p where p.organization_id=v_org),'[]'::jsonb),
    'performancePeriods',coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,'packageId',x.package_id,'packageCode',p.package_code,
      'supplierId',x.supplier_id,'supplier',s.name,'periodStart',x.period_start,
      'periodEnd',x.period_end,'plannedHours',x.planned_hours,'actualHours',x.actual_hours,
      'reworkEvents',x.rework_events,'safetyIncidents',x.safety_incidents,
      'qualityEscapes',x.quality_escapes,'basis',x.basis) order by x.period_end desc,x.id desc)
      from public.contract_performance x join public.suppliers s on s.id=x.supplier_id
      left join public.contract_packages p on p.id=x.package_id
      where x.organization_id=v_org),'[]'::jsonb),
    'warranties',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'warrantyReference',w.warranty_ref,'supplierId',w.supplier_id,
      'supplier',s.name,'startsOn',w.starts_on,'endsOn',w.ends_on,
      'claimWindowDays',w.claim_window_days,'basis',w.basis,
      'claims',coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'claimReference',c.claim_ref,'status',c.status,
        'claimValue',c.claim_value,'recoveredValue',c.recovered_value,'currency',c.currency)
        order by c.raised_on desc,c.id desc) from public.warranty_claims c
        where c.warranty_id=w.id and c.organization_id=v_org),'[]'::jsonb))
      order by w.starts_on desc,w.id desc)
      from public.warranty_terms w left join public.suppliers s on s.id=w.supplier_id
      where w.organization_id=v_org),'[]'::jsonb));
end
$$;
revoke all on function public.get_supplier_governance_workspace() from public,anon;
grant execute on function public.get_supplier_governance_workspace() to authenticated;

comment on function public.get_supplier_governance_workspace() is
  'E7 supplier governance workspace over canonical contract, performance, warranty, delivery, suspect-part, advisory, evidence and audit stores. Read-only; operational and commercial determinations remain named-human acts.';

notify pgrst,'reload schema';
