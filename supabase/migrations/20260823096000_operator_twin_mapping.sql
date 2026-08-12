-- ============================================================================
-- Local class labels -> catalogue vocabulary -> twin templates
-- (register U3 asset ontology, E12.02 master data, U20 layered packs).
--
-- WHY TWO MAPPING TABLES AND NOT A CASE STATEMENT.
--
-- This operator calls a machine a "Support Loader". The OEM catalogue calls the
-- same machine a "Wheel Loader". The twin library calls the class
-- MIN-WHEEL-LOADER. Three vocabularies, none of them wrong, and the next
-- customer will have a fourth. Hard-coding the translation would put one
-- customer's naming into everybody's code path — the same mistake the unit
-- numbering rules exist to avoid, so these follow the same shape: org-scoped
-- rows, each carrying the source that justifies it.
--
-- WHY 'fit' IS A COLUMN.
--
-- Not every mapping is equally good. A support excavator and a hydraulic mining
-- shovel share a functional model — boom, stick, bucket, undercarriage,
-- hydraulics — and share almost nothing about scale. Recording that as
-- 'approximate' with the reason attached means the caveat travels with the
-- twin instead of living in somebody's memory. A class with no honest template
-- gets 'none' and no twin, which is a better answer than a bad twin.
--
-- Canonical reuse: assets, asset_twin_templates/instances from
-- 00000000000019, oem_model_catalogue, app_current_org(). Additive.
-- ============================================================================

create table if not exists asset_class_aliases (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  local_class text not null,
  catalogue_class text not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique(organization_id, local_class)
);

alter table asset_class_aliases enable row level security;
drop policy if exists class_alias_read on asset_class_aliases;
create policy class_alias_read on asset_class_aliases
  for select to authenticated using (organization_id = app_current_org());

create table if not exists asset_class_twin_map (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  local_class text not null,
  template_key text,
  fit text not null check (fit in ('direct','approximate','none')),
  rationale text not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique(organization_id, local_class),
  -- 'none' means no template; anything else must name one.
  constraint twin_map_key_required
    check ((fit = 'none' and template_key is null) or (fit <> 'none' and template_key is not null))
);

alter table asset_class_twin_map enable row level security;
drop policy if exists twin_map_read on asset_class_twin_map;
create policy twin_map_read on asset_class_twin_map
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- This operator's rows. Every source is the owner's own statement about their
-- fleet, made during the unit-numbering work — not an inference.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- GUARD: everything below is specific to one operator's organization, and that
-- organization exists only in production. A migration runs on every
-- environment, so a hard-coded organization_id with a foreign key is a chain
-- that breaks on any fresh database — which is exactly how this failed CI while
-- passing in production, where the row happens to exist.
--
-- 20260822093000 already guards the same way. This did not, and should have.
-- ---------------------------------------------------------------------------
do $guard$
begin
if not exists (select 1 from organizations where id = '5e08b0a4-bb63-43d6-90f8-e42d532f65fd') then
  raise notice 'Operator organization not present; skipping operator-specific twin mapping.';
  return;
end if;
insert into asset_class_aliases (organization_id, local_class, catalogue_class, source)
values
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Support Loader','Wheel Loader',
   'Fleet owner: the 65-series are Caterpillar large wheel loaders.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Wheel Loader','Wheel Loader',
   'Fleet owner: the 67-series are Caterpillar large wheel loaders.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Support Dozer','Dozer',
   'Fleet owner: 5-series are dozers. Support Dozer is a duty label, not a different machine.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Dozer','Dozer',
   'Fleet owner: 53xx D8, 55xx D10, 56xx D11.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Grader','Grader',
   'Fleet owner: 72xx Cat 16H/M, 73xx Cat 24H/M.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Wheel Dozer','Wheel Dozer',
   'Fleet owner: the 68-series are wheel dozers. Manufacturer not stated.')
on conflict (organization_id, local_class) do update
  set catalogue_class = excluded.catalogue_class, source = excluded.source;

insert into asset_class_twin_map
  (organization_id, local_class, template_key, fit, rationale, source)
