import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261226100000_edge_evidence_contract.sql",
  "utf8",
);
const ingest = readFileSync(
  "supabase/functions/edge-evidence-ingest/index.ts",
  "utf8",
);
const auth = readFileSync(
  "supabase/functions/edge-evidence-ingest/auth.ts",
  "utf8",
);
const runtimeSmoke = readFileSync(
  "scripts/ci-edge-evidence-contract-smoke.sh",
  "utf8",
);
const deviceCrypto = readFileSync("scripts/edge-evidence-crypto.mjs", "utf8");

describe("hardware-neutral Edge Evidence Contract", () => {
  it("extends canonical identities instead of creating parallel evidence, model or audit stores", () => {
    expect(migration).toContain("from public.assets where id=p_asset_id");
    expect(migration).toContain("references public.sensors(id)");
    expect(migration).toContain("references public.model_register(id)");
    expect(migration).toMatch(
      /alter table public\.evidence_items[\s\S]*edge_node_id/,
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(
      /create table if not exists public\.edge_(observations|evidence|audit|approvals)/,
    );
  });

  it("requires independent human enrollment and key-rotation review", () => {
    expect(migration).toContain(
      "edge-node requester cannot independently review enrollment",
    );
    expect(migration).toContain(
      "key-rotation requester cannot independently review it",
    );
    expect(migration).toContain("insert into public.approvals");
    expect(migration).toMatch(
      /status <> 'active'[\s\S]*approval_id is not null/,
    );
    expect(migration).not.toMatch(/not in \('admin','ai_admin'/);
    expect(migration).toContain(
      "edge key IDs and public keys cannot be reused within an organization",
    );
    expect(migration).toContain("current_public_key_jwk->>'x'");
    expect(migration).toMatch(
      /edge_public_key_fingerprint[\s\S]*jsonb_build_object\([\s\S]*'kty'[\s\S]*'crv'[\s\S]*'x'/,
    );
  });

  it("admits only approved exact model versions as unverified AI inference", () => {
    expect(migration).toMatch(/approval_status <> 'approved'/);
    expect(migration).toMatch(/not v_model\.current_for_decisions/);
    expect(migration).toContain("v_model.submitted_by=v_model.approved_by");
    expect(migration).toMatch(
      /approval_evidence_item_id[\s\S]*verification_status='verified'/,
    );
    expect(migration).toContain("'AI_INFERENCE','unverified'");
    expect(migration).toContain("'operationalAuthorization',false");
    expect(migration).not.toMatch(
      /insert into public\.(recommendations|work_orders|decisions)/,
    );
  });

  it("enforces tenant binding, replay refusal and immutable signed provenance", () => {
    expect(migration).toMatch(/p_sequence <= v_node\.last_sequence/);
    expect(migration).toContain("edge observation already recorded");
    expect(migration).toContain("asset is not bound to this edge node tenant");
    expect(migration).toContain(
      "sensor is not bound to the same tenant and asset",
    );
    expect(migration).toContain(
      "signed edge evidence is immutable except for recorded human verification",
    );
    expect(migration).toMatch(
      /edge_node_id is null[\s\S]*edge_observation is null[\s\S]*or \(/,
    );
    expect(migration).toMatch(
      /or \(\s*edge_node_id is not null\s*and\s*edge_model_register_id is not null/,
    );
    expect(migration).toMatch(
      /edge_node_id, edge_signature_key_id, edge_sequence/,
    );
    expect(migration).toMatch(
      /create policy edge_nodes_org_read[\s\S]*app_current_org\(\)/,
    );
  });

  it("uses custom Ed25519 request authentication without accepting browser or bearer fallback", () => {
    expect(auth).toContain(
      'EDGE_SIGNATURE_CONTEXT = "syncai-edge-evidence-v1"',
    );
    expect(auth).toContain('crypto.subtle.importKey(\n      "jwk"');
    expect(auth).toContain('crypto.subtle.verify(\n      { name: "Ed25519" }');
    expect(ingest).toContain('request.headers.get("x-syncai-edge-signature")');
    expect(ingest).toContain("signedAtWithinWindow(body.signedAt)");
    expect(ingest).toContain('request.method !== "POST"');
    expect(ingest).not.toContain("Access-Control-Allow-Origin");
    expect(ingest).not.toMatch(/authorization|bearer/i);
  });

  it("bounds device input and calls only the service-role persistence RPC after verification", () => {
    expect(ingest).toContain("MAX_BODY_BYTES = 256 * 1024");
    expect(ingest).toContain("readBoundedBody(request, MAX_BODY_BYTES)");
    expect(ingest).not.toContain("request.arrayBuffer()");
    expect(ingest).toContain("await verifyEdgeSignature(");
    expect(ingest).toContain('supabase.rpc("ingest_verified_edge_evidence"');
    expect(migration).toMatch(
      /grant execute on function public\.ingest_verified_edge_evidence[\s\S]*to service_role/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.ingest_verified_edge_evidence[\s\S]*authenticated/,
    );
  });

  it("proves the real signed endpoint path and refuses a tampered envelope", () => {
    expect(deviceCrypto).toContain('generateKeyPairSync("ed25519")');
    expect(deviceCrypto).toContain(
      "sign(null, Buffer.from(message), privateKey)",
    );
    expect(runtimeSmoke).toContain(
      "node scripts/edge-evidence-crypto.mjs generate",
    );
    expect(runtimeSmoke).toContain(
      "node scripts/edge-evidence-crypto.mjs sign",
    );
    expect(runtimeSmoke).toContain(
      '"$API_URL/functions/v1/edge-evidence-ingest"',
    );
    expect(runtimeSmoke).toContain('test "$(status "$TAMPERED")" = 401');
    expect(runtimeSmoke).toContain('test "$(status "$1")" = 201');
  });
});
