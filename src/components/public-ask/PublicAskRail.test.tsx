import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublicAskRail } from "./PublicAskRail";

describe("PublicAskRail", () => {
  it("exposes only real destinations and treats Home as new ask", () => {
    const onHome = vi.fn();
    render(<PublicAskRail homeActive onNewAsk={onHome} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Assess" })).toHaveAttribute(
      "href",
      "/setup",
    );
    expect(screen.getByLabelText("Sign in")).toHaveAttribute(
      "href",
      "/signin?returnTo=%2F",
    );
    expect(screen.queryByTestId("bolt-rail-compass")).toBeNull();
    expect(screen.queryByText("Discover")).toBeNull();
    expect(screen.queryByText("Spaces")).toBeNull();
    expect(screen.queryByText("Install")).toBeNull();
    fireEvent.click(screen.getByLabelText("New ask"));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("puts cowork in the Spaces rail slot when a real destination exists", () => {
    const onOpen = vi.fn();
    render(
      <PublicAskRail
        homeActive
        onNewAsk={vi.fn()}
        spaces={{ active: false, onOpen }}
      />,
    );
    expect(screen.getByTestId("bolt-rail-spaces")).toHaveTextContent("Spaces");
    expect(screen.queryByLabelText("Sign in")).toBeNull();
    expect(screen.queryByText("Discover")).toBeNull();
    fireEvent.click(screen.getByLabelText("Spaces"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