values
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Wheel Loader','MIN-WHEEL-LOADER','direct',
   'Same machine the template was written for.',
   'Fleet owner: Caterpillar large wheel loader.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Support Loader','MIN-WHEEL-LOADER','direct',
   'Same machine as the 67-series under a duty label.',
   'Fleet owner: 65-series are Caterpillar large.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Dozer','MIN-DOZER','direct',
   'Large mining dozer. NOTE: this template is a starter — it names the functions and '
   || 'operating states and carries no components or failure modes yet, so a twin '
   || 'compiled from it is a shell. It is the largest class in this fleet and the '
   || 'thinnest template in the library.',
   'Fleet owner numbering taxonomy.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Support Dozer','MIN-DOZER','direct',
   'Same starter-template caveat as Dozer.',
   'Fleet owner numbering taxonomy.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Grader','MIN-GRADER','direct',
   'Motor grader. Same starter-template caveat: no components or failure modes yet.',
   'Fleet owner numbering taxonomy.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Excavator','MIN-HYD-SHOVEL','approximate',
   'A tracked hydraulic excavator and a hydraulic mining shovel share a functional '
   || 'model — boom, stick, bucket, undercarriage, hydraulics — and share almost '
   || 'nothing about scale. The failure modes transfer; the intervals, component '
   || 'sizes and duty assumptions do not. Usable as structure, not as numbers.',
   'Fleet-owner-confirmed tracked excavators; work-order component signature shows '
   || 'undercarriage and boom with zero tyres, transmission or steering.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Wheel Dozer',null,'none',
   'The library has no wheel dozer template. MIN-DOZER is a track machine: its '
   || 'undercarriage is the dominant cost driver and a wheel dozer has none. '
   || 'Compiling one would attach the wrong failure modes to two real machines.',
   'Fleet owner: 68-series are wheel dozers.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Shovel',null,'none',
   'One unit, 6601, described by the owner as a purpose-built excavator that cleans '
   || 'and supports hoppers. 21 work orders is too little to settle what it is, and '
   || 'the class label is already known to be unreliable for it.',
   'Fleet owner description of unit 6601.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Transporter',null,'none',
   'Machine transporters. No template exists and none of the mining library classes '
   || 'is close enough to borrow.',
   'Fleet owner: 20xx are machine transporters and water trucks.'),
  ('5e08b0a4-bb63-43d6-90f8-e42d532f65fd','Water Truck',null,'none',
   'No water truck template exists in the library.',
   'Fleet owner: 20xx are machine transporters and water trucks.')
on conflict (organization_id, local_class) do update
  set template_key = excluded.template_key, fit = excluded.fit,
      rationale = excluded.rationale, source = excluded.source;

end $guard$;

