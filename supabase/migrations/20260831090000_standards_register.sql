-- ============================================================================
-- Standards register and continuous watch
-- (register U19 AI governance, E12 data governance, C7 method provenance).
--
-- WHAT THIS CAN AND CANNOT HOLD.
--
-- IEC, ISO, SAE and API standards are copyrighted and sold. This platform
-- cannot obtain or store their text, and neither can anybody without a licence.
-- So the register holds METADATA — which authority governs which capability,
-- what edition is current, whether this organization holds a copy — and the
-- knowledge base holds text only for the public-domain ones.
--
-- That distinction is the point rather than a limitation. Today the platform
-- selects a Weibull estimator by a rule, and the authority for that rule is
-- IEC 61649, which is not in the corpus. Without a register that fact is
-- invisible: the code looks equally confident either way. With one, "this
-- capability cites a standard we do not hold" is a reportable governance gap.
--
-- WHY A WATCH, AND AT WHAT INTERVAL.
--
-- Standards move. SAE JA1011 went from the 2009 edition to JA1011_202411;
-- IEC 60812:2018 cancelled and replaced the 2006 edition. A platform that
-- encoded the old edition's rule and never looked again is wrong and does not
-- know it.
--
-- Full revisions run on roughly five- to ten-year cycles, so a five-year
-- reminder would be useless — amendments, corrigenda and withdrawals arrive far
-- sooner. Quarterly is the default here: frequent enough to catch an amendment
-- inside one planning cycle, rare enough that nobody starts ignoring it. The
-- cadence is per-standard because a stable standard and one under active
-- revision do not deserve the same attention.
--
-- Canonical reuse: kb_document_classes (a held standard is an
-- `engineering_standard` in the corpus), app_current_org(). Additive.
-- ============================================================================

create table if not exists standards_register (
  id bigserial primary key,
  designation text not null unique,
  title text not null,
  publisher text not null,
  current_edition text,
  edition_year int,
  /** What it governs, in one line, so relevance is judgeable without opening it. */
  scope text not null,
  /** Copyright reality, which decides whether the text can ever be ingested. */
  access text not null check (access in ('paywalled','public_domain','restricted')),
  /** How often to re-check for a new edition, amendment or withdrawal. */
  review_interval_months int not null default 3
    check (review_interval_months between 1 and 24),
  review_rationale text,
  superseded_by text,
  notes text,
  created_at timestamptz not null default now()
);

alter table standards_register enable row level security;
drop policy if exists sreg_read on standards_register;
-- World facts about published standards, not tenant data.
create policy sreg_read on standards_register for select to authenticated using (true);

-- Whether THIS organization holds a copy, and when it last checked for changes.
create table if not exists standards_holdings (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  designation text not null references standards_register(designation),
  holding_status text not null default 'not_held'
    check (holding_status in ('not_held','licensed','in_corpus','superseded_copy')),
  edition_held text,
  last_reviewed_on date,
  reviewed_by uuid references auth.users(id),
  note text,
  unique(organization_id, designation)
);

alter table standards_holdings enable row level security;
drop policy if exists shold_read on standards_holdings;
create policy shold_read on standards_holdings
  for select to authenticated using (organization_id = app_current_org());

-- Which built capability rests on which authority. This is what turns the
-- register from a reading list into a governance control.
create table if not exists standards_capability_map (
  id bigserial primary key,
  designation text not null references standards_register(designation),
  /** Register item or module the capability lives in. */
  capability_ref text not null,
  capability_label text not null,
  /** Whether the capability could be defended without holding the standard. */
  dependency text not null check (dependency in ('normative','informative')),
  note text,
  unique(designation, capability_ref)
);

alter table standards_capability_map enable row level security;
drop policy if exists scap_read on standards_capability_map;
create policy scap_read on standards_capability_map for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- The authorities. Editions verified 2026-08-10 where a source was found;
-- anything unverified says so rather than carrying a confident guess.
-- ---------------------------------------------------------------------------
insert into standards_register
  (designation, title, publisher, current_edition, edition_year, scope, access,
   review_interval_months, review_rationale, notes)
