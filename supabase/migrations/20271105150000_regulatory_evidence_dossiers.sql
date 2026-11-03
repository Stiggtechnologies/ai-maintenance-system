-- E4.09 — regulatory evidence.
--
-- The 2026-08-09 governance slice left this row yellow because a jurisdiction
-- rule is the operator's legal determination. This migration does not supply
-- one. It lets a named human assemble an inspection dossier against a
-- requirement their organization has already adopted, cite canonical evidence
-- a different human has already verified, and have a different human release
-- that exact dossier. Release records that the dossier was presented for
-- inspection. It does not decide a legal outcome.
--
-- Canonical reuse:
--   * evidence_items remains the evidence model;
--   * capability_pack_layers remains the jurisdiction-requirement store;
--   * audit_events remains the audit ledger;
--   * organizations.jurisdiction remains the tenant's stated jurisdiction.
-- The only new relations are the dossier and the exact evidence it cites.
-- No interval, sample size, statute, or compliance finding is seeded.
-- A 40-item ceiling is a request-size bound, not a regulatory sample size.

create table if not exists public.regulatory_evidence_dossiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  capability_pack_layer_id uuid not null
    references public.capability_pack_layers(id) on delete restrict,
  capability_pack_layer_version integer not null
    check (capability_pack_layer_version > 0),
  requirement_key text not null
    check (requirement_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  jurisdiction text not null check (length(btrim(jurisdiction)) >= 2),
  title text not null check (length(btrim(title)) between 5 and 200),
  purpose text not null check (length(btrim(purpose)) between 20 and 4000),
  status text not null check (status in ('assembled', 'released', 'withdrawn')),
  version integer not null check (version > 0),
  supersedes_id uuid references public.regulatory_evidence_dossiers(id) on delete restrict,
  assembled_by uuid not null references auth.users(id),
  assembled_at timestamptz not null default now(),
  released_by uuid references auth.users(id),
  released_at timestamptz,
  release_basis text,
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  register_ref text not null default 'E4.09' check (register_ref = 'E4.09'),
  constraint regulatory_evidence_version_chain check (
    (version = 1 and supersedes_id is null)
    or (version > 1 and supersedes_id is not null)
  ),
  constraint regulatory_evidence_status_fields check (
    (
      status = 'assembled'
      and released_by is null and released_at is null and release_basis is null
      and withdrawn_by is null and withdrawn_at is null and withdrawal_reason is null
    )
    or (
      status = 'released'
      and released_by is not null and released_at is not null
      and length(btrim(release_basis)) >= 20
      and released_by <> assembled_by
      and withdrawn_by is null and withdrawn_at is null and withdrawal_reason is null
    )
    or (
      status = 'withdrawn'
      and withdrawn_by = assembled_by and withdrawn_at is not null
      and length(btrim(withdrawal_reason)) >= 20
      and released_by is null and released_at is null and release_basis is null
    )
  )
);

create unique index if not exists idx_regulatory_evidence_one_successor
  on public.regulatory_evidence_dossiers(supersedes_id)
  where supersedes_id is not null;
create unique index if not exists idx_regulatory_evidence_one_assembled
  on public.regulatory_evidence_dossiers(
    organization_id, capability_pack_layer_id, requirement_key
  )
  where status = 'assembled';
create index if not exists idx_regulatory_evidence_lookup
  on public.regulatory_evidence_dossiers(
    organization_id, capability_pack_layer_id, requirement_key, version desc
  );

create table if not exists public.regulatory_evidence_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dossier_id uuid not null
    references public.regulatory_evidence_dossiers(id) on delete cascade,
  evidence_item_id uuid not null
    references public.evidence_items(id) on delete restrict,
  citation_basis text not null check (length(btrim(citation_basis)) between 20 and 4000),
  attached_by uuid not null references auth.users(id),
  attached_at timestamptz not null default now(),
  unique (dossier_id, evidence_item_id)
);

create index if not exists idx_regulatory_evidence_items_evidence
  on public.regulatory_evidence_items(organization_id, evidence_item_id);

alter table public.regulatory_evidence_dossiers enable row level security;
alter table public.regulatory_evidence_items enable row level security;

drop policy if exists regulatory_evidence_dossiers_read
  on public.regulatory_evidence_dossiers;
create policy regulatory_evidence_dossiers_read
  on public.regulatory_evidence_dossiers
  for select to authenticated
  using (organization_id = public.app_current_org());

drop policy if exists regulatory_evidence_items_read
  on public.regulatory_evidence_items;
create policy regulatory_evidence_items_read
  on public.regulatory_evidence_items
  for select to authenticated
  using (organization_id = public.app_current_org());

