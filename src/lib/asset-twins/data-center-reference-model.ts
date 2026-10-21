import type { SystemFunction, SystemNode, SystemReferenceModel } from "./system-model";

/**
 * Data centre system reference model (draft).
 *
 * The whole facility, system by system, down to equipment units and, where no
 * asset-class template exists yet, the maintainable items still to be
 * modelled. Equipment units bound to a template inherit its components and
 * failure modes from that template; they are not repeated here.
 *
 * Structure follows the functional breakdown used by EN 50600 and TIA-942
 * (power, environmental control, fire, security, monitoring, spaces) and the
 * ISO 14224 taxonomy for equipment levels. Redundancy schemes and every
 * performance standard are site-declared; nothing here claims a tier rating.
 */

const fn = (
  code: string,
  statement: string,
  critical: boolean,
  functionalFailures: string[],
): SystemFunction => ({ code, statement, critical, functionalFailures, performanceStandard: "site_specified" });

const loss = (what: string, extra: string[] = []) => [`total loss of ${what}`, `degraded ${what}`, ...extra];

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
  // ── Electrical power ────────────────────────────────────────────────────
  system("DC-ELEC", "Electrical power system", [
    fn("F-ELEC", "deliver continuous power to the critical IT and mechanical loads", true, loss("critical power", ["power quality outside load tolerance"])),
  ]),
  subsystem("DC-ELEC-UTILITY", "Utility service and medium-voltage distribution", "DC-ELEC", [
    fn("F-UTIL-SUPPLY", "receive and distribute utility power to the facility", true, loss("utility supply")),
  ]),
  equipment("DC-MV-SWITCHGEAR", "Medium-voltage switchgear and protection relays", "DC-ELEC-UTILITY", [
    fn("F-MV-SWITCH", "switch and protect medium-voltage feeders", true, loss("feeder switching", ["failure to clear a fault", "nuisance trip"])),
  ], { template: "CRIT-MV-SWITCHGEAR" }),
  equipment("DC-MV-TRANSFORMER", "Step-down power transformer", "DC-ELEC-UTILITY", [
    fn("F-TRANSFORM", "step medium voltage down to facility distribution voltage", true, loss("transformation", ["insulation breakdown"])),
  ], { template: "CRIT-POWER-TRANSFORMER" }),

  subsystem("DC-ELEC-GENERATION", "Standby generation", "DC-ELEC", [
    fn("F-GEN-SUPPLY", "supply facility power when utility power is lost", true, loss("standby supply", ["failure to start", "failure to accept load"])),
  ]),
  equipment("DC-GENERATOR", "Standby generator set", "DC-ELEC-GENERATION", [
    fn("F-GENSET", "start, reach rated output and carry load on utility loss", true, loss("generation", ["failure to start", "failure to run"])),
  ], { template: "CRIT-STANDBY-GENERATOR" }),
  equipment("DC-PARALLELING-GEAR", "Generator paralleling switchgear and controls", "DC-ELEC-GENERATION", [
    fn("F-PARALLEL", "synchronise generators and share load between them", true, loss("paralleling", ["failure to synchronise", "load-share instability"])),
  ], { template: "CRIT-PARALLELING-SWITCHGEAR" }),
  equipment("DC-FUEL-SYSTEM", "Fuel storage, transfer and polishing", "DC-ELEC-GENERATION", [
    fn("F-FUEL", "store and deliver clean fuel to the generators", true, loss("fuel delivery", ["fuel contamination"])),
  ], { template: "CRIT-FUEL-SYSTEM" }),

  subsystem("DC-ELEC-TRANSFER", "Transfer and switching", "DC-ELEC", [
    fn("F-TRANSFER", "select a healthy source for each load path", true, loss("source selection", ["transfer to a failed source"])),
  ]),
  equipment("DC-ATS", "Automatic transfer switch", "DC-ELEC-TRANSFER", [
    fn("F-ATS", "transfer load between utility and generator sources", true, loss("automatic transfer", ["failure to transfer", "failure to retransfer"])),
  ], { template: "CRIT-TRANSFER-SWITCH" }),
  equipment("DC-STS", "Static transfer switch", "DC-ELEC-TRANSFER", [
    fn("F-STS", "transfer single-corded loads between two UPS sources without interruption", true, loss("static transfer", ["unwanted transfer", "failure to transfer"])),
  ], { template: "CRIT-STATIC-TRANSFER-SWITCH" }),

  subsystem("DC-ELEC-UPS", "Uninterruptible power and energy storage", "DC-ELEC", [
    fn("F-UPS-SUB", "carry critical load without interruption through source loss and transfer", true, loss("ride-through")),
  ]),
  equipment("DC-UPS", "Static UPS with battery", "DC-ELEC-UPS", [
    fn("F-UPS", "condition power and carry the critical load from stored energy", true, loss("conditioned power", ["forced bypass"])),
  ], { template: "CRIT-UPS-SYSTEM" }),
  equipment("DC-BESS", "Lithium-ion battery energy storage cabinets", "DC-ELEC-UPS", [
    fn("F-BESS", "store and release energy for UPS ride-through", true, loss("stored energy", ["thermal runaway"])),
  ], { template: "CRIT-BESS" }),
  equipment("DC-ROTARY-UPS", "Flywheel or rotary UPS", "DC-ELEC-UPS", [
    fn("F-ROTARY", "bridge the gap between source loss and generator pickup from kinetic energy", true, loss("kinetic ride-through")),
  ], { template: "CRIT-ROTARY-UPS" }),

  subsystem("DC-ELEC-DISTRIBUTION", "Low-voltage and critical power distribution", "DC-ELEC", [
    fn("F-DIST", "distribute power from sources to each rack and mechanical load", true, loss("distribution path")),
  ]),
  equipment("DC-LV-SWITCHBOARD", "Low-voltage main switchboard", "DC-ELEC-DISTRIBUTION", [
    fn("F-LV-SWITCH", "distribute and protect low-voltage feeders", true, loss("LV distribution", ["failure to clear a fault"])),
  ], { template: "CRIT-LV-SWITCHBOARD" }),
  equipment("DC-PDU", "Power distribution unit (floor-standing)", "DC-ELEC-DISTRIBUTION", [
    fn("F-PDU", "transform and distribute power to rack circuits", true, loss("rack circuit power")),
  ], { template: "CRIT-PDU" }),
  equipment("DC-RPP", "Remote power panel", "DC-ELEC-DISTRIBUTION", [
    fn("F-RPP", "distribute branch circuits close to the racks", true, loss("branch circuits")),
  ], { template: "CRIT-PDU" }),
  equipment("DC-BUSWAY", "Overhead busway and tap-off units", "DC-ELEC-DISTRIBUTION", [
    fn("F-BUSWAY", "carry power along rack rows with plug-in tap-offs", true, loss("row power", ["joint overheating"])),
  ], { template: "CRIT-BUSWAY" }),
  equipment("DC-RACK-PDU", "Rack power strip", "DC-ELEC-DISTRIBUTION", [
    fn("F-RACK-PDU", "deliver power to each IT device in the rack", true, loss("outlet power")),
  ], { maintainableItems: ["outlets", "circuit protection", "metering and network card", "inlet cords"] }),

  subsystem("DC-ELEC-EARTHING", "Earthing, bonding and lightning protection", "DC-ELEC", [
    fn("F-EARTH", "provide a safe fault path and protect against lightning and surges", true, loss("earthing integrity", ["high earth resistance"])),
  ]),
  equipment("DC-EARTHING-SYSTEM", "Earthing grid, bonding network and lightning protection", "DC-ELEC-EARTHING", [
    fn("F-EARTH-GRID", "bond equipment and dissipate fault and lightning current", true, loss("bonding", ["broken bond"])),
  ], { maintainableItems: ["earth electrodes and grid", "main earthing bar", "bonding conductors", "signal reference grid", "air terminals and down conductors", "surge protective devices"] }),

  // ── Mechanical cooling ──────────────────────────────────────────────────
  system("DC-MECH", "Mechanical cooling system", [
    fn("F-MECH", "remove heat from the IT space and keep it within the site's environmental envelope", true, loss("cooling", ["humidity outside envelope"])),
  ]),
  subsystem("DC-MECH-PLANT", "Chilled-water plant and heat rejection", "DC-MECH", [
    fn("F-CHW-PLANT", "produce chilled water and reject heat to atmosphere", true, loss("chilled-water production")),
  ]),
  equipment("DC-CHILLER", "Chiller", "DC-MECH-PLANT", [
    fn("F-CHILLER", "produce chilled water", true, loss("chilled water", ["failure to restart after power loss"])),
  ], { template: "CRIT-CHILLER" }),
  equipment("DC-CHW-PUMP", "Chilled-water and condenser-water pumps", "DC-MECH-PLANT", [
    fn("F-CHW-PUMP", "circulate chilled and condenser water", true, loss("water circulation")),
  ], { template: "ROT-CENT-PUMP" }),
  equipment("DC-COOLING-TOWER", "Cooling tower", "DC-MECH-PLANT", [
    fn("F-TOWER", "reject condenser heat to atmosphere by evaporation", true, loss("heat rejection", ["biological contamination"])),
  ], { template: "CRIT-COOLING-TOWER" }),
  equipment("DC-DRY-COOLER", "Dry cooler or adiabatic cooler", "DC-MECH-PLANT", [
    fn("F-DRY-COOLER", "reject heat to air without (or with limited) evaporation", true, loss("heat rejection")),
  ], { maintainableItems: ["coil", "fans and EC motors", "adiabatic pads and sprays", "controls"] }),
  equipment("DC-THERMAL-STORAGE", "Chilled-water thermal storage tank", "DC-MECH-PLANT", [
    fn("F-TES", "carry cooling through chiller restart after a power event", true, loss("stored cooling")),
  ], { maintainableItems: ["tank and insulation", "diffusers", "isolation valves", "temperature stratification sensors"] }),
  equipment("DC-WATER-TREATMENT", "Water treatment and make-up water", "DC-MECH-PLANT", [
    fn("F-WATER", "supply and treat make-up water for heat rejection", true, loss("make-up water", ["scaling or corrosion", "legionella risk"])),
  ], { maintainableItems: ["make-up storage", "dosing pumps", "conductivity and chemistry sensors", "side-stream filters", "blowdown valves", "backflow preventers"] }),
  equipment("DC-CHW-DISTRIBUTION", "Chilled-water piping, valves and heat exchangers", "DC-MECH-PLANT", [
    fn("F-CHW-DIST", "deliver chilled water to air and liquid cooling units", true, loss("chilled-water delivery", ["leak into IT space"])),
  ], { maintainableItems: ["piping and insulation", "isolation and control valves", "plate heat exchangers (economiser)", "expansion and pressurisation", "air separators", "strainers"] }),

  subsystem("DC-MECH-AIR", "Air-side cooling and environmental control", "DC-MECH", [
    fn("F-AIR", "deliver cool air to IT intakes and return hot air", true, loss("air delivery", ["hot-air recirculation"])),
  ]),
  equipment("DC-CRAH", "Computer room air handler (chilled water)", "DC-MECH-AIR", [
    fn("F-CRAH", "cool and move air through the IT space", true, loss("air cooling")),
  ], { template: "CRIT-CRAH" }),
  equipment("DC-CRAC", "Computer room air conditioner (direct expansion)", "DC-MECH-AIR", [
    fn("F-CRAC", "cool air with its own refrigeration circuit", true, loss("air cooling")),
  ], { template: "CRIT-CRAC" }),
  equipment("DC-AHU-ECONOMISER", "Air handling unit with economiser or evaporative cooling", "DC-MECH-AIR", [
    fn("F-AHU", "cool the IT space with outside air or evaporative cooling when conditions allow", true, loss("air cooling", ["contaminated or wet air admitted"])),
  ], { maintainableItems: ["dampers and actuators", "filters", "fans", "evaporative media", "heat wheel or plate exchanger", "controls"] }),
  equipment("DC-HUMIDITY", "Humidification and dehumidification", "DC-MECH-AIR", [
    fn("F-HUMIDITY", "keep moisture within the site's envelope", false, loss("humidity control", ["condensation"])),
  ], { maintainableItems: ["humidifier (steam, ultrasonic or adiabatic)", "water supply", "dehumidification coil", "humidity sensors"] }),
  equipment("DC-CONTAINMENT", "Hot- or cold-aisle containment", "DC-MECH-AIR", [
    fn("F-CONTAIN", "separate supply and return air streams", false, loss("air separation", ["recirculation through gaps"])),
  ], { maintainableItems: ["aisle doors", "roof panels", "blanking panels", "floor grommets and brush strips", "fire-release mechanisms"] }),

  subsystem("DC-MECH-LIQUID", "Liquid cooling", "DC-MECH", [
    fn("F-LIQUID", "remove heat directly from high-density IT equipment", true, loss("liquid cooling", ["leak at IT equipment"])),
  ]),
  equipment("DC-CDU", "Coolant distribution unit", "DC-MECH-LIQUID", [
    fn("F-CDU", "circulate and condition technology coolant and exchange heat with facility water", true, loss("coolant flow", ["coolant contamination"])),
  ], { template: "CRIT-CDU" }),
  equipment("DC-DLC-MANIFOLD", "Direct-to-chip manifolds and cold plates", "DC-MECH-LIQUID", [
    fn("F-DLC", "carry coolant to and from processor cold plates", true, loss("cold-plate flow", ["leak at quick-disconnect"])),
  ], { maintainableItems: ["rack manifolds", "quick-disconnect couplings", "hoses", "cold plates", "leak detection"] }),
  equipment("DC-RDHX", "Rear-door heat exchanger", "DC-MECH-LIQUID", [
    fn("F-RDHX", "remove rack exhaust heat at the rack door", true, loss("rack heat removal")),
  ], { template: "CRIT-RDHX" }),
  equipment("DC-IMMERSION", "Immersion cooling tank", "DC-MECH-LIQUID", [
    fn("F-IMMERSION", "cool submerged IT equipment in dielectric fluid", true, loss("immersion cooling", ["fluid degradation"])),
  ], { maintainableItems: ["tank", "dielectric fluid", "pumps", "heat exchanger", "filters", "level and temperature sensors"] }),

  // ── Fire and life safety ────────────────────────────────────────────────
  system("DC-FLS", "Fire and life safety system", [
    fn("F-FLS", "detect, alarm and suppress fire while protecting people and equipment", true, loss("fire protection", ["unwanted discharge"])),
  ]),
  subsystem("DC-FLS-DETECTION", "Detection and alarm", "DC-FLS", [
    fn("F-DETECT", "detect smoke, heat and leaks early and raise alarms", true, loss("detection", ["false alarm"])),
  ]),
  equipment("DC-FIRE-ALARM", "Fire alarm control panel and devices", "DC-FLS-DETECTION", [
    fn("F-FACP", "monitor detectors and initiate alarm and release sequences", true, loss("alarm initiation", ["false alarm"])),
  ], { template: "CRIT-FIRE-DETECTION" }),
  equipment("DC-VESDA", "Aspirating smoke detection", "DC-FLS-DETECTION", [
    fn("F-VESDA", "sample air for very early smoke detection", true, loss("early detection", ["pipe blockage"])),
  ], { template: "CRIT-FIRE-DETECTION" }),
  equipment("DC-LEAK-DETECTION", "Water and coolant leak detection", "DC-FLS-DETECTION", [
    fn("F-LEAK", "detect water or coolant where it should not be", true, loss("leak detection")),
  ], { maintainableItems: ["sensing cable", "spot sensors", "controller", "interface to BMS"] }),
  subsystem("DC-FLS-SUPPRESSION", "Suppression", "DC-FLS", [
    fn("F-SUPPRESS", "suppress fire in the protected space", true, loss("suppression", ["unwanted discharge"])),
  ]),
  equipment("DC-CLEAN-AGENT", "Clean-agent suppression", "DC-FLS-SUPPRESSION", [
    fn("F-CLEAN-AGENT", "discharge clean agent to suppress fire without damaging IT", true, loss("agent discharge", ["loss of agent", "room integrity failure"])),
  ], { template: "CRIT-CLEAN-AGENT" }),
  equipment("DC-PREACTION", "Pre-action sprinkler system", "DC-FLS-SUPPRESSION", [
    fn("F-PREACTION", "admit water only after detection and a sprinkler operating", true, loss("sprinkler protection", ["unwanted water admission", "corrosion leak"])),
  ], { template: "CRIT-PREACTION" }),
  equipment("DC-WATER-MIST", "Water-mist suppression", "DC-FLS-SUPPRESSION", [
    fn("F-MIST", "suppress fire with fine water spray", true, loss("mist protection")),
  ], { maintainableItems: ["pump unit", "nozzles", "piping", "section valves", "controls"] }),
  subsystem("DC-FLS-EMERGENCY", "Emergency power off and life safety", "DC-FLS", [
    fn("F-EMERGENCY", "let people isolate power and leave safely", true, loss("emergency isolation", ["inadvertent power off"])),
  ]),
  equipment("DC-EPO", "Emergency power off", "DC-FLS-EMERGENCY", [
    fn("F-EPO", "isolate IT-space power on deliberate operation only", true, loss("emergency isolation", ["inadvertent operation"])),
  ], { template: "CRIT-EPO" }),
  equipment("DC-EMERGENCY-LIGHTING", "Emergency lighting and egress", "DC-FLS-EMERGENCY", [
    fn("F-EGRESS", "light escape routes when normal lighting fails", true, loss("egress lighting")),
  ], { maintainableItems: ["luminaires", "batteries or central system", "exit signs", "test system"] }),

  // ── Monitoring and controls ─────────────────────────────────────────────
  system("DC-CONTROLS", "Monitoring and control system", [
    fn("F-CONTROLS", "control facility plant and make its state visible to operators", true, loss("visibility and control", ["incorrect control action"])),
  ]),
  subsystem("DC-CONTROLS-PLATFORMS", "Control and monitoring platforms", "DC-CONTROLS", [
    fn("F-CONTROL-PLATFORMS", "run plant control sequences and collect telemetry", true, loss("control and telemetry")),
  ]),
  equipment("DC-BMS", "Building management system", "DC-CONTROLS-PLATFORMS", [
    fn("F-BMS", "control and monitor mechanical plant", true, loss("plant control", ["stale or wrong data"])),
  ], { template: "CRIT-BMS" }),
  equipment("DC-EPMS", "Electrical power monitoring system", "DC-CONTROLS-PLATFORMS", [
    fn("F-EPMS", "monitor electrical state, events and power quality", false, loss("electrical visibility", ["missed event capture"])),
  ], { template: "CRIT-EPMS" }),
  equipment("DC-DCIM", "Data centre infrastructure management", "DC-CONTROLS-PLATFORMS", [
    fn("F-DCIM", "track capacity, assets and rack-level conditions", false, loss("capacity visibility", ["inaccurate asset records"])),
  ], { maintainableItems: ["DCIM software", "rack sensors", "integrations", "asset database"] }),
  equipment("DC-OT-NETWORK", "Facility controls network", "DC-CONTROLS-PLATFORMS", [
    fn("F-OT-NET", "carry control and monitoring traffic securely", true, loss("controls communication", ["unauthorised access"])),
  ], { maintainableItems: ["switches", "firewalls", "fibre and cabling", "time servers", "redundant paths"] }),

  // ── Security ────────────────────────────────────────────────────────────
  system("DC-SECURITY", "Physical security system", [
    fn("F-SECURITY", "control who enters and record what happens on site", false, loss("physical security")),
  ]),
  subsystem("DC-SECURITY-ACCESS", "Access control and surveillance", "DC-SECURITY", [
    fn("F-ACCESS", "admit authorised people only and record events", false, loss("access control", ["unauthorised entry"])),
  ]),
  equipment("DC-ACCESS-CONTROL", "Access control", "DC-SECURITY-ACCESS", [
    fn("F-ACS", "authenticate and admit authorised people", false, loss("entry control", ["door held or forced"])),
  ], { maintainableItems: ["readers and biometrics", "door controllers", "locks and door hardware", "mantraps", "server"] }),
  equipment("DC-CCTV", "Video surveillance", "DC-SECURITY-ACCESS", [
    fn("F-CCTV", "record and display site video", false, loss("video coverage")),
  ], { maintainableItems: ["cameras", "recorders and storage", "network", "monitoring station"] }),

  // ── IT spaces (the critical load and its housing) ───────────────────────
  system("DC-WHITE-SPACE", "IT space (white space)", [
    fn("F-WHITE-SPACE", "house and support IT equipment", true, loss("IT hosting")),
  ]),
  subsystem("DC-WHITE-SPACE-ROOM", "Data hall", "DC-WHITE-SPACE", [
    fn("F-DATA-HALL", "provide space, structure and pathways for IT equipment", true, loss("hosting environment")),
  ]),
  equipment("DC-IT-LOAD", "IT load (racks and installed equipment)", "DC-WHITE-SPACE-ROOM", [
    fn("F-IT-LOAD", "run customer IT workloads", true, loss("IT service")),
  ], { maintainableItems: ["cabinets and racks", "blanking panels", "cable management", "rack doors and locks", "rack sensors"] }),
  equipment("DC-RAISED-FLOOR", "Raised floor and overhead pathways", "DC-WHITE-SPACE-ROOM", [
    fn("F-PATHWAYS", "carry cabling and, where used, supply air", false, loss("pathway support", ["floor-tile air leakage"])),
  ], { maintainableItems: ["floor pedestals and tiles", "perforated tiles", "cable trays and ladders", "fibre pathways"] }),
];

