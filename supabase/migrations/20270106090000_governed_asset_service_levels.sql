-- ============================================================================
-- U2.08 — governed service-level consequences on the canonical dependency graph.
--
-- Canonical reuse only: asset_service_levels remains the service consequence
-- model; assets remains the identity; evidence_items remains the evidence
-- model; audit_events remains the audit trail. Drafts do not influence cascade
-- or restoration analysis until a second named human verifies them.
-- ============================================================================

alter table public.asset_service_levels
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid,
  add column if not exists evidence_snapshot jsonb,
  add column if not exists status text not null default 'draft',
  add column if not exists version integer not null default 1,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.asset_service_levels
  drop constraint if exists asset_service_levels_status_check;
alter table public.asset_service_levels
  add constraint asset_service_levels_status_check
  check (status in ('draft', 'verified', 'superseded'));

alter table public.asset_service_levels
  drop constraint if exists asset_service_levels_version_check;
alter table public.asset_service_levels
  add constraint asset_service_levels_version_check check (version >= 1);

alter table public.asset_service_levels
  drop constraint if exists asset_service_levels_review_shape_check;
alter table public.asset_service_levels
  add constraint asset_service_levels_review_shape_check check (
    (status = 'draft' and reviewed_by is null and reviewed_at is null
      and review_note is null)
    or (status = 'verified' and recorded_by is not null
      and reviewed_by is not null and reviewed_at is not null
      and reviewed_by <> recorded_by
      and length(btrim(coalesce(review_note, ''))) >= 20)
    or status = 'superseded'
  );

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'asset_service_levels_asset_tenant_fk'
      and conrelid = 'public.asset_service_levels'::regclass
  ) then
    alter table public.asset_service_levels
      add constraint asset_service_levels_asset_tenant_fk
      foreign key (organization_id, asset_id)
      references public.assets(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'asset_service_levels_evidence_tenant_fk'
      and conrelid = 'public.asset_service_levels'::regclass
  ) then
    alter table public.asset_service_levels
      add constraint asset_service_levels_evidence_tenant_fk
      foreign key (organization_id, evidence_item_id)
      references public.evidence_items(organization_id, id)
      on delete restrict;
  end if;
end
$migration$;

comment on table public.asset_service_levels is
  'U2.08 canonical primary service consequence per asset. Only independently verified rows enter dependency cascade and restoration analysis; a service declaration grants no work, operating, risk-acceptance or restoration authority.';

-- New protected service state has no privileged API write path. The canonical
-- evidence service admit-and-audit posture is unchanged by this migration.
revoke insert, update, delete, truncate on public.asset_service_levels
  from public, anon, authenticated, service_role;

-- Full canonical evidence tuple binding, not a second evidence model. Changes
-- make prior review stale without rewriting history. This is NOT a completed
-- KB claim-purpose/source-standing consumer contract; that remains a separately
-- coordinated dependency and no new purpose or normative authority is invented.
create or replace function public.asset_service_level_evidence_standing(
  p_organization_id uuid, p_asset_id uuid, p_evidence_item_id uuid,
  p_evidence_snapshot jsonb default null
)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and p_organization_id = case when auth.uid() is not null then app_current_org() else null end
    and exists (
      select 1 from public.evidence_items e
      where e.id = p_evidence_item_id and e.organization_id = p_organization_id
        and (e.asset_id is null or e.asset_id = p_asset_id)
        and e.verification_status = 'verified'
        and e.evidence_class in ('MEASURED','INSPECTED','CALCULATED','TESTED',
          'DOCUMENTED','HISTORICAL','EXPERT_JUDGEMENT')
        and nullif(btrim(coalesce(e.source_system,'')), '') is not null
        and coalesce(length(btrim(e.description)),0) >= 10
        and (e.risk_id is null or public.can_read_risk(e.risk_id))
        and (p_evidence_snapshot is null or to_jsonb(e) = p_evidence_snapshot)
    );
