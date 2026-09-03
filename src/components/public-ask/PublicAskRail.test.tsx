import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublicAskRail } from "./PublicAskRail";

describe("PublicAskRail", () => {
  it("exposes only real destinations and treats Home as new ask", () => {
    const onHome = vi.fn();
    render(<PublicAskRail homeActive onHome={onHome} />);
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Assess" })).toHaveAttribute(
      "href",
      "/setup",
    );
    expect(screen.getByLabelText("Sign in")).toHaveAttribute(
      "href",
      "/signin?returnTo=%2F",
    );
    expect(screen.getByTestId("bolt-rail-compass")).toBeTruthy();
    expect(screen.queryByText("Discover")).toBeNull();
    expect(screen.queryByText("Spaces")).toBeNull();
    expect(screen.queryByText("Install")).toBeNull();
    fireEvent.click(screen.getByLabelText("New ask"));
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});
