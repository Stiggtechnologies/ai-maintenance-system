import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LearnUnpersistedPointer } from "./LearnUnpersistedPointer";

describe("LearnUnpersistedPointer", () => {
  it("does not claim a recorded verification", () => {
    render(
      <MemoryRouter>
        <LearnUnpersistedPointer />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("learn-unpersisted")).toBeTruthy();
    expect(screen.getByText(/nothing was written/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Learning Loop" })).toHaveAttribute(
      "href",
      "/learning-loop",
    );
    expect(screen.queryByText(/Outcome recorded/i)).toBeNull();
    expect(screen.queryByText(/retained/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Record outcome/i }),
    ).toBeNull();
  });
});
