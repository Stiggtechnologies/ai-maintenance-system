-- ============================================================================
-- OEM component-structure import (register E12 master data, U3 ontology).
--
-- WHAT THIS IS FOR.
--
-- A parts-and-service system holds the real maintainable-item breakdown of a
-- machine: rollers, idlers, sprockets, chain, guards, all under an
-- undercarriage group. The drafts derived from work-order history are flat by
-- comparison — one line called UNDERCARRIAGE, because that is the granularity
-- the register codes at. Importing the OEM hierarchy is what turns an
-- eighteen-line breakdown into something an engineer can work against.
--
-- REUSES THE EXISTING INGESTION PATTERN.
--
-- No new staging table. `connectors`, `connector_runs` and `ingest_staging`
-- already exist with the discipline this needs — rejected rows retained with
-- their reason, so a connector cannot silently drop records and report a
-- successful sync. A second importer would have been a second set of bugs.
--
-- LICENSING IS ENFORCED BY WHERE THE DATA LANDS.
--
-- OEM service content is licensed to the subscriber. The owner has confirmed
-- their agreement permits extraction into internal systems, and that is the
-- gate they own. What the platform still owes them is that "internal" cannot
-- quietly become "shared": everything imported here is organization-scoped, and
-- the document class it maps to (`oem_service_manual`) is already
-- may_be_global = false, so the trigger from 20260825140000 physically refuses
-- to place it in the cross-tenant corpus.
--
-- AND IT HAS NO STANDING ON FAILURE BEHAVIOUR.
--
-- `oem_service_manual` may be cited for component structure, maintenance tasks
-- and rated figures — never for how often something fails. A service interval
-- states what the manufacturer requires; a failure rate is what the fleet
-- actually does. Importing a manual must not quietly become a source of
-- reliability claims.
--
-- Canonical reuse: connectors, connector_runs, ingest_staging,
-- kb_document_classes, app_current_org(). Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The imported hierarchy, per organization.
-- ---------------------------------------------------------------------------
create table if not exists oem_component_structures (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  manufacturer text not null,
  -- Model or serial prefix the extract applies to. A parts hierarchy is
  -- specific to a build, and applying a D10T structure to a D8T would be a
  -- confident, wrong answer.
  model_or_serial_prefix text not null,
  source_system text not null,
  -- Which run produced it, so a bad extract can be traced and removed whole.
  connector_run_id uuid references connector_runs(id) on delete set null,
  -- The licence position, recorded rather than assumed.
  licence_basis text not null,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  unique(organization_id, manufacturer, model_or_serial_prefix, source_system)
);

alter table oem_component_structures enable row level security;
drop policy if exists oemcs_read on oem_component_structures;
create policy oemcs_read on oem_component_structures
  for select to authenticated using (organization_id = app_current_org());

