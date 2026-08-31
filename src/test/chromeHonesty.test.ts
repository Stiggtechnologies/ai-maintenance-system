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
        if (isCommentLine(line)) return;
        if (DANGEROUS_LEADING.test(line)) {
          hits.push(`${path}:${index + 1}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
