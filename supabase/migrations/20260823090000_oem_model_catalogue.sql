-- ============================================================================
-- OEM model catalogue — researched master data about machines that exist
-- (register E12.02 master data, U3 shared design, E7 supplier concentration).
--
-- THE DISTINCTION THIS TABLE IS BUILT AROUND.
--
-- Research can establish what models a manufacturer makes. It cannot establish
-- which model an operator owns. Those are different kinds of fact, and the
-- second one is not derivable from the first no matter how confident the
-- research is. So this catalogue is deliberately NOT organization-scoped and
-- deliberately does not write to assets. It is a reference list; matching a
-- machine to a row in it is a separate, human act.
--
-- Every row therefore carries evidence, and the check constraint below refuses
-- any row above 'draft' that has none. A specification with no citation is a
-- rumour with units attached, and CLAUDE.md forbids inventing OEM figures.
--
-- WHY 'ai_extracted' AND NOT HIGHER.
--
-- These figures were read off manufacturer and specification-aggregator pages
-- by an agent. That is enough to shortlist a candidate and nowhere near enough
-- to size a component, set a maintenance interval or sign a safety case. The
-- maturity ladder is shared with asset_twin_templates for exactly this reason:
--   draft -> ai_extracted -> engineer_reviewed -> field_validated -> approved
-- Only a person moves a row up it. No migration ever will.
--
-- Canonical reuse: assets, app_current_org(), the twin maturity vocabulary from
-- 00000000000019_asset_twin_library.sql. Additive.
-- ============================================================================

create table if not exists oem_model_catalogue (
  id bigserial primary key,
  manufacturer text not null,
  model text not null,
  -- Vocabulary shared with assets.asset_class so a candidate search can join.
  asset_class text not null,
  family text,
  -- Coarse size band. This is what actually rules a candidate in or out when a
  -- fleet has several models of the same class.
  size_class text,
  key_specs jsonb not null default '{}'::jsonb,
  -- [{source, title, locator, retrieved_at, confidence}]
  evidence jsonb not null default '[]'::jsonb,
  maturity text not null default 'ai_extracted'
    check (maturity in ('draft','ai_extracted','engineer_reviewed','field_validated','approved')),
  notes text,
  created_at timestamptz not null default now(),
  unique(manufacturer, model),
  -- The whole point of the table: nothing claims to be more than a draft
  -- without a citation.
  constraint oem_model_evidence_required
    check (maturity = 'draft' or jsonb_array_length(evidence) > 0)
);

create index if not exists idx_oem_catalogue_class
  on oem_model_catalogue(asset_class, manufacturer);

alter table oem_model_catalogue enable row level security;
drop policy if exists oem_catalogue_read on oem_model_catalogue;
-- World facts, not tenant data: readable by any authenticated user, writable
-- by none of them through the API.
create policy oem_catalogue_read on oem_model_catalogue
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Researched rows.
--
-- Sources are recorded per row. Where a search returned the model's existence
-- but not its figures, the row is 'draft' with empty key_specs rather than
-- carrying numbers nobody can point at.
-- ---------------------------------------------------------------------------
insert into oem_model_catalogue
  (manufacturer, model, asset_class, family, size_class, key_specs, evidence, maturity, notes)
