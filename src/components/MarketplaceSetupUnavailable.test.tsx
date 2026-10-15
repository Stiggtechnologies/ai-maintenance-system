import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AwsMarketplaceSignup } from "../pages/AwsMarketplaceSignup";
import { SalesforceSignup } from "../pages/SalesforceSignup";

const providerCalls = vi.hoisted(() => ({ resolve: vi.fn(), link: vi.fn() }));
vi.mock("../lib/aws-marketplace", () => ({
  resolveAwsMarketplaceToken: providerCalls.resolve,
  linkAwsCustomerToOrg: providerCalls.link,
}));

describe("unverified marketplace entry", () => {
  it.each([
    ["AWS Marketplace", AwsMarketplaceSignup],
    ["Salesforce AppExchange", SalesforceSignup],
  ] as const)(
    "gates %s without provider or activation calls",
    (provider, Page) => {
      render(<Page />);
      expect(
        screen.getByRole("heading", {
          name: `${provider} activation requires assistance`,
        }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          /Self-service activation for this marketplace is not available/,
        ),
      ).toBeTruthy();
      expect(
        screen.getByRole("link", {
          name: /Sign in to an existing SyncAI workspace/,
        }),
      ).toHaveAttribute("href", "/signin?returnTo=%2F");
      expect(
        screen.getByRole("link", { name: "Discuss marketplace setup" }),
      ).toHaveAttribute("href", "https://syncai.ca/contact");
      expect(providerCalls.resolve).not.toHaveBeenCalled();
      expect(providerCalls.link).not.toHaveBeenCalled();
      expect(
        screen.queryByText(
          /Your subscription is linked|managed package is installed/,
        ),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Continue to account setup/ }),
      ).toBeNull();
    },
  );
});