/** Topology: who supplies, cools, backs up, protects, controls and monitors whom. */
const edges: SystemReferenceModel["edges"] = [
  { from: "DC-MV-SWITCHGEAR", relation: "supplies_power_to", to: "DC-MV-TRANSFORMER" },
  { from: "DC-MV-TRANSFORMER", relation: "supplies_power_to", to: "DC-ATS" },
  { from: "DC-GENERATOR", relation: "supplies_power_to", to: "DC-PARALLELING-GEAR" },
  { from: "DC-PARALLELING-GEAR", relation: "supplies_power_to", to: "DC-ATS" },
  { from: "DC-GENERATOR", relation: "backs_up", to: "DC-ELEC-UTILITY" },
  { from: "DC-FUEL-SYSTEM", relation: "supplies_fuel_to", to: "DC-GENERATOR" },
  { from: "DC-ATS", relation: "supplies_power_to", to: "DC-LV-SWITCHBOARD" },
  { from: "DC-LV-SWITCHBOARD", relation: "supplies_power_to", to: "DC-UPS" },
  { from: "DC-LV-SWITCHBOARD", relation: "supplies_power_to", to: "DC-CHILLER" },
  { from: "DC-LV-SWITCHBOARD", relation: "supplies_power_to", to: "DC-CHW-PUMP" },
  { from: "DC-LV-SWITCHBOARD", relation: "supplies_power_to", to: "DC-COOLING-TOWER" },
  { from: "DC-BESS", relation: "supplies_power_to", to: "DC-UPS" },
  { from: "DC-ROTARY-UPS", relation: "backs_up", to: "DC-UPS" },
  { from: "DC-UPS", relation: "supplies_power_to", to: "DC-STS" },
  { from: "DC-UPS", relation: "supplies_power_to", to: "DC-PDU" },
  { from: "DC-UPS", relation: "supplies_power_to", to: "DC-CRAH" },
  { from: "DC-UPS", relation: "supplies_power_to", to: "DC-CDU" },
  { from: "DC-UPS", relation: "supplies_power_to", to: "DC-BMS" },
  { from: "DC-STS", relation: "supplies_power_to", to: "DC-PDU" },
  { from: "DC-PDU", relation: "supplies_power_to", to: "DC-RPP" },
  { from: "DC-PDU", relation: "supplies_power_to", to: "DC-BUSWAY" },
  { from: "DC-RPP", relation: "supplies_power_to", to: "DC-RACK-PDU" },
  { from: "DC-BUSWAY", relation: "supplies_power_to", to: "DC-RACK-PDU" },
  { from: "DC-RACK-PDU", relation: "supplies_power_to", to: "DC-IT-LOAD" },
  { from: "DC-EARTHING-SYSTEM", relation: "protects", to: "DC-ELEC" },

  { from: "DC-CHILLER", relation: "rejects_heat_to", to: "DC-COOLING-TOWER" },
  { from: "DC-CHILLER", relation: "rejects_heat_to", to: "DC-DRY-COOLER" },
  { from: "DC-WATER-TREATMENT", relation: "supplies_water_to", to: "DC-COOLING-TOWER" },
  { from: "DC-CHILLER", relation: "cools", to: "DC-CHW-DISTRIBUTION" },
  { from: "DC-THERMAL-STORAGE", relation: "backs_up", to: "DC-CHILLER" },
  { from: "DC-CHW-PUMP", relation: "supplies_water_to", to: "DC-CHW-DISTRIBUTION" },
  { from: "DC-CHW-DISTRIBUTION", relation: "cools", to: "DC-CRAH" },
  { from: "DC-CHW-DISTRIBUTION", relation: "cools", to: "DC-CDU" },
  { from: "DC-CHW-DISTRIBUTION", relation: "cools", to: "DC-RDHX" },
  { from: "DC-CRAH", relation: "cools", to: "DC-IT-LOAD" },
  { from: "DC-CRAC", relation: "cools", to: "DC-IT-LOAD" },
  { from: "DC-AHU-ECONOMISER", relation: "cools", to: "DC-IT-LOAD" },
  { from: "DC-RDHX", relation: "cools", to: "DC-IT-LOAD" },
  { from: "DC-CDU", relation: "cools", to: "DC-DLC-MANIFOLD" },
  { from: "DC-CDU", relation: "cools", to: "DC-IMMERSION" },
  { from: "DC-DLC-MANIFOLD", relation: "cools", to: "DC-IT-LOAD" },
  { from: "DC-CONTAINMENT", relation: "depends_on", to: "DC-CRAH" },
  { from: "DC-HUMIDITY", relation: "protects", to: "DC-IT-LOAD" },

  { from: "DC-FIRE-ALARM", relation: "controls", to: "DC-CLEAN-AGENT" },
  { from: "DC-FIRE-ALARM", relation: "controls", to: "DC-PREACTION" },
  { from: "DC-FIRE-ALARM", relation: "controls", to: "DC-AHU-ECONOMISER" },
  { from: "DC-VESDA", relation: "monitors", to: "DC-WHITE-SPACE-ROOM" },
  { from: "DC-VESDA", relation: "monitors", to: "DC-BESS" },
  { from: "DC-LEAK-DETECTION", relation: "monitors", to: "DC-MECH-LIQUID" },
  { from: "DC-LEAK-DETECTION", relation: "monitors", to: "DC-CHW-DISTRIBUTION" },
  { from: "DC-CLEAN-AGENT", relation: "protects", to: "DC-WHITE-SPACE-ROOM" },
  { from: "DC-PREACTION", relation: "protects", to: "DC-WHITE-SPACE-ROOM" },
  { from: "DC-WATER-MIST", relation: "protects", to: "DC-WHITE-SPACE-ROOM" },
  { from: "DC-EPO", relation: "controls", to: "DC-UPS" },
  { from: "DC-EPO", relation: "controls", to: "DC-PDU" },

  { from: "DC-BMS", relation: "controls", to: "DC-MECH" },
  { from: "DC-BMS", relation: "monitors", to: "DC-MECH" },
  { from: "DC-EPMS", relation: "monitors", to: "DC-ELEC" },
  { from: "DC-DCIM", relation: "monitors", to: "DC-WHITE-SPACE" },
  { from: "DC-BMS", relation: "depends_on", to: "DC-OT-NETWORK" },
  { from: "DC-EPMS", relation: "depends_on", to: "DC-OT-NETWORK" },
  { from: "DC-ACCESS-CONTROL", relation: "protects", to: "DC-WHITE-SPACE" },
  { from: "DC-CCTV", relation: "monitors", to: "DC-WHITE-SPACE" },
  { from: "DC-WHITE-SPACE-ROOM", relation: "houses", to: "DC-IT-LOAD" },
];

