/**
 * Sync Develop Slice 5C — the digital thread, unit contract.
 *
 * Docker is unavailable on the machine this slice was written on, so the live
 * transcript (scripts/ci-develop-slice5c-smoke.sh) could not be run locally
 * and CI is its first execution. That makes these tests the only executable
 * verification the slice had, so they are written as if nothing downstream
 * will catch a mistake: EVERY refusal in src/lib/develop/thread.ts has a test
 * that asserts it fires, and — where the refusal exists to prevent a specific
 * misreading — a second test asserting the misreading is NOT produced.
 *
 * The three misreadings under test, in order of how much damage they do:
 *   1. `intact: true` over a thread nobody registered.
 *   2. `downstreamCount: 0` for an object nobody linked.
 *   3. `0 outstanding receipts` over a case with no thread.
 */
import { describe, expect, it } from "vitest";
import {
  SEVERANCE_ROUTES,
  SPEC26_CHAIN,
  THREAD_LINK_TYPES,
  THREAD_OBJECT_KINDS,
  THREAD_RECEIPT_STATUSES,
  THREAD_VERSION_STATUSES,
  buildThreadGraph,
  chainPosition,
  hopDirection,
  hopSkip,
  readAuthoritativeVersion,
  readThreadContinuity,
  readThreadGraph,
  readThreadImpact,
  readThreadReceipts,
  liveThreadHops,
  readOrgThreadSeverances,
  readThreadSeverances,
  severanceWasADecision,
  threadCascade,
  threadKindLabel,
  threadNodeId,
  threadNodeLabel,
  type ThreadContinuityPayload,
  type ThreadGraphPayload,
  type ThreadImpactPayload,
  type ThreadObject,
  type ThreadReceipt,
  type ThreadReceiptsPayload,
  type ThreadSeverancesPayload,
} from "./thread";

/* ─────────────────────────────── fixtures ───────────────────────────────── */

const object = (over: Partial<ThreadObject> = {}): ThreadObject => ({
  id: 1,
  objectKind: "drawing",
  objectRef: "S5C-D1",
  title: "Suction line general arrangement",
  chainPosition: 5,
  canonicalHome: "none — registered by reference",
  registeredByReference: true,
  anchorAssetId: "a1",
  anchorAssetName: "Pump 101",
  status: "live",
  requirementId: null,
  commissioningTestId: null,
  authoritativeVersion: "Rev C",
  draftVersions: 0,
  drafts: [],
  outstandingReceipts: 0,
  ...over,
});

const graphPayload = (
  over: Partial<ThreadGraphPayload> = {},
): ThreadGraphPayload => ({
  caseId: "case-1",
  refused: false,
  refusal: null,
  objectCount: 2,
  liveObjects: 2,
  objects: [
    object({
      id: 1,
      objectKind: "requirement",
      objectRef: "S5C-R1",
      chainPosition: 1,
      registeredByReference: false,
      canonicalHome: "design_requirements",
      requirementId: 7,
    }),
    object({
      id: 2,
      objectKind: "drawing",
      objectRef: "S5C-D1",
      chainPosition: 5,
    }),
  ],
  objectKinds: THREAD_OBJECT_KINDS.map((k) => k.key),
  spec26Chain: [...SPEC26_CHAIN],
  linkTypes: THREAD_LINK_TYPES.map((t) => t.key),
  graph: {
    nodes: [
      { id: "obj:1", name: "requirement S5C-R1", tag: "S5C-R1" },
      { id: "obj:2", name: "drawing S5C-D1", tag: "S5C-D1" },
      { id: "a1", name: "Pump 101", tag: "P-101", criticality: "high" },
    ],
    edges: [
      {
        dependent: "obj:2",
        supplier: "obj:1",
        kind: "functional",
        source: "thread_link",
      },
      {
        dependent: "obj:1",
        supplier: "a1",
        kind: "functional",
        source: "thread_anchor",
      },
      {
        dependent: "obj:2",
        supplier: "a1",
        kind: "functional",
        source: "thread_anchor",
      },
    ],
    commonCauseGroups: [],
  },
  threadEdgeCount: 1,
  anchorEdgeCount: 2,
  assetEdgeCount: 0,
  spec34Edges: [
    {
      edge: "Requirement IMPLEMENTED_BY DesignObject",
      tail: "Requirement",
      head: "DesignObject",
      home: "thread_links",
      status: "live_on_thread",
      note: "",
      caseCount: 1,
    },
    {
      edge: "Risk THREATENS Objective",
      tail: "Risk",
      head: "Objective",
      home: "risks.objective_id",
      status: "live_elsewhere",
      note: "",
      caseCount: null,
    },
    {
      edge: "Benefit MEASURES Objective",
      tail: "Benefit",
      head: "Objective",
      home: "none",
      status: "absent",
      note: "",
    },
  ],
  ...over,
});

