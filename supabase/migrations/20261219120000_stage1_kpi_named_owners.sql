-- ============================================================================
-- Stage-1 pilot pack — named KPI owners on the existing RACI store.
--
-- The ISO 55000 catalog (00000000000017) already carries role-level A/R/C/I
-- on every KPI. Stage-1 still needs a NAMED HUMAN in those slots. This file
-- EXTENDS raci_assignments (the one RACI table) rather than minting a parallel
-- owner store, KPI table, approval queue, or audit log.
--
-- decision_type = 'iso55000_kpi:' || kpi_key
--   accountable / responsible hold the named humans
--   consulted / informed keep the catalog role names on first write
--
-- Writes are SECURITY DEFINER only. Clients keep the existing org-scoped
-- raci_assignments_org_rw policy for legacy decision-type rows; KPI-prefixed
-- rows are refused at the trigger so a spreadsheet edit cannot silently
-- install an owner.
-- ============================================================================

alter table public.raci_assignments
  add column if not exists named_by uuid references auth.users(id),
  add column if not exists named_at timestamptz,
  add column if not exists basis text;

create unique index if not exists raci_assignments_kpi_owner_uniq
  on public.raci_assignments (organization_id, decision_type)
  where decision_type like 'iso55000_kpi:%';

comment on column public.raci_assignments.named_by is
  'Named-human actor who last recorded a KPI owner against the ISO 55000 catalog slot.';
comment on column public.raci_assignments.basis is
  'Delegation or RACI instrument that names this human. Empty is not a name.';

-- ---------------------------------------------------------------------------
-- Wall: KPI-prefixed rows are written only through name_kpi_owner.
-- current_setting('sync.stage1_kpi_owner_write', true) is the admit marker
-- the RPC sets. Clients, including a direct insert that already passes RLS,
-- cannot set a custom GUCs that survive into the trigger unless they are
-- the table owner — and authenticated is not.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_kpi_named_owner_wall()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := case when tg_op = 'DELETE' then old.decision_type else new.decision_type end;
begin
  if v_type is null or v_type not like 'iso55000_kpi:%' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if current_setting('sync.stage1_kpi_owner_write', true) is distinct from '1' then
    raise exception
      'ISO 55000 KPI named owners are written only through name_kpi_owner. A direct write is not a named-human RACI act.'
      using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_kpi_named_owner_wall on public.raci_assignments;
create trigger trg_kpi_named_owner_wall
  before insert or update or delete on public.raci_assignments
  for each row execute function public.enforce_kpi_named_owner_wall();

-- ---------------------------------------------------------------------------
-- Write door.
-- ---------------------------------------------------------------------------
create or replace function public.name_kpi_owner(
  p_kpi_key text,
  p_slot text,
  p_owner_name text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_key text := btrim(coalesce(p_kpi_key, ''));
  v_slot text := lower(btrim(coalesce(p_slot, '')));
  v_name text := btrim(coalesce(p_owner_name, ''));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_cat public.kpi_catalog%rowtype;
  v_existing public.raci_assignments%rowtype;
  v_exists boolean := false;
  v_decision text;
  v_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'naming a KPI owner requires a signed-in human');
  end if;
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role
    from user_profiles
   where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'naming who owns a KPI is a human accountability act. Spec forbids an AI or system identity from installing an owner. The AI may propose a name; a human records it.');
  end if;
  if coalesce(v_role, '') not in (
    'admin', 'executive', 'maintenance_manager', 'reliability_engineer'
  ) then
    return jsonb_build_object('error',
      'naming a KPI owner requires an executive, maintenance manager, reliability engineer, or administrator');
  end if;
  if v_slot not in ('accountable', 'responsible') then
    return jsonb_build_object('error',
      'name the Accountable or Responsible human — Consulted and Informed stay catalog roles until a later governed act');
  end if;
  if length(v_name) < 2 then
    return jsonb_build_object('error',
      'state the named human (two characters minimum). A blank owner is not a RACI assignment.');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('error',
      'record the instrument or meeting that names this human (20 characters minimum). A name with no basis is a preference, not a RACI act.');
  end if;

  select * into v_cat from kpi_catalog where kpi_key = v_key;
  if not found then
    return jsonb_build_object('error',
      format('unknown ISO 55000 KPI %s — name owners against the catalog, do not invent keys', v_key));
  end if;

  v_decision := 'iso55000_kpi:' || v_key;
  select * into v_existing
    from raci_assignments
   where organization_id = v_org and decision_type = v_decision;
  v_exists := found;

  perform set_config('sync.stage1_kpi_owner_write', '1', true);

  if v_exists then
    v_id := v_existing.id;
    if v_slot = 'accountable' then
      update raci_assignments
         set accountable = v_name,
             named_by = auth.uid(),
             named_at = now(),
             basis = v_basis
       where id = v_id and organization_id = v_org;
    else
      update raci_assignments
         set responsible = v_name,
             named_by = auth.uid(),
             named_at = now(),
             basis = v_basis
       where id = v_id and organization_id = v_org;
    end if;
  else
    insert into raci_assignments (
      organization_id, decision_type,
      accountable, responsible, consulted, informed,
      named_by, named_at, basis
    ) values (
      v_org, v_decision,
      case when v_slot = 'accountable' then v_name else null end,
      case when v_slot = 'responsible' then v_name else null end,
      v_cat.consulted, v_cat.informed,
      auth.uid(), now(), v_basis
    )
    returning id into v_id;
  end if;

  insert into audit_events (
    organization_id, entity_type, actor, event_data,
    previous_state, new_state
  ) values (
    v_org, 'kpi_named_owner', coalesce(v_role, 'human'),
    jsonb_build_object(
      'kpi_key', v_key,
      'slot', v_slot,
      'raci_assignment_id', v_id,
      'decision_type', v_decision
    ),
    jsonb_build_object(
      'accountable', v_existing.accountable,
      'responsible', v_existing.responsible
    ),
    jsonb_build_object(
      'slot', v_slot,
      'owner_name', v_name,
      'named_by', auth.uid(),
      'basis', v_basis
    )
  );

  return jsonb_build_object(
    'kpi_key', v_key,
    'slot', v_slot,
    'owner_name', v_name,
    'named_by', auth.uid(),
    'raci_assignment_id', v_id
  );
end
$$;

revoke all on function public.name_kpi_owner(text, text, text, text)
  from public, anon, service_role;
grant execute on function public.name_kpi_owner(text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Read door — catalog roles plus named overlay. Audience is a dashboard
-- concern; naming owners is a governance act over the full catalog.
-- ---------------------------------------------------------------------------
create or replace function public.get_kpi_named_owners()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role
    from user_profiles
   where id = auth.uid() and organization_id = v_org;

  return jsonb_build_object(
    'role', v_role,
    'owners', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kpi_key', c.kpi_key,
        'name', c.name,
        'page', c.page,
        'catalog_accountable', c.accountable,
        'catalog_responsible', c.responsible,
        'catalog_consulted', c.consulted,
        'catalog_informed', c.informed,
        'named_accountable', a.accountable,
        'named_responsible', a.responsible,
        'named_at', a.named_at,
        'named_by', a.named_by,
        'basis', a.basis
      ) order by c.page, c.name), '[]'::jsonb)
      from kpi_catalog c
      left join raci_assignments a
        on a.organization_id = v_org
       and a.decision_type = 'iso55000_kpi:' || c.kpi_key
    )
  );
end
$$;

revoke all on function public.get_kpi_named_owners()
  from public, anon, service_role;
grant execute on function public.get_kpi_named_owners()
  to authenticated;

notify pgrst, 'reload schema';
