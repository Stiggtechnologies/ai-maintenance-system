-- E4.03 / E5.13 — tenant-stated delegation ceilings and recovery records.
--
-- Canonical reuse: authority_limits remains the one delegation instrument,
-- audit_events remains the one audit ledger, and app_current_org() remains
-- the tenant wall. No parallel approval, queue, or evidence store.
--
-- E4.03. The crew-to-board ladder (action_type = general) was seeded with
-- placeholder commitment, risk and downtime figures. Those drafts are not a
-- customer instrument. This migration clears unstated general drafts, refuses
-- a later insert that tries to arrive with a platform amount, and admits a
-- ceiling only when a named administrator or executive states every dimension
-- with no default. A different named human adopts. ai_admin is refused.
-- Adopted rows are not rewritten: an instrument already in force stays the
-- record it was adopted as. Other action types keep state_authority_ceiling.
--
-- E5.13. Recovery point and recovery time are the tenant's objectives. This
-- migration does not insert a duration. A named human states them, a different
-- named human adopts them, and a restore verification stores measured loss and
-- duration. The outcome is recomputed from those measurements and the check
-- results. The caller cannot mark a pass. The local database drill remains the
-- tested backup/restore procedure; this record does not prove hosted
-- production PITR, Storage bytes, the Vault root key, or Edge secrets.

alter table public.authority_limits
  add column if not exists commitment_stated boolean not null default false,
  add column if not exists risk_stated boolean not null default false,
  add column if not exists downtime_stated boolean not null default false,
  add column if not exists ceilings_stated_by uuid references auth.users(id),
  add column if not exists ceilings_stated_at timestamptz;

comment on column public.authority_limits.commitment_stated is
  'True only after a named human states the commitment dimension. False means the stored amount is not a delegation, including a cleared platform placeholder.';
comment on column public.authority_limits.risk_stated is
  'True only after a named human states the risk dimension. A null level is unlimited only when this flag is true.';
comment on column public.authority_limits.downtime_stated is
  'True only after a named human states the downtime dimension. A null hour figure is unlimited only when this flag is true.';

-- Unstated general drafts lose platform placeholders. A ceiling already
-- restated through state_authority_ceiling keeps its money and still must
-- have risk and downtime stated before adoption. Adopted rows are untouched.
update public.authority_limits
   set commitment_stated = basis like '%Ceiling stated:%',
       risk_stated = false,
       downtime_stated = false,
       max_commitment_usd = case
         when basis like '%Ceiling stated:%' then max_commitment_usd
         else null
       end,
       max_risk_level = null,
       max_production_downtime_hours = null,
       basis = case
         when basis like '%Ceiling stated:%' then basis
         else 'Ladder role only. Commitment, risk and downtime ceilings are unset until a named human states this tenant''s delegation instrument. No platform default amount applies.'
       end
 where action_type = 'general'
   and status = 'draft'
   and adopted_by is null
   and ceilings_stated_by is null
   and (
     basis like 'Proposed:%'
     or basis like '%Placeholder%'
     or (role_key = 'technician' and max_commitment_usd = 0 and max_risk_level = 'Low' and max_production_downtime_hours = 0)
     or (role_key = 'planner' and max_commitment_usd = 5000 and max_risk_level = 'Low' and max_production_downtime_hours = 4)
     or (role_key = 'reliability_engineer' and max_commitment_usd = 25000 and max_risk_level = 'Medium' and max_production_downtime_hours = 8)
     or (role_key = 'maintenance_manager' and max_commitment_usd = 100000 and max_risk_level = 'High' and max_production_downtime_hours = 24)
     or (role_key = 'executive' and max_commitment_usd = 2000000 and max_risk_level = 'Critical' and max_production_downtime_hours = 72)
     or (role_key = 'board' and max_commitment_usd is null and max_risk_level = 'Critical' and max_production_downtime_hours is null)
   );

update public.authority_limits
   set commitment_stated = true,
       risk_stated = true,
       downtime_stated = true
 where action_type = 'general'
   and status = 'adopted'
   and adopted_by is not null;

