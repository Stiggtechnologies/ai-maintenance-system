/**
 * Reachability from the /job-plans surface: a reliability engineer can
 * author (upsert_job_plan), adopt (adopt_job_plan) and apply
 * (apply_job_plan). Drafts are not offered for apply. Refusals surface
 * in the database's own words. AI is not presented as an authorizer.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobPlans } from "./JobPlans";

const listJobPlans = vi.fn();
const getPlanningAccuracy = vi.fn();
const listMaterials = vi.fn();
const listOpenWorkOrders = vi.fn();
const getJobPlanDetail = vi.fn();
const upsertJobPlan = vi.fn();
const adoptJobPlan = vi.fn();
const applyJobPlan = vi.fn();

let role = "reliability_engineer";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

vi.mock("../services/jobPlanService", async () => {
  const actual = await vi.importActual<typeof import("../services/jobPlanService")>(
    "../services/jobPlanService",
  );
  return {
    ...actual,
    listJobPlans: () => listJobPlans(),
    getPlanningAccuracy: () => getPlanningAccuracy(),
    listMaterials: () => listMaterials(),
    listOpenWorkOrders: () => listOpenWorkOrders(),
    getJobPlanDetail: (...args: unknown[]) => getJobPlanDetail(...args),
    upsertJobPlan: (...args: unknown[]) => upsertJobPlan(...args),
    adoptJobPlan: (...args: unknown[]) => adoptJobPlan(...args),
    applyJobPlan: (...args: unknown[]) => applyJobPlan(...args),
  };
});

const DRAFT_PLAN = {
  id: "p-draft",
  plan_key: "JP-DRAFT",
  title: "Draft seal plan",
  scope: "Draft only",
  applies_to: "Pumps",
  status: "draft" as const,
  version: 1,
  steps: 1,
  estimated_hours: 2,
  materials: 0,
  tools: 0,
  permits: 0,
  checks: 1,
  applied_to_work_orders: 0,
};

const ADOPTED_PLAN = {
  ...DRAFT_PLAN,
  id: "p-adopted",
  plan_key: "JP-SEAL",
  title: "Replace pump seal",
  status: "adopted" as const,
};

const ACCURACY = {
  available: false,
  sample: 0,
  mean_absolute_error_pct: null,
  bias_pct: null,
  within_10_pct: null,
  bias_reading: null,
  basis:
    "No completed work order yet carries both planned hours from a job plan and recorded actuals.",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <JobPlans />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  role = "reliability_engineer";
  vi.clearAllMocks();
  listJobPlans.mockResolvedValue({
    plans: [],
    note: "A plan cannot be adopted without at least one step and at least one acceptance criterion.",
  });
  getPlanningAccuracy.mockResolvedValue(ACCURACY);
  listMaterials.mockResolvedValue([
    {
      id: "m1",
      material_code: "SEAL-25",
      description: "Mechanical seal 25mm",
      unit_of_measure: "each",
    },
  ]);
  listOpenWorkOrders.mockResolvedValue([
    {
      id: "wo1",
      wo_number: "WO-100",
      title: "Pump leak",
      status: "in_progress",
      job_plan_id: null,
    },
  ]);
});

describe("JobPlans authoring surface", () => {
  it("shows an honest empty state and does not invent a library", async () => {
    renderPage();
    expect(
      await screen.findByText(/No job plan has been authored/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("job-plan-honesty")).toHaveTextContent(
      /AI does not recommend or authorize/,
    );
  });

  it("hides authoring for roles the database will refuse", async () => {
    role = "technician";
    renderPage();
    await screen.findByText(/No job plan has been authored/);
    expect(screen.queryByText("Author a plan")).not.toBeInTheDocument();
    expect(
      screen.getByText(/require a planner, reliability engineer/),
    ).toBeInTheDocument();
  });

  it("saves a draft through upsertJobPlan", async () => {
    upsertJobPlan.mockResolvedValue({
      job_plan_id: "p-new",
      plan_key: "JP-SEAL",
      steps: 1,
      status: "draft",
      droppedMaterialCodes: [],
    });
    renderPage();
    fireEvent.click(await screen.findByText("Author a plan"));
    fireEvent.change(screen.getByLabelText("Plan key"), {
      target: { value: "JP-SEAL" },
    });
    fireEvent.change(screen.getByLabelText("Plan title"), {
      target: { value: "Replace pump seal" },
    });
    fireEvent.change(screen.getByLabelText("Plan scope"), {
      target: { value: "Mechanical seal replacement." },
    });
    fireEvent.change(screen.getByLabelText("Step 1 description"), {
      target: { value: "Isolate and drain" },
    });
    fireEvent.change(screen.getByLabelText("Check 1 description"), {
      target: { value: "Leak check" },
    });
    fireEvent.change(screen.getByLabelText("Check 1 acceptance criterion"), {
      target: { value: "Zero visible leakage for 10 minutes" },
    });
    fireEvent.click(screen.getByText("Save draft"));
    await waitFor(() => expect(upsertJobPlan).toHaveBeenCalled());
    const [draft] = upsertJobPlan.mock.calls[0];
    expect(draft.plan_key).toBe("JP-SEAL");
    expect(draft.title).toBe("Replace pump seal");
    expect(await screen.findByText(/Draft saved/)).toBeInTheDocument();
  });

  it("adopts a draft through adoptJobPlan and refuses a short note", async () => {
    listJobPlans.mockResolvedValue({
      plans: [DRAFT_PLAN],
      note: "Adoption requires a criterion.",
    });
    adoptJobPlan.mockResolvedValue({ adopted: "p-draft", steps: 1, checks: 1 });
    renderPage();
    fireEvent.click(await screen.findByText("Adopt"));
    expect(screen.getByText("Adopt plan")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Adoption basis"), {
      target: { value: "short" },
    });
    expect(screen.getByText("Adopt plan")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Adoption basis"), {
      target: {
        value: "Site isolation points 1–3 verified against the overlay.",
      },
    });
    fireEvent.click(screen.getByText("Adopt plan"));
    await waitFor(() =>
      expect(adoptJobPlan).toHaveBeenCalledWith(
        "p-draft",
        "Site isolation points 1–3 verified against the overlay.",
      ),
    );
    expect(await screen.findByText(/Adopted/)).toBeInTheDocument();
  });

  it("applies an adopted plan through applyJobPlan and does not offer Apply on a draft", async () => {
    listJobPlans.mockResolvedValue({
      plans: [DRAFT_PLAN, ADOPTED_PLAN],
      note: "Only adopted plans apply.",
    });
    applyJobPlan.mockResolvedValue({
      work_order_id: "wo1",
      plan: "JP-SEAL",
      tasks_created: 2,
      planned_hours: 4,
      materials_requested: 1,
      permits_required: 1,
      safety_flagged: true,
    });
    renderPage();
    expect(await screen.findByText("Replace pump seal")).toBeInTheDocument();
    const applyButtons = screen.getAllByText("Apply");
    expect(applyButtons).toHaveLength(1);
    fireEvent.click(applyButtons[0]);
    fireEvent.change(screen.getByLabelText("Work order to apply plan"), {
      target: { value: "wo1" },
    });
    fireEvent.click(screen.getByText("Apply to work order"));
    await waitFor(() =>
      expect(applyJobPlan).toHaveBeenCalledWith("wo1", "JP-SEAL"),
    );
    expect(await screen.findByText(/safety-flagged/)).toBeInTheDocument();
  });

  it("surfaces the database's own refusal sentence", async () => {
    listJobPlans.mockResolvedValue({
      plans: [DRAFT_PLAN],
      note: "Adoption requires a criterion.",
    });
    adoptJobPlan.mockRejectedValue(
      new Error(
        "a plan whose completion cannot be verified is not executable — add at least one quality check with an acceptance criterion",
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByText("Adopt"));
    fireEvent.change(screen.getByLabelText("Adoption basis"), {
      target: { value: "We need this on the weekly schedule." },
    });
    fireEvent.click(screen.getByText("Adopt plan"));
    expect(
      await screen.findByText(/completion cannot be verified/),
    ).toBeInTheDocument();
  });
});
