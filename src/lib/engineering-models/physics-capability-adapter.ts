import type {
  PhysicsCapabilityDefinition,
  PhysicsDomain,
} from "../asset-twins/physics-capability";
import type { PhysicsModelPackManifest } from "./types";

const PHYSICS_DOMAINS = new Set<PhysicsDomain>([
  "rotating_machinery",
  "bearing_kinematics",
  "gear_mesh",
  "hydraulics",
  "pneumatics",
  "thermal",
  "structural",
  "tribology",
  "electrical_machines",
  "fluid_flow",
  "rope_mechanics",
  "material_handling",
]);

/**
 * Projects a versioned pack into SyncAI's existing asset-twin physics
 * capability contract. The pack remains canonical in model_register; this is
 * a generated compatibility view, not a second independently governed model.
 */
export function toPhysicsCapabilityDefinition(
  manifest: PhysicsModelPackManifest,
): PhysicsCapabilityDefinition {
  if (!PHYSICS_DOMAINS.has(manifest.domain as PhysicsDomain)) {
    throw new Error(
      `Engineering model domain ${manifest.domain} is not an asset-twin physics domain.`,
    );
  }
  const inputPorts = manifest.ports.filter(
    (port) => port.direction === "input",
  );
  const outputPorts = manifest.ports.filter(
    (port) => port.direction === "output",
  );
  return {
    schemaVersion: manifest.schemaVersion,
    code: `MODEL:${manifest.modelKey}@${manifest.version}`,
    name: manifest.name,
    domain: manifest.domain as PhysicsDomain,
    description: manifest.description,
    applicableAssetFamilies: manifest.applicability.assetFamilies,
    applicableSharedComponentCategories:
      manifest.applicability.componentCategories,
    inputs: inputPorts.map((port) => ({
      code: port.code,
      name: port.physicalMeaning,
      unit: port.unit,
      description: `${port.physicalMeaning}; basis: ${port.basis}; convention: ${port.convention}.`,
      required: port.required,
    })),
    outputs: outputPorts.map((port) => ({
      code: port.code,
      name: port.physicalMeaning,
      unit: port.unit,
      description: `${port.physicalMeaning}; basis: ${port.basis}; convention: ${port.convention}.`,
      required: port.required,
    })),
    calculations: [
      {
        code: manifest.execution.calculationKey,
        name: manifest.name,
        kind: "deterministic_calculation",
        description:
          "Version-pinned engineering-model execution; applicability and evidence are enforced by the model supply chain.",
        inputCodes: inputPorts.map((port) => port.code),
        outputCodes: outputPorts.map((port) => port.code),
        assumptions: [
          ...manifest.assumptions,
          ...manifest.boundaryConditions.map(
            (condition) => `Boundary condition: ${condition}`,
          ),
        ],
        formulaReference: manifest.governingEquations
          .map((equation) => equation.formulaReference)
          .join(", "),
      },
    ],
    // Requirements are not observations. Canonical evidence is bound in the
    // database and must not be fabricated into this static compatibility view.
    evidence: [],
    governance: {
      reviewState: "draft",
      engineeringApprovalRequired: true,
      customerOverridesRequireApproval: true,
      autonomousOperationalActionAllowed: false,
      thresholdsPolicy: "approved_source_only",
      intendedUse: "engineering_decision_support",
    },
  };
}
