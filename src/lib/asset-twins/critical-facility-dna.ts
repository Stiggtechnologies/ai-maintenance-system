import type { EngineeringDnaProfile } from "./engineering-dna";
import { automaticTransferSwitchTemplate } from "./automatic-transfer-switch";
import { dataCenterChillerTemplate } from "./data-center-chiller";
import { standbyGeneratorTemplate } from "./standby-generator";
import { computerRoomAirHandlerTemplate } from "./computer-room-air-handler";
import { staticTransferSwitchTemplate } from "./static-transfer-switch";
import { powerDistributionUnitTemplate } from "./power-distribution-unit";
import { buswayTemplate } from "./busway";
import { mvSwitchgearTemplate } from "./mv-switchgear";
import { powerTransformerTemplate } from "./power-transformer";
import { coolingTowerTemplate } from "./cooling-tower";
import { batteryEnergyStorageTemplate } from "./battery-energy-storage";
import { coolantDistributionUnitTemplate } from "./coolant-distribution-unit";
import { rearDoorHeatExchangerTemplate } from "./rear-door-heat-exchanger";
import { cleanAgentSuppressionTemplate } from "./clean-agent-suppression";
import { fireDetectionAlarmTemplate } from "./fire-detection-alarm";
import { preactionSprinklerTemplate } from "./preaction-sprinkler";
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

export const computerRoomAirHandlerEngineeringDna = criticalFacilityDna(
  computerRoomAirHandlerTemplate,
  "Governed reusable blueprint for chilled-water air handler and fan-wall twins in data halls.",
);

export const staticTransferSwitchEngineeringDna = criticalFacilityDna(
  staticTransferSwitchTemplate,
  "Governed reusable blueprint for static transfer switch twins feeding single-corded critical loads.",
);

export const powerDistributionUnitEngineeringDna = criticalFacilityDna(
  powerDistributionUnitTemplate,
  "Governed reusable blueprint for PDU and remote power panel twins.",
);

export const buswayEngineeringDna = criticalFacilityDna(
  buswayTemplate,
  "Governed reusable blueprint for overhead busway and tap-off twins.",
);

export const mvSwitchgearEngineeringDna = criticalFacilityDna(
  mvSwitchgearTemplate,
  "Governed reusable blueprint for medium-voltage switchgear and protection twins.",
);

export const powerTransformerEngineeringDna = criticalFacilityDna(
  powerTransformerTemplate,
  "Governed reusable blueprint for facility step-down transformer twins.",
);

export const coolingTowerEngineeringDna = criticalFacilityDna(
  coolingTowerTemplate,
  "Governed reusable blueprint for evaporative cooling tower twins.",
);

export const batteryEnergyStorageEngineeringDna = criticalFacilityDna(
  batteryEnergyStorageTemplate,
  "Governed reusable blueprint for lithium-ion battery energy storage twins behind UPS systems.",
);

export const coolantDistributionUnitEngineeringDna = criticalFacilityDna(
  coolantDistributionUnitTemplate,
  "Governed reusable blueprint for liquid-cooling coolant distribution unit twins.",
);

export const rearDoorHeatExchangerEngineeringDna = criticalFacilityDna(
  rearDoorHeatExchangerTemplate,
  "Governed reusable blueprint for rear-door heat exchanger twins.",
);

export const cleanAgentSuppressionEngineeringDna = criticalFacilityDna(
  cleanAgentSuppressionTemplate,
  "Governed reusable blueprint for clean-agent and inert-gas suppression twins.",
);

export const fireDetectionAlarmEngineeringDna = criticalFacilityDna(
  fireDetectionAlarmTemplate,
  "Governed reusable blueprint for fire detection, alarm and aspirating smoke detection twins.",
);

export const preactionSprinklerEngineeringDna = criticalFacilityDna(
  preactionSprinklerTemplate,
  "Governed reusable blueprint for pre-action sprinkler twins.",
);

export const criticalFacilityEngineeringDna: EngineeringDnaProfile[] = [
  standbyGeneratorEngineeringDna,
  upsSystemEngineeringDna,
  automaticTransferSwitchEngineeringDna,
  dataCenterChillerEngineeringDna,
  computerRoomAirHandlerEngineeringDna,
  staticTransferSwitchEngineeringDna,
  powerDistributionUnitEngineeringDna,
  buswayEngineeringDna,
  mvSwitchgearEngineeringDna,
  powerTransformerEngineeringDna,
  coolingTowerEngineeringDna,
  batteryEnergyStorageEngineeringDna,
  coolantDistributionUnitEngineeringDna,
  rearDoorHeatExchangerEngineeringDna,
  cleanAgentSuppressionEngineeringDna,
  fireDetectionAlarmEngineeringDna,
  preactionSprinklerEngineeringDna,
];
