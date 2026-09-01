/**
 * Sync Develop Slice 5B — the Interface object (D4.18, spec III.§19).
 *
 * §19's types are PHYSICAL, PROCESS, ELECTRICAL, CONTROL, DATA,
 * ORGANIZATIONAL and CONTRACTUAL, and its headline is "critical brownfield":
 * the interfaces are where a project meets the plant that is already running,
 * and they are the thing that is late.
 *
 * THE ONE RULE THIS MODULE EXISTS TO KEEP. An interface is an EDGE IN THE
 * EXISTING DEPENDENCY GRAPH, not a graph of its own. There is no propagation
 * arithmetic here, no cascade rule and no single-point-of-failure rule:
 * `buildInterfaceGraph` maps the server payload into the `DependencyGraph`
 * shape `src/lib/interdependency` already defines, and the analysis is
 * `propagateLoss` and `singlePointsOfFailure` — the same functions the asset
 * interdependency surface uses, unchanged. Where an interface's endpoint is a
 * real asset it carries that asset's id, so an interface edge and a recorded
 * asset dependency touching the same equipment meet at ONE node.
 *
 * A second traversal would be a second answer to "what else stops when this
 * does", and the first thing two answers do is disagree.
 *
 * Pure: no database, no network.
 */
import {
  propagateLoss,
  singlePointsOfFailure,
  type CascadeResult,
  type DependencyGraph,
  type SpofResult,
} from "../interdependency";

/** Spec III.§19's seven types, verbatim and in its order. */
export const INTERFACE_TYPES = [
  { key: "physical", label: "Physical" },
  { key: "process", label: "Process" },
  { key: "electrical", label: "Electrical" },
  { key: "control", label: "Control" },
  { key: "data", label: "Data" },
  { key: "organizational", label: "Organizational" },
  { key: "contractual", label: "Contractual" },
] as const;

/** The lifecycle 20261205090200 ruling 3 states, because §19 does not. */
export const INTERFACE_STATUSES = [
  { key: "identified", label: "Identified" },
  { key: "agreed", label: "Agreed" },
  { key: "disputed", label: "Disputed" },
  { key: "delivered", label: "Delivered" },
  { key: "closed", label: "Closed" },
] as const;

/** Statuses at which an interface stops being an open boundary. */
export const TERMINAL_INTERFACE_STATUSES = ["delivered", "closed"] as const;

export interface CaseInterface {
  id: number;
  interfaceRef: string;
  sourceObject: string;
  targetObject: string;
  sourceAssetId: string | null;
  targetAssetId: string | null;
  interfaceType: string;
  traversalKind: string;
  ownerId: string;
  owner: string;
  requirement: string;
  requirementId: number | null;
  requirementRef: string | null;
  dueDate: string | null;
  status: string;
  statusNote: string | null;
  overdue: boolean;
  daysLate: number | null;
}

export interface InterfaceGraphPayload {
  caseId: string;
  refused: boolean;
  refusal: string | null;
  interfaces: CaseInterface[];
  total: number;
  openCount: number | null;
  overdueCount: number | null;
  openWithoutDueDate: number | null;
  graph: DependencyGraph;
  assetEdgeCount: number;
  interfaceEdgeCount: number;
}

/**
 * The graph the SHARED traversal consumes.
 *
 * The server already emits the right shape; this function is the boundary that
 * says so in the type system and refuses a malformed payload by producing an
 * EMPTY graph rather than a partially-populated one. An empty graph is
 * honestly useless — `propagateLoss` and `singlePointsOfFailure` both return
 * `reliable: false` for it and say why — whereas a half-built graph reports a
 * clean traversal of the half that survived.
 */
export function buildInterfaceGraph(
  payload: Pick<InterfaceGraphPayload, "graph"> | null | undefined,
): DependencyGraph {
  const g = payload?.graph;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    return { nodes: [], edges: [], commonCauseGroups: [] };
  }
  return {
    nodes: g.nodes,
    edges: g.edges,
    commonCauseGroups: g.commonCauseGroups ?? [],
  };
}

export interface InterfaceExposure {
  refused: boolean;
  headline: string;
  /** The §19 register's own reading: what is open, late, and undated. */
  overdue: CaseInterface[];
  openWithoutDate: CaseInterface[];
  /** Types the register has no row for at all. Named, never counted. */
  uncoveredTypes: string[];
  /** Straight from the SHARED traversal. Never recomputed here. */
  singlePoints: SpofResult;
  /** What losing each overdue interface's source takes with it. */
  cascades: { interfaceRef: string; result: CascadeResult }[];
}