create or replace function public.enforce_general_delegation_honesty()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.action_type = 'general'
       and new.status = 'draft'
       and new.ceilings_stated_by is null then
      new.max_commitment_usd := null;
      new.max_risk_level := null;
      new.max_production_downtime_hours := null;
      new.commitment_stated := false;
      new.risk_stated := false;
      new.downtime_stated := false;
      if new.basis is null or new.basis not like 'Redrafted from %' then
        new.basis := 'Ladder role only. Commitment, risk and downtime ceilings are unset until a named human states this tenant''s delegation instrument. No platform default amount applies.';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.action_type = 'general' then
    if new.max_commitment_usd is distinct from old.max_commitment_usd
       or new.max_commitment_currency is distinct from old.max_commitment_currency
       or new.max_risk_level is distinct from old.max_risk_level
       or new.max_production_downtime_hours is distinct from old.max_production_downtime_hours
       or new.commitment_stated is distinct from old.commitment_stated
       or new.risk_stated is distinct from old.risk_stated
       or new.downtime_stated is distinct from old.downtime_stated
       or new.ceilings_stated_by is distinct from old.ceilings_stated_by
       or new.ceilings_stated_at is distinct from old.ceilings_stated_at then
      if current_setting('app.general_delegation_write', true) is distinct from 'granted' then
        raise exception
          'a general delegation ceiling is stated by a named human through state_general_delegation. A direct write cannot install an amount.'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    if new.status = 'adopted' and old.status is distinct from 'adopted' then
      if not (new.commitment_stated and new.risk_stated and new.downtime_stated) then
        raise exception
          'this general delegation cannot be adopted. Commitment, risk and downtime are still unstated, and the platform does not supply them.'
          using errcode = 'check_violation';
      end if;
      if new.ceilings_stated_by is null or new.adopted_by is null
         or new.ceilings_stated_by = new.adopted_by then
        raise exception
          'the human who stated this delegation cannot adopt it. A different named administrator or executive adopts.'
          using errcode = 'check_violation';
      end if;
      if not exists (
        select 1 from public.user_profiles up
         where up.id = new.adopted_by
           and up.organization_id = new.organization_id
           and up.role in ('admin', 'executive')
           and coalesce(length(btrim(up.full_name)), 0) >= 2
      ) then
        raise exception
          'adopting a general delegation requires a named administrator or executive in this organization. An AI-operator identity cannot adopt.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end
$fn$;

revoke all on function public.enforce_general_delegation_honesty() from public, anon, authenticated, service_role;

drop trigger if exists trg_general_delegation_honesty on public.authority_limits;
create trigger trg_general_delegation_honesty
  before insert or update on public.authority_limits
  for each row execute function public.enforce_general_delegation_honesty();

