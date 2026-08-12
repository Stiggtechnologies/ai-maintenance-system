/**
 * Reading failure mechanisms out of change-out symptom text.
 *
 * WHY THIS IS WORTH DOING AT ALL.
 *
 * The register's `actual_failure_mode` duplicates `system_group` in all 8,504
 * coded rows, so it carries no mechanism information. The change-out
 * spreadsheets do: "duo cone seal is leaking", "HARD FAILURE OF TIMING GEAR
 * TRAIN", "BROKEN PINION TEETH AND BROKEN BOLT IN DIFF HOUSING". That is the
 * only real mechanism evidence in the system, and it is free text written by
 * whoever closed the job.
 *
 * THE DISTINCTION THAT DOES THE WORK.
 *
 * Most of this text is NOT a failure mode. "High Hours", "Unit Retired", "UNIT
 * REBUILD AT KRAMER FEB 2009", "THE RIGHT SIDE IS HOURED OUT" — these explain
 * why a component came off, and none of them describes how anything failed.
 * Coding them as mechanisms would fill a template with administrative noise and
 * make the taxonomy useless, which is exactly how failure-mode fields end up
 * duplicating the component name in the first place.
 *
 * So the classifier's first job is to REFUSE most of its input. It separates:
 *
 *   mechanism      — the text describes a physical failure. Codeable.
 *   administrative — the text explains a planned or commercial removal.
 *   unclassified   — the text says something, and this cannot tell what.
 *                    Surfaced for a person, never guessed at.
 *
 * A symptom that reaches "unclassified" is not a failure of the data. It is the
 * classifier declining to turn a sentence it does not understand into a
 * taxonomy entry somebody will later trust.
 *
 * Pure functions. No database, no network.
 */

export type SymptomClass = "mechanism" | "administrative" | "unclassified";

export interface MechanismFamily {
  code: string;
  label: string;
  /** Lower-cased substrings that indicate this mechanism. */
  markers: string[];
  detectableBy: string[];
}

/**
 * Families are deliberately coarse. A finer taxonomy invented from this much
 * text would imply a precision the evidence does not carry — 30 failures across
 * eight components is enough to say "these leak and those fracture", not enough
 * to separate fatigue cracking from overload cracking.
 */
export const MECHANISM_FAMILIES: MechanismFamily[] = [
  {
    code: "LEAK",
    label: "Loss of containment (seal or joint leak)",
    markers: ["leak", "leaking", "weeping", "seepage", "duo cone", "duo-cone"],
    detectableBy: ["visual inspection", "fluid level", "ground spotting"],
  },
  {
    code: "FRACTURE",
    label: "Fracture or breakage",
    markers: [
      "broken",
      "broke",
      "cracked",
      "crack",
      "snapped",
      "fractured",
      "bent",
    ],
    detectableBy: [
      "visual inspection",
      "sudden loss of function",
      "debris in oil",
    ],
  },
  {
    code: "CONTAMINATION",
    label: "Lubricant or system contamination",
    markers: ["contaminat", "dusted", "metal in", "pieces of metal", "debris"],
    detectableBy: [
      "oil sampling — wear metals",
      "filter inspection",
      "magnetic plug",
    ],
  },
  {
    code: "SEIZURE",
    label: "Seizure or binding",
    markers: ["seiz", "siez", "locked up", "would not turn", "stuck"],
    detectableBy: ["temperature", "loss of rotation", "current draw"],
  },
  {
    code: "NOISE",
    label: "Abnormal noise or vibration",
    markers: ["knock", "noisy", "noise", "grinding", "whin", "rattl", "vibrat"],
    detectableBy: ["operator report", "vibration analysis", "listening"],
  },
  {
    code: "PERFORMANCE_LOSS",
    label: "Loss of performance or function",
    markers: [
      "stall",
      "low pressure",
      "bypassing",
      "back firing",
      "backfiring",
      "will not",
      "wont",
      "won't",
      "loss of power",
      "no power",
      "overheat",
    ],
    detectableBy: ["pressure test", "operator report", "function check"],
  },
  {
    code: "WEAR",
    label: "Wear beyond limit",
    markers: ["worn", "wear", "out of spec", "below limit", "thin"],
    detectableBy: ["dimensional measurement", "wear gauge"],
  },
];

/**
 * Text that explains a REMOVAL rather than a FAILURE. Checked before mechanism
 * markers, because "hours" phrasing frequently sits alongside words like
 * "done" that could otherwise trip a marker.
 */
const ADMINISTRATIVE_MARKERS = [
  "high hour",
  "high hours",
  "houred out",
  "hour out",
  "unit retired",
  "retired",
  "unit rebuild",
  "rebuilt by",
  "being rebuilt",
  "rebuild at",
  "scheduled",
  "warranty",
  "will be claim",
  "to be done at",
  "life expired",
  "pm replacement",
];

