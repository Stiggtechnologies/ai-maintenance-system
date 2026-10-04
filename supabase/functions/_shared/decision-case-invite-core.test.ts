import { describe, expect, it } from "vitest";
import {
  boundedProviderDetail,
  invitationLifecycle,
  inviteAuthority,
  mayRollbackFreshInvite,
  normalizeInviteRequest,
  providerFailureReceipt,
} from "./decision-case-invite-core";

const CASE_ID = "11111111-1111-4111-8111-111111111111";

describe("Decision Case invitation core", () => {
  it("normalizes a bounded invite without accepting a provisional case id", () => {
    expect(
      normalizeInviteRequest({
        action: "invite",
        decisionCaseId: CASE_ID,
        name: " Ada ",
        email: " ADA@EXAMPLE.COM ",
      }),
    ).toEqual({
      action: "invite",
      decisionCaseId: CASE_ID,
      name: "Ada",
      email: "ada@example.com",
    });
    expect(() =>
      normalizeInviteRequest({
        action: "invite",
        decisionCaseId: "dc-provisional",
        email: "ada@example.com",
      }),
    ).toThrow(/saved Decision Case/i);
  });

  it("requires human tenant authority and AAL2", () => {
    expect(inviteAuthority("admin", "aal2").allowed).toBe(true);
    expect(inviteAuthority("executive", "aal2").allowed).toBe(true);
    expect(inviteAuthority("ai_admin", "aal2").reason).toMatch(
      /administrator or executive/i,
    );
    expect(inviteAuthority("admin", "aal1").reason).toMatch(/AAL2/);
  });

  it("never upgrades submitted mail to accepted without Auth evidence", () => {
    expect(invitationLifecycle(null)).toBe("submitted");
    expect(invitationLifecycle({ email_confirmed_at: "2026-10-02" })).toBe(
      "accepted",
    );
    expect(
      invitationLifecycle({
        email_confirmed_at: "2026-10-02",
        last_sign_in_at: "2026-10-03",
      }),
    ).toBe("active");
  });

  it("bounds provider errors before returning them to a tenant audit", () => {
    expect(boundedProviderDetail("bad\nsecret\ttrace")).toBe(
      "bad secret trace",
    );
    expect(boundedProviderDetail("x".repeat(500))).toHaveLength(300);
    expect(providerFailureReceipt()).not.toMatch(/secret|trace/i);
  });

  it("allows destructive rollback only for a fresh, unaccepted invite identity", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(
      mayRollbackFreshInvite({ created_at: "2026-10-03T11:58:00.000Z" }, now),
    ).toBe(true);
    expect(
      mayRollbackFreshInvite(
        {
          created_at: "2026-10-03T11:58:00.000Z",
          email_confirmed_at: "2026-10-03T11:59:00.000Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      mayRollbackFreshInvite({ created_at: "2026-10-03T11:30:00.000Z" }, now),
    ).toBe(false);
  });
});
