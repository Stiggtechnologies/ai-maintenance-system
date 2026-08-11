/**
 * Deriving a draft twin template from work-order history.
 *
 * WHAT THE DATA CAN AND CANNOT SUPPLY.
 *
 * This operator's register codes 41 system groups against work orders — real
 * OEM group names, with real event counts and real downtime. That is enough to
 * derive a COMPONENT BREAKDOWN and to rank it by consequence, and both are
 * derived facts about this fleet rather than anybody's opinion.
 *
 * It cannot supply failure modes. The field named `actual_failure_mode` is,
 * in all 8,504 coded rows, exactly equal to `system_group` — the register has
 * component coding and no failure-mode coding at all, despite appearing to have
 * both. So a derived template gets its components from the data and its failure
 * modes from published engineering, and every component records WHICH, because a
 * reviewer needs to know what they are checking rather than approving.
 *
 * WHY COVERAGE IS REPORTED BEFORE ANYTHING ELSE.
 *
 * Only about a third of work orders carry a system group. The components that
 * emerge are therefore the components that get CODED, which is not the same set
 * as the components that fail — coding effort follows planned work and big jobs.
 * A breakdown derived from a third of the history is a strong starting point and
 * a bad final answer, and the difference has to survive into the output.
 *
 * Pure functions. No database, no network.
 */

export interface ComponentSignature {
  /** System group as coded on the work order, e.g. "UNDERCARRIAGE". */
  systemGroup: string;
  events: number;
  downtimeHours: number;
}

export interface DerivationInput {
  signatures: ComponentSignature[];
  /** Work orders for this class in total, coded or not. */
  totalWorkOrders: number;
  /** Work orders carrying a system group. */
  codedWorkOrders: number;
  /** Below this many events a group is noise rather than a component. */
  minEvents?: number;
}

export interface DerivedComponent {
  code: string;
  name: string;
  events: number;
  downtimeHours: number;
  /** Share of coded downtime. The consequence ranking. */
  downtimeShare: number;
  /** Share of coded events. The frequency ranking. */
  eventShare: number;
  /**
   * Consequence and frequency disagree more often than not, and the gap is the
   * interesting part: a component that fails rarely and stops the machine for
   * days is a different problem from one that fails weekly for an hour.
   */
  profile: "high_consequence" | "high_frequency" | "both" | "routine";
  reason: string;
}

export interface DerivationResult {
  derivable: boolean;
  components: DerivedComponent[];
  codingCoverage: number;
  excludedBelowThreshold: number;
  reason: string;
  /** Stated on the artefact so a reviewer knows what to check. */
  provenanceNote: string;
}

const DEFAULT_MIN_EVENTS = 8;

