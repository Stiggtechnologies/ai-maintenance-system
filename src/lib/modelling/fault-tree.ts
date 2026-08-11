/**
 * Fault-tree and event-tree analysis (capability register C7.10).
 *
 * A fault tree runs the opposite way to an RBD: it starts at the thing you do
 * not want to happen and works down to the combinations of basic events that
 * cause it. The useful output is not the top-event probability — it is the
 * MINIMAL CUT SETS, because a cut set of size one is a single point of failure
 * and no amount of probability arithmetic makes that acceptable.
 *
 * THREE PLACES THIS REFUSES TO BE CONVENIENT.
 *
 *   1. Order-1 cut sets are reported before any probability. A single point of
 *      failure with a low failure rate is still a single point of failure, and
 *      a top-event number tends to make people stop reading.
 *
 *   2. The rare-event approximation (summing cut-set probabilities) is only
 *      used where it is defensible, and the result says which method was used.
 *      Summed cut sets can exceed 1.0; exact inclusion–exclusion cannot. The
 *      exact form is used up to a bounded number of cut sets and the
 *      approximation beyond it, flagged.
 *
 *   3. A basic event with no probability blocks the arithmetic. It does not
 *      default to zero, which would silently delete a failure path from the
 *      model.
 *
 * Pure functions. No database, no network, no randomness.
 */

export type GateType = "AND" | "OR" | "VOTE";

export interface FaultTreeNode {
  id: string;
  label: string;
  /** Leaf nodes have no gate; they are basic events. */
  gate?: GateType;
  /** k for a VOTE gate (k-out-of-n children fail => this node fails). */
  voteThreshold?: number;
  children?: string[];
  /** Basic events only. Null means unknown, which blocks the arithmetic. */
  probability?: number | null;
}

export interface CutSet {
  events: string[];
  labels: string[];
  order: number;
  probability: number | null;
}

export interface FaultTreeResult {
  topEventProbability: number | null;
  /** "exact" | "rare_event" | null when not computable. */
  method: "exact" | "rare_event" | null;
  cutSets: CutSet[];
  /** Cut sets of size 1 — single points of failure. Listed first, always. */
  singlePointsOfFailure: CutSet[];
  basicEventsMissingProbability: string[];
  computable: boolean;
  reason: string;
}

/** Exact inclusion–exclusion is 2^m; beyond this we fall back and say so. */
const EXACT_CUTSET_LIMIT = 16;

/**
 * MOCUS — expand gates top-down into cut sets, then minimise by removing any
 * set that is a superset of another.
 */
function minimalCutSets(
  nodes: Map<string, FaultTreeNode>,
  rootId: string,
): string[][] {
  function expand(id: string, seen: Set<string>): string[][] {
    if (seen.has(id)) {
      // A cycle in a fault tree is a modelling error, not something to resolve
      // silently. Treat the repeat as a leaf so expansion terminates; the
      // caller's structural check reports the cycle.
      return [[id]];
    }
    const node = nodes.get(id);
    if (!node) return [[id]];
    const kids = node.children ?? [];
    if (!node.gate || kids.length === 0) return [[id]];

    const next = new Set(seen);
    next.add(id);
    const childSets = kids.map((c) => expand(c, next));

    if (node.gate === "OR") {
      // Any child fails => this fails. Union of the children's cut sets.
      return childSets.flat();
    }

    if (node.gate === "AND") {
      // All children must fail. Cartesian product.
      return childSets.reduce<string[][]>(
        (acc, sets) =>
          acc.flatMap((a) => sets.map((s) => [...new Set([...a, ...s])])),
        [[]],
      );
    }

    // VOTE: k-out-of-n children failing is enough. Enumerate the k-subsets and
    // treat each as an AND.
    const k = Math.max(1, Math.min(node.voteThreshold ?? 1, kids.length));
    const out: string[][] = [];
    const combos = (start: number, chosen: number[]) => {
      if (chosen.length === k) {
        const product = chosen
          .map((i) => childSets[i])
          .reduce<string[][]>(
            (acc, sets) =>
              acc.flatMap((a) => sets.map((s) => [...new Set([...a, ...s])])),
            [[]],
          );
        out.push(...product);
        return;
      }
      for (let i = start; i < kids.length; i++) combos(i + 1, [...chosen, i]);
    };
    combos(0, []);
    return out;
  }

  const raw = expand(rootId, new Set()).map((s) => [...new Set(s)].sort());
  // Minimise: drop any set that contains another set.
  const unique = [...new Map(raw.map((s) => [s.join("|"), s])).values()].sort(
    (a, b) => a.length - b.length,
  );
  const minimal: string[][] = [];
  for (const s of unique) {
    if (!minimal.some((m) => m.every((e) => s.includes(e)))) minimal.push(s);
  }
  return minimal;
}

