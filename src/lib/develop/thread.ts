/**
 * Sync Develop Slice 5C — the digital thread (D11.05, D11.06, D11.07, D11.19,
 * D11.20, D11.21; spec II.2 and III.§26/§34).
 *
 * THE ONE RULE THIS MODULE EXISTS TO KEEP. Every reading here refuses rather
 * than reporting a comfortable zero, and each refusal says WHICH zero it is.
 * The three that matter, all of which a naive reader would print as good news:
 *
 *   * an empty Common Data Environment traverses perfectly — no broken hops,
 *     no dangling links, no outstanding receipts — for exactly the reason an
 *     unmapped plant has no single points of failure;
 *   * "0 downstream impacts" for an object nobody linked to anything is not
 *     "this change is safe", it is "this change is unassessed";
 *   * "0 outstanding receipts" over a project with no thread is not "every
 *     change has landed".
 *
 * THE SECOND RULE. There is no second graph and no second cascade model.
 * `buildThreadGraph` maps the server payload into the `DependencyGraph` shape
 * `src/lib/interdependency` already defines — thread hops, the anchor edge
 * from every object to the ONE asset it hangs from, and the recorded asset
 * dependencies among those assets, in one node space — and the analysis is
 * `propagateLoss` and `singlePointsOfFailure`, unchanged. A change to a
 * drawing and a loss of the switchgear that drawing hangs on are answered by
 * the same walk.
 *
 * THE THIRD RULE, and it is the whole of D11.20: a BREAK and a GAP are
 * different things and are never summed. A break is a state the database walls
 * refuse (an object with no anchor, a live hop into a retired object, two
 * current revisions) — finding one is an integrity incident. A gap is legal
 * incompleteness (a chain skip, an object nobody released a revision of).
 * Adding them into one "issues" number is how a real integrity failure hides
 * among forty missing vendor documents.
 *
 * Pure: no database, no network.
 */
import {
  propagateLoss,
  singlePointsOfFailure,
  type CascadeResult,
  type DependencyEdge,
  type DependencyGraph,
  type SpofResult,
} from "../interdependency";

/* ───────────────────────── the vocabularies ─────────────────────────────── */

/**
 * Spec II.2's ten thread-object kinds, in the specification's order.
 *
 * The last one is `eam_equipment`, which is II.2's "SAP equipment" under a
 * vendor-neutral name (migration ruling 5C-R1): this product carries SAP,
 * Maximo and generic-CMMS connectors, and a customer on Maximo should not have
 * to write their equipment number into a field called `sap_`.
 */
export const THREAD_OBJECT_KINDS = [
  { key: "requirement", label: "Requirement" },
  { key: "tag", label: "Tag" },
  { key: "equipment_specification", label: "Equipment specification" },
  { key: "vendor_document", label: "Vendor document" },
  { key: "drawing", label: "Drawing" },
  { key: "procurement_item", label: "Procurement item" },
  { key: "installed_equipment", label: "Installed equipment" },
  { key: "commissioning_test", label: "Commissioning test" },
  { key: "eam_equipment", label: "EAM equipment record" },
  { key: "operating_history", label: "Operating history" },
] as const;

/**
 * Spec §26's chain, which is a SUBSEQUENCE of the one above rather than a
 * second chain: DesignObject = equipment specification, ProcuredEquipment =
 * procurement item, InstalledAsset = installed equipment, SAP Equipment = the
 * EAM record.
 */
export const SPEC26_CHAIN = [
  "equipment_specification",
  "procurement_item",
  "installed_equipment",
  "eam_equipment",
] as const;

/** The named forward hops of the CDE link model. */
export const THREAD_LINK_TYPES = [
  { key: "identifies", label: "Identifies" },
  { key: "specifies", label: "Specifies" },
  { key: "documents", label: "Documents" },
  { key: "depicts", label: "Depicts" },
  { key: "procures", label: "Procures" },
  { key: "becomes", label: "Becomes" },
  { key: "verifies", label: "Verifies" },
  { key: "registers", label: "Registers" },
  { key: "records", label: "Records" },
] as const;

export const THREAD_VERSION_STATUSES = [
  "draft",
  "authoritative",
  "superseded",
] as const;

export const THREAD_RECEIPT_STATUSES = [
  "unacknowledged",
  "acknowledged",
  "not_applicable",
] as const;

