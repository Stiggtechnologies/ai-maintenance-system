import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edge = readFileSync(
  "supabase/functions/engineering-model-supply-chain/index.ts",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const boundary = JSON.parse(
  readFileSync("config/edge-function-boundary.json", "utf8"),
) as {
  activeFunctions: string[];
  allowedNoVerifyJwt: string[];
};

describe("engineering model production boundary", () => {
  it("deploys the authenticated function through the explicit allowlist", () => {
    expect(boundary.activeFunctions).toContain(
      "engineering-model-supply-chain",
    );
    expect(boundary.allowedNoVerifyJwt).not.toContain(
      "engineering-model-supply-chain",
    );
    expect(workflow).toContain(
      '"supabase/functions/engineering-model-supply-chain/**"',
    );
    expect(workflow).toContain(
      "supabase functions deploy engineering-model-supply-chain",
    );
  });

  it("validates, hashes and service-persists manifests instead of trusting the browser", () => {
    expect(edge).toContain("validatePhysicsModelPack(manifest)");
    expect(edge).toContain('crypto.subtle.digest("SHA-256"');
    expect(edge).toContain('service.rpc("ingest_engineering_model_pack"');
    expect(edge).toContain("p_organization_id: profile.organization_id");
    expect(edge).toContain("p_actor_id: userData.user.id");
  });

  it("contains one exact allowlisted evaluator and records answers and refusals server-side", () => {
    expect(edge).toContain(
      'model.calculation_key !== "pof_shaft_resonance_screening"',
    );
    expect(edge).toContain("runResonanceEvaluator(context)");
    expect(edge).toContain("assessModelApplicability(manifest, context)");
    expect(edge).toContain('service.rpc("record_engineering_model_run"');
    expect(edge).not.toContain("eval(");
    expect(edge).not.toContain("new Function(");
  });

  it("keeps the production boundary offline, bounded, tenant-scoped, and GPD-independent", () => {
    expect(edge).toContain("hasEvaluationContextShape(body.context)");
    expect(edge).toContain('.eq("organization_id", profile.organization_id)');
    expect(edge).toContain("networkUsed: false");
    expect(edge).toContain("MAX_BODY_BYTES");
    expect(edge).not.toContain("get-physics-done");
    expect(edge).not.toContain("github.com/psi-oss");
  });

  it("keeps runtime-shared model imports resolvable by strict Deno deployment", () => {
    for (const relativePath of [
      "src/lib/engineering-models/resonance.ts",
      "src/lib/engineering-models/validation.ts",
    ]) {
      const source = readFileSync(relativePath, "utf8");
      expect(source).toContain('from "./types.ts";');
      expect(source).not.toContain('from "./types";');
    }
  });
});
