import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Edge Function the browser calls through supabase.functions.invoke must
 * allow the headers supabase-js sends (apikey, x-client-info) in its CORS
 * preflight, or every browser call is blocked before it reaches the function.
 * kb-document-intake and decision-case-invite missed this; the First Decision
 * Journey (steps 12-13 and 20) depends on both.
 */
const root = process.cwd();
const boundary = JSON.parse(
  fs.readFileSync(path.join(root, "config/edge-function-boundary.json"), "utf8"),
) as { activeFunctions: string[] };

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

function functionSource(name: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const add = (file: string) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    parts.push(text);
    for (const match of text.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      add(path.resolve(path.dirname(file), match[1]));
    }
  };
  add(path.join(root, "supabase/functions", name, "index.ts"));
  return parts.join("\n");
}

const invoked = [
  ...new Set(
    sourceFiles(path.join(root, "src")).flatMap((file) =>
      [...fs.readFileSync(file, "utf8").matchAll(/functions\.invoke(?:<[^>]*>)?\(\s*["'`]([a-z0-9-]+)["'`]/g)].map(
        (match) => match[1],
      ),
    ),
  ),
].sort();

describe("browser-invoked Edge Functions allow the supabase-js preflight headers", () => {
  it("finds the browser-invoked deployed functions, including governed intake and invitations", () => {
    expect(invoked).toEqual(expect.arrayContaining(["kb-document-intake", "decision-case-invite"]));
  });

  for (const name of invoked.filter((fn) => boundary.activeFunctions.includes(fn))) {
    it(`${name} allows apikey and x-client-info`, () => {
      const source = functionSource(name);
      expect(source, name).toMatch(/Access-Control-Allow-Headers/i);
      expect(source, name).toMatch(/x-client-info/i);
      expect(source, name).toMatch(/apikey/i);
    });
  }

  it("deploys governed document intake through the reviewed pipeline", () => {
    expect(boundary.activeFunctions).toContain("kb-document-intake");
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/deploy-migrations.yml"), "utf8");
    expect(workflow).toContain("supabase functions deploy kb-document-intake");
  });
});

describe("repository hygiene", () => {
  it("never tracks node_modules", () => {
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toMatch(/^node_modules$/m);
  });
});
