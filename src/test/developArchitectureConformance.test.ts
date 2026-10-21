import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEVELOP_AI_SURFACES,
  DEVELOP_ARCHITECTURE_LAYERS,
  DEVELOP_PERSISTENCE_MAP,
  DEVELOP_ROUTE_ARCHITECTURE,
  classifyDevelopRpc,
} from "../lib/develop/architecture";
import { DEVELOP_MODULES } from "../lib/develop/composition";

const app = readFileSync("src/App.tsx", "utf8");
const nav = readFileSync(
  "src/components/develop/DevelopCompositionNav.tsx",
  "utf8",
);
const serviceFiles = [
  "src/services/developService.ts",
  "src/services/handoverPackageService.ts",
];
const services = serviceFiles.map((file) => readFileSync(file, "utf8"));

function captures(source: string, expression: RegExp): string[] {
  return [...source.matchAll(expression)].map((match) => match[1]);
}

const appRoutes = captures(app, /path="([^"]+)"/g);
const serviceRpcs = [
  ...new Set(
    services.flatMap((source) =>
      captures(source, /\.rpc\(\s*["'`]([^"'`]+)["'`]/g),
    ),
  ),
];
const invokedFunctions = [
  ...new Set(
    services.flatMap((source) =>
      captures(source, /\.functions\.invoke\(\s*["'`]([^"'`]+)["'`]/g),
    ),
  ),
];

describe("D11.12 layered architecture conformance", () => {
  it("maps every authenticated Develop route and every routed product module", () => {
    const mapped = new Set(
      DEVELOP_ROUTE_ARCHITECTURE.map((route) => route.path),
    );
    const developRoutes = appRoutes.filter((path) =>
      path.startsWith("/develop"),
    );

    expect(developRoutes.length).toBeGreaterThanOrEqual(9);
    expect(developRoutes.filter((path) => !mapped.has(path))).toEqual([]);

    for (const module of DEVELOP_MODULES) {
      if (module.target.kind === "route") {
        expect(mapped.has(module.target.path), module.label).toBe(true);
      }
    }
    for (const route of DEVELOP_ROUTE_ARCHITECTURE) {
      expect(appRoutes, route.path).toContain(route.path);
      expect(route.engines.length).toBeGreaterThan(0);
      expect(route.audiences.length).toBeGreaterThan(0);
    }
  });

  it("classifies every Develop RPC at the service boundary", () => {
    expect(serviceRpcs.length).toBeGreaterThan(300);
    const unmapped = serviceRpcs.filter(
      (name) => classifyDevelopRpc(name) === null,
    );
    expect(unmapped).toEqual([]);
    expect(
      serviceRpcs.some((name) => classifyDevelopRpc(name) === "intelligence"),
    ).toBe(true);
    expect(
      serviceRpcs.some(
        (name) => classifyDevelopRpc(name) === "decision-workflow",
      ),
    ).toBe(true);
  });

  it("confines every Develop AI edge function to advisory Intelligence", () => {
    const declared = DEVELOP_AI_SURFACES.map(
      (surface) => surface.functionName,
    ).sort();
    expect(invokedFunctions.sort()).toEqual(declared);

    const forbiddenDeterminations = new Set([
      "record_case_gate_review",
      "record_gate_review_outcome",
      "accept_risk",
      "record_regulatory_approval",
      "sanction_development_case",
      "release_work_package",
      "start_restoration_work",
      "accept_system_handover_package",
      "attest_contract_legal_compliance",
    ]);

    for (const surface of DEVELOP_AI_SURFACES) {
      expect(surface.layer).toBe("intelligence");
      expect(surface.authority).toBe("advisory-only");
      const file = `supabase/functions/${surface.functionName}/index.ts`;
      expect(existsSync(file), file).toBe(true);
      const source = readFileSync(file, "utf8");
      const calledRpcs = captures(source, /\.rpc\(\s*["'`]([^"'`]+)["'`]/g);
      expect(
        calledRpcs.filter((name) => forbiddenDeterminations.has(name)),
      ).toEqual([]);
      expect(
        source,
        `${surface.functionName} authenticates the caller`,
      ).toContain("auth.getUser");
    }
  });

  it("renders the live architecture contract instead of leaving a diagram in docs", () => {
    expect(DEVELOP_ARCHITECTURE_LAYERS.map((layer) => layer.key)).toEqual([
      "experience",
      "decision-workflow",
      "intelligence",
      "governance",
      "knowledge-graph",
      "enterprise-data",
      "trust-security",
    ]);
    expect(nav).toContain("developArchitectureContract()");
    expect(nav).toContain("developPersistenceContract()");
    expect(nav).toContain("architecture.layers.map");
    expect(nav).toContain("persistence.map");
  });
});

describe("D11.25 hybrid persistence conformance", () => {
  it("maps every approved store role and names each prohibited parallel stack", () => {
    expect(DEVELOP_PERSISTENCE_MAP.map((domain) => domain.key)).toEqual([
      "relational",
      "graph",
      "object",
      "vector",
      "time-series",
      "event-workflow-rules",
      "lineage-model-audit",
    ]);
    const contract = DEVELOP_PERSISTENCE_MAP.map(
      (domain) =>
        `${domain.authoritativeFor} ${domain.mechanism} ${domain.prohibition}`,
    ).join("\n");
    expect(contract).toMatch(/Every D-family business object/);
    expect(contract).toMatch(/No Neo4j/);
    expect(contract).toMatch(
      /No Kafka, Temporal or second rules\/workflow engine/,
    );
    expect(contract).toMatch(/No silent model swap/);
  });
});
