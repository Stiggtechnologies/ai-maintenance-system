import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
const upsert = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
  },
}));

import { loadPresenceVaultSession, persistPresenceVault } from "./vaultClient";

beforeEach(() => {
  maybeSingle.mockReset();
  upsert.mockReset();
  eq.mockReset();
  select.mockReset();
  from.mockReset();
  const query = {
    select,
    eq,
    maybeSingle,
    upsert,
  };
  select.mockReturnValue(query);
  eq.mockReturnValue(query);
  from.mockReturnValue(query);
  maybeSingle.mockResolvedValue({ data: null, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("presence vault client", () => {
  it("refuses unsigned-in or org-less writes and reads", async () => {
    expect(
      await loadPresenceVaultSession({ userId: "", organizationId: "org" }),
    ).toBeNull();
    expect(
      await persistPresenceVault({
        userId: "user-1",
        organizationId: "",
        memory: { messages: [], lastSubject: null },
      }),
    ).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("loads session JSON for the signed-in owner only", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        body_json: {
          lastSubject: "compressor C-330",
          messages: [{ id: "1", role: "user", text: "Calculate MTBF" }],
          governance: "recommend_not_authorize",
        },
      },
      error: null,
    });
    const loaded = await loadPresenceVaultSession({
      userId: "user-1",
      organizationId: "org-1",
    });
    expect(from).toHaveBeenCalledWith("presence_meeting_vault");
    expect(eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(eq).toHaveBeenCalledWith("path", "session.json");
    expect(loaded?.lastSubject).toBe("compressor C-330");
  });

  it("upserts index, session, and daily notes without authorizing", async () => {
    const ok = await persistPresenceVault({
      userId: "user-1",
      organizationId: "org-1",
      memory: {
        lastSubject: "HMER haul truck",
        messages: [
          { id: "u1", role: "user", text: "HMER haul truck" },
          {
            id: "s1",
            role: "sync",
            text: "I recommend, I do not authorize.",
          },
        ],
      },
      now: new Date("2026-09-06T12:00:00.000Z"),
    });
    expect(ok).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(3);
    const first = upsert.mock.calls[0][0] as {
      body_json: { governance: string };
      organization_id: string;
      user_id: string;
    };
    expect(first.organization_id).toBe("org-1");
    expect(first.user_id).toBe("user-1");
    expect(first.body_json.governance).toBe("recommend_not_authorize");
  });

  it("swallows backend failures so a booth turn still completes", async () => {
    maybeSingle.mockRejectedValue(new Error("network"));
    upsert.mockResolvedValue({ error: { message: "rls" } });
    expect(
      await loadPresenceVaultSession({
        userId: "user-1",
        organizationId: "org-1",
      }),
    ).toBeNull();
    expect(
      await persistPresenceVault({
        userId: "user-1",
        organizationId: "org-1",
        memory: { messages: [], lastSubject: "x" },
      }),
    ).toBe(false);
  });
});
