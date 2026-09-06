import type {
  ComponentDependencyEdge,
  SharedComponentDnaProfile,
} from "./shared-component-dna";

const governed = {
  reviewState: "draft" as const,
  engineeringApprovalRequired: true as const,
  customerOverridesRequireApproval: true as const,
  autonomousOperationalActionAllowed: false as const,
  thresholdsPolicy: "approved_source_only" as const,
  recommendDoesNotAuthorize: true as const,
};

export const rollingElementBearingDna: SharedComponentDnaProfile = {
  schemaVersion: "0.1.0",
  code: "COMP-DNA-BEARING-ROLLING",
  name: "Rolling-element bearing component DNA",
  category: "bearing",
  description:
    "Reusable governed engineering profile for rolling-element bearings across rotating equipment.",
  functions: [
    "support rotating shafts",
    "transmit radial and axial loads",
    "maintain controlled relative motion",
  ],
  telemetryConcepts: [
    "bearing_vibration",
    "bearing_temperature",
    "shaft_speed",
    "lubricant_condition",
  ],
  detectableIndicators: [
    "abnormal vibration pattern",
    "elevated bearing temperature",
    "lubricant debris or discoloration",
    "audible distress",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "BEARING-FATIGUE",
      mechanismCode: "fatigue",
      mechanismStandardCode: "FM-FATIGUE",
      description: "Raceway or rolling-element fatigue damage.",
      detectionMethodCodes: ["vibration_monitoring", "thermal_imaging"],
      verificationMethodCodes: [
        "qualified_engineer_visual_verification",
        "non_destructive_testing",
      ],
    },
    {
      code: "BEARING-LUBRICATION-LOSS",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description:
        "Lubrication deficiency or contamination affecting bearing condition.",
      detectionMethodCodes: ["vibration_monitoring", "thermal_imaging"],
      verificationMethodCodes: ["qualified_engineer_visual_verification"],
    },
  ],
  evidence: [],
  governance: governed,
};

export const flexibleCouplingDna: SharedComponentDnaProfile = {
  schemaVersion: "0.1.0",
  code: "COMP-DNA-COUPLING-FLEXIBLE",
  name: "Flexible coupling component DNA",
  category: "coupling",
  description:
    "Reusable governed profile for flexible couplings transmitting torque between rotating shafts.",
  functions: [
    "transmit torque",
    "accommodate approved misalignment",
    "attenuate torsional disturbance",
  ],
  telemetryConcepts: [
    "coupling_vibration",
    "shaft_speed",
    "torsional_response",
    "coupling_temperature",
  ],
  detectableIndicators: [
    "coupling vibration change",
    "visible element wear",
    "localized coupling heat",
    "alignment drift evidence",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "COUPLING-WEAR",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description:
        "Wear or deterioration of flexible elements or engagement surfaces.",
      detectionMethodCodes: ["rgb_visual_inspection", "vibration_monitoring"],
      verificationMethodCodes: ["qualified_engineer_visual_verification"],
    },
    {
      code: "COUPLING-MISALIGNMENT",
      mechanismCode: "fatigue",
      mechanismStandardCode: "FM-FATIGUE",
      description:
        "Load amplification associated with alignment or installation condition.",
      detectionMethodCodes: ["vibration_monitoring", "thermal_imaging"],
      verificationMethodCodes: ["qualified_engineer_visual_verification"],
    },
  ],
  evidence: [],
  governance: governed,
};