/** The five routes by which the thread is ALLOWED to come apart. */
export const SEVERANCE_ROUTES = [
  { key: "object_retired", label: "Object retired", byAPerson: true },
  { key: "link_severed", label: "Hop severed", byAPerson: true },
  { key: "object_reanchored", label: "Object re-anchored", byAPerson: true },
  { key: "case_cascade", label: "Case deleted", byAPerson: false },
  { key: "asset_cascade", label: "Anchoring asset deleted", byAPerson: false },
  {
    key: "canonical_cascade",
    label: "Canonical row deleted",
    byAPerson: false,
  },
] as const;

const ROUTE_BY_A_PERSON = new Map<string, boolean>(
  SEVERANCE_ROUTES.map((r) => [r.key as string, r.byAPerson as boolean]),
);

/**
 * Was this severance a decision somebody took?
 *
 * THE ROUTE DECIDES, never the actor column. Both cascade routes record
 * whoever held the session — a planner deleting a case is signed in — so
 * "somebody is named" and "somebody decided" are different facts, and reading
 * the first as the second prints "N were a decision somebody took" next to a
 * row labelled "Case deleted". An unrecognised route returns false: a route
 * this build does not know about is not evidence that a person chose anything.
 */
export function severanceWasADecision(route: string): boolean {
  return ROUTE_BY_A_PERSON.get(route) ?? false;
}

const KIND_LABELS = new Map<string, string>(
  THREAD_OBJECT_KINDS.map((k) => [k.key as string, k.label as string]),
);

export function threadKindLabel(key: string): string {
  return KIND_LABELS.get(key) ?? key;
}

/**
 * The kind's position in the ONE chain, 1-based, or null when the kind is not
 * one of the ten.
 *
 * NULL, never 0. A caller that treated an unknown kind as position zero would
 * make every hop out of it look forward, which is the one arithmetic mistake
 * that turns a cascade around without failing.
 */
export function chainPosition(kind: string): number | null {
  const at = THREAD_OBJECT_KINDS.findIndex((k) => k.key === kind);
  return at === -1 ? null : at + 1;
}

/**
 * How many chain positions this hop skips, or null when either end's position
 * is unknown.
 *
 * A negative or zero difference is a BACKWARD hop and is reported as such by
 * `hopDirection` — this function only measures a forward one.
 */
export function hopSkip(upKind: string, downKind: string): number | null {
  const up = chainPosition(upKind);
  const down = chainPosition(downKind);
  if (up === null || down === null) return null;
  return down - up - 1;
}

export type HopDirection = "forward" | "backward" | "unknown";

export function hopDirection(upKind: string, downKind: string): HopDirection {
  const up = chainPosition(upKind);
  const down = chainPosition(downKind);
  if (up === null || down === null) return "unknown";
  return down > up ? "forward" : "backward";
}

/* ────────────────────────── the server payloads ─────────────────────────── */

export interface ThreadObject {
  id: number;
  objectKind: string;
  objectRef: string;
  title: string;
  chainPosition: number | null;
  canonicalHome: string;
  registeredByReference: boolean;
  anchorAssetId: string | null;
  anchorAssetName: string | null;
  status: string;
  requirementId: number | null;
  commissioningTestId: number | null;
  authoritativeVersion: string | null;
  draftVersions: number;
  /**
   * The unreleased revisions BY ID. A count cannot be released: declaring a
   * revision authoritative takes a version id, so without these the central
   * act of D11.06 has no surface that can invoke it.
   */
  drafts: ThreadDraftVersion[];
  outstandingReceipts: number;
}

export interface ThreadDraftVersion {
  versionId: number;
  versionLabel: string;
  changeSummary?: string | null;
  contentRef?: string | null;
  issuedOn?: string | null;
  recordedAt?: string;
}

export interface Spec34Edge {
  edge: string;
  tail: string;
  head: string;
  home: string;
  status: "live_on_thread" | "live_elsewhere" | "absent" | string;
  note: string;
  caseCount?: number | null;
  countNote?: string;
  countedAs?: string;
}

export interface ThreadGraphPayload {
  caseId: string;
  refused: boolean;
  refusal: string | null;
  objectCount: number;
  liveObjects: number | null;
  objects: ThreadObject[];
  objectKinds: string[];
  spec26Chain: string[];
  linkTypes: string[];
  graph: DependencyGraph;
  threadEdgeCount: number;
  anchorEdgeCount: number;
  assetEdgeCount: number;
  spec34Edges: Spec34Edge[];
  note?: string;
}

