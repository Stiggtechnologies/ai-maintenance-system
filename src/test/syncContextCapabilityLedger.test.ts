import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Capability {
  id: string;
  category: string;
  status:
    | "existing_foundation"
    | "prototype_only"
    | "missing"
    | "external_dependency";
  pr: string;
  constraints: string[];
  completion: { state: "not_started" | "partial" | "complete" };
}

const ledger = JSON.parse(
  readFileSync("docs/sync-context/capability-ledger.json", "utf8"),
) as {
  capabilities: Capability[];
  implementationSequence: { id: string }[];
};
const baseline = JSON.parse(
  readFileSync("docs/sync-context/capability-ledger-baseline.json", "utf8"),
) as {
  acceptedCapabilityCount: number;
  statusCounts: Record<string, number>;
  completionCounts: Record<string, number>;
};

describe("Sync Context governed capability ledger", () => {
  it("passes the schema, evidence and accepted-baseline ratchet", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/check-sync-context-ledger.mjs"],
      { encoding: "utf8" },
    );
    expect(output).toContain(
      "Sync Context ledger verified: 132 capabilities; 0 complete.",
    );
  });

  it("preserves all 132 accepted identities and keeps completion claims honest", () => {
    const ids = ledger.capabilities.map((item) => item.id);
    expect(new Set(ids).size).toBe(132);
    expect(baseline.acceptedCapabilityCount).toBe(132);
    expect(baseline.statusCounts).toEqual({
      existing_foundation: 43,
      external_dependency: 25,
      missing: 21,
      prototype_only: 43,
    });
    expect(baseline.completionCounts).toEqual({
      complete: 0,
      not_started: 64,
      partial: 68,
    });
    expect(
      ledger.capabilities.filter(
        (item) => item.completion.state === "complete",
      ),
    ).toEqual([]);
  });

  it("maps every requirement to a bounded implementation slice", () => {
    const slices = new Set(
      ledger.implementationSequence.map((slice) => slice.id),
    );
    expect(slices).toEqual(
      new Set([
        "SC-00",
        "SC-01",
        "SC-02",
        "SC-03",
        "SC-04",
        "SC-05",
        "SC-06",
        "SC-07",
        "SC-08",
        "SC-09",
        "SC-10",
      ]),
    );
    expect(ledger.capabilities.every((item) => slices.has(item.pr))).toBe(true);
  });

  it("makes the non-negotiable governance boundaries machine-visible", () => {
    const constraints = new Set(
      ledger.capabilities.flatMap((item) => item.constraints),
    );
    for (const required of [
      "canonical_identity",
      "tenant_isolation",
      "evidence_provenance",
      "human_approval",
      "no_invented_data",
      "non_surveillance",
      "privacy",
      "licensing",
      "source_authority",
      "source_health",
    ]) {
      expect(constraints.has(required)).toBe(true);
    }
  });
});
