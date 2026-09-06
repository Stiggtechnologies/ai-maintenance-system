import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PresenceFace } from "./PresenceFace";
import { PRESENCE_PHASES } from "../lib/presence/state";

describe("PresenceFace", () => {
  it.each(PRESENCE_PHASES)(
    "renders the %s phase from conversation state",
    (phase) => {
      render(<PresenceFace phase={phase} />);
      const face = screen.getByTestId("presence-face");
      expect(face).toHaveAttribute("data-presence-phase", phase);
      expect(face).toHaveAttribute(
        "aria-label",
        expect.stringMatching(new RegExp(phase, "i")),
      );
      expect(face.className).toContain(`presence-face--${phase}`);
    },
  );

  it("does not claim plant execute or copy a circuit-board clone", () => {
    const { container } = render(<PresenceFace phase="idle" />);
    expect(container.innerHTML).not.toMatch(
      /circuit|jarvis|openclaw|authorize plant/i,
    );
  });
});
