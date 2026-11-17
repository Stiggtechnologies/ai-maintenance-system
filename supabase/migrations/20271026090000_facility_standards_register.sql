-- ============================================================================
-- Facility and residential-housing standards in the standards register.
--
-- Metadata only, exactly as 20260831090000 and 20260831140000: which standard
-- governs which capability, its access class, and the review cadence. No
-- standard text, clause, interval or limit is stored here. Organizations
-- record whether they hold a copy in standards_holdings (default not_held),
-- and "this capability cites a standard we do not hold" stays a reportable
-- gap rather than silent confidence.
--
-- Already registered and left unchanged: ISO 55000/55001/55002, ISO 14224,
-- ISO 15686-5, EN 13306, EN 15341.
--
-- Editions are left null unless verified. The 2023 Alberta Editions of the
-- National Building and Fire Codes are published free of charge by NRC;
-- access is recorded as public_domain for those (free to obtain), which is
-- what makes them knowledge-base candidates.
-- ============================================================================

insert into standards_register
  (designation, title, publisher, current_edition, edition_year, scope, access,
   review_interval_months, review_rationale, lifecycle_phase, notes)
values
  ('ISO 41001','Facility management — management systems — requirements','ISO',null,null,
   'Requirements for a facility management system: services, roles, performance and improvement.',
   'paywalled',12,'Edition not verified.','govern',
   'Frame for housing and building operations alongside ISO 55001.'),
  ('ISO 15686-1','Buildings and constructed assets — service life planning — general principles and framework','ISO',null,null,
   'Service-life planning for buildings and their components; the basis for renewal forecasts.',
   'paywalled',12,'Edition not verified.','specify',
   'Governs renewal forecasting from install year and an approved reference service life. Complements ISO 15686-5 (already registered).'),
  ('ISO 19650-1','Organization and digitization of information about buildings and civil engineering works — information management using BIM','ISO',null,null,
   'Concepts and principles for managing building information through the asset life.',
   'paywalled',12,'Edition not verified.','specify',
   'Frame for equipment-register handover; COBie is the practical exchange format.'),
  ('COBie','Construction Operations Building information exchange','buildingSMART / NIBS',null,null,
   'Spreadsheet exchange of spaces, types, components and attributes for building handover.',
   'restricted',12,'Edition and licence to be verified before ingestion.','specify',
   'Target format for walk-down export and handover import.'),
  ('ASTM E1557','Classification for building elements and related sitework — UNIFORMAT II','ASTM',null,null,
   'Elemental classification of building systems.','paywalled',12,'Edition not verified.','specify',
   'Candidate classification code on residential and apartment-building reference model systems.'),
  ('OmniClass','OmniClass Construction Classification System','CSI',null,null,
   'Classification tables for the built environment.','restricted',12,'Licence terms to be verified.','specify',
   'Alternative to UNIFORMAT II for classification.'),
  ('ASTM E2018','Standard guide for property condition assessments — baseline property condition assessment process','ASTM',null,null,
   'Scope and process for assessing the physical condition of commercial real estate, typically at acquisition.',
   'paywalled',12,'Edition not verified.','operate_maintain',
   'Basis for a condition-assessment Decision Case template for acquired buildings.'),
  ('ASHRAE 180','Standard practice for inspection and maintenance of commercial building HVAC systems','ASHRAE',null,null,
   'Minimum inspection and maintenance tasks for building HVAC.','paywalled',12,'Edition not verified.','operate_maintain',
   'Basis for an HVAC inspection task library; task frequencies enter only from a held copy.'),
  ('NBC(AE)','National Building Code — Alberta Edition','NRC / Government of Alberta','2023',2023,
   'Building requirements adopted in Alberta.','public_domain',6,
   'Adopted code; amendments and new editions matter directly.','specify',
   'Published by NRC free of charge. Requirement categories cited by the residential models.'),
  ('NFC(AE)','National Fire Code — Alberta Edition','NRC / Government of Alberta','2023',2023,
   'Fire safety requirements in Alberta, including inspection and maintenance of fire protection systems.',
   'public_domain',6,'Adopted code; amendments and new editions matter directly.','operate_maintain',
   'Published by NRC free of charge. Source for life-safety inspection obligations.'),
  ('NPC','National Plumbing Code of Canada','NRC',null,null,
   'Plumbing requirements; adopted in Alberta.','public_domain',12,'Edition adopted in Alberta to be verified.','specify',
   'Requirement categories cited by the domestic plumbing model.'),
  ('CSA B149.1','Natural gas and propane installation code','CSA Group',null,null,
   'Installation of gas appliances and venting.','paywalled',12,'Edition not verified.','operate_maintain',
   'Cited by the furnace and water-heater models.'),
  ('CSA C22.1','Canadian Electrical Code, Part I','CSA Group',null,null,
   'Safety standard for electrical installations.','paywalled',12,'Edition adopted in Alberta to be verified.','operate_maintain',
   'Cited by the residential electrical service model.'),
  ('CSA Z463','Maintenance of electrical systems','CSA Group',null,null,
   'Maintenance programs for electrical distribution equipment.','paywalled',12,'Edition not verified.','operate_maintain',
   'Candidate basis for switchboard and panel inspection tasks.'),
  ('CAN/ULC-S531','Smoke alarms','ULC Standards',null,null,
   'Product standard for smoke alarms.','paywalled',12,'Edition not verified.','operate_maintain',
   'Cited by the residential life-safety model.'),
  ('CAN/ULC-S553','Installation of smoke alarms','ULC Standards',null,null,
   'Where and how smoke alarms are installed.','paywalled',12,'Edition not verified.','operate_maintain',
   'Cited by the residential life-safety model.'),
  ('CAN/ULC-S536','Inspection and testing of fire alarm systems','ULC Standards',null,null,
   'Periodic inspection and testing of building fire alarm systems.','paywalled',12,'Edition not verified.','operate_maintain',
   'Source for apartment-building fire alarm inspection obligations once held.'),
  ('CSA 6.19','Residential carbon monoxide alarming devices','CSA Group',null,null,
   'Product standard for residential CO alarms.','paywalled',12,'Edition not verified.','operate_maintain',
   'Cited by the residential life-safety model.'),
  ('NFPA 10','Standard for portable fire extinguishers','NFPA',null,null,
   'Selection, installation, inspection and maintenance of portable extinguishers.','paywalled',12,'Edition not verified.','operate_maintain',
   'Source for extinguisher inspection obligations once held.'),
  ('AB-MHHS','Alberta Minimum Housing and Health Standards','Government of Alberta',null,null,
   'Minimum standards a rental dwelling must meet (heat, water, sanitation, safety); enforced by public health inspectors.',
   'public_domain',6,'Current version and instrument to be verified before ingestion.','operate_maintain',
   'Candidate per-unit compliance checklist for rental housing.')