$$;
revoke all on function public.asset_service_level_evidence_standing(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.asset_service_level_evidence_standing(uuid,uuid,uuid,jsonb)
  to authenticated;

create or replace function public.asset_service_level_standing(
  p_organization_id uuid, p_asset_id uuid, p_evidence_item_id uuid,
  p_evidence_snapshot jsonb
)
returns boolean
language sql stable security invoker set search_path = public as $$
  select p_evidence_snapshot is not null
    -- Unfinished operational rail only; shared typed document/obligation gates
    -- must replace this explicit refusal before full U2.08 qualification.
    and p_evidence_snapshot->>'document_id' is null
    and p_evidence_snapshot->>'evidence_class' is distinct from 'DOCUMENTED'
    and public.asset_service_level_evidence_standing(
      p_organization_id,p_asset_id,p_evidence_item_id,p_evidence_snapshot);
$$;
revoke all on function public.asset_service_level_standing(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.asset_service_level_standing(uuid,uuid,uuid,jsonb)
  to authenticated;

-- Basis visibility applies to current AND originally captured risks, so an
-- evidence rebind cannot declassify the service narrative or historical audit.
create or replace function public.asset_service_level_basis_visible(
  p_organization_id uuid, p_evidence_item_id uuid, p_snapshot jsonb
)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and p_organization_id = case when auth.uid() is not null then app_current_org() else null end
    and (p_snapshot->>'risk_id' is null or
      public.can_read_risk(public.sync_text_as_uuid(p_snapshot->>'risk_id')))
    and (p_evidence_item_id is null or exists (
      select 1 from public.evidence_items e
      where e.id=p_evidence_item_id and e.organization_id=p_organization_id
        and (e.risk_id is null or public.can_read_risk(e.risk_id))
    ));
$$;
revoke all on function public.asset_service_level_basis_visible(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.asset_service_level_basis_visible(uuid,uuid,jsonb)
  to authenticated;

drop policy if exists asset_service_level_basis_read on public.asset_service_levels;
create policy asset_service_level_basis_read on public.asset_service_levels
as restrictive for select to authenticated using (
  organization_id = public.app_current_org()
  and public.asset_service_level_basis_visible(organization_id,evidence_item_id,evidence_snapshot)
);

-- Internal lock fence. Evidence and policy locks are NOWAIT because inverse
-- writers can already own a policy/evidence row and need the held asset FK.
-- The caller catches U2081 at the OUTER block to release every newly held lock.
create or replace function public.lock_asset_service_level_basis_internal(
  p_organization_id uuid, p_evidence_item_id uuid, p_snapshot jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.evidence_items%rowtype;
  r public.risks%rowtype;
  v_cursor uuid;
  v_root uuid;
  v_path_seen uuid[];
  v_locked uuid[] := '{}';
  v_origin jsonb;
begin
  select * into e from public.evidence_items
  where id=p_evidence_item_id and organization_id=p_organization_id
  for update nowait;
  if not found then raise exception 'evidence unavailable' using errcode='U2082'; end if;
  -- An amended/rebound live evidence row does not erase its captured risk.
  -- Lock BOTH canonical policy lineages; overlapping ancestors are already
  -- fenced, while cycles within either lineage are still refused.
  foreach v_root in array array[e.risk_id,public.sync_text_as_uuid(p_snapshot->>'risk_id')] loop
    v_cursor:=v_root;
    v_path_seen:='{}';
    while v_cursor is not null loop
      if v_cursor=any(v_path_seen) then raise exception 'risk lineage unavailable' using errcode='U2082'; end if;
      if v_cursor=any(v_locked) then exit; end if;
      v_path_seen:=array_append(v_path_seen,v_cursor);
      select * into r from public.risks
      where id=v_cursor and organization_id=p_organization_id for share nowait;
      if not found then raise exception 'risk unavailable' using errcode='U2082'; end if;
      v_locked:=array_append(v_locked,v_cursor);
      perform 1 from public.risk_stakeholder_views sv
      where sv.organization_id=p_organization_id and sv.risk_id=r.id
      order by sv.id for share of sv nowait;
      v_origin:=public.get_risk_secondary_origin_internal(r);
      if v_origin->'valid' is distinct from 'true'::jsonb then
        raise exception 'risk lineage unavailable' using errcode='U2082';
      end if;
      if v_origin->>'scenario_id' is not null then
        perform 1 from public.scenarios s
        where s.organization_id=p_organization_id
          and s.id=public.sync_text_as_uuid(v_origin->>'scenario_id')
        for share of s nowait;
        if not found then raise exception 'risk origin unavailable' using errcode='U2082'; end if;
      end if;
      v_cursor:=public.sync_text_as_uuid(v_origin->>'parent_id');
    end loop;
  end loop;
  return to_jsonb(e);
exception when lock_not_available then
  raise exception 'service consequence basis is busy' using errcode='U2081';
end;
$$;
revoke all on function public.lock_asset_service_level_basis_internal(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;

-- The existing audit_events_append_only protects all update/delete/truncate paths.
-- This additive insert guard protects only this new family's receipt identity.
create or replace function public.guard_asset_service_level_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon','authenticated','service_role')
    or auth.uid() is null
    or coalesce(current_setting('app.asset_service_level_write',true),'') not in ('record','verify') then
    raise exception 'service consequences require their governed named-human RPC'
      using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_asset_service_level_write()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_asset_service_level_write on public.asset_service_levels;
create trigger trg_asset_service_level_write before insert or update or delete
on public.asset_service_levels for each row
execute function public.guard_asset_service_level_write();

-- Row guards do not run for TRUNCATE. No caller, including the owner or a
-- privileged fixture connection, may erase this canonical state wholesale.
create or replace function public.asset_service_levels_no_truncate()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'canonical service consequences cannot be truncated' using errcode='42501';
end;
$$;
revoke all on function public.asset_service_levels_no_truncate()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_asset_service_levels_no_truncate on public.asset_service_levels;
create trigger trg_asset_service_levels_no_truncate before truncate on public.asset_service_levels
for each statement execute function public.asset_service_levels_no_truncate();

create or replace function public.guard_asset_service_level_audit_receipt()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.entity_type not in ('asset_service_level','asset_service_level_verification') then return new; end if;
  if current_user in ('anon','authenticated','service_role') or auth.uid() is null
    or coalesce(current_setting('app.asset_service_level_write',true),'') not in ('record','verify')
    or new.actor is distinct from auth.uid()::text
    or new.organization_id is distinct from public.app_current_org()
    or public.sync_text_as_uuid(new.event_data->>'command_id') is null then
    raise exception 'service-level audit receipt requires the governed command' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_asset_service_level_audit_receipt()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_asset_service_level_audit_receipt on public.audit_events;
create trigger trg_asset_service_level_audit_receipt before insert on public.audit_events
for each row execute function public.guard_asset_service_level_audit_receipt();

create unique index if not exists idx_asset_service_level_command_receipt
  on public.audit_events(organization_id,(event_data->>'command_id'))
  where entity_type in ('asset_service_level','asset_service_level_verification')
    and event_data->>'command_id' is not null;

drop policy if exists asset_service_level_audit_basis_read on public.audit_events;
create policy asset_service_level_audit_basis_read on public.audit_events
as restrictive for select to authenticated using (
  entity_type not in ('asset_service_level','asset_service_level_verification')
  or (organization_id=public.app_current_org()
    and public.asset_service_level_basis_visible(organization_id,
      public.sync_text_as_uuid(new_state->>'evidence_item_id'),new_state->'evidence_snapshot')
    and (previous_state is null or public.asset_service_level_basis_visible(organization_id,
      public.sync_text_as_uuid(previous_state->>'evidence_item_id'),previous_state->'evidence_snapshot')))
);

create or replace function public.record_asset_service_level(
  p_asset_id uuid,
  p_service_name text,
  p_beneficiary text,
  p_tolerable_downtime_hours numeric,
  p_consequence_class text,
  p_restoration_rank integer,
  p_notes text,
  p_basis text,
  p_evidence_item_id uuid,
  p_expected_version integer default null,
  p_command_id uuid default null,
  p_observed_actor_id uuid default null,
  p_observed_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := case when auth.uid() is not null then app_current_org() else null end;
  v_role text := public.app_current_role();
  v_uid uuid := auth.uid();
  v_current public.asset_service_levels%rowtype;
  v_saved public.asset_service_levels%rowtype;
  v_evidence_snapshot jsonb;
  v_locked_org uuid;
  v_exists boolean := false;
  v_version integer;
  v_request jsonb := jsonb_build_object(
    'p_asset_id',p_asset_id,'p_service_name',p_service_name,'p_beneficiary',p_beneficiary,
    'p_tolerable_downtime_hours',p_tolerable_downtime_hours,'p_consequence_class',p_consequence_class,
    'p_restoration_rank',p_restoration_rank,'p_notes',p_notes,'p_basis',p_basis,
    'p_evidence_item_id',p_evidence_item_id,'p_expected_version',p_expected_version,
    'p_command_id',p_command_id,'p_observed_actor_id',p_observed_actor_id,
    'p_observed_organization_id',p_observed_organization_id);
begin
  if p_command_id is null or p_observed_actor_id is distinct from v_uid
    or p_observed_organization_id is distinct from v_org then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','observed named actor and workspace must match the current request');
  end if;

  if exists (select 1 from public.audit_events a where a.organization_id=v_org
    and a.entity_type in ('asset_service_level','asset_service_level_verification')
    and a.event_data->>'command_id'=p_command_id::text) then
    return jsonb_build_object('outcome','unknown','command_id',p_command_id,
      'actor_id',v_uid,'organization_id',v_org);
  end if;

  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'executive', 'admin') then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
      'a named same-tenant reliability engineering or accountable management role must author the service consequence; AI identities are not accepted');
  end if;

  if not exists (
    select 1 from public.assets a
    where a.id = p_asset_id and a.organization_id = v_org
  ) then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'asset not found in this organization');
  end if;
  -- Serialize both existing rows and first creation on the canonical asset.
  -- This is an intentional input wait; final current authority is checked below.
  perform 1 from public.assets where id=p_asset_id and organization_id=v_org for update;
  select * into v_current from public.asset_service_levels
  where asset_id=p_asset_id and organization_id=v_org for update;
  v_exists:=found;
  -- A competing identical command can commit while this caller waits on asset.
  -- Recheck BEFORE any CAS/domain refusal so the original outcome stays unknown.
  if exists (select 1 from public.audit_events a where a.organization_id=v_org
    and a.entity_type in ('asset_service_level','asset_service_level_verification')
    and a.event_data->>'command_id'=p_command_id::text) then
    return jsonb_build_object('outcome','unknown','command_id',p_command_id,
      'actor_id',v_uid,'organization_id',v_org);
  end if;
  if coalesce(length(btrim(p_service_name)), 0) < 3 then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'service name must identify the delivered service');
  end if;
  if coalesce(length(btrim(p_beneficiary)), 0) < 3 then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'beneficiary must identify who or what receives the service');
  end if;
  if p_tolerable_downtime_hours is not null and (
    p_tolerable_downtime_hours < 0
    or p_tolerable_downtime_hours in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  ) then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'tolerable downtime must be a finite non-negative stated value or left unknown');
  end if;
  if p_consequence_class is null or p_consequence_class not in
    ('safety', 'environmental', 'regulatory', 'customer', 'production', 'financial') then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'unsupported consequence class');
  end if;
  if p_restoration_rank is not null and p_restoration_rank < 1 then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'restoration rank must be positive or left unknown');
  end if;
  if coalesce(length(btrim(p_notes)), 0) < 10 then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'notes must state the consequence and important limitations');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'basis must name the source and limitations (20 characters minimum)');
  end if;
  if v_exists and v_current.evidence_item_id is not null then
    perform public.lock_asset_service_level_basis_internal(v_org,v_current.evidence_item_id,v_current.evidence_snapshot);
  end if;
  v_evidence_snapshot:=public.lock_asset_service_level_basis_internal(v_org,p_evidence_item_id);
  -- Protect pending FK references without waiting behind inverse writers.
  perform 1 from auth.users u where u.id=v_uid for key share of u nowait;
  perform 1 from public.organizations o where o.id=v_org for key share of o nowait;
  select p.organization_id,lower(p.role) into v_locked_org,v_role
  from public.user_profiles p where p.id=v_uid for share of p nowait;
  if not found or auth.uid() is distinct from v_uid or v_locked_org is distinct from v_org
    or public.app_current_org() is distinct from v_org
    or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','current named same-tenant human membership is required');
  end if;
  -- Version knowledge and readable new evidence do not authorize blind
  -- replacement of an existing service whose live OR captured basis is hidden.
  -- Recheck only after every input wait and the final locked membership gate.
  if v_exists and public.asset_service_level_basis_visible(v_org,v_current.evidence_item_id,v_current.evidence_snapshot)
    is distinct from true then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','current service consequence is unavailable for replacement');
  end if;
  if public.asset_service_level_evidence_standing(v_org,p_asset_id,p_evidence_item_id,v_evidence_snapshot)
    is distinct from true then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
      'service consequence requires applicable verified same-tenant non-AI evidence');
  end if;
  if v_evidence_snapshot->>'document_id' is not null
    or v_evidence_snapshot->>'evidence_class'='DOCUMENTED' then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','typed document-purpose and primary obligation standing contract is pending; document-derived service claims cannot yet be admitted');
  end if;
  if p_tolerable_downtime_hours is not null or p_restoration_rank is not null then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','primary obligation/version/content standing contract is pending; tolerable downtime and restoration rank must remain unknown');
  end if;
  if v_exists then
    if p_expected_version is null or p_expected_version <> v_current.version then
      return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
        'service consequence changed since it was loaded; refresh before replacing the draft');
    end if;
    perform set_config('app.asset_service_level_write','record',true);
    update public.asset_service_levels
    set service_name = btrim(p_service_name),
        beneficiary = btrim(p_beneficiary),
        tolerable_downtime_hours = p_tolerable_downtime_hours,
        consequence_class = p_consequence_class,
        restoration_rank = p_restoration_rank,
        notes = btrim(p_notes),
        basis = btrim(p_basis),
        evidence_item_id = p_evidence_item_id,
        evidence_snapshot = v_evidence_snapshot,
        status = 'draft',
        version = version + 1,
        recorded_by = v_uid,
        reviewed_by = null,
        reviewed_at = null,
        review_note = null,
        updated_at = now()
    where asset_id = p_asset_id and organization_id = v_org
    returning * into v_saved;
    v_version:=v_saved.version;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
        'service consequence does not exist at the expected version');
    end if;
    perform set_config('app.asset_service_level_write','record',true);
    begin
      insert into public.asset_service_levels (
        asset_id, organization_id, service_name, beneficiary,
        tolerable_downtime_hours, consequence_class, restoration_rank,
        notes, basis, evidence_item_id, evidence_snapshot, status, version, recorded_by, updated_at
      ) values (
        p_asset_id, v_org, btrim(p_service_name), btrim(p_beneficiary),
        p_tolerable_downtime_hours, p_consequence_class, p_restoration_rank,
        btrim(p_notes), btrim(p_basis), p_evidence_item_id, v_evidence_snapshot,
        'draft', 1, v_uid, now()
      ) returning * into v_saved;
      v_version:=v_saved.version;
    exception when unique_violation then
      perform set_config('app.asset_service_level_write','',true);
      return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
        'service consequence was created concurrently; refresh before editing');
    end;
  end if;

  insert into public.audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'asset_service_level', v_uid::text, jsonb_build_object(
    'command_id',p_command_id,'actor_role',v_role,'request',v_request,
    'asset_id', p_asset_id, 'service_name', btrim(p_service_name),
    'consequence_class', p_consequence_class,
    'tolerable_downtime_hours', p_tolerable_downtime_hours,
    'restoration_rank', p_restoration_rank, 'version', v_version,
    'status', 'draft', 'evidence_item_id', p_evidence_item_id,
    'recorded_by', v_uid,
    'boundary', 'Draft service consequence only; it does not enter cascade or restoration analysis and grants no work, operating, risk-acceptance or restoration authority.'),
    case when v_exists then to_jsonb(v_current) else null end,to_jsonb(v_saved));
  perform set_config('app.asset_service_level_write','',true);

  return jsonb_build_object(
    'asset_id', p_asset_id, 'command_id',p_command_id, 'version', v_version, 'status', 'draft',
    'actor_id',v_uid,'organization_id',v_org,'operation','record','outcome','committed','request',v_request,
    'note', 'Service consequence recorded as a draft for independent human verification.');
