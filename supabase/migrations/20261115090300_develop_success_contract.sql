-- ============================================================================
-- Sync Develop Slice 2 — ProjectSuccessContract (D1.01, spec I.3).
--
-- "Every Development Case establishes success before design begins" — not
-- "Install Crusher 4 by October" but the eleven outcome dimensions, each
-- with a target, a unit, a STATED BASIS and an accountable owner. The
-- dimensions are the spec's list VERBATIM: business, safety, operational,
-- reliability, availability, maintainability, quality, schedule, cost,
-- environmental, stakeholder.
--
-- CANONICAL REUSE, PER THE REGISTER ROW:
--   * reliability / availability / maintainability outcomes REFERENCE
--     ram_targets — never duplicate them. When the case's delivery-side
--     capital project carries a ram_target, the outcome points at it
--     (ram_target_id) and carries NO second copy of the number; stating a
--     duplicate numeric availability beside a linked ram_target is refused.
--     A case with no RAM target yet states its target with a basis — and
--     the later ram_target work (E8) picks it up from here.
--   * expected benefits are value_metrics rows (D9.10, overlap ruling 11) —
--     the contract read surfaces the case's benefits; no Benefit table
--     arrives beside the ONE value store.
--
-- LIFECYCLE (D1.02 lands across this file and 20261115090400): the contract
-- is drafted, then RECORDED — a human accountability act (ai_admin refused
-- by name), versioned exactly like development_baselines (one recorded
-- version per case; re-recording supersedes). Once recorded it is immutable
-- to clients at the persistence boundary — success criteria that can be
-- quietly edited after the gates consumed them are not criteria. The gate
-- consumption (design-and-later gates refuse PROCEED without a recorded
-- contract; readiness names the blocker) is wired in 20261115090400 where
-- record_case_gate_review is re-created.
--
-- Canonical reuse: development_cases, ram_targets, capital_projects,
-- value_metrics (read side), user_profiles, audit_events, security_events,
-- app_current_org(). Two new tables (the contract and its outcomes) — a new
-- OBJECT the register row rules NEW, referencing, never duplicating, the
-- canonical stores.
-- ============================================================================

create table if not exists public.development_success_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  version int not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','recorded','superseded')),
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz,
  record_note text,
  superseded_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, version),
  -- A recorded-or-superseded contract carries its record; a draft none.
  check ((status = 'draft') = (recorded_at is null)),
  check (recorded_at is null or (recorded_by is not null
         and coalesce(length(btrim(record_note)), 0) >= 20)),
  check ((status = 'superseded') = (superseded_at is not null))
);

create unique index if not exists idx_success_contract_one_recorded
  on development_success_contracts(development_case_id)
  where status = 'recorded';
create unique index if not exists idx_success_contract_one_draft
  on development_success_contracts(development_case_id)
  where status = 'draft';
create index if not exists idx_success_contract_case
  on development_success_contracts(organization_id, development_case_id, version desc);

create table if not exists public.development_success_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid not null references development_success_contracts(id) on delete cascade,
  -- The eleven I.3 dimensions, verbatim.
  dimension text not null check (dimension in
    ('business','safety','operational','reliability','availability',
     'maintainability','quality','schedule','cost','environmental','stakeholder')),
  outcome_statement text not null check (btrim(outcome_statement) <> ''),
  target_value numeric,
  unit text,
  -- Stated basis, mandatory (the asset_economics rule, applied to success
  -- itself): where does this target come from?
  basis text not null check (btrim(basis) <> ''),
  owner_id uuid not null references user_profiles(id) on delete restrict,
  -- RAM dimensions reference the canonical ram_target instead of copying it.
  ram_target_id bigint references ram_targets(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (contract_id, dimension, outcome_statement),
  -- A typed value needs its unit.
  check (target_value is null or (unit is not null and btrim(unit) <> '')),
  -- Only RAM dimensions may reference a ram_target, and a reference carries
  -- no duplicate number beside it.
  check (ram_target_id is null
         or (dimension in ('reliability','availability','maintainability')
             and target_value is null))
);

