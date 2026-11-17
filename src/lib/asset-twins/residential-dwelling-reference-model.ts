import type { SystemFunction, SystemNode, SystemReferenceModel } from "./system-model";

/**
 * Residential dwelling system reference model (draft).
 *
 * One dwelling unit (house, townhouse, condo or suite), system by system, down
 * to equipment units bound to the residential asset-class templates. A
 * housing portfolio is laid out with the existing location hierarchy: the
 * portfolio is the site, each property or unit is an area, and this model's
 * systems and functional locations sit under each area. There is no separate
 * portfolio model.
 *
 * Draft. Performance standards and redundancy schemes are site-specified; no
 * intervals, set points or limits are stated. Those come from the owner's
 * approved maintenance program and a named person approves them.
 */

const fn = (
  code: string,
  statement: string,
  critical: boolean,
  functionalFailures: string[],
): SystemFunction => ({ code, statement, critical, functionalFailures, performanceStandard: "site_specified" });

const system = (code: string, name: string, functions: SystemFunction[]): SystemNode => ({
  code,
  name,
  level: "system",
  functions,
});

const subsystem = (code: string, name: string, parentCode: string, functions: SystemFunction[]): SystemNode => ({
  code,
  name,
  level: "subsystem",
  parentCode,
  functions,
});

const equipment = (
  code: string,
  name: string,
  parentCode: string,
  functions: SystemFunction[],
  binding: { template: string } | { maintainableItems: string[] },
): SystemNode =>
  "template" in binding
    ? {
        code,
        name,
        level: "equipment_unit",
        parentCode,
        functions,
        assetClassTemplateCode: binding.template,
        equipmentClassStatus: "template_available",
      }
    : {
        code,
        name,
        level: "equipment_unit",
        parentCode,
        functions,
        equipmentClassStatus: "template_planned",
        maintainableItems: binding.maintainableItems,
      };