revoke all on table public.regulatory_evidence_dossiers
  from public, anon, authenticated, service_role;
revoke all on table public.regulatory_evidence_items
  from public, anon, authenticated, service_role;
grant select on table public.regulatory_evidence_dossiers to authenticated;
grant select on table public.regulatory_evidence_items to authenticated;

create or replace function public.guard_regulatory_evidence_dossier_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'Regulatory evidence dossiers are immutable inspection records and cannot be truncated'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if coalesce(current_setting('app.regulatory_evidence_writer', true), '') <> 'governed' then
    raise exception 'Regulatory evidence dossiers change only through the governed E4.09 writer'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Regulatory evidence dossiers are retained and cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.capability_pack_layer_id is distinct from old.capability_pack_layer_id
       or new.requirement_key is distinct from old.requirement_key
       or new.assembled_by is distinct from old.assembled_by
       or new.assembled_at is distinct from old.assembled_at
       or new.register_ref is distinct from old.register_ref then
      raise exception 'Regulatory evidence identity and assembly accountability are immutable'
        using errcode = 'check_violation';
    end if;
    if old.status = 'released' or old.status = 'withdrawn'
       or new.status is distinct from old.status then
      if old.status = 'assembled' and new.status = 'released' then
        if new.title is distinct from old.title
           or new.purpose is distinct from old.purpose
           or new.capability_pack_layer_version is distinct from old.capability_pack_layer_version
           or new.jurisdiction is distinct from old.jurisdiction
           or new.version is distinct from old.version
           or new.supersedes_id is distinct from old.supersedes_id
           or new.withdrawn_by is not null
           or new.withdrawn_at is not null
           or new.withdrawal_reason is not null
           or new.released_by is null
           or new.released_at is null
           or length(btrim(coalesce(new.release_basis, ''))) < 20
           or new.released_by = old.assembled_by then
          raise exception 'Release cannot change the assembled dossier and requires a different named human'
            using errcode = 'check_violation';
        end if;
      elsif old.status = 'assembled' and new.status = 'withdrawn' then
        if new.title is distinct from old.title
           or new.purpose is distinct from old.purpose
           or new.capability_pack_layer_version is distinct from old.capability_pack_layer_version
           or new.jurisdiction is distinct from old.jurisdiction
           or new.version is distinct from old.version
           or new.supersedes_id is distinct from old.supersedes_id
           or new.released_by is not null
           or new.released_at is not null
           or new.release_basis is not null
           or new.withdrawn_by is distinct from old.assembled_by
           or new.withdrawn_at is null
           or length(btrim(coalesce(new.withdrawal_reason, ''))) < 20 then
          raise exception 'Only the assembler can withdraw an unreleased dossier, and withdrawal does not release it'
            using errcode = 'check_violation';
        end if;
      else
        raise exception 'A regulatory evidence dossier can only be released or withdrawn from assembled'
          using errcode = 'check_violation';
      end if;
    elsif new.released_by is not null or new.released_at is not null
          or new.release_basis is not null
          or new.withdrawn_by is not null or new.withdrawn_at is not null
          or new.withdrawal_reason is not null then
      raise exception 'Release and withdrawal columns are set only on that transition'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' and new.status <> 'assembled' then
    raise exception 'A regulatory evidence dossier starts assembled and unreleased'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.guard_regulatory_evidence_item_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_status text;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'Regulatory evidence citations cannot be truncated'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if coalesce(current_setting('app.regulatory_evidence_writer', true), '') <> 'governed' then
    raise exception 'Regulatory evidence citations change only through the governed E4.09 writer'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Regulatory evidence citations are immutable'
      using errcode = 'check_violation';
  end if;
  select d.status into v_status
  from public.regulatory_evidence_dossiers d
  where d.id = case when tg_op = 'DELETE' then old.dossier_id else new.dossier_id end
    and d.organization_id = case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if v_status is distinct from 'assembled' then
    raise exception 'Citations can change only while the dossier is assembled and unreleased'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_regulatory_evidence_dossier_write
  on public.regulatory_evidence_dossiers;
create trigger trg_guard_regulatory_evidence_dossier_write
  before insert or update or delete on public.regulatory_evidence_dossiers
  for each row execute function public.guard_regulatory_evidence_dossier_write();

drop trigger if exists trg_guard_regulatory_evidence_dossier_truncate
  on public.regulatory_evidence_dossiers;
create trigger trg_guard_regulatory_evidence_dossier_truncate
  before truncate on public.regulatory_evidence_dossiers
  for each statement execute function public.guard_regulatory_evidence_dossier_write();

drop trigger if exists trg_guard_regulatory_evidence_item_write
  on public.regulatory_evidence_items;
