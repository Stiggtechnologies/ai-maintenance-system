// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const drill = await import(
  new URL("../../scripts/database-restore-drill.mjs", import.meta.url).href
);

const local = {
  Id: "a".repeat(64),
  Name: "/supabase_db_ai-maintenance-system",
  Image: `sha256:${"b".repeat(64)}`,
  State: { Running: true },
  Config: { Labels: { "com.supabase.cli.project": "ai-maintenance-system" } },
};

describe("database restore-drill boundaries", () => {
  it("refuses execution without explicit local-source intent before any Docker command", async () => {
    await expect(
      drill.runRestoreDrill({ env: {}, log: () => {} }),
    ).rejects.toThrow("Explicit local");
    await expect(
      drill.runRestoreDrill({
        env: { SYNC_DR_LOCAL_SOURCE: "production" },
        log: () => {},
      }),
    ).rejects.toThrow("Explicit local");
    await expect(
      drill.runRestoreDrill({
        env: {
          SYNC_DR_LOCAL_SOURCE: "supabase_db_ai-maintenance-system",
          DOCKER_CONTEXT: "remote",
        },
        log: () => {},
      }),
    ).rejects.toThrow("overrides");
  });
  it("accepts only the explicit local CLI database identity", () => {
    expect(
      drill.validateSource(local, "unix:///var/run/docker.sock", {}),
    ).toEqual({ id: local.Id, image: local.Image });
  });
  it.each([
    "tcp://127.0.0.1:2375",
    "ssh://host",
    "tcp://production.example:2376",
  ])("refuses remote or TCP Docker context %s", (endpoint) => {
    expect(() => drill.validateSource(local, endpoint, {})).toThrow(
      "local Docker",
    );
  });
  it.each([
    { DOCKER_HOST: "unix:///other.sock" },
    { DOCKER_CONTEXT: "remote" },
  ])("refuses environment context overrides %j", (env) => {
    expect(() =>
      drill.validateSource(local, "unix:///var/run/docker.sock", env),
    ).toThrow("override");
  });
  it.each([
    { ...local, Name: "/production" },
    { ...local, State: { Running: false } },
    { ...local, Config: { Labels: {} } },
    { ...local, Image: "postgres:latest" },
    { ...local, Id: "../elsewhere" },
  ])("refuses an unqualified source %j", (source) => {
    expect(() =>
      drill.validateSource(source, "unix:///var/run/docker.sock", {}),
    ).toThrow();
  });
  it("requires a nonempty manifest and all four canonical namespaces", () => {
    expect(() => drill.compareManifests([], [])).toThrow("empty");
    const entries = ["public", "auth", "storage", "supabase_migrations"].map(
      (schema) => ({
        kind: "data",
        key: `${schema}.t`,
        value: { count: 1, digest: "c".repeat(64) },
      }),
    );
    expect(drill.compareManifests(entries, entries)).toEqual({
      entries: 4,
      tables: 4,
      rows: 4,
    });
    expect(() =>
      drill.compareManifests(entries.slice(1), entries.slice(1)),
    ).toThrow("namespace");
  });
  it("refuses missing, unexpected, duplicate and altered restored entries", () => {
    const entries = ["public", "auth", "storage", "supabase_migrations"].map(
      (schema) => ({
        kind: "data",
        key: `${schema}.t`,
        value: { count: 1, digest: "c".repeat(64) },
      }),
    );
    for (const target of [
      entries.slice(1),
      [...entries, { kind: "role", key: "extra", value: {} }],
      [...entries, entries[0]],
      entries.map((entry, i) =>
        i ? entry : { ...entry, value: { count: 1, digest: "d".repeat(64) } },
      ),
    ]) {
      expect(() => drill.compareManifests(entries, target)).toThrow();
    }
  });
  it("preserves array order and canonicalizes object key order", () => {
    expect(drill.fingerprint({ a: 1, b: [2, 3] })).toBe(
      drill.fingerprint({ b: [2, 3], a: 1 }),
    );
    expect(drill.fingerprint([2, 3])).not.toBe(drill.fingerprint([3, 2]));
  });
  it("detects changes in RLS, tenant policy and SECURITY DEFINER ownership or search path", () => {
    const data = ["public", "auth", "storage", "supabase_migrations"].map(
      (schema) => ({
        kind: "data",
        key: `${schema}.t`,
        value: { count: 1, digest: "c".repeat(64) },
      }),
    );
    const controls = [
      {
        kind: "relation",
        key: "public.assets",
        value: { rls: true, owner: "postgres" },
      },
      {
        kind: "policy",
        key: "public.assets.tenant",
        value: { expression: "organization_id = current_organization_id()" },
      },
      {
        kind: "function",
        key: "public.get_current_user_context()",
        value: { definer: true, owner: "postgres", searchPath: ["public"] },
      },
    ];
    const original = [...data, ...controls];
    for (const changed of [
      { rls: false, owner: "postgres" },
      { expression: "true" },
      { definer: true, owner: "authenticated", searchPath: ["public"] },
      { definer: true, owner: "postgres", searchPath: ["$user", "public"] },
    ]) {
      const index = "rls" in changed ? 0 : "expression" in changed ? 1 : 2;
      const target = [
        ...data,
        ...controls.map((control, i) =>
          i === index ? { ...control, value: changed } : control,
        ),
      ];
      expect(() => drill.compareManifests(original, target)).toThrow("differs");
    }
  });
  it("creates private exclusive artifacts and refuses symlink replacement", () => {
    const parent = mkdtempSync(join(tmpdir(), "syncai-dr-test-"));
    const output = drill.createPrivateOutput(parent);
    expect(statSync(output).mode & 0o777).toBe(0o700);
    drill.writePrivateArtifact(output, "report.json", "{}");
    expect(statSync(join(output, "report.json")).mode & 0o777).toBe(0o600);
    expect(() =>
      drill.writePrivateArtifact(output, "report.json", "overwrite"),
    ).toThrow();
    const victim = join(parent, "victim");
    writeFileSync(victim, "untouched");
    symlinkSync(victim, join(output, "roles.sql"));
    expect(() =>
      drill.writePrivateArtifact(output, "roles.sql", "overwrite"),
    ).toThrow();
    expect(readFileSync(victim, "utf8")).toBe("untouched");
    expect(() =>
      drill.writePrivateArtifact(output, "../escape.json", "{}"),
    ).toThrow();
  });
  it("requires exact target ownership, network isolation, no ports and no host mounts before cleanup", () => {
    const runId = "c".repeat(32);
    const target = {
      Id: "d".repeat(64),
      Name: `/syncai-dr-${runId}`,
      HostConfig: { NetworkMode: "none", PortBindings: {} },
      Mounts: [],
      Config: { Labels: { "com.syncai.dr.run": runId } },
    };
    expect(drill.validateTarget(target, runId)).toBe(target.Id);
    for (const candidate of [
      { ...target, Name: "/other" },
      { ...target, Config: { Labels: {} } },
      { ...target, HostConfig: { NetworkMode: "bridge", PortBindings: {} } },
      {
        ...target,
        HostConfig: { NetworkMode: "none", PortBindings: { "5432/tcp": [{}] } },
      },
      { ...target, Mounts: [{ Type: "bind", Source: "/private/data" }] },
    ]) {
      expect(() => drill.validateTarget(candidate, runId)).toThrow();
    }
  });
});
