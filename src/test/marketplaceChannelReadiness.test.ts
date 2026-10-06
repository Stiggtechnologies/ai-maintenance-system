import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Channel {
  id: string;
  state: string;
  marketplaceTransactionReady: boolean;
  selfServeCheckoutReady: boolean;
  buyerPath: string | null;
  verifiedEvidence: string[];
  blockers: string[];
}

const manifest = JSON.parse(
  readFileSync("marketplace/channel-readiness.json", "utf8"),
) as { channels: Channel[] };

const byId = new Map(manifest.channels.map((channel) => [channel.id, channel]));

describe("marketplace channel readiness", () => {
  it("tracks every current acquisition channel without claiming a live transaction", () => {
    expect([...byId.keys()].sort()).toEqual([
      "aws_marketplace",
      "direct_ria",
      "microsoft_professional_services",
      "microsoft_saas",
      "salesforce_appexchange",
    ]);
    expect(
      manifest.channels.filter((channel) => channel.marketplaceTransactionReady),
    ).toEqual([]);
    expect(
      manifest.channels.filter((channel) => channel.selfServeCheckoutReady),
    ).toEqual([]);
    for (const channel of manifest.channels) {
      expect(channel.verifiedEvidence.length).toBeGreaterThan(0);
      expect(channel.blockers.length).toBeGreaterThan(0);
    }
  });

  it("keeps AWS source scaffolding separate from buyer readiness", () => {
    const aws = byId.get("aws_marketplace");
    expect(aws?.state).toBe("design_scaffolding_only");
    expect(aws?.buyerPath).toBeNull();
    expect(aws?.blockers.join(" ")).toMatch(/POST registration handoff/);
    expect(aws?.blockers.join(" ")).toMatch(/archived/);

    const docs = readFileSync("docs/aws-marketplace.md", "utf8");
    expect(docs).toMatch(/NOT A PUBLISHED OR TRANSACTABLE/);
    expect(docs).toMatch(/HTTP `POST`/);
    expect(docs).toMatch(/EDP eligibility:\*\* Not evidenced/);
  });

  it("keeps Salesforce package design separate from install evidence", () => {
    const salesforce = byId.get("salesforce_appexchange");
    expect(salesforce?.state).toBe("design_scaffolding_only");
    expect(salesforce?.buyerPath).toBeNull();
    expect(salesforce?.blockers.join(" ")).toMatch(/No Salesforce package/);

    const docs = readFileSync("docs/salesforce-appexchange.md", "utf8");
    expect(docs).toMatch(/NOT A PUBLISHED OR INSTALLABLE/);
    expect(docs).toMatch(/no Salesforce DX\/package source/i);

    const page = readFileSync("src/pages/SalesforceSignup.tsx", "utf8");
    expect(page).not.toContain(
      "The SyncAI managed package is installed in your Salesforce org.",
    );
    expect(page).toContain("This page does not prove");
  });
});