exception
  when lock_not_available or sqlstate 'U2081' then
    -- Outer exception subtransaction rolls back writes/markers/ALL new locks.
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','service consequence basis is busy; reconcile or reload before a manual attempt');
  when sqlstate 'U2082' then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','service consequence requires applicable verified same-tenant non-AI evidence');
  when unique_violation then
    return jsonb_build_object('outcome','unknown','command_id',p_command_id,
      'actor_id',v_uid,'organization_id',v_org);
end
$$;

create or replace function public.verify_asset_service_level(
  p_asset_id uuid,
  p_expected_version integer,
  p_review_note text,
  p_command_id uuid default null,
  p_observed_actor_id uuid default null,
  p_observed_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := case when auth.uid() is not null then app_current_org() else null end;
  v_role text := public.app_current_role();
  v_uid uuid := auth.uid();
  v_level public.asset_service_levels%rowtype;
  v_saved public.asset_service_levels%rowtype;
  v_locked_org uuid;
  v_version integer;
  v_request jsonb := jsonb_build_object('p_asset_id',p_asset_id,'p_expected_version',p_expected_version,
    'p_review_note',p_review_note,'p_command_id',p_command_id,
    'p_observed_actor_id',p_observed_actor_id,'p_observed_organization_id',p_observed_organization_id);
begin
  if p_command_id is null or p_observed_actor_id is distinct from v_uid
    or p_observed_organization_id is distinct from v_org then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','observed named actor and workspace must match the current request');
  end if;

  if exists (select 1 from public.audit_events a where a.organization_id=v_org
    and a.entity_type in ('asset_service_level','asset_service_level_verification')
    and a.event_data->>'command_id'=p_command_id::text) then
    return jsonb_build_object('outcome','unknown','command_id',p_command_id,
      'actor_id',v_uid,'organization_id',v_org);
  end if;

  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'executive', 'admin') then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
      'independent service-consequence verification requires a named engineering or accountable management role');
  end if;

  perform 1 from public.assets where id=p_asset_id and organization_id=v_org for update;
  select * into v_level
  from public.asset_service_levels
  where asset_id = p_asset_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'service consequence not found in this organization');
  end if;
  if exists (select 1 from public.audit_events a where a.organization_id=v_org
    and a.entity_type in ('asset_service_level','asset_service_level_verification')
    and a.event_data->>'command_id'=p_command_id::text) then
    return jsonb_build_object('outcome','unknown','command_id',p_command_id,
      'actor_id',v_uid,'organization_id',v_org);
  end if;
  if v_level.status <> 'draft' then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'only a current draft can be verified');
  end if;
  if p_expected_version is null or p_expected_version <> v_level.version then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
      'service consequence changed since review began; refresh before verifying');
  end if;
  if v_level.recorded_by is null then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
      'legacy service consequence has no named author and must be re-recorded before verification');
  end if;
  if v_level.recorded_by = v_uid then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'the author cannot verify their own service consequence');
  end if;
  if coalesce(length(btrim(p_review_note)), 0) < 20 then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error', 'verification note must state the independent review basis');
  end if;
  perform public.lock_asset_service_level_basis_internal(v_org,v_level.evidence_item_id,v_level.evidence_snapshot);
  perform 1 from auth.users u where u.id=v_uid for key share of u nowait;
  select p.organization_id,lower(p.role) into v_locked_org,v_role
  from public.user_profiles p where p.id=v_uid for share of p nowait;
  if not found or auth.uid() is distinct from v_uid or v_locked_org is distinct from v_org
    or public.app_current_org() is distinct from v_org
    or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','current named same-tenant human membership is required');
  end if;
  if public.asset_service_level_standing(v_org,p_asset_id,v_level.evidence_item_id,v_level.evidence_snapshot)
    is distinct from true then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error',
      'the linked evidence is no longer verified and applicable; verification is refused');
  end if;
  if v_level.evidence_snapshot->>'document_id' is not null
    or v_level.evidence_snapshot->>'evidence_class'='DOCUMENTED'
    or v_level.tolerable_downtime_hours is not null or v_level.restoration_rank is not null then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','primary document/obligation standing contract remains pending');
  end if;
  perform set_config('app.asset_service_level_write','verify',true);
  update public.asset_service_levels
  set status = 'verified',
      version = version + 1,
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_note = btrim(p_review_note),
      updated_at = now()
  where asset_id = p_asset_id and organization_id = v_org
  returning * into v_saved;
  v_version:=v_saved.version;

  insert into public.audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'asset_service_level_verification', v_uid::text, jsonb_build_object(
    'command_id',p_command_id,'actor_role',v_role,'request',v_request,
    'asset_id', p_asset_id, 'service_name', v_level.service_name,
    'version', v_version, 'status', 'verified',
    'recorded_by', v_level.recorded_by, 'reviewed_by', v_uid,
    'evidence_item_id', v_level.evidence_item_id,
    'boundary', 'Independent verification admits the stated service consequence to dependency analysis only; it does not authorize work, operation, risk acceptance or restoration.'),
    to_jsonb(v_level),to_jsonb(v_saved));
  perform set_config('app.asset_service_level_write','',true);

  return jsonb_build_object(
    'asset_id', p_asset_id, 'command_id',p_command_id, 'version', v_version, 'status', 'verified',
    'actor_id',v_uid,'organization_id',v_org,'operation','verify','outcome','committed','request',v_request,
    'note', 'Service consequence independently verified and admitted to dependency analysis.');
