import type { SystemFunction, SystemNode, SystemReferenceModel } from "./system-model";

/**
 * Apartment building common-areas reference model (draft).
 *
 * The shared systems of a low-rise apartment building (parkade, drainage,
 * building fire alarm, emergency lighting, security, water entry, envelope
 * and house electrical service). Each suite is planned separately with the
 * residential dwelling model; suites are not repeated here. Systems marked
 * "where installed" are confirmed against the building's own records.
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
  // ── Parkade ─────────────────────────────────────────────────────────────
  system("APT-PARKADE", "Parkade", [
    fn("F-APT-PARKADE", "store vehicles safely and keep the parkade dry and ventilated", true, ["flooding", "unsafe air", "access failure"]),
  ]),
  subsystem("APT-PARKADE-SERVICES", "Parkade drainage, ventilation and access", "APT-PARKADE", [
    fn("F-PARKADE-DRAIN", "remove water from the parkade and below-grade structure", true, ["sump failure", "drain blockage", "flooding"]),
    fn("F-PARKADE-AIR", "keep vehicle exhaust below unsafe levels", true, ["exhaust fan failure", "gas detection fault"]),
    fn("F-PARKADE-ACCESS", "let authorized vehicles in and keep others out", false, ["gate fails closed", "gate fails open", "keypad fault"]),
  ]),
  equipment("APT-SUMP-PUMPS", "Parkade sump pumps", "APT-PARKADE-SERVICES", [
    fn("F-SUMP-PUMPS", "pump collected water out of the sump pits", true, ["pump failure", "float stuck", "check valve failure", "discharge frozen"]),
  ], { maintainableItems: ["sump pumps", "float or level switches", "check valves", "discharge lines", "high-level alarm", "control panel"] }),
  equipment("APT-FLOOR-DRAINS", "Parkade floor drains and trench drains", "APT-PARKADE-SERVICES", [
    fn("F-FLOOR-DRAINS", "carry surface water and melt to the sump or sewer", false, ["blocked drain", "frozen drain", "oil interceptor full"]),
  ], { maintainableItems: ["floor drains", "trench drains", "catch basins", "oil and grit interceptor"] }),
  equipment("APT-PARKADE-VENT", "Parkade exhaust and gas detection", "APT-PARKADE-SERVICES", [
    fn("F-PARKADE-VENT", "exhaust vehicle fumes when gas levels rise", true, ["fan failure", "sensor drift", "controller fault"]),
  ], { maintainableItems: ["exhaust fans", "CO and NO2 sensors", "gas detection controller", "make-up air dampers"] }),
  equipment("APT-PARKADE-GATE", "Parkade overhead door or gate and keypad", "APT-PARKADE-SERVICES", [
    fn("F-PARKADE-GATE", "open for authorized vehicles and close safely", false, ["fails to open", "fails to close", "safety edge or photo-eye fault"]),
  ], { maintainableItems: ["door or gate operator", "keypad or reader", "safety edges and photo-eyes", "springs and tracks", "loop detectors"] }),

  // ── Life safety ─────────────────────────────────────────────────────────
  system("APT-LIFE-SAFETY", "Building life safety", [
    fn("F-APT-LIFE-SAFETY", "warn occupants and light the way out in a fire or power loss", true, ["no alarm", "no egress lighting"]),
  ]),
  subsystem("APT-FIRE-PROTECTION", "Fire alarm, emergency lighting and sprinklers", "APT-LIFE-SAFETY", [
    fn("F-APT-FIRE", "detect fire in common areas and suites and alarm the building", true, ["detection impaired", "alarm not sounding", "panel in trouble"]),
    fn("F-APT-EGRESS", "light exit routes when normal power fails", true, ["emergency lights fail", "exit signs dark"]),
  ]),
  equipment("APT-FIRE-ALARM", "Building fire alarm system", "APT-FIRE-PROTECTION", [
    fn("F-FIRE-ALARM", "detect and annunciate fire and notify occupants", true, ["detector fault", "panel trouble", "signal not monitored"]),
  ], { template: "CRIT-FIRE-DETECTION" }),
  equipment("APT-EMERGENCY-LIGHTING", "Emergency lighting and exit signs", "APT-FIRE-PROTECTION", [
    fn("F-EMERGENCY-LIGHTING", "light corridors, stairs and exits on power loss", true, ["battery failure", "lamp failure"]),
  ], { template: "CRIT-EMERGENCY-LIGHTING" }),
  equipment("APT-SPRINKLERS", "Sprinkler system (where installed)", "APT-FIRE-PROTECTION", [
    fn("F-SPRINKLERS", "control a fire in the protected areas", true, ["valve closed", "dry pipe freeze", "head obstructed"]),
  ], { maintainableItems: ["riser and control valves", "dry-pipe valve and compressor in the parkade", "sprinkler heads", "fire department connection", "flow and tamper switches"] }),

  // ── Security ────────────────────────────────────────────────────────────
  system("APT-SECURITY", "Building security", [
    fn("F-APT-SECURITY", "control entry and record what happens in common areas", false, ["unauthorized entry", "no recording"]),
  ]),
  subsystem("APT-SECURITY-SYSTEMS", "Access control and CCTV", "APT-SECURITY", [
    fn("F-APT-SECURITY-SYSTEMS", "admit authorized people and record entrances and the parkade", false, ["door held or forced", "camera down", "recorder full"]),
  ]),
  equipment("APT-ACCESS-CONTROL", "Entry access control", "APT-SECURITY-SYSTEMS", [
    fn("F-ACCESS", "admit authorized people at building and parkade entries", false, ["reader fault", "lock fails open", "lock fails closed"]),
  ], { template: "CRIT-ACCESS-CONTROL" }),
  equipment("APT-CCTV", "CCTV cameras and recorder", "APT-SECURITY-SYSTEMS", [
    fn("F-CCTV", "record entrances, corridors and the parkade", false, ["camera offline", "recording gap"]),
  ], { template: "CRIT-CCTV" }),

  // ── Water ───────────────────────────────────────────────────────────────
  system("APT-WATER", "Building water services", [
    fn("F-APT-WATER", "bring water into the building and distribute it to every suite", true, ["no water", "riser leak", "freeze"]),
  ]),
  subsystem("APT-WATER-ENTRY", "Water entry and risers", "APT-WATER", [
    fn("F-APT-WATER-ENTRY", "supply and isolate building water", true, ["main shut-off seized", "backflow device fault", "riser leak"]),
  ]),
  equipment("APT-DOMESTIC-WATER", "Water entry, backflow, risers and common drains", "APT-WATER-ENTRY", [
    fn("F-APT-DOMESTIC-WATER", "carry water to the suites and waste water away", true, ["freeze burst in common areas", "riser leak", "stack blockage"]),
  ], { template: "RES-PLUMBING" }),

  // ── Electrical ──────────────────────────────────────────────────────────
  system("APT-ELEC", "Building electrical service", [
    fn("F-APT-ELEC", "power common systems and feed suite panels", true, ["building outage", "common-area outage"]),
  ]),
  subsystem("APT-ELEC-SERVICE", "Service entrance and house distribution", "APT-ELEC", [
    fn("F-APT-ELEC-SERVICE", "distribute and protect building circuits", true, ["main breaker trip", "overheating connection"]),
  ]),
  equipment("APT-HOUSE-SWITCHBOARD", "Main switchboard and house panels", "APT-ELEC-SERVICE", [
    fn("F-HOUSE-SWITCHBOARD", "feed common loads and suite meters", true, ["switchboard fault", "failure to clear a fault"]),
  ], { template: "CRIT-LV-SWITCHBOARD" }),

  // ── Vertical transport ──────────────────────────────────────────────────
  system("APT-VERTICAL", "Vertical transportation (where installed)", [
    fn("F-APT-VERTICAL", "move people between floors", false, ["elevator out of service", "entrapment"]),
  ]),
  subsystem("APT-ELEVATORS", "Elevators", "APT-VERTICAL", [
    fn("F-APT-ELEVATORS", "provide safe elevator service", false, ["out of service", "door fault"]),
  ]),
  equipment("APT-ELEVATOR", "Passenger elevator", "APT-ELEVATORS", [
    fn("F-ELEVATOR", "carry passengers safely between floors", false, ["door fault", "leveling fault", "entrapment"]),
  ], { maintainableItems: ["controller", "machine and drive", "doors and operators", "car and hall fixtures", "emergency phone"] }),

  // ── Envelope ────────────────────────────────────────────────────────────
  system("APT-ENVELOPE", "Building envelope and structure", [
    fn("F-APT-ENVELOPE-SYSTEM", "keep weather out and support the building", false, ["water entry", "heat loss", "structural movement"]),
  ]),
  subsystem("APT-ENVELOPE-SHELL", "Roof, walls, balconies and foundation", "APT-ENVELOPE", [
    fn("F-APT-SHELL", "shed water and snow and keep the parkade and foundation dry", false, ["roof leak", "balcony membrane failure", "foundation water entry"]),
  ]),
  equipment("APT-BUILDING-ENVELOPE", "Roof, cladding, windows, balconies and foundation", "APT-ENVELOPE-SHELL", [
    fn("F-APT-ENVELOPE", "keep water and cold out of the building", false, ["roof leak", "seal failure", "foundation crack"]),
  ], { template: "RES-ENVELOPE" }),
];

/** Topology: what the house service powers and what protects or watches what. */
const edges: SystemReferenceModel["edges"] = [
  { from: "APT-HOUSE-SWITCHBOARD", relation: "supplies_power_to", to: "APT-SUMP-PUMPS" },
  { from: "APT-HOUSE-SWITCHBOARD", relation: "supplies_power_to", to: "APT-PARKADE-VENT" },
  { from: "APT-HOUSE-SWITCHBOARD", relation: "supplies_power_to", to: "APT-PARKADE-GATE" },
  { from: "APT-HOUSE-SWITCHBOARD", relation: "supplies_power_to", to: "APT-FIRE-ALARM" },
  { from: "APT-HOUSE-SWITCHBOARD", relation: "supplies_power_to", to: "APT-EMERGENCY-LIGHTING" },
  { from: "APT-HOUSE-SWITCHBOARD", relation: "supplies_power_to", to: "APT-ACCESS-CONTROL" },
  { from: "APT-HOUSE-SWITCHBOARD", relation: "supplies_power_to", to: "APT-CCTV" },
  { from: "APT-HOUSE-SWITCHBOARD", relation: "supplies_power_to", to: "APT-ELEVATOR" },
  { from: "APT-DOMESTIC-WATER", relation: "supplies_water_to", to: "APT-SPRINKLERS" },
  { from: "APT-FLOOR-DRAINS", relation: "depends_on", to: "APT-SUMP-PUMPS" },
  { from: "APT-SUMP-PUMPS", relation: "protects", to: "APT-BUILDING-ENVELOPE" },
  { from: "APT-FIRE-ALARM", relation: "monitors", to: "APT-SPRINKLERS" },
  { from: "APT-FIRE-ALARM", relation: "controls", to: "APT-ACCESS-CONTROL" },
  { from: "APT-ACCESS-CONTROL", relation: "controls", to: "APT-PARKADE-GATE" },
  { from: "APT-CCTV", relation: "monitors", to: "APT-PARKADE" },
  { from: "APT-SPRINKLERS", relation: "protects", to: "APT-PARKADE" },
  { from: "APT-BUILDING-ENVELOPE", relation: "houses", to: "APT-ELEC-SERVICE" },
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

/** Critical functions the building must declare and a named person approve. */
const redundancyGroups: SystemReferenceModel["redundancyGroups"] = [
  redundancy("RG-APT-SUMP", "Parkade sump pumps", "APT-SUMP-PUMPS", ["F-PARKADE-DRAIN", "F-SUMP-PUMPS"]),
  redundancy("RG-APT-PARKADE-AIR", "Parkade exhaust and gas detection", "APT-PARKADE-VENT", ["F-PARKADE-AIR", "F-PARKADE-VENT"]),
  redundancy("RG-APT-FIRE", "Fire alarm, sprinklers and emergency lighting", "APT-FIRE-PROTECTION", ["F-APT-FIRE", "F-APT-EGRESS", "F-FIRE-ALARM", "F-EMERGENCY-LIGHTING", "F-SPRINKLERS"]),
  redundancy("RG-APT-WATER", "Building water entry and risers", "APT-WATER-ENTRY", ["F-APT-WATER-ENTRY", "F-APT-DOMESTIC-WATER"]),
  redundancy("RG-APT-ELEC", "House electrical service", "APT-ELEC-SERVICE", ["F-APT-ELEC-SERVICE", "F-HOUSE-SWITCHBOARD"]),
];

export const apartmentBuildingReferenceModel: SystemReferenceModel = {
  schemaVersion: "0.1.0",
  code: "SRM-APARTMENT-BUILDING",
  name: "Apartment building common-areas reference model",
  industryPack: "buildings_infrastructure",
  description:
    "Shared systems of a low-rise apartment building: parkade drainage, ventilation and access, building fire alarm, emergency lighting and sprinklers, security, water entry, house electrical service, elevators and envelope. Suites are planned with the residential dwelling model. Draft; no intervals, set points or limits are implied.",
  sources: [
    "National Building Code of Canada and National Fire Code of Canada (requirement categories)",
    "CAN/ULC-S536 (inspection and testing of fire alarm systems)",
    "Canadian Electrical Code Part I (CSA C22.1)",
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
