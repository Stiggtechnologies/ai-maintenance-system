import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoltSpacesPanel } from "./BoltSpacesPanel";

describe("BoltSpacesPanel", () => {
  it("lists cowork threads and starts a new ask on /workspace, not Develop", () => {
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
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/Decision Workspace/i)).toBeNull();
    expect(screen.queryByText(/develop/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /New ask/ }));
    expect(onNewAsk).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Lube verification"));
    expect(onChoose).toHaveBeenCalledWith("ws-1");
    expect(screen.queryByText(/browser draft/i)).toBeNull();
    expect(screen.queryByText(/Import or discard/i)).toBeNull();
  });
});
