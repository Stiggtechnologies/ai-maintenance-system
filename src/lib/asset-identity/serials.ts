/**
 * Serial number capture: validation, and what its absence costs.
 *
 * WHY A TEXT FIELD NEEDS AN ENGINE.
 *
 * "Record the serial numbers" is a yard walk, not a software feature, and it
 * will not happen because a field is empty. It happens when somebody can see
 * what the gap is costing. So the useful half of this module is not the
 * validator — it is `assessSerialGap`, which turns "0 of 144" into a list of
 * named capabilities that cannot run, and a count of machines behind each.
 *
 * WHY VALIDATION MATTERS MORE THAN IT LOOKS.
 *
 * A serial is only useful if it can be placed inside a manufacturer's published
 * range. That requires a build prefix and a sequence number. A transcription
 * like "3KR 1234" or "3kr-01234" or a plate photo transcribed as "3KRO1234"
 * (letter O for zero) will store fine and fail silently at the only moment it
 * matters — when a recall is being screened. A serial that cannot be parsed is
 * worse than a missing one, because a missing one is visibly missing.
 *
 * Pure functions. No database, no network.
 */

export type SerialVerdict = "valid" | "repairable" | "unparseable" | "absent";

export interface SerialAssessment {
  raw: string | null;
  verdict: SerialVerdict;
  /** Canonical form: uppercase, no separators. Null unless valid/repairable. */
  normalised: string | null;
  prefix: string | null;
  sequence: number | null;
  /** Corrections applied to reach `normalised`, so nothing is silent. */
  corrections: string[];
  reason: string;
}

/**
 * Characters transcribed from a worn plate that are almost always the digit,
 * not the letter. Applied ONLY inside the trailing numeric run, never to the
 * prefix, where a letter O is legitimate.
 */
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: "0",
  Q: "0",
  I: "1",
  L: "1",
  S: "5",
  B: "8",
};

export function assessSerial(raw: string | null | undefined): SerialAssessment {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return {
      raw: raw ?? null,
      verdict: "absent",
      normalised: null,
      prefix: null,
      sequence: null,
      corrections: [],
      reason:
        "No serial recorded. Visibly missing, which is the better of the two failure modes — an unparseable serial looks present and fails only when a recall is screened.",
    };
  }

  const corrections: string[] = [];
  let s = raw.trim().toUpperCase();
  if (s !== raw.trim()) corrections.push("upper-cased");

  const stripped = s.replace(/[\s\-_./]/g, "");
  if (stripped !== s) {
    corrections.push("removed separators");
    s = stripped;
  }

  // Straight parse first: a build prefix then a trailing sequence number.
  let m = s.match(/^(.*?)(\d+)$/);

  if (!m) {
    // Try lookalike repair on the tail only. A plate that reads 3KRO1234 is
    // almost certainly 3KR01234, but the prefix is left alone: letters there
    // are real.
    const repaired = s.replace(/[OQILSB]+$/g, (run) =>
      [...run].map((c) => DIGIT_LOOKALIKES[c] ?? c).join(""),
    );
    if (repaired !== s) {
      m = repaired.match(/^(.*?)(\d+)$/);
      if (m)
        corrections.push("interpreted trailing letter lookalikes as digits");
      s = repaired;
    }
  }

  if (!m) {
    return {
      raw,
      verdict: "unparseable",
      normalised: null,
      prefix: null,
      sequence: null,
      corrections,
      reason: `"${raw}" has no trailing sequence number, so it cannot be placed inside a manufacturer's published serial range. It will store, and it will fail silently at the one moment it is needed. Re-read the plate rather than accepting it.`,
    };
  }

  const prefix = m[1];
  const sequence = Number(m[2]);

  if (prefix === "") {
    return {
      raw,
      verdict: "repairable",
      normalised: s,
      prefix: "",
      sequence,
      corrections,
      reason: `"${raw}" is all digits with no build prefix. Manufacturers scope ranges within a prefix, so a bare number can be matched to the wrong build. Usable, but confirm the prefix.`,
    };
  }

  return {
    raw,
    verdict: corrections.length > 0 ? "repairable" : "valid",
    normalised: s,
    prefix,
    sequence,
    reason:
      corrections.length > 0
        ? `Parsed as prefix ${prefix} and sequence ${sequence} after ${corrections.join(", ")}. Stored corrected; the original is kept so a wrong repair can be found.`
        : `Parsed cleanly as prefix ${prefix}, sequence ${sequence}.`,
    corrections,
  };
}