on conflict (designation) do nothing;

insert into standards_capability_map
  (designation, capability_ref, capability_label, dependency, note)
values
  ('ISO 41001','src/lib/asset-twins/residential-dwelling-reference-model.ts','Residential and apartment facility operations','informative',null),
  ('ISO 15686-1','src/lib/asset-twins/equipment-register.ts','Install year and renewal forecasting','normative','Renewal forecasting not built yet.'),
  ('COBie','src/lib/asset-twins/equipment-register.ts','Equipment-register walk-down and handover','informative','COBie export not built yet.'),
  ('ASTM E2018','src/lib/asset-twins/apartment-building-reference-model.ts','Condition assessment of acquired buildings','informative','Template not built yet.'),
  ('ASHRAE 180','src/lib/asset-twins/residential-facility.ts','HVAC inspection tasks','normative','Task library not built yet.'),
  ('NBC(AE)','src/lib/asset-twins/residential-facility.ts','Residential building requirement categories','normative',null),
  ('NFC(AE)','src/lib/asset-twins/apartment-building-reference-model.ts','Life-safety inspection obligations','normative',null),
  ('NPC','src/lib/asset-twins/residential-facility.ts','Domestic plumbing requirement categories','normative',null),
  ('CSA B149.1','src/lib/asset-twins/residential-facility.ts','Gas furnace and water heater installation','normative',null),
  ('CSA C22.1','src/lib/asset-twins/residential-facility.ts','Residential electrical service','normative',null),
  ('CAN/ULC-S531','src/lib/asset-twins/residential-facility.ts','Smoke alarms','normative',null),
  ('CAN/ULC-S553','src/lib/asset-twins/residential-facility.ts','Smoke alarm installation','normative',null),
  ('CAN/ULC-S536','src/lib/asset-twins/apartment-building-reference-model.ts','Building fire alarm inspection','normative',null),
  ('CSA 6.19','src/lib/asset-twins/residential-facility.ts','Residential CO alarms','normative',null),
  ('NFPA 10','src/lib/asset-twins/residential-facility.ts','Portable extinguishers','normative',null),
  ('AB-MHHS','src/lib/asset-twins/residential-dwelling-reference-model.ts','Rental unit minimum standards','normative','Checklist not built yet.')
on conflict (designation, capability_ref) do nothing;
