-- ============================================================================
-- Terotechnology end to end: the authorities across the whole asset life
-- (register U19 AI governance, E12 data governance, U4 lifecycle).
--
-- WHY THE WHOLE LIFECYCLE AND NOT JUST THE RELIABILITY SLICE.
--
-- Terotechnology is the practice of managing an asset's ECONOMIC LIFE — the
-- combination of engineering, financial and management practice applied from
-- specification through design, procurement, commissioning, operation,
-- maintenance, modification and disposal, with the results fed back into the
-- next design. The first pass at this register covered analysis methods
-- (Weibull, FTA, FMEA) because that is where the platform's code sits. That is
-- one phase of eight.
--
-- A capability register that only cites analysis standards implies the platform
-- has a view on analysis and none on whether the asset should have been bought.
-- Life-cycle costing, maintainability specification, obsolescence and disposal
-- are all governed, and all absent until now.
--
-- THE FINDING THAT MAKES THE CASE.
--
-- BS 3843, the standard that named terotechnology and defined it as "the
-- economic management of assets", was WITHDRAWN in November 2011. Its role
-- passed to ISO 55000 and EN 16646. Anyone still citing BS 3843 — and the
-- literature does, constantly — is citing a dead document. That is exactly what
-- the watch exists to catch, and it could not be caught by reading the code.
--
-- Editions verified 2026-08-10 where a source was found. Everything else says
-- "edition not verified" rather than carrying a confident guess.
-- ============================================================================

alter table standards_register
  add column if not exists lifecycle_phase text;

comment on column standards_register.lifecycle_phase is
  'Terotechnology phase the standard governs. Lets the register report coverage '
  'across the whole asset life rather than only where the code happens to be.';

update standards_register set lifecycle_phase = case designation
  when 'IEC 61649' then 'operate_maintain'
  when 'IEC 61025' then 'design'
  when 'IEC 61078' then 'design'
  when 'IEC 60812' then 'design'
  when 'IEC 61508' then 'design'
  when 'IEC 61511' then 'design'
  when 'IEC 62740' then 'operate_maintain'
  when 'ISO 14224' then 'operate_maintain'
  when 'ISO 55001' then 'govern'
  when 'ISO 31000' then 'govern'
  when 'ISO 13374' then 'operate_maintain'
  when 'ISO 17359' then 'operate_maintain'
  when 'ISO 15143-3' then 'operate_maintain'
  when 'SAE JA1011' then 'operate_maintain'
  when 'SAE JA1012' then 'operate_maintain'
  when 'MIL-HDBK-338B' then 'design'
  when 'MIL-STD-1629A' then 'design'
  when 'MIL-HDBK-217F' then 'design'
  when 'API 580' then 'operate_maintain'
  when 'API 581' then 'operate_maintain'
  when 'EEMUA 191' then 'operate_maintain'
  when 'NORSOK Z-008' then 'operate_maintain'
  else lifecycle_phase end
where lifecycle_phase is null;

insert into standards_register
  (designation, title, publisher, current_edition, edition_year, scope, access,
   review_interval_months, review_rationale, lifecycle_phase, superseded_by, notes)
