import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import {
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  rollingElementBearingDna,
  variableFrequencyDriveDna,
} from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for open- and closed-circuit cooling towers. */
export const coolingTowerTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-COOLING-TOWER",
  name: "Cooling tower",
  family: "critical_cooling",
  description:
    "Reusable engineering template for evaporative cooling towers rejecting condenser heat. Water treatment and legionella control limits come only from the site's approved water management plan.",
  functions: ["reject heat by evaporation", "keep condenser water within the approved range"],
  operatingStates: ["running", "fan_staged", "standby", "freeze_protection", "isolated", "offline"],
  standards: ["CTI ATC-105", "ASHRAE 188", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "CT-FAN-DRIVE",
      name: "Fan, motor, VFD and gearbox",
      sharedComponentDnaCodes: [
        industrialAcMotorDna.code,
        variableFrequencyDriveDna.code,
        industrialGearboxComponentDna.code,
        rollingElementBearingDna.code,
      ],
      functions: ["move air through the fill"],
      telemetryConcepts: ["fan_speed", "motor_current", "vibration", "gearbox_oil_level"],
      inspectionZones: ["fan blades", "gearbox", "drive shaft", "motor"],
      failureModes: [
        f("CT-GEARBOX-FAILURE", "CT-FAN-DRIVE", "Gearbox or drive shaft failure",
          "wet, warm conditions degrade gearbox lubrication and shaft couplings",
          ["oil contamination by water", "misalignment", "bearing wear"],
          ["fan stops", "reduced heat rejection"],
          ["vibration", "gearbox_oil_level", "oil_analysis"],
          ["vibration_assessment", "oil_analysis"], 4),
      ],
    },
    {
      code: "CT-FILL-DISTRIBUTION",
      name: "Fill, spray distribution and drift eliminators",
      functions: ["spread water for evaporation"],
      telemetryConcepts: ["approach_temperature", "condenser_water_temperature", "wet_bulb"],
      inspectionZones: ["fill media", "spray nozzles", "distribution basin", "drift eliminators"],
      failureModes: [
        f("CT-FILL-FOULING", "CT-FILL-DISTRIBUTION", "Fill fouling or nozzle blockage",
          "scale, biofilm or debris block fill and nozzles and reduce thermal performance",
          ["poor water treatment", "debris", "biological growth"],
          ["higher condenser water temperature", "chiller capacity loss"],
          ["approach_temperature", "inspection"],
          ["fill_inspection", "thermal_performance_review"], 3),
      ],
    },
    {
      code: "CT-BASIN-WATER",
      name: "Basin, make-up, blowdown and treatment",
      functions: ["hold and condition circulating water"],
      telemetryConcepts: ["basin_level", "conductivity", "biocide_residual", "makeup_flow"],
      inspectionZones: ["basin", "strainers", "make-up valve", "dosing equipment", "basin heaters"],
      failureModes: [
        f("CT-WATER-QUALITY", "CT-BASIN-WATER", "Water quality loss",
          "treatment failure allows scale, corrosion and microbial growth including legionella risk",
          ["dosing failure", "low blowdown", "stagnant water"],
          ["public health risk", "fouling", "corrosion"],
          ["conductivity", "biocide_residual", "microbiological_sampling"],
          ["water_management_plan_review", "microbiological_sampling"], 5),
        f("CT-MAKEUP-LOSS", "CT-BASIN-WATER", "Loss of make-up water",
          "supply interruption or valve failure lets the basin drain",
          ["utility water interruption", "valve failure"],
          ["pump cavitation", "loss of heat rejection"],
          ["basin_level", "makeup_flow"],
          ["valve_inspection"], 4),
      ],
    },
  ],
};
