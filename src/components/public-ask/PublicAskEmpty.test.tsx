import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublicAskEmpty } from "./PublicAskEmpty";

describe("PublicAskEmpty", () => {
  it("renders the Bolt wordmark, ask slot, and five intent pills in order", () => {
    const onSelectIntent = vi.fn();
    render(
      <PublicAskEmpty
        askBar={<div>ask-slot</div>}
        onSelectIntent={onSelectIntent}
      />,
    );
    expect(screen.getByRole("heading", { name: "SyncAI" })).toBeTruthy();
    expect(screen.getByText("pro")).toBeTruthy();
    expect(screen.getByText("ask-slot")).toBeTruthy();
    expect(
      screen.getAllByTestId("ask-intent-pill").map((item) => item.textContent),
    ).toEqual(["Compare", "Troubleshoot", "Health", "Learn", "Fact Check"]);
    fireEvent.click(screen.getByRole("button", { name: "Health" }));
    expect(onSelectIntent).toHaveBeenCalledWith(1);
  });
});
