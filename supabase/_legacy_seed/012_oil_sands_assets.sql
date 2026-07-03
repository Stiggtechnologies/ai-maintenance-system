-- Oil Sands Asset Class Library (50 classes)

-- Mobile Mining/Extraction (10)
INSERT INTO industry_asset_classes (id, library_id, class_code, class_name, description, default_criticality, typical_lifespan_years, recommended_pm_frequency_days, typical_sensors, sort_order) VALUES
('10000000-2000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000010', 'TRUCK_ULTRA', 'Ultra-Class Haul Truck', '400-ton class haul trucks for mine-to-plant transport', 'critical', 12, 21, ARRAY['engine_temp','tire_pressure','payload','fuel_rate','transmission_temp'], 1),
('10000000-2000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000010', 'SHOVEL_HYD', 'Hydraulic Shovel', 'Large hydraulic excavator/shovel for primary loading', 'critical', 15, 21, ARRAY['hydraulic_pressure','swing_motor_temp','bucket_payload'], 2),
('10000000-2000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000010', 'SHOVEL_ROPE', 'Electric Rope Shovel', 'Electric rope shovel for primary ore loading', 'critical', 20, 21, ARRAY['motor_current','hoist_rope_tension','crowd_force'], 3),
('10000000-2000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000010', 'DOZER', 'Track Dozer', 'Track-type dozer for material management', 'high', 10, 11, ARRAY['engine_temp','hydraulic_pressure','track_tension'], 4),
('10000000-2000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000010', 'GRADER', 'Motor Grader', 'Motor grader for haul road maintenance', 'medium', 12, 11, ARRAY['engine_temp','blade_position'], 5),
('10000000-2000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000010', 'LOADER_WHEEL', 'Wheel Loader', 'Large wheel loader for stockpile and plant feed', 'high', 10, 11, ARRAY['engine_temp','hydraulic_pressure','payload'], 6),
('10000000-2000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000010', 'TRUCK_WATER', 'Water Truck', 'Water truck for dust suppression and road maintenance', 'medium', 10, 21, ARRAY['engine_temp','water_level'], 7),
('10000000-2000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000010', 'EXCAVATOR', 'Hydraulic Excavator', 'General purpose hydraulic excavator', 'high', 12, 21, ARRAY['hydraulic_pressure','engine_temp','boom_position'], 8),
('10000000-2000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000010', 'TRUCK_SERVICE', 'Service Truck', 'Field service and maintenance support vehicle', 'low', 8, 21, ARRAY['engine_temp'], 9),
('10000000-2000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000010', 'FLEET_SUPPORT', 'Support Vehicle', 'Light support and personnel transport', 'low', 5, 365, ARRAY[], 10),