create trigger trg_guard_regulatory_evidence_item_write
  before insert or update or delete on public.regulatory_evidence_items
  for each row execute function public.guard_regulatory_evidence_item_write();

drop trigger if exists trg_guard_regulatory_evidence_item_truncate
  on public.regulatory_evidence_items;
create trigger trg_guard_regulatory_evidence_item_truncate
  before truncate on public.regulatory_evidence_items
  for each statement execute function public.guard_regulatory_evidence_item_write();

revoke all on function public.guard_regulatory_evidence_dossier_write()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_regulatory_evidence_item_write()
  from public, anon, authenticated, service_role;

create or replace function public.assert_regulatory_evidence_actor(p_action text)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_org is null or v_uid is null then
    raise exception '% requires an authenticated organization member', p_action
      using errcode = 'insufficient_privilege';
  end if;
  select role into v_role
  from public.user_profiles
  where id = v_uid and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception 'AI cannot %; a named human must assemble or release regulatory evidence', p_action
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(v_role, '') not in (
    'admin', 'executive', 'maintenance_manager', 'reliability_engineer'
  ) then
    raise exception '% requires an administrator, executive, maintenance manager, or reliability engineer', p_action
      using errcode = 'insufficient_privilege';
  end if;
  return v_uid;
end $$;

revoke all on function public.assert_regulatory_evidence_actor(text)
  from public, anon, authenticated, service_role;

create or replace function public.regulatory_evidence_refusal()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'legalComplianceDetermined', false,
    'workAuthorized', false,
    'riskAccepted', false,
    'operatingLimitChanged', false,
    'returnToServiceAuthorized', false
  );
$$;

revoke all on function public.regulatory_evidence_refusal()
  from public, anon, authenticated, service_role;

