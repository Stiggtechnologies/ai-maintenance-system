import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const listing = readFileSync(
  "docs/marketplace/partner-center-fields.md",
  "utf8",
);
const offerListing = listing.match(
  /## Offer listing([\s\S]*?)## Technical configuration/,
)?.[1];
const normalizedOfferListing = offerListing
  ?.replace(/^>\s?/gm, "")
  .replace(/\s+/g, " ")
  .trim();

describe("Microsoft Marketplace listing claims", () => {
  it("foregrounds the repository-backed reliability capabilities", () => {
    expect(normalizedOfferListing).toBeDefined();
    for (const claim of [
      "governed condition monitoring",
      "censored life-data analysis",
      "physics-of-failure calculations",
      "downtime-recovery coordination",
      "auditable decision cases",
    ]) {
      expect(normalizedOfferListing!.toLowerCase()).toContain(claim);
    }
  });

  it("preserves the operational authority boundary", () => {
    expect(normalizedOfferListing).toContain(
      "does not autonomously change engineering limits, maintenance intervals, work orders, schedules, asset state, or return equipment to service",
    );
    expect(normalizedOfferListing).toContain("named human review and approval");
  });

  it("qualifies connector maturity and rejects unsupported outcome promises", () => {
    expect(normalizedOfferListing).toContain(
      "Production connectors and historian links are configured and validated for each customer environment",
    );
    expect(normalizedOfferListing).not.toMatch(
      /reduce unplanned downtime by up to 50%/i,
    );
    expect(normalizedOfferListing).not.toMatch(
      /lower maintenance costs by 25(?:[-–]30)?%/i,
    );
    expect(normalizedOfferListing).not.toMatch(
      /within 24(?:[-–]48)? hours/i,
    );
    expect(normalizedOfferListing).not.toMatch(/MACC[- ]eligible/i);
  });

  it("keeps the search summary within Microsoft's 100-character limit", () => {
    const summary = listing.match(
      /### Search results summary \(100 characters maximum\)\n\n`([^`]+)`/,
    )?.[1];
    expect(summary).toBeDefined();
    expect(summary!.length).toBeLessThanOrEqual(100);
  });
});