const allSchemes: SystemReferenceModel["redundancyGroups"][number]["allowedSchemes"] = [
  "N", "N+1", "N+2", "2N", "2(N+1)", "distributed_redundant", "block_redundant",
];

/** Critical functions grouped into redundancy slots the site must declare. */
const redundancy = (code: string, name: string, nodeCode: string, functionCodes: string[]) => ({
  code,
  name,
  nodeCode,
  functionCodes,
  scheme: "site_specified" as const,
  allowedSchemes: allSchemes,
});

const redundancyGroups: SystemReferenceModel["redundancyGroups"] = [
  redundancy("RG-UTILITY", "Utility feeds and MV path", "DC-ELEC-UTILITY", ["F-UTIL-SUPPLY", "F-MV-SWITCH", "F-TRANSFORM"]),
  redundancy("RG-GENERATION", "Standby generators", "DC-ELEC-GENERATION", ["F-GEN-SUPPLY", "F-GENSET", "F-PARALLEL", "F-FUEL"]),
  redundancy("RG-TRANSFER", "Transfer equipment", "DC-ELEC-TRANSFER", ["F-TRANSFER", "F-ATS", "F-STS"]),
  redundancy("RG-UPS", "UPS modules and energy storage", "DC-ELEC-UPS", ["F-UPS-SUB", "F-UPS", "F-BESS", "F-ROTARY"]),
  redundancy("RG-DISTRIBUTION", "Critical distribution paths (A/B)", "DC-ELEC-DISTRIBUTION", ["F-DIST", "F-LV-SWITCH", "F-PDU", "F-RPP", "F-BUSWAY", "F-RACK-PDU"]),
  redundancy("RG-EARTHING", "Earthing and surge protection", "DC-ELEC-EARTHING", ["F-EARTH", "F-EARTH-GRID"]),
  redundancy("RG-CHILLERS", "Chillers and stored cooling", "DC-MECH-PLANT", ["F-CHW-PLANT", "F-CHILLER", "F-TES"]),
  redundancy("RG-PUMPS", "Chilled- and condenser-water pumps", "DC-CHW-PUMP", ["F-CHW-PUMP"]),
  redundancy("RG-HEAT-REJECTION", "Cooling towers, dry coolers and make-up water", "DC-MECH-PLANT", ["F-TOWER", "F-DRY-COOLER", "F-WATER"]),
  redundancy("RG-CHW-PATH", "Chilled-water distribution paths", "DC-CHW-DISTRIBUTION", ["F-CHW-DIST"]),
  redundancy("RG-AIR", "Room cooling units", "DC-MECH-AIR", ["F-AIR", "F-CRAH", "F-CRAC", "F-AHU"]),
  redundancy("RG-LIQUID", "Coolant distribution and liquid paths", "DC-MECH-LIQUID", ["F-LIQUID", "F-CDU", "F-DLC", "F-RDHX", "F-IMMERSION"]),
  redundancy("RG-DETECTION", "Fire and leak detection", "DC-FLS-DETECTION", ["F-DETECT", "F-FACP", "F-VESDA", "F-LEAK"]),
  redundancy("RG-SUPPRESSION", "Suppression", "DC-FLS-SUPPRESSION", ["F-SUPPRESS", "F-CLEAN-AGENT", "F-PREACTION", "F-MIST"]),
  redundancy("RG-EMERGENCY", "Emergency isolation and egress", "DC-FLS-EMERGENCY", ["F-EMERGENCY", "F-EPO", "F-EGRESS"]),
  redundancy("RG-CONTROLS", "Plant controls and controls network", "DC-CONTROLS-PLATFORMS", ["F-CONTROL-PLATFORMS", "F-BMS", "F-OT-NET"]),
  redundancy("RG-IT-SPACE", "Data hall and IT hosting", "DC-WHITE-SPACE-ROOM", ["F-DATA-HALL", "F-IT-LOAD"]),
];

export const dataCenterReferenceModel: SystemReferenceModel = {
  schemaVersion: "0.1.0",
  code: "SRM-DATA-CENTER",
  name: "Data centre facility reference model",
  industryPack: "data_centers",
  description:
    "Systems, subsystems, equipment and functions of a data centre, with power, cooling, fuel, water, protection, control and monitoring topology and the redundancy groups each site must declare. Draft; no tier rating, capacities or limits are implied.",
  sources: [
    "EN 50600 (data centre facilities and infrastructures)",
    "ANSI/TIA-942 (telecommunications infrastructure standard for data centres)",
    "Uptime Institute Tier Standard: Topology (scheme vocabulary only)",
    "ISO 14224 (equipment taxonomy levels)",
    "SAE JA1011 (RCM functions and functional failures)",
    "ASHRAE TC 9.9 (thermal guidelines)",
    "NFPA 75 and NFPA 76 (fire protection of IT and telecom facilities)",
    "NFPA 110 (emergency and standby power)",
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
