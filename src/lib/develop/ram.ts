/**
 * The RAM Agent, scoped to a Development Case (D12.13, spec III.§63).
 *
 * ZERO NEW MATHEMATICS. Every number below comes out of the kernel that
 * already ships and that RE-2026.08's golden baseline already tests:
 * `allocateAvailability` (src/lib/design), `selectWeibullMethod`
 * (src/lib/reliability/method-selection, which calls weibullMLE / weibullMRR),
 * `repairableSummary`, `crowAMSAA`, `evaluateRbd`, and `blockImportance`.
 *
 * REFUSALS ARE FIRST-CLASS. Every leg that cannot be computed says so by name
 * and contributes a refusal string; the refusal list travels into the
 * calculation-lineage row (`record_ram_agent_report` merges it OVER the
 * caller's, so the server's refusals cannot be dropped by a client).
 *
 * RBD topology comes only from the canonical `asset_dependencies` graph. Block
 * availability is computed only inside an explicit observation window bounded
 * by two governed operating-hour readings. No first/last failure shortcut and
 * no default day is allowed to manufacture a denominator.
 */

import { allocateAvailability, type AllocationResult } from "../design";
import {
  selectWeibullMethod,
  type MethodSelection,
} from "../reliability/method-selection";
import {
  crowAMSAA,
  repairableSummary,
  type CrowAmsaaFit,
  type RepairableSummary,
} from "../reliability";
import {
  blockImportance,
  evaluateRbd,
  type BlockImportance,
  type RbdBlock,
  type RbdGroupSpec,
  type RbdResult,
} from "../modelling/rbd";

/**
 * MIRRORS `sync_ram_kernel_version()` (migration 20261207090200) and is
 * asserted equal to it by the slice test. `record_ram_agent_report` REFUSES a
 * report declaring any other version, so a kernel change that lands on one
 * side only cannot record a run at all.
 */
export const RAM_KERNEL_VERSION = "develop-ram/5E/2026-12-20";

export interface RamObservationWindow {
  startAt: string;
  endAt: string;
  calendarHours: number;
  operatingHoursDelta: number;
  meterReadingIds: string[];
  downtimeHours: number[];
  failureEventHours: number[];
  workOrderIds: string[];
  basis: string;
}

export interface RamScopeAsset {
  assetId: string;
  assetTag: string;
  name: string;
  criticality: string | null;
  failureTimes: number[];
  suspensionTimes: number[];
  failureCount: number;
  suspensionCount: number;
  observationWindow?: RamObservationWindow | null;
}

export interface RamTopologyEdge {
  edgeId: number;
  dependentAssetId: string;
  supplierAssetId: string;
  dependencyKind: string;
  redundancyGroup: string | null;
  minRequired: number;
  evidence: string | null;
  source: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  commonCauseGroups: string[];
}

export interface RamCommonCauseGroup {
  groupId: number;
  name: string;
  causeKind: string;
  memberAssetIds: string[];
  /** The canonical graph records the group but currently has no beta field. */
  betaFactor: number | null;
}

export interface RamTopologyScope {
  edges: RamTopologyEdge[];
  commonCauseGroups: RamCommonCauseGroup[];
  note: string;
}

export interface RamFmeaRow {
  id: string;
  assetId: string;
  assetTag: string;
  failureMode: string | null;
  failureMechanism: string | null;
  cause: string | null;
  effect: string | null;
  detectionMethod: string | null;
  consequence: string | null;
  currentControls: string | null;
  recommendedControls: string | null;
  source: string | null;
}

export interface RamPmStrategyRow {
  id: string;
  assetId: string;
  assetTag: string;
  recommendation: string | null;
  failureModeAddressed: string | null;
  riskReduced: string | null;
  evidenceUsed: unknown;
  assumptions: unknown;
  confidence: string | null;
  requiredApproval: string | null;
  implementationWorkOrder: string | null;
  status: string | null;
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
  topology?: RamTopologyScope | null;
  fmea?: RamFmeaRow[];
  pmStrategies?: RamPmStrategyRow[];
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
  availability: RepairableSummary | null;
  availabilityReason: string;
  growth: CrowAmsaaFit | null;
  growthReason: string;
}