const nodes: SystemNode[] = [
  // ── Heating and ventilation ─────────────────────────────────────────────
  system("RES-HEATING", "Heating and ventilation", [
    fn("F-RES-HEATING", "keep the dwelling heated and ventilated", true, ["no heat", "insufficient heat", "unsafe combustion venting"]),
  ]),
  subsystem("RES-HEATING-PLANT", "Heating plant", "RES-HEATING", [
    fn("F-HEAT-SUPPLY", "supply heat to every room and keep the dwelling above freezing", true, ["no heat", "insufficient heat", "freeze risk to water lines"]),
  ]),
  equipment("RES-FURNACE-UNIT", "Forced-air furnace", "RES-HEATING-PLANT", [
    fn("F-FURNACE", "produce and distribute heat and vent combustion products outdoors", true, ["failure to ignite", "lockout", "combustion product spillage"]),
  ], { template: "RES-FURNACE" }),
  equipment("RES-VENTILATION", "Ventilation and exhaust", "RES-HEATING-PLANT", [
    fn("F-VENTILATION", "exchange stale and moist air for fresh air", false, ["no ventilation", "condensation and mould"]),
  ], { maintainableItems: ["HRV or ERV core and filters", "bathroom exhaust fans", "kitchen exhaust", "exterior hoods and dampers"] }),

  // ── Cooling ─────────────────────────────────────────────────────────────
  system("RES-COOLING", "Cooling", [
    fn("F-RES-COOLING", "keep the dwelling comfortable in summer", false, ["no cooling", "insufficient cooling"]),
  ]),
  subsystem("RES-COOLING-PLANT", "Cooling plant", "RES-COOLING", [
    fn("F-COOL-SUPPLY", "cool and dehumidify the living space", false, ["no cooling", "condensate overflow"]),
  ]),
  equipment("RES-AC-UNIT", "Air conditioner or heat pump", "RES-COOLING-PLANT", [
    fn("F-AC", "move heat out of (or into) the dwelling", false, ["no cooling", "charge loss", "coil icing"]),
  ], { template: "RES-HEAT-PUMP" }),

  // ── Water and drainage ──────────────────────────────────────────────────
  system("RES-WATER", "Water and drainage", [
    fn("F-RES-WATER", "supply water, hot water and drainage to the dwelling", true, ["no water", "leak or flood", "sewer backup"]),
  ]),
  subsystem("RES-WATER-SERVICES", "Domestic water services", "RES-WATER", [
    fn("F-WATER", "deliver water to fixtures and carry waste away without leaks or freezing", true, ["frozen or burst pipe", "leak", "blocked drain"]),
  ]),
  equipment("RES-PLUMBING-SYSTEM", "Supply piping, fixtures, drains and freeze protection", "RES-WATER-SERVICES", [
    fn("F-PLUMBING", "carry water to and from every fixture", true, ["freeze burst", "fixture leak", "drain blockage"]),
  ], { template: "RES-PLUMBING" }),
  equipment("RES-WATER-HEATER-UNIT", "Water heater", "RES-WATER-SERVICES", [
    fn("F-HOT-WATER", "heat and supply domestic hot water safely", false, ["no hot water", "tank leak", "relief valve seized"]),
  ], { template: "RES-WATER-HEATER" }),
  equipment("RES-SUMP", "Sump pit and pump", "RES-WATER-SERVICES", [
    fn("F-SUMP", "remove groundwater from below the foundation", false, ["pump failure", "float stuck", "discharge frozen"]),
  ], { maintainableItems: ["sump pump", "float switch", "check valve", "discharge line", "high-level alarm"] }),

  // ── Electrical ──────────────────────────────────────────────────────────
  system("RES-ELEC", "Electrical", [
    fn("F-RES-ELEC", "power the dwelling safely", true, ["total loss of power", "partial outage", "electrical fire hazard"]),
  ]),
  subsystem("RES-ELEC-SUPPLY", "Electrical service and distribution", "RES-ELEC", [
    fn("F-ELEC-SUPPLY", "supply and protect every circuit", true, ["total loss of power", "repeated trips", "failure to clear a fault"]),
  ]),
  equipment("RES-ELEC-PANEL", "Service entrance, panel and branch circuits", "RES-ELEC-SUPPLY", [
    fn("F-PANEL", "distribute power and interrupt faults", true, ["overheating connection", "protective device fails to trip", "nuisance trip"]),
  ], { template: "RES-ELEC-SERVICE" }),

  // ── Life safety ─────────────────────────────────────────────────────────
  system("RES-LIFE-SAFETY", "Life safety", [
    fn("F-RES-LIFE-SAFETY", "warn occupants of fire and carbon monoxide and let them act", true, ["no warning of fire", "no warning of CO"]),
  ]),
  subsystem("RES-LS-DETECTION", "Detection and first response", "RES-LIFE-SAFETY", [
    fn("F-LS", "detect smoke and CO and provide first-response equipment", true, ["alarm missing or dead", "extinguisher unserviceable"]),
  ]),
  equipment("RES-ALARMS", "Smoke and CO alarms and extinguishers", "RES-LS-DETECTION", [
    fn("F-ALARMS", "sound an alarm on smoke or CO and allow a small fire to be controlled", true, ["alarm disabled or expired", "extinguisher discharged"]),
  ], { template: "RES-LIFE-SAFETY" }),

  // ── Building envelope ───────────────────────────────────────────────────
  system("RES-ENVELOPE", "Building envelope and structure", [
    fn("F-RES-ENVELOPE", "keep weather out and support the structure", false, ["water entry", "heat loss", "structural movement"]),
  ]),
  subsystem("RES-ENVELOPE-SHELL", "Roof, walls, openings and foundation", "RES-ENVELOPE", [
    fn("F-SHELL", "shed water and snow and keep the foundation dry", false, ["roof leak", "ice damming", "foundation water entry"]),
  ]),
  equipment("RES-BUILDING-ENVELOPE", "Roof, gutters, envelope and foundation", "RES-ENVELOPE-SHELL", [
    fn("F-ENVELOPE", "keep water and cold out", false, ["roof leak", "gutter overflow", "seal failure", "foundation crack"]),
  ], { template: "RES-ENVELOPE" }),

  // ── Appliances ──────────────────────────────────────────────────────────
  system("RES-APPLIANCES", "Appliances", [
    fn("F-RES-APPLIANCES", "provide the appliances supplied with the unit", false, ["appliance out of service"]),
  ]),
  subsystem("RES-APPLIANCE-GROUP", "Kitchen and laundry", "RES-APPLIANCES", [
    fn("F-APPLIANCE-GROUP", "keep food cold, cook and launder safely", false, ["appliance failure", "dryer fire hazard", "washer flood"]),
  ]),
  equipment("RES-APPLIANCE-SET", "Refrigerator, range, washer and dryer", "RES-APPLIANCE-GROUP", [
    fn("F-APPLIANCES", "operate each supplied appliance safely", false, ["not cooling", "burner fault", "lint build-up", "hose burst"]),
  ], { template: "RES-APPLIANCES" }),
];

