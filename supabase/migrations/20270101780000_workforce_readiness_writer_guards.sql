-- ============================================================================
-- Workforce readiness writer guards
--
-- The scheduling surface made the established workforce, competency and shift
-- writers customer-operable. This migration closes the three authority gaps
-- found during the pre-merge tenancy review without introducing another
-- workforce store or workflow:
--
--   * a SECURITY DEFINER workforce writer must not accept another tenant's
--     site through the globally keyed sites foreign key;
--   * an inactive workforce member cannot receive a new competency holding;
--   * an inactive workforce member cannot be placed on a new shift.
--
-- The deployed implementations are retained as private authoritative internals
-- and the public signatures become narrow guard doors. The internal functions
-- are revoked from every API role so callers cannot bypass these checks.
-- ============================================================================

alter function public.record_workforce_member(jsonb)
  rename to record_workforce_member_authoritative_internal;

revoke all on function public.record_workforce_member_authoritative_internal(jsonb)
  from public, anon, authenticated, service_role;

create function public.record_workforce_member(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_site_text text := nullif(btrim(p_payload->>'siteId'), '');
  v_site uuid;
  v_hired_text text := nullif(btrim(p_payload->>'hiredOn'), '');
  v_departure_text text := nullif(btrim(p_payload->>'expectedDeparture'), '');
  v_hired date;
  v_departure date;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;

  if v_site_text is not null then
    v_site := sync_text_as_uuid(v_site_text);
    if v_site is null then
      return jsonb_build_object('answered', false,
        'refusal', 'siteId must be a valid site identifier');
    end if;
    perform 1
      from public.sites s
     where s.id = v_site and s.organization_id = v_org
     for share;
    if not found then
      return jsonb_build_object('answered', false,
        'refusal', 'site not found in this organization');
    end if;
  end if;

  if v_hired_text is not null then
    v_hired := sync_text_as_date(v_hired_text);
    if v_hired is null then
      return jsonb_build_object('answered', false,
        'refusal', 'hiredOn must be a valid date');
    end if;
  end if;

  if v_departure_text is not null then
    v_departure := sync_text_as_date(v_departure_text);
    if v_departure is null then
      return jsonb_build_object('answered', false,
        'refusal', 'expectedDeparture must be a valid date');
    end if;
  end if;

  if v_hired is not null and v_departure is not null
     and v_departure < v_hired then
    return jsonb_build_object('answered', false,
      'refusal', 'expected departure cannot precede the hire date');
  end if;

  return public.record_workforce_member_authoritative_internal(p_payload);
end
$$;

revoke all on function public.record_workforce_member(jsonb) from public, anon;
grant execute on function public.record_workforce_member(jsonb) to authenticated;

comment on function public.record_workforce_member(jsonb) is
  'Customer door for the canonical workforce writer. Validates optional dates and proves any named site belongs to app_current_org before delegating to the private authoritative implementation.';

alter function public.record_member_competency(jsonb)
  rename to record_member_competency_authoritative_internal;

revoke all on function public.record_member_competency_authoritative_internal(jsonb)
  from public, anon, authenticated, service_role;

create function public.record_member_competency(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_member_id bigint := sync_text_as_bigint(p_payload->>'memberId');
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  if v_member_id is null then
    return jsonb_build_object('answered', false,
      'refusal', 'memberId must identify a workforce member');
  end if;
  perform 1
    from public.workforce_members m
   where m.id = v_member_id
     and m.organization_id = v_org
     and m.active
   for share;
  if not found then
    return jsonb_build_object('answered', false,
      'refusal', 'active workforce member not found in this organization');
  end if;

  return public.record_member_competency_authoritative_internal(p_payload);
end
$$;

revoke all on function public.record_member_competency(jsonb) from public, anon;
grant execute on function public.record_member_competency(jsonb) to authenticated;

comment on function public.record_member_competency(jsonb) is
  'Customer door for the canonical competency-holding writer. A new qualification may be attached only to an active member of app_current_org; the private implementation retains the evidence, role and human-verifier controls.';

alter function public.record_shift_assignment(jsonb)
  rename to record_shift_assignment_authoritative_internal;

revoke all on function public.record_shift_assignment_authoritative_internal(jsonb)
  from public, anon, authenticated, service_role;

create function public.record_shift_assignment(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_member_id bigint := sync_text_as_bigint(p_payload->>'memberId');
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  if v_member_id is null then
    return jsonb_build_object('answered', false,
      'refusal', 'memberId must identify a workforce member');
  end if;
  perform 1
    from public.workforce_members m
   where m.id = v_member_id
     and m.organization_id = v_org
     and m.active
   for share;
  if not found then
    return jsonb_build_object('answered', false,
      'refusal', 'active workforce member not found in this organization');
  end if;

  return public.record_shift_assignment_authoritative_internal(p_payload);
end
$$;

revoke all on function public.record_shift_assignment(jsonb) from public, anon;
grant execute on function public.record_shift_assignment(jsonb) to authenticated;

comment on function public.record_shift_assignment(jsonb) is
  'Customer door for the canonical roster writer. A new shift may be assigned only to an active member of app_current_org; the private implementation retains the role, time-window, audit and named-human controls.';