values
  ('IEC 61649','Weibull analysis','IEC','Ed 2.0',2008,
   'Methods for analysing life data from a Weibull distribution, analytical and graphical.',
   'paywalled',6,
   'Stable since 2008. Six-monthly is enough to catch an amendment without pretending a 2008 document changes often.',
   'THE authority for the estimator-selection rule in src/lib/reliability/method-selection.ts. Not held — that rule currently rests on established practice rather than on a document this platform can cite.'),
  ('IEC 61025','Fault tree analysis (FTA)','IEC','Ed 2.0',2006,
   'Principles, symbols and procedure for fault tree analysis, qualitative and quantitative.',
   'paywalled',6,'Stable since 2006.',
   'Governs src/lib/modelling/fault-tree.ts — gates, minimal cut sets, symbols.'),
  ('IEC 61078','Reliability block diagrams','IEC',null,null,
   'RBD method for system reliability from block reliabilities.','paywalled',6,
   'Edition not verified.','Governs src/lib/modelling/rbd.ts.'),
  ('IEC 60812','Failure modes and effects analysis (FMEA and FMECA)','IEC','Ed 3.0',2018,
   'How FMEA and FMECA are planned, performed, documented and maintained.','paywalled',6,
   'Third edition 2018 cancelled and replaced the 2006 second edition — a live example of why this register exists.',
   'Ed 3.0 (2018) supersedes Ed 2.0 (2006).'),
  ('IEC 61508','Functional safety of E/E/PE safety-related systems','IEC',null,null,
   'SIL determination, PFD targets and the safety lifecycle.','paywalled',3,
   'Actively referenced in regulation; quarterly.',
   'Already used by the process-safety module: PFD_avg and the SIL bands.'),
  ('IEC 61511','Functional safety — safety instrumented systems for the process industry','IEC',null,null,
   'Process-sector application of IEC 61508.','paywalled',3,'Actively referenced in regulation.',null),
  ('IEC 62740','Root cause analysis (RCA)','IEC',null,null,
   'RCA techniques and how to select between them.','paywalled',6,'Edition not verified.',null),
  ('ISO 14224','Collection and exchange of reliability and maintenance data for equipment','ISO',null,2016,
   'Equipment taxonomy, failure data and maintenance data in an exchangeable format.','paywalled',6,
   '2016 edition current.',
   'The taxonomy the operator functional locations (7310-POWRTRN-FNLDRV) already resemble. Governs the component hierarchy work.'),
  ('ISO 55001','Asset management — management systems — requirements','ISO',null,null,
   'Requirements for an asset management system.','paywalled',6,'Edition not verified.',null),
  ('ISO 31000','Risk management — guidelines','ISO',null,null,
   'Principles and process for managing risk.','paywalled',12,'Guideline, revises slowly.',null),
  ('ISO 13374','Condition monitoring and diagnostics — data processing and presentation','ISO',null,null,
   'Reference architecture for condition monitoring data.','paywalled',12,'Edition not verified.',null),
  ('ISO 17359','Condition monitoring and diagnostics of machines — general guidelines','ISO',null,null,
   'Setting up and running a condition monitoring programme.','paywalled',12,'Edition not verified.',null),
  ('ISO 15143-3','Earth-moving machinery — worksite data exchange — telematics data','ISO',null,null,
   'The AEMP 2.0 mixed-fleet telematics API: hours, location, fuel, machine status.','paywalled',6,
   'Directly on the OEM integration roadmap.',
   'Supported by Cat, Komatsu, Hitachi, Deere and Volvo — the reason telematics is one integration and not three.'),
  ('SAE JA1011','Evaluation criteria for reliability-centered maintenance (RCM) processes','SAE',
   'JA1011_202411',2024,
   'The seven questions any process must answer to be called RCM.','paywalled',6,
   'Recently revised — the 2009 edition was current until November 2024.',
   'SUPERSESSION: JA1011_202411 replaces JA1011-2009. Anything built against the 2009 edition needs re-checking.'),
  ('SAE JA1012','A guide to the reliability-centered maintenance standard','SAE',null,null,
   'Amplification of JA1011.','paywalled',6,'Tracks JA1011.',null),
  ('MIL-HDBK-338B','Electronic reliability design handbook','US DoD',null,1998,
   'Reliability engineering methods, models and design practice.','public_domain',12,
   'Public domain and stable; annual is sufficient.',
   'HELD — 402 chunks in the corpus.'),
  ('MIL-STD-1629A','Procedures for performing a failure mode, effects and criticality analysis','US DoD',null,1980,
   'The original FMECA procedure.','public_domain',12,'Cancelled but still widely cited.',
   'Formally cancelled by the DoD; retained because much industry practice still references it.'),
  ('MIL-HDBK-217F','Reliability prediction of electronic equipment','US DoD','Notice 2',1995,
   'Parts-count and parts-stress reliability prediction.','public_domain',12,
   'Widely criticised for modern electronics; retained for traceability.',null),
  ('API 580','Risk-based inspection','API',null,null,
   'RBI methodology for fixed equipment.','paywalled',6,'Edition not verified.',null),
  ('API 581','Risk-based inspection methodology','API',null,null,
   'Quantitative RBI calculations.','paywalled',6,'Edition not verified.',null),
  ('EEMUA 191','Alarm systems — a guide to design, management and procurement','EEMUA',null,null,
   'Alarm rate benchmarks and management practice.','paywalled',12,'Edition not verified.',
   'Already used by the alarm-performance module for the rate benchmarks.'),
  ('NORSOK Z-008','Risk based maintenance and consequence classification','Standards Norway',null,null,
   'Criticality classification for maintenance programmes.','public_domain',12,
   'NORSOK standards are freely available.','Freely published — a genuine ingestion candidate.')
on conflict (designation) do update set
  current_edition = excluded.current_edition,
  edition_year = excluded.edition_year,
  notes = excluded.notes;

-- Which capability rests on what.
insert into standards_capability_map
  (designation, capability_ref, capability_label, dependency, note)
