/**
 * Asset interdependency analysis (capability register U2.01–U2.09).
 *
 * A criticality rating assigned to an asset in isolation is usually wrong. An
 * air compressor rated "medium" on its replacement cost is critical the moment
 * you notice that eleven other assets stop when it does. This module is the
 * arithmetic for noticing.
 *
 * THE ONE IDEA IT TURNS ON. Edges into the same dependent that share a
 * redundancy group are alternatives. That lets the analysis say the thing a
 * hierarchy cannot: REDUNDANCY ONLY COUNTS WHEN THE REDUNDANT PATHS CAN FAIL
 * INDEPENDENTLY. Two pumps in an N+1 pair defend nothing if a single MCC feeds
 * both, and `commonCauseExposure` exists to find precisely that case.
 *
 * THE REFUSAL THAT MATTERS MOST. An empty graph produces a spotless result —
 * no single points of failure, no cascades, nothing to worry about — and that
 * result is indistinguishable from a site nobody has mapped. Every function
 * here returns a `reliable` flag and refuses to present a clean finding drawn
 * from a graph with too few edges to have found anything.
 *
 * WHAT IT DOES NOT CLAIM. Propagation is structural, not temporal: it answers
 * "what else is down" and not "how long until it is". Capacity is propagated
 * proportionally where shares are declared, which assumes the dependent's
 * output scales with its supply — true for a conveyor fed by two feeders,
 * false for a machine that either runs or does not. Where shares are absent
 * the state is binary, and the result says which of the two it used.
 *
 * Pure: no database, no network.
 */

export type DependencyKind =
  | "functional"
  | "utility"
  | "topological"
  | "control"
  | "geographic"
  | "logistical";

export interface DependencyEdge {
  /** The asset that stops working. */
  dependent: string;
  /** The asset it needs. */
  supplier: string;
  kind: DependencyKind;
  /** Edges into one dependent sharing a group are alternatives. */
  redundancyGroup?: string | null;
  /** How many of the group must survive. */
  minRequired?: number | null;
  /** Share of the dependent's capacity this supplier carries, if known. */
  capacitySharePct?: number | null;
  evidence?: string | null;
  source?: string | null;
}

export interface DependencyNode {
  id: string;
  tag?: string | null;
  name: string;
  criticality?: string | null;
  serviceName?: string | null;
  consequenceClass?: string | null;
  tolerableDowntimeHours?: number | null;
  restorationRank?: number | null;
}

