import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  enforceAdapterSourceSupport,
  type SyncContextSnapshot,
} from "../lib/sync-context/contracts";

const contracts = readFileSync("src/lib/sync-context/contracts.ts", "utf8");
const service = readFileSync("src/services/syncContextService.ts", "utf8");

describe("SC-01 ContextSourceAdapter conformance", () => {
  it("keeps adapters read-only and source-class explicit", () => {
    expect(contracts).toContain("interface ContextSourceAdapter");
    expect(contracts).toContain("readonly adapterKey");
    expect(contracts).toContain("readonly supportedSourceClasses");
    expect(contracts).toContain("readSnapshot(): Promise<SyncContextSnapshot>");
    expect(contracts).not.toMatch(
      /ContextSourceAdapter[\s\S]{0,300}(write|mutate|approve|dispatch)\s*\(/,
    );
  });

  it("has exactly one canonical browser adapter in this slice", () => {
    expect(service.match(/ContextSourceAdapter/g)).toHaveLength(2);
    expect(service).toContain("canonicalSyncContextAdapter");
    expect(service).toContain(
      'adapterKey: "canonical_sync_context_projection"',
    );
    expect(service).toContain("supportedSourceClasses: CONTEXT_SOURCE_CLASSES");
    expect(service).not.toContain('sourceClass: "customer_operational"');
  });

  it("refuses a source class an adapter did not declare", () => {
    const snapshot = {
      organizationId: "org-a",
      generatedAt: "2026-10-03T10:00:00Z",
      operationalAuthority: false,
      sources: [
        {
          id: "source-a",
          organizationId: "org-a",
          key: "simulation",
          name: "Simulation",
          class: "simulated_industrial",
          authority: "context_only",
          purpose: "A bounded industrial simulation for conformance testing.",
          rightsState: "not_required",
          state: "simulated",
          checkedAt: "2026-10-03T10:00:00Z",
          observedAt: "2026-10-03T10:00:00Z",
          detail: null,
          displayAsLive: false,
        },
      ],
      layers: [],
      objects: [],
      events: [],
      issues: [],
    } satisfies SyncContextSnapshot;
    expect(() =>
      enforceAdapterSourceSupport(["customer_operational"], snapshot),
    ).toThrow("simulated_industrial");
    expect(
      enforceAdapterSourceSupport(
        ["simulated_industrial", "customer_operational"],
        snapshot,
      ),
    ).toBe(snapshot);
  });
});
