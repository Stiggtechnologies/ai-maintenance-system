import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const shell = readFileSync(
  "scripts/ci-risk-uncertainty-analysis-smoke.sh",
  "utf8",
);
const path = "scripts/tests/risk-uncertainty-analysis-http-smoke.mjs";
const source = existsSync(path) ? readFileSync(path, "utf8") : "";
const sqlPath = "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql";
const sql = existsSync(sqlPath) ? readFileSync(sqlPath, "utf8") : "";
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const execute = new AsyncFunction(
  "assert",
  "readFileSync",
  "spawnSync",
  "process",
  "fetch",
  "console",
  source.replace(/^import[^\n]*\n/gm, ""),
);

function harness(
  env: Record<string, string>,
  statusText = 'API_URL="http://127.0.0.1:54321"\nANON_KEY="synthetic"\nSERVICE_ROLE_KEY="synthetic-service"\n',
) {
  const fixture = {
    ...Object.fromEntries(
      [
        "org",
        "foreign_org",
        "author",
        "reviewer",
        "foreign_user",
        "criteria",
        "risk",
        "other_risk",
        "verified",
        "unverified",
        "wrong_risk",
      ].map((key, index) => [
        key,
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ]),
    ),
    input: {},
  };
  const spawn = vi.fn((command: string, _args: string[], _options: unknown) => {
    void _args;
    void _options;
    if (command === "supabase") return { status: 0, stdout: statusText };
    if (command === "psql")
      return { status: 0, stdout: JSON.stringify(fixture) };
    throw new Error("unexpected synthetic subprocess");
  });
  const fetch = vi.fn(
    async (
      _url: string,
      _options: RequestInit,
    ): Promise<{ status: number; json: () => Promise<unknown> }> => {
      void _options;
      if (_url.includes("/auth/"))
        return {
          status: 200,
          json: async () => ({ access_token: "synthetic-token" }),
        };
      throw new Error("synthetic remote diagnostic with a credential");
    },
  );
  return {
    fixture,
    spawn,
    fetch,
    run: () =>
      execute(assert, () => sql, spawn, { env }, fetch, { log: vi.fn() }),
  };
}