export const mechanicalSealDna: SharedComponentDnaProfile = {
  schemaVersion: "0.1.0",
  code: "COMP-DNA-SEAL-MECHANICAL",
  name: "Mechanical seal component DNA",
  category: "seal",
  description:
    "Reusable governed profile for rotating mechanical seals and containment interfaces.",
  functions: [
    "contain process fluid",
    "control leakage",
    "separate process and atmosphere",
  ],
  telemetryConcepts: [
    "seal_leakage",
    "seal_temperature",
    "seal_flush_pressure",
    "shaft_speed",
  ],
  detectableIndicators: [
    "visible leakage",
    "seal-face heat",
    "flush or barrier pressure change",
    "contamination at the gland",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "SEAL-FACE-WEAR",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description: "Seal-face or secondary-sealing deterioration.",
      detectionMethodCodes: ["rgb_visual_inspection", "thermal_imaging"],
      verificationMethodCodes: ["qualified_engineer_visual_verification"],
    },
    {
      code: "SEAL-LEAKAGE",
      mechanismCode: "corrosion",
      mechanismStandardCode: "FM-CORROSION",
      description: "Loss of containment requiring site-defined evaluation.",
      detectionMethodCodes: ["rgb_visual_inspection", "fixed_camera"],
      verificationMethodCodes: ["qualified_engineer_visual_verification"],
    },
  ],
  evidence: [],
  governance: governed,
};

export const lubricationSystemDna: SharedComponentDnaProfile = {
  schemaVersion: "0.1.0",
  code: "COMP-DNA-LUBRICATION-SYSTEM",
  name: "Lubrication system component DNA",
  category: "lubrication_system",
  description:
    "Reusable governed profile for lubrication delivery, filtration, storage, and condition control.",
  functions: [
    "deliver lubricant",
    "remove contaminants",
    "control lubricant condition",
    "support heat removal",
  ],
  telemetryConcepts: [
    "lubricant_pressure",
    "lubricant_flow",
    "lubricant_temperature",
    "filter_differential_pressure",
    "lubricant_condition",
  ],
  detectableIndicators: [
    "low delivery pressure or flow",
    "filter differential rise",
    "lubricant contamination",
    "unexpected reservoir level change",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "LUBE-DELIVERY-LOSS",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description: "Loss or degradation of lubrication delivery.",
      detectionMethodCodes: ["thermal_imaging", "fixed_camera"],
      verificationMethodCodes: ["qualified_engineer_visual_verification"],
    },
    {
      code: "LUBE-CONTAMINATION",
      mechanismCode: "corrosion",
      mechanismStandardCode: "FM-CORROSION",
      description: "Contamination or degraded lubricant condition.",
      detectionMethodCodes: ["rgb_visual_inspection"],
      verificationMethodCodes: ["qualified_engineer_visual_verification"],
    },
  ],
  evidence: [],
  governance: governed,
};

export const industrialAcMotorDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-MOTOR-AC",
  name: "Industrial AC motor component DNA",
  category: "motor",
  description:
    "Reusable governed profile for AC motors used as components inside larger assets. Distinct from the IND-ELECTRIC-MOTOR asset-class hierarchy.",
  functions: [
    "convert electrical energy to torque",
    "support driven equipment",
    "reject heat",
    "protect insulation",
  ],
  telemetryConcepts: [
    "phase_current",
    "phase_voltage",
    "winding_temperature",
    "motor_vibration",
    "insulation_status",
  ],
  detectableIndicators: [
    "current imbalance or signature change",
    "winding or frame heat",
    "insulation deterioration evidence",
    "starting or running abnormality",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "MOTOR-INSULATION-DEGRADE",
      mechanismCode: "thermal",
      description:
        "Stator or winding insulation deterioration from thermal, electrical, or environmental stress.",
      detectionMethodCodes: [
        "insulation_test",
        "thermal_imaging",
        "partial_discharge",
      ],
      verificationMethodCodes: [
        "insulation_resistance_test",
        "qualified_electrical_assessment",
      ],
    },
    {
      code: "MOTOR-ROTOR-DEFECT",
      mechanismCode: "fatigue",
      mechanismStandardCode: "FM-FATIGUE",
      description:
        "Rotor conductor, cage, or mechanical defect disturbing torque production.",
      detectionMethodCodes: [
        "current_signature",
        "vibration_monitoring",
        "thermal_imaging",
      ],
      verificationMethodCodes: [
        "motor_current_signature_analysis",
        "rotor_inspection",
      ],
    },
  ],
  evidence: [],
  governance: governed,
};

