import type { PhysicsCapabilityDefinition } from "./physics-capability";

const governed = {
  reviewState: "draft" as const,
  engineeringApprovalRequired: true as const,
  customerOverridesRequireApproval: true as const,
  autonomousOperationalActionAllowed: false as const,
  thresholdsPolicy: "approved_source_only" as const,
  intendedUse: "engineering_decision_support" as const,
};

export const rotatingMachineryPhysicsCapability: PhysicsCapabilityDefinition = {
  schemaVersion: "0.1.0",
  code: "PHYS-ROT-KINEMATICS",
  name: "Rotating machinery kinematics and energy",
  domain: "rotating_machinery",
  description:
    "Governed deterministic calculations for rotational frequency, angular velocity, surface speed, and stored kinetic energy.",
  applicableAssetFamilies: [
    "rotating_equipment_power_transmission",
    "rotating_electrical_equipment",
    "rotating_fluid_equipment",
    "fixed_plant_material_handling",
    "fixed_material_processing",
  ],
  applicableSharedComponentCategories: ["bearing", "coupling", "shaft", "gear_stage"],
  inputs: [
    {
      code: "rpm",
      name: "Rotational speed",
      unit: "r/min",
      description: "Non-negative rotational speed.",
      required: true,
    },
    {
      code: "diameter_m",
      name: "Rotating diameter",
      unit: "m",
      description: "Positive diameter used for surface-speed calculation.",
      required: false,
    },
    {
      code: "inertia_kg_m2",
      name: "Mass moment of inertia",
      unit: "kg·m²",
      description: "Non-negative mass moment of inertia about the rotation axis.",
      required: false,
    },
  ],
  outputs: [
    {
      code: "shaft_frequency_hz",
      name: "Shaft rotational frequency",
      unit: "Hz",
      description: "Rotational cycles per second.",
      required: true,
    },
    {
      code: "angular_velocity_rad_s",
      name: "Angular velocity",
      unit: "rad/s",
      description: "Angular velocity derived from rotational speed.",
      required: true,
    },
    {
      code: "surface_speed_m_s",
      name: "Surface speed",
      unit: "m/s",
      description: "Tangential speed at the stated diameter.",
      required: false,
    },
    {
      code: "rotational_kinetic_energy_j",
      name: "Rotational kinetic energy",
      unit: "J",
      description: "Stored rotational kinetic energy at the stated inertia and speed.",
      required: false,
    },
  ],
  calculations: [
    {
      code: "ROT-RPM-TO-HZ",
      name: "Rotational frequency conversion",
      kind: "deterministic_calculation",
      description: "Converts revolutions per minute to cycles per second.",
      inputCodes: ["rpm"],
      outputCodes: ["shaft_frequency_hz"],
      assumptions: ["Speed is represented by a non-negative scalar average over the evaluation interval."],
      formulaReference: "DERIVATION-ROT-KINEMATICS-001",
    },
    {
      code: "ROT-RPM-TO-OMEGA",
      name: "Angular velocity conversion",
      kind: "deterministic_calculation",
      description: "Converts revolutions per minute to angular velocity.",
      inputCodes: ["rpm"],
      outputCodes: ["angular_velocity_rad_s"],
      assumptions: ["Speed is represented by a non-negative scalar average over the evaluation interval."],
      formulaReference: "DERIVATION-ROT-KINEMATICS-002",
    },
    {
      code: "ROT-SURFACE-SPEED",
      name: "Rotational surface speed",
      kind: "deterministic_calculation",
      description: "Calculates tangential surface speed at a stated diameter.",
      inputCodes: ["rpm", "diameter_m"],
      outputCodes: ["surface_speed_m_s"],
      assumptions: ["Diameter is positive and represents the evaluation surface."],
      formulaReference: "DERIVATION-ROT-KINEMATICS-003",
    },
    {
      code: "ROT-KINETIC-ENERGY",
      name: "Rotational kinetic energy",
      kind: "deterministic_calculation",
      description: "Calculates stored kinetic energy from mass moment of inertia and angular velocity.",
      inputCodes: ["rpm", "inertia_kg_m2"],
      outputCodes: ["rotational_kinetic_energy_j"],
      assumptions: ["The stated inertia is about the active rotation axis."],
      formulaReference: "DERIVATION-ROT-DYNAMICS-001",
    },
  ],
  evidence: [],
  governance: governed,
};