-- Fixed Plant/Process (20)
('10000000-2000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000010', 'CRUSHER_PRIMARY', 'Primary Crusher', 'Primary ore crusher for run-of-mine material', 'critical', 10, 30, ARRAY['vibration','motor_current','throughput','liner_wear'], 11),
('10000000-2000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000010', 'CRUSHER_SECONDARY', 'Secondary Crusher', 'Secondary crushing stage', 'high', 8, 30, ARRAY['vibration','motor_current','throughput'], 12),
('10000000-2000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000010', 'CONVEYOR_MAIN', 'Main Conveyor', 'Primary material transport conveyor', 'critical', 15, 90, ARRAY['belt_speed','alignment','motor_temp','belt_wear'], 13),
('10000000-2000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000010', 'CONVEYOR_TRANSFER', 'Transfer Conveyor', 'Transfer and distribution conveyor', 'high', 12, 90, ARRAY['belt_speed','alignment'], 14),
('10000000-2000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000010', 'SCREEN_VIB', 'Vibrating Screen', 'Classification screen for sizing', 'high', 8, 60, ARRAY['vibration','amplitude','motor_current'], 15),
('10000000-2000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000010', 'PUMP_SLURRY', 'Slurry Pump', 'High-wear slurry transport pump', 'high', 3, 30, ARRAY['vibration','temperature','pressure','flow','wear_rate'], 16),
('10000000-2000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000010', 'PUMP_CENTRIFUGAL', 'Centrifugal Pump', 'Process centrifugal pump', 'critical', 15, 90, ARRAY['vibration','temperature','pressure','flow'], 17),
('10000000-2000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000010', 'PUMP_PD', 'Positive Displacement Pump', 'PD pump for viscous or high-pressure service', 'high', 12, 60, ARRAY['vibration','pressure','flow','temperature'], 18),
('10000000-2000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000010', 'THICKENER', 'Thickener', 'Tailings and process thickener', 'medium', 25, 365, ARRAY['torque','rake_position','bed_level'], 19),
('10000000-2000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000010', 'HYDROTRANSPORT', 'Hydrotransport Pipeline', 'Long-distance slurry pipeline system', 'critical', 20, 180, ARRAY['flow','pressure','wall_thickness','velocity'], 20),
('10000000-2000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000010', 'CYCLONE', 'Hydrocyclone', 'Classification cyclone for process separation', 'high', 5, 90, ARRAY['pressure_drop','flow','underflow_density'], 21),
('10000000-2000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000010', 'SEPARATOR', 'Oil/Gas Separator', 'Primary separation vessel', 'critical', 20, 180, ARRAY['level','temperature','pressure','interface_level'], 22),
('10000000-2000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000010', 'HX_SHELL', 'Shell & Tube Heat Exchanger', 'Process heat exchange', 'high', 20, 365, ARRAY['inlet_temp','outlet_temp','pressure_drop','flow'], 23),
('10000000-2000-0000-0000-000000000024', '10000000-0000-0000-0000-000000000010', 'HX_PLATE', 'Plate Heat Exchanger', 'Compact heat exchange', 'medium', 15, 180, ARRAY['inlet_temp','outlet_temp','pressure_drop'], 24),
('10000000-2000-0000-0000-000000000025', '10000000-0000-0000-0000-000000000010', 'BOILER', 'Steam Boiler', 'Process steam generation', 'critical', 25, 365, ARRAY['pressure','temperature','flame','water_level','flue_gas'], 25),
('10000000-2000-0000-0000-000000000026', '10000000-0000-0000-0000-000000000010', 'VESSEL_PRESSURE', 'Pressure Vessel', 'Coded pressure vessel', 'high', 25, 365, ARRAY['pressure','temperature','level'], 26),
('10000000-2000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000010', 'VESSEL_STORAGE', 'Storage Tank', 'Bulk storage tank', 'medium', 30, 365, ARRAY['level','temperature'], 27),
('10000000-2000-0000-0000-000000000028', '10000000-0000-0000-0000-000000000010', 'MOTOR_HV', 'High Voltage Motor (>600V)', 'Large HV electric motor', 'critical', 20, 365, ARRAY['vibration','temperature','current','insulation_resistance'], 28),
('10000000-2000-0000-0000-000000000029', '10000000-0000-0000-0000-000000000010', 'MOTOR_LV', 'Low Voltage Motor (<600V)', 'Standard LV electric motor', 'medium', 15, 365, ARRAY['vibration','temperature','current'], 29),
('10000000-2000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000010', 'GEARBOX', 'Industrial Gearbox', 'Speed reduction gearbox', 'high', 15, 180, ARRAY['vibration','oil_temperature','oil_quality'], 30),