export interface ContinuityFinding {
  kind: string;
  detail: string;
  objectId?: number;
  objectRef?: string;
  linkId?: number;
  count?: number;
  skipped?: number;
  draftCount?: number;
}

export interface ThreadContinuityPayload {
  caseId: string;
  refused: boolean;
  refusal?: string | null;
  intact: boolean | null;
  objectCount: number;
  liveObjects?: number;
  retiredObjects?: number;
  linkCount?: number;
  liveLinks?: number;
  severedLinks?: number;
  severanceCount?: number;
  requirementCount: number;
  requirementsRegistered: number;
  breaks: ContinuityFinding[];
  gaps: ContinuityFinding[];
  note?: string;
}

export interface ThreadImpactPayload {
  caseId: string;
  objectId: number;
  objectRef: string;
  objectKind?: string;
  authoritativeVersion?: string | null;
  refused: boolean;
  refusal?: string | null;
  downstreamCount: number | null;
  reachedCount?: number;
  maxHops?: number;
  affected: {
    objectId: number;
    objectRef: string;
    objectKind: string;
    title: string;
    hops: number;
    anchorAssetId: string | null;
    anchorAssetName: string | null;
    authoritativeVersion: string | null;
    outstandingReceipts: number;
  }[];
  gaps: ContinuityFinding[];
  outstandingReceiptsFromThisObject?: number;
}

export interface ThreadReceipt {
  id: number;
  objectId: number;
  objectRef: string;
  objectKind: string;
  sourceObjectRef: string;
  sourceVersionLabel: string;
  changeSummary: string;
  hops: number;
  status: string;
  /**
   * Was this receipt raised over a region the impact read would REFUSE to
   * state? null means nobody assessed it — a third state, not `false`.
   */
  regionGapped: boolean | null;
  regionGapNote: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgementNote: string | null;
  raisedAt: string;
}

export interface ThreadReceiptsPayload {
  caseId: string;
  refused: boolean;
  refusal: string | null;
  objectCount: number;
  total: number | null;
  outstanding: number | null;
  acknowledged: number | null;
  notApplicable: number | null;
  raisedOverAGappedRegion: number | null;
  regionUnassessed: number | null;
  /** Supersessions on this case — how many changes there were to tell anybody about. */
  supersessions: number | null;
  statuses: string[];
  receipts: ThreadReceipt[];
}

export interface AuthoritativeVersionPayload {
  object_id: number;
  objectRef: string;
  objectKind?: string;
  resolved: boolean;
  versionId?: number;
  versionLabel?: string;
  issuedOn?: string | null;
  contentRef?: string | null;
  contentHeld?: boolean;
  changeSummary?: string | null;
  declaredAt?: string | null;
  declaredBy?: string | null;
  declarationBasis?: string | null;
  supersedesVersionId?: number | null;
  supersedesVersionLabel?: string | null;
  draftCount: number;
  drafts?: ThreadDraftVersion[];
  /** `live` or `retired`. A retired object resolves to no current revision. */
  objectStatus?: string;
  /** Named on the refusal for a retired object, so the history is not lost. */
  lastAuthoritativeLabel?: string | null;
  refusal?: string;
}

export interface ThreadSeverance {
  id: number;
  route: string;
  subjectKind: string;
  subjectRef: string;
  snapshot: Record<string, unknown>;
  linksSevered: number;
  reason: string;
  severedAt: string;
  severedBy: string | null;
  byAPerson: boolean;
}

export interface ThreadSeverancesPayload {
  caseId: string;
  refused: boolean;
  refusal: string | null;
  objectCount: number;
  total: number | null;
  severances: ThreadSeverance[];
}

/**
 * The tenant-scoped ledger. The case-scoped read resolves its case first and
 * therefore cannot return `case_cascade` rows — they exist BECAUSE that case is
 * gone. This is the read those rows survive into.
 */
export interface OrgThreadSeverance extends ThreadSeverance {
  caseId: string | null;
  caseTitle: string | null;
  caseDeleted: boolean;
}

export interface OrgThreadSeverancesPayload {
  total: number;
  returned: number;
  limit: number;
  orphaned: number;
  severances: OrgThreadSeverance[];
  note?: string;
}

/* ────────────────────────────── the graph ───────────────────────────────── */

/**
 * The graph the SHARED traversal consumes.
 *
 * A malformed payload produces an EMPTY graph rather than a partially
 * populated one, for the reason `buildInterfaceGraph` states: an empty graph is
 * honestly useless and both traversals say so, whereas a half-built graph
 * reports a clean traversal of the half that survived.
 */