values
  ('IEC 61649','src/lib/reliability/method-selection.ts','Weibull estimator selection','normative',
   'The four-clause rule is established practice; IEC 61649 is the authority that would make it citable.'),
  ('IEC 61649','C7.01','Weibull and censored life-data analysis','normative',null),
  ('IEC 61025','C7.10','Fault-tree and event-tree analysis','normative',null),
  ('IEC 61078','C7.02','Reliability block diagrams','normative',null),
  ('IEC 60812','C7.09','FMEA/FMECA and RCM decision logic','normative',null),
  ('SAE JA1011','C7.09','FMEA/FMECA and RCM decision logic','normative',
   'Recently superseded — anything built against JA1011-2009 needs re-checking.'),
  ('IEC 61508','E2','Process safety: SIL bands and PFD_avg','normative',
   'Already implemented against it; holding the text matters for defensibility.'),
  ('ISO 14224','U3','Asset ontology and component hierarchy','normative',
   'The operator functional locations already resemble this taxonomy.'),
  ('ISO 15143-3','OEM roadmap P1','Mixed-fleet telematics ingestion','normative',null),
  ('EEMUA 191','C6','Alarm performance benchmarks','informative',null),
  ('MIL-HDBK-338B','C7','Reliability methods','informative','Held in the corpus.')
on conflict (designation, capability_ref) do update set note = excluded.note;

-- ---------------------------------------------------------------------------
-- The watch. Returns what is due, what is missing, and what is superseded.
-- ---------------------------------------------------------------------------
drop function if exists get_standards_watch();
create or replace function get_standards_watch()
returns table (
  designation text,
  title text,
  publisher text,
  "currentEdition" text,
  access text,
  "holdingStatus" text,
  "lastReviewedOn" date,
  "reviewDue" boolean,
  "monthsSinceReview" int,
  "normativeCapabilities" int,
  finding text
)
language sql stable security definer set search_path = public as $$
  select r.designation, r.title, r.publisher, r.current_edition, r.access,
         coalesce(h.holding_status, 'not_held'),
         h.last_reviewed_on,
         h.last_reviewed_on is null
           or h.last_reviewed_on < current_date - (r.review_interval_months || ' months')::interval,
         case when h.last_reviewed_on is null then null
              else (extract(year from age(current_date, h.last_reviewed_on)) * 12
                    + extract(month from age(current_date, h.last_reviewed_on)))::int end,
         (select count(*)::int from standards_capability_map m
          where m.designation = r.designation and m.dependency = 'normative'),
         case
           when r.superseded_by is not null then
             format('SUPERSEDED by %s. Anything built against this edition needs re-checking.', r.superseded_by)
           when coalesce(h.holding_status,'not_held') = 'not_held'
                and exists (select 1 from standards_capability_map m
                            where m.designation = r.designation and m.dependency = 'normative') then
             format('NOT HELD, and %s capability(ies) depend on it normatively. Those rest on '
                    || 'established practice rather than on a document that can be cited in a review.',
                    (select count(*) from standards_capability_map m
                     where m.designation = r.designation and m.dependency = 'normative'))
           when h.last_reviewed_on is null then
             'Never reviewed. A standard nobody has checked is a standard whose edition is unknown.'
           when h.last_reviewed_on < current_date - (r.review_interval_months || ' months')::interval then
             format('Review overdue — interval is %s month(s).', r.review_interval_months)
           else 'Current and reviewed within interval.'
         end
  from standards_register r
  left join standards_holdings h
    on h.designation = r.designation and h.organization_id = app_current_org()
  order by
    (r.superseded_by is not null) desc,
    (select count(*) from standards_capability_map m
     where m.designation = r.designation and m.dependency = 'normative') desc,
    r.designation;
$$;

grant execute on function get_standards_watch() to authenticated;

drop function if exists record_standards_review(text, text, text, text);
create or replace function record_standards_review(
  p_designation text,
  p_holding_status text,
  p_edition_held text default null,
  p_note text default null
)
returns table (outcome text, detail text)
language plpgsql security definer set search_path = public as $$
declare v_org uuid := app_current_org(); v_current text;
begin
  if v_org is null then
    return query select 'error'::text, 'No organization in session.'::text; return;
  end if;
  select current_edition into v_current from standards_register where designation = p_designation;
  if not found then
    return query select 'error'::text, format('%s is not in the standards register.', p_designation);
    return;
  end if;

  insert into standards_holdings
    (organization_id, designation, holding_status, edition_held, last_reviewed_on, reviewed_by, note)
  values (v_org, p_designation, p_holding_status, p_edition_held, current_date, auth.uid(), p_note)
  on conflict (organization_id, designation) do update set
    holding_status = excluded.holding_status,
    edition_held = excluded.edition_held,
    last_reviewed_on = current_date,
    reviewed_by = excluded.reviewed_by,
    note = excluded.note;

  return query select 'recorded'::text, format(
    'Review recorded for %s. Holding: %s%s.%s', p_designation, p_holding_status,
    case when p_edition_held is not null then format(', edition %s', p_edition_held) else '' end,
    case when p_edition_held is not null and v_current is not null and p_edition_held <> v_current
      then format(' NOTE: the register lists %s as current — the copy held is not the current edition.', v_current)
      else '' end);
end;
$$;

grant execute on function record_standards_review(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