values
  -- Large mining dozers. The operator's 53xx/55xx/56xx prefixes.
  ('Caterpillar','D8T','Dozer','Large track-type tractor','~38 t',
   '{"net_power_hp":354,"operating_weight_lb":84573}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar D8T Crawler Tractor Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-d8t-crawler-tractor","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted', null),
  ('Caterpillar','D10T','Dozer','Large track-type tractor','~66 t',
   '{"net_power_hp":580,"operating_weight_lb":146500}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar D10T Crawler Tractor Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-d10t-crawler-tractor","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted', null),
  ('Caterpillar','D11T','Dozer','Large track-type tractor','~113 t',
   '{"gross_power_hp":936,"operating_weight_lb":248500,"blade_capacity_yd3":57.0}'::jsonb,
   '[{"source":"Caterpillar product brochure","title":"D11T/D11T CD Track-Type Tractor","locator":"https://elibrarywcl.wordpress.com/wp-content/uploads/2015/02/track-type-tractors-d11t.pdf","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted', null),

  -- Motor graders. The operator's 72xx/73xx prefixes name both H and M series.
  ('Caterpillar','16M','Grader','Motor grader','~26 t',
   '{"net_power_hp":312,"operating_weight_lb":57452}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar 16M Motor Grader Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-16m-motor-grader","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted', null),
  ('Caterpillar','24M','Grader','Motor grader','~62 t',
   '{"net_power_hp":533,"operating_weight_lb":137692}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar 24M Motor Grader Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-24m-motor-grader","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted', null),
  ('Caterpillar','16H','Grader','Motor grader',null,
   '{}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar 16H Motor Grader Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-16h-motor-grader","retrieved_at":"2026-08-10","confidence":"low"}]'::jsonb,
   'draft','Predecessor of the 16M. Listed so a 72xx candidate search shows both series; figures not retrieved.'),
  ('Caterpillar','24H','Grader','Motor grader',null,
   '{}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar 24H ES Motor Grader Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-24h-es-motor-grader","retrieved_at":"2026-08-10","confidence":"low"}]'::jsonb,
   'draft','Predecessor of the 24M. Listed so a 73xx candidate search shows both series; figures not retrieved.'),

  -- Large wheel loaders. The owner identified the 65xx/67xx series as
  -- Caterpillar large wheel loaders.
  ('Caterpillar','992K','Wheel Loader','Large wheel loader','~98 t',
   '{"engine":"Cat C32 ACERT","transmission":"planetary powershift 3F/3R","linkage":"box-boom"}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar 992K Wheel Loader Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-992k-wheel-loader","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted','Shares a planetary gear group with the 993K and 994F — relevant to shared-design common-cause screening.'),
  ('Caterpillar','993K','Wheel Loader','Large wheel loader','~133 t',
   '{"gross_power_hp":950,"gross_power_kw":708,"engine":"Cat C32 ACERT","linkage":"Z-bar","design_structure_life_h":45000}'::jsonb,
   '[{"source":"Caterpillar","title":"993K Large Wheel Loader","locator":"https://www.cat.com/en_US/by-industry/mining/surface-mining/surface-equipment/large-wheel-loaders/993K.html","retrieved_at":"2026-08-10","confidence":"medium"},{"source":"MINING.COM","title":"Caterpillar offers new size class 993K wheel loader","locator":"https://www.mining.com/caterpillar-offers-new-size-class-993k-wheel-loader-designed-for-tough-digging-and-fast-loading/","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted', null),
  ('Caterpillar','994F','Wheel Loader','Large wheel loader','~240 t',
   '{}'::jsonb,
   '[{"source":"MINING.COM","title":"Caterpillar offers new size class 993K wheel loader","locator":"https://www.mining.com/caterpillar-offers-new-size-class-993k-wheel-loader-designed-for-tough-digging-and-fast-loading/","retrieved_at":"2026-08-10","confidence":"low"}]'::jsonb,
   'draft','Shares transmission components with the 992K/993K per the same source. Figures not retrieved.'),

  -- Wheel dozers. The owner identified the 68xx series as wheel dozers but did
  -- NOT name a manufacturer, so these are candidates by class only.
  ('Caterpillar','824H','Wheel Dozer','Wheel dozer','~29 t',
   '{"net_power_hp":354,"operating_weight_lb":63325,"blade_capacity_yd3":6.2}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar 824H Wheel Dozer Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-824h-wheel-dozer","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted', null),
  ('Caterpillar','834H','Wheel Dozer','Wheel dozer','~47 t',
   '{"net_power_hp":498,"operating_weight_lb":103849,"blade_capacity_yd3":10.4}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar 834H Wheel Dozer Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-834h-wheel-dozer","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted', null),
  ('Caterpillar','854K','Wheel Dozer','Wheel dozer','~98 t',
   '{"net_power_hp":800.6,"operating_weight_lb":217128.9,"blade_capacity_yd3":33.3}'::jsonb,
   '[{"source":"RitchieSpecs","title":"Caterpillar 854K Wheel Dozer Specs","locator":"https://www.ritchiespecs.com/model/caterpillar-854k-wheel-dozer","retrieved_at":"2026-08-10","confidence":"medium"}]'::jsonb,
   'ai_extracted','Largest wheel dozer in the Caterpillar line.')
on conflict (manufacturer, model) do update set
  key_specs = excluded.key_specs,
  evidence = excluded.evidence,
  size_class = excluded.size_class,
  notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- Candidate shortlist. Proposes, never writes.
--
-- The same propose-never-act shape as the dependency and duplicate candidate
-- queues: this returns what the catalogue COULD match and states why it cannot
-- decide, and a person assigns the model.
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
  with candidate as (
    select a.id, a.name, a.asset_class ac, a.manufacturer mk, a.model md,
           c.manufacturer cm, c.model cmodel, c.size_class, c.maturity, c.key_specs
    from assets a
    left join oem_model_catalogue c
      on lower(c.asset_class) = lower(a.asset_class)
      -- Where the asset already names a make, only that make's models are
      -- candidates. Where it does not, every make of the class is, and the
      -- verdict below says so rather than picking one.
      and (a.manufacturer is null or lower(c.manufacturer) = lower(a.manufacturer))
    where a.organization_id = v_org
      and (a.model is null or btrim(a.model) = '')
  ),
  grouped as (
    select id, name, ac, mk, md,
           count(cmodel)::int n,
           coalesce(jsonb_agg(jsonb_build_object(
             'manufacturer', cm, 'model', cmodel,
             'size_class', size_class, 'maturity', maturity, 'key_specs', key_specs
           ) order by cm, cmodel) filter (where cmodel is not null), '[]'::jsonb) cands,
           count(distinct cm) filter (where cm is not null)::int makes
    from candidate group by id, name, ac, mk, md
  )
  select g.id, g.name, g.ac, g.mk, g.md, g.n, g.cands,
    case when g.n = 0 then 'no_candidates'
         when g.n = 1 and g.mk is not null then 'single_candidate'
         else 'ambiguous' end::text,
    case
      when g.n = 0 then
        'No catalogue entry for class "' || coalesce(g.ac,'(none)') || '"'
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
    end::text
  from grouped g
  order by g.n desc, g.name
  limit greatest(p_limit, 0);
end;
$$;

grant execute on function suggest_asset_models(int) to authenticated;

notify pgrst, 'reload schema';
