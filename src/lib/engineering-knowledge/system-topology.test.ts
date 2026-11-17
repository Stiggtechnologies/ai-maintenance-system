import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataCenterReferenceModel as model } from "../asset-twins/data-center-reference-model";
import type { SystemReferenceModel } from "../asset-twins/system-model";
import {
  batchSystemTopologyEdges,
  relationshipsFromSystemReferenceModel,
  SYSTEM_TOPOLOGY_BATCH_LIMIT,
  systemModelCanonicalId,
} from "./system-topology";

const migration = fs.readFileSync(
  path.resolve("supabase/migrations/20271020110000_system_topology_graph_vocabulary.sql"),
  "utf8",
);
const edges = relationshipsFromSystemReferenceModel(model);
const id = (c: string) => systemModelCanonicalId(model.code, c);
const has = (type: string, from: string, to: string) =>
  edges.some((e) => e.relationshipType === type && e.fromCanonicalId === from && e.toCanonicalId === to);

describe("system topology projection", () => {
  it("represents every node, function, functional failure and maintainable item", () => {
    for (const node of model.nodes) {
      if (node.parentCode) expect(has("contains", id(node.parentCode), id(node.code)), node.code).toBe(true);
      for (const fn of node.functions) {
        expect(has("performs", id(node.code), id(fn.code)), fn.code).toBe(true);
        expect(edges.filter((e) => e.relationshipType === "has_functional_failure" && e.fromCanonicalId === id(fn.code)))
          .toHaveLength(fn.functionalFailures.length);
      }
      const items = edges.filter((e) => e.relationshipType === "composed_of" && e.fromCanonicalId === id(node.code));
      expect(items).toHaveLength(node.maintainableItems?.length ?? 0);
    }
  });

  it("binds equipment to existing asset-class templates instead of copying them", () => {
    expect(has("modelled_by", id("DC-UPS"), "CRIT-UPS-SYSTEM")).toBe(true);
    const binding = edges.find((e) => e.relationshipType === "modelled_by" && e.fromCanonicalId === id("DC-UPS"))!;
    expect(binding.toEntityType).toBe("asset_class");
  });

  it("carries design-intent topology and redundancy membership", () => {
    expect(has("supplies_power_to", id("DC-UPS"), id("DC-PDU"))).toBe(true);
    expect(has("rejects_heat_to", id("DC-CHILLER"), id("DC-COOLING-TOWER"))).toBe(true);
    expect(has("member_of", id("DC-ELEC-UPS"), id("RG-UPS"))).toBe(true);
    expect(has("provides_redundancy_for", id("RG-UPS"), id("F-UPS"))).toBe(true);
    expect(edges.filter((e) => model.edges.some((t) => t.relation === e.relationshipType)).length).toBe(model.edges.length);
  });

  it("is ids-only, provenance-bound, unique and deterministic", () => {
    const codes = edges.map((e) => e.relationshipCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const e of edges) {
      expect(e.provenanceCanonicalIds).toEqual([model.code]);
      expect(Object.keys(e).sort()).toEqual([
        "fromCanonicalId", "fromEntityType", "provenanceCanonicalIds", "provenanceChunkIds",
        "relationshipCode", "relationshipType", "toCanonicalId", "toEntityType",
      ]);
      expect(e.relationshipCode.length).toBeLessThanOrEqual(500);
    }
    expect(relationshipsFromSystemReferenceModel(model)).toEqual(edges);
  });

  it("batches within the backfill RPC limit", () => {
    const batches = batchSystemTopologyEdges(edges);
    expect(batches.flat()).toEqual(edges);
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(SYSTEM_TOPOLOGY_BATCH_LIMIT);
    expect(() => batchSystemTopologyEdges(edges, 201)).toThrow();
  });

  it("refuses a model whose edge would point a node at itself", () => {
    const bad: SystemReferenceModel = JSON.parse(JSON.stringify(model));
    bad.edges.push({ from: "DC-UPS", relation: "backs_up", to: "DC-UPS" });
    expect(() => relationshipsFromSystemReferenceModel(bad)).toThrow(/cannot point an entity to itself/);
  });
});

describe("system topology vocabulary migration", () => {
  it("allows every entity and relationship type the projection emits", () => {
    for (const e of edges) {
      expect(migration).toContain(`'${e.relationshipType}'`);
      expect(migration).toContain(`'${e.fromEntityType}'`);
      expect(migration).toContain(`'${e.toEntityType}'`);
    }
  });

  it("is additive: keeps every previously allowed value", () => {
    const prior = fs.readFileSync(
      path.resolve("supabase/migrations/20271020100400_engineering_relationship_backfill.sql"),
      "utf8",
    );
    const block = prior.slice(prior.indexOf("relationship_type text not null"), prior.indexOf("provenance_chunk_ids"));
    for (const value of block.match(/'([a-z_]+)'/g) ?? []) expect(migration).toContain(value);
  });

  it("extends the existing table and keeps the governed write path", () => {
    expect(migration).not.toMatch(/create\s+table/i);
    expect(migration).not.toMatch(/\bgrant\b/i);
    expect(migration).not.toMatch(/insert\s+into/i);
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(migration).toContain("alter table public.engineering_knowledge_relationships");
  });
});