create or replace function public.state_general_delegation(
  p_id uuid,
  p_instrument jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_name text;
  l public.authority_limits%rowtype;
  v_basis text := btrim(coalesce(p_instrument->>'basis', ''));
  v_commitment_mode text := btrim(coalesce(p_instrument #>> '{commitment,mode}', ''));
  v_risk_mode text := btrim(coalesce(p_instrument #>> '{risk,mode}', ''));
  v_downtime_mode text := btrim(coalesce(p_instrument #>> '{downtime,mode}', ''));
  v_amount numeric;
  v_hours numeric;
  v_currency text := upper(btrim(coalesce(p_instrument #>> '{commitment,currency}', '')));
  v_risk text := btrim(coalesce(p_instrument #>> '{risk,level}', ''));
  v_commitment numeric;
  v_risk_level text;
  v_downtime numeric;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select up.role, up.full_name into v_role, v_name
    from public.user_profiles up
   where up.id = auth.uid() and up.organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error',
      'stating a delegation of authority decides how much of the owner''s capital and downtime a role may commit. An AI-operator identity cannot make that determination.');
  end if;
  if v_role not in ('admin', 'executive') then
    return jsonb_build_object('error',
      'stating a general delegation requires a named administrator or executive');
  end if;
  if coalesce(length(btrim(v_name)), 0) < 2 then
    return jsonb_build_object('error',
      'record your name on your profile before stating a delegation. An unnamed session is not a named human.');
  end if;

  select * into l from public.authority_limits
   where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'delegation not found');
  end if;
  if l.action_type <> 'general' then
    return jsonb_build_object('error',
      'this door states the general delegation ladder only. A money instrument uses state_authority_ceiling.');
  end if;
  if l.status <> 'draft' then
    return jsonb_build_object('error',
      'a ceiling is stated on a draft. An adopted delegation is not edited; draft a replacement and adopt that.');
  end if;
  if length(v_basis) < 20 or length(v_basis) > 2000 then
    return jsonb_build_object('error',
      'record the delegation instrument this ceiling comes from (20 to 2000 characters). A number with no instrument is not a delegation.');
  end if;
  if v_commitment_mode not in ('amount', 'none', 'unlimited')
     or v_risk_mode not in ('ceiling', 'unlimited')
     or v_downtime_mode not in ('hours', 'unlimited') then
    return jsonb_build_object('error',
      'state commitment as amount, none or unlimited; risk as ceiling or unlimited; downtime as hours or unlimited. Omitted dimensions are refused, not defaulted.');
  end if;

  if v_commitment_mode = 'unlimited' then
    v_commitment := null;
  elsif v_commitment_mode = 'none' then
    v_commitment := 0;
  else
    v_amount := public.sync_finite_money(p_instrument #>> '{commitment,amount}');
    if v_amount is null or v_amount < 0 then
      return jsonb_build_object('error',
        'the commitment amount must be a finite number of at least zero. NaN and infinity are refused, and no amount is assumed.');
    end if;
    v_commitment := v_amount;
  end if;
  if v_commitment_mode in ('amount', 'none') and v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error',
      'state the currency as a three-letter code. No default currency is applied.');
  end if;

  if v_risk_mode = 'unlimited' then
    v_risk_level := null;
  else
    if v_risk not in ('Low', 'Medium', 'High', 'Critical') then
      return jsonb_build_object('error',
        'the risk ceiling is one of Low, Medium, High, Critical. No risk level is assumed.');
    end if;
    v_risk_level := v_risk;
  end if;

  if v_downtime_mode = 'unlimited' then
    v_downtime := null;
  else
    v_hours := public.sync_finite_money(p_instrument #>> '{downtime,hours}');
    if v_hours is null or v_hours < 0 then
      return jsonb_build_object('error',
        'downtime must be a finite number of hours of at least zero. No downtime allowance is assumed.');
    end if;
    v_downtime := v_hours;
  end if;

  perform set_config('app.general_delegation_write', 'granted', true);
  update public.authority_limits
     set max_commitment_usd = v_commitment,
         max_commitment_currency = case
           when v_commitment_mode = 'unlimited' then max_commitment_currency
           else v_currency
         end,
         max_risk_level = v_risk_level,
         max_production_downtime_hours = v_downtime,
         commitment_stated = true,
         risk_stated = true,
         downtime_stated = true,
         ceilings_stated_by = auth.uid(),
         ceilings_stated_at = now(),
         basis = v_basis
   where id = l.id and organization_id = v_org;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'authority_limit', v_name || ' (' || v_role || ')',
    jsonb_build_object('limit_id', l.id, 'action_type', 'general', 'role_key', l.role_key, 'act', 'state_general_delegation'),
    jsonb_build_object(
      'max_commitment', l.max_commitment_usd,
      'max_risk_level', l.max_risk_level,
      'max_production_downtime_hours', l.max_production_downtime_hours,
      'commitment_stated', l.commitment_stated,
      'risk_stated', l.risk_stated,
      'downtime_stated', l.downtime_stated,
      'basis', l.basis
    ),
    jsonb_build_object(
      'max_commitment', v_commitment,
      'currency', case when v_commitment_mode = 'unlimited' then null else v_currency end,
      'commitment_mode', v_commitment_mode,
      'max_risk_level', v_risk_level,
      'risk_mode', v_risk_mode,
      'max_production_downtime_hours', v_downtime,
      'downtime_mode', v_downtime_mode,
      'stated_by', auth.uid(),
      'stated_by_name', v_name,
      'basis', v_basis
    )
  );

  return jsonb_build_object(
    'limit_id', l.id,
    'role_key', l.role_key,
    'commitment_mode', v_commitment_mode,
    'ceiling', v_commitment,
    'currency', case when v_commitment_mode = 'unlimited' then null else v_currency end,
    'risk_mode', v_risk_mode,
    'maxRiskLevel', v_risk_level,
    'downtime_mode', v_downtime_mode,
    'maxDowntimeHours', v_downtime,
    'status', 'draft',
    'next', 'adopt_authority_limit'
  );
end
$fn$;

revoke all on function public.state_general_delegation(uuid, jsonb) from public, anon, service_role;
grant execute on function public.state_general_delegation(uuid, jsonb) to authenticated;

create or replace function public.get_accountability_cascade()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles where id = auth.uid();

  return jsonb_build_object(
    'role', v_role,
    'viewer_id', auth.uid(),
    'limits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'role_key', role_key, 'tier_label', tier_label,
        'max_commitment_usd', max_commitment_usd,
        'max_commitment_currency', case
          when commitment_stated and max_commitment_usd is not null then max_commitment_currency
          else null
        end,
        'max_risk_level', max_risk_level,
        'max_production_downtime_hours', max_production_downtime_hours,
        'commitment_stated', commitment_stated,
        'risk_stated', risk_stated,
        'downtime_stated', downtime_stated,
        'ceilings_stated_by', ceilings_stated_by,
        'escalates_to_role', escalates_to_role, 'basis', basis, 'status', status,
        'adopted_at', adopted_at
      ) order by case role_key
        when 'technician' then 1
        when 'planner' then 2
        when 'reliability_engineer' then 3
        when 'maintenance_manager' then 4
        when 'executive' then 5
        when 'board' then 6
        else 7 end, role_key), '[]'::jsonb)
      from public.authority_limits
      where organization_id = v_org
        and action_type = 'general'
        and status in ('draft', 'adopted')),
    'enforcement_note',
      'Only ADOPTED limits are enforced. A general-ladder draft has no platform amount: a named human must state commitment, risk and downtime, and a different named human must adopt it. Until then the draft blocks nothing.',
    'packs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'period_label', period_label, 'period_end', period_end,
        'status', status, 'attested_at', attested_at, 'attestation_note', attestation_note,
        'kpi_count', jsonb_array_length(kpi_snapshot),
        'measured_count', (select count(*) from jsonb_array_elements(kpi_snapshot) k
                           where (k->>'measured')::boolean),
        'governance', governance_snapshot
      ) order by period_end desc), '[]'::jsonb)
      from public.board_packs
      where organization_id = v_org
        and v_role in ('board', 'executive', 'admin', 'ai_admin'))
  );
end
$fn$;

revoke all on function public.get_accountability_cascade() from public, anon;
grant execute on function public.get_accountability_cascade() to authenticated;

-- ---------------------------------------------------------------------------
-- Recovery objectives and restore verification. No seeded duration.
-- ---------------------------------------------------------------------------

create table if not exists public.recovery_objectives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'adopted', 'superseded')),
  rpo_seconds numeric not null,
  rto_seconds numeric not null,
  recovery_owner_id uuid not null references auth.users(id),
  procedure_reference text not null,
  basis text not null,
  stated_by uuid not null references auth.users(id),
  stated_at timestamptz not null default now(),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  superseded_by uuid references public.recovery_objectives(id),
  created_at timestamptz not null default now(),
  constraint recovery_objectives_finite check (
    rpo_seconds >= 0 and rto_seconds >= 0
    and rpo_seconds < 'Infinity'::numeric
    and rto_seconds < 'Infinity'::numeric
    and length(btrim(basis)) >= 20
    and length(btrim(procedure_reference)) >= 10
  ),
  constraint recovery_objectives_adopted_pair check (
    status <> 'adopted'
    or (adopted_by is not null and adopted_at is not null and adopted_by <> stated_by)
  )
);

