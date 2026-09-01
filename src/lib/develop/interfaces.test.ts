/**
 * Sync Develop Slice 5B — the Interface object (D4.18, spec III.§19).
 *
 * The refusals are the point, and there are three of them: an empty register
 * traverses perfectly and must not be reported as a project with no
 * boundaries; an open interface with no required-by date can never be late and
 * must be named as such rather than counted as fine; and a graph with no edges
 * says nothing, which is different from saying nothing is at risk.
 *
 * There is deliberately NO test of cascade arithmetic here, because this
 * module contains none: `src/lib/interdependency/interdependency.test.ts` owns
 * that, and a second set of expectations over the same traversal is how two
 * answers to one question get born.
 */
import { describe, expect, it } from "vitest";
import {
  INTERFACE_STATUSES,
  INTERFACE_TYPES,
  buildInterfaceGraph,
  interfaceTypeLabel,
  readInterfaceExposure,
  type CaseInterface,
  type InterfaceGraphPayload,
} from "./interfaces";

const iface = (over: Partial<CaseInterface> = {}): CaseInterface => ({
  id: 1,
  interfaceRef: "IF-1",
  sourceObject: "New thickener package",
  targetObject: "Existing tails header",
  sourceAssetId: null,
  targetAssetId: null,
  interfaceType: "physical",
  traversalKind: "functional",
  ownerId: "u1",
  owner: "A Person",
  requirement: "Tie-in spool agreed and isolation point confirmed",
  requirementId: null,
  requirementRef: null,
  dueDate: "2026-01-01",
  status: "identified",
  statusNote: null,
  overdue: false,
  daysLate: null,
  ...over,
});

const payload = (
  over: Partial<InterfaceGraphPayload> = {},
): InterfaceGraphPayload => ({
  caseId: "c1",
  refused: false,
  refusal: null,
  interfaces: [],
  total: 0,
  openCount: 0,
  overdueCount: 0,
  openWithoutDueDate: 0,
  graph: { nodes: [], edges: [], commonCauseGroups: [] },
  assetEdgeCount: 0,
  interfaceEdgeCount: 0,
  ...over,
});

describe("the seven §19 types and the stated lifecycle", () => {
  it("names all seven types, in the specification's order", () => {
    expect(INTERFACE_TYPES.map((t) => t.key)).toEqual([
      "physical",
      "process",
      "electrical",
      "control",
      "data",
      "organizational",
      "contractual",
    ]);
  });

  it("carries the five statuses including the one the spec omits", () => {
    expect(INTERFACE_STATUSES.map((s) => s.key)).toContain("disputed");
    expect(INTERFACE_STATUSES).toHaveLength(5);
  });

  it("labels a type it knows and passes through one it does not", () => {
    expect(interfaceTypeLabel("organizational")).toBe("Organizational");
    expect(interfaceTypeLabel("telepathic")).toBe("telepathic");
  });
});