create table if not exists oem_component_items (
  id bigserial primary key,
  structure_id bigint not null references oem_component_structures(id) on delete cascade,
  oem_group_code text not null,
  oem_group_name text not null,
  parent_group_code text,
  part_number text,
  item_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_oemci_structure
  on oem_component_items(structure_id, oem_group_code);

alter table oem_component_items enable row level security;
drop policy if exists oemci_read on oem_component_items;
create policy oemci_read on oem_component_items
  for select to authenticated using (
    exists (select 1 from oem_component_structures s
            where s.id = structure_id and s.organization_id = app_current_org()));

-- ---------------------------------------------------------------------------
-- Promote staged rows into a structure.
--
-- Reads `ingest_staging` for entity_type 'oem_component_structure'. A row
-- missing the fields that make it usable is REJECTED with a reason and left in
-- staging, per the existing connector contract — not skipped, because a
-- connector that silently drops rows reports a successful sync.
-- ---------------------------------------------------------------------------
drop function if exists ingest_oem_component_structure(uuid, text, text, text, text);
create or replace function ingest_oem_component_structure(
  p_run_id uuid,
  p_manufacturer text,
  p_model_or_serial_prefix text,
  p_source_system text,
  p_licence_basis text
)
returns table (
  outcome text,
  "structureId" bigint,
  accepted int,
  rejected int,
  detail text
)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_structure_id bigint;
  v_accepted int := 0;
  v_rejected int := 0;
  v_class_global boolean;
begin
  if v_org is null then
    return query select 'error'::text, null::bigint, 0, 0,
      'No organization in session.'::text;
    return;
  end if;

  if coalesce(btrim(p_licence_basis), '') = '' then
    return query select 'refused'::text, null::bigint, 0, 0,
      ('A licence basis must be recorded. OEM service content is licensed to the '
       || 'subscriber, and an import with no stated basis is one nobody can '
       || 'defend later.')::text;
    return;
  end if;

  -- Belt and braces: confirm the class this maps to is still per-client only.
  -- If somebody ever flips oem_service_manual to global, this import stops
  -- rather than becoming the vector that publishes a licensed manual.
  select may_be_global into v_class_global
  from kb_document_classes where class_key = 'oem_service_manual';
  if coalesce(v_class_global, false) then
    return query select 'refused'::text, null::bigint, 0, 0,
      ('The oem_service_manual document class is currently marked as permitted in '
       || 'the shared corpus. Importing licensed OEM content while that is true '
       || 'would make it cross-tenant. Fix the class before importing.')::text;
    return;
  end if;

  insert into oem_component_structures (
    organization_id, manufacturer, model_or_serial_prefix, source_system,
    connector_run_id, licence_basis, imported_by
  ) values (
    v_org, p_manufacturer, p_model_or_serial_prefix, p_source_system,
    p_run_id, p_licence_basis, auth.uid()
  )
  on conflict (organization_id, manufacturer, model_or_serial_prefix, source_system)
  do update set connector_run_id = excluded.connector_run_id,
                licence_basis = excluded.licence_basis,
                imported_at = now()
  returning id into v_structure_id;

  -- Reject anything without the two fields that make a row usable. An item
  -- with no group cannot be attached to anything; one with no name cannot be
  -- read by a person.
  update ingest_staging s
  set status = 'rejected',
      reject_reason = case
        when coalesce(btrim(s.payload->>'oemGroupCode'), '') = ''
          then 'No oemGroupCode: the item cannot be attached to any group.'
        else 'No itemName: an unnamed maintainable item is not reviewable.'
      end
  where s.run_id = p_run_id
    and s.organization_id = v_org
    and s.entity_type = 'oem_component_structure'
    and s.status = 'pending'
    and (coalesce(btrim(s.payload->>'oemGroupCode'), '') = ''
      or coalesce(btrim(s.payload->>'itemName'), '') = '');
  get diagnostics v_rejected = row_count;

  insert into oem_component_items (
    structure_id, oem_group_code, oem_group_name, parent_group_code,
    part_number, item_name
  )
  select v_structure_id,
         s.payload->>'oemGroupCode',
         coalesce(s.payload->>'oemGroupName', s.payload->>'oemGroupCode'),
         nullif(s.payload->>'parentGroupCode', ''),
         nullif(s.payload->>'partNumber', ''),
         s.payload->>'itemName'
  from ingest_staging s
  where s.run_id = p_run_id
    and s.organization_id = v_org
    and s.entity_type = 'oem_component_structure'
    and s.status = 'pending';
  get diagnostics v_accepted = row_count;

  update ingest_staging s set status = 'accepted'
  where s.run_id = p_run_id and s.organization_id = v_org
    and s.entity_type = 'oem_component_structure' and s.status = 'pending';

  return query select 'imported'::text, v_structure_id, v_accepted, v_rejected, format(
    '%s maintainable item(s) imported for %s %s, %s rejected and retained in '
    || 'staging with a reason. Scoped to this organization only: the '
    || 'oem_service_manual class is per-client, so this content cannot reach the '
    || 'shared corpus. It has standing on component structure and maintenance '
    || 'tasks, and NONE on failure behaviour — a service interval is what the '
    || 'manufacturer requires, not how often the item fails here.',
    v_accepted, p_manufacturer, p_model_or_serial_prefix, v_rejected);
end;
$$;

grant execute on function ingest_oem_component_structure(uuid, text, text, text, text) to authenticated;

-- Feed the matcher: the imported hierarchy shaped for src/lib/oem-import.
drop function if exists get_oem_groups(bigint);
create or replace function get_oem_groups(p_structure_id bigint)
returns table ("oemCode" text, name text, "parentOemCode" text, items jsonb)
language sql stable security definer set search_path = public as $$
  select i.oem_group_code, min(i.oem_group_name), min(i.parent_group_code),
         jsonb_agg(jsonb_build_object('partNumber', i.part_number, 'name', i.item_name)
                   order by i.item_name)
  from oem_component_items i
  join oem_component_structures s on s.id = i.structure_id
  where i.structure_id = p_structure_id
    and s.organization_id = app_current_org()
  group by i.oem_group_code
  order by i.oem_group_code;
$$;

grant execute on function get_oem_groups(bigint) to authenticated;

drop function if exists get_oem_import_posture();
create or replace function get_oem_import_posture()
returns table (
  manufacturer text,
  "modelOrSerialPrefix" text,
  "sourceSystem" text,
  "licenceBasis" text,
  groups bigint,
  items bigint,
  "importedAt" timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.manufacturer, s.model_or_serial_prefix, s.source_system, s.licence_basis,
         count(distinct i.oem_group_code), count(i.id), s.imported_at
  from oem_component_structures s
  left join oem_component_items i on i.structure_id = s.id
  where s.organization_id = app_current_org()
  group by s.id, s.manufacturer, s.model_or_serial_prefix, s.source_system,
           s.licence_basis, s.imported_at
  order by s.imported_at desc;
$$;

grant execute on function get_oem_import_posture() to authenticated;

notify pgrst, 'reload schema';