create unique index if not exists recovery_objectives_one_draft
  on public.recovery_objectives (organization_id) where status = 'draft';
create unique index if not exists recovery_objectives_one_adopted
  on public.recovery_objectives (organization_id) where status = 'adopted';

create table if not exists public.recovery_restore_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  objective_id uuid not null references public.recovery_objectives(id) on delete restrict,
  backup_label text not null,
  restore_target text not null,
  evidence_reference text not null,
  measured_data_loss_seconds numeric not null,
  measured_restore_seconds numeric not null,
  rpo_seconds_applied numeric not null,
  rto_seconds_applied numeric not null,
  canonical_row_check text not null check (canonical_row_check in ('matched', 'mismatched', 'not_run')),
  tenant_isolation_witness text not null check (tenant_isolation_witness in ('passed', 'failed', 'not_run')),
  within_rpo boolean not null,
  within_rto boolean not null,
  verification_outcome text not null check (verification_outcome in ('within_objectives', 'outside_objectives', 'checks_not_run')),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  constraint recovery_verification_finite check (
    measured_data_loss_seconds >= 0 and measured_restore_seconds >= 0
    and rpo_seconds_applied >= 0 and rto_seconds_applied >= 0
    and measured_data_loss_seconds < 'Infinity'::numeric
    and measured_restore_seconds < 'Infinity'::numeric
    and length(btrim(backup_label)) >= 8
    and length(btrim(restore_target)) >= 8
    and length(btrim(evidence_reference)) >= 20
  ),
  constraint recovery_verification_outcome_matches check (
    within_rpo = (measured_data_loss_seconds <= rpo_seconds_applied)
    and within_rto = (measured_restore_seconds <= rto_seconds_applied)
    and verification_outcome = case
      when canonical_row_check = 'not_run' or tenant_isolation_witness = 'not_run' then 'checks_not_run'
      when canonical_row_check = 'matched'
           and tenant_isolation_witness = 'passed'
           and measured_data_loss_seconds <= rpo_seconds_applied
           and measured_restore_seconds <= rto_seconds_applied then 'within_objectives'
      else 'outside_objectives'
    end
  )
);

alter table public.recovery_objectives enable row level security;
alter table public.recovery_restore_verifications enable row level security;

drop policy if exists recovery_objectives_read on public.recovery_objectives;
create policy recovery_objectives_read on public.recovery_objectives
  for select to authenticated
  using (organization_id = public.app_current_org());

drop policy if exists recovery_verifications_read on public.recovery_restore_verifications;
create policy recovery_verifications_read on public.recovery_restore_verifications
  for select to authenticated
  using (organization_id = public.app_current_org());

create or replace function public.guard_recovery_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'recovery records cannot be truncated'
      using errcode = 'insufficient_privilege';
  end if;
  if current_setting('app.recovery_record_write', true) is distinct from 'granted' then
    raise exception
      'recovery objectives and restore verifications are written only by the named-human recovery functions'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_table_name = 'recovery_restore_verifications' then
    if tg_op <> 'INSERT' then
      raise exception 'a restore verification is append-only'
        using errcode = 'insufficient_privilege';
    end if;
    new.within_rpo := new.measured_data_loss_seconds <= new.rpo_seconds_applied;
    new.within_rto := new.measured_restore_seconds <= new.rto_seconds_applied;
    new.verification_outcome := case
      when new.canonical_row_check = 'not_run' or new.tenant_isolation_witness = 'not_run' then 'checks_not_run'
      when new.canonical_row_check = 'matched'
           and new.tenant_isolation_witness = 'passed'
           and new.within_rpo
           and new.within_rto then 'within_objectives'
      else 'outside_objectives'
    end;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'an adopted recovery objective is superseded, not deleted'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if not (
      (old.status = 'draft' and new.status = 'adopted')
      or (old.status = 'adopted' and new.status = 'superseded')
      or old.status = new.status
    ) then
      raise exception 'a recovery objective can only move from draft to adopted, or from adopted to superseded'
        using errcode = 'insufficient_privilege';
    end if;
    if new.rpo_seconds is distinct from old.rpo_seconds
       or new.rto_seconds is distinct from old.rto_seconds
       or new.recovery_owner_id is distinct from old.recovery_owner_id
       or new.procedure_reference is distinct from old.procedure_reference
       or new.basis is distinct from old.basis
       or new.stated_by is distinct from old.stated_by
       or new.organization_id is distinct from old.organization_id
       or new.version is distinct from old.version then
      raise exception 'a stated recovery objective is immutable. State a new draft.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$fn$;