create or replace function public.assemble_regulatory_evidence_pack(p_pack jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid;
  v_role text := public.app_current_role();
  v_layer uuid;
  v_expected integer;
  v_supersedes uuid;
  v_key text;
  v_title text;
  v_purpose text;
  v_items jsonb;
  l public.capability_pack_layers%rowtype;
  req jsonb;
  prior public.regulatory_evidence_dossiers%rowtype;
  existing public.regulatory_evidence_dossiers%rowtype;
  v_id uuid;
  v_version integer;
  v_count integer;
  v_distinct integer;
  item jsonb;
  v_evidence uuid;
  v_basis text;
  v_requested jsonb;
  v_stored jsonb;
  v_revised boolean := false;
begin
  v_actor := public.assert_regulatory_evidence_actor('assemble a regulatory evidence dossier');
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal() <> 'aal2' then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Regulatory evidence assembly requires a verified factor and an AAL2 session'
    );
  end if;
  begin
    v_layer := nullif(p_pack->>'capability_pack_layer_id', '')::uuid;
    v_expected := nullif(p_pack->>'expected_layer_version', '')::integer;
    v_supersedes := nullif(p_pack->>'supersedes_id', '')::uuid;
  exception when others then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Jurisdiction layer, expected version and superseded dossier must be valid'
    );
  end;
  v_key := nullif(btrim(p_pack->>'requirement_key'), '');
  v_title := nullif(btrim(p_pack->>'title'), '');
  v_purpose := nullif(btrim(p_pack->>'purpose'), '');
  v_items := p_pack->'items';
  if v_layer is null or v_expected is null or v_expected <= 0 or v_key is null
     or v_title is null or length(v_title) < 5 or length(v_title) > 200
     or v_purpose is null or length(v_purpose) < 20 or length(v_purpose) > 4000 then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'An adopted requirement, a title and a 20 character inspection purpose are required'
    );
  end if;
  if v_key !~ '^[a-z][a-z0-9_]{2,79}$' then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Requirement key is not a jurisdiction-layer key'
    );
  end if;
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) < 1 then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Cite at least one independently verified evidence item'
    );
  end if;
  if jsonb_array_length(v_items) > 40 then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Cite at most 40 evidence items per dossier request'
    );
  end if;
  select count(*), count(distinct value->>'evidence_item_id')
    into v_count, v_distinct
  from jsonb_array_elements(v_items);
  if v_count <> v_distinct then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Each evidence item can be cited once in a dossier'
    );
  end if;

  select * into l
  from public.capability_pack_layers
  where id = v_layer and organization_id = v_org and layer_kind = 'jurisdiction'
    and status = 'adopted'
    and jurisdiction = (
      select o.jurisdiction from public.organizations o where o.id = v_org
    )
  for update;
  if not found then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'An adopted same-tenant jurisdiction layer is required'
    );
  end if;
  if l.version <> v_expected then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Jurisdiction requirement layer changed after it was loaded; refresh before assembling'
    );
  end if;
  select value into req
  from jsonb_array_elements(l.configuration->'jurisdiction_requirements')
  where value->>'key' = v_key
  limit 1;
  if req is null then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Requirement key is absent from that exact adopted jurisdiction layer'
    );
  end if;
  if req->>'requirement_class' not in ('regulatory', 'statutory')
     or req->>'applicability' <> 'applicable'
     or req->>'obligation' not in ('mandatory', 'advisory') then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Only an applicable regulatory or statutory requirement can receive a dossier'
    );
  end if;

  for item in select value from jsonb_array_elements(v_items)
  loop
    begin
      v_evidence := nullif(item->>'evidence_item_id', '')::uuid;
    exception when others then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'error', 'Each citation needs a valid evidence item'
      );
    end;
    v_basis := nullif(btrim(item->>'citation_basis'), '');
    if v_evidence is null or v_basis is null
       or length(v_basis) < 20 or length(v_basis) > 4000 then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'error', 'Each citation needs a 20 character basis written for this requirement'
      );
    end if;
    if not exists (
      select 1
      from public.evidence_items e
      join public.user_profiles verifier
        on verifier.id = e.verified_by and verifier.organization_id = v_org
       and verifier.role is distinct from 'ai_admin'
      where e.id = v_evidence and e.organization_id = v_org
        and e.verification_status = 'verified'
        and e.verified_by is not null and e.verified_at is not null
        and e.verified_by <> v_actor
    ) then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'error', 'Each cited item must be same-tenant canonical evidence independently verified by another named human'
      );
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object(
    'evidenceItemId', lower(value->>'evidence_item_id'),
    'citationBasis', btrim(value->>'citation_basis')
  ) order by lower(value->>'evidence_item_id'))
    into v_requested
  from jsonb_array_elements(v_items);

  if v_supersedes is null then
    if exists (
      select 1 from public.regulatory_evidence_dossiers d
      where d.organization_id = v_org
        and d.capability_pack_layer_id = l.id
        and d.requirement_key = v_key
        and d.status = 'released'
        and not exists (
          select 1 from public.regulatory_evidence_dossiers s
          where s.organization_id = v_org and s.supersedes_id = d.id
            and s.status = 'released'
        )
    ) then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'error', 'A released dossier already covers this requirement; assemble the next version against it'
      );
    end if;
    v_version := 1;
  else
    select * into prior
    from public.regulatory_evidence_dossiers
    where id = v_supersedes and organization_id = v_org
    for update;
    if not found or prior.status <> 'released'
       or prior.capability_pack_layer_id <> l.id
       or prior.requirement_key <> v_key then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'error', 'The next version must supersede a released dossier for the same requirement'
      );
    end if;
    if exists (
      select 1 from public.regulatory_evidence_dossiers s
      where s.organization_id = v_org and s.supersedes_id = prior.id
        and s.status = 'released'
    ) then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'error', 'Assemble the next version against the latest released dossier'
      );
    end if;
    v_version := prior.version + 1;
  end if;

  select * into existing
  from public.regulatory_evidence_dossiers
  where organization_id = v_org
    and capability_pack_layer_id = l.id
    and requirement_key = v_key
    and status = 'assembled'
  for update;

  if found then
    select jsonb_agg(jsonb_build_object(
      'evidenceItemId', lower(i.evidence_item_id::text),
      'citationBasis', btrim(i.citation_basis)
    ) order by lower(i.evidence_item_id::text))
      into v_stored
    from public.regulatory_evidence_items i
    where i.dossier_id = existing.id and i.organization_id = v_org;
    if existing.assembled_by = v_actor
       and existing.capability_pack_layer_version = l.version
       and existing.version = v_version
       and existing.supersedes_id is not distinct from v_supersedes
       and btrim(existing.title) = v_title
       and btrim(existing.purpose) = v_purpose
       and v_stored = v_requested then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'id', existing.id,
        'status', 'assembled',
        'version', existing.version,
        'idempotent', true,
        'revised', false
      );
    end if;
    if existing.assembled_by <> v_actor then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'error', 'An unreleased dossier already exists, and only the person who assembled it can revise it'
      );
    end if;
    if existing.supersedes_id is distinct from v_supersedes
       and exists (
         select 1 from public.regulatory_evidence_dossiers s
         where s.supersedes_id = v_supersedes and s.id <> existing.id
       ) then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'error', 'Another dossier already continues that released version'
      );
    end if;
  end if;

  perform set_config('app.regulatory_evidence_writer', 'governed', true);
  if existing.id is not null then
    update public.regulatory_evidence_dossiers
    set capability_pack_layer_version = l.version,
        jurisdiction = l.jurisdiction,
        title = v_title,
        purpose = v_purpose,
        version = v_version,
        supersedes_id = v_supersedes
    where id = existing.id and organization_id = v_org
    returning id into v_id;
    delete from public.regulatory_evidence_items
    where dossier_id = v_id and organization_id = v_org;
    v_revised := true;
  else
    insert into public.regulatory_evidence_dossiers (
      organization_id, capability_pack_layer_id, capability_pack_layer_version,
      requirement_key, jurisdiction, title, purpose, status, version,
      supersedes_id, assembled_by
    ) values (
      v_org, l.id, l.version, v_key, l.jurisdiction, v_title, v_purpose,
      'assembled', v_version, v_supersedes, v_actor
    ) returning id into v_id;
  end if;

  for item in select value from jsonb_array_elements(v_items)
  loop
    insert into public.regulatory_evidence_items (
      organization_id, dossier_id, evidence_item_id, citation_basis, attached_by
    ) values (
      v_org, v_id, (item->>'evidence_item_id')::uuid,
      btrim(item->>'citation_basis'), v_actor
    );
  end loop;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'regulatory_evidence_dossier', v_role,
    jsonb_build_object(
      'action', case when v_revised then 'revised' else 'assembled' end,
      'dossierId', v_id,
      'version', v_version,
      'actorId', v_actor,
      'layerId', l.id,
      'layerVersion', l.version,
      'requirementKey', v_key,
      'evidenceCount', v_count,
      'legalComplianceDetermined', false,
      'workAuthorized', false,
      'riskAccepted', false,
      'operatingLimitChanged', false,
      'returnToServiceAuthorized', false
    ),
    case when v_revised then to_jsonb(existing) else null end,
    (select to_jsonb(d) from public.regulatory_evidence_dossiers d where d.id = v_id)
  );

  return public.regulatory_evidence_refusal() || jsonb_build_object(
    'id', v_id,
    'status', 'assembled',
    'version', v_version,
    'idempotent', false,
    'revised', v_revised
  );
