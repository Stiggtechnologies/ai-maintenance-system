-- U6.01–U6.03 — typed jurisdiction requirements on the canonical layered
-- capability-pack system. No second requirement, approval, organization,
-- evidence or audit store is introduced. A jurisdiction layer must classify
-- every requirement and state applicability/obligation explicitly. Industry
-- guidance is advisory unless a human supplies both a mandatory basis and the
-- authority reference that adopted it.

create or replace function public.enforce_jurisdiction_requirement_pack()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requirements jsonb;
  item jsonb;
  v_class text;
  v_applicability text;
  v_obligation text;
begin
  if new.layer_kind <> 'jurisdiction' then
    return new;
  end if;

  requirements := new.configuration->'jurisdiction_requirements';
  if jsonb_typeof(coalesce(requirements, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(requirements) = 0 then
    raise exception
      'a jurisdiction layer requires a non-empty jurisdiction_requirements array'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(requirements) requirement
    where jsonb_typeof(requirement) <> 'object'
  ) then
    raise exception 'every jurisdiction requirement must be an object'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(requirements) requirement
    group by requirement->>'key'
    having count(*) > 1
  ) then
    raise exception 'jurisdiction requirement keys must be unique'
      using errcode = 'check_violation';
  end if;

  for item in select value from jsonb_array_elements(requirements)
  loop
    v_class := item->>'requirement_class';
    v_applicability := item->>'applicability';
    v_obligation := item->>'obligation';

    if coalesce(item->>'key', '') !~ '^[a-z][a-z0-9_]{2,79}$'
       or length(btrim(coalesce(item->>'title', ''))) < 5
       or length(btrim(coalesce(item->>'authority_reference', ''))) < 3
       or length(btrim(coalesce(item->>'applicability_basis', ''))) < 20 then
      raise exception
        'each jurisdiction requirement needs a machine key, title, authority reference and reviewable applicability basis'
        using errcode = 'check_violation';
    end if;

    if coalesce(item->>'domain', '') not in (
      'inspection_interval', 'certification', 'environmental_reporting',
      'electrical_code', 'pressure_regulation', 'rail', 'aviation',
      'maritime', 'medical_device', 'building_code',
      'worker_qualification', 'privacy_residency', 'retention',
      'indigenous_land_use'
    ) then
      raise exception 'invalid jurisdiction requirement domain'
        using errcode = 'check_violation';
    end if;

    if coalesce(v_class, '') not in (
      'company_standard', 'industry_guidance', 'contractual',
      'regulatory', 'statutory', 'site_rule'
    ) then
      raise exception 'invalid jurisdiction requirement class'
        using errcode = 'check_violation';
    end if;

    if coalesce(v_applicability, '') not in (
      'applicable', 'not_applicable', 'undetermined'
    ) or coalesce(v_obligation, '') not in (
      'advisory', 'mandatory', 'not_applicable'
    ) then
      raise exception 'invalid jurisdiction applicability or obligation'
        using errcode = 'check_violation';
    end if;

    if (v_applicability = 'not_applicable') is distinct from
       (v_obligation = 'not_applicable') then
      raise exception
        'not-applicable status and obligation must be recorded together'
        using errcode = 'check_violation';
    end if;

    if v_obligation = 'mandatory'
       and length(btrim(coalesce(item->>'mandatory_basis', ''))) < 20 then
      raise exception 'a mandatory requirement needs an explicit mandatory basis'
        using errcode = 'check_violation';
    end if;

    if v_class = 'industry_guidance' and v_obligation = 'mandatory'
       and length(btrim(coalesce(item->>'adopted_by_reference', ''))) < 3 then
      raise exception
        'industry guidance can become mandatory only through an explicit adoption reference'
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end
$$;

revoke all on function public.enforce_jurisdiction_requirement_pack()
  from public, anon, authenticated;

drop trigger if exists trg_jurisdiction_requirement_pack
  on public.capability_pack_layers;
create trigger trg_jurisdiction_requirement_pack
before insert or update of layer_kind, configuration
on public.capability_pack_layers
for each row execute function public.enforce_jurisdiction_requirement_pack();

comment on function public.enforce_jurisdiction_requirement_pack() is
  'U6.01-U6.03: fail-closed typed jurisdiction requirement contract. Requirement class, domain, applicability and obligation are explicit; mandatory status always carries a basis, and industry guidance additionally requires an explicit adoption authority reference.';
