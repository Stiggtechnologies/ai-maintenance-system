import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
  "createHash",
  "randomUUID",
  "Date",
  "setTimeout",
  source.replace(/^import[^\n]*\n/gm, ""),
);

function harness(
  env: Record<string, string>,
  statusText = 'API_URL="http://127.0.0.1:54321"\nANON_KEY="synthetic"\nSERVICE_ROLE_KEY="synthetic-service"\n',
) {
  // Only synthetic AsyncFunction execution uses this clock. The original HTTP
  // program's real due-date loop and every assertion remain byte-for-byte.
  let clock = Date.parse("2026-10-06T12:00:00Z");
  class TranscriptDate extends Date {
    static now() {
      return clock;
    }
  }
  const wait = vi.fn((resolve: () => void, ms: number) => {
    clock += ms;
    resolve();
    return 0;
  });
  const nativeInput = sql.match(/as wrong_risk,\s*'([^]*?)'::jsonb/)?.[1];
  assert.ok(nativeInput, "actual native fixture proposal is present");
  const fixture: Record<string, unknown> = {
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
    input: {
      ...JSON.parse(nativeInput),
      review_due_at: new Date(clock + 30 * 86400_000).toISOString(),
    },
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
    wait,
    now: () => clock,
    run: () =>
      execute(
        assert,
        () => sql,
        spawn,
        { env },
        fetch,
        { log: vi.fn() },
        createHash,
        randomUUID,
        TranscriptDate,
        wait,
      ),
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

  it.each([
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "DOCKER_API_VERSION",
    "DOCKER_CUSTOM_HEADERS",
    "CONTAINER_HOST",
    "CONTAINER_CONNECTION",
  ])(
    "refuses ambient %s before credential discovery, SQL or HTTP",
    async (key) => {
      for (const value of ["remote-override", ""]) {
        const h = harness({ GITHUB_ACTIONS: "true", [key]: value });
        await expect(h.run()).rejects.toThrow(
          "U18.02 isolated CI qualification failed",
        );
        expect(h.spawn).not.toHaveBeenCalled();
        expect(h.fetch).not.toHaveBeenCalled();
      }
    },
  );

  it("pins status discovery to the local Unix socket in a narrow child environment", async () => {
    const h = harness({
      GITHUB_ACTIONS: "true",
      PATH: "/synthetic/bin",
      HOME: "/synthetic/home",
      GITHUB_TOKEN: "private",
      HTTPS_PROXY: "https://remote.invalid",
      HTTP_PROXY: "http://remote.invalid",
      NODE_OPTIONS: "private",
    });
    await expect(h.run()).rejects.toThrow(
      "U18.02 isolated CI qualification failed",
    );
    expect(h.spawn.mock.calls[0]).toEqual([
      "supabase",
      ["status", "-o", "env"],
      {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        env: {
          PATH: "/synthetic/bin",
          HOME: "/synthetic/home",
          LC_ALL: "C",
          LANG: "C",
          DOCKER_HOST: "unix:///var/run/docker.sock",
        },
      },
    ]);
  });

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
    const representationPacket = "00000000-0000-4000-8000-000000000031";
    const approval = "00000000-0000-4000-8000-000000000022";
    const derived = "00000000-0000-4000-8000-000000000023";
    const digest = "a".repeat(64);
    const pendingPacket = "00000000-0000-4000-8000-000000000041";
    const replacementPacket = "00000000-0000-4000-8000-000000000042";
    const policyDigest = "c".repeat(64);
    const voi = {
      informationCost: 10000,
      decisionCostIfWrong: 250000,
      uncertaintyReduction: 0.5,
      probabilityDecisionChanges: 0.3,
      expectedValue: 37500,
      netValue: 27500,
      recommendation: "GATHER_INFORMATION",
    };
    type Row = Record<string, unknown>;
    // Whole rows in all thirteen collections, with untouched sentinel content
    // in both organizations. This is a synthetic boundary model, NOT a native
    // database witness. The unmodified HTTP program checks its full delta.
    const row = (id: string, org: unknown, extra: Row = {}): Row => ({
      id,
      organization_id: org,
      retained_fixture_content: "unchanged",
      ...extra,
    });
    const ledger: Record<string, Row[]> = Object.fromEntries(
      [
        "risks",
        "packets",
        "bindings",
        "approvals",
        "audit",
        "evidence",
        "criteria",
        "securityEvents",
        "decisions",
        "work",
        "stakeholderViews",
        "scenarios",
        "profiles",
      ].map((key, index) => [
        key,
        [row(`local-${index}`, f.org), row(`foreign-${index}`, f.foreign_org)],
      ]),
    );
    const storedPacket = (id: string, version: number, status: string): Row =>
      row(id, f.org, {
        ...Object.fromEntries(
          Object.entries(f.input as Row).filter(
            ([key]) => !["sensitivity", "reassessment_triggers"].includes(key),
          ),
        ),
        risk_id: f.risk,
        author_id: f.author,
        version,
        status,
        analysis_digest: digest,
        digest_version: 2,
        created_at: "2026-10-06T12:00:00Z",
        input_binding_snapshot: {
          digestVersion: 2,
          bindingComplete: true,
          evidence: [f.verified],
        },
        basis: (f.input as Row).basis,
        reviewer_id: status === "validated" ? f.reviewer : null,
        approval_id: status === "validated" ? approval : null,
        derived_evidence_item_id: status === "validated" ? derived : null,
        reviewed_at: status === "validated" ? "2026-10-06T12:00:01Z" : null,
        review_note:
          status === "validated" ? "Independent synthetic review." : null,
        replaces_analysis_id: null,
        replacement_intent_id: null,
        replacement_request_fingerprint: null,
        replacement_compare_and_swap: null,
        replacement_reason: null,
        superseded_by_analysis_id: null,
        superseded_at: null,
        superseded_by_user_id: null,
        operational_authorization: false,
        threshold_profile_id: f.criteria,
        decision_thresholds: { escalateAbove: 16, stopAbove: 24 },
        sensitivity_inputs: (f.input as Row).sensitivity,
        sensitivity_results: [{ name: "Startup exposure", swing: 170000 }],
        reassessment_triggers: (f.input as Row).reassessment_triggers,
        voi_expected_value: 37500,
        voi_net_value: 27500,
        voi_recommendation: "GATHER_INFORMATION",
      });
    ledger.packets.push(storedPacket(packet, 1, "validated"));
    ledger.risks.push(
      row(String(f.risk), f.org, {
        status: "draft",
        updated_at: "original",
        value_of_information: {
          analysis_id: packet,
          operational_authorization: false,
        },
      }),
    );
    ledger.evidence.push(
      row(String(f.verified), f.org, {
        risk_id: f.risk,
        quality_grade: "high",
        verification_status: "verified",
      }),
    );
    const bindingSnapshot = () => ({
      digestVersion: 2,
      organizationId: f.org,
      riskId: f.risk,
      expectedEvidenceIds: [f.verified],
      expectedEvidenceCount: 1,
      foundEvidenceCount: 1,
      bindingComplete: true,
      evidence: [
        structuredClone(ledger.evidence.find((e) => e.id === f.verified)),
      ],
      currentCriteriaProfileId: f.criteria,
      currentCriteria: {
        id: f.criteria,
        organizationId: f.org,
        version: 1,
        status: "adopted",
        decisionThresholds: { escalateAbove: 16, stopAbove: 24 },
      },
    });
    let positiveSubmits = 0;
    let replacementReceipt: Row | undefined;
    let replacementText: string | undefined;
    let replayedAfterDue = false;
    let receiptReads = 0;
    const cancelled = vi.fn(async () => {
      if (mode === "replacement-cancel-lost")
        throw new Error("synthetic cancelled-body transport loss");
    });
    const syntheticMutation = vi.fn();
    const changeForeign = () => {
      ledger.profiles[1].retained_fixture_content = "corrupted";
    };
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
        const evidence = ledger.evidence.find((e) => e.id === f.verified)!;
        evidence.quality_grade = statement.includes("quality_grade='moderate'")
          ? "moderate"
          : "high";
        return { status: 0, stdout: "1" };
      }
      if (statement.includes("risk_uncertainty_current_policy_digest"))
        return { status: 0, stdout: policyDigest };
      if (
        statement.includes(
          "select public.risk_uncertainty_input_binding_snapshot(",
        )
      )
        return { status: 0, stdout: JSON.stringify(bindingSnapshot()) };
      if (statement.includes("select public.risk_uncertainty_analysis_digest("))
        return {
          status: 0,
          stdout: (mode === "replacement-live-digest" ? "e" : "d").repeat(64),
        };
      if (
        statement.includes("'profiles'") &&
        statement.includes("'stakeholderViews'")
      )
        return { status: 0, stdout: JSON.stringify(ledger) };
      if (
        statement.includes("concat_ws") &&
        statement.includes(representationPacket)
      )
        return {
          status: 0,
          stdout:
            mode === "representation-authority" ? "1|1|1|0|0" : "1|1|0|0|0",
        };
      if (statement.includes("confidence_level=1e-999::numeric"))
        return {
          status: 0,
          stdout: mode === "representation-persistence" ? "0" : "1",
        };
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
      if (url.endsWith("record_risk_value_of_information")) {
        if (mode === "canonical-finite-forbidden")
          return respond(200, { error: "forbidden" });
        if (mode === "canonical-finite-lost")
          throw new Error("synthetic lost finite-refusal response");
        if (mode === "canonical-finite-success")
          return respond(200, { evidence_id: derived });
        if (mode === "canonical-finite-malformed")
          return respond(200, { error: "", evidence_id: derived });
        const specialCost = ["information_cost", "decision_cost_if_wrong"].some(
          (field) => ["NaN", "+Infinity"].includes(args.p_analysis[field]),
        );
        return respond(200, {
          error: specialCost
            ? "value-of-information inputs must be finite numbers"
            : "costs must be non-negative and probability inputs must be between 0 and 1",
        });
      }
      if (url.endsWith("replace_risk_uncertainty_analysis")) {
        const request = JSON.parse(args.p_request_text);
        if (replacementReceipt) {
          expect(args.p_request_text).toBe(replacementText);
          expect(h.now()).toBeGreaterThan(
            Date.parse(request.analysis.review_due_at),
          );
          replayedAfterDue = true;
          if (mode === "replacement-replay-write") {
            syntheticMutation("replay");
            changeForeign();
          }
          return respond(
            200,
            mode === "replacement-replay-receipt"
              ? { ...replacementReceipt, submittedStatus: "validated" }
              : replacementReceipt,
          );
        }
        replacementText = args.p_request_text;
        const fingerprint = createHash("sha256")
          .update(replacementText!, "utf8")
          .digest("hex");
        expect(request.riskId).toBe(f.risk);
        expect(request.actorId).toBe(f.author);
        expect(request.organizationId).toBe(f.org);
        expect(request.predecessor.analysisId).toBe(pendingPacket);
        expect(request.predecessor.version).toBe(2);
        expect(request.predecessor.currentDigest).toBe("b".repeat(64));
        expect(request.policyDigest).toBe(policyDigest);
        expect(request.evidenceItemIds).toEqual([f.verified]);
        const predecessor = ledger.packets.find((p) => p.id === pendingPacket)!;
        const created = "2026-10-06T12:00:02Z";
        Object.assign(predecessor, {
          status: "superseded",
          superseded_by_analysis_id: replacementPacket,
          superseded_at: created,
          superseded_by_user_id: f.author,
        });
        const cas = { ...request.predecessor, policyDigest };
        const successor: Row = {
          ...structuredClone(predecessor),
          id: replacementPacket,
          status: "pending_review",
          version: 3,
          superseded_by_analysis_id: null,
          superseded_at: null,
          superseded_by_user_id: null,
          created_at: created,
          analysis_digest: "d".repeat(64),
          input_binding_snapshot: bindingSnapshot(),
          replaces_analysis_id: pendingPacket,
          replacement_intent_id: request.intentId,
          replacement_request_fingerprint: fingerprint,
          replacement_compare_and_swap: cas,
          replacement_reason: request.reason,
          review_due_at: request.analysis.review_due_at,
        };
        ledger.packets.push(successor);
        ledger.bindings.push({
          organization_id: f.org,
          analysis_id: replacementPacket,
          evidence_item_id: f.verified,
          created_at: created,
        });
        ledger.audit.push({
          ...ledger.audit.find(
            (a) => a.entity_type === "risk_uncertainty_analysis_submitted",
          ),
          id: "00000000-0000-4000-8000-000000000043",
          organization_id: f.org,
          actor: "admin",
          created_at: created,
          event_time: created,
          entity_type: "risk_uncertainty_analysis_replaced",
          event_data: {
            risk_id: f.risk,
            analysis_id: replacementPacket,
            replacement_intent_id: request.intentId,
            predecessor_analysis_id: pendingPacket,
            request_fingerprint: fingerprint,
            compare_and_swap: cas,
            reason: request.reason,
            version: 3,
            analysis_digest: successor.analysis_digest,
            evidence_item_ids: [f.verified],
            threshold_profile_id: f.criteria,
            operational_authorization: false,
          },
        });
        const risk = ledger.risks.find((r) => r.id === f.risk)!;
        Object.assign(risk, {
          updated_at: created,
          value_of_information: {
            information_action: String((f.input as Row).voi_action).trim(),
            information_cost: 10000,
            decision_cost_if_wrong: 250000,
            uncertainty_reduction: 0.5,
            probability_decision_changes: 0.3,
            expected_value: 37500,
            net_value: 27500,
            recommendation: "GATHER_INFORMATION",
            currency: "CAD",
            analysis_id: replacementPacket,
            validation_status: "pending_review",
            recorded_at: created,
            human_decision_required: true,
            operational_authorization: false,
          },
        });
        replacementReceipt = {
          commitStatus: "committed",
          submittedStatus: "pending_review",
          organizationId: f.org,
          actorId: f.author,
          riskId: f.risk,
          intentId: request.intentId,
          requestFingerprint: fingerprint,
          predecessorAnalysisId: pendingPacket,
          analysisId: replacementPacket,
          version: 3,
          analysisDigest: successor.analysis_digest,
          digestVersion: 2,
          digestCoverage: "evidence_content_and_current_criteria",
          compareAndSwap: cas,
          valueOfInformation: voi,
          operationalAuthorization: false,
        };
        syntheticMutation("replacement");
        if (mode === "replacement-pair-history")
          predecessor.basis = "rewritten";
        if (mode === "replacement-foreign-state") changeForeign();
        if (mode === "replacement-extra-approval")
          ledger.approvals.push(row("fabricated-approval", f.org));
        if (mode === "replacement-binding")
          ledger.bindings[0].retained_fixture_content = "rewritten";
        if (mode === "replacement-audit")
          ledger.audit.at(-1)!.entity_type =
            "risk_uncertainty_analysis_reviewed";
        if (mode === "replacement-voi-authority")
          (risk.value_of_information as Row).operational_authorization = true;
        if (mode === "replacement-successor-input")
          successor.method = "rewritten";
        if (mode === "replacement-successor-snapshot")
          successor.input_binding_snapshot = {
            ...bindingSnapshot(),
            bindingComplete: false,
          };
        if (mode === "replacement-new-binding")
          ledger.bindings.at(-1)!.evidence_item_id = f.wrong_risk;
        if (mode === "replacement-audit-payload")
          (ledger.audit.at(-1)!.event_data as Row).reason = "rewritten";
        if (mode === "replacement-voi-math")
          (risk.value_of_information as Row).expected_value = 666;
        if (mode === "replacement-due-date")
          successor.review_due_at = "2026-10-06T12:00:01Z";
        return {
          ...respond(
            mode === "replacement-response-status" ? 503 : 200,
            replacementReceipt,
          ),
          body: { cancel: cancelled },
        };
      }
      if (url.endsWith("get_risk_uncertainty_replacement_receipt")) {
        expect(replacementReceipt).toBeDefined();
        receiptReads++;
        const matches =
          headers.authorization.includes(String(f.author)) &&
          args.p_risk_id === f.risk &&
          args.p_intent_id === replacementReceipt!.intentId &&
          args.p_request_fingerprint === replacementReceipt!.requestFingerprint;
        if (!matches) {
          if (mode === "replacement-refusal-write") {
            syntheticMutation("refusal");
            changeForeign();
          }
          return respond(
            200,
            mode === "replacement-refusal-content"
              ? {
                  error: "no visible committed receipt",
                  analysisId: replacementPacket,
                }
              : {
                  error: headers.authorization.includes(String(f.foreign_user))
                    ? "risk not found in this organization"
                    : "no matching committed replacement receipt is visible",
                },
          );
        }
        const corrupt = { ...replacementReceipt };
        if (mode === "replacement-receipt-actor") corrupt.actorId = f.reviewer;
        if (mode === "replacement-receipt-fingerprint")
          corrupt.requestFingerprint = "e".repeat(64);
        if (mode === "replacement-receipt-coverage")
          corrupt.digestCoverage = "source_approved";
        if (mode === "replacement-receipt-cas") corrupt.compareAndSwap = {};
        if (mode === "replacement-receipt-extra-key")
          corrupt.sourceApproved = true;
        if (receiptReads > 1)
          expect(h.now()).toBeGreaterThan(
            Date.parse(JSON.parse(replacementText!).analysis.review_due_at),
          );
        return respond(200, corrupt);
      }
      if (url.endsWith("submit_risk_uncertainty_analysis")) {
        if (args.p_risk_id === f.other_risk) {
          expect(args.p_evidence_item_ids).toEqual([f.wrong_risk]);
          expect(args.p_analysis.confidence_level).toBe("1e-999");
          expect(args.p_analysis.review_due_at).toBe(
            "280000-01-01T00:00:00+00:00",
          );
          if (mode === "representation-lost")
            throw new Error("synthetic lost representation response");
          return respond(200, {
            riskId: mode === "representation-identity" ? f.risk : f.other_risk,
            analysisId: representationPacket,
            analysisDigest: digest,
            version: 1,
            validationStatus: "pending_review",
            operationalAuthorization: false,
          });
        }
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
        positiveSubmits++;
        if (positiveSubmits === 2) {
          ledger.packets.push(storedPacket(pendingPacket, 2, "pending_review"));
          ledger.bindings.push(
            row("pending-binding", f.org, {
              analysis_id: pendingPacket,
              evidence_item_id: f.verified,
            }),
          );
          ledger.audit.push(
            row("pending-audit", f.org, {
              entity_type: "risk_uncertainty_analysis_submitted",
            }),
          );
          return respond(200, {
            riskId: f.risk,
            analysisId: pendingPacket,
            analysisDigest: digest,
            version: 2,
            validationStatus: "pending_review",
            operationalAuthorization: false,
            valueOfInformation: voi,
          });
        }
        return respond(200, {
          riskId: mode === "wrong-risk" ? f.other_risk : f.risk,
          analysisId: packet,
          analysisDigest: digest,
          version: 1,
          validationStatus: "pending_review",
          operationalAuthorization: false,
          valueOfInformation: {
            informationCost: 10000,
            decisionCostIfWrong: 250000,
            uncertaintyReduction: 0.5,
            probabilityDecisionChanges: 0.3,
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
      if (args.p_risk_id === f.other_risk)
        return respond(200, {
          organizationId: f.org,
          actorId: f.author,
          risk: { id: f.other_risk, organizationId: f.org },
          analyses: [
            {
              id: representationPacket,
              organizationId: f.org,
              riskId: f.other_risk,
              validationStatus: "pending_review",
              storedStatus: "pending_review",
              reviewStanding:
                mode === "representation-standing"
                  ? "replacement_required"
                  : "reviewable",
              confidence: {
                level: mode === "representation-confidence" ? 1 : 0,
              },
              reviewDueAt:
                mode === "representation-date"
                  ? "2026-01-01T00:00:00+00:00"
                  : "280000-01-01T00:00:00+00:00",
              operationalAuthorization: false,
            },
          ],
        });
      return respond(200, {
        organizationId: f.org,
        actorId: f.author,
        risk: { id: f.risk, organizationId: f.org },
        criteria: {
          id: f.criteria,
          organizationId: f.org,
          status: "adopted",
          policyDigest:
            mode === "policy-digest-missing"
              ? undefined
              : mode === "policy-digest-malformed"
                ? "b".repeat(63)
                : "c".repeat(64),
        },
        evidence: [{ id: f.verified, organizationId: f.org, riskId: f.risk }],
        operationalAuthorization: false,
        boundary: "It does not verify an unverified source",
        analyses: [
          ...(positiveSubmits === 2
            ? [
                {
                  id: pendingPacket,
                  version: 2,
                  digestVersion: 2,
                  storedStatus: "pending_review",
                  reviewStanding: "replacement_required",
                  analysisDigest: digest,
                  currentDigest: "b".repeat(64),
                },
              ]
            : []),
          {
            id: packet,
            organizationId: f.org,
            riskId: f.risk,
            storedStatus: "validated",
            digestVersion:
              mode === "coverage-version-string"
                ? "2"
                : mode === "coverage-version-missing"
                  ? undefined
                  : mode === "coverage-legacy"
                    ? 1
                    : 2,
            digestCoverage:
              mode === "coverage-label-missing"
                ? undefined
                : mode === "coverage-mismatch" || mode === "coverage-legacy"
                  ? "legacy_metadata"
                  : mode === "coverage-source-claim"
                    ? "source_approved"
                    : "evidence_content_and_current_criteria",
            validationStatus: stale ? "stale" : "validated",
            reviewStanding:
              mode === "standing-missing"
                ? undefined
                : mode === "standing-invented"
                  ? "ready"
                  : stale && mode !== "standing-stale"
                    ? "replacement_required"
                    : "reviewable",
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
    return {
      ...h,
      cancelled,
      syntheticMutation,
      ledger,
      replayedAfterDue: () => replayedAfterDue,
    };
  }

  it("executes every original and replacement HTTP assertion with synthetic boundaries only", async () => {
    const h = transcript();
    await expect(h.run()).resolves.toBeUndefined();
    expect(
      h.fetch.mock.calls.filter(
        ([url, options]) =>
          url.endsWith("submit_risk_uncertainty_analysis") &&
          JSON.parse(String(options.body)).p_risk_id ===
            (h.fixture as Record<string, unknown>).risk,
      ),
    ).toHaveLength(5);
    expect(
      h.fetch.mock.calls.filter(([url]) =>
        url.endsWith("review_risk_uncertainty_analysis"),
      ),
    ).toHaveLength(2);
    expect(
      h.fetch.mock.calls.filter(
        ([url, options]) =>
          url.endsWith("submit_risk_uncertainty_analysis") &&
          JSON.parse(String(options.body)).p_risk_id ===
            (h.fixture as Record<string, unknown>).other_risk,
      ),
    ).toHaveLength(1);
    expect(
      h.fetch.mock.calls.filter(
        ([url, options]) =>
          url.endsWith("get_risk_uncertainty_workspace") &&
          JSON.parse(String(options.body)).p_risk_id ===
            (h.fixture as Record<string, unknown>).other_risk,
      ),
    ).toHaveLength(1);
    const finiteCalls = h.fetch.mock.calls.filter(([url]) =>
      url.endsWith("record_risk_value_of_information"),
    );
    expect(finiteCalls).toHaveLength(12);
    const quotedSpecials = finiteCalls.map(([, options]) => {
      const args = JSON.parse(String(options.body));
      const identity = h.fixture as Record<string, unknown>;
      expect(args.p_risk_id).toBe(identity.risk);
      expect(options.headers).toMatchObject({
        authorization: expect.stringContaining(String(identity.author)),
      });
      return Object.entries(args.p_analysis).filter(
        ([key]) => key !== "information_action" && key !== "currency",
      );
    });
    for (const field of [
      "information_cost",
      "decision_cost_if_wrong",
      "uncertainty_reduction",
      "probability_decision_changes",
    ])
      for (const special of ["NaN", "+Infinity", "-Infinity"])
        expect(
          quotedSpecials.filter((entries) =>
            entries.some(([key, value]) => key === field && value === special),
          ),
        ).toHaveLength(1);
    for (const [url, options] of h.fetch.mock.calls) {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:54321\//);
      expect(options.redirect).toBe("error");
    }
    const replacementCalls = h.fetch.mock.calls.filter(([url]) =>
      url.endsWith("replace_risk_uncertainty_analysis"),
    );
    expect(replacementCalls).toHaveLength(2);
    expect(replacementCalls[1][1].body).toBe(replacementCalls[0][1].body);
    const firstReplacementIndex = h.fetch.mock.calls.findIndex(([url]) =>
      url.endsWith("replace_risk_uncertainty_analysis"),
    );
    const snapshotIndex = h.spawn.mock.calls.findIndex(([, args]) =>
      String(args.at(-1)).includes(
        "select public.risk_uncertainty_input_binding_snapshot(",
      ),
    );
    const digestIndex = h.spawn.mock.calls.findIndex(([, args]) =>
      String(args.at(-1)).includes(
        "select public.risk_uncertainty_analysis_digest(",
      ),
    );
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(digestIndex).toBeGreaterThan(-1);
    expect(h.spawn.mock.invocationCallOrder[snapshotIndex]).toBeLessThan(
      h.fetch.mock.invocationCallOrder[firstReplacementIndex],
    );
    expect(h.spawn.mock.invocationCallOrder[digestIndex]).toBeGreaterThan(
      h.fetch.mock.invocationCallOrder[firstReplacementIndex],
    );
    expect(
      h.fetch.mock.calls.filter(([url]) =>
        url.endsWith("get_risk_uncertainty_replacement_receipt"),
      ),
    ).toHaveLength(6);
    expect(h.cancelled).toHaveBeenCalledTimes(1);
    expect(h.syntheticMutation.mock.calls).toEqual([["replacement"]]);
    expect(h.replayedAfterDue()).toBe(true);
    expect(h.wait.mock.calls.length).toBeGreaterThan(0);
    expect(Object.keys(h.ledger)).toHaveLength(13);
    for (const rows of Object.values(h.ledger)) {
      expect(rows.some((r) => r.organization_id === h.fixture.org)).toBe(true);
      expect(
        rows.some((r) => r.organization_id === h.fixture.foreign_org),
      ).toBe(true);
    }
  });

  it.each([
    "replacement-pair-history",
    "replacement-foreign-state",
    "replacement-extra-approval",
    "replacement-binding",
    "replacement-audit",
    "replacement-voi-authority",
    "replacement-receipt-actor",
    "replacement-receipt-fingerprint",
    "replacement-receipt-coverage",
    "replacement-receipt-cas",
    "replacement-refusal-content",
    "replacement-refusal-write",
    "replacement-replay-receipt",
    "replacement-replay-write",
    "replacement-cancel-lost",
    "replacement-response-status",
    "replacement-successor-input",
    "replacement-successor-snapshot",
    "replacement-live-digest",
    "replacement-new-binding",
    "replacement-audit-payload",
    "replacement-voi-math",
    "replacement-receipt-extra-key",
    "replacement-due-date",
  ])(
    "rejects synthetic %s through the unmodified replacement HTTP assertions",
    async (mode) => {
      const h = transcript(mode);
      await expect(h.run()).rejects.toThrow(
        "U18.02 isolated CI qualification failed",
      );
      expect(
        h.fetch.mock.calls.filter(([url]) =>
          url.endsWith("replace_risk_uncertainty_analysis"),
        ).length,
      ).toBeGreaterThanOrEqual(1);
      const receiptCalls = h.fetch.mock.calls.filter(([url]) =>
        url.endsWith("get_risk_uncertainty_replacement_receipt"),
      );
      const replayCase = mode.startsWith("replacement-replay-");
      expect(
        h.fetch.mock.calls.filter(([url]) =>
          url.endsWith("replace_risk_uncertainty_analysis"),
        ),
      ).toHaveLength(replayCase ? 2 : 1);
      expect(h.syntheticMutation.mock.calls[0]).toEqual(["replacement"]);
      if (replayCase) {
        expect(receiptCalls).toHaveLength(6);
        expect(h.replayedAfterDue()).toBe(true);
      } else if (mode.startsWith("replacement-receipt-")) {
        expect(receiptCalls).toHaveLength(1);
      } else if (mode.startsWith("replacement-refusal-")) {
        expect(receiptCalls).toHaveLength(2);
      } else {
        expect(receiptCalls).toHaveLength(0);
      }
    },
  );

  it.each([
    "coverage-version-string",
    "coverage-version-missing",
    "coverage-label-missing",
    "coverage-mismatch",
    "coverage-legacy",
    "coverage-source-claim",
    "policy-digest-missing",
    "policy-digest-malformed",
    "standing-missing",
    "standing-invented",
    "standing-stale",
  ])(
    "rejects %s in the actual HTTP script against synthetic transport without replay or fabricated approval",
    async (mode) => {
      const h = transcript(mode);
      await expect(h.run()).rejects.toThrow(
        "U18.02 isolated CI qualification failed",
      );
      expect(
        h.fetch.mock.calls.filter(
          ([url, options]) =>
            url.endsWith("submit_risk_uncertainty_analysis") &&
            JSON.parse(String(options.body)).p_risk_id ===
              (h.fixture as Record<string, unknown>).risk,
        ),
      ).toHaveLength(4);
      expect(
        h.fetch.mock.calls.filter(([url]) =>
          url.endsWith("review_risk_uncertainty_analysis"),
        ),
      ).toHaveLength(2);
    },
  );

  it.each([
    "representation-lost",
    "representation-identity",
    "representation-confidence",
    "representation-date",
    "representation-persistence",
    "representation-authority",
    "representation-standing",
  ])(
    "rejects %s without replaying the secondary pending write or approving it",
    async (mode) => {
      const h = transcript(mode);
      await expect(h.run()).rejects.toThrow(
        "U18.02 isolated CI qualification failed",
      );
      expect(
        h.fetch.mock.calls.filter(
          ([url, options]) =>
            url.endsWith("submit_risk_uncertainty_analysis") &&
            JSON.parse(String(options.body)).p_risk_id ===
              (h.fixture as Record<string, unknown>).other_risk,
        ),
      ).toHaveLength(1);
      expect(
        h.fetch.mock.calls.filter(([url]) =>
          url.endsWith("review_risk_uncertainty_analysis"),
        ),
      ).toHaveLength(2);
    },
  );

  it.each([
    "canonical-finite-lost",
    "canonical-finite-success",
    "canonical-finite-malformed",
    "canonical-finite-forbidden",
  ])("stops on %s without retry or later uncertainty writes", async (mode) => {
    const h = transcript(mode);
    await expect(h.run()).rejects.toThrow(
      "U18.02 isolated CI qualification failed",
    );
    expect(
      h.fetch.mock.calls.filter(([url]) =>
        url.endsWith("record_risk_value_of_information"),
      ),
    ).toHaveLength(1);
    expect(
      h.fetch.mock.calls.filter(
        ([url]) =>
          url.endsWith("submit_risk_uncertainty_analysis") ||
          url.endsWith("review_risk_uncertainty_analysis"),
      ),
    ).toHaveLength(0);
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