create index if not exists idx_success_outcomes_contract
  on development_success_outcomes(contract_id, dimension);

alter table public.development_success_contracts enable row level security;
drop policy if exists development_success_contracts_read on public.development_success_contracts;
create policy development_success_contracts_read on public.development_success_contracts
  for select to authenticated using (organization_id = app_current_org());
alter table public.development_success_outcomes enable row level security;
drop policy if exists development_success_outcomes_read on public.development_success_outcomes;
create policy development_success_outcomes_read on public.development_success_outcomes
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy exists on either table: every write is a definer RPC.

-- ---------------------------------------------------------------------------
-- Immutability backstop (the development_baselines idiom, copied): INSERTs
-- arriving non-draft are forged records; recorded/superseded rows are
-- immutable to clients; every STATUS TRANSITION is the RPC's act. Service
-- path admitted AND audited; BEFORE DELETE returns OLD so cascades proceed.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_success_contract_immutability()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.success_contract_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_guarded boolean;
begin
  if tg_table_name = 'development_success_contracts' then
    if tg_op = 'INSERT' then
      v_guarded := new.status <> 'draft';
    elsif tg_op = 'DELETE' then
      v_guarded := old.status <> 'draft';
    else
      v_guarded := old.status <> 'draft' or new.status is distinct from old.status;
    end if;
  else
    -- Outcomes: guarded exactly when their contract is no longer a draft.
    if tg_op = 'DELETE' then
      v_guarded := exists (select 1 from development_success_contracts sc
                           where sc.id = old.contract_id and sc.status <> 'draft');
    else
      v_guarded := exists (select 1 from development_success_contracts sc
                           where sc.id = new.contract_id and sc.status <> 'draft');
      if not v_guarded and tg_op = 'UPDATE' and new.contract_id is distinct from old.contract_id then
        v_guarded := exists (select 1 from development_success_contracts sc
                             where sc.id = old.contract_id and sc.status <> 'draft');
      end if;
    end if;
  end if;

  if not v_guarded then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Recorded success-contract content on ' || tg_table_name || ' ('
           || lower(tg_op) || ', row '
           || (case when tg_op = 'DELETE' then old.id::text else new.id::text end)
           || ') written by a service caller outside the contract RPCs. A recorded '
           || 'success contract is what design-stage gates consumed; a rewrite of '
           || 'one is recorded here because it changes what the case was judged '
           || 'against.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'A recorded success contract is immutable — it is what design-stage gates '
      'consumed and what commissioning will be judged against (spec I.3). Changed '
      'success is a NEW contract version: draft_success_contract() then '
      'record_success_contract(), which supersedes this one visibly. A direct '
      'write cannot rewrite or forge the record.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_success_contract_immutability on public.development_success_contracts;
create trigger trg_success_contract_immutability
  before insert or update or delete on public.development_success_contracts
  for each row execute function public.enforce_success_contract_immutability();
drop trigger if exists trg_success_outcome_immutability on public.development_success_outcomes;
create trigger trg_success_outcome_immutability
  before insert or update or delete on public.development_success_outcomes
  for each row execute function public.enforce_success_contract_immutability();

revoke all on function public.enforce_success_contract_immutability() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Draft a contract version. Preparation — the planning role set. Version
-- assigned here, never by the caller; one draft per case at a time.
-- ---------------------------------------------------------------------------
create or replace function public.draft_success_contract(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_id uuid;
  v_version int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'drafting a success contract requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'a success contract is not draftable on a ' || c.status || ' case');
  end if;
  select id into v_id from development_success_contracts
  where development_case_id = c.id and status = 'draft';
  if found then
    return jsonb_build_object('contract_id', v_id, 'status', 'draft',
      'note', 'a draft already exists for this case — outcomes attach to it');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from development_success_contracts where development_case_id = c.id;

  insert into development_success_contracts
    (organization_id, development_case_id, version, status, created_by)
  values (v_org, c.id, v_version, 'draft', auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'success_contract', coalesce(v_role, 'unknown'),
    jsonb_build_object('contract_id', v_id, 'case_id', c.id,
      'action', 'drafted', 'version', v_version));

  return jsonb_build_object('contract_id', v_id, 'version', v_version, 'status', 'draft');
end
$$;

revoke all on function public.draft_success_contract(uuid) from public, anon;
grant execute on function public.draft_success_contract(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- State an outcome on a draft. Target + unit + BASIS + OWNER, every time.
-- RAM dimensions: when the case's capital project carries ram_targets, the
-- outcome references one — a duplicate numeric target beside the canonical
-- record is refused with the rule named.
-- ---------------------------------------------------------------------------
create or replace function public.set_success_outcome(
  p_contract_id uuid,
  p_dimension text,
  p_outcome_statement text,
  p_basis text,
  p_owner_id uuid,
  p_target_value numeric default null,
  p_unit text default null,
  p_ram_target_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  sc development_success_contracts%rowtype;
  c development_cases%rowtype;
  rt ram_targets%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'stating a success outcome requires a planning, engineering or governance role');
  end if;
  select * into sc from development_success_contracts
  where id = p_contract_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'success contract not found');
  end if;
  if sc.status <> 'draft' then
    return jsonb_build_object('error',
      'this contract version is ' || sc.status || ' — outcomes are stated on a draft; changed success is a new version (draft_success_contract)');
  end if;
  select * into c from development_cases where id = sc.development_case_id;
  if p_dimension not in
     ('business','safety','operational','reliability','availability',
      'maintainability','quality','schedule','cost','environmental','stakeholder') then
    return jsonb_build_object('error',
      'dimension must be one of the eleven spec-I.3 outcomes: business, safety, operational, reliability, availability, maintainability, quality, schedule, cost, environmental, stakeholder');
  end if;
  if coalesce(length(btrim(p_outcome_statement)), 0) < 10 then
    return jsonb_build_object('error',
      'state the outcome as a sentence someone can verify (10 characters minimum)');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 10 then
    return jsonb_build_object('error',
      'every success target states its basis — where the number or expectation comes from (10 characters minimum)');
  end if;
  if p_owner_id is null or not exists (
    select 1 from user_profiles where id = p_owner_id and organization_id = v_org) then
    return jsonb_build_object('error', 'every outcome names an owner who is a member of this organization');
  end if;
  if p_target_value is not null and coalesce(length(btrim(p_unit)), 0) < 1 then
    return jsonb_build_object('error', 'a numeric target states its unit');
  end if;

  if p_ram_target_id is not null then
    if p_dimension not in ('reliability','availability','maintainability') then
      return jsonb_build_object('error',
        'ram_target references belong to the reliability, availability and maintainability dimensions');
    end if;
    select * into rt from ram_targets
    where id = p_ram_target_id and organization_id = v_org;
    if not found then
      return jsonb_build_object('error', 'ram_target not found in this organization');
    end if;
    if c.capital_project_id is null or rt.project_id <> c.capital_project_id then
      return jsonb_build_object('error',
        'that ram_target belongs to a different capital project than this case references');
    end if;
    if p_target_value is not null then
      return jsonb_build_object('error',
        'this outcome references the canonical ram_target — it carries no second copy of the number (reference, never duplicate); drop target_value or drop the reference');
    end if;
  elsif p_dimension in ('reliability','availability','maintainability')
        and c.capital_project_id is not null
        and p_target_value is not null
        and exists (select 1 from ram_targets rt2
                    where rt2.project_id = c.capital_project_id
                      and rt2.organization_id = v_org) then
    return jsonb_build_object('error',
      'this case''s capital project carries ram_targets — a ' || p_dimension ||
      ' outcome REFERENCES one (pass ram_target_id) rather than duplicating the number beside the canonical record');
  end if;

  insert into development_success_outcomes
    (organization_id, contract_id, dimension, outcome_statement,
     target_value, unit, basis, owner_id, ram_target_id)
  values
    (v_org, sc.id, p_dimension, btrim(p_outcome_statement),
     p_target_value, nullif(btrim(coalesce(p_unit,'')), ''),
     btrim(p_basis), p_owner_id, p_ram_target_id)
  on conflict (contract_id, dimension, outcome_statement) do update set
    target_value = excluded.target_value,
    unit = excluded.unit,
    basis = excluded.basis,
    owner_id = excluded.owner_id,
    ram_target_id = excluded.ram_target_id
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'success_outcome', coalesce(v_role, 'unknown'),
    jsonb_build_object('contract_id', sc.id, 'outcome_id', v_id,
      'case_id', sc.development_case_id, 'dimension', p_dimension,
      'target_value', p_target_value, 'unit', p_unit,
      'ram_target_id', p_ram_target_id));

  return jsonb_build_object('outcome_id', v_id, 'contract_id', sc.id,
    'dimension', p_dimension);
end
$$;

revoke all on function public.set_success_outcome(uuid, text, text, text, uuid, numeric, text, bigint) from public, anon;
grant execute on function public.set_success_outcome(uuid, text, text, text, uuid, numeric, text, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RECORD the contract — the human accountability act the D1.02 gates
-- consume. ai_admin refused by name. Requires at least one outcome; every
-- outcome already carries owner + basis at the schema. Supersedes the prior
-- recorded version.
-- ---------------------------------------------------------------------------
create or replace function public.record_success_contract(
  p_contract_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  sc development_success_contracts%rowtype;
  v_outcomes int;
  v_dimensions int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'recording what success means for a case is a human accountability act — the AI-operator identity cannot record it');
    end if;
    return jsonb_build_object('error', 'recording a success contract requires a governance or engineering role');
  end if;
  select * into sc from development_success_contracts
  where id = p_contract_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'success contract not found');
  end if;
  if sc.status <> 'draft' then
    return jsonb_build_object('error',
      'only a draft contract can be recorded — a recorded version is immutable and its record is not overwritable');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for adopting this contract (20 characters minimum)');
  end if;
  select count(*), count(distinct dimension) into v_outcomes, v_dimensions
  from development_success_outcomes where contract_id = sc.id;
  if v_outcomes = 0 then
    return jsonb_build_object('error',
      'a contract with no outcomes defines no success — state at least one outcome (set_success_outcome) before recording');
  end if;

  perform set_config('app.success_contract_write', 'granted', true);

  update development_success_contracts
  set status = 'superseded', superseded_at = now()
  where development_case_id = sc.development_case_id and status = 'recorded';

  update development_success_contracts
  set status = 'recorded', recorded_by = auth.uid(), recorded_at = now(),
      record_note = btrim(p_note)
  where id = sc.id;

  perform set_config('app.success_contract_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'success_contract', coalesce(v_role, 'unknown'),
    jsonb_build_object('contract_id', sc.id, 'case_id', sc.development_case_id,
      'action', 'recorded', 'version', sc.version,
      'outcomes', v_outcomes, 'dimensions_covered', v_dimensions));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Success contract v%s recorded on case %s (%s outcome(s), %s of 11 dimensions) as role %s — prior recorded version (if any) superseded.',
            sc.version, sc.development_case_id, v_outcomes, v_dimensions, coalesce(v_role, 'none')));

  return jsonb_build_object('contract_id', sc.id, 'version', sc.version,
    'status', 'recorded', 'outcomes', v_outcomes,
    'dimensions_covered', v_dimensions,
    'dimensions_total', 11);
end
$$;

revoke all on function public.record_success_contract(uuid, text) from public, anon;
grant execute on function public.record_success_contract(uuid, text) to authenticated;

notify pgrst, 'reload schema';
