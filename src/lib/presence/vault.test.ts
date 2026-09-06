import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPresenceVaultDocuments,
  decisionNotePath,
  meetingNotePath,
  parseSessionDocument,
  profileOrganizationId,
  shouldHydrateFromVault,
  VAULT_GOVERNANCE,
  VAULT_PATHS,
} from "./vault";

const memory = {
  lastSubject: "HMER haul truck availability optimization",
  messages: [
    {
      id: "u1",
      role: "user" as const,
      text: "HMER haul truck availability optimization",
    },
    {
      id: "s1",
      role: "sync" as const,
      text: "Provisional until a Decision Case is bound. I recommend, I do not authorize.",
    },
  ],
};

describe("presence vault shape", () => {
  it("writes markdown/JSON notes with recommend≠authorize and no vendor copy", () => {
    const docs = buildPresenceVaultDocuments({
      memory,
      now: new Date("2026-09-06T12:00:00.000Z"),
    });
    const paths = docs.map((doc) => doc.path);
    expect(paths).toEqual([
      VAULT_PATHS.index,
      VAULT_PATHS.session,
      "meetings/2026-09-06.md",
    ]);
    for (const doc of docs) {
      expect(doc.bodyJson.governance).toBe(VAULT_GOVERNANCE);
      expect(doc.bodyMarkdown).toMatch(/I recommend, I do not authorize/i);
      expect(doc.bodyMarkdown).not.toMatch(
        /jaredrhod|vault-index|authorize plant/i,
      );
    }
    expect(docs[1]?.bodyMarkdown).toMatch(/unbound|provisional/i);
  });

  it("adds Decision Case continuity without becoming the case record", () => {
    const docs = buildPresenceVaultDocuments({
      memory,
      caseId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      caseNumber: "DC-2201",
      asset: "Crusher 2201",
      now: new Date("2026-09-06T12:00:00.000Z"),
    });
    const decision = docs.find((doc) => doc.kind === "decision_continuity");
    expect(decision?.path).toBe(
      "decisions/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.md",
    );
    expect(decision?.bodyMarkdown).toMatch(/not the Decision Case record/i);
    expect(decision?.bodyMarkdown).toContain("DC-2201");
    expect(decision?.bodyMarkdown).toContain("Crusher 2201");
    expect(decision?.bodyMarkdown).not.toMatch(
      /approved|authorized to execute/i,
    );
  });

  it("rejects unsafe decision paths and parses session JSON only", () => {
    expect(decisionNotePath("../etc/passwd")).toBeNull();
    expect(decisionNotePath("ok-case_1")).toBe("decisions/ok-case_1.md");
    expect(meetingNotePath(new Date("2026-01-02T00:00:00.000Z"))).toBe(
      "meetings/2026-01-02.md",
    );
    expect(
      parseSessionDocument({
        body_json: {
          lastSubject: "compressor C-330",
          messages: [{ id: "1", role: "user", text: "Calculate MTBF" }],
          governance: VAULT_GOVERNANCE,
        },
      }),
    ).toEqual({
      lastSubject: "compressor C-330",
      messages: [{ id: "1", role: "user", text: "Calculate MTBF" }],
    });
    expect(
      parseSessionDocument({ body_json: { messages: "nope" } }),
    ).toBeNull();
  });

  it("hydrates from vault when the tab cache is empty or shorter", () => {
    const vault = memory;
    expect(
      shouldHydrateFromVault({ messages: [], lastSubject: null }, vault),
    ).toBe(true);
    expect(
      shouldHydrateFromVault(vault, { messages: [], lastSubject: null }),
    ).toBe(false);
    expect(shouldHydrateFromVault(vault, vault)).toBe(true);
    expect(profileOrganizationId({ organization_id: "org-1" })).toBe("org-1");
    expect(profileOrganizationId({ organization_id: "" })).toBeNull();
    expect(profileOrganizationId(null)).toBeNull();
  });

  it("does not import a vendor vault or invent OEM limits", () => {
    const src = readFileSync("src/lib/presence/vault.ts", "utf8");
    const imports = src
      .split("\n")
      .filter((line) => line.includes("import "))
      .join("\n");
    expect(imports).not.toMatch(/obsidian|jaredrhod|openclaw|javis/i);
    expect(src).not.toMatch(/\b87%|MTBF >=|OEM interval\b/i);
  });
});
