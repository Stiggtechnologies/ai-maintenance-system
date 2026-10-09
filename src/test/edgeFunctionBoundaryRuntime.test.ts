// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const reviewedInstaller = "45a513f8c64c0bc8e0e3dfe572b5c95be85f6359";
const read = (relative: string) => readFileSync(relative, "utf8");
const checker = read("scripts/check-edge-function-boundary.mjs");
const boundaryJson = read("config/edge-function-boundary.json");
const boundary = JSON.parse(boundaryJson) as {
  supabaseCliVersion: string;
  activeFunctions: string[];
  blockedLegacyFunctions: string[];
  allowedNoVerifyJwt: string[];
};
const deploy = read(".github/workflows/deploy-migrations.yml");
// Exercise the intended v3 interface before the workflow repair is applied.
const validDeploy = deploy.replace(/^\s*github-token:.*\n/gm, "");

function runChecker(workflow: string) {
  const fixture = mkdtempSync(path.join(tmpdir(), "syncai-edge-boundary-"));
  try {
    for (const directory of ["scripts", "config", ".github/workflows"])
      mkdirSync(path.join(fixture, directory), { recursive: true });
    // Run the actual, unmodified checker from its own repository-shaped root.
    writeFileSync(
      path.join(fixture, "scripts/check-edge-function-boundary.mjs"),
      checker,
    );
    writeFileSync(
      path.join(fixture, "config/edge-function-boundary.json"),
      boundaryJson,
    );
    writeFileSync(
      path.join(fixture, ".github/workflows/deploy-migrations.yml"),
      workflow,
    );
    const result = spawnSync(
      process.execPath,
      [path.join(fixture, "scripts/check-edge-function-boundary.mjs")],
      {
        cwd: fixture,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    // Only the exact fixture directory created by this invocation is removed.
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe("Edge deployment checker runtime compatibility", () => {
  it("accepts the reviewed v3 SHA and version-only interface with the unchanged boundary", () => {
    const result = runChecker(validDeploy);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Edge-function boundary verified");
    expect(boundary.supabaseCliVersion).toBe("2.84.2");
    expect(boundary.activeFunctions).toHaveLength(33);
    expect(boundary.blockedLegacyFunctions).toHaveLength(14);
    expect(boundary.allowedNoVerifyJwt).toHaveLength(5);
  });

  it.each([
    ["moving tag", "v3.0.1"],
    ["short SHA", reviewedInstaller.slice(0, 12)],
    ["unreviewed full SHA", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ])("rejects a %s even with the reviewed version comment", (_label, pin) => {
    const result = runChecker(validDeploy.replace(reviewedInstaller, pin));
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(
      "reviewed immutable supabase/setup-cli v3.0.1",
    );
  });

  it("rejects a misleading installer version comment", () => {
    const result = runChecker(validDeploy.replace("# v3.0.1", "# v3.0.2"));
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(
      "reviewed immutable supabase/setup-cli v3.0.1",
    );
  });

  it("rejects a second installer invocation", () => {
    const result = runChecker(
      validDeploy +
        `\n      - uses: supabase/setup-cli@${reviewedInstaller} # v3.0.1\n        with:\n          version: 2.84.2\n`,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("exactly one");
  });

  it("rejects a second named installer rather than ignoring its alternate step spelling", () => {
    const result = runChecker(
      validDeploy +
        `\n      - name: Unreviewed second installer\n        uses: supabase/setup-cli@v3\n        with:\n          version: latest\n`,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("exactly one");
  });

  it("rejects CLI drift even if the expected version appears elsewhere", () => {
    const result = runChecker(
      validDeploy.replace("version: 2.84.2", "version: 2.108.0") +
        "\n# version: 2.84.2\n",
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("pin Supabase CLI 2.84.2");
  });

  it.each([
    ["obsolete github-token", "github-token: ${{ github.token }}"],
    ["unrecognized input", "unreviewed-input: true"],
  ])("rejects the %s input", (_label, input) => {
    const result = runChecker(
      validDeploy.replace(
        "version: 2.84.2",
        `version: 2.84.2\n          ${input}`,
      ),
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("only the supported version input");
  });

  it.each([
    [
      "deploy --all",
      (workflow: string) =>
        workflow + "\n          supabase functions deploy --all\n",
      "deploy --all is prohibited",
    ],
    [
      "unapproved function",
      (workflow: string) =>
        workflow + "\n          supabase functions deploy unapproved-runtime\n",
      "do not match active boundary",
    ],
    [
      "blocked function",
      (workflow: string) =>
        workflow +
        `\n          supabase functions deploy ${boundary.blockedLegacyFunctions[0]}\n`,
      "blocked legacy function",
    ],
    [
      "extra JWT exception",
      (workflow: string) =>
        workflow.replace(
          "supabase functions deploy sync-runtime",
          "supabase functions deploy sync-runtime --no-verify-jwt",
        ),
      "do not match the reviewed exception set",
    ],
    [
      "missing JWT exception",
      (workflow: string) => workflow.replace("--no-verify-jwt", ""),
      "do not match the reviewed exception set",
    ],
    [
      "missing active trigger",
      (workflow: string) =>
        workflow.replace(
          `supabase/functions/${boundary.activeFunctions[0]}/**`,
          "supabase/functions/absent/**",
        ),
      "deployment trigger is missing",
    ],
    [
      "blocked trigger",
      (workflow: string) =>
        workflow +
        `\n# supabase/functions/${boundary.blockedLegacyFunctions[0]}/**\n`,
      "is in deployment triggers",
    ],
  ])("still rejects %s", (_label, mutate, message) => {
    const result = runChecker(mutate(validDeploy));
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(message);
  });
});

describe("Reviewed setup-cli interface in every existing workflow", () => {
  it("uses the reviewed SHA and only CLI 2.84.2 in all ten invocations across nine workflows", () => {
    const names = [
      "approval-authority",
      "approval-enforcement",
      "ci",
      "database-restore-drill",
      "deploy-migrations",
      "domain-specialists-closeout",
      "migration-drift",
      "recovery-closeout",
      "ria-lifecycle",
    ];
    let invocations = 0;
    for (const name of names) {
      const workflow = parse(read(`.github/workflows/${name}.yml`)) as {
        jobs: Record<
          string,
          {
            "runs-on": string;
            steps: { uses?: string; with?: Record<string, unknown> }[];
          }
        >;
      };
      let workflowInvocations = 0;
      for (const job of Object.values(workflow.jobs)) {
        for (const [index, step] of (job.steps ?? []).entries()) {
          if (!step.uses?.startsWith("supabase/setup-cli@")) continue;
          expect(job["runs-on"]).toBe("ubuntu-latest");
          expect(step.uses).toBe(`supabase/setup-cli@${reviewedInstaller}`);
          expect(step.with).toEqual({ version: "2.84.2" });
          // v3 needs Node/npm >=20. Existing explicit setup steps pin 22;
          // otherwise these jobs retain the hosted Ubuntu runner environment.
          for (const earlier of job.steps.slice(0, index)) {
            if (earlier.uses?.startsWith("actions/setup-node@"))
              expect(
                Number(earlier.with?.["node-version"]),
              ).toBeGreaterThanOrEqual(20);
          }
          workflowInvocations++;
          invocations++;
        }
      }
      expect(workflowInvocations).toBe(name === "ci" ? 2 : 1);
    }
    expect(invocations).toBe(10);
  });

  it("keeps the main-only deployment gate and normal required unit-test discovery", () => {
    const workflow = parse(deploy) as {
      on: { push: { branches: string[] } };
      jobs: { "push-migrations": { if: string } };
    };
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.jobs["push-migrations"].if).toBe(
      "github.ref == 'refs/heads/main'",
    );
    expect(read("vitest.config.ts")).toContain("src/**/*.{test,spec}.{ts,tsx}");
    const packageJson = JSON.parse(read("package.json")) as {
      scripts: { test: string };
    };
    expect(packageJson.scripts.test).toContain("vitest run");
    expect(read(".github/workflows/ci.yml")).toContain("run: npm run test");
  });
});