const continuity = (
  over: Partial<ThreadContinuityPayload> = {},
): ThreadContinuityPayload => ({
  caseId: "case-1",
  refused: false,
  refusal: null,
  intact: true,
  objectCount: 3,
  liveObjects: 3,
  retiredObjects: 0,
  linkCount: 2,
  liveLinks: 2,
  severedLinks: 0,
  severanceCount: 0,
  requirementCount: 4,
  requirementsRegistered: 4,
  breaks: [],
  gaps: [],
  ...over,
});

const impact = (
  over: Partial<ThreadImpactPayload> = {},
): ThreadImpactPayload => ({
  caseId: "case-1",
  objectId: 1,
  objectRef: "S5C-R1",
  objectKind: "requirement",
  authoritativeVersion: "Rev A",
  refused: false,
  refusal: null,
  downstreamCount: 2,
  reachedCount: 2,
  maxHops: 2,
  affected: [
    {
      objectId: 2,
      objectRef: "S5C-D1",
      objectKind: "drawing",
      title: "GA",
      hops: 1,
      anchorAssetId: "a1",
      anchorAssetName: "Pump 101",
      authoritativeVersion: "Rev C",
      outstandingReceipts: 1,
    },
    {
      objectId: 3,
      objectRef: "S5C-P1",
      objectKind: "procurement_item",
      title: "PO 44",
      hops: 2,
      anchorAssetId: "a1",
      anchorAssetName: "Pump 101",
      authoritativeVersion: "Rev 1",
      outstandingReceipts: 0,
    },
  ],
  gaps: [],
  outstandingReceiptsFromThisObject: 1,
  ...over,
});

const receipt = (over: Partial<ThreadReceipt> = {}): ThreadReceipt => ({
  id: 1,
  objectId: 2,
  objectRef: "S5C-D1",
  objectKind: "drawing",
  sourceObjectRef: "S5C-R1",
  sourceVersionLabel: "Rev B",
  changeSummary: "Design pressure raised from 12 to 16 barg",
  hops: 1,
  status: "unacknowledged",
  regionGapped: false,
  regionGapNote: null,
  acknowledgedBy: null,
  acknowledgedAt: null,
  acknowledgementNote: null,
  raisedAt: "2026-09-01T00:00:00Z",
  ...over,
});

const receipts = (
  over: Partial<ThreadReceiptsPayload> = {},
): ThreadReceiptsPayload => ({
  caseId: "case-1",
  refused: false,
  refusal: null,
  objectCount: 3,
  total: 1,
  outstanding: 1,
  acknowledged: 0,
  notApplicable: 0,
  raisedOverAGappedRegion: 0,
  regionUnassessed: 0,
  supersessions: 1,
  statuses: [...THREAD_RECEIPT_STATUSES],
  receipts: [receipt()],
  ...over,
});

/* ─────────────────────────── the vocabularies ───────────────────────────── */