export function buildThreadGraph(
  payload: Pick<ThreadGraphPayload, "graph"> | null | undefined,
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

/**
 * A thread hop as it arrives inside the shared `DependencyGraph`.
 *
 * The canonical `DependencyEdge` is deliberately NOT widened: it belongs to
 * `src/lib/interdependency`, every family emits it, and adding thread-only
 * fields to it would make the shared type a union of everybody's extras. The
 * server does send `linkId` and `linkType` on the thread arm, so this narrows
 * to them at the point of use instead.
 */
export interface ThreadHopEdge extends DependencyEdge {
  linkId?: number;
  linkType?: string;
}

/**
 * The live hops of a case's thread, with the ids needed to sever one.
 *
 * `severThreadLink` takes a link id, and until this exists the id is present in
 * the payload and typed nowhere, so the screen cannot offer the act.
 */
export function liveThreadHops(
  payload: ThreadGraphPayload | null | undefined,
): ThreadHopEdge[] {
  return (payload?.graph?.edges ?? []).filter(
    (e): e is ThreadHopEdge => e.source === "thread_link",
  );
}

/** The reference behind a graph node id, for naming a hop somebody must choose. */
export function threadNodeLabel(
  payload: ThreadGraphPayload | null | undefined,
  nodeId: string,
): string {
  const n = payload?.graph?.nodes?.find((x) => x.id === nodeId);
  return n?.tag ?? n?.name ?? nodeId;
}

export interface ThreadGraphReading {
  refused: boolean;
  headline: string;
  objects: ThreadObject[];
  /** Objects whose kind has no canonical store — registered by reference. */
  byReference: ThreadObject[];
  /** Live objects with no released revision. */
  withoutAuthoritativeVersion: ThreadObject[];
  /** Kinds of the ten that this case has no object for at all. */
  uncoveredKinds: string[];
  /** Straight from the SHARED traversal. Never recomputed here. */
  singlePoints: SpofResult;
  /** §34's nineteen, split by how honest each one can be about itself. */
  spec34: {
    onThread: Spec34Edge[];
    elsewhere: Spec34Edge[];
    absent: Spec34Edge[];
  };
}

/**
 * Read the thread graph (D11.05/D11.21).
 *
 * THE REFUSAL. An empty CDE draws a clean picture. So does a plant nobody
 * mapped. This says which one it is looking at.
 */
export function readThreadGraph(
  payload: ThreadGraphPayload | null | undefined,
): ThreadGraphReading {
  const objects = payload?.objects ?? [];
  const graph = buildThreadGraph(payload);
  const spof = singlePointsOfFailure(graph);
  const edges = payload?.spec34Edges ?? [];
  const spec34 = {
    onThread: edges.filter((e) => e.status === "live_on_thread"),
    elsewhere: edges.filter((e) => e.status === "live_elsewhere"),
    absent: edges.filter((e) => e.status === "absent"),
  };
  const seen = new Set(objects.map((o) => o.objectKind));
  const uncoveredKinds = THREAD_OBJECT_KINDS.filter(
    (k) => !seen.has(k.key),
  ).map((k) => k.label);
  const byReference = objects.filter((o) => o.registeredByReference);
  const withoutAuthoritativeVersion = objects.filter(
    (o) => o.status === "live" && !o.authoritativeVersion,
  );

  if (!payload || payload.refused || objects.length === 0) {
    return {
      refused: true,
      headline:
        payload?.refusal ??
        "No object on this case is registered in the Common Data Environment. An empty thread has no broken hops and no single points of failure for the same reason an unmapped plant has none — this is a refusal, not a clean bill.",
      objects,
      byReference,
      withoutAuthoritativeVersion,
      uncoveredKinds,
      singlePoints: spof,
      spec34,
    };
  }

  const parts: string[] = [
    `${objects.length} object${objects.length === 1 ? "" : "s"} registered across ${THREAD_OBJECT_KINDS.length - uncoveredKinds.length} of the ten spec II.2 kinds, on ${payload.threadEdgeCount} hop${payload.threadEdgeCount === 1 ? "" : "s"}.`,
  ];
  if (withoutAuthoritativeVersion.length > 0) {
    parts.push(
      `${withoutAuthoritativeVersion.length} live object${withoutAuthoritativeVersion.length === 1 ? " has" : "s have"} no released revision, so nothing downstream of ${withoutAuthoritativeVersion.length === 1 ? "it" : "them"} can be said to be current.`,
    );
  }
  if (byReference.length > 0) {
    parts.push(
      `${byReference.length} ${byReference.length === 1 ? "is" : "are"} registered by reference — this product holds the reference, not the document.`,
    );
  }
  if (uncoveredKinds.length > 0) {
    parts.push(
      `${uncoveredKinds.length} of the ten kinds have no object at all (${uncoveredKinds.join(", ")}).`,
    );
  }
  if (spof.reliable && spof.points.length > 0) {
    parts.push(
      `The shared traversal finds ${spof.points.length} node${spof.points.length === 1 ? "" : "s"} whose loss takes something else with it — the thread and the plant are one graph here, so that includes assets taking drawings and packages down with them.`,
    );
  } else if (!spof.reliable) {
    parts.push(
      "The graph has no edges to traverse, so nothing can be said about what a change or a loss would take with it.",
    );
  }
  if (spec34.absent.length > 0) {
    parts.push(
      `${spec34.absent.length} of §34's nineteen relationships have no home yet and are named as absent rather than implied.`,
    );
  }

  return {
    refused: false,
    headline: parts.join(" "),
    objects,
    byReference,
    withoutAuthoritativeVersion,
    uncoveredKinds,
    singlePoints: spof,
    spec34,
  };
}

/**
 * What a loss of one node takes with it, on the SHARED traversal.
 *
 * Exposed separately (rather than folded into the reading) because the panel
 * asks it per node on demand, and because it must be visibly the same
 * `propagateLoss` the asset interdependency surface uses. There is no cascade
 * arithmetic in this module.
 */
export function threadCascade(
  payload: ThreadGraphPayload | null | undefined,
  nodeId: string,
): CascadeResult {
  return propagateLoss(buildThreadGraph(payload), [nodeId]);
}

/** The node id a thread object occupies in the shared graph. */
export function threadNodeId(objectId: number): string {
  return `obj:${objectId}`;
}

/* ─────────────────────── the continuity invariant ───────────────────────── */

export interface ContinuityReading {
  refused: boolean;
  /** null while refused: an unknown invariant is not a satisfied one. */
  intact: boolean | null;
  headline: string;
  breaks: ContinuityFinding[];
  gaps: ContinuityFinding[];
  /** Requirements on the case that never entered the CDE (D11.19's cost). */
  requirementsOutsideCde: number;
}

/**
 * Read the continuity invariant (D11.20).
 *
 * BREAKS AND GAPS ARE NEVER SUMMED. `intact` is about breaks only, and it is
 * NULL while refused — a thread nobody registered is not an intact thread, and
 * returning `true` there would be the single most misleading value this
 * product could produce.
 */
export function readThreadContinuity(
  payload: ThreadContinuityPayload | null | undefined,
): ContinuityReading {
  const breaks = payload?.breaks ?? [];
  const gaps = payload?.gaps ?? [];
  const outside = Math.max(
    (payload?.requirementCount ?? 0) - (payload?.requirementsRegistered ?? 0),
    0,
  );

  if (!payload || payload.refused) {
    return {
      refused: true,
      intact: null,
      headline:
        payload?.refusal ??
        "No object on this case is registered in the Common Data Environment, so there is no thread to check. This is a refusal, not a clean bill: zero breaks over an empty register is indistinguishable from a perfectly maintained thread.",
      breaks,
      gaps,
      requirementsOutsideCde: outside,
    };
  }

  const parts: string[] = [];
  if (breaks.length > 0) {
    parts.push(
      `${breaks.length} BREAK${breaks.length === 1 ? "" : "S"} found. Each one is a state the database walls refuse, so a row reached a table around them — treat this as an integrity incident, not a backlog item.`,
    );
  } else {
    parts.push(
      "No break found: every object resolves to one asset, every live hop runs forward between two live objects, and no object has two current revisions.",
    );
  }
  if (gaps.length > 0) {
    parts.push(
      `${gaps.length} gap${gaps.length === 1 ? "" : "s"} — places the thread is INCOMPLETE, which is a different thing and is not counted against the invariant.`,
    );
  }
  if ((payload.severanceCount ?? 0) > 0) {
    parts.push(
      `${payload.severanceCount} recorded severance${payload.severanceCount === 1 ? "" : "s"}: the thread was allowed to come apart there, and the ledger says why.`,
    );
  }
  if (outside > 0) {
    parts.push(
      `${outside} of the case's ${payload.requirementCount} requirements are not in the CDE at all, so they are not counted as threaded.`,
    );
  }

  return {
    refused: false,
    intact: breaks.length === 0,
    headline: parts.join(" "),
    breaks,
    gaps,
    requirementsOutsideCde: outside,
  };
}

/* ───────────────────────── downstream impact ────────────────────────────── */

export interface ImpactReading {
  refused: boolean;
  headline: string;
  /** null while refused — a floor presented as a count is a wrong answer. */
  downstreamCount: number | null;
  reached: ThreadImpactPayload["affected"];
  gaps: ContinuityFinding[];
}

/**
 * Read a downstream-impact traversal (D11.07).
 *
 * THE REFUSAL. `downstreamCount` is null whenever the traversal refused, even
 * though the server also reports how many objects it reached. Printing the
 * count beside a refusal is how a refusal gets read as an answer with a
 * caveat, and the whole point of this one is that the set reached is a FLOOR.
 */
export function readThreadImpact(
  payload: ThreadImpactPayload | null | undefined,
): ImpactReading {
  const reached = payload?.affected ?? [];
  const gaps = payload?.gaps ?? [];

  if (!payload || payload.refused) {
    return {
      refused: true,
      headline:
        payload?.refusal ??
        "This traversal refuses to report a downstream impact. An empty or gapped thread cannot answer 'what else is affected', and reporting what it could reach as though that were the whole set is the failure the refusal exists to prevent.",
      downstreamCount: null,
      reached,
      gaps,
    };
  }

  const outstanding = reached.reduce((n, a) => n + a.outstandingReceipts, 0);
  const parts = [
    `${payload.downstreamCount} object${payload.downstreamCount === 1 ? "" : "s"} downstream of ${payload.objectRef}, reachable through live hops with no gap on the way — this IS the affected set, not a floor.`,
  ];
  if ((payload.maxHops ?? 0) > 1) {
    parts.push(`The furthest is ${payload.maxHops} hops away.`);
  }
  if (outstanding > 0) {
    parts.push(
      `${outstanding} change receipt${outstanding === 1 ? " is" : "s are"} still unanswered among them.`,
    );
  }

  return {
    refused: false,
    headline: parts.join(" "),
    downstreamCount: payload.downstreamCount,
    reached,
    gaps,
  };
}

/* ───────────────────────── change receipts ──────────────────────────────── */

export interface ReceiptsReading {
  refused: boolean;
  headline: string;
  outstanding: ThreadReceipt[];
  answered: ThreadReceipt[];
  /** null while refused. */
  outstandingCount: number | null;
  /** How many of these receipts were raised over a region the impact read refuses to state. */
  gappedCount?: number;
}

/**
 * Read the case's change receipts (D11.07).
 *
 * UNACKNOWLEDGED IS A STATE. The outstanding list is the answer to spec II.2's
 * "has the operating system received the change" with the answer still
 * missing, and it is refused rather than reported as zero when there is no
 * thread for a change to travel down.
 */
export function readThreadReceipts(
  payload: ThreadReceiptsPayload | null | undefined,
): ReceiptsReading {
  const receipts = payload?.receipts ?? [];
  const outstanding = receipts.filter((r) => r.status === "unacknowledged");
  const answered = receipts.filter((r) => r.status !== "unacknowledged");

  if (!payload || payload.refused) {
    return {
      refused: true,
      headline:
        payload?.refusal ??
        "No object on this case is registered in the Common Data Environment, so no change can raise a receipt and none has. That is not 'every change has landed'.",
      outstanding,
      answered,
      outstandingCount: null,
    };
  }

  if (receipts.length === 0) {
    // TWO STATES PRODUCE ZERO RECEIPTS AND THEY MEAN OPPOSITE THINGS.
    // Nothing has superseded anything (there was no change to tell anyone
    // about), OR a revision DID supersede another and the object it belongs to
    // has no live hop, so the change reached nobody because nobody is joined to
    // it. The second is unassessed, not safe, and it REFUSES rather than
    // printing the first sentence over it.
    if ((payload.supersessions ?? 0) > 0) {
      const n = payload.supersessions ?? 0;
      return {
        refused: true,
        headline: `${n} revision${n === 1 ? " has" : "s have"} superseded another on this case and NOT ONE change receipt was raised, because the object that changed has no live hop leaving it. That is not "the change reached everybody" — it is a change that reached nobody, and nothing downstream was assessed. Link the objects this one feeds (spec II.2) and release again.`,
        outstanding,
        answered,
        outstandingCount: null,
      };
    }
    return {
      refused: false,
      headline:
        "No revision on this case has superseded another yet, so no change receipt has been raised. First issues raise none — there is nothing downstream that was built on a previous revision.",
      outstanding,
      answered,
      outstandingCount: 0,
    };
  }

  const na = answered.filter((r) => r.status === "not_applicable").length;
  // Receipts raised over a region the impact read REFUSES to state. Counted
  // from the rows rather than trusted from a summary field, so an older server
  // that does not send the count still produces the right sentence.
  const gapped = receipts.filter((r) => r.regionGapped === true).length;
  const parts = [
    outstanding.length > 0
      ? `${outstanding.length} change receipt${outstanding.length === 1 ? "" : "s"} unanswered: the revision changed and nobody downstream has said they have it.`
      : gapped > 0
        ? `All ${receipts.length} change receipt${receipts.length === 1 ? "" : "s"} raised on this case have been answered — but this is NOT "the change landed everywhere". ${gapped} of them ${gapped === 1 ? "was" : "were"} raised over a region the impact traversal refuses to call complete, so the set that was told is a floor.`
        : `Every one of the ${receipts.length} change receipt${receipts.length === 1 ? "" : "s"} raised on this case has been answered.`,
  ];
  if (outstanding.length > 0 && gapped > 0) {
    parts.push(
      `${gapped} ${gapped === 1 ? "was" : "were"} raised over a gapped region, so even answering all of them would only mean the change landed everywhere the thread can see.`,
    );
  }
  if (na > 0) {
    parts.push(
      `${na} ${na === 1 ? "was" : "were"} answered as not applicable — somebody looked and recorded that the change does not reach them, which is deliberately not the same state as having updated.`,
    );
  }

  return {
    refused: false,
    headline: parts.join(" "),
    outstanding,
    answered,
    outstandingCount: outstanding.length,
    gappedCount: gapped,
  };
}

/* ─────────────────────── authoritative version ──────────────────────────── */

export interface VersionReading {
  resolved: boolean;
  headline: string;
  versionLabel: string | null;
  contentHeld: boolean;
  /** The object left the thread; nothing on it is current, whatever the version table says. */
  objectRetired: boolean;
  /** The unreleased revisions, by id — what `declare` can be pointed at. */
  drafts: ThreadDraftVersion[];
}

/**
 * Read an authoritative-version resolution (D11.06).
 *
 * The distinction the refusal keeps is between "no revision has been recorded"
 * and "revisions are recorded and none has been released". Collapsing those
 * into one empty answer loses the only one of the two that means somebody is
 * working from an unreleased sheet.
 */
export function readAuthoritativeVersion(
  payload: AuthoritativeVersionPayload | null | undefined,
): VersionReading {
  if (!payload || !payload.resolved) {
    return {
      resolved: false,
      // A RETIRED object is its own refusal, and it is the one that matters
      // most: retiring an object does not touch its version rows, so the
      // incumbent stays `authoritative` in the table for ever. The server
      // names the label so the history is not lost; this reading never
      // presents it as the answer to "what is current".
      headline:
        payload?.refusal ??
        "This object has no authoritative revision, and this reading refuses to present that as an absence of versions.",
      versionLabel: null,
      contentHeld: false,
      objectRetired: payload?.objectStatus === "retired",
      drafts: payload?.drafts ?? [],
    };
  }
  const parts = [
    `${payload.versionLabel} is authoritative${payload.declaredBy ? `, declared by ${payload.declaredBy}` : ""}.`,
  ];
  if (payload.supersedesVersionLabel) {
    parts.push(
      `It superseded ${payload.supersedesVersionLabel}${payload.changeSummary ? `: ${payload.changeSummary}` : ""}`,
    );
  }
  if (!payload.contentHeld) {
    parts.push(
      "The document itself is held elsewhere — this register carries the reference, and says so rather than implying it holds the sheet.",
    );
  }
  if ((payload.draftCount ?? 0) > 0) {
    parts.push(
      `${payload.draftCount} later draft${payload.draftCount === 1 ? "" : "s"} recorded and not released.`,
    );
  }
  return {
    resolved: true,
    headline: parts.join(" "),
    versionLabel: payload.versionLabel ?? null,
    contentHeld: payload.contentHeld ?? false,
    objectRetired: false,
    drafts: payload.drafts ?? [],
  };
}

/* ───────────────────────── severance ledger ─────────────────────────────── */

export interface SeveranceReading {
  refused: boolean;
  headline: string;
  byPerson: ThreadSeverance[];
  byCascade: ThreadSeverance[];
}

/**
 * Read the severance ledger (D11.20).
 *
 * The split is the point: a severance somebody DECIDED on and a severance a
 * cascade caused are different facts, and only the first has a person to ask —
 * and the split is taken from the ROUTE, not from whether an actor column is
 * filled. Both cascades record whoever held the session, so trusting the actor
 * column reports a case deletion as a decision somebody took.
 *
 * "Every hop ever made still holds" is a real, checkable statement about a
 * thread that EXISTS, and a lie about one that does not — so an empty CDE
 * refuses here the same way it refuses in every other reading in this module.
 */
export function readThreadSeverances(
  payload: ThreadSeverancesPayload | null | undefined,
): SeveranceReading {
  const rows = payload?.severances ?? [];
  const byPerson = rows.filter((r) => severanceWasADecision(r.route));
  const byCascade = rows.filter((r) => !severanceWasADecision(r.route));

  if (!payload || payload.refused) {
    return {
      refused: true,
      headline:
        payload?.refusal ??
        "No object on this case is registered in the Common Data Environment, so there is no thread to sever and nothing has been. That is not 'every hop still holds' — there are no hops.",
      byPerson,
      byCascade,
    };
  }

  if (rows.length === 0) {
    return {
      refused: false,
      headline:
        "Nothing on this case's digital thread has been severed. Every hop ever made still holds.",
      byPerson,
      byCascade,
    };
  }
  const parts = [
    `${rows.length} recorded severance${rows.length === 1 ? "" : "s"}.`,
  ];
  if (byPerson.length > 0) {
    const cut = byPerson.reduce((n, r) => n + r.linksSevered, 0);
    parts.push(
      `${byPerson.length} ${byPerson.length === 1 ? "was" : "were"} a decision somebody took${cut > 0 ? `, cutting ${cut} hop${cut === 1 ? "" : "s"}` : ""}.`,
    );
  }
  if (byCascade.length > 0) {
    parts.push(
      `${byCascade.length} came from a cascade — a case or an asset was deleted — so there is no person to ask, only the record.`,
    );
  }
  return { refused: false, headline: parts.join(" "), byPerson, byCascade };
}

/* ──────────────── the ledger at tenant scope (D11.20) ───────────────────── */

export interface OrgSeveranceReading {
  headline: string;
  rows: OrgThreadSeverance[];
  /** Rows whose development case has since been deleted — the case cascades. */
  orphaned: OrgThreadSeverance[];
  truncated: boolean;
}

/**
 * Read the tenant's whole severance ledger (D11.20).
 *
 * This exists because the case-scoped read CANNOT show a `case_cascade` row:
 * it resolves the development case first and refuses when it is gone, and
 * those rows are written precisely because it is gone. A break that is
 * recorded and unreadable is, for the person who has to find out what
 * happened, the same as one that was never recorded — which is the thing
 * D11.20 forbids.
 */
export function readOrgThreadSeverances(
  payload: OrgThreadSeverancesPayload | null | undefined,
): OrgSeveranceReading {
  const rows = payload?.severances ?? [];
  const orphaned = rows.filter((r) => r.caseDeleted);
  const truncated = (payload?.total ?? 0) > rows.length;

  if (rows.length === 0) {
    return {
      headline:
        "Nothing anywhere in this tenant's digital thread has been recorded as severed.",
      rows,
      orphaned,
      truncated: false,
    };
  }
  const parts = [
    `${payload?.total ?? rows.length} recorded severance${(payload?.total ?? rows.length) === 1 ? "" : "s"} across this tenant.`,
  ];
  if (orphaned.length > 0) {
    parts.push(
      `${orphaned.length} belong${orphaned.length === 1 ? "s" : ""} to a development case that has since been deleted — visible here and nowhere else, which is why this read exists.`,
    );
  }
  if (truncated) {
    parts.push(
      `Showing the most recent ${rows.length}; ask for more rather than reading this list as the whole ledger.`,
    );
  }
  return { headline: parts.join(" "), rows, orphaned, truncated };
}
