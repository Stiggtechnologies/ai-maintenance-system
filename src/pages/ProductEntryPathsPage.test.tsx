import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProductEntryPathsPage } from "./ProductEntryPathsPage";

describe("customer-facing solution paths", () => {
  it("explains the evidence and human decision journey without experiment labels", () => {
    render(
      <MemoryRouter>
        <ProductEntryPathsPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Bring the available asset and maintenance evidence/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Accountable people approve consequential actions/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /Test first|Contrast test|Portfolio test|research hypothesis|messages deserve more investment/,
    );
    expect(screen.getAllByText("Governed decision support")).toHaveLength(10);
  });
});