exception when unique_violation then
  return public.regulatory_evidence_refusal() || jsonb_build_object(
    'error', 'An unreleased dossier or a successor already exists for this requirement'
  );
end $$;

create or replace function public.release_regulatory_evidence_pack(p_release jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid;
  v_role text := public.app_current_role();
  v_id uuid;
  v_expected integer;
  v_basis text;
  d public.regulatory_evidence_dossiers%rowtype;
  l public.capability_pack_layers%rowtype;
  v_before jsonb;
begin
  v_actor := public.assert_regulatory_evidence_actor('release a regulatory evidence dossier');
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal() <> 'aal2' then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Regulatory evidence release requires a verified factor and an AAL2 session'
    );
  end if;
  begin
    v_id := nullif(p_release->>'dossier_id', '')::uuid;
    v_expected := nullif(p_release->>'expected_version', '')::integer;
  exception when others then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Dossier and expected version must be valid'
    );
  end;
  v_basis := nullif(btrim(p_release->>'release_basis'), '');
  if v_id is null or v_expected is null or v_expected <= 0
     or v_basis is null or length(v_basis) < 20 or length(v_basis) > 4000 then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Release requires the dossier version and a 20 character inspection basis'
    );
  end if;

  select * into d
  from public.regulatory_evidence_dossiers
  where id = v_id and organization_id = v_org
  for update;
  if not found then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Regulatory evidence dossier is outside the active tenant'
    );
  end if;
  if d.status = 'released' then
    if d.released_by = v_actor and d.version = v_expected
       and btrim(d.release_basis) = v_basis then
      return public.regulatory_evidence_refusal() || jsonb_build_object(
        'id', d.id, 'status', 'released', 'version', d.version, 'idempotent', true
      );
    end if;
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'This dossier is already released'
    );
  end if;
  if d.status <> 'assembled' or d.version <> v_expected then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Refresh the unreleased dossier before releasing it'
    );
  end if;
  if d.assembled_by = v_actor then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'A different named human must release this dossier'
    );
  end if;

  select * into l
  from public.capability_pack_layers
  where id = d.capability_pack_layer_id and organization_id = v_org
    and layer_kind = 'jurisdiction' and status = 'adopted'
    and version = d.capability_pack_layer_version
    and jurisdiction = (
      select o.jurisdiction from public.organizations o where o.id = v_org
    )
  for update;
  if not found or not exists (
    select 1
    from jsonb_array_elements(l.configuration->'jurisdiction_requirements') req
    where req->>'key' = d.requirement_key
      and req->>'requirement_class' in ('regulatory', 'statutory')
      and req->>'applicability' = 'applicable'
      and req->>'obligation' in ('mandatory', 'advisory')
  ) then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'The jurisdiction requirement changed after assembly; revise the dossier before release'
    );
  end if;
  if exists (
    select 1
    from public.regulatory_evidence_items i
    left join public.evidence_items e
      on e.id = i.evidence_item_id and e.organization_id = v_org
     and e.verification_status = 'verified'
     and e.verified_by is not null and e.verified_at is not null
     and e.verified_by <> d.assembled_by
    left join public.user_profiles verifier
      on verifier.id = e.verified_by and verifier.organization_id = v_org
     and verifier.role is distinct from 'ai_admin'
    where i.dossier_id = d.id and i.organization_id = v_org
      and (e.id is null or verifier.id is null)
  ) then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Release requires every citation to remain independently verified canonical evidence'
    );
  end if;

  v_before := to_jsonb(d);
  perform set_config('app.regulatory_evidence_writer', 'governed', true);
  update public.regulatory_evidence_dossiers
  set status = 'released',
      released_by = v_actor,
      released_at = now(),
      release_basis = v_basis
  where id = d.id and organization_id = v_org;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'regulatory_evidence_dossier', v_role,
    jsonb_build_object(
      'action', 'released',
      'dossierId', d.id,
      'version', d.version,
      'actorId', v_actor,
      'assembledBy', d.assembled_by,
      'legalComplianceDetermined', false,
      'workAuthorized', false,
      'riskAccepted', false,
      'operatingLimitChanged', false,
      'returnToServiceAuthorized', false
    ),
    v_before,
    (select to_jsonb(row) from public.regulatory_evidence_dossiers row where row.id = d.id)
  );

  return public.regulatory_evidence_refusal() || jsonb_build_object(
    'id', d.id, 'status', 'released', 'version', d.version, 'idempotent', false
  );