export const bearingKinematicsPhysicsCapability: PhysicsCapabilityDefinition = {
  schemaVersion: "0.1.0",
  code: "PHYS-BEARING-KINEMATICS",
  name: "Rolling-element bearing characteristic frequencies",
  domain: "bearing_kinematics",
  description:
    "Governed geometry-based estimates of rolling-element bearing characteristic frequencies for diagnostic reference.",
  applicableAssetFamilies: [
    "rotating_equipment_power_transmission",
    "rotating_electrical_equipment",
    "rotating_fluid_equipment",
    "fixed_plant_material_handling",
    "fixed_material_processing",
  ],
  applicableSharedComponentCategories: ["bearing"],
  inputs: [
    {
      code: "rpm",
      name: "Shaft rotational speed",
      unit: "r/min",
      description: "Non-negative shaft rotational speed.",
      required: true,
    },
    {
      code: "rolling_element_count",
      name: "Rolling-element count",
      unit: "count",
      description: "Positive integer number of rolling elements.",
      required: true,
    },
    {
      code: "rolling_element_diameter_mm",
      name: "Rolling-element diameter",
      unit: "mm",
      description: "Positive rolling-element diameter.",
      required: true,
    },
    {
      code: "pitch_diameter_mm",
      name: "Bearing pitch diameter",
      unit: "mm",
      description: "Positive rolling-element pitch diameter.",
      required: true,
    },
    {
      code: "contact_angle_deg",
      name: "Contact angle",
      unit: "deg",
      description: "Bearing contact angle between zero and ninety degrees.",
      required: true,
    },
  ],
  outputs: [
    {
      code: "shaft_frequency_hz",
      name: "Shaft rotational frequency",
      unit: "Hz",
      description: "Rotational cycles per second.",
      required: true,
    },
    {
      code: "fundamental_train_frequency_hz",
      name: "Fundamental train frequency",
      unit: "Hz",
      description: "Idealized cage or train frequency.",
      required: true,
    },
    {
      code: "ball_pass_frequency_outer_hz",
      name: "Ball-pass frequency outer race",
      unit: "Hz",
      description: "Idealized rolling-element pass frequency at the outer race.",
      required: true,
    },
    {
      code: "ball_pass_frequency_inner_hz",
      name: "Ball-pass frequency inner race",
      unit: "Hz",
      description: "Idealized rolling-element pass frequency at the inner race.",
      required: true,
    },
    {
      code: "ball_spin_frequency_hz",
      name: "Ball spin frequency",
      unit: "Hz",
      description: "Idealized rolling-element spin frequency.",
      required: true,
    },
  ],
  calculations: [
    {
      code: "BEARING-CHARACTERISTIC-FREQUENCIES",
      name: "Bearing characteristic-frequency calculation",
      kind: "diagnostic_feature",
      description:
        "Calculates idealized geometry-based bearing frequencies for spectrum interpretation; outputs are not alarm limits.",
      inputCodes: [
        "rpm",
        "rolling_element_count",
        "rolling_element_diameter_mm",
        "pitch_diameter_mm",
        "contact_angle_deg",
      ],
      outputCodes: [
        "shaft_frequency_hz",
        "fundamental_train_frequency_hz",
        "ball_pass_frequency_outer_hz",
        "ball_pass_frequency_inner_hz",
        "ball_spin_frequency_hz",
      ],
      assumptions: [
        "Geometry is representative of the installed bearing.",
        "The calculation is kinematic and does not model rolling-element slip.",
        "Observed peaks require independent engineering interpretation and verification.",
      ],
      formulaReference: "DERIVATION-BEARING-KINEMATICS-001",
    },
  ],
  evidence: [],
  governance: governed,
};

export const physicsCapabilityLibrary: PhysicsCapabilityDefinition[] = [
  rotatingMachineryPhysicsCapability,
  bearingKinematicsPhysicsCapability,
];

export function getPhysicsCapability(code: string): PhysicsCapabilityDefinition | undefined {
  return physicsCapabilityLibrary.find((capability) => capability.code === code);
}