values
  -- ---- The origin, and its withdrawal -------------------------------------
  ('BS 3843','Guide to terotechnology (the economic management of assets)','BSI',
   'Parts 1-3',1992,
   'The founding definition: combining management, financial and engineering practice to pursue economic asset life-cycle cost.',
   'restricted',12,'Withdrawn; retained so citations of it are recognised as citations of a dead document.',
   'govern','Withdrawn Nov 2011; role passed to ISO 55000 and EN 16646',
   'WITHDRAWN November 2011. The literature still cites it constantly. Retained in the register precisely so that a citation can be flagged rather than accepted.'),
  ('BS 3811','Glossary of maintenance management terms','BSI',null,1993,
   'The British maintenance vocabulary that preceded EN 13306.','restricted',12,
   'Superseded by EN 13306.','govern','EN 13306',null),

  -- ---- Govern / asset management ------------------------------------------
  ('ISO 55000','Asset management — overview, principles and terminology','ISO',null,null,
   'The vocabulary and principles that replaced terotechnology as the organising frame.',
   'paywalled',6,'Edition not verified.','govern',null,
   'The modern successor to BS 3843. Holding this is what makes an asset-management claim defensible.'),
  ('ISO 55002','Asset management — guidelines for the application of ISO 55001','ISO',null,null,
   'How to implement the management system.','paywalled',6,'Edition not verified.','govern',null,null),
  ('ISO 55010','Guidance on the alignment of financial and non-financial functions in asset management','ISO',
   null,null,'Connecting engineering decisions to the financial ledger — the core terotechnology problem.',
   'paywalled',12,'Edition not verified.','govern',null,
   'Directly relevant to the value-management and business-case modules.'),
  ('EN 16646','Maintenance within physical asset management','CEN',null,2014,
   'How maintenance sits inside an asset management system; the European successor to the terotechnology framing.',
   'paywalled',6,'2014 edition confirmed.','govern',null,
   'Along with ISO 55000, this is where BS 3843''s role went.'),

  -- ---- Specify and design -------------------------------------------------
  ('IEC 60300-1','Dependability management — managing dependability','IEC',null,null,
   'The dependability management system: planning, requirements and assurance across the life cycle.',
   'paywalled',6,'Edition not verified.','specify',null,
   'Parent of the 60300-3-x application guides.'),
  ('IEC 60300-3-3','Dependability management — application guide — life cycle costing','IEC','Ed 3.0',2017,
   'Life cycle cost analysis: cost breakdown structures, discounting, and comparing options over whole life.',
   'paywalled',6,'Third edition 2017 confirmed.','specify',null,
   'THE life-cycle-costing authority, and the most directly terotechnological standard in this list. Governs the value-management and repair/replace modules.'),
  ('IEC 60300-3-4','Dependability management — guide to the specification of dependability requirements','IEC',
   null,null,'Writing reliability, availability and maintainability requirements into a specification.',
   'paywalled',6,'Edition not verified.','specify',null,
   'Governs the reliability-by-design module: RAM allocation starts here.'),
  ('IEC 60300-3-10','Dependability management — application guide — maintainability','IEC',null,null,
   'Designing so the thing can be maintained: access, diagnosis, repair time.','paywalled',6,
   'Edition not verified.','design',null,null),
  ('IEC 60300-3-11','Dependability management — application guide — reliability centred maintenance','IEC',
   null,2009,'RCM as a dependability application.','paywalled',6,
   'BS EN edition 2009 seen.','design',null,'Complements SAE JA1011.'),
  ('IEC 60300-3-14','Dependability management — application guide — maintenance and maintenance support','IEC',
   null,null,'Maintenance support: spares, tools, documentation, people.','paywalled',6,
   'Edition not verified.','operate_maintain',null,null),
  ('IEC 60706','Maintainability of equipment','IEC',null,null,
   'Maintainability requirements, prediction, verification and data collection.','paywalled',12,
   'Edition not verified.','design',null,null),
  ('IEC 61703','Mathematical expressions for reliability, availability, maintainability and maintenance support terms',
   'IEC',null,null,'The definitions behind MTBF, MTTR, availability — what each actually means.',
   'paywalled',12,'Edition not verified.','design',null,
   'Governs how the platform''s availability and MTBF figures should be defined.'),
  ('IEC 61164','Reliability growth — statistical test and estimation methods','IEC',null,null,
   'Crow-AMSAA and reliability growth estimation.','paywalled',12,'Edition not verified.','design',null,
   'Governs the Crow-AMSAA implementation already in src/lib/reliability.'),
  ('IEC 62308','Equipment reliability — reliability assessment methods','IEC',null,null,
   'Early-life reliability assessment before field data exists.','paywalled',12,
   'Edition not verified.','design',null,null),

  -- ---- Procure and commission ---------------------------------------------
  ('ISO 15686-5','Buildings and constructed assets — service life planning — life-cycle costing','ISO',
   null,null,'Life cycle costing for built assets.','paywalled',12,'Edition not verified.','specify',null,
   'The built-asset counterpart to IEC 60300-3-3.'),

  -- ---- Operate and maintain -----------------------------------------------
  ('EN 13306','Maintenance — maintenance terminology','CEN',null,2017,
   'The European maintenance vocabulary: what corrective, preventive, predictive and condition-based actually mean.',
   'paywalled',6,'2017 edition confirmed.','operate_maintain',null,
   'Successor to BS 3811. The platform''s work_type vocabulary should be checked against it.'),
  ('EN 15341','Maintenance — maintenance key performance indicators','CEN',null,null,
   'The standard maintenance KPI set and how each is defined.','paywalled',6,
   '2007 edition seen; a later revision is likely and unverified.','operate_maintain',null,
   'Directly governs the C6 KPI family. The platform computes maintenance KPIs today without checking their definitions against this.'),
  ('EN 17007','Maintenance process and associated indicators','CEN',null,null,
   'Maintenance process model and the indicators that measure it.','paywalled',12,
   'Edition not verified.','operate_maintain',null,null),
  ('ISO 13372','Condition monitoring and diagnostics of machines — vocabulary','ISO',null,null,
   'Condition monitoring vocabulary.','paywalled',12,'Edition not verified.','operate_maintain',null,null),
  ('ISO 13379','Condition monitoring and diagnostics of machines — data interpretation and diagnostics techniques',
   'ISO',null,null,'How to interpret condition data.','paywalled',12,'Edition not verified.',
   'operate_maintain',null,null),
  ('ISO 13381','Condition monitoring and diagnostics of machines — prognostics','ISO',null,null,
   'Remaining useful life estimation.','paywalled',12,'Edition not verified.','operate_maintain',null,
   'Governs any RUL claim the platform makes.'),
  ('ISO 18436','Condition monitoring and diagnostics of machines — requirements for qualification of personnel',
   'ISO',null,null,'Who is competent to interpret condition data.','paywalled',12,
   'Edition not verified.','operate_maintain',null,
   'Relevant to the human-factors and competency modules.'),

  -- ---- Modify, obsolesce, dispose -----------------------------------------
  ('IEC 62402','Obsolescence management','IEC',null,null,
   'Managing components and systems that cease to be supportable.','paywalled',6,
   'Edition not verified.','dispose',null,
   'The end-of-life phase the register otherwise covers not at all.'),
  ('ISO 14040','Environmental management — life cycle assessment — principles and framework','ISO',null,null,
   'Environmental life cycle assessment.','paywalled',12,'Edition not verified.','dispose',null,
   'Complements the environmental module, which currently computes emissions without reference to it.'),
  ('ISO 14044','Environmental management — life cycle assessment — requirements and guidelines','ISO',
   null,null,'LCA requirements.','paywalled',12,'Edition not verified.','dispose',null,null)
