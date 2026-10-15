import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncAssistantWelcome } from "./SyncAssistantWelcome";
import type { useSyncRealtimeVoice } from "../hooks/useSyncRealtimeVoice";
const start = vi.fn().mockResolvedValue(undefined);
const stop = vi.fn();
const stopWelcome = vi.fn();
const voice = {
  state: "idle",
  status: "Ready",
  start,
  stop,
  stopWelcome,
  welcomeOnly: false,
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
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
describe("canonical assistant welcome", () => {
  it("welcomes first and returning login without an automatic provider request, including StrictMode and new tabs", () => {
    const view = render(
      <StrictMode>
        <SyncAssistantWelcome {...props} />
      </StrictMode>,
    );
    expect(screen.getByText(/Welcome Orville/)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    view.rerender(
      <StrictMode>
        <SyncAssistantWelcome {...props} />
      </StrictMode>,
    );
    view.unmount();
    const returning = render(<SyncAssistantWelcome {...props} />);
    expect(start).not.toHaveBeenCalled();
    returning.unmount();
    sessionStorage.clear();
    render(<SyncAssistantWelcome {...props} />);
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play welcome" }));
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][0]).toContain("Welcome Orville.");
  });
  it("keeps personalized voice and mute state separate across tenant and user changes", () => {
    const view = render(<SyncAssistantWelcome {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Play welcome" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute welcome" }));
    view.unmount();
    const next = render(
      <SyncAssistantWelcome
        {...props}
        organizationId="org-b"
        fullName="Alex Smith"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play welcome" }));
    expect(start.mock.calls[1][0]).toContain("Alex");
    expect(start.mock.calls[1][0]).not.toContain("Orville");
    next.unmount();
    render(
      <SyncAssistantWelcome {...props} userId="user-b" fullName="Sam Jones" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play welcome" }));
    expect(start.mock.calls[2][0]).toContain("Sam");
    expect(start).toHaveBeenCalledTimes(3);
  });
  it("fails closed while flags, profile or sign-in are unavailable", () => {
    const view = render(<SyncAssistantWelcome {...props} enabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Play welcome" }));
    expect(start).not.toHaveBeenCalled();
    view.rerender(<SyncAssistantWelcome {...props} organizationId="" />);
    expect(screen.queryByRole("button", { name: "Play welcome" })).toBeNull();
    view.rerender(<SyncAssistantWelcome {...props} userId="" />);
    expect(screen.queryByRole("button", { name: "Play welcome" })).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });
  it("opens the same assistant and interrupts only welcome playback", () => {
    render(<SyncAssistantWelcome {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Talk with Sync" }));
    expect(stopWelcome).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    expect(props.onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByText("Meet Sync")).toBeNull();
  });
  it("does not start another welcome or stop an existing authorized chat/meeting session", () => {
    render(
      <SyncAssistantWelcome
        {...props}
        voice={{ ...voice, state: "live", welcomeOnly: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play welcome" }));
    fireEvent.click(screen.getByRole("button", { name: "Talk with Sync" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute welcome" }));
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(stopWelcome).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(/Live voice uses your microphone when unmuted/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/your microphone stays off/)).toBeNull();
  });
});