export function analyseFaultTree(
  nodeList: FaultTreeNode[],
  rootId: string,
): FaultTreeResult {
  const nodes = new Map(nodeList.map((n) => [n.id, n]));
  const label = (id: string) => nodes.get(id)?.label ?? id;

  if (!nodes.has(rootId)) {
    return {
      topEventProbability: null,
      method: null,
      cutSets: [],
      singlePointsOfFailure: [],
      basicEventsMissingProbability: [],
      computable: false,
      reason: `Top event "${rootId}" is not in the tree. Nothing to analyse.`,
    };
  }

  const sets = minimalCutSets(nodes, rootId);

  const involved = new Set(sets.flat());
  const missing = [...involved].filter((id) => {
    const n = nodes.get(id);
    return !n || n.probability === null || n.probability === undefined;
  });

  const cutSets: CutSet[] = sets.map((s) => ({
    events: s,
    labels: s.map(label),
    order: s.length,
    probability: s.some((e) => {
      const n = nodes.get(e);
      return !n || n.probability == null;
    })
      ? null
      : s.reduce((p, e) => p * (nodes.get(e)!.probability as number), 1),
  }));

  const spofs = cutSets.filter((c) => c.order === 1);
  const computable = missing.length === 0 && cutSets.length > 0;

  let top: number | null = null;
  let method: "exact" | "rare_event" | null = null;

  if (computable) {
    if (cutSets.length <= EXACT_CUTSET_LIMIT) {
      // Inclusion–exclusion over the cut sets. Cut sets can share events, so
      // the intersection of a subset is the product over the UNION of their
      // events, not the product of their probabilities.
      method = "exact";
      let sum = 0;
      const m = cutSets.length;
      for (let mask = 1; mask < 1 << m; mask++) {
        const union = new Set<string>();
        let bits = 0;
        for (let i = 0; i < m; i++) {
          if (mask & (1 << i)) {
            bits++;
            for (const e of cutSets[i].events) union.add(e);
          }
        }
        const p = [...union].reduce(
          (acc, e) => acc * (nodes.get(e)!.probability as number),
          1,
        );
        sum += (bits % 2 === 1 ? 1 : -1) * p;
      }
      top = Math.min(1, Math.max(0, sum));
    } else {
      method = "rare_event";
      top = Math.min(
        1,
        cutSets.reduce((s, c) => s + (c.probability ?? 0), 0),
      );
    }
  }

  const spofLine =
    spofs.length > 0
      ? `${spofs.length} SINGLE POINT(S) OF FAILURE: ${spofs.map((s) => s.labels[0]).join(", ")}. Any one of these alone causes the top event, whatever its probability. `
      : `No single point of failure — every cut set needs at least ${cutSets.length > 0 ? Math.min(...cutSets.map((c) => c.order)) : 0} simultaneous events. `;

  return {
    topEventProbability: top,
    method,
    cutSets: cutSets.sort(
      (a, b) =>
        a.order - b.order || (b.probability ?? 0) - (a.probability ?? 0),
    ),
    singlePointsOfFailure: spofs,
    basicEventsMissingProbability: missing.map(label),
    computable,
    reason:
      cutSets.length === 0
        ? "The tree produced no cut sets. Nothing to analyse."
        : spofLine +
          (computable
            ? `Top-event probability ${top!.toExponential(3)} from ${cutSets.length} minimal cut set(s), computed ${method === "exact" ? "exactly by inclusion–exclusion" : `by the rare-event approximation because there are more than ${EXACT_CUTSET_LIMIT} cut sets — this OVERSTATES the probability and is an upper bound`}.`
            : `No top-event probability: ${missing.length} basic event(s) have no probability (${missing.slice(0, 4).map(label).join(", ")}${missing.length > 4 ? ", …" : ""}). A missing probability is not zero — defaulting it would delete a failure path from the model.`),
  };
}

/**
 * Fussell–Vesely importance: the share of the top-event probability that comes
 * from cut sets containing this event. It answers "what fraction of the risk
 * would go away if this event could not happen", which is the question a
 * maintenance budget actually asks.
 */
export interface EventImportance {
  eventId: string;
  label: string;
  fussellVesely: number;
  appearsInCutSets: number;
  minimumOrder: number;
  reason: string;
}