describe("the ONE chain (spec II.2 / §26, migration ruling 5C-R1)", () => {
  it("carries all ten II.2 kinds, in the specification's order", () => {
    expect(THREAD_OBJECT_KINDS.map((k) => k.key)).toEqual([
      "requirement",
      "tag",
      "equipment_specification",
      "vendor_document",
      "drawing",
      "procurement_item",
      "installed_equipment",
      "commissioning_test",
      "eam_equipment",
      "operating_history",
    ]);
  });

  it("names the last kind vendor-neutrally, not after SAP", () => {
    const keys = THREAD_OBJECT_KINDS.map((k) => k.key).join(" ");
    expect(keys).not.toMatch(/sap/i);
    expect(keys).toContain("eam_equipment");
  });

  it("makes §26's four-hop chain a SUBSEQUENCE of the ten, not a second one", () => {
    const order = THREAD_OBJECT_KINDS.map((k) => k.key);
    const positions = SPEC26_CHAIN.map((k) => order.indexOf(k));
    expect(positions.every((p) => p >= 0)).toBe(true);
    // strictly increasing == a subsequence in the same direction
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("positions are 1-based and NULL — never 0 — for an unknown kind", () => {
    expect(chainPosition("requirement")).toBe(1);
    expect(chainPosition("operating_history")).toBe(10);
    expect(chainPosition("neo4j_node")).toBeNull();
  });

  it("labels an unknown kind as itself rather than blank", () => {
    expect(threadKindLabel("drawing")).toBe("Drawing");
    expect(threadKindLabel("nonsense")).toBe("nonsense");
  });

  it("names nine link types and three version and receipt states", () => {
    expect(THREAD_LINK_TYPES).toHaveLength(9);
    expect(THREAD_VERSION_STATUSES).toEqual([
      "draft",
      "authoritative",
      "superseded",
    ]);
    expect(THREAD_RECEIPT_STATUSES).toEqual([
      "unacknowledged",
      "acknowledged",
      "not_applicable",
    ]);
  });

  it("marks the three cascade routes as having no person to ask", () => {
    expect(
      SEVERANCE_ROUTES.filter((r) => !r.byAPerson).map((r) => r.key),
    ).toEqual(["case_cascade", "asset_cascade", "canonical_cascade"]);
  });
});

describe("hop direction and skip (ruling 5C-R3 / 5C-R10)", () => {
  it("a forward adjacent hop skips nothing", () => {
    expect(hopSkip("requirement", "tag")).toBe(0);
    expect(hopDirection("requirement", "tag")).toBe("forward");
  });

  it("a forward hop that jumps reports how many positions it jumped", () => {
    expect(hopSkip("requirement", "drawing")).toBe(3);
    expect(hopDirection("requirement", "drawing")).toBe("forward");
  });

  it("a backward hop is BACKWARD, not a negative skip presented as forward", () => {
    expect(hopDirection("drawing", "requirement")).toBe("backward");
  });

  it("a same-kind hop is backward, because it does not advance the chain", () => {
    expect(hopDirection("drawing", "drawing")).toBe("backward");
  });

  it("an unknown kind is UNKNOWN in both directions — never treated as zero", () => {
    expect(hopDirection("mystery", "drawing")).toBe("unknown");
    expect(hopDirection("drawing", "mystery")).toBe("unknown");
    expect(hopSkip("mystery", "drawing")).toBeNull();
  });
});

/* ───────────────────────────── the ONE graph ────────────────────────────── */

describe("buildThreadGraph — one graph or none", () => {
  it("passes the server payload through unchanged", () => {
    const g = buildThreadGraph(graphPayload());
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(3);
  });

  it("returns an EMPTY graph for a malformed payload, never a half-built one", () => {
    for (const bad of [
      null,
      undefined,
      {} as never,
      { graph: null } as never,
      { graph: { nodes: "x", edges: [] } } as never,
      { graph: { nodes: [], edges: null } } as never,
    ]) {
      const g = buildThreadGraph(bad);
      expect(g.nodes).toEqual([]);
      expect(g.edges).toEqual([]);
      expect(g.commonCauseGroups).toEqual([]);
    }
  });

  it("tolerates a missing commonCauseGroups without dropping the edges", () => {
    const g = buildThreadGraph({
      graph: { nodes: [{ id: "a", name: "A" }], edges: [] },
    } as never);
    expect(g.nodes).toHaveLength(1);
    expect(g.commonCauseGroups).toEqual([]);
  });

  it("uses the SHARED traversal for a cascade — no arithmetic of its own", () => {
    // Losing the anchoring asset takes both thread objects with it, because
    // the anchor edges put the thread and the plant in ONE node space.
    const result = threadCascade(graphPayload(), "a1");
    expect(result.reliable).toBe(true);
    const lost = result.impacted
      .filter((i) => i.state === "lost")
      .map((i) => i.id);
    expect(lost).toContain("obj:1");
    expect(lost).toContain("obj:2");
  });

  it("names a thread node the same way the server does", () => {
    expect(threadNodeId(42)).toBe("obj:42");
  });
});

describe("readThreadGraph — the empty-CDE refusal (D11.05/D11.21)", () => {
  it("REFUSES an empty register rather than drawing a clean picture", () => {
    const r = readThreadGraph(
      graphPayload({
        objects: [],
        objectCount: 0,
        refused: true,
        refusal: "nothing registered",
      }),
    );
    expect(r.refused).toBe(true);
    expect(r.headline).toContain("nothing registered");
  });

  it("refuses on an empty object list even when the server forgot to", () => {
    const r = readThreadGraph(graphPayload({ objects: [], objectCount: 0 }));
    expect(r.refused).toBe(true);
    expect(r.headline).toMatch(/unmapped plant/i);
  });

  it("refuses a null payload rather than throwing or reporting zero", () => {
    const r = readThreadGraph(null);
    expect(r.refused).toBe(true);
    expect(r.objects).toEqual([]);
  });

  it("names the kinds with no object at all rather than counting them covered", () => {
    const r = readThreadGraph(graphPayload());
    expect(r.uncoveredKinds).toContain("Vendor document");
    expect(r.uncoveredKinds).toContain("Operating history");
    expect(r.headline).toContain("have no object at all");
  });

  it("says which objects are held only by reference", () => {
    const r = readThreadGraph(graphPayload());
    expect(r.byReference.map((o) => o.objectRef)).toEqual(["S5C-D1"]);
    expect(r.headline).toMatch(/holds the reference, not the document/);
  });

  it("names live objects with no released revision", () => {
    const r = readThreadGraph(
      graphPayload({
        objects: [
          object({ id: 9, authoritativeVersion: null, draftVersions: 2 }),
        ],
        objectCount: 1,
      }),
    );
    expect(r.withoutAuthoritativeVersion).toHaveLength(1);
    expect(r.headline).toMatch(/no released revision/);
  });

  it("does not count a RETIRED object as missing a revision", () => {
    const r = readThreadGraph(
      graphPayload({
        objects: [
          object({ id: 9, status: "retired", authoritativeVersion: null }),
        ],
        objectCount: 1,
      }),
    );
    expect(r.withoutAuthoritativeVersion).toHaveLength(0);
  });

  it("splits §34's nineteen by honesty and names the absent ones", () => {
    const r = readThreadGraph(graphPayload());
    expect(r.spec34.onThread.map((e) => e.edge)).toEqual([
      "Requirement IMPLEMENTED_BY DesignObject",
    ]);
    expect(r.spec34.elsewhere).toHaveLength(1);
    expect(r.spec34.absent).toHaveLength(1);
    expect(r.headline).toMatch(/named as absent rather than implied/);
  });

  it("says the graph cannot be traversed when it has no edges", () => {
    const r = readThreadGraph(
      graphPayload({
        graph: {
          nodes: [{ id: "obj:1", name: "x" }],
          edges: [],
          commonCauseGroups: [],
        },
      }),
    );
    expect(r.headline).toMatch(/no edges to traverse/);
    expect(r.singlePoints.reliable).toBe(false);
  });
});

/* ───────────────────── the continuity invariant (D11.20) ────────────────── */

describe("readThreadContinuity — breaks, gaps, and the refusal", () => {
  it("REFUSES an empty CDE and reports intact as NULL, never true", () => {
    const r = readThreadContinuity(
      continuity({
        refused: true,
        intact: null,
        objectCount: 0,
        refusal: "nothing to check",
      }),
    );
    expect(r.refused).toBe(true);
    expect(r.intact).toBeNull();
    expect(r.headline).toContain("nothing to check");
  });

  it("refuses a null payload with intact NULL — the value that must never be true", () => {
    const r = readThreadContinuity(null);
    expect(r.refused).toBe(true);
    expect(r.intact).toBeNull();
    expect(r.intact).not.toBe(true);
  });

  it("reports intact when there are no breaks", () => {
    const r = readThreadContinuity(continuity());
    expect(r.refused).toBe(false);
    expect(r.intact).toBe(true);
    expect(r.headline).toMatch(/No break found/);
  });

  it("a BREAK makes it not intact, and says integrity incident", () => {
    const r = readThreadContinuity(
      continuity({
        intact: false,
        breaks: [{ kind: "anchor_loss", detail: "S5C-D1 has no anchor" }],
      }),
    );
    expect(r.intact).toBe(false);
    expect(r.headline).toMatch(/integrity incident/);
  });

  it("GAPS ALONE DO NOT BREAK THE INVARIANT — they are never summed with breaks", () => {
    const r = readThreadContinuity(
      continuity({
        gaps: [
          { kind: "chain_skip", detail: "skips 2" },
          { kind: "no_authoritative_version", detail: "S5C-D1" },
          { kind: "isolated_object", detail: "S5C-T1" },
        ],
      }),
    );
    expect(r.intact).toBe(true);
    expect(r.gaps).toHaveLength(3);
    expect(r.breaks).toHaveLength(0);
    expect(r.headline).toMatch(
      /is a different thing and is not counted against the invariant/,
    );
  });

  it("counts the requirements that never entered the CDE (D11.19's stated cost)", () => {
    const r = readThreadContinuity(
      continuity({ requirementCount: 9, requirementsRegistered: 2 }),
    );
    expect(r.requirementsOutsideCde).toBe(7);
    expect(r.headline).toMatch(/not counted as threaded/);
  });

  it("never reports a negative outside-CDE count if the server disagrees with itself", () => {
    const r = readThreadContinuity(
      continuity({ requirementCount: 1, requirementsRegistered: 4 }),
    );
    expect(r.requirementsOutsideCde).toBe(0);
  });

  it("surfaces recorded severances as recorded, not as breaks", () => {
    const r = readThreadContinuity(continuity({ severanceCount: 3 }));
    expect(r.intact).toBe(true);
    expect(r.headline).toMatch(/3 recorded severances/);
    expect(r.headline).toMatch(/the ledger says why/);
  });
});

/* ─────────────────────── downstream impact (D11.07) ─────────────────────── */

describe("readThreadImpact — the refusal that must never read as safe", () => {
  it("REFUSES an object with no live hop and never says 0 downstream impacts", () => {
    const r = readThreadImpact(
      impact({
        refused: true,
        downstreamCount: null,
        affected: [],
        refusal:
          "S5C-R1 has no live hop leaving it, so this traversal reaches nothing.",
      }),
    );
    expect(r.refused).toBe(true);
    expect(r.downstreamCount).toBeNull();
    expect(r.headline).not.toMatch(/0 downstream/);
  });

  it("REFUSES when a gap was found inside the region it walked, and nulls the count", () => {
    const r = readThreadImpact(
      impact({
        refused: true,
        downstreamCount: null,
        reachedCount: 2,
        gaps: [{ kind: "chain_skip", detail: "S5C-R1 → S5C-D1 skips 3" }],
        refusal: "gaps found",
      }),
    );
    expect(r.refused).toBe(true);
    // The set it REACHED is still shown — a floor is useful — but the COUNT
    // is null, because a floor presented as a count is a wrong answer.
    expect(r.reached).toHaveLength(2);
    expect(r.downstreamCount).toBeNull();
    expect(r.gaps).toHaveLength(1);
  });

  it("refuses a null payload rather than reporting an empty affected set", () => {
    const r = readThreadImpact(null);
    expect(r.refused).toBe(true);
    expect(r.downstreamCount).toBeNull();
  });

  it("reports the affected set when there is no gap, and says it is not a floor", () => {
    const r = readThreadImpact(impact());
    expect(r.refused).toBe(false);
    expect(r.downstreamCount).toBe(2);
    expect(r.headline).toMatch(/this IS the affected set, not a floor/);
  });

  it("counts unanswered receipts among the affected", () => {
    const r = readThreadImpact(impact());
    expect(r.headline).toMatch(/1 change receipt is still unanswered/);
  });

  it("singularises one downstream object correctly", () => {
    const r = readThreadImpact(
      impact({
        downstreamCount: 1,
        affected: [impact().affected[0]],
        maxHops: 1,
      }),
    );
    expect(r.headline).toMatch(/^1 object downstream/);
  });
});

/* ───────────────────────── change receipts (D11.07) ─────────────────────── */

describe("readThreadReceipts — unacknowledged is a state, not an absence", () => {
  it("REFUSES over a case with no CDE rather than reporting zero outstanding", () => {
    const r = readThreadReceipts(
      receipts({
        refused: true,
        objectCount: 0,
        total: null,
        outstanding: null,
        receipts: [],
        refusal: "no thread for a change to travel down",
      }),
    );
    expect(r.refused).toBe(true);
    expect(r.outstandingCount).toBeNull();
    expect(r.headline).toContain("no thread for a change to travel down");
  });

  it("refuses a null payload with a null count, never 0", () => {
    const r = readThreadReceipts(null);
    expect(r.refused).toBe(true);
    expect(r.outstandingCount).toBeNull();
  });

  it("distinguishes 'no supersession yet' from 'no thread' — and does not refuse it", () => {
    const r = readThreadReceipts(
      receipts({ receipts: [], total: 0, outstanding: 0, supersessions: 0 }),
    );
    expect(r.refused).toBe(false);
    expect(r.outstandingCount).toBe(0);
    expect(r.headline).toMatch(/First issues raise none/);
  });

  it("names the outstanding ones as the unanswered question they are", () => {
    const r = readThreadReceipts(receipts());
    expect(r.outstanding).toHaveLength(1);
    expect(r.headline).toMatch(/nobody downstream has said they have it/);
  });

  it("keeps `not_applicable` distinct from `acknowledged`", () => {
    const r = readThreadReceipts(
      receipts({
        outstanding: 0,
        acknowledged: 1,
        notApplicable: 1,
        total: 2,
        receipts: [
          receipt({ id: 1, status: "acknowledged", acknowledgedBy: "Ana" }),
          receipt({ id: 2, status: "not_applicable", acknowledgedBy: "Bo" }),
        ],
      }),
    );
    expect(r.outstanding).toHaveLength(0);
    expect(r.answered).toHaveLength(2);
    expect(r.headline).toMatch(
      /deliberately not the same state as having updated/,
    );
  });
});

/* ─────────────────── authoritative version (D11.06) ─────────────────────── */

describe("readAuthoritativeVersion — which empty it is", () => {
  it("refuses an unresolved object and carries the server's distinction", () => {
    const r = readAuthoritativeVersion({
      object_id: 1,
      objectRef: "S5C-D1",
      resolved: false,
      draftCount: 3,
      refusal:
        "3 revisions of S5C-D1 are recorded and NONE has been declared authoritative.",
    });
    expect(r.resolved).toBe(false);
    expect(r.versionLabel).toBeNull();
    expect(r.headline).toMatch(/NONE has been declared authoritative/);
  });

  it("refuses a null payload without claiming a version", () => {
    const r = readAuthoritativeVersion(null);
    expect(r.resolved).toBe(false);
    expect(r.versionLabel).toBeNull();
  });

  it("reports the released revision, who released it, and what it superseded", () => {
    const r = readAuthoritativeVersion({
      object_id: 1,
      objectRef: "S5C-D1",
      resolved: true,
      versionId: 5,
      versionLabel: "Rev C",
      contentRef: "vault://d1/revC",
      contentHeld: true,
      changeSummary: "Nozzle orientation corrected",
      declaredBy: "Ana Silva",
      supersedesVersionLabel: "Rev B",
      draftCount: 0,
    });
    expect(r.resolved).toBe(true);
    expect(r.versionLabel).toBe("Rev C");
    expect(r.headline).toMatch(/declared by Ana Silva/);
    expect(r.headline).toMatch(/superseded Rev B/);
  });

  it("says the document is held elsewhere rather than implying it holds it", () => {
    const r = readAuthoritativeVersion({
      object_id: 1,
      objectRef: "S5C-D1",
      resolved: true,
      versionLabel: "Rev C",
      contentHeld: false,
      draftCount: 2,
    });
    expect(r.contentHeld).toBe(false);
    expect(r.headline).toMatch(/held elsewhere/);
    expect(r.headline).toMatch(/2 later drafts recorded and not released/);
  });
});

/* ───────────────────── the severance ledger (D11.20) ────────────────────── */

describe("readThreadSeverances — a decision and a cascade are different facts", () => {
  const sev = (over: Partial<import("./thread").ThreadSeverance> = {}) => ({
    id: 1,
    route: "link_severed",
    subjectKind: "thread_link",
    subjectRef: "S5C-R1 → S5C-D1 (specifies)",
    snapshot: {},
    linksSevered: 1,
    reason: "The tie-in was moved to the new header, this hop no longer holds",
    severedAt: "2026-09-01T00:00:00Z",
    severedBy: "Ana Silva",
    byAPerson: true,
    ...over,
  });

  const ledger = (
    over: Partial<ThreadSeverancesPayload> = {},
  ): ThreadSeverancesPayload => ({
    caseId: "c",
    refused: false,
    refusal: null,
    objectCount: 4,
    total: 0,
    severances: [],
    ...over,
  });

  it("an empty ledger over a thread that EXISTS is good news and is reported as such", () => {
    const r = readThreadSeverances(ledger());
    expect(r.refused).toBe(false);
    expect(r.headline).toMatch(/Every hop ever made still holds/);
    expect(r.byPerson).toEqual([]);
    expect(r.byCascade).toEqual([]);
  });

  it("REFUSES over an empty CDE instead of claiming every hop still holds", () => {
    const r = readThreadSeverances(
      ledger({
        refused: true,
        objectCount: 0,
        total: null,
        refusal:
          "No object on this case is registered in the Common Data Environment, so there is no thread to sever and nothing has been.",
      }),
    );
    expect(r.refused).toBe(true);
    expect(r.headline).not.toMatch(/Every hop ever made still holds/);
    expect(r.headline).toMatch(/no thread to sever/);
  });

  it("splits decisions from cascades, because only one has a person to ask", () => {
    const r = readThreadSeverances(
      ledger({
        total: 2,
        severances: [
          sev(),
          sev({
            id: 2,
            route: "case_cascade",
            byAPerson: false,
            severedBy: null,
            linksSevered: 4,
          }),
        ],
      }),
    );
    expect(r.byPerson).toHaveLength(1);
    expect(r.byCascade).toHaveLength(1);
    expect(r.headline).toMatch(/no person to ask, only the record/);
  });

  // Both cascade routes pass auth.uid(), so the actor column is FILLED on a
  // cascade. Trusting it reports a case deletion as a decision somebody took,
  // beside a route label that says "Case deleted".
  it("attributes by ROUTE, not by whether an actor is named on the row", () => {
    const r = readThreadSeverances(
      ledger({
        total: 2,
        severances: [
          sev({
            id: 1,
            route: "case_cascade",
            byAPerson: true,
            severedBy: "Ana Silva",
            linksSevered: 5,
          }),
          sev({
            id: 2,
            route: "asset_cascade",
            byAPerson: true,
            severedBy: "Ana Silva",
          }),
        ],
      }),
    );
    expect(r.byPerson).toEqual([]);
    expect(r.byCascade).toHaveLength(2);
    expect(r.headline).not.toMatch(/decision somebody took/);
  });

  it("treats the canonical-row cascade as a cascade too", () => {
    const r = readThreadSeverances(
      ledger({
        total: 1,
        severances: [
          sev({
            route: "canonical_cascade",
            byAPerson: true,
            severedBy: "Ana Silva",
          }),
        ],
      }),
    );
    expect(r.byCascade).toHaveLength(1);
    expect(r.byPerson).toEqual([]);
  });

  it("an unknown route is never counted as somebody's decision", () => {
    expect(severanceWasADecision("some_route_a_later_slice_added")).toBe(false);
  });

  it("counts the hops a person's decision cut", () => {
    const r = readThreadSeverances(
      ledger({
        total: 1,
        severances: [sev({ route: "object_retired", linksSevered: 3 })],
      }),
    );
    expect(r.headline).toMatch(/cutting 3 hops/);
  });

  it("tolerates a null payload without inventing a clean ledger claim", () => {
    const r = readThreadSeverances(null);
    expect(r.byPerson).toEqual([]);
    expect(r.byCascade).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * REPAIR PASS — the readings that asserted more than the payload supports.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("REPAIR — readThreadReceipts", () => {
  const receipt2 = (over: Partial<ThreadReceipt> = {}): ThreadReceipt => ({
    id: 1,
    objectId: 2,
    objectRef: "S5C-D1",
    objectKind: "drawing",
    sourceObjectRef: "S5C-ES1",
    sourceVersionLabel: "Rev C",
    changeSummary: "Design pressure raised from 12 to 16 barg",
    hops: 1,
    status: "acknowledged",
    regionGapped: false,
    regionGapNote: null,
    acknowledgedBy: "Ana Silva",
    acknowledgedAt: "2026-09-01T00:00:00Z",
    acknowledgementNote:
      "Updated the isometric and reissued it to the fabricator",
    raisedAt: "2026-09-01T00:00:00Z",
    ...over,
  });
  const payload = (
    over: Partial<ThreadReceiptsPayload> = {},
  ): ThreadReceiptsPayload => ({
    caseId: "c",
    refused: false,
    refusal: null,
    objectCount: 4,
    total: 0,
    outstanding: 0,
    acknowledged: 0,
    notApplicable: 0,
    raisedOverAGappedRegion: 0,
    regionUnassessed: 0,
    supersessions: 0,
    statuses: [...THREAD_RECEIPT_STATUSES],
    receipts: [],
    ...over,
  });

  // Two states produce zero receipts and they mean opposite things.
  it("REFUSES when a supersession happened and raised no receipt at all", () => {
    const r = readThreadReceipts(payload({ supersessions: 2 }));
    expect(r.refused).toBe(true);
    expect(r.outstandingCount).toBeNull();
    expect(r.headline).toMatch(/reached nobody/);
    expect(r.headline).not.toMatch(
      /No revision on this case has superseded another/,
    );
  });

  it("still reports the honest zero when nothing has superseded anything", () => {
    const r = readThreadReceipts(payload({ supersessions: 0 }));
    expect(r.refused).toBe(false);
    expect(r.outstandingCount).toBe(0);
    expect(r.headline).toMatch(
      /No revision on this case has superseded another/,
    );
  });

  // The sibling read REFUSES to state the affected set over a gapped region;
  // saying "every receipt has been answered" about that same region reads as
  // "the change landed everywhere".
  it("will not call a gapped region complete once every receipt is answered", () => {
    const r = readThreadReceipts(
      payload({
        total: 2,
        acknowledged: 2,
        supersessions: 1,
        raisedOverAGappedRegion: 2,
        receipts: [
          receipt2({
            id: 1,
            regionGapped: true,
            regionGapNote:
              "The hop S5C-ES1 → S5C-DR1 skips 1 chain position(s).",
          }),
          receipt2({ id: 2, regionGapped: true }),
        ],
      }),
    );
    expect(r.refused).toBe(false);
    expect(r.gappedCount).toBe(2);
    expect(r.headline).toMatch(/NOT "the change landed everywhere"/);
    expect(r.headline).toMatch(/floor/);
    expect(r.headline).not.toMatch(/^Every one of the/);
  });

  it("keeps the plain completion sentence when the region was clean", () => {
    const r = readThreadReceipts(
      payload({
        total: 1,
        acknowledged: 1,
        supersessions: 1,
        receipts: [receipt2()],
      }),
    );
    expect(r.gappedCount).toBe(0);
    expect(r.headline).toMatch(
      /Every one of the 1 change receipt raised on this case has been answered/,
    );
  });
});

describe("REPAIR — readAuthoritativeVersion on a retired object", () => {
  it("does not present the last released revision as the current one", () => {
    const r = readAuthoritativeVersion({
      object_id: 7,
      objectRef: "S5C-VD1",
      objectStatus: "retired",
      resolved: false,
      draftCount: 0,
      drafts: [],
      lastAuthoritativeLabel: "Rev B",
      refusal:
        'S5C-VD1 is RETIRED — out of the digital thread on the record. Revision "Rev B" is still the last one that was declared authoritative.',
    });
    expect(r.resolved).toBe(false);
    expect(r.objectRetired).toBe(true);
    expect(r.versionLabel).toBeNull();
    expect(r.headline).toMatch(/RETIRED/);
    expect(r.headline).not.toMatch(/Rev B is authoritative/);
  });

  it("carries the drafts through so the release act has an id to point at", () => {
    const r = readAuthoritativeVersion({
      object_id: 7,
      objectRef: "S5C-ES1",
      resolved: false,
      draftCount: 1,
      drafts: [{ versionId: 42, versionLabel: "Rev D" }],
      refusal:
        "1 revision(s) are recorded and NONE has been declared authoritative.",
    });
    expect(r.drafts).toEqual([{ versionId: 42, versionLabel: "Rev D" }]);
  });
});

describe("REPAIR — readOrgThreadSeverances", () => {
  const row = (over = {}) => ({
    id: 1,
    route: "case_cascade",
    subjectKind: "thread_object",
    subjectRef: "drawing S5C-DR1",
    snapshot: {},
    linksSevered: 3,
    reason: "The development case this thread object belonged to was deleted.",
    severedAt: "2026-09-01T00:00:00Z",
    severedBy: "Ana Silva",
    byAPerson: false,
    caseId: "case-gone",
    caseTitle: null,
    caseDeleted: true,
    ...over,
  });

  // The case-scoped read refuses on the very case a case_cascade row records
  // the loss of, so these rows are visible here and nowhere else.
  it("surfaces the rows whose development case has been deleted", () => {
    const r = readOrgThreadSeverances({
      total: 2,
      returned: 2,
      limit: 200,
      orphaned: 1,
      severances: [
        row(),
        row({
          id: 2,
          route: "link_severed",
          caseDeleted: false,
          caseTitle: "S5C thread case",
        }),
      ],
    });
    expect(r.orphaned).toHaveLength(1);
    expect(r.headline).toMatch(/visible here and nowhere else/);
  });

  it("says so when the list is truncated rather than reading as the whole ledger", () => {
    const r = readOrgThreadSeverances({
      total: 500,
      returned: 1,
      limit: 1,
      orphaned: 0,
      severances: [row({ caseDeleted: false })],
    });
    expect(r.truncated).toBe(true);
    expect(r.headline).toMatch(/ask for more/);
  });
});

describe("REPAIR — the hop a person must choose is nameable", () => {
  it("returns the live thread hops with the link ids severThreadLink needs", () => {
    const hops = liveThreadHops({
      graph: {
        nodes: [
          { id: "obj:1", name: "requirement S5C-R1", tag: "S5C-R1" },
          { id: "obj:2", name: "drawing S5C-D1", tag: "S5C-D1" },
        ],
        edges: [
          {
            dependent: "obj:2",
            supplier: "obj:1",
            kind: "functional",
            source: "thread_link",
            linkId: 9,
            linkType: "specifies",
          },
          {
            dependent: "obj:1",
            supplier: "a1",
            kind: "functional",
            source: "thread_anchor",
          },
        ],
        commonCauseGroups: [],
      },
    } as unknown as ThreadGraphPayload);
    expect(hops).toHaveLength(1);
    expect(hops[0].linkId).toBe(9);
  });

  it("names a node by its reference, not by its raw obj: id", () => {
    const g = {
      graph: {
        nodes: [{ id: "obj:1", name: "requirement S5C-R1", tag: "S5C-R1" }],
        edges: [],
        commonCauseGroups: [],
      },
    } as unknown as ThreadGraphPayload;
    expect(threadNodeLabel(g, "obj:1")).toBe("S5C-R1");
    expect(threadNodeLabel(g, "obj:99")).toBe("obj:99");
  });
});