export const industrialGearboxComponentDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-GEARBOX-INDUSTRIAL",
  name: "Industrial gearbox component DNA",
  category: "gearbox",
  description:
    "Reusable governed profile for gear stages used as power-transmission components. Distinct from the ROT-GEARBOX asset-class hierarchy.",
  functions: [
    "transmit power",
    "change speed and torque",
    "support rotating elements",
    "contain lubricant",
  ],
  telemetryConcepts: [
    "gear_mesh_vibration",
    "gearbox_temperature",
    "oil_debris",
    "shaft_speed",
  ],
  detectableIndicators: [
    "gear-mesh vibration change",
    "oil debris increase",
    "case temperature rise",
    "audible mesh distress",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "GEAR-TOOTH-DAMAGE",
      mechanismCode: "fatigue",
      mechanismStandardCode: "FM-FATIGUE",
      description:
        "Tooth surface or root damage from fatigue, wear, or overload.",
      detectionMethodCodes: [
        "vibration_monitoring",
        "oil_analysis",
        "rgb_visual_inspection",
      ],
      verificationMethodCodes: [
        "borescope_inspection",
        "gear_contact_assessment",
      ],
    },
    {
      code: "GEAR-LUBE-STARVATION",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description:
        "Inadequate lubricant quantity, quality, or delivery to the mesh.",
      detectionMethodCodes: ["thermal_imaging", "oil_analysis"],
      verificationMethodCodes: [
        "lubrication_system_test",
        "oil_sample_confirmation",
      ],
    },
  ],
  evidence: [],
  governance: governed,
};

export const frictionBrakeDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-BRAKE-FRICTION",
  name: "Friction brake component DNA",
  category: "brake",
  description:
    "Reusable governed profile for friction brakes that stop or hold motion. Protective-function testing remains a recommendation until authorized.",
  functions: [
    "stop commanded motion",
    "hold a mechanism stationary",
    "provide fail-safe restraint where designed",
  ],
  telemetryConcepts: [
    "brake_command",
    "brake_release_state",
    "brake_temperature",
    "stopping_time",
  ],
  detectableIndicators: [
    "incomplete release heat",
    "extended stopping or hold slip",
    "visible lining or linkage wear",
    "release-state disagreement",
  ],
  maintenanceStrategyCodes: ["MS-PROTECTIVE-TASK", "MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "BRAKE-FAIL-RELEASE",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description:
        "Brake fails to release completely, generating drag and heat.",
      detectionMethodCodes: ["thermal_imaging", "brake_release_state"],
      verificationMethodCodes: [
        "release_system_test",
        "brake_clearance_inspection",
      ],
    },
    {
      code: "BRAKE-HOLD-LOSS",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description: "Holding or stopping capacity deteriorates.",
      detectionMethodCodes: ["rgb_visual_inspection", "stopping_time"],
      verificationMethodCodes: [
        "static_hold_test",
        "qualified_engineer_visual_verification",
      ],
    },
  ],
  evidence: [],
  governance: governed,
};

export const wireRopeDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-ROPE-WIRE",
  name: "Wire-rope component DNA",
  category: "rope",
  description:
    "Reusable governed profile for load-bearing wire ropes. Retirement limits require an approved source and are not encoded here.",
  functions: [
    "transmit tensile load",
    "support reeving geometry",
    "control suspended equipment",
  ],
  telemetryConcepts: [
    "rope_load",
    "rope_speed",
    "rope_cycles",
    "rope_condition",
  ],
  detectableIndicators: [
    "broken wires",
    "diameter or lay change",
    "corrosion or abrasion",
    "bird-caging or distortion",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "ROPE-FATIGUE-WEAR",
      mechanismCode: "fatigue",
      mechanismStandardCode: "FM-FATIGUE",
      description:
        "Wire breakage, abrasion, or fatigue from bending and load cycles.",
      detectionMethodCodes: ["rgb_visual_inspection", "drone_rgb"],
      verificationMethodCodes: [
        "qualified_rope_inspection",
        "magnetic_rope_test",
      ],
    },
    {
      code: "ROPE-CORROSION",
      mechanismCode: "corrosion",
      mechanismStandardCode: "FM-CORROSION",
      description:
        "Corrosion or lubrication-loss deterioration of wires or core.",
      detectionMethodCodes: ["rgb_visual_inspection"],
      verificationMethodCodes: ["qualified_rope_inspection"],
    },
  ],
  evidence: [],
  governance: governed,
};