end $$;

create or replace function public.withdraw_regulatory_evidence_pack(p_withdrawal jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid;
  v_role text := public.app_current_role();
  v_id uuid;
  v_expected integer;
  v_reason text;
  d public.regulatory_evidence_dossiers%rowtype;
  v_before jsonb;
begin
  v_actor := public.assert_regulatory_evidence_actor('withdraw an unreleased regulatory evidence dossier');
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal() <> 'aal2' then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Withdrawing regulatory evidence requires a verified factor and an AAL2 session'
    );
  end if;
  begin
    v_id := nullif(p_withdrawal->>'dossier_id', '')::uuid;
    v_expected := nullif(p_withdrawal->>'expected_version', '')::integer;
  exception when others then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Dossier and expected version must be valid'
    );
  end;
  v_reason := nullif(btrim(p_withdrawal->>'reason'), '');
  if v_id is null or v_expected is null or v_expected <= 0
     or v_reason is null or length(v_reason) < 20 or length(v_reason) > 4000 then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Withdrawal requires the dossier version and a 20 character reason'
    );
  end if;

  select * into d
  from public.regulatory_evidence_dossiers
  where id = v_id and organization_id = v_org
  for update;
  if not found then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Regulatory evidence dossier is outside the active tenant'
    );
  end if;
  if d.status = 'withdrawn' and d.withdrawn_by = v_actor and d.version = v_expected
     and btrim(d.withdrawal_reason) = v_reason then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'id', d.id, 'status', 'withdrawn', 'version', d.version, 'idempotent', true
    );
  end if;
  if d.status <> 'assembled' or d.version <> v_expected then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Only the current unreleased dossier can be withdrawn'
    );
  end if;
  if d.assembled_by <> v_actor then
    return public.regulatory_evidence_refusal() || jsonb_build_object(
      'error', 'Only the person who assembled this dossier can withdraw it'
    );
  end if;

  v_before := to_jsonb(d);
  perform set_config('app.regulatory_evidence_writer', 'governed', true);
  update public.regulatory_evidence_dossiers
  set status = 'withdrawn',
      withdrawn_by = v_actor,
      withdrawn_at = now(),
      withdrawal_reason = v_reason
  where id = d.id and organization_id = v_org;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'regulatory_evidence_dossier', v_role,
    jsonb_build_object(
      'action', 'withdrawn',
      'dossierId', d.id,
      'version', d.version,
      'actorId', v_actor,
      'legalComplianceDetermined', false,
      'workAuthorized', false,
      'riskAccepted', false,
      'operatingLimitChanged', false,
      'returnToServiceAuthorized', false
    ),
    v_before,
    (select to_jsonb(row) from public.regulatory_evidence_dossiers row where row.id = d.id)
  );

  return public.regulatory_evidence_refusal() || jsonb_build_object(
    'id', d.id, 'status', 'withdrawn', 'version', d.version, 'idempotent', false
  );