export interface CommonCauseGroup {
  id: number | string;
  name: string;
  causeKind: string;
  members: string[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  commonCauseGroups: CommonCauseGroup[];
}

export type AssetState = "up" | "degraded" | "lost";

export interface ImpactedAsset {
  id: string;
  name: string;
  state: AssetState;
  /** 0–100. Only meaningful where capacity shares are declared. */
  capacityPct: number;
  /** Where it sat before this loss. Below 100 means it was already short. */
  baselinePct: number;
  /** True when the state came from declared shares rather than binary logic. */
  capacityModelled: boolean;
  serviceName?: string | null;
  consequenceClass?: string | null;
  /** Why it fell over: the group that ran out of survivors. */
  cause: string;
}

export interface CascadeResult {
  origin: string[];
  impacted: ImpactedAsset[];
  lostCount: number;
  degradedCount: number;
  servicesLost: string[];
  reliable: boolean;
  reason: string;
}

const MAX_ITERATIONS = 500;

/** Index the graph once; every analysis below reuses it. */
function index(graph: DependencyGraph) {
  const byId = new Map<string, DependencyNode>();
  for (const n of graph.nodes) byId.set(n.id, n);
  const incoming = new Map<string, DependencyEdge[]>();
  for (const e of graph.edges) {
    const list = incoming.get(e.dependent) ?? [];
    list.push(e);
    incoming.set(e.dependent, list);
    // A supplier referenced by an edge is a real node even if the node list
    // omitted it; better a sparse node than a silently dropped dependency.
    if (!byId.has(e.supplier))
      byId.set(e.supplier, { id: e.supplier, name: e.supplier });
    if (!byId.has(e.dependent))
      byId.set(e.dependent, { id: e.dependent, name: e.dependent });
  }
  return { byId, incoming };
}

/** Group key: a solo edge is its own group of one. */
function groupKey(e: DependencyEdge): string {
  return e.redundancyGroup && e.redundancyGroup.trim() !== ""
    ? `g:${e.redundancyGroup}`
    : `solo:${e.supplier}`;
}

type Indexed = ReturnType<typeof index>;

/**
 * Settle the graph to a fixpoint given a set of failed assets.
 *
 * Capacity is monotonically non-increasing across iterations, so the loop
 * converges; the iteration cap is a guard, not the mechanism.
 */
function settle(
  idx: Indexed,
  failed: string[],
): {
  capacity: Map<string, number>;
  cause: Map<string, string>;
  capped: boolean;
} {
  const { byId, incoming } = idx;
  const capacity = new Map<string, number>();
  const cause = new Map<string, string>();
  for (const id of byId.keys()) capacity.set(id, 100);
  for (const id of failed) {
    capacity.set(id, 0);
    cause.set(id, "origin of the loss");
  }

  let changed = true;
  let iterations = 0;
  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations += 1;
    for (const [id, edges] of incoming) {
      if (failed.includes(id)) continue;
      const groups = new Map<string, DependencyEdge[]>();
      for (const e of edges) {
        const k = groupKey(e);
        groups.set(k, [...(groups.get(k) ?? []), e]);
      }

      let lostBecause: string | null = null;
      // Separate groups are CONJUNCTIVE requirements — power and cooling and
      // control — so the dependent is limited by the worst-supplied of them.
      // Within a group the members are alternatives, so their shares add.
      let limiting = 100;

      for (const [k, members] of groups) {
        const need = Math.max(1, ...members.map((m) => m.minRequired ?? 1));
        const survivors = members.filter(
          (m) => (capacity.get(m.supplier) ?? 100) > 0,
        );
        if (survivors.length < need) {
          lostBecause = k.startsWith("solo:")
            ? `its only ${members[0].kind} supplier ${label(byId, members[0].supplier)} is down`
            : `redundancy group "${k.slice(2)}" needs ${need} of ${members.length} and has ${survivors.length}`;
          break;
        }
        if (!members.some((m) => m.capacitySharePct != null)) continue;
        const supplied = survivors.reduce(
          (sum, m) =>
            sum +
            (m.capacitySharePct ?? 0) *
              ((capacity.get(m.supplier) ?? 100) / 100),
          0,
        );
        limiting = Math.min(limiting, Math.min(100, supplied));
      }

      const next = lostBecause ? 0 : limiting;
      const prev = capacity.get(id) ?? 100;
      if (next < prev) {
        capacity.set(id, next);
        cause.set(
          id,
          lostBecause ??
            `supplied capacity fell to ${next.toFixed(0)}% of declared`,
        );
        changed = true;
      }
    }
  }
  return { capacity, cause, capped: iterations >= MAX_ITERATIONS };
}

/**
 * What the loss of `failed` changes.
 *
 * Reported against a BASELINE settle of the same graph with nothing failed,
 * so an asset already sitting below full capacity because its supply is
 * under-declared does not show up in every cascade as though this outage
 * caused it. The question is what this loss did, not what was already wrong.
 */
export function propagateLoss(
  graph: DependencyGraph,
  failed: string[],
): CascadeResult {
  const idx = index(graph);
  const { byId, incoming } = idx;
  const base = settle(idx, []).capacity;
  const { capacity, cause, capped } = settle(idx, failed);

  const impacted: ImpactedAsset[] = [];
  for (const [id, cap] of capacity) {
    const before = base.get(id) ?? 100;
    if (cap >= before && !failed.includes(id)) continue;
    const n = byId.get(id);
    const declared = (incoming.get(id) ?? []).some(
      (e) => e.capacitySharePct != null,
    );
    impacted.push({
      id,
      name: n?.name ?? id,
      state: cap <= 0 ? "lost" : "degraded",
      capacityPct: Math.round(cap),
      baselinePct: Math.round(before),
      capacityModelled: declared,
      serviceName: n?.serviceName ?? null,
      consequenceClass: n?.consequenceClass ?? null,
      cause: cause.get(id) ?? "origin of the loss",
    });
  }
  impacted.sort(
    (a, b) => a.capacityPct - b.capacityPct || a.name.localeCompare(b.name),
  );

  const lost = impacted.filter((i) => i.state === "lost");
  const degraded = impacted.filter((i) => i.state === "degraded");
  const servicesLost = lost
    .map((i) => i.serviceName)
    .filter((s): s is string => !!s);
  const reliable = graph.edges.length > 0;

  return {
    origin: failed,
    impacted,
    lostCount: lost.length,
    degradedCount: degraded.length,
    servicesLost,
    reliable,
    reason: !reliable
      ? "No dependency edges are recorded, so nothing can cascade. This is an empty graph, not a resilient plant."
      : `Losing ${failed.length} asset${failed.length === 1 ? "" : "s"} takes down ${lost.length - failed.length} more and degrades ${degraded.length}.` +
        (servicesLost.length > 0
          ? ` Services lost: ${servicesLost.join(", ")}.`
          : " No asset carrying a declared service level is affected — though only some assets carry one.") +
        (capped
          ? " Propagation hit its iteration cap and the result may be incomplete."
          : ""),
  };
}

