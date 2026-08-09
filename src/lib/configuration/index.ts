/**
 * Configuration management analysis
 * (capability register U7.01, U7.03–U7.04, U7.06–U7.11).
 *
 * Maintenance history says what was done to an asset. It does not say what the
 * asset currently IS. This compares what engineering specified against what is
 * actually installed, and names the difference.
 *
 * THE DISTINCTION THE WHOLE MODULE IS BUILT AROUND. "No differences" and "no
 * baseline to compare against" produce the same empty list and mean opposite
 * things. Every function here returns `comparable`, and when there is nothing
 * to compare it says so instead of returning a clean result.
 *
 * A SUBSTITUTION IS NOT A DRIFT — BUT AN EXPIRED ONE IS. A part that differs
 * from the specification is reported as `substituted` and cleared when a
 * current approval covers it. When the approval has lapsed, it is reported
 * again, because an approval nobody revisited is not an approval.
 *
 * WHAT IT DOES NOT DO. It does not judge whether a difference is acceptable.
 * It reports what differs, whether the position is safety-critical, and
 * whether an approval exists. Deciding that an impeller one size down is fine
 * is an engineering call, and this module's job is to make sure that call is
 * made by someone rather than by default.
 *
 * Pure: no database, no network.
 */

export interface ConfigItem {
  positionRef: string;
  partNumber?: string | null;
  materialId?: string | null;
  description?: string | null;
  quantity: number;
  serialNumber?: string | null;
  firmwareVersion?: string | null;
  softwareVersion?: string | null;
  safetyCritical: boolean;
  safetyBasis?: string | null;
}

export interface Baseline {
  kind: "as_designed" | "as_built" | "as_maintained";
  revision: number;
  effectiveFrom?: string | null;
  sourceReference?: string | null;
  items: ConfigItem[];
}

export interface Substitution {
  specified: string;
  substitute: string;
  conditions?: string | null;
  expiresAt?: string | null;
  bidirectional?: boolean;
}

export type DifferenceKind =
  | "missing"
  | "unexpected"
  | "part_differs"
  | "quantity_differs"
  | "firmware_differs"
  | "software_differs";

export interface Difference {
  positionRef: string;
  kind: DifferenceKind;
  expected: string;
  actual: string;
  safetyCritical: boolean;
  /** A current approved substitution covers this difference. */
  approved: boolean;
  /** An approval exists but has lapsed — reported, not cleared. */
  approvalExpired: boolean;
  detail: string;
}

export interface DriftResult {
  comparable: boolean;
  differences: Difference[];
  safetyCriticalCount: number;
  unapprovedCount: number;
  reason: string;
}

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/** Dates are shown to the day: the hour an approval lapsed is noise. */
function asDate(v: string | null | undefined): string {
  if (!v) return "(no date)";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString().slice(0, 10);
}

function describe(i: ConfigItem): string {
  return i.partNumber ?? i.description ?? "(unspecified part)";
}

/**
 * Compare a designed baseline against a maintained one.
 *
 * `asOf` decides whether an approval has expired, and is passed in rather than
 * read from the clock so the result is reproducible and testable.
 */
