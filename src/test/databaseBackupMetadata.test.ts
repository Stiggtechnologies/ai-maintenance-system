// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const auditor = await import(
  new URL("../../scripts/database-backup-metadata.mjs", import.meta.url).href
);
const ref = "a".repeat(20);
const foreignRef = "b".repeat(20);
const workflow = `name: Deploy migrations\nenv:\n  SUPABASE_PROJECT_ID: ${ref}\n  APP_URL: https://app.syncai.ca\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n`;
const observedAt = "2026-10-06T12:00:00.000Z";
const provider = () => ({
  region: "ca-central-1",
  walg_enabled: true,
  pitr_enabled: false,
  physical_backup_data: { signedUrl: "DO_NOT_RETAIN_SIGNED_URL" },
  backups: [
    {
      inserted_at: "2026-10-05T05:00:00.000Z",
      status: "COMPLETED",
      is_physical_backup: true,
    },
    {
      inserted_at: "2026-10-06T05:00:00.000Z",
      status: "COMPLETED",
      is_physical_backup: true,
    },
  ],
});
const context = { projectRef: ref, region: "ca-central-1", observedAt };
const parent = () =>
  mkdtempSync(join(tmpdir(), "syncai-backup-metadata-test-"));

function fixtures() {
  const projects = [
    {
      id: foreignRef,
      name: "DO_NOT_RETAIN_OTHER_PROJECT",
      region: "us-east-1",
      status: "ACTIVE_HEALTHY",
    },
    {
      id: ref,
      name: "DO_NOT_RETAIN_PROJECT_NAME",
      region: "ca-central-1",
      status: "ACTIVE_HEALTHY",
    },
  ];
  const runSupabase = vi.fn(async (args: string[]) =>
    JSON.stringify(args[0] === "projects" ? projects : provider()),
  );
  const fetchImpl = vi.fn(
    async (url: string) =>
      new Response(
        url.endsWith(".js")
          ? `const clientUrl="https://${ref}.supabase.co";const irrelevantSecret="DO_NOT_RETAIN_ASSET_SOURCE";`
          : '<html><script type="module" crossorigin src="/assets/index-test.js"></script></html>',
        {
          headers: {
            "content-type": url.endsWith(".js")
              ? "application/javascript"
              : "text/html",
          },
        },
      ),
  );
  const log = vi.fn();
  return {
    projects,
    runSupabase,
    fetchImpl,
    log,
    options: {
      env: { SYNC_DR_PRODUCTION_METADATA: "read_only", CI: "" },
      workflowSource: workflow,
      runSupabase,
      fetchImpl,
      log,
      now: () => new Date(observedAt),
      outputParent: parent(),
    },
  };
}