export const sheaveDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-SHEAVE",
  name: "Sheave and fairlead component DNA",
  category: "sheave",
  description:
    "Reusable governed profile for sheaves, fairleads, and rope-path pulleys that guide tensile members.",
  functions: [
    "guide rope path",
    "support bending radius",
    "transmit sheave-bearing loads",
  ],
  telemetryConcepts: [
    "sheave_bearing_temperature",
    "sheave_speed",
    "rope_tracking",
  ],
  detectableIndicators: [
    "groove wear or corrugation",
    "sheave bearing heat",
    "rope tracking offset",
    "guard or flange damage",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "SHEAVE-GROOVE-WEAR",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description: "Groove or flange wear that changes rope support geometry.",
      detectionMethodCodes: ["rgb_visual_inspection", "drone_rgb"],
      verificationMethodCodes: [
        "sheave_geometry_check",
        "qualified_engineer_visual_verification",
      ],
    },
    {
      code: "SHEAVE-BEARING-DEGRADE",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description: "Sheave-bearing distress affecting rotation or alignment.",
      detectionMethodCodes: ["thermal_imaging", "vibration_monitoring"],
      verificationMethodCodes: [
        "bearing_inspection",
        "qualified_engineer_visual_verification",
      ],
    },
  ],
  evidence: [],
  governance: governed,
};

export const centrifugalPumpComponentDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-PUMP-CENTRIFUGAL",
  name: "Centrifugal pump component DNA",
  category: "pump",
  description:
    "Reusable governed profile for centrifugal pumps used as components. Distinct from the ROT-CENT-PUMP asset-class hierarchy.",
  functions: ["move fluid", "develop head", "contain pressure"],
  telemetryConcepts: [
    "suction_pressure",
    "discharge_pressure",
    "flow_rate",
    "pump_vibration",
  ],
  detectableIndicators: [
    "head or flow deterioration",
    "cavitation noise",
    "seal or packing leakage",
    "abnormal pump vibration",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "PUMP-WET-END-WEAR",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description:
        "Erosion or wear changing hydraulic geometry and clearances.",
      detectionMethodCodes: [
        "performance_trend",
        "vibration_monitoring",
        "rgb_visual_inspection",
      ],
      verificationMethodCodes: ["internal_inspection", "performance_test"],
    },
    {
      code: "PUMP-CAVITATION",
      mechanismCode: "cavitation",
      description: "Vapour-bubble collapse damaging wetted surfaces.",
      detectionMethodCodes: ["vibration_monitoring", "acoustic"],
      verificationMethodCodes: ["hydraulic_assessment", "internal_inspection"],
    },
  ],
  evidence: [],
  governance: governed,
};

