import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BOLT_SPACES_LIVE_PATH } from "../../lib/public-ask-tie-in";
import { BoltSpacesPanel } from "./BoltSpacesPanel";

describe("BoltSpacesPanel", () => {
  it("lists existing threads and links to Decision Workspace, not /spaces", () => {
    const onChoose = vi.fn();
    const onNewAsk = vi.fn();
    render(
      <BoltSpacesPanel
        cases={[{ id: "ws-1", title: "Lube verification", asset: "CR-01" }]}
        activeId="ws-1"
        onNewAsk={onNewAsk}
        onChoose={onChoose}
      />,
    );
    expect(screen.getByLabelText("Space list")).toBeTruthy();
    expect(screen.getByText("Lube verification")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Decision Workspace" }),
    ).toHaveAttribute("href", BOLT_SPACES_LIVE_PATH);
    expect(
      screen
        .queryByRole("link", { name: "Decision Workspace" })
        ?.getAttribute("href"),
    ).not.toBe("/spaces");
    fireEvent.click(screen.getByRole("button", { name: /New ask/ }));
    expect(onNewAsk).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Lube verification"));
    expect(onChoose).toHaveBeenCalledWith("ws-1");
    expect(screen.queryByText(/browser draft/i)).toBeNull();
    expect(screen.queryByText(/Import or discard/i)).toBeNull();
  });
});
