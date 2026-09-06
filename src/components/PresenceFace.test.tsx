import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PresenceFace } from "./PresenceFace";

describe("PresenceFace", () => {
  it("exposes the real presence phase for idle, listen, think, and speak", () => {
    const { rerender } = render(<PresenceFace phase="idle" />);
    expect(screen.getByTestId("presence-face")).toHaveAttribute(
      "data-presence-phase",
      "idle",
    );
    expect(screen.getByLabelText("Sync presence: Ready")).toBeInTheDocument();

    rerender(<PresenceFace phase="listening" />);
    expect(screen.getByTestId("presence-face")).toHaveAttribute(
      "data-presence-phase",
      "listening",
    );
    rerender(<PresenceFace phase="thinking" />);
    expect(screen.getByTestId("presence-face")).toHaveAttribute(
      "data-presence-phase",
      "thinking",
    );
    rerender(<PresenceFace phase="speaking" />);
    expect(screen.getByTestId("presence-face")).toHaveAttribute(
      "data-presence-phase",
      "speaking",
    );
    expect(
      screen.getByLabelText("Sync presence: Speaking"),
    ).toBeInTheDocument();
  });
});