function label(byId: Map<string, DependencyNode>, id: string): string {
  const n = byId.get(id);
  return n ? (n.tag ?? n.name) : id;
}

export interface SinglePoint {
  id: string;
  name: string;
  criticality?: string | null;
  assetsLost: number;
  assetsDegraded: number;
  servicesLost: string[];
  /** True when the register rates it below the consequence of losing it. */
  underrated: boolean;
}

export interface SpofResult {
  points: SinglePoint[];
  reliable: boolean;
  reason: string;
}

/**
 * Assets whose individual loss takes something else with it, ranked by how
 * much. The `underrated` flag is the point of the exercise: a low-criticality
 * asset that strands a service is a rating error the register cannot see on
 * its own.
 */
export function singlePointsOfFailure(graph: DependencyGraph): SpofResult {
  if (graph.edges.length === 0) {
    return {
      points: [],
      reliable: false,
      reason:
        "No dependency edges are recorded. An empty graph has no single points of failure by construction, which says nothing about the plant. Map the functional dependencies from a P&ID or single-line diagram first.",
    };
  }

  const { byId } = index(graph);
  const suppliers = new Set(graph.edges.map((e) => e.supplier));
  const points: SinglePoint[] = [];

  for (const id of suppliers) {
    const r = propagateLoss(graph, [id]);
    const lost = r.lostCount - 1; // exclude the origin itself
    if (lost <= 0 && r.degradedCount === 0) continue;
    const n = byId.get(id);
    const crit = (n?.criticality ?? "").toLowerCase();
    points.push({
      id,
      name: n?.name ?? id,
      criticality: n?.criticality ?? null,
      assetsLost: lost,
      assetsDegraded: r.degradedCount,
      servicesLost: r.servicesLost,
      underrated:
        (crit === "low" || crit === "medium") &&
        (r.servicesLost.length > 0 || lost >= 3),
    });
  }

  points.sort(
    (a, b) =>
      b.servicesLost.length - a.servicesLost.length ||
      b.assetsLost - a.assetsLost ||
      b.assetsDegraded - a.assetsDegraded,
  );

  const underrated = points.filter((p) => p.underrated).length;
  return {
    points,
    reliable: true,
    reason:
      points.length === 0
        ? `${graph.edges.length} edges are mapped and no single asset's loss propagates past itself. Every dependency recorded has an independent alternative.`
        : `${points.length} asset${points.length === 1 ? " propagates loss beyond itself" : "s propagate loss beyond themselves"}.` +
          (underrated > 0
            ? ` ${underrated} ${underrated === 1 ? "is" : "are"} rated low or medium in the register while stranding a service or three or more assets — a rating error the asset record cannot see on its own.`
            : ""),
  };
}

export interface DefeatedRedundancy {
  dependent: string;
  dependentName: string;
  redundancyGroup: string;
  commonCauseGroup: string;
  causeKind: string;
  members: string[];
  reason: string;
}

export interface CommonCauseFinding {
  groupName: string;
  causeKind: string;
  memberCount: number;
  assetsLost: number;
  servicesLost: string[];
  /** Extra assets lost versus the worst single member failing alone. */
  amplification: number;
}

export interface CommonCauseResult {
  defeatedRedundancies: DefeatedRedundancy[];
  findings: CommonCauseFinding[];
  reliable: boolean;
  reason: string;
}

/**
 * The headline of this module.
 *
 * `defeatedRedundancies` finds redundancy groups whose members all sit inside
 * one common-cause group — an N+1 pair on one feeder, two controllers on one
 * firmware version. The redundancy is recorded, is believed, and defends
 * nothing against that cause.
 */
