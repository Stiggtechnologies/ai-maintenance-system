import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEVELOP_ENGINES, DEVELOP_MODULES } from "../lib/develop/composition";

const workspace = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);
const app = readFileSync("src/App.tsx", "utf8");
const nav = readFileSync(
  "src/components/develop/DevelopCompositionNav.tsx",
  "utf8",
);

describe("D11.02 / D11.13 reachable composition", () => {
  it("renders the composition map from the governed case workspace", () => {
    expect(workspace).toContain(
      "<DevelopCompositionNav caseId={workspace.id} />",
    );
    expect(nav).toContain("DEVELOP_ENGINES.map");
    expect(nav).toContain("DEVELOP_MODULES.map");
  });

  it("lands every engine and anchored module on a real workspace section", () => {
    for (const engine of DEVELOP_ENGINES) {
      expect(workspace).toContain(`id="${engine.anchor}"`);
    }
    for (const module of DEVELOP_MODULES) {
      if (module.target.kind === "anchor") {
        expect(workspace).toContain(`id="${module.target.anchor}"`);
      }
    }
  });

  it("sends every routed module to a route the authenticated app owns", () => {
    for (const module of DEVELOP_MODULES) {
      if (module.target.kind === "route") {
        expect(app).toContain(`path="${module.target.path}"`);
      }
    }
  });

  it("remains a read-only map over canonical surfaces", () => {
    expect(nav).not.toMatch(
      /supabase|\.rpc\(|\.from\(|localStorage|sessionStorage/,
    );
    expect(nav).not.toMatch(/accept_risk|certify_readiness|sanction_project/);
  });
});