exception
  when lock_not_available or sqlstate 'U2081' then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','service consequence basis is busy; reconcile or reload before a manual attempt');
  when sqlstate 'U2082' then
    return jsonb_build_object('outcome','refused','command_id',p_command_id,'actor_id',v_uid,'organization_id',v_org,'error','the linked evidence is no longer verified and applicable; verification is refused');
  when unique_violation then
    return jsonb_build_object('outcome','unknown','command_id',p_command_id,
      'actor_id',v_uid,'organization_id',v_org);
end
$$;

revoke all on function public.record_asset_service_level(
  uuid, text, text, numeric, text, integer, text, text, uuid, integer,uuid,uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.verify_asset_service_level(uuid, integer, text,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_asset_service_level(
  uuid, text, text, numeric, text, integer, text, text, uuid, integer,uuid,uuid,uuid
) to authenticated;
grant execute on function public.verify_asset_service_level(uuid, integer, text,uuid,uuid,uuid)
  to authenticated;

comment on function public.record_asset_service_level(
  uuid, text, text, numeric, text, integer, text, text, uuid, integer,uuid,uuid,uuid
) is 'Records or replaces a same-tenant service consequence as a draft. Unknown downtime and restoration rank remain null; every edit invalidates prior verification.';
comment on function public.verify_asset_service_level(uuid, integer, text,uuid,uuid,uuid) is
  'Independently verifies the current version against still-valid evidence, admitting it to dependency analysis without granting operational authority.';

-- Editor projections use the caller's existing RLS, not a copied auth store.
-- A share lock on the canonical current profile prevents membership changing
-- between the expected-context check and returning this request's rows.
create or replace function public.get_asset_service_level_editor(
  p_observed_actor_id uuid, p_observed_organization_id uuid,
  p_section text, p_asset_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_org uuid; v_rows jsonb;
begin
  select p.organization_id into v_org from public.user_profiles p
  where p.id=auth.uid() for share of p nowait;
  if not found or auth.uid() is null
    or p_observed_actor_id is distinct from auth.uid()
    or p_observed_organization_id is distinct from public.app_current_org()
    or v_org is distinct from p_observed_organization_id then
    return jsonb_build_object('error','observed named actor and workspace must match the current request');
  end if;
  if p_section='assets' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]'::jsonb) into v_rows
    from (select a.id,a.tag,a.name from public.assets a
      where a.organization_id=v_org order by a.name,a.id limit 500) x;
  elsif p_section='levels' then
    select coalesce(jsonb_agg((to_jsonb(s)-'evidence_snapshot'-'organization_id')
      ||jsonb_build_object('analysis_eligible',s.status='verified'
        and public.asset_service_level_standing(s.organization_id,s.asset_id,s.evidence_item_id,s.evidence_snapshot)
        and s.tolerable_downtime_hours is null and s.restoration_rank is null)
      order by s.updated_at desc,s.asset_id),'[]'::jsonb) into v_rows
    from public.asset_service_levels s where s.organization_id=v_org;
  elsif p_section='evidence' then
    if not exists(select 1 from public.assets a where a.id=p_asset_id and a.organization_id=v_org) then
      return jsonb_build_object('error','asset not found in this organization');
    end if;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb) into v_rows
    from (select e.id,e.asset_id,e.description,e.source_system,e.evidence_class,e.created_at
      from public.evidence_items e where e.organization_id=v_org
        and public.asset_service_level_evidence_standing(v_org,p_asset_id,e.id,null)
      order by e.created_at desc,e.id limit 200) x;
  elsif p_section='history' then
    if not exists(select 1 from public.assets a where a.id=p_asset_id and a.organization_id=v_org) then
      return jsonb_build_object('error','asset not found in this organization');
    end if;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb) into v_rows
    from (select a.id,a.created_at,a.entity_type,a.actor,a.previous_state,a.new_state,
        a.event_data,a.approval_reference from public.audit_events a
      where a.organization_id=v_org
        and a.entity_type in ('asset_service_level','asset_service_level_verification')
        and a.new_state->>'asset_id'=p_asset_id::text) x;
  else
    return jsonb_build_object('error','unsupported service consequence editor section');
  end if;
  return jsonb_build_object('actor_id',auth.uid(),'organization_id',v_org,
    'section',p_section,'rows',v_rows);