export function commonCauseExposure(graph: DependencyGraph): CommonCauseResult {
  const groups = graph.commonCauseGroups ?? [];
  if (groups.length === 0) {
    return {
      defeatedRedundancies: [],
      findings: [],
      reliable: false,
      reason:
        "No common-cause groups are defined. Until they are, every redundancy in the graph is assumed to fail independently — which is the assumption that most often turns out to be false.",
    };
  }

  const { byId } = index(graph);
  const defeated: DefeatedRedundancy[] = [];

  // Redundancy groups: dependent + group label -> supplier ids.
  const redundancy = new Map<string, { dependent: string; sup: string[] }>();
  for (const e of graph.edges) {
    if (!e.redundancyGroup || e.redundancyGroup.trim() === "") continue;
    const k = `${e.dependent}::${e.redundancyGroup}`;
    const cur = redundancy.get(k) ?? { dependent: e.dependent, sup: [] };
    cur.sup.push(e.supplier);
    redundancy.set(k, cur);
  }

  for (const [k, { dependent, sup }] of redundancy) {
    if (sup.length < 2) continue;
    for (const g of groups) {
      const members = new Set(g.members);
      if (sup.every((s) => members.has(s))) {
        defeated.push({
          dependent,
          dependentName: byId.get(dependent)?.name ?? dependent,
          redundancyGroup: k.split("::")[1],
          commonCauseGroup: g.name,
          causeKind: g.causeKind,
          members: sup.map((s) => label(byId, s)),
          reason:
            `All ${sup.length} suppliers in redundancy group "${k.split("::")[1]}" belong to common-cause group ` +
            `"${g.name}" (${g.causeKind.replace(/_/g, " ")}). The redundancy is recorded and defends nothing against that cause: ` +
            `one event takes every alternative at once.`,
        });
      }
    }
  }

  const findings: CommonCauseFinding[] = [];
  for (const g of groups) {
    if (g.members.length === 0) continue;
    const together = propagateLoss(graph, g.members);
    let worstAlone = 0;
    for (const m of g.members) {
      const one = propagateLoss(graph, [m]);
      worstAlone = Math.max(worstAlone, one.lostCount);
    }
    findings.push({
      groupName: g.name,
      causeKind: g.causeKind,
      memberCount: g.members.length,
      assetsLost: together.lostCount,
      servicesLost: together.servicesLost,
      amplification: together.lostCount - worstAlone,
    });
  }
  findings.sort((a, b) => b.assetsLost - a.assetsLost);

  return {
    defeatedRedundancies: defeated,
    findings,
    reliable: graph.edges.length > 0,
    reason:
      defeated.length > 0
        ? `${defeated.length} recorded redundanc${defeated.length === 1 ? "y is" : "ies are"} defeated by a shared cause: every alternative fails together. This is the failure the redundancy was bought to prevent.`
        : `No redundancy group has all of its members inside a single common-cause group. Across ${groups.length} group${groups.length === 1 ? "" : "s"}, the redundancy that is recorded survives the causes that are recorded.`,
  };
}

export interface RestorationStep {
  order: number;
  id: string;
  name: string;
  serviceName?: string | null;
  consequenceClass?: string | null;
  /** Suppliers that must be back first. */
  waitsOn: string[];
  reason: string;
}

export interface RestorationResult {
  steps: RestorationStep[];
  /** Assets in a dependency cycle: no order exists without a blackstart. */
  cycles: string[][];
  reliable: boolean;
  reason: string;
}

/**
 * Order in which a failed set can be brought back (U2.09).
 *
 * Constraint first: nothing is restored before what it depends on. Within what
 * is available at each step, the most consequential goes first — declared
 * restoration rank, then consequence class, then criticality.
 *
 * A dependency cycle has no valid order. Rather than emit an arbitrary one,
 * the cycle is named: it needs a blackstart source or a temporary supply, and
 * that is an engineering decision, not a sort.
 */
