/**
 * The RAM Agent, scoped to a Development Case (D12.13, spec III.§63).
 *
 * ZERO NEW MATHEMATICS. Every number below comes out of the kernel that
 * already ships and that RE-2026.08's golden baseline already tests:
 * `allocateAvailability` (src/lib/design) and `selectWeibullMethod`
 * (src/lib/reliability/method-selection, which calls weibullMLE / weibullMRR).
 * The register row for D12.13 names the gap precisely — "Missing: scoping to a
 * Development Case's asset set" — and scoping is the only thing this file does.
 *
 * REFUSALS ARE FIRST-CLASS. Every leg that cannot be computed says so by name
 * and contributes a refusal string; the refusal list travels into the
 * calculation-lineage row (`record_ram_agent_report` merges it OVER the
 * caller's, so the server's refusals cannot be dropped by a client).
 *
 * WHAT IS DELIBERATELY NOT HERE: an RBD. `evaluateRbd` is in the kernel and is
 * not called, because nothing in this repository stores a redundancy structure
 * for a development case's assets — which block sits in which group and how
 * many of each must work. Assuming "everything in series" would produce a
 * system reliability with an invented model behind it, which is worse than no
 * number because it looks like one. The server states that refusal; this
 * module carries it through and adds no substitute.
 */

import { allocateAvailability, type AllocationResult } from "../design";
import {
  selectWeibullMethod,
  type MethodSelection,
} from "../reliability/method-selection";

/**
 * MIRRORS `sync_ram_kernel_version()` (migration 20261207090200) and is
 * asserted equal to it by the slice test. `record_ram_agent_report` REFUSES a
 * report declaring any other version, so a kernel change that lands on one
 * side only cannot record a run at all.
 */
export const RAM_KERNEL_VERSION = "develop-ram/5D/2026-12-07";

export interface RamScopeAsset {
  assetId: string;
  assetTag: string;
  name: string;
  criticality: string | null;
  failureTimes: number[];
  suspensionTimes: number[];
  failureCount: number;
  suspensionCount: number;
}

export interface RamScopeAllocation {
  label: string;
  demonstrated: number | null;
  recordedAllocation: number | null;
  evidence: string | null;
  complexityWeight: number | null;
}

export interface RamScopeTarget {
  targetId: number;
  systemLabel: string;
  targetAvailability: number;
  configuration: string;
  basis: string | null;
  allocations: RamScopeAllocation[];
  allocationCount: number;
}

export interface RamScopePayload {
  caseId: string;
  projectId?: number | null;
  refused: boolean;
  refusal?: string;
  assetCount?: number;
  targetCount?: number;
  assets: RamScopeAsset[];
  targets: RamScopeTarget[];
  refusals: string[];
  kernelVersion?: string;
  note?: string;
}

export interface RamTargetProfile {
  targetId: number;
  systemLabel: string;
  allocation: AllocationResult;
}

export interface RamAssetProfile {
  assetId: string;
  assetTag: string;
  selection: MethodSelection;
}

export interface RamProfile {
  kernelVersion: string;
  refused: boolean;
  headline: string;
  targets: RamTargetProfile[];
  assets: RamAssetProfile[];
  /** Every leg that could not be computed, named. */
  refusals: string[];
}

/**
 * Run the shipped kernel over one case's RAM scope.
 *
 * A REFUSED SCOPE PRODUCES NO PROFILE. The server has already said the inputs
 * are not there; computing over the fragment it did return and presenting the
 * result would be the "reachable subgraph as complete" failure in a different
 * costume.
 */