exception when lock_not_available then
  return jsonb_build_object('error','current workspace membership is busy; reload manually');
end;
$$;
revoke all on function public.get_asset_service_level_editor(uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_asset_service_level_editor(uuid,uuid,text,uuid) to authenticated;

-- The one immutable canonical audit is the only reconciliation authority.
-- A missing, invisible or another actor's receipt stays unknown, never replayable.
create or replace function public.get_asset_service_level_command(
  p_command_id uuid,p_observed_actor_id uuid,p_observed_organization_id uuid
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_org uuid; v_receipt public.audit_events%rowtype;
begin
  select p.organization_id into v_org from public.user_profiles p
  where p.id=auth.uid() for share of p nowait;
  if not found or auth.uid() is null or p_command_id is null
    or p_observed_actor_id is distinct from auth.uid()
    or p_observed_organization_id is distinct from public.app_current_org()
    or v_org is distinct from p_observed_organization_id then
    return jsonb_build_object('error','observed named actor and workspace must match the current request');
  end if;
  select a.* into v_receipt from public.audit_events a
  where a.organization_id=v_org and a.actor = auth.uid()::text
    and a.entity_type in ('asset_service_level','asset_service_level_verification')
    and a.event_data->>'command_id' = p_command_id::text;
  if not found then
    return jsonb_build_object('outcome','unknown','command_id',p_command_id,
      'actor_id',auth.uid(),'organization_id',v_org);
  end if;
  return jsonb_build_object('outcome','committed','command_id',p_command_id,
    'actor_id',auth.uid(),'organization_id',v_org,
    'asset_id',v_receipt.new_state->>'asset_id',
    'version',v_receipt.new_state->'version','status',v_receipt.new_state->>'status',
    'request',v_receipt.event_data->'request',
    'operation',case v_receipt.entity_type when 'asset_service_level' then 'record' else 'verify' end);
exception when lock_not_available then
  return jsonb_build_object('error','current workspace membership is busy; reconcile manually');
end;
$$;
revoke all on function public.get_asset_service_level_command(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_asset_service_level_command(uuid,uuid,uuid) to authenticated;

-- Read-only choices for NEW optional U13 context links. This projection grants
-- no normative authority and never rewrites or invalidates historical U13 FKs.
create or replace view public.current_asset_service_level_references
with (security_invoker=true) as
select sl.asset_id,sl.service_name from public.asset_service_levels sl
where sl.organization_id=public.app_current_org() and sl.status='verified'
  and public.asset_service_level_standing(sl.organization_id,sl.asset_id,sl.evidence_item_id,sl.evidence_snapshot)
  and sl.tolerable_downtime_hours is null and sl.restoration_rank is null;
revoke all on public.current_asset_service_level_references from public,anon,authenticated,service_role;
grant select on public.current_asset_service_level_references to authenticated;

-- Only independently verified CURRENT consequences affect graph conclusions.
-- Numeric normative values remain inadmissible pending the shared typed contract.
create or replace function public.get_dependency_graph()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'tag', a.tag, 'name', a.name,
        'criticality', a.criticality, 'assetClass', a.asset_class,
        'serviceName', sl.service_name,
        'consequenceClass', sl.consequence_class,
        'tolerableDowntimeHours', sl.tolerable_downtime_hours,
        'restorationRank', sl.restoration_rank
      ) order by a.name)
      from public.assets a
      left join public.asset_service_levels sl
        on sl.asset_id = a.id and sl.organization_id = a.organization_id
       and sl.status = 'verified'
       and public.asset_service_level_standing(sl.organization_id,sl.asset_id,sl.evidence_item_id,sl.evidence_snapshot)
       and sl.tolerable_downtime_hours is null and sl.restoration_rank is null
      where a.organization_id = public.app_current_org()
        and (exists (select 1 from public.asset_dependencies d
                     where d.organization_id = a.organization_id
                       and (d.dependent_asset_id = a.id or d.supplier_asset_id = a.id))
             or sl.asset_id is not null)
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dependent', d.dependent_asset_id,
        'supplier', d.supplier_asset_id,
        'kind', d.dependency_kind,
        'redundancyGroup', d.redundancy_group,
        'minRequired', d.min_suppliers_required,
        'capacitySharePct', d.capacity_share_pct,
        'evidence', d.evidence,
        'source', d.source
      ))
      from public.asset_dependencies d
      where d.organization_id = public.app_current_org()
    ), '[]'::jsonb),
    'commonCauseGroups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'causeKind', g.cause_kind,
        'members', coalesce((select jsonb_agg(m.asset_id)
                             from public.common_cause_members m where m.group_id = g.id), '[]'::jsonb)
      ))
      from public.common_cause_groups g
      where g.organization_id = public.app_current_org()
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_dependency_coverage()
returns table (
  total_assets bigint,
  assets_with_edges bigint,
  coverage_pct numeric,
  edge_count bigint,
  demo_edges bigint,
  unevidenced_edges bigint,
  common_cause_groups_defined bigint,
  assets_with_service_level bigint,
  open_candidates bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (
    select count(*)::bigint n from public.assets
    where organization_id = public.app_current_org()
  ),
  linked as (
    select count(distinct id)::bigint n from (
      select dependent_asset_id id from public.asset_dependencies
      where organization_id = public.app_current_org()
      union
      select supplier_asset_id from public.asset_dependencies
      where organization_id = public.app_current_org()
    ) x
  ),
  e as (
    select count(*)::bigint n,
           count(*) filter (where source = 'demo')::bigint demo,
           count(*) filter (where evidence is null or btrim(evidence) = '')::bigint unevidenced
    from public.asset_dependencies
    where organization_id = public.app_current_org()
  )
  select a.n,
         linked.n,
         case when a.n = 0 then 0 else round(linked.n * 100.0 / a.n, 1) end,
         e.n,
         e.demo,
         e.unevidenced,
         (select count(*) from public.common_cause_groups
          where organization_id = public.app_current_org()),
         (select count(*) from public.asset_service_levels sl
          where sl.organization_id = public.app_current_org() and sl.status = 'verified'
            and public.asset_service_level_standing(sl.organization_id,sl.asset_id,sl.evidence_item_id,sl.evidence_snapshot)
            and sl.tolerable_downtime_hours is null and sl.restoration_rank is null),
         (select count(*) from public.dependency_candidates
          where organization_id = public.app_current_org() and status = 'open'),
         case
           when e.n = 0 then
             'No dependency edges are recorded. Any cascade or single-point-of-failure result below is empty because the graph is empty, not because the site is resilient.'
           when linked.n * 100.0 / greatest(a.n, 1) < 25 then
             'Only ' || round(linked.n * 100.0 / greatest(a.n, 1), 1) || '% of assets appear in the graph. Findings cover the mapped part of the plant and say nothing about the rest.'
           else
             round(linked.n * 100.0 / greatest(a.n, 1), 1) || '% of assets appear in the dependency graph across '
             || e.n || ' edges'
             || case when e.unevidenced > 0
                     then ', ' || e.unevidenced || ' of them with no recorded evidence' else '' end || '.'
         end
         || case when e.demo > 0 then ' ' || e.demo || ' of these edges are ILLUSTRATIVE DEMO edges, not a mapping of a real plant, and every finding drawn from them demonstrates the method rather than describing equipment.' else '' end
  from a, linked, e;
$$;

grant execute on function public.get_dependency_graph() to authenticated;
grant execute on function public.get_dependency_coverage() to authenticated;

notify pgrst, 'reload schema';