/** Topology: what powers, feeds, protects and monitors what inside a dwelling. */
const edges: SystemReferenceModel["edges"] = [
  { from: "RES-ELEC-PANEL", relation: "supplies_power_to", to: "RES-FURNACE-UNIT" },
  { from: "RES-ELEC-PANEL", relation: "supplies_power_to", to: "RES-VENTILATION" },
  { from: "RES-ELEC-PANEL", relation: "supplies_power_to", to: "RES-AC-UNIT" },
  { from: "RES-ELEC-PANEL", relation: "supplies_power_to", to: "RES-WATER-HEATER-UNIT" },
  { from: "RES-ELEC-PANEL", relation: "supplies_power_to", to: "RES-SUMP" },
  { from: "RES-ELEC-PANEL", relation: "supplies_power_to", to: "RES-ALARMS" },
  { from: "RES-ELEC-PANEL", relation: "supplies_power_to", to: "RES-APPLIANCE-SET" },
  { from: "RES-PLUMBING-SYSTEM", relation: "supplies_water_to", to: "RES-WATER-HEATER-UNIT" },
  { from: "RES-PLUMBING-SYSTEM", relation: "supplies_water_to", to: "RES-APPLIANCE-SET" },
  // Freeze protection: water lines depend on the heating plant in winter.
  { from: "RES-PLUMBING-SYSTEM", relation: "depends_on", to: "RES-FURNACE-UNIT" },
  { from: "RES-ALARMS", relation: "monitors", to: "RES-FURNACE-UNIT" },
  { from: "RES-ALARMS", relation: "monitors", to: "RES-WATER-HEATER-UNIT" },
  { from: "RES-ALARMS", relation: "protects", to: "RES-HEATING" },
  { from: "RES-BUILDING-ENVELOPE", relation: "protects", to: "RES-PLUMBING-SYSTEM" },
  { from: "RES-SUMP", relation: "protects", to: "RES-BUILDING-ENVELOPE" },
  { from: "RES-BUILDING-ENVELOPE", relation: "houses", to: "RES-HEATING-PLANT" },
];

const schemes: SystemReferenceModel["redundancyGroups"][number]["allowedSchemes"] = ["N", "N+1"];

const redundancy = (code: string, name: string, nodeCode: string, functionCodes: string[]) => ({
  code,
  name,
  nodeCode,
  functionCodes,
  scheme: "site_specified" as const,
  allowedSchemes: schemes,
});

/** Critical functions the site must declare: a single furnace is N, and a named person accepts it. */
const redundancyGroups: SystemReferenceModel["redundancyGroups"] = [
  redundancy("RG-RES-HEAT", "Heating plant and backup heat", "RES-HEATING-PLANT", ["F-HEAT-SUPPLY", "F-FURNACE"]),
  redundancy("RG-RES-WATER", "Water services and freeze protection", "RES-WATER-SERVICES", ["F-WATER", "F-PLUMBING"]),
  redundancy("RG-RES-ELEC", "Electrical supply", "RES-ELEC-SUPPLY", ["F-ELEC-SUPPLY", "F-PANEL"]),
  redundancy("RG-RES-ALARMS", "Smoke and CO alarm coverage", "RES-LS-DETECTION", ["F-LS", "F-ALARMS"]),
];

export const residentialDwellingReferenceModel: SystemReferenceModel = {
  schemaVersion: "0.1.0",
  code: "SRM-RESIDENTIAL-DWELLING",
  name: "Residential dwelling reference model",
  industryPack: "buildings_infrastructure",
  description:
    "Systems, subsystems, equipment and functions of one dwelling unit (house, townhouse, condo or suite) for housing and property-operations teams, with power, water, freeze-protection and alarm topology. Draft; no intervals, set points or limits are implied.",
  sources: [
    "National Building Code of Canada (requirement categories)",
    "National Plumbing Code of Canada (requirement categories)",
    "Canadian Electrical Code Part I (CSA C22.1)",
    "CSA B149.1 (natural gas and propane installation)",
    "CAN/ULC-S531 and CAN/ULC-S553 (smoke alarms)",
    "CSA 6.19 (residential carbon monoxide alarming devices)",
    "ISO 14224 (equipment taxonomy levels)",
    "SAE JA1011 (RCM functions and functional failures)",
  ],
  reviewState: "draft",
  nodes,
  edges,
  redundancyGroups,
  governance: {
    thresholdsPolicy: "approved_source_only",
    autonomousOperationalActionAllowed: false,
    redundancyDeclaration: "site_declared_named_human_approval",
  },
};