const typeLabel = (key: string) =>
  INTERFACE_TYPES.find((t) => t.key === key)?.label ?? key;

/**
 * Read an interface register (D4.18).
 *
 * THE REFUSAL. An empty interface register traverses perfectly: no cascades,
 * no single points, nothing late. That result is indistinguishable from a
 * brownfield project whose tie-ins nobody has written down, and it is almost
 * always the second one — so an empty register is reported as an unmapped
 * register, in the same words `singlePointsOfFailure` uses for an unmapped
 * plant.
 */
export function readInterfaceExposure(
  payload: InterfaceGraphPayload,
): InterfaceExposure {
  const interfaces = payload?.interfaces ?? [];
  const graph = buildInterfaceGraph(payload);
  const spof = singlePointsOfFailure(graph);
  const overdue = interfaces.filter((i) => i.overdue);
  const openWithoutDate = interfaces.filter(
    (i) =>
      !i.dueDate &&
      !(TERMINAL_INTERFACE_STATUSES as readonly string[]).includes(i.status),
  );
  const seen = new Set(interfaces.map((i) => i.interfaceType));
  const uncoveredTypes = INTERFACE_TYPES.filter((t) => !seen.has(t.key)).map(
    (t) => t.label,
  );

  // One cascade per overdue interface, from the SOURCE side: the object the
  // late interface was meant to deliver is the one that stops.
  const cascades = overdue
    .map((i) => ({
      interfaceRef: i.interfaceRef,
      result: propagateLoss(graph, [
        i.sourceAssetId ?? `obj:${i.sourceObject}`,
      ]),
    }))
    .filter((c) => c.result.reliable);

  if (payload?.refused || interfaces.length === 0) {
    return {
      refused: true,
      headline:
        payload?.refusal ??
        "No interfaces are recorded on this case. That is an unmapped register, not a project with no boundaries — and it traverses perfectly for exactly the same reason an unmapped plant has no single points of failure.",
      overdue,
      openWithoutDate,
      uncoveredTypes,
      singlePoints: spof,
      cascades,
    };
  }

  const parts: string[] = [
    `${interfaces.length} interface${interfaces.length === 1 ? "" : "s"} recorded, ${payload.openCount ?? interfaces.filter((i) => !(TERMINAL_INTERFACE_STATUSES as readonly string[]).includes(i.status)).length} still open.`,
  ];
  if (overdue.length > 0) {
    const worst = overdue.reduce((a, b) =>
      (b.daysLate ?? 0) > (a.daysLate ?? 0) ? b : a,
    );
    parts.push(
      `${overdue.length} ${overdue.length === 1 ? "is" : "are"} past the date they were required by — the worst is ${worst.interfaceRef} at ${worst.daysLate} day${worst.daysLate === 1 ? "" : "s"}, owned by ${worst.owner}.`,
    );
  }
  if (openWithoutDate.length > 0) {
    parts.push(
      `${openWithoutDate.length} open interface${openWithoutDate.length === 1 ? " carries" : "s carry"} no required-by date, so ${openWithoutDate.length === 1 ? "it can" : "they can"} never be late and will never appear on this list.`,
    );
  }
  if (uncoveredTypes.length > 0) {
    parts.push(
      `${uncoveredTypes.length} of the seven §19 types have no interface recorded at all (${uncoveredTypes.join(", ")}).`,
    );
  }
  if (spof.reliable && spof.points.length > 0) {
    parts.push(
      `The shared dependency traversal finds ${spof.points.length} object${spof.points.length === 1 ? "" : "s"} whose loss takes something else with it.`,
    );
  } else if (!spof.reliable) {
    parts.push(
      "The graph has no edges to traverse, so nothing can be said about what a late interface would take with it.",
    );
  }

  return {
    refused: false,
    headline: parts.join(" "),
    overdue,
    openWithoutDate,
    uncoveredTypes,
    singlePoints: spof,
    cascades,
  };
}

/** Every §19 type label, for a selector that cannot drift from the server. */
export function interfaceTypeLabel(key: string): string {
  return typeLabel(key);
}