describe("buildInterfaceGraph — the shared graph, or an honest empty one", () => {
  it("passes the server's node and edge sets through unchanged", () => {
    const g = buildInterfaceGraph(
      payload({
        graph: {
          nodes: [{ id: "a", name: "A" }],
          edges: [{ dependent: "a", supplier: "b", kind: "functional" }],
          commonCauseGroups: [],
        },
      }),
    );
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(1);
  });

  it("accepts an interface type as an edge kind (D4.18: one graph, two edge sources)", () => {
    const g = buildInterfaceGraph(
      payload({
        graph: {
          nodes: [],
          // `contractual` is a §19 interface type, not one of the six asset
          // dependency kinds. It types cleanly because the edge union was
          // widened rather than a second edge type being invented.
          edges: [
            { dependent: "obj:x", supplier: "obj:y", kind: "contractual" },
          ],
          commonCauseGroups: [],
        },
      }),
    );
    expect(g.edges[0].kind).toBe("contractual");
  });

  it("returns an EMPTY graph rather than a half-built one for a malformed payload", () => {
    // A half-built graph reports a clean traversal of the half that survived,
    // which is the failure mode this whole module refuses.
    const g = buildInterfaceGraph({
      graph: { nodes: undefined, edges: [] } as never,
    });
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it("returns an empty graph for a null payload instead of throwing", () => {
    expect(buildInterfaceGraph(null).edges).toHaveLength(0);
    expect(buildInterfaceGraph(undefined).nodes).toHaveLength(0);
  });
});

describe("readInterfaceExposure — the refusals", () => {
  it("REFUSES over an empty register rather than reporting a clean traversal", () => {
    const r = readInterfaceExposure(payload());
    expect(r.refused).toBe(true);
    expect(r.headline.toLowerCase()).toContain("unmapped");
    // And it does not claim there is nothing at risk.
    expect(r.singlePoints.reliable).toBe(false);
  });

  it("carries the server's own refusal text when the server refused", () => {
    const r = readInterfaceExposure(
      payload({ refused: true, refusal: "Server says: nothing recorded." }),
    );
    expect(r.headline).toBe("Server says: nothing recorded.");
  });

  it("names an open interface with no date rather than counting it as fine", () => {
    const r = readInterfaceExposure(
      payload({
        interfaces: [iface({ dueDate: null, status: "identified" })],
        total: 1,
        openCount: 1,
        overdueCount: 0,
        openWithoutDueDate: 1,
      }),
    );
    expect(r.refused).toBe(false);
    expect(r.openWithoutDate).toHaveLength(1);
    expect(r.headline).toContain("never be late");
  });

  it("does not treat a delivered interface with no date as open", () => {
    const r = readInterfaceExposure(
      payload({
        interfaces: [iface({ dueDate: null, status: "delivered" })],
        total: 1,
        openCount: 0,
      }),
    );
    expect(r.openWithoutDate).toHaveLength(0);
  });

  it("names the worst overdue interface and its owner", () => {
    const r = readInterfaceExposure(
      payload({
        interfaces: [
          iface({ id: 1, interfaceRef: "IF-1", overdue: true, daysLate: 3 }),
          iface({
            id: 2,
            interfaceRef: "IF-2",
            overdue: true,
            daysLate: 40,
            owner: "Late Owner",
          }),
        ],
        total: 2,
        openCount: 2,
        overdueCount: 2,
      }),
    );
    expect(r.overdue).toHaveLength(2);
    expect(r.headline).toContain("IF-2");
    expect(r.headline).toContain("Late Owner");
  });

  it("names the §19 types the register has no row for, rather than counting them", () => {
    const r = readInterfaceExposure(
      payload({
        interfaces: [iface({ interfaceType: "physical" })],
        total: 1,
        openCount: 1,
      }),
    );
    expect(r.uncoveredTypes).toContain("Contractual");
    expect(r.uncoveredTypes).toHaveLength(6);
    expect(r.headline).toContain("Contractual");
  });

  it("says the graph has nothing to traverse rather than implying nothing is at risk", () => {
    const r = readInterfaceExposure(
      payload({ interfaces: [iface()], total: 1, openCount: 1 }),
    );
    expect(r.headline).toContain("no edges to traverse");
  });

  it("reports single points from the SHARED traversal when the graph has edges", () => {
    const r = readInterfaceExposure(
      payload({
        interfaces: [
          iface({
            sourceObject: "MCC-1",
            targetObject: "Pump A",
            overdue: true,
            daysLate: 5,
          }),
        ],
        total: 1,
        openCount: 1,
        overdueCount: 1,
        graph: {
          nodes: [
            { id: "obj:MCC-1", name: "MCC-1" },
            { id: "obj:Pump A", name: "Pump A" },
          ],
          edges: [
            {
              dependent: "obj:Pump A",
              supplier: "obj:MCC-1",
              kind: "electrical",
            },
          ],
          commonCauseGroups: [],
        },
        interfaceEdgeCount: 1,
      }),
    );
    expect(r.singlePoints.reliable).toBe(true);
    expect(r.singlePoints.points.map((p) => p.id)).toContain("obj:MCC-1");
    // The cascade is the interdependency lib's answer, lifted, not recomputed.
    expect(r.cascades).toHaveLength(1);
    expect(r.cascades[0].interfaceRef).toBe("IF-1");
    expect(r.cascades[0].result.lostCount).toBe(2);
  });
});
