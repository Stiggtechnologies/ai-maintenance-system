import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseMethodFederation } from "./EnterpriseMethodFederation";

const getFederation = vi.fn();
const authorMethod = vi.fn();
const adoptMethod = vi.fn();
const authorStrategy = vi.fn();
const adoptStrategy = vi.fn();
const listSites = vi.fn();

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "reliability_engineer" } }),
}));

vi.mock("../services/reliabilityCallers", () => ({
  listSites: () => listSites(),
}));

vi.mock("../services/enterpriseMethodFederation", async () => {
  const actual = await vi.importActual<
    typeof import("../services/enterpriseMethodFederation")
  >("../services/enterpriseMethodFederation");
  return {
    ...actual,
    getEnterpriseMethodFederation: () => getFederation(),
    authorEnterpriseMethod: (...args: unknown[]) => authorMethod(...args),
    adoptEnterpriseMethod: (...args: unknown[]) => adoptMethod(...args),
    authorSiteStrategy: (...args: unknown[]) => authorStrategy(...args),
    adoptSiteStrategy: (...args: unknown[]) => adoptStrategy(...args),
  };
});

const payload = {
  methods: [
    {
      id: "standard-1",
      standard_key: "failure_elimination",
      title: "Failure elimination method",
      method: "Use coded recurrence and verified corrective-action outcomes.",
      applicability: "Critical rotating equipment with coded history.",
      mandatory: true,
      owner_role: "reliability_engineer",
      variance_approver_role: "reliability_engineer",
      basis: "Approved reliability procedure and field review record.",
      status: "adopted",
      version: 1,
      adoption_note: "Reviewed by enterprise reliability authority.",
    },
  ],
  effective_site_methods: [
    {
      standard_id: "standard-1",
      standard_key: "failure_elimination",
      standard_title: "Failure elimination method",
      site_id: "site-1",
      site: "North Plant",
      resolution: "enterprise_standard",
      strategy_id: null,
      strategy_title: null,
      local_context: null,
      implementation_method:
        "Use coded recurrence and verified corrective-action outcomes.",
      job_plan_id: null,
      job_plan: null,
      conformance: "inherited",
      evidence_basis: "Approved reliability procedure and field review record.",
      variance_id: null,
      variance_status: null,
      variance_expires_at: null,
      authority:
        "method resolution only; no work, operating limit, approval or execution state changed",
    },
  ],
  available_variances: [
    {
      id: "variance-1",
      standard_id: "standard-1",
      site_id: "site-1",
      status: "approved",
      expires_at: "2027-06-01T00:00:00Z",
      justification: "Local shutdown cycle requires a different sequence.",
      compensating_controls: "Independent review and weekly condition route.",
    },
  ],
  site_strategy_drafts: [
    {
      id: "strategy-draft-1",
      standard_id: "standard-1",
      standard_title: "Failure elimination method",
      site_id: "site-1",
      site: "North Plant",
      strategy_key: "north_failure_elimination",
      title: "North Plant implementation",
      conformance: "aligned",
      variance_id: null,
      version: 1,
      evidence_basis: "Reviewed local work history and shutdown constraints.",
    },
  ],
  blocked_site_strategies: [],
  controls: {
    inheritance: "enterprise inheritance",
    variance: "approved variance",
    execution: "no execution mutation",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getFederation.mockResolvedValue(payload);
  listSites.mockResolvedValue([{ id: "site-1", name: "North Plant" }]);
  authorMethod.mockResolvedValue({ standard_id: "draft-2", status: "draft" });
  authorStrategy.mockResolvedValue({
    strategy_id: "strategy-2",
    status: "draft",
  });
  adoptStrategy.mockResolvedValue({
    strategy_id: "strategy-draft-1",
    status: "adopted",
  });
});