end $$;

create or replace function public.get_regulatory_evidence_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_boundary text := 'Release records that the cited evidence was assembled for inspection. It does not decide a legal outcome, authorize work, accept risk, change an operating limit, or return equipment to service.';
begin
  if public.app_current_org() is null or auth.uid() is null then
    return jsonb_build_object(
      'requirements', '[]'::jsonb,
      'dossiers', '[]'::jsonb,
      'verifiedEvidence', '[]'::jsonb,
      'coverage', jsonb_build_object(
        'mandatoryApplicable', 0, 'covered', 0, 'assembledUnreleased', 0, 'gaps', 0
      ),
      'jurisdiction', null,
      'decisionBoundary', v_boundary,
      'legalComplianceDetermined', false,
      'workAuthorized', false,
      'riskAccepted', false,
      'operatingLimitChanged', false,
      'returnToServiceAuthorized', false
    );
  end if;

  return (
    with context as (
      select o.id as org, o.jurisdiction
      from public.organizations o
      where o.id = public.app_current_org()
    ), current_layers as (
      select l.*
      from public.capability_pack_layers l
      join context c on c.org = l.organization_id
      where l.layer_kind = 'jurisdiction' and l.status = 'adopted'
        and l.jurisdiction = c.jurisdiction
    ), requirements as (
      select l.id as layer_id, l.version as layer_version, l.title as layer_title,
             l.jurisdiction, r.value as requirement
      from current_layers l
      cross join lateral jsonb_array_elements(l.configuration->'jurisdiction_requirements') r(value)
      where r.value->>'requirement_class' in ('regulatory', 'statutory')
    ), dossiers as (
      select d.*,
        (
          l.status = 'adopted'
          and l.version = d.capability_pack_layer_version
          and l.jurisdiction = (select jurisdiction from context)
          and exists (
            select 1 from requirements r
            where r.layer_id = l.id and r.requirement->>'key' = d.requirement_key
          )
        ) as fresh
      from public.regulatory_evidence_dossiers d
      join public.capability_pack_layers l
        on l.id = d.capability_pack_layer_id and l.organization_id = d.organization_id
      join context c on c.org = d.organization_id
    ), postures as (
      select r.*,
        exists (
          select 1 from dossiers d
          where d.capability_pack_layer_id = r.layer_id
            and d.requirement_key = r.requirement->>'key'
            and d.status = 'released' and d.fresh
            and not exists (
              select 1 from dossiers s
              where s.supersedes_id = d.id and s.status = 'released'
            )
        ) as covered,
        exists (
          select 1 from dossiers d
          where d.capability_pack_layer_id = r.layer_id
            and d.requirement_key = r.requirement->>'key'
            and d.status = 'assembled'
            and d.capability_pack_layer_version = r.layer_version
        ) as assembled_open
      from requirements r
    )
    select jsonb_build_object(
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'layerId', p.layer_id,
          'layerVersion', p.layer_version,
          'layerTitle', p.layer_title,
          'jurisdiction', p.jurisdiction,
          'key', p.requirement->>'key',
          'title', p.requirement->>'title',
          'requirementClass', p.requirement->>'requirement_class',
          'applicability', p.requirement->>'applicability',
          'obligation', p.requirement->>'obligation',
          'authorityReference', p.requirement->>'authority_reference',
          'posture', case
            when p.requirement->>'applicability' = 'undetermined'
              or p.requirement->>'obligation' not in ('mandatory', 'advisory', 'not_applicable')
              then 'applicability_undetermined'
            when p.requirement->>'applicability' <> 'applicable'
              or p.requirement->>'obligation' = 'not_applicable' then 'not_required'
            when p.covered then 'covered'
            when p.requirement->>'obligation' = 'mandatory' and p.assembled_open
              then 'assembled_unreleased'
            when p.requirement->>'obligation' = 'mandatory' then 'gap'
            when p.assembled_open then 'assembled_unreleased'
            else 'not_required'
          end
        ) order by p.requirement->>'key')
        from postures p
      ), '[]'::jsonb),
      'dossiers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id,
          'version', d.version,
          'status', d.status,
          'layerId', d.capability_pack_layer_id,
          'layerVersion', d.capability_pack_layer_version,
          'requirementKey', d.requirement_key,
          'jurisdiction', d.jurisdiction,
          'title', d.title,
          'purpose', d.purpose,
          'assembledBy', d.assembled_by,
          'assembledAt', d.assembled_at,
          'releasedBy', d.released_by,
          'releasedAt', d.released_at,
          'releaseBasis', d.release_basis,
          'withdrawnBy', d.withdrawn_by,
          'withdrawnAt', d.withdrawn_at,
          'withdrawalReason', d.withdrawal_reason,
          'supersedesId', d.supersedes_id,
          'stale', not d.fresh,
          'current', d.status = 'released' and d.fresh and not exists (
            select 1 from dossiers s
            where s.supersedes_id = d.id and s.status = 'released'
          ),
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', i.id,
              'evidenceItemId', i.evidence_item_id,
              'description', e.description,
              'citationBasis', i.citation_basis,
              'verifiedBy', e.verified_by,
              'verifiedAt', e.verified_at
            ) order by i.attached_at)
            from public.regulatory_evidence_items i
            join public.evidence_items e
              on e.id = i.evidence_item_id and e.organization_id = d.organization_id
            where i.dossier_id = d.id and i.organization_id = d.organization_id
          ), '[]'::jsonb)
        ) order by d.assembled_at desc)
        from dossiers d
      ), '[]'::jsonb),
      'verifiedEvidence', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'description', e.description,
          'sourceSystem', e.source_system,
          'verifiedBy', e.verified_by,
          'verifiedAt', e.verified_at
        ) order by e.verified_at desc)
        from public.evidence_items e
        join context c on c.org = e.organization_id
        join public.user_profiles verifier
          on verifier.id = e.verified_by and verifier.organization_id = c.org
         and verifier.role is distinct from 'ai_admin'
        where e.verification_status = 'verified'
          and e.verified_by is not null and e.verified_at is not null
          and e.verified_by <> auth.uid()
      ), '[]'::jsonb),
      'coverage', jsonb_build_object(
        'mandatoryApplicable', (
          select count(*) from postures p
          where p.requirement->>'applicability' = 'applicable'
            and p.requirement->>'obligation' = 'mandatory'
        ),
        'covered', (
          select count(*) from postures p
          where p.requirement->>'applicability' = 'applicable'
            and p.requirement->>'obligation' = 'mandatory' and p.covered
        ),
        'assembledUnreleased', (
          select count(*) from postures p
          where p.requirement->>'applicability' = 'applicable'
            and p.requirement->>'obligation' = 'mandatory'
            and not p.covered and p.assembled_open
        ),
        'gaps', (
          select count(*) from postures p
          where p.requirement->>'applicability' = 'applicable'
            and p.requirement->>'obligation' = 'mandatory'
            and not p.covered and not p.assembled_open
        )
      ),
      'jurisdiction', (select jurisdiction from context),
      'decisionBoundary', v_boundary,
      'legalComplianceDetermined', false,
      'workAuthorized', false,
      'riskAccepted', false,
      'operatingLimitChanged', false,
      'returnToServiceAuthorized', false
    )
  );
