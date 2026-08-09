/**
 * Human factors and workforce analysis
 * (capability register E6.01–E6.14, C2.08).
 *
 * The scheduler already constrains on craft hours. This constrains on the
 * things hours hide: whether anyone qualified is available, whether the person
 * who is available has been on shift for eleven days, and whether the only
 * holder of a critical competency retires next year.
 *
 * THE ROSTER RULE THIS MODULE ENFORCES MOST CAREFULLY. A fatigue limit is only
 * meaningful against a complete roster. A worker with two recorded shifts in a
 * three-week window is not well rested — they are unrostered, or rostered in a
 * system this one cannot see, and `assessFatigue` reports coverage alongside
 * every verdict so a clean result cannot be read as a safe one.
 *
 * WHY STATUTORY LIMITS ARE SEPARATED FROM THE REST. A company standard can be
 * flexed by someone with the authority to flex it. A statutory limit cannot,
 * and a panel that renders both in the same amber is training people to treat
 * them the same. Breaches are returned tagged with their source.
 *
 * Pure: no database, no network.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type LimitKind =
  | "max_consecutive_days"
  | "max_hours_per_shift"
  | "min_rest_hours_between_shifts"
  | "max_hours_per_7_days"
  | "max_hours_per_14_days"
  | "max_consecutive_nights";

export type RuleSource =
  "statutory" | "labour_agreement" | "company_standard" | "fatigue_science";

export interface LabourRule {
  ruleKey: string;
  title: string;
  source: RuleSource;
  limitKind: LimitKind;
  limitValue: number;
  appliesToCraft?: string | null;
  reference?: string | null;
}

export interface Shift {
  startsAt: string;
  endsAt: string;
  shiftKind: string;
}

export interface RosteredMember {
  memberId: number | string;
  displayName: string;
  craft?: string | null;
  shifts: Shift[];
}

export interface Breach {
  memberId: number | string;
  displayName: string;
  ruleKey: string;
  title: string;
  source: RuleSource;
  limitKind: LimitKind;
  limitValue: number;
  observedValue: number;
  reason: string;
}

export interface FatigueAssessment {
  breaches: Breach[];
  statutoryBreaches: Breach[];
  membersAssessed: number;
  membersWithThinRoster: string[];
  reason: string;
}

/** Shifts that count as time worked. Leave and training are not rest, but they
 *  are also not the exposure a fatigue limit is written about. */
function isWorked(s: Shift): boolean {
  return s.shiftKind !== "leave" && s.shiftKind !== "training";
}