export function compareBaselines(
  designed: Baseline | null | undefined,
  maintained: Baseline | null | undefined,
  substitutions: Substitution[] = [],
  asOf: Date = new Date(0),
): DriftResult {
  if (!designed || !maintained) {
    const missing = !designed
      ? !maintained
        ? "neither an as-designed nor an as-maintained baseline"
        : "no as-designed baseline"
      : "no current as-maintained baseline";
    return {
      comparable: false,
      differences: [],
      safetyCriticalCount: 0,
      unapprovedCount: 0,
      reason:
        `Cannot compare: there is ${missing} for this asset. That is not the same as ` +
        `finding no differences, though both produce an empty list. ` +
        (designed
          ? "A walkdown establishes what is actually installed."
          : "The as-designed baseline comes from the drawing set or the handover dossier."),
    };
  }

  const subs = new Map<string, Substitution>();
  for (const s of substitutions) {
    subs.set(`${norm(s.specified)}=>${norm(s.substitute)}`, s);
    if (s.bidirectional)
      subs.set(`${norm(s.substitute)}=>${norm(s.specified)}`, s);
  }

  const byPosition = new Map<string, ConfigItem>();
  for (const i of maintained.items) byPosition.set(norm(i.positionRef), i);

  const differences: Difference[] = [];

  for (const d of designed.items) {
    const key = norm(d.positionRef);
    const m = byPosition.get(key);
    if (!m) {
      differences.push({
        positionRef: d.positionRef,
        kind: "missing",
        expected: describe(d),
        actual: "(absent)",
        safetyCritical: d.safetyCritical,
        approved: false,
        approvalExpired: false,
        detail: `The design specifies ${describe(d)} at ${d.positionRef} and the as-maintained baseline has nothing there.`,
      });
      continue;
    }
    byPosition.delete(key);

    if (norm(describe(d)) !== norm(describe(m))) {
      const sub = subs.get(`${norm(describe(d))}=>${norm(describe(m))}`);
      const expired = sub?.expiresAt ? new Date(sub.expiresAt) < asOf : false;
      differences.push({
        positionRef: d.positionRef,
        kind: "part_differs",
        expected: describe(d),
        actual: describe(m),
        // A safety-critical position stays safety-critical even when the
        // installed item's record forgot to say so.
        safetyCritical: d.safetyCritical || m.safetyCritical,
        approved: !!sub && !expired,
        approvalExpired: expired,
        detail: sub
          ? expired
            ? `${describe(m)} is fitted where ${describe(d)} is specified. An approved substitution exists but expired on ${asDate(sub.expiresAt)}. A lapsed approval is not an approval.`
            : `${describe(m)} is fitted where ${describe(d)} is specified, under an approved substitution${sub.conditions ? ` (${sub.conditions})` : ""}.`
          : `${describe(m)} is fitted where ${describe(d)} is specified, and no approved substitution covers it.`,
      });
    }

    if (Math.abs(d.quantity - m.quantity) > 1e-9) {
      differences.push({
        positionRef: d.positionRef,
        kind: "quantity_differs",
        expected: String(d.quantity),
        actual: String(m.quantity),
        safetyCritical: d.safetyCritical || m.safetyCritical,
        approved: false,
        approvalExpired: false,
        detail: `${d.quantity} specified at ${d.positionRef}, ${m.quantity} installed.`,
      });
    }

    // Firmware is compared only where the design states one. An absent
    // expectation is silence, not a match.
    if (
      d.firmwareVersion &&
      norm(d.firmwareVersion) !== norm(m.firmwareVersion)
    ) {
      differences.push({
        positionRef: d.positionRef,
        kind: "firmware_differs",
        expected: d.firmwareVersion,
        actual: m.firmwareVersion ?? "(not recorded)",
        safetyCritical: d.safetyCritical || m.safetyCritical,
        approved: false,
        approvalExpired: false,
        detail: m.firmwareVersion
          ? `Firmware ${m.firmwareVersion} is running where ${d.firmwareVersion} is specified. Firmware changes without a work order and is invisible to a CMMS.`
          : `Firmware ${d.firmwareVersion} is specified and none is recorded as installed. Unknown is not the same as correct.`,
      });
    }
    if (
      d.softwareVersion &&
      norm(d.softwareVersion) !== norm(m.softwareVersion)
    ) {
      differences.push({
        positionRef: d.positionRef,
        kind: "software_differs",
        expected: d.softwareVersion,
        actual: m.softwareVersion ?? "(not recorded)",
        safetyCritical: d.safetyCritical || m.safetyCritical,
        approved: false,
        approvalExpired: false,
        detail: `Software ${m.softwareVersion ?? "(not recorded)"} where ${d.softwareVersion} is specified.`,
      });
    }
  }

  // Anything left is installed at a position the design does not describe.
  for (const m of byPosition.values()) {
    differences.push({
      positionRef: m.positionRef,
      kind: "unexpected",
      expected: "(not in the design)",
      actual: describe(m),
      safetyCritical: m.safetyCritical,
      approved: false,
      approvalExpired: false,
      detail: `${describe(m)} is installed at ${m.positionRef}, which the as-designed baseline does not describe. Either the design is out of date or the item should not be there.`,
    });
  }

  differences.sort(
    (a, b) =>
      Number(b.safetyCritical) - Number(a.safetyCritical) ||
      Number(a.approved) - Number(b.approved) ||
      a.positionRef.localeCompare(b.positionRef),
  );

  const safety = differences.filter((d) => d.safetyCritical).length;
  const unapproved = differences.filter((d) => !d.approved).length;

  return {
    comparable: true,
    differences,
    safetyCriticalCount: safety,
    unapprovedCount: unapproved,
    reason:
      differences.length === 0
        ? `As-maintained matches as-designed across all ${designed.items.length} recorded position(s). This is a real result: both baselines exist and were compared.`
        : `${differences.length} difference(s) between as-designed and as-maintained.` +
          (safety > 0
            ? ` ${safety} at safety-critical position(s).`
            : " None at a position marked safety-critical.") +
          (unapproved < differences.length
            ? ` ${differences.length - unapproved} covered by a current approved substitution.`
            : ""),
  };
}

