/**
 * Sync Develop intake — the problem-first surface (D1.05). The service is
 * mocked (the RPC contract is proven live by ci-develop-slice1-smoke.sh);
 * these assertions pin product reachability and the problem-first shape:
 * the problem field leads, the server's refusal text is rendered verbatim,
 * and a successful create navigates to the case workspace.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevelopIntakePage } from "./DevelopIntakePage";

const createDevelopmentCase = vi.fn();
const listAdoptedFrameworks = vi.fn();

vi.mock("../services/developService", () => ({
  createDevelopmentCase: (input: unknown) => createDevelopmentCase(input),
  listAdoptedFrameworks: () => listAdoptedFrameworks(),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

let role = "planner";
vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <DevelopIntakePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  role = "planner";
  listAdoptedFrameworks.mockResolvedValue([
    {
      id: "fw-1",
      name: "Reference Heavy-Industry Stage Gate",
      version: 1,
      source_authority: "INDUSTRY_GUIDANCE",
      status: "adopted",
    },
  ]);
});

describe("DevelopIntakePage", () => {
  it("opens with the problem, not with a project name", async () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: /what problem are we solving\?/i }),
    ).toBeTruthy();
    // The problem statement field precedes the title field in the DOM.
    const problem = screen.getByLabelText(/problem \/ opportunity statement/i);
    const title = screen.getByLabelText(/case title/i);
    expect(
      problem.compareDocumentPosition(title) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByText(/Reference Heavy-Industry Stage Gate v1/),
      ).toBeTruthy(),
    );
  });

  it("shows the framework provenance tier, never an unlabeled authority", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/INDUSTRY_GUIDANCE/)).toBeTruthy(),
    );
  });

  it("renders the honest empty state when no framework is adopted", async () => {
    listAdoptedFrameworks.mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(/No adopted framework in this organization yet/),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/RPC-first this slice/)).toBeTruthy();
  });

  it("warns a role the server will refuse, without hiding the form", () => {
    role = "technician";
    renderPage();
    expect(
      screen.getByText(/the server will refuse the submission/i),
    ).toBeTruthy();
  });

  it("creates through the service and navigates to the workspace", async () => {
    createDevelopmentCase.mockResolvedValue({
      case_id: "case-9",
      current_stage_key: "need_identification",
    });
    renderPage();
    fireEvent.change(
      screen.getByLabelText(/problem \/ opportunity statement/i),
      {
        target: {
          value:
            "Crusher availability is 82% against a 92% plan; liner failures drive lost tonnes.",
        },
      },
    );
    fireEvent.change(screen.getByLabelText(/case title/i), {
      target: { value: "Crusher availability" },
    });
    fireEvent.change(screen.getByLabelText(/lifecycle type/i), {
      target: { value: "reliability_improvement" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create development case/i }),
    );
    await waitFor(() => expect(createDevelopmentCase).toHaveBeenCalled());
    expect(createDevelopmentCase.mock.calls[0][0]).toMatchObject({
      problemStatement: expect.stringContaining("Crusher availability is 82%"),
      lifecycleType: "reliability_improvement",
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/develop/cases/case-9"),
    );
  });

  it("renders the server's refusal verbatim", async () => {
    createDevelopmentCase.mockRejectedValue(
      new Error(
        "a development case begins with the problem, not the project: state the problem or opportunity being addressed (20 characters minimum)",
      ),
    );
    renderPage();
    fireEvent.change(
      screen.getByLabelText(/problem \/ opportunity statement/i),
      { target: { value: "This is a long enough statement for the client." } },
    );
    fireEvent.change(screen.getByLabelText(/case title/i), {
      target: { value: "T" },
    });
    fireEvent.change(screen.getByLabelText(/lifecycle type/i), {
      target: { value: "brownfield" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create development case/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/begins with the problem, not the project/),
      ).toBeTruthy(),
    );
  });
});
