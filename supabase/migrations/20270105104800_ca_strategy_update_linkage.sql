-- Close the corrective-action strategy loop with canonical, adopted evidence.
--
-- ca_verifications already owns corrective-action closure and
-- asset_lifecycle_plans already owns immutable, independently reviewed strategy
-- adoption.  This migration links those two canonical records.  It does not
-- create a second strategy, approval or audit model.

create unique index if not exists asset_lifecycle_plans_org_asset_id_key
  on public.asset_lifecycle_plans(organization_id, asset_id, id);

alter table public.ca_verifications
  add column if not exists strategy_lifecycle_plan_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ca_verifications'::regclass
      and conname = 'ca_strategy_lifecycle_plan_tenant_asset_fk'
  ) then
    alter table public.ca_verifications
      add constraint ca_strategy_lifecycle_plan_tenant_asset_fk
      foreign key (organization_id, asset_id, strategy_lifecycle_plan_id)
      references public.asset_lifecycle_plans(organization_id, asset_id, id)
      on delete restrict;
  end if;
end
$$;

-- Strategy evidence becomes immutable once linked.  The marker is available
-- only inside the governed SECURITY DEFINER function below; direct table writes
-- cannot manufacture a strategy update or replace its adopted version.
create or replace function public.protect_ca_strategy_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.strategy_lifecycle_plan_id is distinct from old.strategy_lifecycle_plan_id then
    if old.strategy_lifecycle_plan_id is not null then
      raise exception 'Corrective-action strategy evidence is immutable';
    end if;
    if coalesce(current_setting('app.ca_strategy_link_write', true), '') <> 'granted' then
      raise exception 'Use the governed corrective-action strategy linkage';
    end if;
  end if;

  if new.strategy_updated_at is distinct from old.strategy_updated_at
     and new.strategy_updated_at is not null
     -- Project corrective-action closure has no asset by design and completes
     -- this stage through its independently approved canonical standard-work
     -- revision. The lifecycle-plan requirement belongs only to asset/work-
     -- order verification.
     and new.project_lesson_id is null
     and new.strategy_lifecycle_plan_id is null then
    raise exception 'Strategy completion requires an adopted lifecycle-plan version';
  end if;

  if old.strategy_lifecycle_plan_id is not null
     and (new.strategy_updated_at is distinct from old.strategy_updated_at
       or new.strategy_updated_by is distinct from old.strategy_updated_by
       or new.strategy_note is distinct from old.strategy_note) then
    raise exception 'Corrective-action strategy evidence is immutable';
  end if;

  return new;
end
$$;

revoke all on function public.protect_ca_strategy_link()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_ca_strategy_link on public.ca_verifications;
create trigger trg_protect_ca_strategy_link
  before update on public.ca_verifications
  for each row execute function public.protect_ca_strategy_link();