function hours(s: Shift): number {
  return (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / HOUR;
}

/** Distinct calendar days touched by a shift, as day numbers. */
function daySpan(s: Shift): number[] {
  const a = Math.floor(new Date(s.startsAt).getTime() / DAY);
  const b = Math.floor((new Date(s.endsAt).getTime() - 1) / DAY);
  const out: number[] = [];
  for (let d = a; d <= b; d++) out.push(d);
  return out;
}

function longestRun(days: number[]): number {
  if (days.length === 0) return 0;
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Test a roster against the labour rules that bound it.
 *
 * `windowDays` describes how much roster the caller supplied, and is used to
 * judge whether the data is thick enough to draw a conclusion from — not to
 * filter. A rule about hours in 14 days cannot be tested against 3 days of
 * roster, and saying nothing would read as compliance.
 */
export function assessFatigue(
  members: RosteredMember[],
  rules: LabourRule[],
  asOf: Date = new Date(0),
  windowDays = 21,
): FatigueAssessment {
  if (rules.length === 0) {
    return {
      breaches: [],
      statutoryBreaches: [],
      membersAssessed: 0,
      membersWithThinRoster: [],
      reason:
        "No labour rules are defined, so there is nothing to test the roster against. An unbounded roster produces no breaches by construction, which is not the same as a rested workforce.",
    };
  }
  if (members.length === 0) {
    return {
      breaches: [],
      statutoryBreaches: [],
      membersAssessed: 0,
      membersWithThinRoster: [],
      reason:
        "No roster is recorded. Fatigue exposure cannot be assessed from an absence of shifts — an unrostered worker is not a rested one.",
    };
  }

  const breaches: Breach[] = [];
  const thin: string[] = [];
  const now = asOf.getTime();

  for (const m of members) {
    const worked = m.shifts.filter(isWorked);
    const daysCovered = new Set(worked.flatMap(daySpan)).size;
    // Fewer than a third of the window's days rostered is a data gap, not a
    // light workload.
    if (daysCovered < windowDays / 3) thin.push(m.displayName);

    const applicable = rules.filter(
      (r) => !r.appliesToCraft || r.appliesToCraft === m.craft,
    );

    for (const rule of applicable) {
      let observed: number | null = null;

      switch (rule.limitKind) {
        case "max_hours_per_shift": {
          observed = worked.reduce((mx, s) => Math.max(mx, hours(s)), 0);
          break;
        }
        case "max_consecutive_days": {
          observed = longestRun(worked.flatMap(daySpan));
          break;
        }
        case "max_consecutive_nights": {
          observed = longestRun(
            worked.filter((s) => s.shiftKind === "night").flatMap(daySpan),
          );
          break;
        }
        case "min_rest_hours_between_shifts": {
          const sorted = [...worked].sort(
            (a, b) =>
              new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
          );
          let shortest = Infinity;
          for (let i = 1; i < sorted.length; i++) {
            const gap =
              (new Date(sorted[i].startsAt).getTime() -
                new Date(sorted[i - 1].endsAt).getTime()) /
              HOUR;
            if (gap >= 0 && gap < shortest) shortest = gap;
          }
          // A rest limit is a MINIMUM, so a breach is being below it.
          if (shortest !== Infinity && shortest < rule.limitValue) {
            breaches.push({
              memberId: m.memberId,
              displayName: m.displayName,
              ruleKey: rule.ruleKey,
              title: rule.title,
              source: rule.source,
              limitKind: rule.limitKind,
              limitValue: rule.limitValue,
              observedValue: Number(shortest.toFixed(1)),
              reason: `${m.displayName} had ${shortest.toFixed(1)} h between shifts against a ${rule.limitValue} h minimum (${rule.source.replace(/_/g, " ")}).`,
            });
          }
          continue;
        }
        case "max_hours_per_7_days":
        case "max_hours_per_14_days": {
          const span = rule.limitKind === "max_hours_per_7_days" ? 7 : 14;
          observed = worked
            .filter((s) => now - new Date(s.startsAt).getTime() <= span * DAY)
            .reduce((n, s) => n + hours(s), 0);
          break;
        }
      }

      if (observed !== null && observed > rule.limitValue) {
        breaches.push({
          memberId: m.memberId,
          displayName: m.displayName,
          ruleKey: rule.ruleKey,
          title: rule.title,
          source: rule.source,
          limitKind: rule.limitKind,
          limitValue: rule.limitValue,
          observedValue: Number(observed.toFixed(1)),
          reason: `${m.displayName} reached ${observed.toFixed(1)} against a limit of ${rule.limitValue} (${rule.title}, ${rule.source.replace(/_/g, " ")}).`,
        });
      }
    }
  }

  // Statutory first: those cannot be flexed by anyone on site.
  const order: Record<RuleSource, number> = {
    statutory: 0,
    labour_agreement: 1,
    fatigue_science: 2,
    company_standard: 3,
  };
  breaches.sort(
    (a, b) =>
      order[a.source] - order[b.source] ||
      b.observedValue / b.limitValue - a.observedValue / a.limitValue,
  );
  const statutory = breaches.filter((b) => b.source === "statutory");

  return {
    breaches,
    statutoryBreaches: statutory,
    membersAssessed: members.length,
    membersWithThinRoster: thin,
    reason:
      (breaches.length === 0
        ? `No breach of ${rules.length} labour rule(s) across ${members.length} rostered worker(s).`
        : `${breaches.length} breach(es) across ${members.length} rostered worker(s).` +
          (statutory.length > 0
            ? ` ${statutory.length} of them ${statutory.length === 1 ? "is" : "are"} STATUTORY and cannot be waived on site.`
            : " None are statutory; the rest can be flexed by someone with the authority to flex them.")) +
      (thin.length > 0
        ? ` ${thin.length} worker(s) have fewer than a third of the window rostered — that is a gap in the data, not a light workload, and their verdicts mean little.`
        : ""),
  };
}

export interface CompetencyRequirement {
  competencyKey: string;
  title: string;
  isStatutory: boolean;
}

export interface HeldCompetency {
  competencyKey: string;
  expiresOn?: string | null;
}

export interface CompetencyVerdict {
  qualified: boolean;
  missing: string[];
  expired: string[];
  expiringSoon: string[];
  blockedByStatutory: boolean;
  reason: string;
}

/**
 * May this person be assigned this work?
 *
 * An expired statutory authorisation is a hard no and is reported separately,
 * because the only honest thing to do with it is stop. A lapsed non-statutory
 * skill is a judgement for a supervisor, and this says which is which rather
 * than rendering both in the same amber.
 */
export function checkCompetency(
  required: CompetencyRequirement[],
  held: HeldCompetency[],
  asOf: Date = new Date(0),
  soonDays = 90,
): CompetencyVerdict {
  const byKey = new Map(held.map((h) => [h.competencyKey, h]));
  const missing: string[] = [];
  const expired: string[] = [];
  const soon: string[] = [];
  let statutoryBlock = false;

  for (const r of required) {
    const h = byKey.get(r.competencyKey);
    if (!h) {
      missing.push(r.title);
      if (r.isStatutory) statutoryBlock = true;
      continue;
    }
    if (h.expiresOn) {
      const exp = new Date(h.expiresOn).getTime();
      if (exp < asOf.getTime()) {
        expired.push(r.title);
        if (r.isStatutory) statutoryBlock = true;
      } else if (exp - asOf.getTime() <= soonDays * DAY) {
        soon.push(r.title);
      }
    }
  }

  const qualified = missing.length === 0 && expired.length === 0;
  return {
    qualified,
    missing,
    expired,
    expiringSoon: soon,
    blockedByStatutory: statutoryBlock,
    reason:
      required.length === 0
        ? "No competency is recorded as required for this work, which is not the same as none being needed. Work with no stated qualification requirement has not been assessed."
        : qualified
          ? `All ${required.length} required competencies are held and current.` +
            (soon.length > 0
              ? ` ${soon.length} expire within ${soonDays} days: ${soon.join(", ")}.`
              : "")
          : (statutoryBlock
              ? "Blocked by a STATUTORY requirement, which cannot be waived on site. "
              : "") +
            [
              missing.length > 0 ? `missing ${missing.join(", ")}` : null,
              expired.length > 0 ? `expired ${expired.join(", ")}` : null,
            ]
              .filter(Boolean)
              .join("; ") +
            ".",
  };
}

export interface CapacityDeduction {
  kind: string;
  hours: number;
  basis?: string | null;
}

export interface CapacityReconciliation {
  theoretical: number;
  deducted: number;
  impliedAvailable: number;
  declared: number | null;
  reconciles: boolean;
  reason: string;
}

/**
 * Theoretical hours against the number the scheduler actually uses (E6.14).
 *
 * The point is not to correct the operator's figure. It is to make the gap
 * visible: 8 people at 40 hours is 320 theoretical hours, and the reason the
 * scheduler is told 210 should be a list of deductions rather than a shrug.
 */
export function reconcileCapacity(
  fteCount: number,
  hoursPerFte: number,
  deductions: CapacityDeduction[],
  declared: number | null,
  toleranceHours = 4,
): CapacityReconciliation {
  const theoretical = fteCount * hoursPerFte;
  const deducted = deductions.reduce((n, d) => n + d.hours, 0);
  const implied = theoretical - deducted;
  const reconciles =
    declared !== null && Math.abs(implied - declared) <= toleranceHours;

  let reason: string;
  if (declared === null) {
    reason = `No delivered-hours figure is recorded, so the scheduler has nothing to constrain against. ${theoretical} theoretical hours is not a capacity.`;
  } else if (deductions.length === 0) {
    reason = `${theoretical} theoretical hours against ${declared} declared. The ${(theoretical - declared).toFixed(1)}-hour gap is unexplained rather than justified — it is probably right, and nothing here can show that it is.`;
  } else if (reconciles) {
    reason = `${theoretical} theoretical hours less ${deducted} itemised deductions leaves ${implied.toFixed(1)}, which matches the declared ${declared}.`;
  } else {
    reason = `${theoretical} theoretical hours less ${deducted} itemised deductions leaves ${implied.toFixed(1)}, but ${declared} is declared — a ${Math.abs(implied - declared).toFixed(1)}-hour discrepancy. The declared figure is the one the scheduler uses, so the deductions are what need correcting.`;
  }

  return {
    theoretical,
    deducted,
    impliedAvailable: implied,
    declared,
    reconciles,
    reason,
  };
}
