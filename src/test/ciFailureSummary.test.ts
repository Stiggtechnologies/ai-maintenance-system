// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
it("retains bounded failure evidence while redacting authentication and links", () => {
  const dir = mkdtempSync(join(tmpdir(), "journey-diagnostic-"));
  try {
    const file = join(dir, "failure.log");
    writeFileSync(
      file,
      "noise\nERROR: synthetic constraint refused\nDecision Case smoke FAILED at line 88\nError: authorization Bearer private-value\nError: https://example.invalid/?secret=value user@example.invalid\n",
    );
    const result = execFileSync(
      process.execPath,
      ["scripts/ci-failure-summary.mjs", file],
      { encoding: "utf8" },
    );
    expect(result).toContain("synthetic constraint refused");
    expect(result).toContain("FAILED at line 88");
    expect(result).not.toMatch(/private-value|secret=value|user@example/);
    expect(result.trim().length).toBeLessThanOrEqual(400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
