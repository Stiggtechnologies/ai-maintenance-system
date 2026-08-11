/**
 * Failure modes from published engineering sources.
 *
 * These are NOT derived from any customer's data. Each carries the source it
 * came from, because a mode with no citation is indistinguishable from one
 * somebody made up — and this file exists precisely to be the researched half
 * of a template whose other half is derived.
 *
 * DELIBERATELY INCOMPLETE. Components appear here only where research found
 * something specific about how that component fails on this machine type.
 * A component with nothing published against it gets NO modes, and
 * assembleDraft leaves it empty and names it. Filling those gaps with generic
 * plausible modes — "bearing failure", "seal leak" attached to everything —
 * would produce a template that looks finished and teaches a reviewer nothing
 * about where to look.
 *
 * The structural frame follows the ISO 14224 convention of recording a failure
 * against the maintainable item that actually failed, rather than against the
 * machine.
 */
import type { FailureModeSource } from "./index";

const UNDERCARRIAGE_GUIDE =
  "https://heavyvehicleinspection.com/article/dozer-undercarriage-inspection-checklist-guide";
const CAT_UNDERCARRIAGE_PDF =
  "https://wagnerequipment.com/wp-content/uploads/2019/03/OSS-Undercarriage-Section.pdf";
const FINAL_DRIVE_SEALS =
  "https://shop.finaldriveparts.com/shop-talk-blog/final-drive-floating-face-seals/";
const FINAL_DRIVE_PROBLEMS =
  "https://heavydutyjournal.com/dozer-final-drive-problems-symptoms-diagnosis-solutions/";

/**
 * Track-type tractor. The undercarriage set is the most developed because it is
 * where this fleet's downtime actually is — 29,822 hours, more than three times
 * the next component.
 */
export const trackTypeTractorModes: FailureModeSource[] = [
  {
    code: "UC-CHAIN-PITCH",
    name: "Track chain internal wear (pin and bushing)",
    componentCode: "UNDERCARRIAGE",
    detectableBy: [
      "link pitch measured across a 4-pin span",
      "bushing outer diameter",
    ],
    source:
      "Dozer undercarriage inspection guidance — link pitch across a 4-pin span is described as the most accurate field method for internal chain wear.",
    locator: UNDERCARRIAGE_GUIDE,
  },
  {
    code: "UC-ROLLER-SEIZE",
    name: "Track roller seizure",
    componentCode: "UNDERCARRIAGE",
    detectableBy: ["flat spot on tread", "roller not turning", "heat"],
    source:
      "Undercarriage inspection guidance — a seized roller develops flat spots and shortens the life of every related part.",
    locator: UNDERCARRIAGE_GUIDE,
  },
  {
    code: "UC-ROLLER-SEAL",
    name: "Roller or idler seal loss",
    componentCode: "UNDERCARRIAGE",
    detectableBy: ["visible oil leak at roller end", "walk-around inspection"],
    source:
      "Undercarriage inspection guidance lists leaking seals alongside flat spots and seizure as the primary roller findings.",
    locator: UNDERCARRIAGE_GUIDE,
  },
  {
    code: "UC-TREAD-WEAR",
    name: "Roller and idler tread wear",
    componentCode: "UNDERCARRIAGE",
    detectableBy: ["tread diameter measurement"],
    source: "Undercarriage wear measurement practice.",
    locator: CAT_UNDERCARRIAGE_PDF,
  },
  {
    code: "UC-SPROCKET",
    name: "Sprocket tooth profile wear",
    componentCode: "UNDERCARRIAGE",
    detectableBy: ["tooth profile gauge", "visual hooking of teeth"],
    source: "Undercarriage wear measurement practice.",
    locator: CAT_UNDERCARRIAGE_PDF,
  },
  {
    code: "UC-GROUSER",
    name: "Grouser (shoe) height loss",
    componentCode: "UNDERCARRIAGE",
    detectableBy: ["grouser height measurement", "loss of traction"],
    source: "Undercarriage wear measurement practice.",
    locator: CAT_UNDERCARRIAGE_PDF,
  },
  {
    code: "UC-TENSION",
    name: "Excessive track tension accelerating whole-system wear",
    componentCode: "UNDERCARRIAGE",
    detectableBy: ["track sag measurement", "wear rate trending high"],
    // This one is worth flagging to a reviewer: it is an operating condition
    // that damages every other component rather than a component failure, and
    // published guidance puts it first by a wide margin.
    source:
      "Caterpillar is cited as naming tight track the number-one cause of crawler-tractor downtime, with correct tension preventing an estimated 85% of undercarriage wear problems.",
    locator: UNDERCARRIAGE_GUIDE,
  },
  {
    code: "UC-IDLER-ALIGN",
    name: "Idler-to-roller height loss causing improper track engagement",
    componentCode: "UNDERCARRIAGE",
    detectableBy: ["idler and roller relative height", "abnormal track noise"],
    source:
      "Undercarriage wear reduces the distance between lower roller tread and idler periphery until the idler engages the track improperly and disrupts roller engagement.",
    locator:
      "https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8870305",
  },

  {
    code: "FD-SEAL",
    name: "Duo-cone / floating face seal failure",
    componentCode: "FINAL-DRIVE-GROUP",
    detectableBy: ["oil leak at final drive housing", "oil level drop"],
    source:
      "Final drive service literature attributes 40–50% of final drive problems to seal failure, with contamination destroying bearings and gears within hours of continued operation.",
    locator: FINAL_DRIVE_SEALS,
  },
  {
    code: "FD-BEARING-CONTAM",
    name: "Bearing failure following lubricant contamination",
    componentCode: "FINAL-DRIVE-GROUP",
    detectableBy: ["oil sampling — wear metals", "grinding or whining noise"],
    source:
      "Final drive service literature: wear liberates metal particles that contaminate the gear oil and accelerate further wear.",
    locator: FINAL_DRIVE_PROBLEMS,
  },
  {
    code: "FD-GEAR-WEAR",
    name: "Planetary gear tooth wear",
    componentCode: "FINAL-DRIVE-GROUP",
    detectableBy: ["oil sampling", "noise under load", "backlash check"],
    source: "Final drive failure symptom guidance.",
    locator: FINAL_DRIVE_PROBLEMS,
  },
];

/**
 * Motor grader. Deliberately thin: research for this session concentrated on
 * the dozer, which carries the larger share of the fleet. The circle, drawbar
 * and moldboard group is where a grader's characteristic wear is, and this file
 * says so without pretending to have sourced it.
 */
export const motorGraderModes: FailureModeSource[] = [
  {
    code: "FD-SEAL",
    name: "Duo-cone / floating face seal failure",
    componentCode: "FINAL-DRIVE-GROUP",
    detectableBy: ["oil leak at final drive housing", "oil level drop"],
    source:
      "Final drive service literature — the same seal arrangement is used across tracked and wheeled machines.",
    locator: FINAL_DRIVE_SEALS,
  },
];
