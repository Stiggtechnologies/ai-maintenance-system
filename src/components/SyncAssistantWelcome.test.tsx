import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncAssistantWelcome } from "./SyncAssistantWelcome";
import type { useSyncRealtimeVoice } from "../hooks/useSyncRealtimeVoice";
const start = vi.fn().mockResolvedValue(undefined);
const stop = vi.fn();
const voice = {
  state: "idle",
  status: "Ready",
  start,
  stop,
} as unknown as ReturnType<typeof useSyncRealtimeVoice>;
const props = {
  userId: "user-a",
  organizationId: "org-a",
  fullName: "Orville Davis",
  enabled: true,
  voice,
  onOpen: vi.fn(),
};
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});
const advance = () =>
  act(() => {
    vi.runOnlyPendingTimers();
  });
describe("canonical assistant welcome", () => {
  it("welcomes first login once under StrictMode and does not repeat on returning login in the same tab", () => {
    const view = render(
      <StrictMode>
        <SyncAssistantWelcome {...props} />
      </StrictMode>,
    );
    advance();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0]).toContain("Welcome Orville.");
    view.unmount();
    render(<SyncAssistantWelcome {...props} />);
    advance();
    expect(start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Play welcome" }));
    expect(start).toHaveBeenCalledTimes(2);
  });
  it("keeps user/tenant welcome and mute state separate", () => {
    const view = render(<SyncAssistantWelcome {...props} />);
    advance();
    fireEvent.click(screen.getByRole("button", { name: "Mute welcome" }));
    view.unmount();
    const next = render(
      <SyncAssistantWelcome
        {...props}
        organizationId="org-b"
        fullName="Alex Smith"
      />,
    );
    advance();
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1][0]).toContain("Alex");
    expect(start.mock.calls[1][0]).not.toContain("Orville");
    next.unmount();
    render(
      <SyncAssistantWelcome {...props} userId="user-b" fullName="Sam Jones" />,
    );
    advance();
    expect(start).toHaveBeenCalledTimes(3);
    expect(start.mock.calls[2][0]).toContain("Sam");
  });
  it("fails closed while flags, profile or sign-in are unavailable", () => {
    const view = render(<SyncAssistantWelcome {...props} enabled={false} />);
    advance();
    expect(start).not.toHaveBeenCalled();
    view.rerender(<SyncAssistantWelcome {...props} organizationId="" />);
    advance();
    expect(start).not.toHaveBeenCalled();
    view.rerender(<SyncAssistantWelcome {...props} userId="" />);
    advance();
    expect(start).not.toHaveBeenCalled();
  });
  it("interrupts playback and opens the same assistant instead of a second booth", () => {
    render(<SyncAssistantWelcome {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Talk with Sync" }));
    expect(stop).toHaveBeenCalledOnce();
    expect(props.onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByText("Meet Sync")).toBeNull();
  });
  it("welcomes a returning user in a new tab without restoring another assistant's memory", () => {
    const view = render(<SyncAssistantWelcome {...props} />);
    advance();
    view.unmount();
    sessionStorage.clear();
    render(<SyncAssistantWelcome {...props} />);
    advance();
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1][0]).not.toContain("Reliability Engineer");
  });
});
