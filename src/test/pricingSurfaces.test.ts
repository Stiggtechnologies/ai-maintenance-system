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
import { existsSync, readFileSync } from "node:fs";
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
