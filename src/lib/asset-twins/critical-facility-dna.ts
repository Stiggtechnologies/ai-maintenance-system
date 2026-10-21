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
import { rotaryUpsTemplate } from "./rotary-ups";
import { emergencyPowerOffTemplate } from "./emergency-power-off";
import { buildingManagementSystemTemplate } from "./building-management-system";
import { electricalPowerMonitoringTemplate } from "./electrical-power-monitoring";
import { computerRoomAirConditionerTemplate } from "./computer-room-air-conditioner";
import { lvSwitchboardTemplate } from "./lv-switchboard";
import { generatorParallelingSwitchgearTemplate } from "./generator-paralleling-switchgear";
import { generatorFuelSystemTemplate } from "./generator-fuel-system";
import { earthingSystemTemplate } from "./earthing-lightning-protection";
import { rackPowerDistributionTemplate } from "./rack-power-distribution";
import { dryCoolerTemplate } from "./dry-cooler";
import { thermalStorageTankTemplate } from "./thermal-storage-tank";
import { coolingWaterTreatmentTemplate } from "./cooling-water-treatment";
import { chilledWaterDistributionTemplate } from "./chilled-water-distribution";
import { airHandlingEconomiserTemplate } from "./air-handling-economiser";
import { humidityControlTemplate } from "./humidity-control";
import { airflowContainmentTemplate } from "./airflow-containment";
import { directLiquidCoolingTemplate } from "./direct-liquid-cooling";
import { immersionCoolingTankTemplate } from "./immersion-cooling-tank";
import { leakDetectionTemplate } from "./leak-detection";
import { waterMistSuppressionTemplate } from "./water-mist-suppression";
import { emergencyLightingTemplate } from "./emergency-lighting";
import { dcimPlatformTemplate } from "./dcim-platform";
import { facilityControlsNetworkTemplate } from "./facility-controls-network";
import { accessControlTemplate } from "./access-control";
import { videoSurveillanceTemplate } from "./video-surveillance";
import { itRackCabinetTemplate } from "./it-rack-cabinet";
import { raisedFloorPathwaysTemplate } from "./raised-floor-pathways";
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

export const rotaryUpsEngineeringDna = criticalFacilityDna(
  rotaryUpsTemplate,
  "Governed reusable blueprint for flywheel or rotary UPS twins.",
);

export const emergencyPowerOffEngineeringDna = criticalFacilityDna(
  emergencyPowerOffTemplate,
  "Governed reusable blueprint for emergency power off system twins.",
);

export const buildingManagementSystemEngineeringDna = criticalFacilityDna(
  buildingManagementSystemTemplate,
  "Governed reusable blueprint for building management system twins.",
);

export const electricalPowerMonitoringEngineeringDna = criticalFacilityDna(
  electricalPowerMonitoringTemplate,
  "Governed reusable blueprint for electrical power monitoring system twins.",
);

export const computerRoomAirConditionerEngineeringDna = criticalFacilityDna(
  computerRoomAirConditionerTemplate,
  "Governed reusable blueprint for computer room air conditioner (direct expansion) twins.",
);

export const lvSwitchboardEngineeringDna = criticalFacilityDna(
  lvSwitchboardTemplate,
  "Governed reusable blueprint for low-voltage main switchboard twins.",
);

export const generatorParallelingSwitchgearEngineeringDna = criticalFacilityDna(
  generatorParallelingSwitchgearTemplate,
  "Governed reusable blueprint for generator paralleling switchgear twins.",
);

export const generatorFuelSystemEngineeringDna = criticalFacilityDna(
  generatorFuelSystemTemplate,
  "Governed reusable blueprint for generator fuel storage and transfer twins.",
);

export const earthingSystemEngineeringDna = criticalFacilityDna(
  earthingSystemTemplate,
  "Governed reusable blueprint for earthing, bonding and lightning protection twins.",
);

export const rackPowerDistributionEngineeringDna = criticalFacilityDna(
  rackPowerDistributionTemplate,
  "Governed reusable blueprint for rack power distribution unit twins.",
);

export const dryCoolerEngineeringDna = criticalFacilityDna(
  dryCoolerTemplate,
  "Governed reusable blueprint for dry cooler or adiabatic cooler twins.",
);

export const thermalStorageTankEngineeringDna = criticalFacilityDna(
  thermalStorageTankTemplate,
  "Governed reusable blueprint for chilled-water thermal storage tank twins.",
);