/** Turn an OEM group name into a stable template component code. */
function toCode(group: string): string {
  return group
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

function titleCase(group: string): string {
  return group
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function deriveComponents(input: DerivationInput): DerivationResult {
  const minEvents = input.minEvents ?? DEFAULT_MIN_EVENTS;
  const coverage =
    input.totalWorkOrders > 0
      ? input.codedWorkOrders / input.totalWorkOrders
      : 0;

  const kept = input.signatures.filter((s) => s.events >= minEvents);
  const excluded = input.signatures.length - kept.length;

  if (kept.length === 0) {
    return {
      derivable: false,
      components: [],
      codingCoverage: coverage,
      excludedBelowThreshold: excluded,
      reason: `No system group reaches ${minEvents} events. There is component coding here but not enough of it to derive a breakdown — ${excluded} group(s) appear below the threshold and would each be one or two work orders, which is an anecdote rather than a component.`,
      provenanceNote: "",
    };
  }

  const totalEvents = kept.reduce((n, s) => n + s.events, 0);
  const totalDowntime = kept.reduce((n, s) => n + s.downtimeHours, 0);

  const components: DerivedComponent[] = kept
    .map((s) => {
      const downtimeShare =
        totalDowntime > 0 ? s.downtimeHours / totalDowntime : 0;
      const eventShare = totalEvents > 0 ? s.events / totalEvents : 0;
      // "High" means a disproportionate share — more of one than the other by
      // half again. Comparing against a flat average would call the largest
      // component high on both and say nothing.
      const highConsequence = downtimeShare > eventShare * 1.5;
      const highFrequency = eventShare > downtimeShare * 1.5;
      const profile: DerivedComponent["profile"] =
        highConsequence && highFrequency
          ? "both"
          : highConsequence
            ? "high_consequence"
            : highFrequency
              ? "high_frequency"
              : "routine";

      return {
        code: toCode(s.systemGroup),
        name: titleCase(s.systemGroup),
        events: s.events,
        downtimeHours: s.downtimeHours,
        downtimeShare,
        eventShare,
        profile,
        reason:
          profile === "high_consequence"
            ? `${(downtimeShare * 100).toFixed(1)}% of downtime from ${(eventShare * 100).toFixed(1)}% of events — it fails seldom and stops the machine for a long time when it does. Availability lives here.`
            : profile === "high_frequency"
              ? `${(eventShare * 100).toFixed(1)}% of events for ${(downtimeShare * 100).toFixed(1)}% of downtime — frequent and quick. This is where labour and parts cost accumulate, not where availability is lost.`
              : `${(eventShare * 100).toFixed(1)}% of events and ${(downtimeShare * 100).toFixed(1)}% of downtime — frequency and consequence in proportion.`,
      };
    })
    .sort((a, b) => b.downtimeHours - a.downtimeHours);

  return {
    derivable: true,
    components,
    codingCoverage: coverage,
    excludedBelowThreshold: excluded,
    reason:
      `${components.length} component(s) derived from ${totalEvents} coded work order(s) and ${Math.round(totalDowntime)} hours of recorded downtime. ` +
      `Ranked by downtime, not by event count: the top component by frequency and the top by consequence are usually different, and only one of them costs availability. ` +
      (excluded > 0
        ? `${excluded} group(s) fell below ${minEvents} events and were dropped — they are not absent from the machine, only from the evidence. `
        : "") +
      `Coding coverage is ${(coverage * 100).toFixed(0)}%: ${coverage < 0.5 ? "this breakdown reflects the components that get CODED, which follows planned work and large jobs rather than everything that fails. A strong starting point and a poor final answer." : "most work orders carry a group, so the breakdown is broadly representative."}`,
    provenanceNote:
      `Components and their consequence ranking are DERIVED from this fleet's own work-order history — ${totalEvents} coded events over ${Math.round(totalDowntime)} downtime hours, at ${(coverage * 100).toFixed(0)}% coding coverage. ` +
      `Failure modes are NOT derived: the register's failure-mode field duplicates the system group in every coded row, so it carries no mechanism information. Any failure mode on this template comes from published engineering sources, cited per mode, and is the part a reviewer should check hardest.`,
  };
}

export interface FailureModeSource {
  code: string;
  name: string;
  /** Component code this mode belongs to. */
  componentCode: string;
  detectableBy: string[];
  source: string;
  locator?: string;
}

export interface DraftTemplate {
  name: string;
  family: string;
  description: string;
  components: Array<{
    code: string;
    name: string;
    origin: "derived_from_history";
    evidence: { events: number; downtimeHours: number; downtimeShare: number };
    failureModes: Array<{
      code: string;
      name: string;
      componentCode: string;
      origin: "published_engineering";
      detectableBy: string[];
      source: string;
      locator?: string;
    }>;
  }>;
  provenance: string;
  componentsWithoutModes: string[];
}

/**
 * Assemble the draft. Components from history, modes from published sources,
 * and a component with no published modes is left EMPTY rather than given a
 * plausible one — an invented mode is indistinguishable from a researched one
 * once it is in the template, and the reviewer would have no way to tell.
 */
export function assembleDraft(
  name: string,
  family: string,
  derived: DerivationResult,
  modes: FailureModeSource[],
): DraftTemplate {
  const byComponent = new Map<string, FailureModeSource[]>();
  for (const m of modes) {
    const list = byComponent.get(m.componentCode);
    if (list) list.push(m);
    else byComponent.set(m.componentCode, [m]);
  }

  const components = derived.components.map((c) => ({
    code: c.code,
    name: c.name,
    origin: "derived_from_history" as const,
    evidence: {
      events: c.events,
      downtimeHours: c.downtimeHours,
      downtimeShare: c.downtimeShare,
    },
    failureModes: (byComponent.get(c.code) ?? []).map((m) => ({
      code: m.code,
      name: m.name,
      componentCode: m.componentCode,
      origin: "published_engineering" as const,
      detectableBy: m.detectableBy,
      source: m.source,
      locator: m.locator,
    })),
  }));

  const without = components
    .filter((c) => c.failureModes.length === 0)
    .map((c) => c.name);

  return {
    name,
    family,
    description:
      `Draft template. Components derived from this fleet's work-order history; ` +
      `failure modes from published engineering sources. Not reviewed by an engineer.`,
    components,
    provenance: derived.provenanceNote,
    componentsWithoutModes: without,
  };
}
