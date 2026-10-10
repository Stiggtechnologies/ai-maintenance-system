import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const e2e = workflow.split("\n  e2e:")[1] ?? "";

describe("U18 browser acceptance CI wiring", () => {
  it("provisions the new insert-only fixture using a marked owner connection pinned to disposable loopback", () => {
    const setup =
      e2e
        .split("- name: U18 browser fixtures")[1]
        ?.split("\n      - name:")[0] ?? "";
    expect(setup).toContain('test "${GITHUB_ACTIONS:-}" = true');
    expect(setup).toContain(
      "PGOPTIONS='-c app.ci_u18_browser_fixture=github_actions_only'",
    );
    expect(setup).toContain(
      "psql -X -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1",
    );
    expect(setup).toContain(
      "-f scripts/tests/risk-uncertainty-browser-fixture.sql",
    );
    for (const key of [
      "PGHOSTADDR",
      "PGSERVICE",
      "PGSERVICEFILE",
      "PGPASSFILE",
    ])
      expect(setup).toContain(`-u ${key}`);
  });

  it("runs the actual U18 spec after provisioning, retaining every existing browser suite and always-cleanup", () => {
    const run = e2e.match(/run: npx playwright test ([^\n]+)/)?.[1] ?? "";
    for (const file of [
      "golden-path.spec.ts",
      "material-commercial-thread.spec.ts",
      "project-fracas.spec.ts",
      "time-synchronization-assurance.spec.ts",
      "risk-uncertainty.spec.ts",
    ])
      expect(run).toContain(`tests/e2e/${file}`);
    expect(
      e2e.indexOf("-f scripts/tests/risk-uncertainty-browser-fixture.sql"),
    ).toBeGreaterThan(-1);
    expect(
      e2e.indexOf("-f scripts/tests/risk-uncertainty-browser-fixture.sql"),
    ).toBeLessThan(e2e.indexOf("run: npx playwright test"));
    expect(e2e).toMatch(
      /- name: Stop Supabase\n\s+if: always\(\)\n\s+run: supabase stop --no-backup/,
    );
  });
});
