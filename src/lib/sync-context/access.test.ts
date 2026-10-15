import { describe, expect, it } from "vitest";
import { canOpenSyncContext } from "./access";
import { isNavItemVisible } from "../roleNavigation";
describe("Sync Context experience access (not server authorization)", () => {
  it.each([
    "admin",
    "ai_admin",
    "executive",
    "maintenance_manager",
    "reliability_engineer",
    "planner",
  ])("allows the read role %s", (role) => {
    expect(canOpenSyncContext(role)).toBe(true);
    expect(isNavItemVisible(role, "sync-context")).toBe(true);
  });
  it.each([
    "technician",
    "operator",
    "supervisor",
    "board",
    "assessment_sponsor",
    "unknown",
    null,
    undefined,
  ])("denies unsupported %s", (role) => {
    expect(canOpenSyncContext(role)).toBe(false);
    expect(isNavItemVisible(role, "sync-context")).toBe(false);
  });
});