/** A capability that cannot run without serials, and why. */
export interface BlockedCapability {
  key: string;
  label: string;
  severity: "safety" | "financial" | "analytical";
  whyBlocked: string;
}

export const SERIAL_DEPENDENT: BlockedCapability[] = [
  {
    key: "safety_bulletins",
    label: "Safety recall and PSP applicability",
    severity: "safety",
    whyBlocked:
      "A manufacturer scopes a recall by serial range because only some builds carry the affected part. Without a serial every machine of the model resolves to “possibly affected”, which is not a position anyone can act on and not one that closes.",
  },
  {
    key: "dealer_history",
    label: "Dealer service history reconciliation",
    severity: "analytical",
    whyBlocked:
      "The dealer keys their records on serial. Without it their work cannot be matched to your machine, and the failure history every analysis here rests on stays incomplete by an unknown amount.",
  },
  {
    key: "fluid_analysis",
    label: "Fluid analysis history",
    severity: "analytical",
    whyBlocked:
      "Sample results are filed against the machine serial. Unmatched samples become a lab report nobody can attribute.",
  },
  {
    key: "warranty",
    label: "Warranty eligibility",
    severity: "financial",
    whyBlocked:
      "Coverage is determined by serial and build date. Without it you cannot tell whether a repair you are about to pay for is already covered.",
  },
  {
    key: "improvement_programs",
    label: "Product improvement program applicability",
    severity: "financial",
    whyBlocked:
      "PIPs are serial-scoped and frequently dealer-funded. An unidentified machine simply never gets offered one.",
  },
];

export interface SerialGapAssessment {
  total: number;
  valid: number;
  repairable: number;
  unparseable: number;
  absent: number;
  /** Machines that cannot participate in any serial-keyed capability. */
  blockedMachines: number;
  blockedCapabilities: BlockedCapability[];
  /** True when every machine carries a usable serial. */
  clear: boolean;
  reason: string;
}

export function assessSerialGap(
  serials: Array<string | null>,
): SerialGapAssessment {
  const assessed = serials.map(assessSerial);
  const valid = assessed.filter((a) => a.verdict === "valid").length;
  const repairable = assessed.filter((a) => a.verdict === "repairable").length;
  const unparseable = assessed.filter(
    (a) => a.verdict === "unparseable",
  ).length;
  const absent = assessed.filter((a) => a.verdict === "absent").length;
  const blocked = absent + unparseable;

  const clear = blocked === 0;

  return {
    total: serials.length,
    valid,
    repairable,
    unparseable,
    absent,
    blockedMachines: blocked,
    // Reported whether or not anything is blocked, so the list is visible
    // before somebody has to discover it capability by capability.
    blockedCapabilities: clear ? [] : SERIAL_DEPENDENT,
    clear,
    reason: clear
      ? `All ${serials.length} machine(s) carry a usable serial${repairable > 0 ? `, ${repairable} after correction` : ""}. Every serial-keyed capability can run.`
      : `${blocked} of ${serials.length} machine(s) cannot be matched to anything a manufacturer publishes — ${absent} with no serial recorded and ${unparseable} recorded but unparseable. ` +
        `That blocks ${SERIAL_DEPENDENT.length} capabilities outright, including recall applicability, which is a safety item rather than an administrative one. ` +
        `This is not derivable: unit numbers gave us tags, and nothing in the register yields a serial. It is a yard walk or a dealer extract, and no amount of analysis substitutes for it.`,
  };
}