describe("U18 isolated CI transport qualification", () => {
  it.each([undefined, "false"])(
    "refuses non-CI %s before any process/network",
    async (value) => {
      const h = harness(value === undefined ? {} : { GITHUB_ACTIONS: value });
      await expect(h.run()).rejects.toThrow();
      expect(h.spawn).not.toHaveBeenCalled();
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "PGHOSTADDR",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
    "PGOPTIONS",
    "PGHOST",
  ])("refuses ambient %s before status/login/SQL", async (key) => {
    const h = harness({ GITHUB_ACTIONS: "true", [key]: "remote-override" });
    await expect(h.run()).rejects.toThrow();
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'API_URL="https://example.invalid"\nANON_KEY="synthetic"\nSERVICE_ROLE_KEY="synthetic"\n',
    'API_URL="http://127.0.0.1:54321"\nAPI_URL="https://example.invalid"\nANON_KEY="synthetic"\nSERVICE_ROLE_KEY="synthetic"\n',
    'API_URL="http://127.0.0.1:54321"\nANON_KEY="$(credential-exfiltration)"\nSERVICE_ROLE_KEY="synthetic"\n',
    'API_URL="http://127.0.0.1:54321"\nANON_KEY="synthetic"\n',
  ])(
    "refuses unsafe/duplicate/missing config before fixtures or credentials",
    async (config) => {
      const h = harness({ GITHUB_ACTIONS: "true" }, config);
      await expect(h.run()).rejects.toThrow();
      expect(h.spawn).toHaveBeenCalledTimes(1);
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it("uses a controlled SQL environment and bounded redirect-rejecting HTTP, suppressing diagnostics", async () => {
    const h = harness({
      GITHUB_ACTIONS: "true",
      PATH: "/synthetic/bin",
      GITHUB_TOKEN: "not-for-sql",
    });
    await expect(h.run()).rejects.toThrow(
      "U18.02 isolated CI qualification failed",
    );
    expect(h.spawn.mock.calls[1][2]).toMatchObject({
      env: {
        PATH: "/synthetic/bin",
        LC_ALL: "C",
        LANG: "C",
        PGPASSWORD: "postgres",
        PGHOSTADDR: "127.0.0.1",
        PGOPTIONS: "-c search_path=public",
        PGSSLMODE: "disable",
      },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    expect(
      Object.keys((h.spawn.mock.calls[1][2] as { env: object }).env),
    ).toHaveLength(7);
    expect(h.fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [, options] of h.fetch.mock.calls) {
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("rejects malformed fixture output before logging in", async () => {
    const h = harness({ GITHUB_ACTIONS: "true" });
    h.spawn.mockImplementation((command) =>
      command === "supabase"
        ? {
            status: 0,
            stdout:
              'API_URL="http://127.0.0.1:54321"\nANON_KEY="synthetic"\nSERVICE_ROLE_KEY="synthetic-service"\n',
          }
        : { status: 0, stdout: '{"org":"unsafe-sql-fragment"}' },
    );
    await expect(h.run()).rejects.toThrow();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("keeps SQL fixtures random, rollback-only and independent from seeded users", () => {
    expect(sql.trimStart()).toMatch(/^--[^]*?\bbegin;/i);
    expect(sql.match(/\brollback;/gi)).toHaveLength(1);
    expect(sql).not.toMatch(
      /on conflict|11111111-1111|admin@syncai|demo@syncai/i,
    );
    expect(sql).toContain("gen_random_uuid()");
    expect(sql).toContain("1|2|1|0|0");
    expect(sql).toContain("truncate refused");
    expect(sql).toContain("risk_uncertainty_analysis_digest(uuid,uuid)");
    for (const relation of [
      "risk_uncertainty_analyses",
      "risk_uncertainty_analysis_evidence",
      "approvals",
      "audit_events",
      "evidence_items",
    ])
      expect(sql).toMatch(
        new RegExp(`jsonb_agg\\(to_jsonb\\([a-z]\\)[^\\n]*from ${relation}`),
      );
  });

  it.each([null, 1, 79])(
    "suppresses subprocess failure %s before fixture/network progression",
    async (code) => {
      const h = harness({ GITHUB_ACTIONS: "true" });
      h.spawn.mockReturnValue({
        status: code,
        stdout: "synthetic private provider diagnostic",
      } as ReturnType<typeof h.spawn>);
      await expect(h.run()).rejects.toThrow(
        "U18.02 isolated CI qualification failed",
      );
      expect(h.spawn).toHaveBeenCalledTimes(1);
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it("does not follow a login redirect or retry a transport failure", async () => {
    const h = harness({ GITHUB_ACTIONS: "true" });
    h.fetch.mockImplementation(async (_url, options) => {
      expect(options.redirect).toBe("error");
      throw new Error("synthetic redirect/credential diagnostic");
    });
    await expect(h.run()).rejects.toThrow(
      "U18.02 isolated CI qualification failed",
    );
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  function transcript(mode = "valid") {
    const h = harness({ GITHUB_ACTIONS: "true" });
    const f = h.fixture as Record<string, unknown>;
    const packet = "00000000-0000-4000-8000-000000000021";
    const approval = "00000000-0000-4000-8000-000000000022";
    const derived = "00000000-0000-4000-8000-000000000023";
    const digest = "a".repeat(64);
    let stale = false;
    h.spawn.mockImplementation((command, args) => {
      if (command === "supabase")
        return {
          status: 0,
          stdout:
            'API_URL="http://127.0.0.1:54321"\nANON_KEY="synthetic"\nSERVICE_ROLE_KEY="synthetic-service"\n',
        };
      const statement = args.at(-1) ?? "";
      if (statement.includes("select row_to_json"))
        return { status: 0, stdout: JSON.stringify(f) };
      if (statement.includes("with changed")) {
        stale = true;
        return { status: 0, stdout: "1" };
      }
      if (statement.includes("concat_ws"))
        return { status: 0, stdout: "1|2|1|0|0" };
      if (statement.includes("select count(*) from risks where id in"))
        return { status: 0, stdout: "2" };
      return { status: 0, stdout: "{}" };
    });
    h.fetch.mockImplementation(async (url, options) => {
      const args = JSON.parse(String(options.body));
      const headers = options.headers as Record<string, string>;
      const respond = (status: number, body: unknown) => ({
        status,
        json: async () => body,
      });
      if (url.includes("/auth/"))
        return respond(200, { access_token: `synthetic-${args.email}` });
      if (url.endsWith("submit_risk_uncertainty_analysis")) {
        if (args.p_analysis.probability_lower === 0.7)
          return respond(200, {
            error:
              "probability range must satisfy 0 <= lower <= central <= upper <= 1",
          });
        if (args.p_evidence_item_ids[0] !== f.verified)
          return respond(200, {
            error:
              "all cited inputs must be verified evidence linked to this exact risk",
          });
        if (mode === "lost")
          throw new Error("synthetic committed-write/lost-response credential");
        if (mode === "malformed") return respond(200, {});
        if (mode === "identity-error")
          return respond(200, {
            error: "synthetic refusal",
            analysisId: packet,
          });
        return respond(200, {
          riskId: mode === "wrong-risk" ? f.other_risk : f.risk,
          analysisId: packet,
          analysisDigest: digest,
          version: 1,
          validationStatus: "pending_review",
          operationalAuthorization: false,
          valueOfInformation: {
            expectedValue: 37500,
            netValue: 27500,
            recommendation: "GATHER_INFORMATION",
          },
        });
      }
      if (url.endsWith("review_risk_uncertainty_analysis")) {
        if (headers.authorization.includes(String(f.author)))
          return respond(200, {
            error:
              "analysis author cannot independently review the same packet",
          });
        return respond(200, {
          riskId: f.risk,
          analysisId: packet,
          analysisDigest: digest,
          decision: "validated",
          approvalId: approval,
          derivedEvidenceItemId: derived,
          operationalAuthorization: false,
        });
      }
      if (headers.apikey === "synthetic-service")
        return mode === "gateway"
          ? respond(503, { code: "42501" })
          : respond(403, { code: "42501" });
      if (headers.authorization.includes(String(f.foreign_user)))
        return respond(200, { error: "risk not found in this organization" });
      return respond(200, {
        risk: { id: f.risk },
        criteria: { id: f.criteria, status: "adopted" },
        operationalAuthorization: false,
        boundary: "It does not verify an unverified source",
        analyses: [
          {
            id: packet,
            validationStatus: stale ? "stale" : "validated",
            analysisDigest: digest,
            currentDigest: stale ? "b".repeat(64) : digest,
            approvalId: approval,
            derivedEvidenceItemId: derived,
            decisionThresholds: { escalateAbove: 16, stopAbove: 24 },
            probability: { lower: 0.15, central: 0.3, upper: 0.55 },
            sensitivityResults: [{ name: "Startup exposure", swing: 170000 }],
            valueOfInformation: { netValue: 27500 },
          },
        ],
      });
    });
    return h;
  }

  it("executes the entire original-assertion HTTP transcript with synthetic boundaries only", async () => {
    const h = transcript();
    await expect(h.run()).resolves.toBeUndefined();
    expect(
      h.fetch.mock.calls.filter(([url]) =>
        url.endsWith("submit_risk_uncertainty_analysis"),
      ),
    ).toHaveLength(4);
    expect(
      h.fetch.mock.calls.filter(([url]) =>
        url.endsWith("review_risk_uncertainty_analysis"),
      ),
    ).toHaveLength(2);
    for (const [url, options] of h.fetch.mock.calls) {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:54321\//);
      expect(options.redirect).toBe("error");
    }
  });

  it.each(["lost", "malformed", "identity-error", "wrong-risk", "gateway"])(
    "fails closed on %s without replaying any positive write",
    async (mode) => {
      const h = transcript(mode);
      await expect(h.run()).rejects.toThrow(
        "U18.02 isolated CI qualification failed",
      );
      expect(
        h.fetch.mock.calls.filter(([url]) =>
          url.endsWith("submit_risk_uncertainty_analysis"),
        ),
      ).toHaveLength(4);
      if (mode !== "gateway")
        expect(
          h.fetch.mock.calls.filter(([url]) =>
            url.endsWith("review_risk_uncertainty_analysis"),
          ),
        ).toHaveLength(0);
    },
  );

  it("runs actual shell control flow with substituted executable boundaries", () => {
    function run(
      args: string[],
      ci: string,
      sqlStatus: number,
      httpStatus: number,
    ) {
      const prefix = `env() { printf '%s\\n' SQL_BOUNDARY; printf 'ARG:%s\\n' "$@"; return ${sqlStatus}; }\nnode() { printf '%s\\n' HTTP_BOUNDARY; return ${httpStatus}; }\n`;
      return spawnSync("/bin/bash", ["-s", "--", ...args], {
        input: prefix + shell,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          LC_ALL: "C",
          LANG: "C",
          GITHUB_ACTIONS: ci,
          PGHOSTADDR: "remote-override",
        },
      });
    }
    const full = run([], "true", 0, 0);
    expect(full.status).toBe(0);
    expect(full.stdout).toContain("SQL_BOUNDARY");
    expect(full.stdout).toContain("HTTP_BOUNDARY");
    expect(full.stdout).toContain("ARG:-i\n");
    expect(full.stdout).toContain("ARG:PGHOSTADDR=127.0.0.1\n");
    expect(full.stdout).toContain("ARG:-X\n");
    expect(full.stdout).not.toContain("remote-override");
    for (const args of [["bad"], ["--sql-preflight", "extra"], [""]]) {
      const result = run(args, "true", 0, 0);
      expect(result.status).toBe(2);
      expect(result.stdout).not.toContain("BOUNDARY");
    }
    const off = run([], "false", 0, 0);
    expect(off.status).toBe(1);
    expect(off.stdout).not.toContain("BOUNDARY");
    const failure = run([], "true", 9, 0);
    expect(failure.status).toBe(9);
    expect(failure.stdout).not.toContain("HTTP_BOUNDARY");
    expect(run([], "true", 0, 7).status).toBe(7);
    const preflight = run(["--sql-preflight"], "true", 0, 0);
    expect(preflight.status).toBe(0);
    expect(preflight.stdout).not.toContain("HTTP_BOUNDARY");
  });
});