export interface RamRbdProfile {
  modelScope: "declared_case_dependency_graph";
  edgeIds: number[];
  result: RbdResult;
  importance: BlockImportance[];
  note: string;
}

export interface RamProfile {
  kernelVersion: string;
  refused: boolean;
  headline: string;
  targets: RamTargetProfile[];
  assets: RamAssetProfile[];
  rbd: RamRbdProfile | null;
  fmea: RamFmeaRow[];
  pmStrategies: RamPmStrategyRow[];
  decisionBoundary: string;
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
      rbd: null,
      fmea: [],
      pmStrategies: [],
      decisionBoundary:
        "This reading is advisory. A competent human sets targets, accepts models, approves maintenance strategy, and authorizes work.",
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

    let availability: RepairableSummary | null = null;
    let availabilityReason: string;
    let growth: CrowAmsaaFit | null = null;
    let growthReason: string;
    const window = a.observationWindow;
    if (!window) {
      availabilityReason =
        "No availability is computed: two governed operating-hour readings do not bound an observation window for this asset.";
      growthReason =
        "No reliability-growth fit is computed without the same governed observation window.";
      refusals.push(`Asset ${a.assetTag}: ${availabilityReason}`);
      refusals.push(`Asset ${a.assetTag}: ${growthReason}`);
    } else {
      try {
        availability = repairableSummary(
          window.downtimeHours ?? [],
          window.calendarHours,
        );
        availabilityReason = `${availability.failures} corrective failure event(s) and ${availability.downtimeHours} downtime hour(s) inside the ${window.calendarHours}-hour meter-bounded observation window.`;
      } catch (error) {
        availabilityReason =
          error instanceof Error
            ? error.message
            : "Availability input refused.";
        refusals.push(`Asset ${a.assetTag}: ${availabilityReason}`);
      }
      try {
        growth = crowAMSAA(
          window.failureEventHours ?? [],
          window.calendarHours,
        );
        growthReason = `Crow-AMSAA over ${growth.failures} timestamped corrective failures inside the governed ${growth.totalTime}-hour observation window.`;
      } catch (error) {
        growthReason =
          error instanceof Error
            ? error.message
            : "Reliability-growth input refused.";
        refusals.push(`Asset ${a.assetTag}: ${growthReason}`);
      }
    }
    return {
      assetId: a.assetId,
      assetTag: a.assetTag,
      selection,
      availability,
      availabilityReason,
      growth,
      growthReason,
    };
  });

  const topology = scope.topology;
  let rbd: RamRbdProfile | null = null;
  if (!topology || topology.edges.length === 0) {
    refusals.push(
      "No RBD is evaluated because the declared case dependency graph contains no edge whose dependent and supplier are both bound to this case. An empty graph is not a reliable system.",
    );
  } else {
    const ineligible = topology.edges.filter(
      (edge) =>
        !edge.confirmedAt ||
        !edge.confirmedBy ||
        !edge.evidence?.trim() ||
        edge.source === "demo",
    );
    const groups = new Map<string, number>();
    const inconsistentGroups = new Set<string>();
    for (const edge of topology.edges) {
      const group =
        edge.redundancyGroup ??
        `${edge.dependentAssetId}:${edge.supplierAssetId}`;
      const prior = groups.get(group);
      if (prior !== undefined && prior !== edge.minRequired) {
        inconsistentGroups.add(group);
      } else {
        groups.set(group, edge.minRequired);
      }
    }
    if (ineligible.length > 0) {
      refusals.push(
        `RBD refused: edge ${ineligible.map((edge) => edge.edgeId).join(", ")} must be confirmed by a named human and carry non-demo evidence. The agent does not evaluate a convenient subset of an ungoverned topology.`,
      );
    } else if (inconsistentGroups.size > 0) {
      refusals.push(
        `RBD refused: redundancy group(s) ${[...inconsistentGroups].join(", ")} declare conflicting min-required values.`,
      );
    } else {
      const availabilityByAsset = new Map(
        assets.map((asset) => [
          asset.assetId,
          asset.availability?.availability ?? null,
        ]),
      );
      const labelByAsset = new Map(
        (scope.assets ?? []).map((asset) => [asset.assetId, asset.assetTag]),
      );
      const seen = new Set<string>();
      const blocks: RbdBlock[] = [];
      for (const edge of topology.edges) {
        const group =
          edge.redundancyGroup ??
          `${edge.dependentAssetId}:${edge.supplierAssetId}`;
        const key = `${group}|${edge.supplierAssetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        blocks.push({
          id: edge.supplierAssetId,
          label: labelByAsset.get(edge.supplierAssetId) ?? edge.supplierAssetId,
          reliability: availabilityByAsset.get(edge.supplierAssetId) ?? null,
          group,
          commonCauseGroup:
            edge.commonCauseGroups.length > 0
              ? edge.commonCauseGroups.join("|")
              : null,
        });
      }
      const specs: RbdGroupSpec[] = [...groups].map(([group, minRequired]) => ({
        group,
        minRequired,
        betaFactor: topology.edges.some(
          (edge) =>
            (edge.redundancyGroup ??
              `${edge.dependentAssetId}:${edge.supplierAssetId}`) === group &&
            edge.commonCauseGroups.length > 0,
        )
          ? null
          : undefined,
      }));
      const result = evaluateRbd(blocks, specs);
      if (!result.computable) refusals.push(`RBD: ${result.reason}`);
      if (result.groupsWithUnquantifiedCommonCause.length > 0) {
        refusals.push(
          `RBD common-cause warning: ${result.groupsWithUnquantifiedCommonCause.join(", ")} has a recorded shared mechanism but no approved beta factor; the independent result is an upper bound, not an accepted reliability estimate.`,
        );
      }
      rbd = {
        modelScope: "declared_case_dependency_graph",
        edgeIds: topology.edges
          .map((edge) => edge.edgeId)
          .sort((a, b) => a - b),
        result,
        importance: blockImportance(blocks, specs),
        note: topology.note,
      };
    }
  }

  const fitted = assets.filter((a) => a.selection.method !== "none").length;
  const feasible = targets.filter((t) => t.allocation.feasible).length;

  return {
    kernelVersion: RAM_KERNEL_VERSION,
    refused: false,
    headline:
      `${feasible} of ${targets.length} availability target(s) allocated across their recorded subsystems, ` +
      `${fitted} of ${assets.length} asset(s) with life data enough to fit a distribution. ` +
      `${rbd?.result.computable ? "the declared case RBD was evaluated" : "the declared case RBD was not computable"}; ` +
      `${scope.fmea?.length ?? 0} FMEA row(s) and ${scope.pmStrategies?.length ?? 0} PM-strategy row(s) were retrieved from their canonical stores. ` +
      `${refusals.length} leg(s) refused or qualified and are named below — a RAM profile with refusals is the normal case, and a profile without them is the one to distrust.`,
    targets,
    assets,
    rbd,
    fmea: scope.fmea ?? [],
    pmStrategies: scope.pmStrategies ?? [],
    decisionBoundary:
      "This reading is advisory. A competent human sets targets, accepts topology and common-cause assumptions, approves maintenance strategy, and authorizes work.",
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
    lines.push(
      `- ${a.assetTag}: ${a.availability ? `observed availability ${(a.availability.availability * 100).toFixed(3)}%` : "availability NOT COMPUTED"} — ${a.availabilityReason}`,
    );
    lines.push(
      `- ${a.assetTag}: ${a.growth ? `Crow-AMSAA beta ${a.growth.beta.toFixed(3)}` : "reliability growth NOT FITTED"} — ${a.growthReason}`,
    );
  }
  lines.push(
    profile.rbd
      ? `- RBD (${profile.rbd.modelScope}): ${profile.rbd.result.reason}`
      : "- RBD: NOT EVALUATED — see the named topology refusal.",
  );
  lines.push(
    `- Case-scoped engineering context: ${profile.fmea.length} FMEA row(s); ${profile.pmStrategies.length} PM-strategy recommendation(s), whose stored status and required approval remain unchanged.`,
  );
  lines.push(`- Decision boundary: ${profile.decisionBoundary}`);
  return lines;
}