export interface SymptomCoding {
  raw: string;
  classification: SymptomClass;
  /** Mechanism family codes matched. Multiple is normal and meaningful. */
  mechanisms: string[];
  reason: string;
}

const clean = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function codeSymptom(raw: string | null | undefined): SymptomCoding {
  if (!raw || raw.trim() === "") {
    return {
      raw: raw ?? "",
      classification: "unclassified",
      mechanisms: [],
      reason:
        "No symptom text. The event is real; the mechanism is simply not recorded, which is different from there being no mechanism.",
    };
  }

  const text = clean(raw);

  const admin = ADMINISTRATIVE_MARKERS.filter((m) => text.includes(m));
  const matched = MECHANISM_FAMILIES.filter((f) =>
    f.markers.some((m) => text.includes(m)),
  );

  // Both present is common and informative: "THE RIGHT SIDE IS HOURED OUT AND
  // IS TO BE DONE AT THIS TIME" alongside a genuine leak. The mechanism wins,
  // because a component that leaked is evidence about failure regardless of
  // what prompted the removal.
  if (matched.length > 0) {
    return {
      raw,
      classification: "mechanism",
      mechanisms: matched.map((f) => f.code),
      reason:
        `Coded as ${matched.map((f) => f.label).join(" + ")}.` +
        (admin.length > 0
          ? ` The text also records an administrative reason (${admin[0]}), but a described physical failure is evidence about failure whatever prompted the removal.`
          : ""),
    };
  }

  if (admin.length > 0) {
    return {
      raw,
      classification: "administrative",
      mechanisms: [],
      reason: `Explains a removal, not a failure ("${admin[0]}"). Excluded from the failure-mode taxonomy: coding it would fill the taxonomy with reasons for planned work, which is how a failure-mode field ends up meaning nothing.`,
    };
  }

  return {
    raw,
    classification: "unclassified",
    mechanisms: [],
    reason: `No mechanism marker and no administrative marker matched. Surfaced for a person rather than guessed at — turning a sentence this cannot read into a taxonomy entry is how unreliable codes get created.`,
  };
}

export interface CandidateFailureMode {
  code: string;
  label: string;
  componentCode: string;
  detectableBy: string[];
  /** Events supporting this mode. */
  evidenceCount: number;
  /** Verbatim symptoms, so a reviewer checks the source not the label. */
  examples: string[];
  reason: string;
}

export interface ComponentCodingResult {
  component: string;
  totalSymptoms: number;
  mechanismCount: number;
  administrativeCount: number;
  unclassified: string[];
  candidateModes: CandidateFailureMode[];
  reason: string;
}

export function deriveFailureModes(
  component: string,
  componentCode: string,
  symptoms: string[],
): ComponentCodingResult {
  const coded = symptoms.map(codeSymptom);
  const mechanism = coded.filter((c) => c.classification === "mechanism");
  const admin = coded.filter((c) => c.classification === "administrative");
  const unclassified = coded
    .filter((c) => c.classification === "unclassified" && c.raw.trim() !== "")
    .map((c) => c.raw);

  const byFamily = new Map<string, string[]>();
  for (const c of mechanism) {
    for (const code of c.mechanisms) {
      const list = byFamily.get(code) ?? [];
      list.push(c.raw);
      byFamily.set(code, list);
    }
  }

  const candidateModes: CandidateFailureMode[] = [...byFamily.entries()]
    .map(([code, examples]) => {
      const family = MECHANISM_FAMILIES.find((f) => f.code === code)!;
      return {
        code: `${componentCode}-${code}`,
        label: family.label,
        componentCode,
        detectableBy: family.detectableBy,
        evidenceCount: examples.length,
        examples: examples.slice(0, 4),
        reason:
          `${examples.length} change-out(s) on ${component} describe this mechanism. ` +
          (examples.length === 1
            ? `One event is a mechanism that has occurred, not a rate — it belongs in the taxonomy and says nothing about how often.`
            : `Derived from this fleet's own text, so it reflects how these machines actually fail here rather than how the type fails in general.`),
      };
    })
    .sort((a, b) => b.evidenceCount - a.evidenceCount);

  return {
    component,
    totalSymptoms: symptoms.length,
    mechanismCount: mechanism.length,
    administrativeCount: admin.length,
    unclassified,
    candidateModes,
    reason:
      candidateModes.length === 0
        ? `No failure modes derivable for ${component}: ${admin.length} of ${symptoms.length} symptom(s) describe a removal rather than a failure, and ${unclassified.length} could not be read. The component has change-out history and no usable mechanism evidence.`
        : `${candidateModes.length} candidate mode(s) for ${component} from ${mechanism.length} mechanism description(s). ` +
          `${admin.length} symptom(s) were administrative — "high hours", "unit retired", "rebuilt by" — and are excluded, because coding them would fill the taxonomy with reasons for planned work. ` +
          (unclassified.length > 0
            ? `${unclassified.length} could not be read and are listed for a person rather than guessed at.`
            : `Everything else was classified.`),
  };
}