export function restorationOrder(
  graph: DependencyGraph,
  failed: string[],
): RestorationResult {
  const { byId, incoming } = index(graph);
  const pending = new Set(failed);
  const done = new Set<string>();
  const steps: RestorationStep[] = [];

  const rank = (id: string): number => {
    const n = byId.get(id);
    if (n?.restorationRank != null) return n.restorationRank;
    const byConsequence: Record<string, number> = {
      safety: 10,
      environmental: 20,
      regulatory: 30,
      customer: 40,
      production: 50,
      financial: 60,
    };
    if (n?.consequenceClass) return byConsequence[n.consequenceClass] ?? 70;
    const byCrit: Record<string, number> = {
      critical: 80,
      high: 85,
      medium: 90,
      low: 95,
    };
    return byCrit[(n?.criticality ?? "").toLowerCase()] ?? 99;
  };

  while (pending.size > 0) {
    const ready = [...pending].filter((id) => {
      const blockers = (incoming.get(id) ?? [])
        .map((e) => e.supplier)
        .filter((s) => pending.has(s));
      return blockers.length === 0;
    });

    if (ready.length === 0) {
      // Everything left is mutually blocked.
      const cycle = [...pending].sort();
      return {
        steps,
        cycles: [cycle],
        reliable: graph.edges.length > 0,
        reason:
          `${steps.length} assets can be restored in order. The remaining ${cycle.length} form a dependency cycle ` +
          `(${cycle.map((c) => label(byId, c)).join(" → ")}) and no restoration order exists for them: each waits on another in the ring. ` +
          `Breaking it needs a blackstart source or a temporary supply, which is an engineering decision and not something to sort your way out of.`,
      };
    }

    ready.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    for (const id of ready) {
      const n = byId.get(id);
      const waits = (incoming.get(id) ?? [])
        .map((e) => e.supplier)
        .filter((s) => done.has(s))
        .map((s) => label(byId, s));
      steps.push({
        order: steps.length + 1,
        id,
        name: n?.name ?? id,
        serviceName: n?.serviceName ?? null,
        consequenceClass: n?.consequenceClass ?? null,
        waitsOn: waits,
        reason:
          waits.length > 0
            ? `Restorable once ${waits.join(", ")} ${waits.length === 1 ? "is" : "are"} back.`
            : `Depends on nothing else in the failed set — can start immediately.`,
      });
      pending.delete(id);
      done.add(id);
    }
  }

  return {
    steps,
    cycles: [],
    reliable: graph.edges.length > 0,
    reason:
      graph.edges.length === 0
        ? "No dependency edges are recorded, so this order is arbitrary: it reflects consequence only, and nothing about what has to come back first."
        : `${steps.length} assets ordered so that nothing is restored before what it depends on. Within each step the most consequential goes first.`,
  };
}

export interface CapacityGap {
  id: string;
  name: string;
  redundancyGroup: string;
  declaredPct: number;
  reason: string;
}

/**
 * Modelling gaps in the capacity shares (U2.06).
 *
 * Checked per redundancy group, because that is the level the shares mean
 * something at: the members of one group are alternatives whose shares add to
 * the supply that group provides. A group declaring less than 100 either has a
 * supplier missing from the graph or has the shares wrong, and the degradation
 * figures computed from it are understated either way.
 *
 * Only SHORTFALLS are flagged. An N+1 pair where each unit carries the whole
 * load is declared 100 and 100, sums to 200, and is not an error — it is what
 * redundancy looks like. There is no over-declaration case: a share cannot
 * exceed 100 by construction, and a group summing past it is redundancy rather
 * than double-counting.
 */
export function capacityGaps(graph: DependencyGraph): CapacityGap[] {
  const { byId, incoming } = index(graph);
  const gaps: CapacityGap[] = [];
  for (const [id, edges] of incoming) {
    const groups = new Map<string, DependencyEdge[]>();
    for (const e of edges) {
      const k = groupKey(e);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const [k, members] of groups) {
      if (!members.some((m) => m.capacitySharePct != null)) continue;
      const total = members.reduce((s, m) => s + (m.capacitySharePct ?? 0), 0);
      if (total >= 99.5) continue;
      const gname = k.startsWith("g:") ? k.slice(2) : "(no redundancy group)";
      gaps.push({
        id,
        name: byId.get(id)?.name ?? id,
        redundancyGroup: gname,
        declaredPct: Math.round(total * 10) / 10,
        reason:
          `Supply group ${gname} covers ${total.toFixed(0)}% of this asset's capacity. ` +
          `Either a supplier is missing from the graph or the shares are wrong; the degradation ` +
          `figures for it are understated either way.`,
      });
    }
  }
  return gaps.sort((a, b) => a.declaredPct - b.declaredPct);
}