export const hydraulicCylinderDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-CYLINDER-HYDRAULIC",
  name: "Hydraulic cylinder component DNA",
  category: "hydraulic_cylinder",
  description:
    "Reusable governed profile for hydraulic cylinders and linear actuators.",
  functions: [
    "apply linear force",
    "hold commanded position",
    "contain hydraulic fluid",
  ],
  telemetryConcepts: [
    "cylinder_pressure",
    "cylinder_position",
    "cylinder_drift",
    "rod_condition",
  ],
  detectableIndicators: [
    "external leakage",
    "drift under hold",
    "rod scoring or corrosion",
    "uneven or hesitant motion",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "CYLINDER-SEAL-LEAK",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description: "Rod, piston, or gland seal leakage.",
      detectionMethodCodes: ["rgb_visual_inspection", "pressure"],
      verificationMethodCodes: ["leak_source_inspection", "pressure_hold_test"],
    },
    {
      code: "CYLINDER-DRIFT",
      mechanismCode: "wear",
      mechanismStandardCode: "FM-WEAR",
      description: "Uncommanded movement under load from bypass or leakage.",
      detectionMethodCodes: ["cylinder_position", "cylinder_drift"],
      verificationMethodCodes: ["drift_test", "internal_bypass_assessment"],
    },
  ],
  evidence: [],
  governance: governed,
};

export const coolingSystemDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-COOLING-SYSTEM",
  name: "Cooling and ventilation component DNA",
  category: "cooling_system",
  description:
    "Reusable governed profile for cooling, ventilation, and heat-rejection subsystems.",
  functions: [
    "remove equipment heat",
    "maintain enclosure environment",
    "control contamination ingress",
  ],
  telemetryConcepts: [
    "airflow",
    "inlet_temperature",
    "outlet_temperature",
    "filter_differential_pressure",
    "fan_status",
  ],
  detectableIndicators: [
    "reduced airflow",
    "filter differential rise",
    "outlet or cabinet temperature rise",
    "fan abnormality",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED"],
  failureReferences: [
    {
      code: "COOLING-AIRFLOW-LOSS",
      mechanismCode: "fouling",
      description:
        "Restricted flow from filter loading, fan degradation, obstruction, or recirculation.",
      detectionMethodCodes: ["thermal_imaging", "airflow"],
      verificationMethodCodes: ["airflow_test", "filter_inspection"],
    },
    {
      code: "COOLING-EXCHANGER-FOUL",
      mechanismCode: "fouling",
      description: "Heat-exchanger fouling reducing heat rejection.",
      detectionMethodCodes: ["thermal_imaging", "outlet_temperature"],
      verificationMethodCodes: [
        "heat_exchanger_inspection",
        "qualified_engineer_visual_verification",
      ],
    },
  ],
  evidence: [],
  governance: governed,
};

export const switchgearDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-SWITCHGEAR",
  name: "Switchgear and power-distribution component DNA",
  category: "switchgear",
  description:
    "Reusable governed profile for switchgear, breakers, and power-distribution assemblies. Protective tests recommend; they do not authorize switching.",
  functions: [
    "distribute electrical power",
    "isolate circuits",
    "protect downstream equipment",
  ],
  telemetryConcepts: [
    "voltage",
    "current",
    "cabinet_temperature",
    "breaker_status",
    "fault_code",
  ],
  detectableIndicators: [
    "connection or bus heat",
    "abnormal smell or discoloration",
    "breaker status disagreement",
    "insulation distress evidence",
  ],
  maintenanceStrategyCodes: ["MS-PROTECTIVE-TASK"],
  failureReferences: [
    {
      code: "SWITCHGEAR-HOT-CONNECTION",
      mechanismCode: "thermal",
      description: "High-resistance connection generating localized heat.",
      detectionMethodCodes: ["thermal_imaging", "current_imbalance"],
      verificationMethodCodes: [
        "deenergized_electrical_inspection",
        "connection_resistance_test",
      ],
    },
    {
      code: "SWITCHGEAR-INSULATION",
      mechanismCode: "electrical",
      description: "Insulation or tracking deterioration inside the assembly.",
      detectionMethodCodes: ["partial_discharge", "thermal_imaging"],
      verificationMethodCodes: [
        "insulation_test",
        "qualified_electrical_assessment",
      ],
    },
  ],
  evidence: [],
  governance: governed,
};