describe("private production backup metadata observation", () => {
  it.each([
    workflow.replace(
      "    runs-on: ubuntu-latest",
      `    runs-on: ubuntu-latest\n    env: {SUPABASE_PROJECT_ID: ${foreignRef}}`,
    ),
    workflow.replace(
      "    runs-on: ubuntu-latest",
      '    runs-on: ubuntu-latest\n    env: {"APP_URL": "https://foreign.example"}',
    ),
    workflow.replace(
      "    runs-on: ubuntu-latest",
      '    runs-on: ubuntu-latest\n    env: {"\\u0041PP_URL": "https://foreign.example"}',
    ),
    workflow.replace(
      "    runs-on: ubuntu-latest",
      `    runs-on: ubuntu-latest\n    env:\n      SUPABASE_PROJECT_REF: ${foreignRef}`,
    ),
    workflow + `\n"env": {SUPABASE_PROJECT_ID: ${foreignRef}}\n`,
    workflow + "\n---\nenv: {}\n",
    workflow.replace(
      `SUPABASE_PROJECT_ID: ${ref}`,
      `SUPABASE_PROJECT_ID: &target ${ref}`,
    ),
  ])(
    "refuses YAML-aware duplicate, indirect and job target authority",
    (source) => {
      expect(() => auditor.parseProductionIdentity(source)).toThrow();
    },
  );
  it("qualifies the actual deployment workflow without printing its identity", () => {
    const source = readFileSync(
      new URL("../../.github/workflows/deploy-migrations.yml", import.meta.url),
      "utf8",
    );
    const identity = auditor.parseProductionIdentity(source);
    expect(identity.projectRef).toMatch(/^[a-z]{20}$/);
    expect(identity.appUrl).toBe("https://app.syncai.ca");
  });
  it.each([
    "GITHUB_ACTIONS",
    "VERCEL",
    "TF_BUILD",
    "TEAMCITY_VERSION",
    "JENKINS_URL",
    "GITLAB_CI",
    "SUPABASE_API_HOST",
  ])(
    "refuses CI or alternate provider authority before any access: %s",
    async (key) => {
      const f = fixtures();
      await expect(
        auditor.runProductionBackupMetadata({
          ...f.options,
          env: { SYNC_DR_PRODUCTION_METADATA: "read_only", [key]: "true" },
        }),
      ).rejects.toThrow();
      expect(f.runSupabase).not.toHaveBeenCalled();
      expect(f.fetchImpl).not.toHaveBeenCalled();
    },
  );
  it.each(["duplicate", "escaped-duplicate", "invalid-object"])(
    "refuses unqualified provider JSON: %s",
    async (mode) => {
      const f = fixtures();
      let raw = JSON.stringify(provider());
      if (mode === "duplicate")
        raw = raw.replace(
          '"pitr_enabled":false',
          '"pitr_enabled":false,"pitr_enabled":true',
        );
      if (mode === "escaped-duplicate")
        raw = raw.replace(
          '"pitr_enabled":false',
          '"pitr_enabled":false,"pitr_\\u0065nabled":true',
        );
      if (mode === "invalid-object") raw = '["DO_NOT_RETAIN_DIAGNOSTIC"]';
      f.runSupabase.mockImplementation(async (args) =>
        args[0] === "projects" ? JSON.stringify(f.projects) : raw,
      );
      await expect(
        auditor.runProductionBackupMetadata(f.options),
      ).rejects.toThrow();
      expect(f.log).not.toHaveBeenCalled();
    },
  );
  it.each([
    "http-error",
    "wrong-type",
    "redirect",
    "declared-oversize",
    "actual-oversize",
  ])(
    "refuses unsafe public frontend responses before backup access: %s",
    async (mode) => {
      const f = fixtures();
      f.fetchImpl.mockImplementation(async () => {
        const response = new Response(
          mode === "actual-oversize"
            ? "x".repeat(1024 * 1024 + 1)
            : '<script type="module" src="/assets/index-test.js"></script>',
          {
            status: mode === "http-error" ? 503 : 200,
            headers: {
              "content-type":
                mode === "wrong-type" ? "application/json" : "text/html",
              ...(mode === "declared-oversize"
                ? { "content-length": "1048577" }
                : {}),
            },
          },
        );
        if (mode === "redirect")
          Object.defineProperty(response, "url", {
            value: "https://foreign.example",
          });
        return response;
      });
      await expect(
        auditor.runProductionBackupMetadata(f.options),
      ).rejects.toThrow();
      expect(f.runSupabase).toHaveBeenCalledTimes(1);
      expect(f.log).not.toHaveBeenCalled();
    },
  );
  it("projects provider-reported restore points as observation, never tested recovery or RPO", () => {
    const raw = {
      ...provider(),
      physical_backup_data: {
        earliest_physical_backup_date_unix: 1791172800,
        latest_physical_backup_date_unix: 1791288000,
        signedUrl: "DO_NOT_RETAIN_URL",
      },
    };
    const result = auditor.projectBackupMetadata(raw, context);
    expect(result.physicalRecoveryWindow).toEqual({
      observationStatus: "PROVIDER_REPORTED",
      earliestReportedRestorePoint: "2026-10-05T04:00:00.000Z",
      latestReportedRestorePoint: "2026-10-06T12:00:00.000Z",
      futureTimestampObserved: false,
      restoreExecutionProven: false,
    });
    expect(result.recoveryQualification).toBe("UNPROVEN");
    expect(result.rpoProven).toBe(false);
    expect(result.retentionPolicyProven).toBe(false);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_RETAIN");
  });
  it.each([
    { earliest_physical_backup_date_unix: 1791172800 },
    {
      earliest_physical_backup_date_unix: "1791172800",
      latest_physical_backup_date_unix: 1791288000,
    },
    {
      earliest_physical_backup_date_unix: 1791288001,
      latest_physical_backup_date_unix: 1791288000,
    },
    {
      earliest_physical_backup_date_unix: 1791172800,
      latest_physical_backup_date_unix: Number.MAX_SAFE_INTEGER,
    },
  ])(
    "refuses malformed provider restore-window evidence",
    (physical_backup_data) => {
      expect(() =>
        auditor.projectBackupMetadata(
          { ...provider(), physical_backup_data },
          context,
        ),
      ).toThrow();
    },
  );
  it("derives identity only from the canonical top-level deployment environment", () => {
    expect(auditor.parseProductionIdentity(workflow)).toEqual({
      projectRef: ref,
      appUrl: "https://app.syncai.ca",
    });
  });
  it.each([
    workflow.replace(
      `SUPABASE_PROJECT_ID: ${ref}`,
      "SUPABASE_PROJECT_ID: invalid",
    ),
    workflow.replace("https://app.syncai.ca", "https://foreign.example"),
    workflow.replace(
      "https://app.syncai.ca",
      "https://user:secret@app.syncai.ca",
    ),
    workflow.replace(
      "https://app.syncai.ca",
      "https://app.syncai.ca?token=secret",
    ),
    workflow.replace(
      `  SUPABASE_PROJECT_ID: ${ref}`,
      `  SUPABASE_PROJECT_ID: ${ref}\n  SUPABASE_PROJECT_ID: ${foreignRef}`,
    ),
    workflow + `\nenv:\n  SUPABASE_PROJECT_ID: ${foreignRef}\n`,
    workflow.replace("env:\n", "env: &inherited\n"),
    workflow.replace("env:\n", "env:\n  <<: *other\n"),
    workflow.replace(/^env:/m, "  env:"),
  ])(
    "refuses malformed, ambiguous or indirect canonical identity",
    (source) => {
      expect(() => auditor.parseProductionIdentity(source)).toThrow();
    },
  );
  it.each([
    { SUPABASE_PROJECT_ID: foreignRef },
    { SUPABASE_PROJECT_REF: foreignRef },
    { APP_URL: "https://foreign.example" },
  ])("refuses conflicting ambient deployment identity", (env) => {
    expect(() => auditor.parseProductionIdentity(workflow, env)).toThrow();
  });
  it("projects only metadata, with every recovery/retention claim remaining unproven", () => {
    const raw = {
      ...provider(),
      access_token: "DO_NOT_RETAIN_PROVIDER_SECRET",
    };
    raw.backups[0] = {
      ...raw.backups[0],
      url: "DO_NOT_RETAIN_BACKUP_URL",
    } as (typeof raw.backups)[number];
    const report = auditor.projectBackupMetadata(raw, context);
    expect(report.scope).toBe("production_backup_metadata_observation");
    expect(report.observationStatus).toBe("CAPTURED");
    expect(report.recoveryQualification).toBe("UNPROVEN");
    expect(report.backups).toEqual({
      observedCount: 2,
      completedCount: 2,
      nonCompletedCount: 0,
      physicalCount: 2,
      futureTimestampCount: 0,
      oldestCompletedInsertedAt: "2026-10-05T05:00:00.000Z",
      newestCompletedInsertedAt: "2026-10-06T05:00:00.000Z",
      newestCompletedInsertionAgeHours: 7,
    });
    for (const flag of [
      "productionRestored",
      "backupBytesRestored",
      "storageBytesRestored",
      "retentionPolicyProven",
      "providerRestoreAccessProven",
      "custodianRecoveryProven",
      "rpoProven",
      "rtoProven",
      "capabilityComplete",
    ])
      expect(report[flag]).toBe(false);
    expect(JSON.stringify(report)).not.toContain("DO_NOT_RETAIN");
    expect(report.warnings).toContain(
      "backup_insertion_time_is_not_recoverable_data_cut",
    );
  });
  it.each([
    (r: ReturnType<typeof provider>) => {
      r.pitr_enabled = "false" as unknown as boolean;
    },
    (r: ReturnType<typeof provider>) => {
      r.walg_enabled = null as unknown as boolean;
    },
    (r: ReturnType<typeof provider>) => {
      r.region = "us-east-1";
    },
    (r: ReturnType<typeof provider>) => {
      r.backups[0].inserted_at = "2026-02-30T05:00:00Z";
    },
    (r: ReturnType<typeof provider>) => {
      r.backups[0].inserted_at = "2026-10-06";
    },
    (r: ReturnType<typeof provider>) => {
      r.backups[0].is_physical_backup = "true" as unknown as boolean;
    },
    (r: ReturnType<typeof provider>) => {
      r.backups[0].status = "";
    },
    (r: ReturnType<typeof provider>) => {
      r.backups.push({ ...r.backups[0] });
    },
  ])(
    "fails closed on malformed or inconsistent provider metadata",
    (mutate) => {
      const raw = provider();
      mutate(raw);
      expect(() => auditor.projectBackupMetadata(raw, context)).toThrow();
    },
  );
  it("reports empty, uncompleted and future-dated inventories without claiming recovery", () => {
    const empty = auditor.projectBackupMetadata(
      { ...provider(), backups: [] },
      context,
    );
    expect(empty.backups.completedCount).toBe(0);
    expect(empty.backups.newestCompletedInsertionAgeHours).toBeNull();
    expect(empty.warnings).toContain("no_completed_backups_observed");
    const raw = provider();
    raw.backups[0].status = "UNKNOWN_PROVIDER_STATUS_DO_NOT_RETAIN";
    raw.backups[1].inserted_at = "2026-10-07T05:00:00Z";
    const report = auditor.projectBackupMetadata(raw, context);
    expect(report.backups.nonCompletedCount).toBe(1);
    expect(report.backups.futureTimestampCount).toBe(1);
    expect(report.backups.newestCompletedInsertionAgeHours).toBeNull();
    expect(report.warnings).toContain("provider_clock_anomaly_observed");
    expect(JSON.stringify(report)).not.toContain("UNKNOWN_PROVIDER_STATUS");
    expect(report.rpoProven).toBe(false);
  });
  it("executes only fixed read-only commands, matches the public frontend, and saves privately", async () => {
    const f = fixtures();
    const { output, report } = await auditor.runProductionBackupMetadata(
      f.options,
    );
    expect(f.runSupabase.mock.calls.map((call) => call[0])).toEqual([
      ["projects", "list", "--output", "json"],
      ["backups", "list", "--project-ref", ref, "--output", "json"],
    ]);
    expect(f.fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://app.syncai.ca/",
      "https://app.syncai.ca/assets/index-test.js",
    ]);
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(statSync(join(output, "report.json")).mode & 0o777).toBe(0o600);
    expect(
      JSON.parse(readFileSync(join(output, "report.json"), "utf8")),
    ).toEqual(report);
    expect(report.provenance.publicBundleContainsProjectRef).toBe(true);
    expect(report.provenance.frontendRuntimeBindingProven).toBe(false);
    expect(report.provenance.canonicalWorkflowSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.provenance.publicBundleSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.provenance.observerSha256).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("DO_NOT_RETAIN");
    const stdout = JSON.stringify(f.log.mock.calls);
    expect(stdout).not.toContain(ref);
    expect(stdout).not.toContain("ca-central-1");
    expect(stdout).not.toContain("pitr");
    expect(stdout).not.toContain("DO_NOT_RETAIN");
  });
  it("refuses report persistence inside the public repository", async () => {
    const f = fixtures();
    await expect(
      auditor.runProductionBackupMetadata({
        ...f.options,
        outputParent: new URL("../..", import.meta.url).pathname,
      }),
    ).rejects.toThrow();
    expect(f.log).not.toHaveBeenCalled();
  });
  it.each([
    { SYNC_DR_PRODUCTION_METADATA: "" },
    { SYNC_DR_PRODUCTION_METADATA: "read_only", CI: "true" },
  ])(
    "requires explicit operator intent and refuses public CI execution",
    async (env) => {
      const f = fixtures();
      await expect(
        auditor.runProductionBackupMetadata({ ...f.options, env }),
      ).rejects.toThrow();
      expect(f.runSupabase).not.toHaveBeenCalled();
      expect(f.fetchImpl).not.toHaveBeenCalled();
    },
  );
  it.each(["missing", "duplicate", "region-mismatch"])(
    "refuses an unqualified target before backup access",
    async (mode) => {
      const f = fixtures();
      if (mode === "missing") f.projects.pop();
      if (mode === "duplicate") f.projects.push({ ...f.projects[1] });
      if (mode === "region-mismatch")
        f.runSupabase.mockImplementation(async (args) =>
          JSON.stringify(
            args[0] === "projects"
              ? f.projects
              : { ...provider(), region: "us-east-1" },
          ),
        );
      await expect(
        auditor.runProductionBackupMetadata(f.options),
      ).rejects.toThrow();
      if (mode !== "region-mismatch")
        expect(f.runSupabase).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    `const u="https://${foreignRef}.supabase.co"`,
    `const a="https://${ref}.supabase.co", b="https://${foreignRef}.supabase.co"`,
    "no backend identity",
  ])(
    "refuses a missing, foreign or ambiguous public bundle binding before backup access",
    async (bundle) => {
      const f = fixtures();
      f.fetchImpl.mockImplementation(
        async (url) =>
          new Response(
            url.endsWith(".js")
              ? bundle
              : '<script type="module" src="/assets/index-test.js"></script>',
            {
              headers: {
                "content-type": url.endsWith(".js")
                  ? "application/javascript"
                  : "text/html",
              },
            },
          ),
      );
      await expect(
        auditor.runProductionBackupMetadata(f.options),
      ).rejects.toThrow();
      expect(f.runSupabase).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    '<script type="module" src="https://foreign.example/asset.js"></script>',
    '<script type="module" src="/assets/../../secret.js"></script>',
    '<script type="module" src="/assets/one.js"></script><script type="module" src="/assets/two.js"></script>',
    '<script type="module" src="/assets/one.js" src="/assets/two.js"></script>',
  ])(
    "refuses unqualified module entrypoints without fetching arbitrary URLs",
    async (html) => {
      const f = fixtures();
      f.fetchImpl.mockImplementation(
        async () =>
          new Response(html, { headers: { "content-type": "text/html" } }),
      );
      await expect(
        auditor.runProductionBackupMetadata(f.options),
      ).rejects.toThrow();
      expect(f.fetchImpl).toHaveBeenCalledTimes(1);
      expect(f.runSupabase).toHaveBeenCalledTimes(1);
    },
  );
  it("suppresses raw provider and frontend failures", async () => {
    for (const source of ["cli", "frontend", "json"]) {
      const f = fixtures();
      if (source === "cli")
        f.runSupabase.mockRejectedValue(
          new Error("DO_NOT_RETAIN_API_TOKEN_OR_PROVIDER_DIAGNOSTIC"),
        );
      if (source === "frontend")
        f.fetchImpl.mockRejectedValue(
          new Error("DO_NOT_RETAIN_SIGNED_URL_OR_DIAGNOSTIC"),
        );
      if (source === "json")
        f.runSupabase.mockResolvedValue("DO_NOT_RETAIN_INVALID_JSON_SECRET");
      let failure: unknown;
      try {
        await auditor.runProductionBackupMetadata(f.options);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain("DO_NOT_RETAIN");
      expect(JSON.stringify(f.log.mock.calls)).not.toContain("DO_NOT_RETAIN");
    }
  });
});
