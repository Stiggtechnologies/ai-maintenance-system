import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicProductHeader } from "./PublicProductHeader";

describe("PublicProductHeader", () => {
  it("puts the transparent wordmark in the header slot instead of a pulse icon and plain text", () => {
    render(<PublicProductHeader active="copilot" />);
    const mark = screen.getByRole("img", { name: "SyncAI" });
    expect(mark).toHaveAttribute("src", "/brand/wordmark-ink.png");
    expect(mark.className).toMatch(/\bh-9\b/);
    expect(screen.queryByText("SyncAI", { selector: "span" })).toBeNull();
    expect(
      screen.getByText(
        "Reliability Engineer · governed industrial intelligence",
      ),
    ).toBeTruthy();
  });

  it("shows Sign in by default and hides it when showSignIn is false", () => {
    const { rerender } = render(<PublicProductHeader active="copilot" />);
    expect(screen.getByLabelText("Sign in")).toBeTruthy();

    rerender(<PublicProductHeader active="copilot" showSignIn={false} />);
    expect(screen.queryByLabelText("Sign in")).toBeNull();
  });
});
