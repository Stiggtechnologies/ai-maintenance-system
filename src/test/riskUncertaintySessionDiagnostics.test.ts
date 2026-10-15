import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs",
  "utf8",
);
const native = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
  "utf8",
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const execute = new AsyncFunction(
  "assert",
  "createHash",
  "readFileSync",
  "spawn",
  "randomUUID",
  "createInterface",
  "process",
  "console",
  script.replace(/^import[^\n]*\n/gm, ""),
);

type DiagnosticError = Error & { kind?: string; sqlState?: string | null };
type Fault =
  "server" | "process" | "spawn" | "stdin-event" | "stdin-throw" | "watchdog";

// Execute the actual harness adapter with a synthetic subprocess failing its
// first BOOTSTRAP query. No real server, SQL fixture or race is qualified here.
function probe(fault: Fault, chunks: string[] = [], exitFirst = false) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: EventEmitter & {
      destroyed: boolean;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    child.exitCode = 3;
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 3);
  };
  child.kill = vi.fn(() => {
    queueMicrotask(close);
    return true;
  });
  child.stdin = Object.assign(new EventEmitter(), {
    destroyed: false,
    end: vi.fn(),
    write: vi.fn((_sql: string, done: (error?: Error) => void) => {
      if (fault === "stdin-throw") throw new Error("PRIVATE write details");
      done();
      queueMicrotask(() => {
        if (fault === "watchdog") {
          for (const chunk of chunks) child.stderr.write(chunk);
          return;
        }
        if (fault === "stdin-event") {
          child.stdin.emit("error", new Error("PRIVATE stdin details"));
          if (chunks.length === 0) return;
        }
        if (exitFirst) {
          child.exitCode = 3;
          child.emit("exit", 3);
        }
        for (const chunk of chunks) child.stderr.write(chunk);
        if (!exitFirst) {
          child.exitCode = 3;
          child.emit("exit", 3);
        }
        close();
      });
      return true;
    }),
  });
  const spawn = vi.fn((_command: string, args: string[]) => {
    expect(args).toContain("ON_ERROR_STOP=1");
    if (fault === "spawn") throw new Error("PRIVATE spawn details");
    return child;
  });
  const log = vi.fn();
  const result: Promise<DiagnosticError> = execute(
    assert,
    createHash,
    () => native,
    spawn,
    randomUUID,
    createInterface,
    {
      env: { GITHUB_ACTIONS: "true", PATH: "/synthetic/bin" },
      argv: ["node", "script", "--ci-uncertainty-concurrency"],
    },
    { log },
  ).then(
    () => {
      throw new Error("subprocess fault must not qualify SQL");
    },
    (error: DiagnosticError) => error,
  );
  return { result, child, spawn, log };
}

describe("U18 actual-script subprocess failure diagnostics (not native SQL)", () => {
  it.each(["40P01", "57014", "55P03"])(
    "retains only severity-framed SQLSTATE %s through fragmented stderr and exit-before-close",
    async (code) => {
      const run = probe(
        "server",
        [`psql:<stdin>:1: ERROR:  ${code.slice(0, 2)}`, `${code.slice(2)}\n`],
        true,
      );
      const error = await run.result;
      expect(error.name).toBe("U18QualificationError");
      expect(error.kind).toBe("server");
      expect(error.sqlState).toBe(code);
      expect(error.message).toContain(`SQLSTATE=${code}`);
      expect(error.message).not.toContain("<stdin>");
      expect(run.log).not.toHaveBeenCalled();
      expect(run.spawn).toHaveBeenCalledTimes(1);
      expect(run.spawn.mock.calls[0][1]).toContain("VERBOSITY=sqlstate");
    },
  );

  it("flushes a final code-only line without a newline only after stderr has drained", async () => {
    const error = await probe("server", ["FATAL:  08006"], true).result;
    expect(error.kind).toBe("server");
    expect(error.sqlState).toBe("08006");
  });

  it.each([
    "NOTICE:  40P01\n",
    "DETAIL:  40P01\n",
    "ERROR:  PRIVATE provider statement containing 40P01\n",
    "ERROR:  40P01 PRIVATE row content\n",
    "ERROR:  40p01\n",
    "psql:<stdin>:1: NOTICE:  ERROR:  40P01\n",
    "psql:<stdin>:1: ERROR: PRIVATE provider detail: ERROR:  40P01\n",
    `${"x".repeat(1024)} ERROR:  40P01\n`,
    "40P01\n",
  ])(
    "ignores unframed or private diagnostics without echoing them",
    async (chunk) => {
      const run = probe("process", [chunk]);
      const error = await run.result;
      expect(error.kind).toBe("process");
      expect(error.sqlState).toBeNull();
      expect(error.message).not.toMatch(
        /PRIVATE|40P01|provider|statement|row content/,
      );
      expect(run.log).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["40P01", "57014"],
    ["57014", "40P01"],
  ])(
    "retains the first framed server code rather than selecting a later code",
    async (first, second) => {
      const error = await probe("server", [
        `ERROR:  ${first}\nFATAL:  ${second}\n`,
      ]).result;
      expect(error.kind).toBe("server");
      expect(error.sqlState).toBe(first);
    },
  );

  it.each(["process", "spawn", "stdin-event", "stdin-throw"] as const)(
    "keeps %s without a server code distinct from a deadlock",
    async (fault) => {
      const run = probe(fault);
      const error = await run.result;
      expect(error.kind).toBe("process");
      expect(error.sqlState).toBeNull();
      expect(error.message).not.toMatch(/PRIVATE|40P01/);
      expect(run.log).not.toHaveBeenCalled();
    },
  );

  it("retains the final drained server code when an earlier stdin EPIPE requests process termination", async () => {
    const run = probe("stdin-event", ["psql:<stdin>:1: ERROR:  40", "P01\n"]);
    const error = await run.result;
    expect(run.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(error.kind).toBe("server");
    expect(error.sqlState).toBe("40P01");
    expect(error.message).not.toContain("PRIVATE");
    expect(run.log).not.toHaveBeenCalled();
  });

  it("preserves the 25-second client watchdog and bounded termination without reporting a server deadlock", async () => {
    vi.useFakeTimers();
    try {
      const run = probe("watchdog", ["ERROR:  40P01\n"]);
      await vi.advanceTimersByTimeAsync(24999);
      expect(run.child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const error = await run.result;
      expect(error.kind).toBe("watchdog");
      expect(error.sqlState).toBeNull();
      expect(run.child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(run.log).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
