import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INDUSTRY_CATALOG } from "../lib/industry-catalog";
import { INDUSTRY_TEMPLATE_PACKS } from "../lib/industry-template-packs";
import { assessProfile, INDUSTRY_PROFILES } from "../lib/industry-profiles";
import {
  DOMAIN_SPECIALIST_MODULES,
  evaluateDomainSpecialist,
} from "../lib/domain-specialists";

const migration = readFileSync(
  "supabase/migrations/20261219139000_battery_energy_storage_pack.sql",
  "utf8",
);

const itemKey = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 120);

const evidenceFor = (required: string[]) =>
  required.map((key) => ({
    key,
    sourceReference: `evidence://${key}/controlled-record`,
    evidenceItemId: "11111111-1111-4111-8111-111111111111",
  }));

describe("E1.05 battery and energy-storage profile", () => {
  it("is one canonical catalog identity with a template and executable profile", () => {
    expect(
      INDUSTRY_CATALOG.filter(
        (entry) => entry.code === "battery_energy_storage",
      ),
    ).toHaveLength(1);
    expect(INDUSTRY_TEMPLATE_PACKS.battery_energy_storage).toBeDefined();
    const profile = INDUSTRY_PROFILES.find(
      (candidate) => candidate.industryCode === "battery_energy_storage",
    )!;
    const assessment = assessProfile(profile);
    expect(assessment.unknownContexts).toEqual([]);
    expect(assessment.proseOnly).toEqual([]);
    expect(assessment.operationalShare).toBe(1);
  });

  it("persists every advertised KPI, asset class, and failure-mode membership", () => {
    const pack = INDUSTRY_TEMPLATE_PACKS.battery_energy_storage;
    const labels = [
      ...pack.kpiModel.primaryKpis,
      ...pack.kpiModel.secondaryKpis,
      ...pack.commonAssetClasses,
      ...pack.failureModeFocusAreas,
    ];
    expect(migration).toContain("battery_energy_storage");
    for (const label of labels) {
      expect(migration, label).toContain(`('${itemKey(label)}',`);
    }
  });

  it("has executable thermal, HV, degradation, and fire methods with canonical evidence", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "battery-energy-storage",
    )!;
    expect(module.methods).toHaveLength(4);
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: evidenceFor(method.requiredEvidence),
      });
      expect(result.status, `${method.key}: ${result.gaps}`).toBe("draft");
      expect(result.authoritative).toBe(false);
      expect(result.humanApprovalRequired).toBe(true);
      expect(result.requiredApproverRoleKey).toBe(
        "domain_battery_safety_reviewer",
      );
    }
  });

  it("blocks every method when canonical evidence bindings are absent", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "battery-energy-storage",
    )!;
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: [],
      });
      expect(result.status).toBe("blocked");
      expect(result.metrics).toEqual([]);
      expect(result.gaps).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Missing required evidence reference/),
        ]),
      );
    }
  });

  it("keeps thresholds customer-governed and automation blocked", () => {
    const pack = INDUSTRY_TEMPLATE_PACKS.battery_energy_storage;
    expect(pack.criticalityModel.criticalityThresholds).toEqual({
      low: null,
      medium: null,
      high: null,
      critical: null,
    });
    expect(pack.kpiModel.kpiTargets).toEqual({});
    expect(pack.blockedAutomationRules.join(" ")).toMatch(
      /Do not authorize energization/,
    );
    expect(pack.validationStatus).toBe("draft");
  });
});