-- Preserve the existing physical and causal human attestations, but retire the
-- free-text strategy shortcut.  Strategy completion now requires the governed
-- link_ca_strategy_update function below.
create or replace function public.attest_ca_stage(
  p_verification_id uuid,
  p_stage text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.ca_verifications%rowtype;
begin
  select * into v
  from public.ca_verifications
  where id = p_verification_id
    and organization_id = public.app_current_org();

  if not found then
    return jsonb_build_object('error', 'verification not found');
  end if;
  if v.project_lesson_id is not null then
    return jsonb_build_object('error', 'Use the governed project closure stages');
  end if;
  if p_stage = 'strategy' then
    return jsonb_build_object(
      'error',
      'Strategy completion requires a same-asset adopted lifecycle-plan version; use the governed strategy linkage'
    );
  end if;
  if p_stage not in ('physical', 'causal') then
    return jsonb_build_object('error', 'unknown stage; expected physical|causal');
  end if;

  if p_stage = 'physical' then
    update public.ca_verifications
    set physical_verified_at = now(),
        physical_verified_by = auth.uid(),
        physical_note = left(p_note, 1000)
    where id = v.id;
  else
    update public.ca_verifications
    set causal_addressed_at = now(),
        causal_addressed_by = auth.uid(),
        causal_note = left(p_note, 1000)
    where id = v.id;
  end if;

  return jsonb_build_object('ok', true, 'stage', p_stage);
end
$$;

revoke all on function public.attest_ca_stage(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.attest_ca_stage(uuid, text, text)
  to authenticated;

create or replace function public.link_ca_strategy_update(
  p_verification_id uuid,
  p_lifecycle_plan_id uuid,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v public.ca_verifications%rowtype;
  l public.asset_lifecycle_plans%rowtype;
  v_prior_strategy_at timestamptz;
begin
  if v_org is null or v_actor is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role
  from public.user_profiles
  where id = v_actor and organization_id = v_org;
  if coalesce(v_role, '') not in ('reliability_engineer', 'admin') then
    return jsonb_build_object(
      'error',
      'Linking a corrective-action strategy update requires a named reliability engineer or administrator'
    );
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20
     or length(p_basis) > 4000 then
    return jsonb_build_object(
      'error',
      'Record a 20–4000 character basis explaining how the adopted strategy addresses this corrective action'
    );
  end if;

  select * into v
  from public.ca_verifications
  where id = p_verification_id
    and organization_id = v_org
    and project_lesson_id is null
  for update;
  if not found then
    return jsonb_build_object('error', 'work-order corrective-action verification not found');
  end if;
  if v.strategy_lifecycle_plan_id is not null then
    return jsonb_build_object('error', 'corrective-action strategy evidence is already linked and immutable');
  end if;
  if v.physical_verified_at is null or v.causal_addressed_at is null then
    return jsonb_build_object(
      'error',
      'Verify the physical correction and causal mechanism before recording the strategy update'
    );
  end if;

  select * into l
  from public.asset_lifecycle_plans
  where id = p_lifecycle_plan_id
    and organization_id = v_org
    and asset_id = v.asset_id
  for share;
  if not found then
    return jsonb_build_object('error', 'same-tenant, same-asset adopted lifecycle-plan version not found');
  end if;
  if l.adopted_action <> 'apply_recommended'
     or coalesce((l.adopted_strategy ->> 'programmeChanged')::boolean, false) is not true then
    return jsonb_build_object(
      'error',
      'The lifecycle-plan decision did not apply a maintenance-programme change'
    );
  end if;

  v_prior_strategy_at := v.strategy_updated_at;
  perform set_config('app.ca_strategy_link_write', 'granted', true);
  update public.ca_verifications
  set strategy_lifecycle_plan_id = l.id,
      strategy_updated_at = now(),
      strategy_updated_by = v_actor,
      strategy_note = btrim(p_basis),
      status = case
        when physical_verified_at is not null and causal_addressed_at is not null
          then 'observing'
        else status
      end
  where id = v.id;
  perform set_config('app.ca_strategy_link_write', '', true);

  insert into public.audit_events(
    organization_id,
    entity_type,
    actor,
    event_data,
    new_state
  ) values (
    v_org,
    'ca_strategy_update',
    v_role,
    jsonb_build_object(
      'verificationId', v.id,
      'assetId', v.asset_id,
      'lifecyclePlanId', l.id,
      'lifecyclePlanVersion', l.version,
      'maintenancePlanId', l.maintenance_plan_id,
      'sourceAssessmentId', l.source_assessment_id,
      'linkedBy', v_actor,
      'basis', btrim(p_basis),
      'replacedLegacyAttestation', v_prior_strategy_at is not null
    ),
    jsonb_build_object(
      'strategyUpdated', true,
      'status', 'observing',
      'programmeChanged', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'verificationId', v.id,
    'lifecyclePlanId', l.id,
    'lifecyclePlanVersion', l.version,
    'status', 'observing',
    'authority', 'A named human linked an independently reviewed, adopted programme change. Risk acceptance, work release, expenditure and return-to-service remain separate authorities.'
  );
exception
  when invalid_text_representation then
    return jsonb_build_object('error', 'The adopted lifecycle-plan evidence is malformed');
end
$$;

revoke all on function public.link_ca_strategy_update(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.link_ca_strategy_update(uuid, uuid, text)
  to authenticated;

comment on column public.ca_verifications.strategy_lifecycle_plan_id is
  'Immutable same-tenant, same-asset adopted lifecycle-plan version that proves the corrective action changed the canonical maintenance programme.';
comment on function public.link_ca_strategy_update(uuid, uuid, text) is
  'Named-human linkage from corrective-action closure to an independently reviewed canonical lifecycle-plan version; does not approve strategy or accept risk.';

notify pgrst, 'reload schema';