export interface TempMod {
  id: number | string;
  assetName: string;
  modificationKind: string;
  description: string;
  requiredRemovalBy: string;
  installedAt: string;
  removedAt?: string | null;
  affectsSafetyFunction: boolean;
  riskAssessmentRef?: string | null;
}

export interface TempModAssessment {
  open: number;
  overdue: number;
  overdueSafety: number;
  longestOverdueDays: number;
  withoutRiskAssessment: number;
  worst: (TempMod & { daysOverdue: number })[];
  reason: string;
}

const DAY = 86_400_000;

/**
 * "Temporary" is the most dangerous word in a plant.
 *
 * This counts how far past its removal date each open modification is, and
 * says it in days rather than in a status colour. A jumper installed for a
 * week and still fitted after four years is not an amber indicator.
 */
export function assessTemporaryModifications(
  mods: TempMod[],
  asOf: Date = new Date(0),
): TempModAssessment {
  const open = mods.filter((m) => !m.removedAt);
  const withDays = open.map((m) => ({
    ...m,
    daysOverdue: Math.floor(
      (asOf.getTime() - new Date(m.requiredRemovalBy).getTime()) / DAY,
    ),
  }));
  const overdue = withDays.filter((m) => m.daysOverdue > 0);
  const overdueSafety = overdue.filter((m) => m.affectsSafetyFunction);
  const longest = overdue.reduce((mx, m) => Math.max(mx, m.daysOverdue), 0);
  const noRisk = open.filter(
    (m) => !m.riskAssessmentRef || m.riskAssessmentRef.trim() === "",
  ).length;

  overdue.sort(
    (a, b) =>
      Number(b.affectsSafetyFunction) - Number(a.affectsSafetyFunction) ||
      b.daysOverdue - a.daysOverdue,
  );

  return {
    open: open.length,
    overdue: overdue.length,
    overdueSafety: overdueSafety.length,
    longestOverdueDays: longest,
    withoutRiskAssessment: noRisk,
    worst: overdue.slice(0, 10),
    reason:
      mods.length === 0
        ? "No temporary modifications are recorded. On a plant of any size that usually means they are not being captured rather than that there are none — jumpers, bypasses and temporary repairs exist whether or not a system knows about them."
        : overdue.length === 0
          ? `${open.length} temporary modification(s) are open and all are within their removal date.`
          : `${overdue.length} of ${open.length} open temporary modification${open.length === 1 ? "" : "s"} ${overdue.length === 1 ? "is past its" : "are past their"} removal date, the oldest by ${longest} days (${(longest / 365).toFixed(1)} years).` +
            (overdueSafety.length > 0
              ? ` ${overdueSafety.length} of them ${overdueSafety.length === 1 ? "defeats" : "defeat"} a safety function.`
              : "") +
            (noRisk > 0
              ? ` ${noRisk} open modification${noRisk === 1 ? " carries" : "s carry"} no risk-assessment reference.`
              : ""),
  };
}

export interface ReconciliationStatus {
  lastPerformedAt: string | null;
  daysSince: number | null;
  trigger: string | null;
  overdue: boolean;
  reason: string;
}

/**
 * When was this asset's configuration last actually checked against the
 * drawing? A comparison of two baselines is only as current as the walkdown
 * that produced the as-maintained one.
 */
export function reconciliationStatus(
  last: {
    performedAt: string;
    trigger: string;
    differencesFound: number;
  } | null,
  asOf: Date = new Date(0),
  intervalDays = 365,
): ReconciliationStatus {
  if (!last) {
    return {
      lastPerformedAt: null,
      daysSince: null,
      trigger: null,
      overdue: true,
      reason:
        "This asset's configuration has never been reconciled. Any comparison below rests on baselines nobody has verified against the equipment.",
    };
  }
  const days = Math.floor(
    (asOf.getTime() - new Date(last.performedAt).getTime()) / DAY,
  );
  return {
    lastPerformedAt: last.performedAt,
    daysSince: days,
    trigger: last.trigger,
    overdue: days > intervalDays,
    reason:
      `Last reconciled ${days} day(s) ago after a ${last.trigger}, finding ${last.differencesFound} difference(s).` +
      (days > intervalDays
        ? ` That is beyond the ${intervalDays}-day interval, so the as-maintained baseline is a claim about the past.`
        : ""),
  };
}