-- ---------------------------------------------------------------------------
-- Provision draft twin instances.
--
-- Template only. No overlay is ever attached here, because attaching one means
-- asserting which model the machine is, and that is precisely the fact research
-- cannot establish. The compilation log records the fit and, for 'approximate',
-- the reason — so anyone reading the twin later sees the caveat rather than
-- having to know it.
-- ---------------------------------------------------------------------------
drop function if exists provision_twin_instances(boolean);
create or replace function provision_twin_instances(p_dry_run boolean default true)
returns table (
  outcome text,
  created bigint,
  already_present bigint,
  skipped_no_template bigint,
  approximate bigint,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_created bigint := 0; v_present bigint := 0; v_skipped bigint := 0; v_approx bigint := 0;
  v_note text := '';
  r record;
  v_version text;
begin
  if v_org is null then
    return query select 'error'::text, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
                        'No organization in session.'::text;
    return;
  end if;

  for r in
    select a.id asset_id, a.name, a.asset_class, m.fit, m.rationale, m.template_key,
           t.id template_id, t.version, t.template
    from assets a
    left join asset_class_twin_map m
      on m.organization_id = a.organization_id and m.local_class = a.asset_class
    left join asset_twin_templates t on t.template_key = m.template_key
    where a.organization_id = v_org
  loop
    -- No mapping row, an explicit 'none', or a template_key that resolves to
    -- nothing: all three mean no twin, and the last one is a data error worth
    -- counting rather than silently treating as 'none'.
    if r.template_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_version := r.version || '+template-only';

    if exists (select 1 from asset_twin_instances i
               where i.asset_id = r.asset_id and i.compiled_version = v_version) then
      v_present := v_present + 1;
      continue;
    end if;

    if r.fit = 'approximate' then v_approx := v_approx + 1; end if;

    if not p_dry_run then
      insert into asset_twin_instances (
        organization_id, asset_id, template_id, overlay_id, compiled_version,
        compiled_twin, customer_overrides, compilation_log, status
      ) values (
        v_org, r.asset_id, r.template_id, null, v_version,
        r.template, '{}'::jsonb,
        jsonb_build_array(jsonb_build_object(
          'compiled_at', now(),
          'template_version', r.version,
          'overlay_version', null,
          'fit', r.fit,
          'rationale', r.rationale,
          'basis', 'Class mapping only. No OEM model overlay is attached: the model '
                   || 'this machine actually is has not been established, and a '
                   || 'researched guess would look identical to a fact here.',
          'actor', null
        )),
        'draft'
      );
      v_created := v_created + 1;
    else
      v_created := v_created + 1;
    end if;
  end loop;

  select coalesce(string_agg(local_class || ' (' || count::text || ')', ', '), '(none)')
    into v_note
  from (
    select a.asset_class local_class, count(*) count
    from assets a
    left join asset_class_twin_map m
      on m.organization_id = a.organization_id and m.local_class = a.asset_class
    left join asset_twin_templates t on t.template_key = m.template_key
    where a.organization_id = v_org and t.id is null
    group by a.asset_class
  ) s;

  return query select
    case when p_dry_run then 'dry_run' else 'applied' end::text,
    v_created, v_present, v_skipped, v_approx,
    (case when p_dry_run then 'DRY RUN — nothing written. ' else 'Applied. ' end
     || v_created || ' draft twin(s) ' || case when p_dry_run then 'would be ' else '' end
     || 'created, ' || v_present || ' already present. '
     || v_approx || ' rest on an approximate template fit and carry the reason in their '
     || 'compilation log. '
     || v_skipped || ' asset(s) got no twin: ' || v_note || '. '
     || 'No twin here has an OEM model overlay — the model is not established, and '
     || 'the twin says so rather than guessing.')::text;
end;
$$;

grant execute on function provision_twin_instances(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Redefine the candidate shortlist to translate through the aliases above.
--
-- Without this the seven Caterpillar "Support Loader" units return no
-- candidates, not because the catalogue lacks their models but because the
-- operator's word for the class differs from the catalogue's. An empty result
-- that means "vocabulary mismatch" reads exactly like one that means "nothing
-- known", which is the failure mode this whole register is built to avoid.
-- ---------------------------------------------------------------------------
drop function if exists suggest_asset_models(int);
create or replace function suggest_asset_models(p_limit int default 200)
returns table (
  asset_id uuid,
  asset_name text,
  asset_class text,
  recorded_manufacturer text,
  recorded_model text,
  candidate_count int,
  candidates jsonb,
  verdict text,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := app_current_org();
begin
  if v_org is null then return; end if;

  return query
  with resolved as (
    select a.id, a.name, a.asset_class ac, a.manufacturer mk, a.model md,
           coalesce(al.catalogue_class, a.asset_class) cc,
           al.catalogue_class is not null and al.catalogue_class <> a.asset_class translated
    from assets a
    left join asset_class_aliases al
      on al.organization_id = a.organization_id and al.local_class = a.asset_class
    where a.organization_id = v_org
      and (a.model is null or btrim(a.model) = '')
  ),
  candidate as (
    select r.*, c.manufacturer cm, c.model cmodel, c.size_class, c.maturity, c.key_specs
    from resolved r
    left join oem_model_catalogue c
      on lower(c.asset_class) = lower(r.cc)
      and (r.mk is null or lower(c.manufacturer) = lower(r.mk))
  ),
  grouped as (
    select id, name, ac, mk, md, cc, translated,
           count(cmodel)::int n,
           coalesce(jsonb_agg(jsonb_build_object(
             'manufacturer', cm, 'model', cmodel,
             'size_class', size_class, 'maturity', maturity, 'key_specs', key_specs
           ) order by cm, cmodel) filter (where cmodel is not null), '[]'::jsonb) cands,
           count(distinct cm) filter (where cm is not null)::int makes
    from candidate group by id, name, ac, mk, md, cc, translated
  )
  select g.id, g.name, g.ac, g.mk, g.md, g.n, g.cands,
    case when g.n = 0 then 'no_candidates'
         when g.n = 1 and g.mk is not null then 'single_candidate'
         else 'ambiguous' end::text,
    (case when g.translated then
       'Read as catalogue class "' || g.cc || '". ' else '' end
     ||
     case
      when g.n = 0 then
        'No catalogue entry for class "' || coalesce(g.cc,'(none)') || '"'
        || case when g.mk is not null then ' from ' || g.mk else '' end
        || '. Research has not established what models exist here, so nothing is proposed.'
      when g.n = 1 and g.mk is not null then
        'Exactly one catalogued ' || g.mk || ' model matches this class. That makes it the '
        || 'only candidate, not a confirmed fact — a fleet can run a model the catalogue '
        || 'does not list. A person assigns it.'
      when g.mk is null then
        g.n || ' candidate(s) across ' || g.makes || ' manufacturer(s). The asset does not '
        || 'record a make, so the catalogue cannot narrow this. Naming the manufacturer first '
        || 'is the cheaper half of the problem.'
      else
        g.n || ' catalogued ' || g.mk || ' models match this class. Distinguishing them needs '
        || 'something this register does not hold — a serial number, a nameplate photograph or '
        || 'the purchase record.'
    end)::text
  from grouped g
  order by g.n desc, g.name
  limit greatest(p_limit, 0);
end;
$$;

grant execute on function suggest_asset_models(int) to authenticated;

notify pgrst, 'reload schema';
