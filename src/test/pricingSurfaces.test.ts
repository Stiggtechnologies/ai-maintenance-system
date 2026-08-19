/**
 * Pricing honesty — the surfaces that used to assert prices nobody set.
 *
 * The product ran a campaign purging fabricated numbers; these guards keep
 * the purged surfaces purged:
 *   - billing-gainshare (triple-counted savings from hardcoded rates) stays
 *     deleted, along with its only caller;
 *   - the dead checkout/pricing components stay deleted;
 *   - no user-visible surface re-acquires a dollar price or a token
 *     denomination that has no commercial source.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deleted pricing surfaces stay deleted", () => {
  it.each([
    "supabase/functions/billing-gainshare",
    "src/components/billing/GainShareConsole.tsx",
    "src/components/billing/PremiumCheckout.tsx",
    "src/components/billing/UsageDashboard.tsx",
    "src/pages/Pricing.tsx",
  ])("%s does not exist", (path) => {
    expect(existsSync(path)).toBe(false);
  });

  it("the pricing page literal left the App page union", () => {
    expect(readFileSync("src/App.tsx", "utf8")).not.toContain('"pricing"');
  });
});

describe("help center carries no invented plan prices", () => {
  const help = readFileSync("src/components/HelpCenterWidget.tsx", "utf8");

  it("names no monthly dollar figure", () => {
    expect(help).not.toMatch(/\$\s?\d[\d,]*\s*\/\s*month/i);
    expect(help).not.toContain("$4,000");
    expect(help).not.toContain("$9,000");
    expect(help).not.toContain("$18,000");
  });

  it("says pricing is available on request instead", () => {
    expect(help).toMatch(/available on request/i);
  });
});

describe("decision workspace shows no token denominations", () => {
  it("user-visible copy never states an amount of tokens", () => {
    const page = readFileSync(
      "src/pages/DecisionCaseWorkspacePage.tsx",
      "utf8",
    );
    // "52,000 tokens" (or any count of tokens) must not appear as copy.
    // Internal allowance numerics (choose("pay_per_use", 52000)) are allowed;
    // a rendered denomination is not.
    expect(page).not.toMatch(/\d[\d,]*\s*(?:tokens|credits)\b/i);
  });
});

describe("root-level docs cannot assert the unconfirmed tier prices as current", () => {
  // These historical implementation records still show the $4k/$9k/$18k
  // tiers (and examples derived from them). They may keep the numbers ONLY
  // under an explicit superseded/deleted banner — any root doc that names a
  // tier price without one is a regression of the honesty campaign.
  const rootDocs = readdirSync(".").filter((name) => name.endsWith(".md"));

  it.each([
    "BILLING-IMPLEMENTATION.md",
    "STRIPE-INTEGRATION-GUIDE.md",
    "PREMIUM_CUSTOMER_JOURNEY_DEPLOYED.md",
    "FINAL-AUDIT-REPORT.md",
    "FEATURE-ACCESS-MAP.md",
  ])("%s carries the superseded/deleted banner", (doc) => {
    const text = readFileSync(doc, "utf8");
    expect(text).toMatch(
      /under commercial review|superseded|deleted on 2026-08-19/i,
    );
  });

  it("no root doc states a tier price as a current monthly rate without the marker", () => {
    // Matches the tier figures only in a pricing context ("$4,000 CAD",
    // "$4000 CAD/month", "$4,000 / month") — a "$4,000" engineering-hours
    // line item in a roadmap is a cost estimate, not a product price.
    const tierPrice =
      /\$\s?(?:4,?000|9,?000|18,?000)(?:\.00)?\s*(?:CAD|\/\s?month)/i;
    for (const doc of rootDocs) {
      const text = readFileSync(doc, "utf8");
      if (!tierPrice.test(text)) continue;
      expect(
        /under commercial review|superseded|deleted on 2026-08-19/i.test(text),
        `${doc} states a tier price with no superseded/commercial-review marker`,
      ).toBe(true);
    }
  });

  it("no root doc instructs modifying the deleted billing-gainshare", () => {
    for (const doc of rootDocs) {
      const text = readFileSync(doc, "utf8");
      if (!text.includes("billing-gainshare")) continue;
      expect(
        /deleted|removed/i.test(text),
        `${doc} references billing-gainshare without stating it was deleted`,
      ).toBe(true);
    }
  });
});

describe("marketplace docs carry no per-seat price claims", () => {
  it.each(["docs/aws-marketplace.md", "docs/salesforce-appexchange.md"])(
    "%s states commercial review, not a price",
    (path) => {
      const doc = readFileSync(path, "utf8");
      expect(doc).not.toMatch(/\$\s?(99|199|349)\b/);
      expect(doc).toMatch(/under commercial review/i);
    },
  );
});
