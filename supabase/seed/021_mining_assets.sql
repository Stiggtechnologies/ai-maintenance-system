-- Mining Asset Class Library (38 classes)

-- Mobile Mining (10)
INSERT INTO industry_asset_classes (id, library_id, class_code, class_name, description, default_criticality, typical_lifespan_years, recommended_pm_frequency_days, typical_sensors, sort_order) VALUES
('20000000-2000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010', 'TRUCK_HAUL', 'Haul Truck', 'Off-highway rigid or articulated haul truck', 'critical', 10, 21, ARRAY['engine_temp','tire_pressure','payload','fuel_rate','transmission_temp'], 1),
('20000000-2000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000010', 'EXCAVATOR_HYD', 'Hydraulic Excavator', 'Primary loading excavator', 'critical', 12, 21, ARRAY['hydraulic_pressure','engine_temp','boom_position'], 2),
('20000000-2000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000010', 'SHOVEL_ROPE', 'Rope Shovel', 'Electric rope shovel for high-volume loading', 'critical', 20, 21, ARRAY['motor_current','hoist_rope_tension','crowd_force'], 3),
('20000000-2000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000010', 'LOADER_WHEEL', 'Wheel Loader', 'Front-end loader for stockpile and rehandle', 'high', 10, 11, ARRAY['engine_temp','hydraulic_pressure','payload'], 4),
('20000000-2000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000010', 'DOZER_TRACK', 'Track Dozer', 'Bulldozer for material management', 'high', 10, 11, ARRAY['engine_temp','hydraulic_pressure','track_tension'], 5),
('20000000-2000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000010', 'GRADER', 'Motor Grader', 'Road maintenance grader', 'medium', 12, 11, ARRAY['engine_temp','blade_position'], 6),
('20000000-2000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000010', 'DRILL_BLAST', 'Blast Hole Drill', 'Rotary or DTH drill for blast patterns', 'high', 8, 11, ARRAY['rotation_speed','pulldown_force','air_pressure','penetration_rate'], 7),
('20000000-2000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', 'TRUCK_WATER', 'Water Truck', 'Dust suppression and road watering', 'medium', 10, 21, ARRAY['engine_temp','water_level'], 8),
('20000000-2000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000010', 'TRUCK_SERVICE', 'Service Truck', 'Mobile maintenance support', 'low', 8, 21, ARRAY['engine_temp'], 9),
('20000000-2000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000010', 'FLEET_SUPPORT', 'Support Vehicle', 'Light vehicles and personnel transport', 'low', 5, 365, ARRAY[], 10),
-- Crushing/Screening (6)
('20000000-2000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000010', 'CRUSHER_PRIMARY', 'Primary Crusher', 'Gyratory or jaw crusher for ROM ore', 'critical', 10, 30, ARRAY['vibration','motor_current','throughput','liner_wear'], 11),
('20000000-2000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000010', 'CRUSHER_SECONDARY', 'Secondary/Tertiary Crusher', 'Cone or impact crusher', 'high', 8, 30, ARRAY['vibration','motor_current','throughput'], 12),
('20000000-2000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000010', 'CONVEYOR', 'Conveyor', 'Overland or in-plant conveyor', 'high', 15, 90, ARRAY['belt_speed','alignment','motor_temp','belt_wear'], 13),
('20000000-2000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000010', 'SCREEN', 'Vibrating Screen', 'Classification or dewatering screen', 'high', 8, 60, ARRAY['vibration','amplitude','motor_current'], 14),
('20000000-2000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000010', 'FEEDER', 'Apron/Belt Feeder', 'Feed control to crusher or mill', 'high', 10, 90, ARRAY['speed','motor_current'], 15),
('20000000-2000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000010', 'STACKER', 'Stacker/Reclaimer', 'Stockpile management equipment', 'high', 15, 90, ARRAY['travel_position','slew_angle','belt_speed'], 16),
-- Milling/Processing (7)
('20000000-2000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000010', 'MILL_SAG', 'SAG Mill', 'Semi-autogenous grinding mill', 'critical', 20, 90, ARRAY['vibration','bearing_temp','power_draw','throughput','liner_wear'], 17),
('20000000-2000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000010', 'MILL_BALL', 'Ball Mill', 'Secondary grinding mill', 'critical', 15, 90, ARRAY['vibration','bearing_temp','power_draw','product_size'], 18),
('20000000-2000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000010', 'THICKENER', 'Thickener', 'Tailings or process thickener', 'medium', 25, 365, ARRAY['torque','rake_position','bed_level'], 19),
('20000000-2000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000010', 'FLOTATION', 'Flotation Cell', 'Froth flotation for mineral recovery', 'high', 12, 180, ARRAY['air_flow','froth_depth','pulp_level'], 20),
('20000000-2000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000010', 'PUMP_SLURRY', 'Slurry Pump', 'High-wear slurry transport', 'high', 3, 30, ARRAY['vibration','temperature','pressure','flow','wear_rate'], 21),
('20000000-2000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000010', 'DEWATERING', 'Dewatering System', 'Filter press or vacuum filter', 'medium', 10, 180, ARRAY['cake_moisture','vacuum_pressure','cycle_time'], 22),
('20000000-2000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000010', 'CYCLONE', 'Hydrocyclone', 'Classification cyclone', 'high', 5, 90, ARRAY['pressure_drop','flow','underflow_density'], 23),
-- Mechanical (5)
('20000000-2000-0000-0000-000000000024', '20000000-0000-0000-0000-000000000010', 'COMPRESSOR', 'Air/Gas Compressor', 'Plant air or process gas compression', 'medium', 15, 180, ARRAY['vibration','temperature','pressure','flow'], 24),
('20000000-2000-0000-0000-000000000025', '20000000-0000-0000-0000-000000000010', 'FAN', 'Ventilation/Process Fan', 'Mine ventilation or process fan', 'high', 15, 180, ARRAY['vibration','temperature','flow'], 25),
('20000000-2000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000010', 'GEARBOX', 'Industrial Gearbox', 'Speed reduction gearbox', 'high', 15, 180, ARRAY['vibration','oil_temperature','oil_quality'], 26),
('20000000-2000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000010', 'MOTOR_ELECTRIC', 'Electric Motor', 'HV and LV motors', 'high', 20, 365, ARRAY['vibration','temperature','current','insulation_resistance'], 27),
('20000000-2000-0000-0000-000000000028', '20000000-0000-0000-0000-000000000010', 'PUMP_PROCESS', 'Process/Water Pump', 'Centrifugal process pump', 'medium', 15, 90, ARRAY['vibration','temperature','pressure','flow'], 28),
-- Utilities (5)
('20000000-2000-0000-0000-000000000029', '20000000-0000-0000-0000-000000000010', 'TRANSFORMER', 'Power Transformer', 'Mine power distribution', 'critical', 35, 365, ARRAY['oil_temp','dissolved_gas','load','winding_temp'], 29),
('20000000-2000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000010', 'SUBSTATION', 'Electrical Substation', 'Power distribution substation', 'critical', 30, 365, ARRAY['bus_voltage','load','temperature'], 30),
('20000000-2000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000010', 'SWITCHGEAR', 'Switchgear', 'MV/LV switchgear and MCC', 'high', 25, 365, ARRAY['temperature','arc_flash_rating'], 31),
('20000000-2000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000010', 'GENERATOR', 'Diesel Generator', 'Backup or remote power', 'high', 15, 90, ARRAY['engine_temp','voltage','frequency','fuel_level'], 32),
('20000000-2000-0000-0000-000000000033', '20000000-0000-0000-0000-000000000010', 'WATER_TREATMENT', 'Water Treatment', 'Process and potable water treatment', 'medium', 20, 180, ARRAY['ph','turbidity','flow','chemical_dosing'], 33),
-- Instrumentation (5)
('20000000-2000-0000-0000-000000000034', '20000000-0000-0000-0000-000000000010', 'TRANSMITTER', 'Field Transmitter', 'P/T/F/L transmitter', 'medium', 10, 365, ARRAY['reading_accuracy','signal_quality'], 34),
('20000000-2000-0000-0000-000000000035', '20000000-0000-0000-0000-000000000010', 'FLOW_METER', 'Flow Meter', 'Process flow measurement', 'medium', 10, 365, ARRAY['flow_accuracy'], 35),
('20000000-2000-0000-0000-000000000036', '20000000-0000-0000-0000-000000000010', 'ANALYZER', 'Process Analyzer', 'Online grade or quality analyzer', 'high', 8, 90, ARRAY['reading_accuracy','sample_flow','reagent_level'], 36),
('20000000-2000-0000-0000-000000000037', '20000000-0000-0000-0000-000000000010', 'TEMP_INSTRUMENT', 'Temperature Instrument', 'RTD/thermocouple', 'low', 10, 365, ARRAY['reading_accuracy'], 37),
('20000000-2000-0000-0000-000000000038', '20000000-0000-0000-0000-000000000010', 'PLC_DCS', 'PLC/DCS Field Device', 'Distributed control system device', 'high', 15, 365, ARRAY['comm_status','io_status'], 38)
ON CONFLICT DO NOTHING;
