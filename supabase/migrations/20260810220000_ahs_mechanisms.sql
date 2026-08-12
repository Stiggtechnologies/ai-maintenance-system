-- ============================================================================
-- Cyber-physical failure mechanisms, and candidate shortlists for the
-- autonomous haulage subsystems (capability register C2.03, C2.05, C4.03).
--
-- Nine system groups had no candidate mechanisms after the vocabulary was
-- classified, and between them they carry 838 corrective work orders — more
-- than any single mechanical group. They are the autonomous haulage system:
-- the site runs Komatsu FrontRunner.
--
-- The reason the shortlist was empty is not an oversight in the mapping. The
-- 26 mechanisms shipped in slice 13 are mechanical and material: fatigue,
-- corrosion, wear, spalling. A radar head does not spall. Autonomous and
-- heavily instrumented equipment fails through a different family of
-- mechanisms, and until those exist there is nothing honest to map to.
--
-- So this adds the family rather than forcing the AHS subsystems into
-- mechanical language: 13 cyber-physical mechanisms (obscuration, GNSS
-- degradation, inertial bias drift, latency, thermal derating, firmware
-- fault, configuration drift and so on) and 6 detection techniques that
-- actually apply to them (built-in test, fault-log analysis, signal-quality
-- trending, heartbeat and latency monitoring, calibration verification, power
-- quality monitoring).
--
-- This family is not mining-specific. Any operator with autonomous equipment,
-- heavy instrumentation or networked control has exactly these mechanisms, so
-- it belongs in the universal layer beside the mechanical one.
--
-- SCOPE OF THE CLAIM. The candidate shortlists map to GENERIC autonomous
-- haulage functions — perception, positioning, communications, central
-- control, operator interface, emergency stop — not to Komatsu FrontRunner
-- proprietary internals, which are not public and which I have not verified.
-- Every row says so in its basis, and a FrontRunner support engineer should
-- confirm or replace them. They remain candidates; nothing is auto-coded.
--
-- Canonical reuse: damage_mechanisms, detection_techniques,
-- mechanism_detectability, system_group_candidates. Additive.
-- ============================================================================

insert into damage_mechanisms (organization_id, mechanism_key, name, description)
select o.id, v.k, v.n, v.d from organizations o cross join (values
  ('sensor_drift','Sensor calibration drift','Measured value diverges from truth without any hard fault being raised'),
  ('optical_obscuration','Optical or radar obscuration','Dust, mud, water, ice or damage on a lens, window or radome attenuating the return'),
  ('signal_interference','Radio interference','Competing emissions or reflections degrading a wireless link'),
  ('signal_path_loss','Signal path loss or coverage gap','Terrain, structures or distance putting a unit outside usable coverage'),
  ('gnss_degradation','GNSS accuracy degradation','Multipath, poor satellite geometry or atmospheric error inflating position uncertainty'),
  ('imu_bias_drift','Inertial sensor bias drift','Gyro or accelerometer bias accumulating heading and position error between fixes'),
  ('water_ingress','Water or dust ingress','Enclosure or connector seal breach admitting contamination to electronics'),
  ('thermal_derating','Thermal derating or shutdown','Electronics reducing output or stopping to protect themselves from heat'),
  ('power_quality','Power supply instability','Voltage sag, ripple or transient outside the equipment''s tolerance'),
  ('firmware_fault','Firmware or software fault','A defect in embedded logic, including a fault only exposed by a rare state'),
  ('configuration_drift','Configuration or parameter drift','Settings diverging from the approved baseline across a fleet'),
  ('data_latency','Data latency or message timeout','Messages arriving too late to be acted on, or not at all'),
  ('impact_damage','Impact damage to exposed hardware','Physical strike on externally mounted sensors, antennas or cabling')
) as v(k,n,d) where not exists (select 1 from damage_mechanisms m where m.organization_id=o.id and m.mechanism_key=v.k);

insert into detection_techniques (organization_id, technique_key, name, description)
select o.id, v.k, v.n, v.d from organizations o cross join (values
  ('bit_diagnostics','Built-in test and self-diagnostics','On-board self-test reporting subsystem status'),
  ('fault_code_analysis','Fault and event log analysis','Trending coded faults and events from the controller rather than reading them one at a time'),
  ('signal_quality_trending','Signal-quality trending','Signal-to-noise, return intensity, satellite count, packet loss and dropout rate trended over time'),
  ('heartbeat_latency','Heartbeat and latency monitoring','Message round-trip time and liveness between nodes'),
  ('calibration_verification','Calibration verification','Periodic check against a known reference'),
  ('power_quality_monitoring','Power quality monitoring','Supply voltage, ripple and transient capture')
) as v(k,n,d) where not exists (select 1 from detection_techniques t where t.organization_id=o.id and t.technique_key=v.k);

