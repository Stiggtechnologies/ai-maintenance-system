import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const listDevelopmentCases = vi.fn();

vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "operator" } }),
}));
vi.mock("../services/developService", () => ({
  listDevelopmentCases: () => listDevelopmentCases(),
}));
vi.mock("../components/develop/SystemHandoverPanel", () => ({
  SystemHandoverPanel: ({ caseId, role }: { caseId: string; role: string }) => (
    <div data-testid="canonical-system-handover">
      {caseId}:{role}
    </div>
  ),
}));

import { SystemHandoverPage } from "./SystemHandoverPage";

describe("D13.11 System Handover screen", () => {
  it("mounts the canonical per-system module for an RLS-visible case", async () => {
    listDevelopmentCases.mockResolvedValue([
      { id: "case-1", title: "North plant expansion" },
      { id: "case-2", title: "Utilities renewal" },
    ]);

    render(
      <MemoryRouter initialEntries={["/develop/handover?case=case-2"]}>
        <SystemHandoverPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("System handover", { selector: "h1" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("canonical-system-handover")).toHaveTextContent(
      "case-2:operator",
    );
    expect(screen.getByLabelText("Development case")).toHaveValue("case-2");
    expect(screen.getByText(/only the named receiving owner/i)).toBeInTheDocument();
    expect(screen.getByText(/does not replace the separate equipment/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Sync Transition" }),
    ).toHaveAttribute("href", "/develop/cases/case-2/transition");
  });

  it("does not mount a guessed case id and falls back to a visible case", async () => {
    listDevelopmentCases.mockResolvedValue([
      { id: "visible-case", title: "Visible case" },
    ]);

    render(
      <MemoryRouter initialEntries={["/develop/handover?case=guessed-case"]}>
        <SystemHandoverPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("canonical-system-handover")).toHaveTextContent(
        "visible-case:operator",
      ),
    );
    expect(screen.queryByText(/guessed-case/)).not.toBeInTheDocument();
  });

  it("names the tenant-scoped empty state without mounting the module", async () => {
    listDevelopmentCases.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/develop/handover"]}>
        <SystemHandoverPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/No development cases are visible/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("canonical-system-handover"),
    ).not.toBeInTheDocument();
  });
});