revoke all on function public.guard_recovery_record() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_recovery_objectives on public.recovery_objectives;
create trigger trg_guard_recovery_objectives
  before insert or update or delete on public.recovery_objectives
  for each row execute function public.guard_recovery_record();

drop trigger if exists trg_guard_recovery_verifications on public.recovery_restore_verifications;
create trigger trg_guard_recovery_verifications
  before insert or update or delete on public.recovery_restore_verifications
  for each row execute function public.guard_recovery_record();

drop trigger if exists trg_recovery_objectives_no_truncate on public.recovery_objectives;
create trigger trg_recovery_objectives_no_truncate
  before truncate on public.recovery_objectives
  for each statement execute function public.guard_recovery_record();

drop trigger if exists trg_recovery_verifications_no_truncate on public.recovery_restore_verifications;
create trigger trg_recovery_verifications_no_truncate
  before truncate on public.recovery_restore_verifications
  for each statement execute function public.guard_recovery_record();

revoke truncate on table public.recovery_objectives from anon, authenticated, service_role;
revoke truncate on table public.recovery_restore_verifications from anon, authenticated, service_role;

create or replace function public.state_recovery_objective(p_objective jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_name text;
  v_owner uuid;
  v_owner_role text;
  v_owner_name text;
  v_rpo numeric;
  v_rto numeric;
  v_basis text := btrim(coalesce(p_objective->>'basis', ''));
  v_procedure text := btrim(coalesce(p_objective->>'procedure_reference', ''));
  v_version integer;
  v_id uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select up.role, up.full_name into v_role, v_name
    from public.user_profiles up
   where up.id = auth.uid() and up.organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error',
      'stating a recovery objective is a human determination. An AI-operator identity cannot set an RPO or an RTO.');
  end if;
  if v_role not in ('admin', 'executive') then
    return jsonb_build_object('error',
      'stating a recovery objective requires a named administrator or executive');
  end if;
  if coalesce(length(btrim(v_name)), 0) < 2 then
    return jsonb_build_object('error',
      'record your name on your profile before stating a recovery objective');
  end if;
  if p_objective->>'rpo_seconds' is null or p_objective->>'rto_seconds' is null
     or p_objective->>'recovery_owner_id' is null then
    return jsonb_build_object('error',
      'state the recovery point, the recovery time and the named recovery owner. No duration is assumed.');
  end if;
  v_rpo := public.sync_finite_money(p_objective->>'rpo_seconds');
  v_rto := public.sync_finite_money(p_objective->>'rto_seconds');
  if v_rpo is null or v_rto is null or v_rpo < 0 or v_rto < 0 then
    return jsonb_build_object('error',
      'recovery point and recovery time must be finite seconds of at least zero. No RPO or RTO is assumed.');
  end if;
  if length(v_basis) < 20 or length(v_basis) > 2000 then
    return jsonb_build_object('error',
      'record the instrument that sets these objectives (20 to 2000 characters)');
  end if;
  if length(v_procedure) < 10 or length(v_procedure) > 500 then
    return jsonb_build_object('error',
      'cite the backup and restore procedure this objective is checked against (10 to 500 characters)');
  end if;
  begin
    v_owner := (p_objective->>'recovery_owner_id')::uuid;
  exception when others then
    return jsonb_build_object('error', 'the recovery owner must be a person in this organization');
  end;
  select up.role, up.full_name into v_owner_role, v_owner_name
    from public.user_profiles up
   where up.id = v_owner and up.organization_id = v_org;
  if v_owner_role is null then
    return jsonb_build_object('error', 'the recovery owner is not a person in this organization');
  end if;
  if v_owner_role = 'ai_admin' then
    return jsonb_build_object('error', 'the recovery owner cannot be the AI-operator identity');
  end if;
  if coalesce(length(btrim(v_owner_name)), 0) < 2 then
    return jsonb_build_object('error', 'the recovery owner has no recorded name');
  end if;
  if exists (
    select 1 from public.recovery_objectives
     where organization_id = v_org and status = 'draft'
  ) then
    return jsonb_build_object('error',
      'a draft recovery objective already exists. Adopt it, or withdraw the draft, before stating another.');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.recovery_objectives where organization_id = v_org;

  perform set_config('app.recovery_record_write', 'granted', true);
  insert into public.recovery_objectives (
    organization_id, version, status, rpo_seconds, rto_seconds,
    recovery_owner_id, procedure_reference, basis, stated_by
  ) values (
    v_org, v_version, 'draft', v_rpo, v_rto,
    v_owner, v_procedure, v_basis, auth.uid()
  ) returning id into v_id;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'recovery_objective', v_name || ' (' || v_role || ')',
    jsonb_build_object('objective_id', v_id, 'act', 'state_recovery_objective'),
    null,
    jsonb_build_object(
      'status', 'draft', 'version', v_version,
      'rpo_seconds', v_rpo, 'rto_seconds', v_rto,
      'recovery_owner_id', v_owner, 'recovery_owner_name', v_owner_name,
      'procedure_reference', v_procedure, 'basis', v_basis,
      'stated_by', auth.uid(), 'stated_by_name', v_name
    )
  );

  return jsonb_build_object(
    'objective_id', v_id, 'status', 'draft', 'version', v_version,
    'rpo_seconds', v_rpo, 'rto_seconds', v_rto, 'next', 'adopt_recovery_objective'
  );