-- 31 detectability pairs for cyber-physical mechanisms
insert into mechanism_detectability (organization_id, mechanism_id, technique_id, detectability, typical_warning, basis)
select o.id, m.id, t.id, v.det, v.warn, 'General engineering mapping for cyber-physical and autonomous-system subsystems. The pairing is reference knowledge; intervals remain site-specific.' from organizations o
cross join (values
  ('sensor_drift','calibration_verification','primary','long'),
  ('sensor_drift','signal_quality_trending','primary','medium'),
  ('sensor_drift','bit_diagnostics','secondary','short'),
  ('optical_obscuration','signal_quality_trending','primary','medium'),
  ('optical_obscuration','visual','primary','medium'),
  ('optical_obscuration','bit_diagnostics','secondary','short'),
  ('signal_interference','signal_quality_trending','primary','medium'),
  ('signal_interference','fault_code_analysis','secondary','short'),
  ('signal_path_loss','signal_quality_trending','primary','long'),
  ('signal_path_loss','heartbeat_latency','primary','medium'),
  ('gnss_degradation','signal_quality_trending','primary','medium'),
  ('gnss_degradation','fault_code_analysis','secondary','short'),
  ('imu_bias_drift','calibration_verification','primary','long'),
  ('imu_bias_drift','signal_quality_trending','secondary','medium'),
  ('water_ingress','visual','primary','medium'),
  ('water_ingress','bit_diagnostics','secondary','short'),
  ('water_ingress','thermography','secondary','short'),
  ('thermal_derating','thermography','primary','medium'),
  ('thermal_derating','fault_code_analysis','primary','medium'),
  ('thermal_derating','process_trending','secondary','medium'),
  ('power_quality','power_quality_monitoring','primary','medium'),
  ('power_quality','fault_code_analysis','secondary','short'),
  ('firmware_fault','fault_code_analysis','primary','short'),
  ('firmware_fault','bit_diagnostics','secondary','short'),
  ('configuration_drift','calibration_verification','primary','long'),
  ('configuration_drift','fault_code_analysis','secondary','medium'),
  ('data_latency','heartbeat_latency','primary','medium'),
  ('data_latency','signal_quality_trending','secondary','medium'),
  ('impact_damage','visual','primary','none'),
  ('impact_damage','bit_diagnostics','primary','none'),
  ('impact_damage','signal_quality_trending','secondary','none')
) as v(mk,tk,det,warn)
join damage_mechanisms m on m.organization_id=o.id and m.mechanism_key=v.mk
join detection_techniques t on t.organization_id=o.id and t.technique_key=v.tk
where not exists (select 1 from mechanism_detectability d where d.mechanism_id=m.id and d.technique_id=t.id);

-- 41 candidate pairs across 9 FrontRunner subsystems
insert into system_group_candidates (organization_id, source_label, mechanism_id, basis)
select o.id, v.l, dm.id, 'Candidate only. Mapped to GENERIC autonomous-haulage subsystem functions — perception, positioning, communications, control, operator interface — not to Komatsu FrontRunner proprietary internals. A FrontRunner support engineer should confirm or replace this shortlist.' from organizations o cross join (values
  ('Ahs Ods Radar/Laser','optical_obscuration'),
  ('Ahs Ods Radar/Laser','impact_damage'),
  ('Ahs Ods Radar/Laser','sensor_drift'),
  ('Ahs Ods Radar/Laser','water_ingress'),
  ('Ahs Ods Radar/Laser','power_quality'),
  ('Ahs Ods Radar/Laser','firmware_fault'),
  ('Ahs Gps','gnss_degradation'),
  ('Ahs Gps','signal_interference'),
  ('Ahs Gps','impact_damage'),
  ('Ahs Gps','water_ingress'),
  ('Ahs Gps','configuration_drift'),
  ('Ahs Gyro System','imu_bias_drift'),
  ('Ahs Gyro System','sensor_drift'),
  ('Ahs Gyro System','power_quality'),
  ('Ahs Gyro System','impact_damage'),
  ('Ahs Communications','signal_path_loss'),
  ('Ahs Communications','signal_interference'),
  ('Ahs Communications','data_latency'),
  ('Ahs Communications','impact_damage'),
  ('Ahs Communications','water_ingress'),
  ('Ahs Central Control','firmware_fault'),
  ('Ahs Central Control','data_latency'),
  ('Ahs Central Control','configuration_drift'),
  ('Ahs Central Control','power_quality'),
  ('Ahs Observer Controller','firmware_fault'),
  ('Ahs Observer Controller','data_latency'),
  ('Ahs Observer Controller','configuration_drift'),
  ('Ahs Observer Controller','loose_connection'),
  ('Ahs User Interface','firmware_fault'),
  ('Ahs User Interface','configuration_drift'),
  ('Ahs User Interface','loose_connection'),
  ('Ahs User Interface','thermal_derating'),
  ('Ahs E-Stop Button','loose_connection'),
  ('Ahs E-Stop Button','water_ingress'),
  ('Ahs E-Stop Button','impact_damage'),
  ('Ahs E-Stop Button','localized_corrosion'),
  ('Ahs System Failure','firmware_fault'),
  ('Ahs System Failure','data_latency'),
  ('Ahs System Failure','configuration_drift'),
  ('Ahs System Failure','signal_path_loss'),
  ('Ahs System Failure','power_quality')
) as v(l,mk)
join damage_mechanisms dm on dm.organization_id=o.id and dm.mechanism_key=v.mk
where not exists (select 1 from system_group_candidates c where c.organization_id=o.id and c.source_label=v.l and c.mechanism_id=dm.id);

notify pgrst, 'reload schema';
