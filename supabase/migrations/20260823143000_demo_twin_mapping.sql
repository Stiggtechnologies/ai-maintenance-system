-- ============================================================================
-- Demo organization class-to-template mapping and twin provisioning.
--
-- The demo org exists to show the capability honestly, which means it must show
-- the refusals too. Four of its nine classes get no twin, for the same reason
-- the operator's wheel dozers get none: the library has no template for them
-- and borrowing a neighbouring one would attach the wrong failure modes.
--
-- The 22 autonomous haul trucks are the interesting case. MIN-HAUL-TRUCK
-- describes the machine correctly — frame, drivetrain, body, tyres, brakes —
-- and describes nothing about the autonomy stack that is the whole reason they
-- are a separate class here. So the fit is 'approximate' and says which half is
-- missing, rather than 'direct' and quietly claiming to model something it
-- does not.
--
-- Canonical reuse: asset_class_twin_map, asset_class_aliases,
-- provision_twin_instances from 20260823096000. Demo data only.
-- ============================================================================

insert into asset_class_aliases (organization_id, local_class, catalogue_class, source)
values
  ('11111111-1111-1111-1111-111111111111','Autonomous Haul Truck (AHS)','Haul Truck','Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Ultra-Class Haul Truck','Haul Truck','Demo fixture.')
on conflict (organization_id, local_class) do update
  set catalogue_class = excluded.catalogue_class, source = excluded.source;

insert into asset_class_twin_map
  (organization_id, local_class, template_key, fit, rationale, source)
values
  ('11111111-1111-1111-1111-111111111111','Ultra-Class Haul Truck','MIN-HAUL-TRUCK','direct',
   'The class the template was written for.','Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Autonomous Haul Truck (AHS)','MIN-HAUL-TRUCK','approximate',
   'The mechanical machine is the same, and MIN-HAUL-TRUCK models it. It models '
   || 'none of the autonomy stack — perception, positioning, the onboard controller, '
   || 'the traffic manager — which is the entire reason these are a separate class. '
   || 'Mechanical failure modes transfer; anything about autonomous availability '
   || 'is simply absent, not zero.',
   'Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Hydraulic Mining Shovel','MIN-HYD-SHOVEL','direct',
   'The class the template was written for.','Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Electric Rope Shovel','MIN-LOAD-ERS','direct',
   'The most developed template in the library.','Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Centrifugal Pump','ROT-CENT-PUMP','direct',
   'The class the template was written for.','Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Belt Conveyor — Overland','FP-CONVEYOR-BELT','direct',
   'Overland belt conveyor. The template covers belt, idlers, pulleys, drive, '
   || 'take-up and protection devices.','Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Shell & Tube Exchanger',null,'none',
   'No heat exchanger template exists. The rotating-equipment templates share no '
   || 'failure modes with a fixed exchanger.','Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Centrifugal Compressor',null,'none',
   'No compressor template exists. ROT-CENT-PUMP is the nearest structure and a '
   || 'compressor fails through surge, fouling and seal-gas behaviour that a pump '
   || 'template has nothing to say about.','Demo fixture.'),
  ('11111111-1111-1111-1111-111111111111','Reciprocating Compressor',null,'none',
   'No reciprocating machine template exists in the library at all.','Demo fixture.')
on conflict (organization_id, local_class) do update
  set template_key = excluded.template_key, fit = excluded.fit,
      rationale = excluded.rationale, source = excluded.source;

-- Provision. Inlined rather than calling provision_twin_instances(), which
-- resolves the organization from the session and there is no session here.
insert into asset_twin_instances (
  organization_id, asset_id, template_id, overlay_id, compiled_version,
  compiled_twin, customer_overrides, compilation_log, status
)
select a.organization_id, a.id, t.id, null, t.version || '+template-only',
       t.template, '{}'::jsonb,
       jsonb_build_array(jsonb_build_object(
         'compiled_at', now(),
         'template_version', t.version,
         'overlay_version', null,
         'fit', m.fit,
         'rationale', m.rationale,
         'basis', 'Class mapping only. No OEM model overlay is attached: the model '
                  || 'this machine actually is has not been established, and a '
                  || 'researched guess would look identical to a fact here.',
         'actor', null
       )),
       'draft'
from assets a
join asset_class_twin_map m
  on m.organization_id = a.organization_id and m.local_class = a.asset_class
join asset_twin_templates t on t.template_key = m.template_key
where a.organization_id = '11111111-1111-1111-1111-111111111111'
on conflict (asset_id, compiled_version) do nothing;

notify pgrst, 'reload schema';
