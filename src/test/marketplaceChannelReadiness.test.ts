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

interface ListingDraft {
  channel: string;
  status: string;
  submissionAuthorized: boolean;
  publicationAuthorized: boolean;
  transactionReady: boolean;
  acquisitionExperiments: Array<{
    entry: string;
    claimsBoundary: string;
    attributedDestination: string;
  }>;
  releaseGates: string[];
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
      "microsoft_dynamics_agents",
      "microsoft_professional_services",
      "microsoft_saas",
      "salesforce_appexchange",
    ]);
    expect(
      manifest.channels.filter(
        (channel) => channel.marketplaceTransactionReady,
      ),
    ).toEqual([]);
    expect(
      manifest.channels.filter((channel) => channel.selfServeCheckoutReady),
    ).toEqual([]);
    for (const channel of manifest.channels) {
      expect(channel.verifiedEvidence.length).toBeGreaterThan(0);
      expect(channel.blockers.length).toBeGreaterThan(0);
    }
  });

  it("treats Dynamics agent offers as a qualified native-package hypothesis, not a live listing", () => {
    const dynamics = byId.get("microsoft_dynamics_agents");
    expect(dynamics).toMatchObject({
      state: "qualified_channel_hypothesis",
      marketplaceTransactionReady: false,
      selfServeCheckoutReady: false,
      buyerPath: null,
    });
    expect(dynamics?.blockers.join(" ")).toMatch(/No Dynamics-native/);
    expect(dynamics?.blockers.join(" ")).toMatch(/No certified preview/);

    const strategy = readFileSync(
      "docs/marketplace/dynamics-agent-channel.md",
      "utf8",
    );
    expect(strategy).toMatch(/SyncAI Industrial Reliability Agents/);
    expect(strategy).toMatch(/Maintenance Readiness Agent/);
    expect(strategy).toMatch(/Failure Investigation Agent/);
    expect(strategy).toMatch(/Agents are what customers discover/);
    expect(strategy).toMatch(/copilot is how a person can converse/i);
    expect(strategy).toMatch(/failure elimination` is a desired/);
    expect(strategy).toMatch(/Downtime Recovery Agent/);
    expect(strategy).toMatch(/Preventive Maintenance Decision Agent/);
    expect(strategy).toMatch(/not trademark clearance/i);
    expect(strategy).toMatch(/same governed SyncAI platform/);
    expect(strategy).toMatch(/56 million monthly active Power Platform users/);
    expect(strategy).toMatch(/not a Dynamics user count/i);
    expect(strategy).toMatch(/US\$100\.8M ARR/);
    expect(strategy).toMatch(/does not\s+authorize Partner Center submission/i);
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

  it.each([
    ["aws_marketplace", "marketplace/aws-listing-draft.json"],
    ["salesforce_appexchange", "marketplace/salesforce-listing-draft.json"],
  ])(
    "keeps the %s portal package non-submittable and tied to supported entries",
    (channel, path) => {
      const draft = JSON.parse(readFileSync(path, "utf8")) as ListingDraft;
      expect(draft.channel).toBe(channel);
      expect(draft.status).toBe("portal_entry_draft_only");
      expect(draft.submissionAuthorized).toBe(false);
      expect(draft.publicationAuthorized).toBe(false);
      expect(draft.transactionReady).toBe(false);
      expect(draft.releaseGates.length).toBeGreaterThanOrEqual(6);

      expect(draft.acquisitionExperiments.map(({ entry }) => entry)).toEqual([
        "downtime-reduction",
        "recovery-coordination",
        "maintenance-cost-reduction",
      ]);
      for (const experiment of draft.acquisitionExperiments) {
        expect(experiment.claimsBoundary.length).toBeGreaterThan(40);
        expect(experiment.attributedDestination).toContain(
          `source=${channel.replace("_", "-")}`,
        );
        expect(experiment.attributedDestination).toContain(
          `variant=${experiment.entry}`,
        );
      }
    },
  );

  it("does not present the Salesforce service experiment as an app install", () => {
    const draft = JSON.parse(
      readFileSync("marketplace/salesforce-listing-draft.json", "utf8"),
    ) as ListingDraft & {
      installableAppReady: boolean;
      recommendedFirstSurface: { type: string; commercialBoundary: string };
      futureManagedPackage: { status: string; listingCopyAuthorized: boolean };
    };

    expect(draft.installableAppReady).toBe(false);
    expect(draft.recommendedFirstSurface.type).toBe(
      "consulting_service_visibility_listing",
    );
    expect(draft.recommendedFirstSurface.commercialBoundary).toMatch(
      /not AppExchange software checkout/i,
    );
    expect(draft.futureManagedPackage).toMatchObject({
      status: "not_ready",
      listingCopyAuthorized: false,
    });
  });
});