end $$;

revoke all on function public.assemble_regulatory_evidence_pack(jsonb)
  from public, anon, service_role;
grant execute on function public.assemble_regulatory_evidence_pack(jsonb)
  to authenticated;
revoke all on function public.release_regulatory_evidence_pack(jsonb)
  from public, anon, service_role;
grant execute on function public.release_regulatory_evidence_pack(jsonb)
  to authenticated;
revoke all on function public.withdraw_regulatory_evidence_pack(jsonb)
  from public, anon, service_role;
grant execute on function public.withdraw_regulatory_evidence_pack(jsonb)
  to authenticated;
revoke all on function public.get_regulatory_evidence_workspace()
  from public, anon, service_role;
grant execute on function public.get_regulatory_evidence_workspace()
  to authenticated;

comment on table public.regulatory_evidence_dossiers is
  'E4.09 inspection dossiers bound to an already-adopted jurisdiction requirement. Release is not a legal determination and authorizes no operational act.';
comment on function public.assemble_regulatory_evidence_pack(jsonb) is
  'E4.09: named AAL2 human assembles or revises an unreleased dossier citing independently verified canonical evidence. No legal outcome is decided.';
comment on function public.release_regulatory_evidence_pack(jsonb) is
  'E4.09: a different named AAL2 human releases the exact assembled dossier for inspection. Release does not decide a legal outcome.';
comment on function public.withdraw_regulatory_evidence_pack(jsonb) is
  'E4.09: the assembler withdraws an unreleased dossier so a changed requirement is not stuck. Withdrawal does not release it.';
comment on function public.get_regulatory_evidence_workspace() is
  'E4.09: tenant workspace of adopted regulatory requirements, dossiers and explicit gaps. Undetermined applicability stays unfilled.';

notify pgrst, 'reload schema';