on conflict (designation) do update set
  lifecycle_phase = excluded.lifecycle_phase,
  superseded_by = excluded.superseded_by,
  notes = excluded.notes;

insert into standards_capability_map
  (designation, capability_ref, capability_label, dependency, note)
values
  ('IEC 60300-3-3','E9','Value management and life-cycle cost','normative',
   'The platform computes NPV, equivalent annual cost and repair/replace decisions. This is the standard that defines how.'),
  ('IEC 60300-3-4','U3','Reliability by design — RAM allocation','normative',null),
  ('IEC 61164','C7.04','Crow-AMSAA and reliability growth','normative',
   'Already implemented; the standard would make it citable.'),
  ('IEC 61703','C7.03','Availability and repairable-system modelling','normative',
   'Defines what MTBF and availability mean. The platform reports both.'),
  ('EN 15341','C6','Maintenance KPI family','normative',
   'The platform computes maintenance KPIs without checking the definitions against the standard set.'),
  ('EN 13306','C6','Maintenance terminology and work-type vocabulary','normative',
   'The work_type values (corrective, preventive) should be checked against this.'),
  ('EN 16646','U4','Maintenance within asset management','normative',null),
  ('ISO 55000','U4','Asset lifecycle governance','normative',
   'Successor to the withdrawn BS 3843.'),
  ('ISO 13381','C7.14','Condition-based failure prediction and RUL','normative',
   'Any remaining-useful-life claim falls under this.'),
  ('IEC 62402','U4','Obsolescence and end-of-life','normative',
   'The lifecycle module has end-of-life stages; this governs them.'),
  ('ISO 14040','E10','Environmental life cycle assessment','informative',null)
on conflict (designation, capability_ref) do update set note = excluded.note;

-- Coverage across the terotechnology life, so a gap in a whole PHASE is visible
-- rather than only a gap in one standard.
drop function if exists get_terotechnology_coverage();
create or replace function get_terotechnology_coverage()
returns table (
  phase text,
  standards int,
  held int,
  "normativeDependencies" int,
  "withdrawnOrSuperseded" int,
  finding text
)
language sql stable security definer set search_path = public as $$
  -- Dependency counts are pre-aggregated per standard rather than fetched in a
  -- correlated subquery: the outer query groups by phase, so a subquery
  -- referencing the ungrouped phase column is not resolvable.
  with deps as (
    select m.designation, count(*) filter (where m.dependency = 'normative') n
    from standards_capability_map m group by m.designation
  )
  select coalesce(r.lifecycle_phase,'unassigned'),
         count(*)::int,
         count(*) filter (where h.holding_status in ('licensed','in_corpus'))::int,
         coalesce(sum(d.n), 0)::int,
         count(*) filter (where r.superseded_by is not null)::int,
         format('%s standard(s), %s held, %s normative dependency(ies). %s',
           count(*),
           count(*) filter (where h.holding_status in ('licensed','in_corpus')),
           coalesce(sum(d.n), 0),
           case
             when count(*) filter (where r.superseded_by is not null) > 0
               then 'Contains a withdrawn or superseded standard — a citation of it is a citation of a dead document.'
             when count(*) filter (where h.holding_status in ('licensed','in_corpus')) = 0
                  and coalesce(sum(d.n),0) > 0
               then 'None held, and capabilities depend on this phase normatively: they rest on practice rather than on a citable authority.'
             when count(*) filter (where h.holding_status in ('licensed','in_corpus')) = 0
               then 'None held. No capability depends on this phase yet, so it is a gap in scope rather than in defensibility.'
             else 'Partially covered.'
           end)
  from standards_register r
  left join standards_holdings h
    on h.designation = r.designation and h.organization_id = app_current_org()
  left join deps d on d.designation = r.designation
  group by coalesce(r.lifecycle_phase,'unassigned')
  order by 5 desc, 4 desc, 1;
$$;

grant execute on function get_terotechnology_coverage() to authenticated;

notify pgrst, 'reload schema';