export const variableFrequencyDriveDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-VFD",
  name: "Variable-frequency drive component DNA",
  category: "vfd",
  description:
    "Reusable governed profile for VFDs and similar electronic motor drives.",
  functions: [
    "control motor speed and torque",
    "convert electrical power",
    "protect the driven motor within configured limits",
  ],
  telemetryConcepts: [
    "dc_bus_voltage",
    "output_frequency",
    "drive_temperature",
    "drive_fault_code",
    "output_current",
  ],
  detectableIndicators: [
    "drive fault or trip",
    "heatsink or cabinet heat",
    "output-current abnormality",
    "cooling-fan distress",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED", "MS-PROTECTIVE-TASK"],
  failureReferences: [
    {
      code: "VFD-THERMAL-FAULT",
      mechanismCode: "thermal",
      description:
        "Over-temperature or cooling-path deterioration in the drive.",
      detectionMethodCodes: ["thermal_imaging", "drive_fault_code"],
      verificationMethodCodes: [
        "cooling_system_inspection",
        "qualified_electrical_assessment",
      ],
    },
    {
      code: "VFD-POWER-STAGE",
      mechanismCode: "electrical",
      description:
        "Power-stage or DC-bus abnormality affecting output quality.",
      detectionMethodCodes: ["drive_fault_code", "current_signature"],
      verificationMethodCodes: [
        "qualified_electrical_assessment",
        "drive_self_test",
      ],
    },
  ],
  evidence: [],
  governance: governed,
};

export const transformerDna: SharedComponentDnaProfile = {
  schemaVersion: "0.2.0",
  code: "COMP-DNA-TRANSFORMER",
  name: "Transformer component DNA",
  category: "transformer",
  description:
    "Reusable governed profile for power and isolation transformers. Oil, temperature, and electrical limits require approved sources.",
  functions: ["transform voltage", "isolate circuits", "support power quality"],
  telemetryConcepts: [
    "winding_temperature",
    "oil_temperature",
    "load_current",
    "partial_discharge",
  ],
  detectableIndicators: [
    "abnormal winding or oil temperature",
    "oil condition change or leakage",
    "audible corona or buzzing change",
    "insulation-test deterioration",
  ],
  maintenanceStrategyCodes: ["MS-CONDITION-BASED", "MS-PROTECTIVE-TASK"],
  failureReferences: [
    {
      code: "TRANSFORMER-INSULATION",
      mechanismCode: "electrical",
      description: "Winding or dielectric insulation deterioration.",
      detectionMethodCodes: [
        "insulation_test",
        "partial_discharge",
        "thermal_imaging",
      ],
      verificationMethodCodes: [
        "insulation_resistance_test",
        "qualified_electrical_assessment",
      ],
    },
    {
      code: "TRANSFORMER-COOLING-OIL",
      mechanismCode: "thermal",
      description: "Cooling-path or insulating-fluid condition deterioration.",
      detectionMethodCodes: ["thermal_imaging", "rgb_visual_inspection"],
      verificationMethodCodes: [
        "oil_sample_confirmation",
        "cooling_system_inspection",
      ],
    },
  ],
  evidence: [],
  governance: governed,
};

export const sharedComponentDnaLibrary: SharedComponentDnaProfile[] = [
  rollingElementBearingDna,
  flexibleCouplingDna,
  mechanicalSealDna,
  lubricationSystemDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  frictionBrakeDna,
  wireRopeDna,
  sheaveDna,
  centrifugalPumpComponentDna,
  hydraulicCylinderDna,
  coolingSystemDna,
  switchgearDna,
  variableFrequencyDriveDna,
  transformerDna,
];