export const coolingWaterTreatmentEngineeringDna = criticalFacilityDna(
  coolingWaterTreatmentTemplate,
  "Governed reusable blueprint for cooling water treatment and make-up twins.",
);

export const chilledWaterDistributionEngineeringDna = criticalFacilityDna(
  chilledWaterDistributionTemplate,
  "Governed reusable blueprint for chilled-water distribution piping and valves twins.",
);

export const airHandlingEconomiserEngineeringDna = criticalFacilityDna(
  airHandlingEconomiserTemplate,
  "Governed reusable blueprint for air handling unit with economiser or evaporative cooling twins.",
);

export const humidityControlEngineeringDna = criticalFacilityDna(
  humidityControlTemplate,
  "Governed reusable blueprint for humidification and dehumidification twins.",
);

export const airflowContainmentEngineeringDna = criticalFacilityDna(
  airflowContainmentTemplate,
  "Governed reusable blueprint for hot- or cold-aisle containment twins.",
);

export const directLiquidCoolingEngineeringDna = criticalFacilityDna(
  directLiquidCoolingTemplate,
  "Governed reusable blueprint for direct-to-chip manifolds and cold plates twins.",
);

export const immersionCoolingTankEngineeringDna = criticalFacilityDna(
  immersionCoolingTankTemplate,
  "Governed reusable blueprint for immersion cooling tank twins.",
);

export const leakDetectionEngineeringDna = criticalFacilityDna(
  leakDetectionTemplate,
  "Governed reusable blueprint for water and coolant leak detection twins.",
);

export const waterMistSuppressionEngineeringDna = criticalFacilityDna(
  waterMistSuppressionTemplate,
  "Governed reusable blueprint for water-mist suppression twins.",
);

export const emergencyLightingEngineeringDna = criticalFacilityDna(
  emergencyLightingTemplate,
  "Governed reusable blueprint for emergency lighting and egress signage twins.",
);

export const dcimPlatformEngineeringDna = criticalFacilityDna(
  dcimPlatformTemplate,
  "Governed reusable blueprint for data centre infrastructure management platform twins.",
);

export const facilityControlsNetworkEngineeringDna = criticalFacilityDna(
  facilityControlsNetworkTemplate,
  "Governed reusable blueprint for facility controls network twins.",
);

export const accessControlEngineeringDna = criticalFacilityDna(
  accessControlTemplate,
  "Governed reusable blueprint for physical access control twins.",
);

export const videoSurveillanceEngineeringDna = criticalFacilityDna(
  videoSurveillanceTemplate,
  "Governed reusable blueprint for video surveillance twins.",
);

export const itRackCabinetEngineeringDna = criticalFacilityDna(
  itRackCabinetTemplate,
  "Governed reusable blueprint for iT racks and cabinets (critical load) twins.",
);

export const raisedFloorPathwaysEngineeringDna = criticalFacilityDna(
  raisedFloorPathwaysTemplate,
  "Governed reusable blueprint for raised floor and overhead pathways twins.",
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
  rotaryUpsEngineeringDna,
  emergencyPowerOffEngineeringDna,
  buildingManagementSystemEngineeringDna,
  electricalPowerMonitoringEngineeringDna,
  computerRoomAirConditionerEngineeringDna,
  lvSwitchboardEngineeringDna,
  generatorParallelingSwitchgearEngineeringDna,
  generatorFuelSystemEngineeringDna,
  earthingSystemEngineeringDna,
  rackPowerDistributionEngineeringDna,
  dryCoolerEngineeringDna,
  thermalStorageTankEngineeringDna,
  coolingWaterTreatmentEngineeringDna,
  chilledWaterDistributionEngineeringDna,
  airHandlingEconomiserEngineeringDna,
  humidityControlEngineeringDna,
  airflowContainmentEngineeringDna,
  directLiquidCoolingEngineeringDna,
  immersionCoolingTankEngineeringDna,
  leakDetectionEngineeringDna,
  waterMistSuppressionEngineeringDna,
  emergencyLightingEngineeringDna,
  dcimPlatformEngineeringDna,
  facilityControlsNetworkEngineeringDna,
  accessControlEngineeringDna,
  videoSurveillanceEngineeringDna,
  itRackCabinetEngineeringDna,
  raisedFloorPathwaysEngineeringDna,
];
