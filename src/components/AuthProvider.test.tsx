import { act, render, screen, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  readProfile: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { onAuthStateChange: mocks.subscribe },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.readProfile }) }),
    }),
  },
}));
vi.mock("../lib/securityEvents", () => ({ recordSecurityEvent: mocks.audit }));

const session = { user: { id: "signed-in-user" } } as Session;
const profile = { id: session.user.id, full_name: "Signed In User" };
let emit: (event: AuthChangeEvent, session: Session | null) => unknown;

function AuthStatus() {
  const { user, profile, loading } = useAuth();
  return (
    <output>
      {loading ? "loading" : "ready"}:{user?.id ?? "none"}:
      {profile?.full_name ?? "none"}
    </output>
  );
}

function mount() {
  return render(
    <AuthProvider>
      <AuthStatus />
    </AuthProvider>,
  );
}

describe("AuthProvider session observation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.subscribe.mockImplementation((callback) => {
      emit = callback;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
    mocks.readProfile.mockResolvedValue({ data: profile, error: null });
    mocks.audit.mockResolvedValue(undefined);
  });

  it("returns synchronously from auth and runs profile and audit reads afterward", async () => {
    mount();
    act(() => {
      expect(emit("SIGNED_IN", session)).toBeUndefined();
      expect(mocks.readProfile).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });
    expect(
      await screen.findByText("ready:signed-in-user:Signed In User"),
    ).toBeTruthy();
    expect(mocks.audit).toHaveBeenCalledWith("sign_in", "Signed in");
  });

  it("ignores a pending profile result after sign-out", async () => {
    let resolve!: (value: { data: typeof profile; error: null }) => void;
    mocks.readProfile.mockReturnValue(
      new Promise((complete) => {
        resolve = complete;
      }),
    );
    mount();
    act(() => {
      emit("INITIAL_SESSION", session);
    });
    await waitFor(() => expect(mocks.readProfile).toHaveBeenCalledOnce());
    act(() => {
      emit("SIGNED_OUT", null);
    });
    await act(async () => {
      resolve({ data: profile, error: null });
    });
    expect(screen.getByText("ready:none:none")).toBeTruthy();
  });

  it("settles a signed-out initial session and unsubscribes on unmount", () => {
    const view = mount();
    act(() => {
      emit("INITIAL_SESSION", null);
    });
    expect(screen.getByText("ready:none:none")).toBeTruthy();
    expect(mocks.readProfile).not.toHaveBeenCalled();
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
