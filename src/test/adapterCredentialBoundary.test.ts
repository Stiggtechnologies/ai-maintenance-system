// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  resolveAdapterBearer,
  resolveAdapterCredential,
} from "../../supabase/functions/_shared/adapter-credentials";
import { readAdapterBytes } from "../../supabase/functions/_shared/adapter-response";
const org = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const binding = "vault://synthetic/adapter";
const entry = {
  type: "oauth_bearer",
  organization_id: org,
  host: "source.example.com",
  access_token: "SYNTHETIC-ONLY-DO-NOT-USE-".repeat(2),
  expires_at: "2030-01-01T00:00:00Z",
};
const now = Date.parse("2026-10-12T00:00:00Z");
const resolve = (change = {}, tenant = org, host = entry.host) =>
  resolveAdapterBearer(
    JSON.stringify({ [binding]: { ...entry, ...change } }),
    binding,
    tenant,
    host,
    now,
  );
describe("adapter credential binding", () => {
  it("resolves only the exact tenant, host and unexpired provisioned bearer", () =>
    expect(resolve()).toBe(entry.access_token));
  it.each([
    { organization_id: other },
    { organization_id: undefined },
    { host: "other.example.com" },
    { host: undefined },
    { host: "*.example.com" },
    { host: "SOURCE.example.com" },
    { type: "azure_service_principal" },
    { access_token: "short" },
    { access_token: entry.access_token + "\r\n" },
    { expires_at: undefined },
    { expires_at: "2026-10-12T00:00:00Z" },
    { expires_at: "2026-10-12T00:01:00Z" },
    { expires_at: "2030-01-01T00:00:00" },
    { expires_at: "bad" },
  ])("refuses invalid binding %j without exposing the token", (change) => {
    expect(() => resolve(change)).toThrow();
    try {
      resolve(change);
    } catch (error) {
      expect(String(error)).not.toContain(entry.access_token);
    }
  });
  it("does not turn a globally valid binding into cross-tenant or cross-host authority", () => {
    expect(() => resolve({}, other)).toThrow(/tenant and host/);
    expect(() => resolve({}, org, "other.example.com")).toThrow(
      /tenant and host/,
    );
  });
  it.each(["null", "[]", "broken", "{}", '{"__proto__":{}}'])(
    "rejects malformed registries %s",
    (registry) => {
      expect(() =>
        resolveAdapterBearer(registry, "toString", org, entry.host, now),
      ).toThrow();
    },
  );
  it("also binds an ADLS service principal to its exact account host", () => {
    const registry = JSON.stringify({
      [binding]: { ...entry, type: "azure_service_principal" },
    });
    expect(
      resolveAdapterCredential(
        registry,
        binding,
        org,
        entry.host,
        "azure_service_principal",
      ).organization_id,
    ).toBe(org);
    expect(() =>
      resolveAdapterCredential(
        registry,
        binding,
        org,
        "other.example.com",
        "azure_service_principal",
      ),
    ).toThrow();
  });
});
describe("streaming budgets", () => {
  it("cancels an over-budget stream without trusting absent content length", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(5));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(readAdapterBytes(response, 4)).rejects.toThrow(/byte budget/);
    expect(cancelled).toBe(true);
  });
  it("refuses dishonest length and accepts an exact bounded payload", async () => {
    await expect(
      readAdapterBytes(
        new Response("12345", { headers: { "content-length": "1" } }),
        4,
      ),
    ).rejects.toThrow();
    expect(
      new TextDecoder().decode(await readAdapterBytes(new Response("1234"), 4)),
    ).toBe("1234");
  });
});
