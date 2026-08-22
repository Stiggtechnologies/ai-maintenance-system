import { describe, expect, it } from "vitest";
import { notificationTypeFor } from "../../../supabase/functions/_shared/sync-notification-classifier.ts";

describe("Sync maintenance-notification classification", () => {
  it("honors the requested observation type when later prose negates a fault", () => {
    expect(
      notificationTypeFor(
        "Create a maintenance notification observation for this asset: synthetic acceptance only; no real equipment fault exists.",
      ),
    ).toBe("observation");
  });

  it.each([
    ["Report this safety condition on the current asset", "safety"],
    ["Raise a fault for the current asset", "fault"],
    ["Log an observation for the current asset", "observation"],
    ["Create a maintenance request for the current asset", "request"],
  ] as const)("classifies an explicit request: %s", (question, expected) => {
    expect(notificationTypeFor(question)).toBe(expected);
  });

  it("uses observation for a generic maintenance notification instead of inferring a type from later prose", () => {
    expect(
      notificationTypeFor(
        "Create a maintenance notification for this asset: no equipment fault exists; this is only a workflow test.",
      ),
    ).toBe("observation");
  });
});
