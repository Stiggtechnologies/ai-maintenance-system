import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDecisionCaseSourceStanding } from "./useDecisionCaseSourceStanding";
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../services/decisionCaseService", () => ({
  loadPersistedDecisionCase: load,
}));
const input = {
  enabled: true,
  caseId: "synthetic-case",
  revision: 7,
  scope: "tenant:viewer",
  busy: { current: false },
};
beforeEach(() => {
  load.mockReset();
});
describe("mapped source standing recheck", () => {
  it("fences a changed canonical version on focus without replacing local case data", async () => {
    load
      .mockResolvedValueOnce({ revision: 7 })
      .mockResolvedValueOnce({ revision: 8 });
    const { result } = renderHook(() => useDecisionCaseSourceStanding(input));
    await waitFor(() => expect(result.current).toBe("current"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current).toBe("changed"));
  });
  it("treats unavailable canonical reads as unverified standing", async () => {
    load.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useDecisionCaseSourceStanding(input));
    await waitFor(() => expect(result.current).toBe("unavailable"));
  });
  it("does not restore a previous identity's standing after a late response", async () => {
    let finish!: (value: unknown) => void;
    load
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce(null);
    const { result, rerender } = renderHook(
      ({ scope }) => useDecisionCaseSourceStanding({ ...input, scope }),
      { initialProps: { scope: input.scope } },
    );
    rerender({ scope: "other-tenant:viewer" });
    await waitFor(() => expect(result.current).toBe("unavailable"));
    await act(async () => {
      finish({ revision: 7 });
    });
    expect(result.current).toBe("unavailable");
  });
  it("does not load cases that have no mapped sources", () => {
    const { result } = renderHook(() =>
      useDecisionCaseSourceStanding({ ...input, enabled: false }),
    );
    expect(result.current).toBe("current");
    expect(load).not.toHaveBeenCalled();
  });
});