end
$fn$;

revoke all on function public.state_recovery_objective(jsonb) from public, anon, service_role;
grant execute on function public.state_recovery_objective(jsonb) to authenticated;

create or replace function public.withdraw_recovery_objective_draft(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_name text;
  d public.recovery_objectives%rowtype;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select up.role, up.full_name into v_role, v_name
    from public.user_profiles up
   where up.id = auth.uid() and up.organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error', 'an AI-operator identity cannot withdraw a recovery objective');
  end if;
  if v_role not in ('admin', 'executive') then
    return jsonb_build_object('error', 'withdrawing a draft recovery objective requires a named administrator or executive');
  end if;
  if coalesce(length(btrim(v_name)), 0) < 2 then
    return jsonb_build_object('error', 'record your name on your profile before withdrawing a draft');
  end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then
    return jsonb_build_object('error', 'state why this draft is withdrawn (10 characters minimum)');
  end if;
  select * into d from public.recovery_objectives
   where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'recovery objective not found');
  end if;
  if d.status <> 'draft' then
    return jsonb_build_object('error', 'only a draft recovery objective can be withdrawn');
  end if;

  perform set_config('app.recovery_record_write', 'granted', true);
  delete from public.recovery_objectives where id = d.id and organization_id = v_org;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'recovery_objective', v_name || ' (' || v_role || ')',
    jsonb_build_object('objective_id', d.id, 'act', 'withdraw_recovery_objective_draft', 'note', btrim(p_note)),
    jsonb_build_object('status', 'draft', 'rpo_seconds', d.rpo_seconds, 'rto_seconds', d.rto_seconds, 'basis', d.basis),
    jsonb_build_object('status', 'withdrawn')
  );
  return jsonb_build_object('withdrawn', d.id);
end
$fn$;

revoke all on function public.withdraw_recovery_objective_draft(uuid, text) from public, anon, service_role;
grant execute on function public.withdraw_recovery_objective_draft(uuid, text) to authenticated;

create or replace function public.adopt_recovery_objective(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_name text;
  d public.recovery_objectives%rowtype;
  v_previous uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select up.role, up.full_name into v_role, v_name
    from public.user_profiles up
   where up.id = auth.uid() and up.organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error',
      'adopting a recovery objective commits the organization to a recovery point and a recovery time. An AI-operator identity cannot adopt it.');
  end if;
  if v_role not in ('admin', 'executive') then
    return jsonb_build_object('error', 'adopting a recovery objective requires a named administrator or executive');
  end if;
  if coalesce(length(btrim(v_name)), 0) < 2 then
    return jsonb_build_object('error', 'record your name on your profile before adopting a recovery objective');
  end if;
  if length(btrim(coalesce(p_note, ''))) < 20 then
    return jsonb_build_object('error', 'state why you are adopting these objectives (20 characters minimum)');
  end if;
  select * into d from public.recovery_objectives
   where id = p_id and organization_id = v_org
   for update;
  if not found then
    return jsonb_build_object('error', 'recovery objective not found');
  end if;
  if d.status <> 'draft' then
    return jsonb_build_object('error', 'only a draft recovery objective can be adopted');
  end if;
  if d.stated_by = auth.uid() then
    return jsonb_build_object('error',
      'the human who stated this recovery objective cannot adopt it. A different named administrator or executive adopts.');
  end if;

  perform set_config('app.recovery_record_write', 'granted', true);
  update public.recovery_objectives
     set status = 'superseded', superseded_by = d.id
   where organization_id = v_org and status = 'adopted'
  returning id into v_previous;

  update public.recovery_objectives
     set status = 'adopted', adopted_by = auth.uid(), adopted_at = now()
   where id = d.id and organization_id = v_org;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'recovery_objective', v_name || ' (' || v_role || ')',
    jsonb_build_object('objective_id', d.id, 'act', 'adopt_recovery_objective', 'note', btrim(p_note), 'superseded', v_previous),
    jsonb_build_object('status', 'draft', 'rpo_seconds', d.rpo_seconds, 'rto_seconds', d.rto_seconds),
    jsonb_build_object('status', 'adopted', 'adopted_by', auth.uid(), 'adopted_by_name', v_name,
      'rpo_seconds', d.rpo_seconds, 'rto_seconds', d.rto_seconds)
  );

  return jsonb_build_object(
    'objective_id', d.id, 'status', 'adopted',
    'rpo_seconds', d.rpo_seconds, 'rto_seconds', d.rto_seconds,
    'superseded', v_previous
  );
