// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const drill = await import(
  new URL("../../scripts/database-restore-drill.mjs", import.meta.url).href
);
const diagnostics = await import(
  new URL("../../scripts/database-restore-diagnostics.mjs", import.meta.url)
    .href
);
const implementation = readFileSync(
  new URL("../../scripts/database-restore-drill.mjs", import.meta.url),
  "utf8",
);
const start = implementation.indexOf("async function command(");
const end = implementation.indexOf("\nconst inspect", start);
if (start < 0 || end <= start)
  throw new Error("The exact recovery subprocess boundary was not found");

type CommandOptions = {
  input?: string;
  outputFd?: number;
  timeout?: number;
  onFailureDiagnostic?: (text: string) => void | Promise<void>;
};

function runtime(binaryOutput = false) {
  const stdout = binaryOutput ? null : new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(() => close(null)),
  });
  let finished = false;
  const close = (code: number | null): void => {
    if (!finished) {
      finished = true;
      child.emit("close", code);
    }
  };
  const spawn = vi.fn(() => child);
  // Execute the exact committed command/listener body with an in-memory child.
  // No real process, SQL, provider access or artifact writer is reachable.
  const command = new Function(
    "spawn",
    "root",
    "safeDiagnostic",
    "StringDecoder",
    `${implementation.slice(start, end)}\nreturn command;`,
  )(spawn, "synthetic-runtime-only", drill.safeDiagnostic, StringDecoder) as (
    binary: string,
    args: string[],
    options?: CommandOptions,
  ) => Promise<string>;
  return { command, child, stdout, stderr, stdin, spawn, close };
}

const splits = [
  ["é", 1],
  ["—", 1],
  ["—", 2],
  ["😀", 1],
  ["😀", 2],
  ["😀", 3],
] as const;

function splitCharacter(text: string, character: string, cut: number) {
  const bytes = Buffer.from(text, "utf8");
  const offset = bytes.indexOf(Buffer.from(character, "utf8"));
  expect(offset).toBeGreaterThanOrEqual(0);
  return [bytes.subarray(0, offset + cut), bytes.subarray(offset + cut)];
}

async function decode(chunks: Buffer[]) {
  const fake = runtime();
  const result = fake.command("synthetic", []);
  for (const chunk of chunks) fake.stdout!.emit("data", chunk);
  fake.close(0);
  return result;
}

function captureText(character = "—") {
  const identity = "public.DO_NOT_DISCLOSE_FUNCTION()";
  const body = `BEGIN RETURN 'synthetic ${character}'; END`;
  const definition = `CREATE FUNCTION synthetic() RETURNS text AS $function$${body}$function$;`;
  const rows = [
    ...["public", "auth", "storage", "supabase_migrations"].map((schema) => ({
      kind: "data",
      key: `${schema}.DO_NOT_DISCLOSE_TABLE`,
      value: { count: 0, digest: "a".repeat(64) },
    })),
    {
      kind: "function",
      key: identity,
      value: ["postgres", false, null, null, definition],
    },
  ];
  const privateFunctionDiagnostics = {
    schemaVersion: 1,
    oidJsonRepresentationQualified: true,
    environment: {
      search_path: "pg_catalog",
      quote_all_identifiers: "off",
      standard_conforming_strings: "on",
      DateStyle: "ISO, MDY",
      IntervalStyle: "postgres",
      TimeZone: "UTC",
      extra_float_digits: "3",
      client_encoding: "UTF8",
      server_version_num: "170011",
    },
    functions: [
      {
        identity,
        oid: "1234",
        tupleVersion: "5678",
        definition,
        catalog: {
          oid: "1234",
          prosrc: body,
          probin: null,
          proargdefaults: null,
          prosqlbody: null,
          proconfig: null,
        },
      },
    ],
  };
  return [...rows, { privateFunctionDiagnostics }]
    .map((row) => JSON.stringify(row))
    .join("\n");
}

