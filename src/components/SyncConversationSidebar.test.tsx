import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SyncConversationSidebar } from "./SyncConversationSidebar";

const conversation = {
  id: "conversation-1",
  title: "Commissioning check",
  mode: "conversation" as const,
  status: "active",
  updatedAt: "2026-08-22T12:00:00.000Z",
  lastTurnAt: "2026-08-22T12:00:00.000Z",
};

function renderSidebar(onRename = vi.fn()) {
  render(
    <SyncConversationSidebar
      conversations={[conversation]}
      activeId={conversation.id}
      onNew={vi.fn()}
      onSelect={vi.fn()}
      onRename={onRename}
      onArchive={vi.fn()}
      onRestore={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  return onRename;
}

describe("SyncConversationSidebar", () => {
  it("renames a conversation with an inline form", () => {
    const onRename = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", {
      name: "Rename conversation Commissioning check",
    });
    expect(input).toHaveValue("Commissioning check");

    fireEvent.change(input, { target: { value: "  Production acceptance  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onRename).toHaveBeenCalledWith("conversation-1", "Production acceptance");
    expect(
      screen.queryByRole("textbox", {
        name: "Rename conversation Commissioning check",
      }),
    ).not.toBeInTheDocument();
  });

  it("cancels an inline rename without changing the conversation", () => {
    const onRename = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.keyDown(
      screen.getByRole("textbox", {
        name: "Rename conversation Commissioning check",
      }),
      { key: "Escape" },
    );

    expect(onRename).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", {
        name: "Rename conversation Commissioning check",
      }),
    ).not.toBeInTheDocument();
  });
});