export function computeCaseRamProfile(scope: RamScopePayload): RamProfile {
  const refusals = [...(scope.refusals ?? [])];

  if (scope.refused) {
    return {
      kernelVersion: RAM_KERNEL_VERSION,
      refused: true,
      headline:
        scope.refusal ??
        "The RAM scope for this case refused: the inputs a reliability, availability or maintainability answer needs are not recorded. No figure is produced, and the absence of a figure is not a good result.",
      targets: [],
      assets: [],
      refusals,
    };
  }

  const targets: RamTargetProfile[] = (scope.targets ?? []).map((t) => {
    const configuration =
      t.configuration === "parallel" ? "parallel" : "series";
    // 'mixed' is a recorded configuration this kernel has no model for. It is
    // NOT silently treated as series — that is a different system and a
    // different number.
    if (t.configuration === "mixed") {
      refusals.push(
        `Target "${t.systemLabel}" is recorded as a MIXED configuration. The allocation kernel models series and parallel; a mixed system needs its structure declared before any share can be allocated, and treating it as series would allocate a target across a system this is not.`,
      );
      return {
        targetId: t.targetId,
        systemLabel: t.systemLabel,
        allocation: {
          feasible: false,
          target: t.targetAvailability,
          configuration: "series",
          subsystems: [],
          achievable: null,
          reason: `Recorded configuration is "mixed", which this kernel does not model. Nothing was allocated.`,
        },
      };
    }
    const allocation = allocateAvailability(
      t.targetAvailability,
      (t.allocations ?? []).map((a) => ({
        label: a.label,
        demonstrated: a.demonstrated ?? null,
        complexityWeight: a.complexityWeight ?? undefined,
      })),
      configuration,
    );
    if (!allocation.feasible) {
      refusals.push(`Target "${t.systemLabel}": ${allocation.reason}`);
    }
    return { targetId: t.targetId, systemLabel: t.systemLabel, allocation };
  });

  const assets: RamAssetProfile[] = (scope.assets ?? []).map((a) => {
    const selection = selectWeibullMethod(
      a.failureTimes ?? [],
      a.suspensionTimes ?? [],
    );
    if (selection.method === "none") {
      refusals.push(`Asset ${a.assetTag}: ${selection.reason}`);
    }
    if (selection.modelWarning) {
      refusals.push(`Asset ${a.assetTag}: ${selection.modelWarning}`);
    }
    return { assetId: a.assetId, assetTag: a.assetTag, selection };
  });

  const fitted = assets.filter((a) => a.selection.method !== "none").length;
  const feasible = targets.filter((t) => t.allocation.feasible).length;

  return {
    kernelVersion: RAM_KERNEL_VERSION,
    refused: false,
    headline:
      `${feasible} of ${targets.length} availability target(s) allocated across their recorded subsystems, ` +
      `${fitted} of ${assets.length} asset(s) with life data enough to fit a distribution. ` +
      `${refusals.length} leg(s) refused and are named below — a RAM profile with refusals is the normal case, and a profile without them is the one to distrust.`,
    targets,
    assets,
    refusals,
  };
}

/**
 * The lines a surface prints, and the lines the report's narrative carries.
 *
 * Deterministic. No model is asked for this reading: every sentence in it is a
 * restatement of a kernel result or a refusal, and sending those to a language
 * model would make a reproducible fact probabilistic.
 */
export function ramProfileLines(profile: RamProfile): string[] {
  if (profile.refused) {
    return [profile.headline, ...profile.refusals.map((r) => `- ${r}`)];
  }
  const lines = [profile.headline];
  for (const t of profile.targets) {
    if (!t.allocation.feasible) {
      lines.push(`- ${t.systemLabel}: NOT ALLOCATED — ${t.allocation.reason}`);
      continue;
    }
    const short = t.allocation.subsystems.filter(
      (s) => (s.shortfall ?? 0) > 0,
    ).length;
    const unknown = t.allocation.subsystems.filter(
      (s) => s.demonstrated === null,
    ).length;
    lines.push(
      `- ${t.systemLabel}: target ${t.allocation.target} allocated across ${t.allocation.subsystems.length} subsystem(s) (${t.allocation.configuration}); ` +
        `${short} cannot meet their share; ${unknown} have no demonstrated figure and are reported UNKNOWN rather than assumed met.`,
    );
  }
  for (const a of profile.assets) {
    lines.push(
      a.selection.method === "none"
        ? `- ${a.assetTag}: no life distribution fitted — ${a.selection.ruleApplied}.`
        : `- ${a.assetTag}: ${a.selection.method} (${a.selection.ruleApplied}), beta ${a.selection.beta?.toFixed(3)}, eta ${a.selection.eta?.toFixed(1)} from ${a.selection.failures} failure(s) and ${a.selection.suspensions} suspension(s).`,
    );
  }
  return lines;
}