export const sharedComponentDependencyGraph: ComponentDependencyEdge[] = [
  {
    fromComponentCode: flexibleCouplingDna.code,
    toComponentCode: rollingElementBearingDna.code,
    relationship: "transmits_load_to",
    rationale:
      "Coupling-transmitted torque and alignment loads influence adjacent shaft-bearing systems.",
  },
  {
    fromComponentCode: lubricationSystemDna.code,
    toComponentCode: rollingElementBearingDna.code,
    relationship: "lubricates",
    rationale:
      "The lubrication system supplies and conditions lubricant for the bearing system.",
  },
  {
    fromComponentCode: mechanicalSealDna.code,
    toComponentCode: rollingElementBearingDna.code,
    relationship: "protects",
    rationale:
      "Seal containment helps limit process-fluid ingress toward adjacent bearing spaces.",
  },
  {
    fromComponentCode: industrialAcMotorDna.code,
    toComponentCode: industrialGearboxComponentDna.code,
    relationship: "drives",
    rationale:
      "Motors commonly deliver torque into a gearbox or other driven train.",
  },
  {
    fromComponentCode: industrialGearboxComponentDna.code,
    toComponentCode: rollingElementBearingDna.code,
    relationship: "transmits_load_to",
    rationale: "Gear-mesh loads are carried by shaft bearings.",
  },
  {
    fromComponentCode: lubricationSystemDna.code,
    toComponentCode: industrialGearboxComponentDna.code,
    relationship: "lubricates",
    rationale: "Gear meshes depend on conditioned lubricant delivery.",
  },
  {
    fromComponentCode: variableFrequencyDriveDna.code,
    toComponentCode: industrialAcMotorDna.code,
    relationship: "drives",
    rationale: "A VFD supplies controlled electrical power to an AC motor.",
  },
  {
    fromComponentCode: switchgearDna.code,
    toComponentCode: variableFrequencyDriveDna.code,
    relationship: "protects",
    rationale: "Switchgear isolates and protects downstream electronic drives.",
  },
  {
    fromComponentCode: switchgearDna.code,
    toComponentCode: industrialAcMotorDna.code,
    relationship: "protects",
    rationale: "Switchgear isolates and protects directly connected motors.",
  },
  {
    fromComponentCode: transformerDna.code,
    toComponentCode: switchgearDna.code,
    relationship: "drives",
    rationale:
      "Transformers feed distribution switchgear at the required voltage.",
  },
  {
    fromComponentCode: coolingSystemDna.code,
    toComponentCode: industrialAcMotorDna.code,
    relationship: "protects",
    rationale:
      "Cooling systems remove motor losses and protect insulation life.",
  },
  {
    fromComponentCode: coolingSystemDna.code,
    toComponentCode: variableFrequencyDriveDna.code,
    relationship: "protects",
    rationale:
      "Drive cabinets depend on cooling and filtration to reject heat.",
  },
  {
    fromComponentCode: coolingSystemDna.code,
    toComponentCode: transformerDna.code,
    relationship: "protects",
    rationale: "Transformer cooling paths reject load and no-load losses.",
  },
  {
    fromComponentCode: frictionBrakeDna.code,
    toComponentCode: industrialAcMotorDna.code,
    relationship: "protects",
    rationale:
      "Brakes restrain motor-driven motion when commanded or on fail-safe apply.",
  },
  {
    fromComponentCode: sheaveDna.code,
    toComponentCode: wireRopeDna.code,
    relationship: "supports",
    rationale: "Sheaves define rope bending radius and tracking.",
  },
  {
    fromComponentCode: industrialAcMotorDna.code,
    toComponentCode: centrifugalPumpComponentDna.code,
    relationship: "drives",
    rationale: "Pumps used as components are commonly motor-driven.",
  },
  {
    fromComponentCode: lubricationSystemDna.code,
    toComponentCode: hydraulicCylinderDna.code,
    relationship: "lubricates",
    rationale:
      "Cylinder seals and pins depend on clean hydraulic fluid as both power medium and lubricant.",
  },
];

export function getSharedComponentDna(
  code: string,
): SharedComponentDnaProfile | undefined {
  return sharedComponentDnaLibrary.find((profile) => profile.code === code);
}

export const sharedComponentDnaCodes = sharedComponentDnaLibrary.map(
  (profile) => profile.code,
);
