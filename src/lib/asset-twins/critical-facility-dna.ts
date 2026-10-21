import type { EngineeringDnaProfile } from "./engineering-dna";
import { automaticTransferSwitchTemplate } from "./automatic-transfer-switch";
import { dataCenterChillerTemplate } from "./data-center-chiller";
import { standbyGeneratorTemplate } from "./standby-generator";
import type { AssetClassTemplate } from "./types";
import { upsSystemTemplate } from "./ups-system";

const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * Digital Engineering DNA for the critical power and cooling chain:
 * standby generator, UPS with battery, transfer switch and chiller plant.
 *
 * Built the same way as the plant and mining classes: the hierarchy, failure
 * modes and telemetry concepts come from the template; every shared-component
 * binding is derived from the template's own references, so a profile cannot
 * claim a component the template does not have. No limits are carried here.
 */
function criticalFacilityDna(
  template: AssetClassTemplate,
  description: string,
): EngineeringDnaProfile {
  return {
    schemaVersion: "0.2.0",
    code: `DEDNA-${template.code}`,
    name: `${template.name} Digital Engineering DNA`,
    description,
    assetClassCode: template.code,
    capabilities: [
      "canonical_hierarchy",
      "failure_mechanisms",
      "telemetry_concepts",
      "digital_twin_instantiation",
      "governed_recommendations",
      "shared_component_composition",
    ],
    componentCodes: template.components.map((component) => component.code),
    failureModeCodes: template.components.flatMap((component) =>
      component.failureModes.map((failure) => failure.code),
    ),
    inspectionZoneCodes: [],
    telemetryConcepts: unique(
      template.components.flatMap((component) => component.telemetryConcepts),
    ),
    sharedComponentBindings: template.components.flatMap((component) =>
      (component.sharedComponentDnaCodes ?? []).map((sharedCode) => ({
        assetComponentCode: component.code,
        sharedComponentDnaCode: sharedCode,
        role: `${component.name.toLowerCase()} component intelligence`,
      })),
    ),
    standards: template.standards,
    evidence: [],
    governance: {
      reviewState: "draft",
      siteApprovalRequired: true,
      engineeringApprovalRequired: true,
      customerOverridesRequireApproval: true,
      autonomousOperationalActionAllowed: false,
      thresholdsPolicy: "approved_source_only",
    },
  };
}

export const standbyGeneratorEngineeringDna = criticalFacilityDna(
  standbyGeneratorTemplate,
  "Governed reusable blueprint for standby and emergency generator twins in data centres, hospitals and critical facilities.",
);

export const upsSystemEngineeringDna = criticalFacilityDna(
  upsSystemTemplate,
  "Governed reusable blueprint for static UPS twins including battery strings and bypass paths.",
);

export const automaticTransferSwitchEngineeringDna = criticalFacilityDna(
  automaticTransferSwitchTemplate,
  "Governed reusable blueprint for transfer switch and critical switchgear twins between utility, generator and UPS sources.",
);

export const dataCenterChillerEngineeringDna = criticalFacilityDna(
  dataCenterChillerTemplate,
  "Governed reusable blueprint for chiller plant twins that keep data halls and other critical spaces cooled.",
);

export const criticalFacilityEngineeringDna: EngineeringDnaProfile[] = [
  standbyGeneratorEngineeringDna,
  upsSystemEngineeringDna,
  automaticTransferSwitchEngineeringDna,
  dataCenterChillerEngineeringDna,
];
