import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DANGEROUS_LEADING = /\bleading-(8|12|16)\b/;

function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walkTsx(path, acc);
      continue;
    }
    if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      acc.push(path);
    }
  }
  return acc;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("{/*")
  );
}

describe("customer chrome honesty", () => {
  it("does not stamp readable body text with remapped leading-8/12/16", () => {
    const hits: string[] = [];
    for (const path of walkTsx("src")) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (isCommentLine(line) || !line.includes("className")) return;
        if (DANGEROUS_LEADING.test(line)) {
          hits.push(`${path}:${index + 1}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("auth chrome does not use gold primaries or a 48-hour offer", () => {
    const auth = [
      "src/pages/Login.tsx",
      "src/pages/Signup.tsx",
      "src/pages/EnterpriseAccess.tsx",
      "src/components/AuthShell.tsx",
    ];
    for (const path of auth) {
      const src = readFileSync(path, "utf8");
      expect(src, `${path} uses gold`).not.toMatch(/signal-gold/);
      expect(src, `${path} restores a 48-hour offer`).not.toMatch(/48-hour/);
    }
  });

  it("public /workspace keeps the three Bolt honesty holds", () => {
    const page = readFileSync(
      "src/pages/DecisionCaseWorkspacePage.tsx",
      "utf8",
    );
    const empty = readFileSync(
      "src/components/public-ask/PublicAskEmpty.tsx",
      "utf8",
    );
    const rail = readFileSync(
      "src/components/public-ask/PublicAskRail.tsx",
      "utf8",
    );
    expect(page).toContain("LearnUnpersistedPointer");
    expect(page).not.toMatch(/InThreadLearnRecorder/);
    expect(page).not.toMatch(/from ["'].*PublicProductHeader["']/);
    expect(page).not.toMatch(/brand-job-title/);
    expect(empty).not.toMatch(/Reliability Engineer/);
    expect(rail).not.toMatch(/Reliability Engineer/);
    expect(page).toContain("caseExists={!emptyConversation}");
    const askCss = readFileSync(
      "src/components/public-ask/public-ask.css",
      "utf8",
    );
    expect(askCss).toContain(".bolt-ask-overflow");
    expect(askCss).not.toMatch(
      /@media[^{]+\{[^}]*\.bolt-ask-tool\[aria-label="Search"\]/,
    );
    expect(askCss).toContain(
      '.bolt-ask-overflow-menu .bolt-ask-tool[aria-label="Search"]',
    );
  });

  it("first-paint follow-up does not restore gold or a 48-hour offer", () => {
    const firstPaint = [
      "src/lib/first-paint-seeds.ts",
      "src/lib/public-ask-intents.ts",
      "src/components/RotatingSeedChip.tsx",
      "src/components/PublicProductHeader.tsx",
      "src/components/public-ask/PublicAskEmpty.tsx",
      "src/components/public-ask/PublicAskBar.tsx",
      "src/components/public-ask/PublicAskRail.tsx",
    ];
    for (const path of firstPaint) {
      const src = readFileSync(path, "utf8");
      expect(src, `${path} uses gold`).not.toMatch(/signal-gold/);
      expect(src, `${path} restores a 48-hour offer`).not.toMatch(/48-hour/);
    }
  });
});