export function eventImportance(
  nodeList: FaultTreeNode[],
  rootId: string,
): EventImportance[] {
  const result = analyseFaultTree(nodeList, rootId);
  if (!result.computable || !result.topEventProbability) return [];
  const nodes = new Map(nodeList.map((n) => [n.id, n]));

  const events = [...new Set(result.cutSets.flatMap((c) => c.events))];
  return events
    .map((e) => {
      const containing = result.cutSets.filter((c) => c.events.includes(e));
      const share =
        containing.reduce((s, c) => s + (c.probability ?? 0), 0) /
        result.topEventProbability!;
      const minOrder = Math.min(...containing.map((c) => c.order));
      return {
        eventId: e,
        label: nodes.get(e)?.label ?? e,
        fussellVesely: Math.min(1, share),
        appearsInCutSets: containing.length,
        minimumOrder: minOrder,
        reason:
          minOrder === 1
            ? `${nodes.get(e)?.label ?? e} is a single point of failure and accounts for ${(Math.min(1, share) * 100).toFixed(1)}% of the top-event probability. Redundancy, not a better inspection interval, is the fix for an order-1 cut set.`
            : `Eliminating ${nodes.get(e)?.label ?? e} would remove roughly ${(Math.min(1, share) * 100).toFixed(1)}% of the top-event probability. It appears in ${containing.length} cut set(s), smallest of order ${minOrder}.`,
      };
    })
    .sort(
      (a, b) =>
        // Compared with a tolerance, not exactly. Two genuinely equal shares
        // reach here as doubles that differ around 1e-17 because they were
        // summed along different paths, and an exact `-` comparison lets that
        // noise decide the ranking before the tie-break below ever runs.
        (Math.abs(a.fussellVesely - b.fussellVesely) > 1e-12
          ? b.fussellVesely - a.fussellVesely
          : 0) ||
        // Ties are common and not incidental: an order-1 cut set and an order-2
        // cut set can carry identical probability. When they do, the single
        // point of failure ranks first — same risk share, but a different KIND
        // of problem, and one that needs redundancy rather than a shorter
        // inspection interval. Leaving this to sort stability would rank them
        // by insertion order, which is arbitrary.
        a.minimumOrder - b.minimumOrder ||
        a.label.localeCompare(b.label),
    );
}

/**
 * Event tree: an initiating event propagates through barriers, each of which
 * either works or does not, producing a set of end states with frequencies.
 *
 * Reuses the barrier concept already modelled in process safety. A barrier with
 * no recorded PFD blocks the branch rather than being assumed perfect — an
 * unassessed barrier is the most dangerous kind.
 */
export interface Barrier {
  id: string;
  label: string;
  /** Probability of failure on demand. Null = never assessed. */
  pfd: number | null;
  /** Consequence label if this barrier is the one that fails. */
  outcomeIfFailed: string;
}

export interface EventTreeOutcome {
  path: string[];
  outcome: string;
  frequencyPerYear: number | null;
  reason: string;
}

export interface EventTreeResult {
  outcomes: EventTreeOutcome[];
  unassessedBarriers: string[];
  computable: boolean;
  reason: string;
}

export function analyseEventTree(
  initiatingFrequencyPerYear: number,
  barriers: Barrier[],
): EventTreeResult {
  const unassessed = barriers.filter((b) => b.pfd == null).map((b) => b.label);

  if (!(initiatingFrequencyPerYear > 0)) {
    return {
      outcomes: [],
      unassessedBarriers: unassessed,
      computable: false,
      reason:
        "Initiating-event frequency must be positive. A zero frequency makes every downstream outcome zero and the tree meaningless.",
    };
  }

  const outcomes: EventTreeOutcome[] = [];
  let survivingFrequency: number | null = initiatingFrequencyPerYear;
  const path: string[] = [];

  for (const b of barriers) {
    if (b.pfd == null || survivingFrequency === null) {
      outcomes.push({
        path: [...path, `${b.label} FAILS`],
        outcome: b.outcomeIfFailed,
        frequencyPerYear: null,
        reason: `${b.label} has no assessed probability of failure on demand, so this branch and everything downstream of it cannot be quantified. An unassessed barrier is not a working one.`,
      });
      survivingFrequency = null;
      path.push(`${b.label} holds`);
      continue;
    }
    const failFreq = survivingFrequency * b.pfd;
    outcomes.push({
      path: [...path, `${b.label} FAILS`],
      outcome: b.outcomeIfFailed,
      frequencyPerYear: failFreq,
      reason: `${b.label} fails on demand with probability ${b.pfd.toExponential(2)}, giving ${failFreq.toExponential(3)} events per year reaching "${b.outcomeIfFailed}".`,
    });
    survivingFrequency = survivingFrequency * (1 - b.pfd);
    path.push(`${b.label} holds`);
  }

  outcomes.push({
    path: [...path],
    outcome: "Contained — all barriers held",
    frequencyPerYear: survivingFrequency,
    reason:
      survivingFrequency === null
        ? "Cannot be quantified because at least one upstream barrier is unassessed."
        : `${survivingFrequency.toExponential(3)} events per year are contained by every barrier in sequence.`,
  });

  return {
    outcomes,
    unassessedBarriers: unassessed,
    computable: unassessed.length === 0,
    reason:
      unassessed.length > 0
        ? `${unassessed.length} barrier(s) have no assessed PFD: ${unassessed.join(", ")}. Those branches are shown without frequencies rather than being assumed to work.`
        : `${barriers.length} barrier(s), all assessed. Outcome frequencies sum to the initiating frequency of ${initiatingFrequencyPerYear.toExponential(3)}/year, which is the arithmetic check that the tree is complete.`,
  };
}