end
$fn$;

revoke all on function public.adopt_recovery_objective(uuid, text) from public, anon, service_role;
grant execute on function public.adopt_recovery_objective(uuid, text) to authenticated;

create or replace function public.record_restore_verification(p_verification jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_name text;
  d public.recovery_objectives%rowtype;
  v_objective uuid;
  v_loss numeric;
  v_restore numeric;
  v_rows text := btrim(coalesce(p_verification->>'canonical_row_check', ''));
  v_witness text := btrim(coalesce(p_verification->>'tenant_isolation_witness', ''));
  v_backup text := btrim(coalesce(p_verification->>'backup_label', ''));
  v_target text := btrim(coalesce(p_verification->>'restore_target', ''));
  v_evidence text := btrim(coalesce(p_verification->>'evidence_reference', ''));
  v_id uuid;
  v_within_rpo boolean;
  v_within_rto boolean;
  v_outcome text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select up.role, up.full_name into v_role, v_name
    from public.user_profiles up
   where up.id = auth.uid() and up.organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error',
      'recording a restore verification is a human attestation. An AI-operator identity cannot record one.');
  end if;
  if v_role not in ('admin', 'executive') then
    return jsonb_build_object('error', 'recording a restore verification requires a named administrator or executive');
  end if;
  if coalesce(length(btrim(v_name)), 0) < 2 then
    return jsonb_build_object('error', 'record your name on your profile before attesting a restore');
  end if;
  if p_verification ? 'verification_outcome' or p_verification ? 'within_rpo' or p_verification ? 'within_rto' then
    return jsonb_build_object('error',
      'the verification outcome is computed from the measurements and the checks. It cannot be submitted.');
  end if;
  begin
    v_objective := (p_verification->>'objective_id')::uuid;
  exception when others then
    return jsonb_build_object('error', 'name the adopted recovery objective this restore was checked against');
  end;
  select * into d from public.recovery_objectives
   where id = v_objective and organization_id = v_org and status = 'adopted';
  if not found then
    return jsonb_build_object('error',
      'restore verification requires the current adopted recovery objective. A draft is not an objective, and another tenant''s objective cannot be used.');
  end if;
  v_loss := public.sync_finite_money(p_verification->>'measured_data_loss_seconds');
  v_restore := public.sync_finite_money(p_verification->>'measured_restore_seconds');
  if v_loss is null or v_restore is null or v_loss < 0 or v_restore < 0 then
    return jsonb_build_object('error',
      'measured data loss and measured restore duration must be finite seconds of at least zero. No measurement is assumed.');
  end if;
  if v_rows not in ('matched', 'mismatched', 'not_run')
     or v_witness not in ('passed', 'failed', 'not_run') then
    return jsonb_build_object('error',
      'canonical row check is matched, mismatched or not_run; tenant isolation witness is passed, failed or not_run');
  end if;
  if length(v_backup) < 8 or length(v_backup) > 200
     or length(v_target) < 8 or length(v_target) > 200
     or length(v_evidence) < 20 or length(v_evidence) > 500 then
    return jsonb_build_object('error',
      'record the backup label, the isolated restore target, and a reference to the retained evidence');
  end if;

  v_within_rpo := v_loss <= d.rpo_seconds;
  v_within_rto := v_restore <= d.rto_seconds;
  v_outcome := case
    when v_rows = 'not_run' or v_witness = 'not_run' then 'checks_not_run'
    when v_rows = 'matched' and v_witness = 'passed' and v_within_rpo and v_within_rto then 'within_objectives'
    else 'outside_objectives'
  end;

  perform set_config('app.recovery_record_write', 'granted', true);
  insert into public.recovery_restore_verifications (
    organization_id, objective_id, backup_label, restore_target, evidence_reference,
    measured_data_loss_seconds, measured_restore_seconds,
    rpo_seconds_applied, rto_seconds_applied,
    canonical_row_check, tenant_isolation_witness,
    within_rpo, within_rto, verification_outcome, recorded_by
  ) values (
    v_org, d.id, v_backup, v_target, v_evidence,
    v_loss, v_restore, d.rpo_seconds, d.rto_seconds,
    v_rows, v_witness, v_within_rpo, v_within_rto, v_outcome, auth.uid()
  ) returning id into v_id;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'recovery_restore_verification', v_name || ' (' || v_role || ')',
    jsonb_build_object('verification_id', v_id, 'objective_id', d.id, 'act', 'record_restore_verification'),
    null,
    jsonb_build_object(
      'measured_data_loss_seconds', v_loss,
      'measured_restore_seconds', v_restore,
      'rpo_seconds_applied', d.rpo_seconds,
      'rto_seconds_applied', d.rto_seconds,
      'canonical_row_check', v_rows,
      'tenant_isolation_witness', v_witness,
      'within_rpo', v_within_rpo,
      'within_rto', v_within_rto,
      'verification_outcome', v_outcome,
      'recorded_by', auth.uid(),
      'recorded_by_name', v_name,
      'evidence_reference', v_evidence
    )
  );

  return jsonb_build_object(
    'verification_id', v_id,
    'verification_outcome', v_outcome,
    'within_rpo', v_within_rpo,
    'within_rto', v_within_rto
  );