describe("EnterpriseMethodFederation", () => {
  it("shows honest enterprise inheritance and execution authority", async () => {
    render(<EnterpriseMethodFederation />);
    expect(
      await screen.findAllByText("Failure elimination method"),
    ).not.toHaveLength(0);
    expect(screen.getAllByText("North Plant")).not.toHaveLength(0);
    expect(screen.getByText("Inherited standard")).toBeInTheDocument();
    expect(screen.getByTestId("federation-authority")).toHaveTextContent(
      /not permission to execute/i,
    );
  });

  it("authors an evidence-backed enterprise method as draft", async () => {
    render(<EnterpriseMethodFederation />);
    await screen.findAllByText("Failure elimination method");
    fireEvent.change(screen.getByLabelText("Method key"), {
      target: { value: "bearing_strategy" },
    });
    fireEvent.change(screen.getByLabelText("Method title"), {
      target: { value: "Bearing strategy method" },
    });
    fireEvent.change(screen.getByLabelText("Enterprise method"), {
      target: {
        value:
          "Evaluate coded bearing mechanisms before selecting a maintenance task.",
      },
    });
    fireEvent.change(screen.getByLabelText("Method applicability"), {
      target: { value: "Rotating equipment with validated failure coding." },
    });
    fireEvent.change(screen.getByLabelText("Method evidence basis"), {
      target: {
        value: "Enterprise reliability procedure approved after field review.",
      },
    });
    fireEvent.click(screen.getByText("Save method draft"));
    await waitFor(() =>
      expect(authorMethod).toHaveBeenCalledWith(
        expect.objectContaining({
          standardKey: "bearing_strategy",
          mandatory: true,
        }),
      ),
    );
    expect(await screen.findByText(/saved as draft/i)).toBeInTheDocument();
  });

  it("makes versioning the existing canonical method customer reachable", async () => {
    render(<EnterpriseMethodFederation />);
    await screen.findAllByText("Failure elimination method");
    fireEvent.click(screen.getByText("Create next version"));
    expect(
      screen.getByText("Author the next enterprise-method version"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Method key")).toHaveValue(
      "failure_elimination",
    );
  });

  it("requires an approved matching variance for a non-conforming site strategy and exposes human adoption", async () => {
    render(<EnterpriseMethodFederation />);
    await screen.findAllByText("Failure elimination method");
    fireEvent.change(screen.getByLabelText("Strategy enterprise method"), {
      target: { value: "standard-1" },
    });
    fireEvent.change(screen.getByLabelText("Strategy site"), {
      target: { value: "site-1" },
    });
    fireEvent.change(screen.getByLabelText("Strategy key"), {
      target: { value: "north_method" },
    });
    fireEvent.change(screen.getByLabelText("Strategy title"), {
      target: { value: "North method" },
    });
    fireEvent.change(screen.getByLabelText("Site local context"), {
      target: {
        value: "Cold-weather operation and a fixed quarterly shutdown cycle.",
      },
    });
    fireEvent.change(screen.getByLabelText("Site implementation method"), {
      target: {
        value:
          "Use weekly screening and align intrusive work with the quarterly outage.",
      },
    });
    fireEvent.change(screen.getByLabelText("Site strategy evidence basis"), {
      target: {
        value:
          "Two years of coded work history and the approved shutdown plan.",
      },
    });
    fireEvent.change(screen.getByLabelText("Strategy conformance"), {
      target: { value: "variance" },
    });
    expect(screen.getByText("Save site strategy draft")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Covering approved variance"), {
      target: { value: "variance-1" },
    });
    fireEvent.click(screen.getByText("Save site strategy draft"));
    await waitFor(() =>
      expect(authorStrategy).toHaveBeenCalledWith(
        expect.objectContaining({
          conformance: "variance",
          varianceId: "variance-1",
        }),
      ),
    );

    await screen.findByText(/Site strategy saved as draft/i);

    fireEvent.click(screen.getByText("Review for adoption"));
    fireEvent.change(screen.getByLabelText("Adoption review basis"), {
      target: {
        value:
          "Site reliability review completed against evidence and controls.",
      },
    });
    fireEvent.click(screen.getByText("Adopt"));
    await waitFor(() =>
      expect(adoptStrategy).toHaveBeenCalledWith(
        "strategy-draft-1",
        "Site reliability review completed against evidence and controls.",
      ),
    );
  });

  it("shows an adopted local strategy that lost variance authority", async () => {
    getFederation.mockResolvedValue({
      ...payload,
      blocked_site_strategies: [
        {
          id: "blocked-1",
          standard_id: "standard-1",
          standard_title: "Failure elimination method",
          site_id: "site-1",
          site: "North Plant",
          title: "Temporary local sequence",
          reason:
            "covering variance is no longer approved and unexpired; enterprise method applies",
          variance_id: "variance-1",
          variance_status: "expired",
          variance_expires_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    render(<EnterpriseMethodFederation />);
    expect(
      await screen.findByText("Local strategies no longer in force"),
    ).toBeInTheDocument();
    expect(screen.getByText(/enterprise method applies/i)).toBeInTheDocument();
  });
});
