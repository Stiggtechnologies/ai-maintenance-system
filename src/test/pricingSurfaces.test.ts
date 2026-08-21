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

  // Four of the five originally listed here were DELETED on 2026-08-20 rather
  // than bannered, because they asserted a shipped state the register
  // contradicts and the banner leaves the claim on the page. Absent is
  // strictly stronger than bannered, so the assertion admits it — and the
  // compensating assertion below makes sure "absent" cannot quietly become
  // "back, without a banner": a deleted doc may not return at all.
  it.each([
    "BILLING-IMPLEMENTATION.md",
    "STRIPE-INTEGRATION-GUIDE.md",
    "PREMIUM_CUSTOMER_JOURNEY_DEPLOYED.md",
    "FINAL-AUDIT-REPORT.md",
    "FEATURE-ACCESS-MAP.md",
  ])("%s is deleted, or carries the superseded/deleted banner", (doc) => {
    if (!existsSync(doc)) return;
    const text = readFileSync(doc, "utf8");
    expect(text).toMatch(
      /under commercial review|superseded|deleted on 2026-08-19/i,
    );
  });

  it("the deleted status documents stay deleted", () => {
    // Compensating assertion for relaxing the rule above. These asserted
    // "100% COMPLETE" / "PRODUCTION-READY" / "FULLY OPERATIONAL" against a
    // register carrying 40 absent and 190 partial items. Recreating one is a
    // regression whether or not it mentions a price.
    const deleted = [
      "AUTONOMOUS-MVP.md",
      "BILLING-IMPLEMENTATION.md",
      "CUSTOMER_INFRASTRUCTURE_ROADMAP.md",
      "FINAL-AUDIT-REPORT.md",
      "ISO-55000-IMPLEMENTATION-SUMMARY.md",
      "JAVIS-COMPLETE-SUMMARY.md",
      "JAVIS-DEPLOYMENT-CHECKLIST.md",
      "JAVIS-INTERACTIVE-GUIDE.md",
      "JAVIS-QUICK-REFERENCE.md",
      "MICROSOFT-COPILOT-FEATURES.md",
      "MVP-COMPLETED.md",
      "MVP-COMPLETION-STATUS.md",
      "OPERATIONAL-COMPLETION-REPORT.md",
      "PHASE2-VALIDATION-REPORT.md",
      "PREMIUM_CUSTOMER_JOURNEY_DEPLOYED.md",
      "PRODUCT_AGENT_SUMMARY.md",
      "PRODUCTION-READY.md",
      "STATUS-REPORT.md",
      "STRIPE-INTEGRATION-GUIDE.md",
    ];
    expect(deleted.filter((doc) => existsSync(doc))).toEqual([]);
  });

  it("no root doc asserts a shipped state the register contradicts", () => {
    // The vocabulary that made those files diligence-room liabilities.
    const overclaim =
      /100%\s*complete|production[- ]ready|fully operational|fully implemented/i;
    const offenders = rootDocs.filter((doc) => {
      const text = readFileSync(doc, "utf8");
      // The engineering contracts discuss the vocabulary rather than claim
      // it, and a doc whose own heading enumerates what is NOT ready has
      // earned the phrase — README.md's "Not yet production-ready" section is
      // the opposite of an over-claim. Both are structural, not exemptions.
      if (["AGENTS.md", "CLAUDE.md"].includes(doc)) return false;
      if (/not yet production[- ]ready/i.test(text)) return false;
      return overclaim.test(text);
    });
    expect(offenders).toEqual([]);
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
