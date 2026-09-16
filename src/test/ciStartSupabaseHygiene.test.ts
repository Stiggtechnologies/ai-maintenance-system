/**
 * Golden-path E2E start hygiene is a contract, not a one-off re-run.
 *
 * Main push CI on 61f7cf1 (run 35039799431) applied the full migration
 * chain, then failed while starting remaining containers: inbucket could
 * not bind host port 54324 (address already in use). The sibling
 * "Migration chain + seeded auth smoke" job on that SHA passed. After the
 * bind failure the CLI pruned supabase_db_*, which later surfaces as
 * "No such container: supabase_db_ai-maintenance-system".
 *
 * The start script must retry once after leftover cleanup on that class of
 * failure, and must not retry migration/schema errors.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const start = readFileSync("scripts/ci-start-supabase.sh", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("CI local Supabase start hygiene", () => {
  it("retries once after leftover container/port cleanup on bind collisions", () => {
    expect(start).toMatch(/CI_SUPABASE_START_ATTEMPTS:-\s*2/);
    expect(start).toContain("address already in use");
    expect(start).toContain("failed to start docker container");
    expect(start).toContain("failed to bind host port");
    expect(start).toContain("supabase stop --all --no-backup");
    expect(start).toContain("docker rm -f");
    expect(start).toContain("54324");
    expect(start).toContain("retrying once after cleanup");
  });

  it("does not retry schema or migration failures", () => {
    expect(start).toContain("is_transient_start_failure");
    expect(start).toMatch(
      /is_transient_start_failure "\$log_file"|is_transient_start_failure "\$log"/,
    );
    expect(start).not.toMatch(/while true/);
    expect(start).not.toMatch(/max_attempts:-0*[3-9]/);
  });

  it("keeps Golden-path E2E and migration smoke on the shared start script", () => {
    expect(ci).toContain(
      "bash scripts/ci-start-supabase.sh /tmp/e2e-supabase-start.log /tmp/e2e-supabase-diagnostics.txt",
    );
    expect(ci).toContain(
      "bash scripts/ci-start-supabase.sh /tmp/migrations-supabase-start.log /tmp/migrations-supabase-diagnostics.txt",
    );
  });
});