end
$fn$;

revoke all on function public.record_restore_verification(jsonb) from public, anon, service_role;
grant execute on function public.record_restore_verification(jsonb) to authenticated;

create or replace function public.get_recovery_posture()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_name text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select up.role, up.full_name into v_role, v_name
    from public.user_profiles up
   where up.id = auth.uid() and up.organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  return jsonb_build_object(
    'role', v_role,
    'viewer_id', auth.uid(),
    'viewer_name', v_name,
    'draft', (
      select jsonb_build_object(
        'id', o.id, 'version', o.version, 'status', o.status,
        'rpo_seconds', o.rpo_seconds, 'rto_seconds', o.rto_seconds,
        'recovery_owner_id', o.recovery_owner_id,
        'recovery_owner_name', owner.full_name,
        'procedure_reference', o.procedure_reference, 'basis', o.basis,
        'stated_by', o.stated_by, 'stated_by_name', stater.full_name,
        'stated_at', o.stated_at, 'adopted_by', o.adopted_by, 'adopted_at', o.adopted_at
      )
      from public.recovery_objectives o
      join public.user_profiles owner on owner.id = o.recovery_owner_id
      join public.user_profiles stater on stater.id = o.stated_by
      where o.organization_id = v_org and o.status = 'draft'
    ),
    'adopted', (
      select jsonb_build_object(
        'id', o.id, 'version', o.version, 'status', o.status,
        'rpo_seconds', o.rpo_seconds, 'rto_seconds', o.rto_seconds,
        'recovery_owner_id', o.recovery_owner_id,
        'recovery_owner_name', owner.full_name,
        'procedure_reference', o.procedure_reference, 'basis', o.basis,
        'stated_by', o.stated_by, 'stated_by_name', stater.full_name,
        'stated_at', o.stated_at, 'adopted_by', o.adopted_by, 'adopted_at', o.adopted_at
      )
      from public.recovery_objectives o
      join public.user_profiles owner on owner.id = o.recovery_owner_id
      join public.user_profiles stater on stater.id = o.stated_by
      where o.organization_id = v_org and o.status = 'adopted'
    ),
    'verifications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'objective_id', v.objective_id,
        'backup_label', v.backup_label, 'restore_target', v.restore_target,
        'evidence_reference', v.evidence_reference,
        'measured_data_loss_seconds', v.measured_data_loss_seconds,
        'measured_restore_seconds', v.measured_restore_seconds,
        'rpo_seconds_applied', v.rpo_seconds_applied,
        'rto_seconds_applied', v.rto_seconds_applied,
        'canonical_row_check', v.canonical_row_check,
        'tenant_isolation_witness', v.tenant_isolation_witness,
        'within_rpo', v.within_rpo, 'within_rto', v.within_rto,
        'verification_outcome', v.verification_outcome,
        'recorded_by_name', recorder.full_name, 'recorded_at', v.recorded_at
      ) order by v.recorded_at desc), '[]'::jsonb)
      from (
        select * from public.recovery_restore_verifications
         where organization_id = v_org
         order by recorded_at desc
         limit 20
      ) v
      join public.user_profiles recorder on recorder.id = v.recorded_by
    ),
    'candidates', case
      when v_role in ('admin', 'executive') then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', up.id, 'full_name', up.full_name, 'role', up.role
        ) order by up.full_name), '[]'::jsonb)
        from public.user_profiles up
        where up.organization_id = v_org
          and up.role <> 'ai_admin'
          and coalesce(length(btrim(up.full_name)), 0) >= 2
      )
      else '[]'::jsonb
    end,
    'documentation', jsonb_build_object(
      'database_drill', 'scripts/database-restore-drill.mjs',
      'runbook', 'docs/enterprise-readiness/database-restore-drill.md',
      'policy_template', 'docs/compliance/policies/05-business-continuity-dr-policy.md',
      'local_drill_is_not_an_approved_rto', true,
      'production_pitr_proven', false,
      'storage_object_bytes_proven', false,
      'vault_root_key_proven', false,
      'edge_secrets_proven', false,
      'boundary', 'Measured local database-drill durations are not an approved recovery-time objective. Hosted production backup, point-in-time recovery, Storage object bytes, the Vault root key and Edge secrets are not established by this record.'
    )
  );
end
$fn$;

revoke all on function public.get_recovery_posture() from public, anon, service_role;
grant execute on function public.get_recovery_posture() to authenticated;

notify pgrst, 'reload schema';