describe("exact recovery subprocess UTF-8 transport", () => {
  afterEach(() => vi.useRealTimers());

  it.each(splits)(
    "preserves stdout %s split after byte %s",
    async (character, cut) => {
      const text = JSON.stringify({ synthetic: character });
      expect(await decode(splitCharacter(text, character, cut))).toBe(text);
    },
  );

  it("preserves a one-byte-at-a-time mixed Unicode stream and trimming", async () => {
    const text = ' \t{"synthetic":"é — 😀"}\n ';
    const bytes = Buffer.from(text);
    const chunks = Array.from({ length: bytes.length }, (_, index) =>
      bytes.subarray(index, index + 1),
    );
    expect(await decode(chunks)).toBe(text.trim());
  });

  it.each([
    ["two-byte", Buffer.from([0xc3])],
    ["three-byte", Buffer.from([0xe2, 0x80])],
    ["four-byte", Buffer.from([0xf0, 0x9f, 0x98])],
  ])(
    "flushes incomplete %s UTF-8 on close without silently dropping it",
    async (_kind, partial) => {
      expect(await decode([Buffer.from(" \t synthetic "), partial])).toBe(
        "synthetic �",
      );
      const fake = runtime();
      const onFailureDiagnostic = vi.fn();
      const result = fake.command("synthetic", [], { onFailureDiagnostic });
      fake.stderr.emit(
        "data",
        Buffer.from("ERROR: 42501: permission denied; synthetic "),
      );
      fake.stderr.emit("data", partial);
      fake.close(1);
      await expect(result).rejects.toThrow("Recovery subprocess failed");
      expect(onFailureDiagnostic).toHaveBeenCalledExactlyOnceWith(
        "ERROR: 42501: permission denied; synthetic �",
      );
    },
  );

  it("keeps simultaneous stdout and stderr multibyte sequences independent", async () => {
    const fake = runtime();
    const onFailureDiagnostic = vi.fn();
    const result = fake.command("synthetic", [], { onFailureDiagnostic });
    fake.stderr.emit(
      "data",
      Buffer.from("ERROR: 42501: permission denied; synthetic "),
    );
    const out = Buffer.from("—");
    const err = Buffer.from("é");
    fake.stdout!.emit("data", out.subarray(0, 1));
    fake.stderr.emit("data", err.subarray(0, 1));
    fake.stdout!.emit("data", out.subarray(1));
    fake.stderr.emit("data", err.subarray(1));
    fake.close(1);
    await expect(result).rejects.toThrow("Recovery subprocess failed");
    expect(onFailureDiagnostic).toHaveBeenCalledExactlyOnceWith(
      "ERROR: 42501: permission denied; synthetic é",
    );
  });

  it.each(splits)(
    "preserves private stderr %s split after byte %s",
    async (character, cut) => {
      const fake = runtime();
      const text = `ERROR: 42501: permission denied; DO_NOT_DISCLOSE ${character}`;
      const onFailureDiagnostic = vi.fn();
      const result = fake.command("synthetic", [], { onFailureDiagnostic });
      for (const chunk of splitCharacter(text, character, cut))
        fake.stderr.emit("data", chunk);
      fake.close(1);
      await expect(result).rejects.toMatchObject({
        message: "Recovery subprocess failed",
        sqlState: "42501",
        category: "permission_denied",
      });
      expect(onFailureDiagnostic).toHaveBeenCalledExactlyOnceWith(text);
    },
  );

  it.each([1, 2])(
    "reproduces the redacted punctuation failure without waiving it, split %s",
    async (cut) => {
      const text = captureText();
      const chunks = splitCharacter(text, "—", cut);
      const before = diagnostics.parseSourceInventoryCapture(text);
      // Legacy per-chunk decoding is a synthetic counterexample, not an accepted
      // normalization of the authoritative inventory or a hosted-cause claim.
      const corrupted = diagnostics.parseSourceInventoryCapture(
        chunks.map((chunk) => chunk.toString("utf8")).join(""),
      );
      const mismatch = drill.inventoryMismatchSummary(
        before.inventory,
        corrupted.inventory,
      );
      expect(mismatch.definitionShapeHints).toEqual([
        {
          kind: "function",
          sourceChangedLength: 1,
          restoredChangedLength: cut === 1 ? 3 : 2,
          sourceClasses: ["punctuation"],
          restoredClasses: ["punctuation"],
        },
      ]);
      const [unavailable] = diagnostics.sourceFunctionDriftHints(
        before.inventory,
        corrupted.inventory,
        before.diagnostics,
        corrupted.diagnostics,
        before.diagnostics,
      );
      expect(unavailable.snapshotQualification.before.correlationStatus).toBe(
        "MATCHED",
      );
      expect(unavailable.snapshotQualification.after.captureStatus).toBe(
        "QUALIFIED",
      );
      expect(unavailable.snapshotQualification.after.correlationStatus).toBe(
        "DEFINITION_MISMATCH",
      );
      expect(JSON.stringify(mismatch)).not.toContain("DO_NOT_DISCLOSE");
      expect(() =>
        drill.compareManifests(before.inventory, corrupted.inventory),
      ).toThrow("differs");

      const after = diagnostics.parseSourceInventoryCapture(
        await decode(chunks),
      );
      expect(after).toEqual(before);
      expect(
        drill.compareManifests(before.inventory, after.inventory),
      ).toMatchObject({ entries: 5, tables: 4, rows: 0 });
    },
  );

  it("retains strict failure for genuinely different Unicode definitions", async () => {
    const before = diagnostics.parseSourceInventoryCapture(
      await decode([Buffer.from(captureText("—"))]),
    );
    const after = diagnostics.parseSourceInventoryCapture(
      await decode(splitCharacter(captureText("–"), "–", 1)),
    );
    const [hint] = diagnostics.sourceFunctionDriftHints(
      before.inventory,
      after.inventory,
      before.diagnostics,
      after.diagnostics,
    );
    expect(hint.snapshotDiagnosticStatus).toBe("AVAILABLE");
    expect(hint.bodyChanged).toBe(true);
    expect(() =>
      drill.compareManifests(before.inventory, after.inventory),
    ).toThrow("differs");
    expect(
      JSON.stringify(
        drill.inventoryMismatchSummary(before.inventory, after.inventory),
      ),
    ).not.toContain("DO_NOT_DISCLOSE");
  });

  it("accepts the exact raw stdout byte bound and clears its timer", async () => {
    vi.useFakeTimers();
    const fake = runtime();
    const result = fake.command("synthetic", []);
    const chunk = Buffer.alloc(64 * 1024, "a");
    for (let i = 0; i < 512; i++) fake.stdout!.emit("data", chunk);
    fake.close(0);
    expect((await result).length).toBe(32 * 1024 * 1024);
    expect(fake.child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects raw-byte overflow even when decoded UTF-8 has fewer characters", async () => {
    const fake = runtime();
    // Keep the synthetic child alive after the kill request, then report exit 0.
    // The raw-byte guard must independently refuse an ostensibly successful exit.
    fake.child.kill.mockImplementation(() => {});
    const result = fake
      .command("synthetic", [])
      .catch((error: unknown) => error);
    const chunk = Buffer.alloc(64 * 1024).fill(Buffer.from("é"));
    for (let i = 0; i < 528; i++) fake.stdout!.emit("data", chunk);
    fake.close(0);
    const failure = await result;
    expect(fake.child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(failure).toMatchObject({
      message: "Recovery subprocess failed",
      category: "subprocess_failure",
    });
  });

  it("retains the bounded private stderr and fixed refusal", async () => {
    const fake = runtime();
    const onFailureDiagnostic = vi.fn();
    const result = fake.command("synthetic", [], { onFailureDiagnostic });
    const chunk = Buffer.alloc(64 * 1024, "x");
    for (let i = 0; i < 17; i++) fake.stderr.emit("data", chunk);
    fake.close(1);
    await expect(result).rejects.toThrow("Recovery subprocess failed");
    expect(onFailureDiagnostic).toHaveBeenCalledTimes(1);
    expect(onFailureDiagnostic.mock.calls[0][0].length).toBe(1024 * 1024);
  });

  it("does not replace a nonzero failure when its private diagnostic callback throws", async () => {
    const fake = runtime();
    const result = fake.command("synthetic", [], {
      onFailureDiagnostic: () => {
        throw new Error("DO_NOT_DISCLOSE_CALLBACK_ERROR");
      },
    });
    fake.stderr.emit(
      "data",
      Buffer.from("ERROR: 42501: permission denied DO_NOT_DISCLOSE_CREDENTIAL"),
    );
    fake.close(1);
    await expect(result).rejects.toMatchObject({
      message: "Recovery subprocess failed",
      sqlState: "42501",
      category: "permission_denied",
    });
    try {
      await result;
    } catch (error) {
      expect(String(error)).not.toContain("DO_NOT_DISCLOSE");
    }
  });

  it("retains sanitized startup failure and clears its timer", async () => {
    vi.useFakeTimers();
    const fake = runtime();
    const result = fake.command("synthetic", []);
    fake.child.emit("error", new Error("DO_NOT_DISCLOSE_STARTUP_ERROR"));
    fake.close(1);
    await expect(result).rejects.toThrow("Recovery subprocess could not start");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains timeout SIGKILL and fail-closed completion", async () => {
    vi.useFakeTimers();
    const fake = runtime();
    const result = fake
      .command("synthetic", [], { timeout: 5 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5);
    expect(fake.child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(await result).toMatchObject({
      message: "Recovery subprocess failed",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not decode binary output redirected to the private artifact descriptor", async () => {
    const fake = runtime(true);
    const result = fake.command("synthetic", [], {
      outputFd: 1234,
      input: "synthetic input",
    });
    fake.close(0);
    expect(await result).toBe("");
    expect(fake.spawn).toHaveBeenCalledWith("synthetic", [], {
      cwd: "synthetic-runtime-only",
      stdio: ["pipe", 1234, "pipe"],
    });
    expect(fake.stdin.end).toHaveBeenCalledWith("synthetic input");
  });
});
