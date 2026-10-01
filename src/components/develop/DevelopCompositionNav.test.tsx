import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  DEVELOP_ENGINES,
  DEVELOP_MODULES,
  developModuleHref,
} from "../../lib/develop/composition";
import { DevelopCompositionNav } from "./DevelopCompositionNav";

describe("DevelopCompositionNav", () => {
  it("makes every engine and module reachable for the current case", () => {
    render(
      <MemoryRouter>
        <DevelopCompositionNav caseId="case-42" />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("navigation", { name: "Sync Develop engines" }),
    ).toBeInTheDocument();
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    for (const engine of DEVELOP_ENGINES) {
      expect(hrefs).toContain(`#${engine.anchor}`);
    }
    for (const module of DEVELOP_MODULES) {
      expect(hrefs).toContain(developModuleHref(module, "case-42"));
    }
    expect(hrefs).toContain("/sync-field?case=case-42");
  });

  it("states the shared-model and human-authority boundaries on the surface", () => {
    render(
      <MemoryRouter>
        <DevelopCompositionNav caseId="case-42" />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/One shared canonical data model/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Navigation never grants approval authority/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/AI may explain, detect and prepare/),
    ).toBeInTheDocument();
  });
});