-- More Fixed Plant (10)
('10000000-2000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000010', 'COMPRESSOR_GAS', 'Gas Compressor', 'Process gas compression', 'critical', 20, 90, ARRAY['vibration','temperature','pressure','flow','surge'], 31),
('10000000-2000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000010', 'COMPRESSOR_AIR', 'Air Compressor', 'Plant/instrument air supply', 'medium', 15, 180, ARRAY['vibration','temperature','pressure','flow'], 32),
('10000000-2000-0000-0000-000000000033', '10000000-0000-0000-0000-000000000010', 'BLOWER', 'Industrial Blower', 'Process air blower/fan', 'medium', 15, 180, ARRAY['vibration','temperature','flow'], 33),
('10000000-2000-0000-0000-000000000034', '10000000-0000-0000-0000-000000000010', 'FAN_PROCESS', 'Process Fan', 'Ventilation and process fan', 'medium', 12, 180, ARRAY['vibration','temperature'], 34),
('10000000-2000-0000-0000-000000000035', '10000000-0000-0000-0000-000000000010', 'TREATER', 'Heater Treater', 'Oil treating and dehydration unit', 'high', 15, 180, ARRAY['temperature','pressure','level'], 35),
('10000000-2000-0000-0000-000000000036', '10000000-0000-0000-0000-000000000010', 'VALVE_CONTROL', 'Control Valve', 'Process control valve', 'high', 10, 180, ARRAY['position','pressure_upstream','pressure_downstream'], 36),
('10000000-2000-0000-0000-000000000037', '10000000-0000-0000-0000-000000000010', 'VALVE_SAFETY', 'Safety Relief Valve', 'Pressure safety valve (PSV)', 'critical', 5, 365, ARRAY['set_pressure','pop_test_result'], 37),
('10000000-2000-0000-0000-000000000038', '10000000-0000-0000-0000-000000000010', 'PIPE_PROCESS', 'Process Piping', 'Process piping systems', 'medium', 30, 365, ARRAY['wall_thickness','corrosion_rate'], 38),
('10000000-2000-0000-0000-000000000039', '10000000-0000-0000-0000-000000000010', 'PIPE_UTILITY', 'Utility Piping', 'Utility service piping', 'low', 40, 730, ARRAY[], 39),
('10000000-2000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000010', 'FLARE', 'Flare System', 'Emergency and process flare', 'critical', 20, 365, ARRAY['flame_status','flow','temperature'], 40),

-- Utilities/Infrastructure (7)
('10000000-2000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000010', 'TRANSFORMER', 'Power Transformer', 'Main power distribution transformer', 'critical', 35, 365, ARRAY['oil_temp','dissolved_gas','load','winding_temp'], 41),
('10000000-2000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000010', 'SUBSTATION', 'Electrical Substation', 'Power distribution substation', 'critical', 30, 365, ARRAY['bus_voltage','load','temperature'], 42),
('10000000-2000-0000-0000-000000000043', '10000000-0000-0000-0000-000000000010', 'SWITCHGEAR', 'Switchgear/MCC', 'Medium voltage switchgear and motor control center', 'high', 25, 365, ARRAY['temperature','arc_flash_rating'], 43),
('10000000-2000-0000-0000-000000000044', '10000000-0000-0000-0000-000000000010', 'GENERATOR', 'Diesel/Gas Generator', 'Backup or primary power generation', 'high', 15, 90, ARRAY['engine_temp','voltage','frequency','fuel_level'], 44),
('10000000-2000-0000-0000-000000000045', '10000000-0000-0000-0000-000000000010', 'PIPELINE_MAIN', 'Main Pipeline', 'Inter-facility transport pipeline', 'critical', 30, 365, ARRAY['flow','pressure','pig_tracking','wall_thickness'], 45),
('10000000-2000-0000-0000-000000000046', '10000000-0000-0000-0000-000000000010', 'WATER_TREATMENT', 'Water Treatment System', 'Process and potable water treatment', 'high', 20, 180, ARRAY['ph','turbidity','flow','chemical_dosing'], 46),
('10000000-2000-0000-0000-000000000047', '10000000-0000-0000-0000-000000000010', 'FIRE_PROTECTION', 'Fire Protection System', 'Fire suppression and detection', 'critical', 25, 365, ARRAY['pressure','alarm_status'], 47),

-- Instrumentation/Control (3)
('10000000-2000-0000-0000-000000000048', '10000000-0000-0000-0000-000000000010', 'TRANSMITTER', 'Pressure/Flow/Temp Transmitter', 'Field transmitter instrument', 'medium', 10, 365, ARRAY['reading_accuracy','signal_quality'], 48),
('10000000-2000-0000-0000-000000000049', '10000000-0000-0000-0000-000000000010', 'ANALYZER', 'Process Analyzer', 'Online process analyzer', 'high', 8, 90, ARRAY['reading_accuracy','sample_flow','reagent_level'], 49),
('10000000-2000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000010', 'DCS_FIELD', 'DCS/PLC Field Device', 'Distributed control system field equipment', 'high', 15, 365, ARRAY['comm_status','io_status'], 50)
ON CONFLICT DO NOTHING;
