/**
 * Reachability of propose_taxonomy_revision from Decision Governance.
 * A proposal is a draft; it does not replace adopted truth.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaxonomyGovernance } from "./TaxonomyGovernance";

const proposeTaxonomyRevision = vi.fn();
const from = vi.fn();
const rpc = vi.fn();
let role = "reliability_engineer";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

vi.mock("../services/reliabilityCallers", async () => {
  const actual = await vi.importActual<
    typeof import("../services/reliabilityCallers")
  >("../services/reliabilityCallers");
  return {
    ...actual,
    proposeTaxonomyRevision: (...args: unknown[]) =>
      proposeTaxonomyRevision(...args),
  };
});

function chain(result: unknown) {
  return {
    select: () => ({
      neq: () => ({
        order: () => Promise.resolve({ data: result, error: null }),
      }),
    }),
  };
}

beforeEach(() => {
  role = "reliability_engineer";
  vi.clearAllMocks();
  from.mockReturnValue(
    chain([
      {
        id: "t1",
        def_key: "failure",
        title: "What constitutes a failure",
        definition:
          "An event in which an asset loses the ability to perform a required function.",
        basis: "ISO 14224",
        register_ref: "C3.01",
        version: 1,
        status: "adopted",
      },
      {
        id: "t-draft",
        def_key: "repeat_failure",
        title: "Repeat failure",
        definition:
          "A failure of the same maintainable item with the same mode inside a defined window.",
        basis: "FRACAS recurrence",
        register_ref: "C3.06",
        version: 2,
        status: "draft",
      },
    ]),
  );
});

describe("TaxonomyGovernance proposal path", () => {
  it("hides propose for roles the database will refuse on adopt", async () => {
    role = "technician";
    render(<TaxonomyGovernance />);
    await screen.findByText("What constitutes a failure");
    expect(screen.queryByText("Propose revision")).not.toBeInTheDocument();
    expect(screen.getByTestId("taxonomy-honesty")).toHaveTextContent(
      /proposal is not adopted truth/i,
    );
  });

  it("lets ai_admin propose a draft and hides Adopt", async () => {
    role = "ai_admin";
    render(<TaxonomyGovernance />);
    await screen.findByText("What constitutes a failure");
    expect(screen.getAllByText("Propose revision").length).toBeGreaterThan(0);
    expect(screen.queryByText("Adopt")).not.toBeInTheDocument();
    expect(screen.getByTestId("taxonomy-honesty")).toHaveTextContent(
      /not offered Adopt/,
    );
  });

  it("proposes the next draft through proposeTaxonomyRevision", async () => {
    proposeTaxonomyRevision.mockResolvedValue({
      ok: true,
      id: "t2",
      version: 2,
    });
    render(<TaxonomyGovernance />);
    const proposeButtons = await screen.findAllByText("Propose revision");
    fireEvent.click(proposeButtons[0]);
    fireEvent.change(screen.getByLabelText("Proposed taxonomy definition"), {
      target: {
        value:
          "An event in which an asset loses a required function to the stated standard, recorded at the maintainable item.",
      },
    });
    fireEvent.change(screen.getByLabelText("Taxonomy revision basis"), {
      target: { value: "Revised against site boundary drawings." },
    });
    fireEvent.click(screen.getByText("Submit proposal"));
    await waitFor(() =>
      expect(proposeTaxonomyRevision).toHaveBeenCalledWith(
        "failure",
        "An event in which an asset loses a required function to the stated standard, recorded at the maintainable item.",
        "Revised against site boundary drawings.",
      ),
    );
    expect(
      await screen.findByText(/Adopted truth is unchanged/),
    ).toBeInTheDocument();
  });
});
