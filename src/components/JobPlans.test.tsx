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
const listJobPlanDocuments = vi.fn();
const listOpenWorkOrders = vi.fn();
const getJobPlanDetail = vi.fn();
const upsertJobPlan = vi.fn();
const adoptJobPlan = vi.fn();
const applyJobPlan = vi.fn();
const runPlanningAgent = vi.fn();

let role = "reliability_engineer";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

vi.mock("../services/jobPlanService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/jobPlanService")
  >("../services/jobPlanService");
  return {
    ...actual,
    listJobPlans: () => listJobPlans(),
    getPlanningAccuracy: () => getPlanningAccuracy(),
    listMaterials: () => listMaterials(),
    listJobPlanDocuments: () => listJobPlanDocuments(),
    listOpenWorkOrders: () => listOpenWorkOrders(),
    getJobPlanDetail: (...args: unknown[]) => getJobPlanDetail(...args),
    upsertJobPlan: (...args: unknown[]) => upsertJobPlan(...args),
    adoptJobPlan: (...args: unknown[]) => adoptJobPlan(...args),
    applyJobPlan: (...args: unknown[]) => applyJobPlan(...args),
    runPlanningAgent: (...args: unknown[]) => runPlanningAgent(...args),
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
  documents: 0,
  checks: 1,
  applied_to_work_orders: 0,
  draft_origin: "human" as const,
  agent_run_id: null,
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
  listJobPlanDocuments.mockResolvedValue([]);
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
  it("runs the governed Planning agent, shows its gaps, and opens its draft for human review", async () => {
    runPlanningAgent.mockResolvedValue({
      run_id: "run-12345678",
      agent_id: "agent-1",
      agent_key: "planning_scheduling",
      work_order_id: "wo1",
      job_plan_id: "p-agent",
      draft_created: true,
      draft_origin: "agent",
      reference_plan_id: null,
      gaps: [
        {
          code: "acceptance",
          severity: "blocker",
          label: "Acceptance criteria",
          detail: "No measurable acceptance criterion exists.",
        },
      ],
      materials: [],
      human_approval_required: true,
      required_human_approver_role: "maintenance_manager",
      may_adopt: false,
      may_apply: false,
      may_release_schedule: false,
      basis: "Deterministic reading of canonical tenant work context.",
    });
    getJobPlanDetail.mockResolvedValue({
      id: "p-agent",
      plan_key: "AGENT-WO-WO-100",
      title: "Draft plan — WO-100 — Pump leak",
      scope: "Planning boundary from work order WO-100: Pump leak",
      applies_to_asset_class: "pump",
      applies_to_system_group: "process water",
      basis: "Recorded work context only.",
      status: "draft",
      version: 1,
      steps: [],
      materials: [],
      tools: [],
      permits: [],
      documents: [],
      checks: [],
    });

    renderPage();
    fireEvent.change(
      await screen.findByLabelText("Work order for Planning agent"),
      {
        target: { value: "wo1" },
      },
    );
    fireEvent.click(screen.getByText("Run Planning agent"));

    await waitFor(() => expect(runPlanningAgent).toHaveBeenCalledWith("wo1"));
    expect(
      await screen.findByTestId("planning-agent-reading"),
    ).toHaveTextContent("Acceptance criteria");
    expect(screen.getByTestId("planning-agent-reading")).toHaveTextContent(
      "Human adoption required",
    );
    expect(await screen.findByLabelText("Plan title")).toHaveValue(
      "Draft plan — WO-100 — Pump leak",
    );
    expect(adoptJobPlan).not.toHaveBeenCalled();
    expect(applyJobPlan).not.toHaveBeenCalled();
  });

  it("shows an honest empty state and does not invent a library", async () => {
    renderPage();
    expect(
      await screen.findByText(/No job plan has been authored/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("job-plan-honesty")).toHaveTextContent(
      /cannot adopt, apply, release, spend, or return equipment to service/,
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

  it("links an indexed tenant document into the canonical draft", async () => {
    listJobPlanDocuments.mockResolvedValue([
      {
        id: "doc-1",
        title: "Pump isolation procedure",
        document_class: "procedure",
        document_type: "work_instruction",
      },
    ]);
    upsertJobPlan.mockResolvedValue({
      job_plan_id: "p-new",
      plan_key: "JP-DOC",
      steps: 0,
      status: "draft",
    });

    renderPage();
    fireEvent.click(await screen.findByText("Author a plan"));
    fireEvent.change(screen.getByLabelText("Plan key"), {
      target: { value: "JP-DOC" },
    });
    fireEvent.change(screen.getByLabelText("Plan title"), {
      target: { value: "Documented pump work" },
    });
    fireEvent.change(screen.getByLabelText("Plan scope"), {
      target: { value: "Controlled work boundary for the pump." },
    });
    fireEvent.click(await screen.findByText("Link document"));
    fireEvent.change(screen.getByLabelText("Document 1"), {
      target: { value: "doc-1" },
    });
    fireEvent.change(screen.getByLabelText("Document 1 purpose"), {
      target: { value: "Controls isolation sequence" },
    });
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(upsertJobPlan).toHaveBeenCalled());
    expect(upsertJobPlan.mock.calls[0][0].documents).toEqual([
      {
        document_id: "doc-1",
        title: "Pump isolation procedure",
        purpose: "Controls isolation sequence",
      },
    ]);
  });

  it("shows an unresolved code on the editor when a saved line is no longer in the catalogue", async () => {
    listJobPlans.mockResolvedValue({
      plans: [DRAFT_PLAN],
      note: "Adoption requires a criterion.",
    });
    getJobPlanDetail.mockResolvedValue({
      id: "p-draft",
      plan_key: "JP-DRAFT",
      title: "Draft seal plan",
      scope: "Draft only",
      applies_to_asset_class: "",
      applies_to_system_group: "",
      basis: "",
      status: "draft",
      version: 1,
      steps: [
        {
          step_number: 1,
          description: "Isolate",
          craft: "",
          crew_size: 1,
          estimated_hours: 1,
        },
      ],
      materials: [
        { material_code: "NO-SUCH", description: "Invented", qty: 1 },
      ],
      tools: [],
      permits: [],
      checks: [
        {
          check_description: "Leak check",
          acceptance_criterion: "Zero visible leakage",
          is_hold_point: false,
        },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByText("Edit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /nothing was saved: NO-SUCH/,
    );
    expect(screen.queryByText(/Draft saved/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Material 1 code")).toHaveValue("NO-SUCH");
  });

  it("shows an unresolved-material refusal and does not claim the draft was saved", async () => {
    upsertJobPlan.mockRejectedValue(
      new Error(
        "unresolved material code(s) refused; nothing was saved: NO-SUCH. Add each code to the material catalogue first. This call does not create catalogue rows.",
      ),
    );
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
    fireEvent.click(screen.getByText("Save draft"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/nothing was saved: NO-SUCH/);
    expect(screen.queryByText(/Draft saved/)).not.toBeInTheDocument();
    expect(screen.getByText("Save draft")).toBeInTheDocument();
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
      schedule_approval_required: true,
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
    expect(await screen.findByText(/parked in approval/)).toBeInTheDocument();
  });

  it("revises an adopted plan through upsert_job_plan as a new draft version", async () => {
    listJobPlans.mockResolvedValue({
      plans: [ADOPTED_PLAN],
      note: "Only adopted plans apply.",
    });
    getJobPlanDetail.mockResolvedValue({
      id: "p-adopted",
      plan_key: "JP-SEAL",
      title: "Replace pump seal",
      scope: "Seal replacement.",
      applies_to_asset_class: "pump",
      applies_to_system_group: "",
      basis: "Adopted: site review complete.",
      status: "adopted",
      version: 1,
      steps: [
        {
          step_number: 1,
          description: "Isolate and drain",
          craft: "fitter",
          crew_size: 1,
          estimated_hours: 2,
        },
      ],
      materials: [
        {
          material_code: "SEAL-25",
          description: "Mechanical seal 25mm",
          qty: 1,
        },
      ],
      tools: [],
      permits: [],
      checks: [
        {
          check_description: "Leak check",
          acceptance_criterion: "Zero visible leakage",
          is_hold_point: false,
        },
      ],
    });
    upsertJobPlan.mockResolvedValue({
      job_plan_id: "p-v2",
      plan_key: "JP-SEAL",
      version: 2,
      steps: 1,
      status: "draft",
    });
    renderPage();
    fireEvent.click(await screen.findByText("Revise"));
    expect(await screen.findByTestId("job-plan-revision")).toHaveTextContent(
      /adopted plan stays/i,
    );
    fireEvent.change(screen.getByLabelText("Plan title"), {
      target: { value: "Replace pump seal — revised" },
    });
    fireEvent.click(screen.getByText("Save draft"));
    await waitFor(() =>
      expect(upsertJobPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_key: "JP-SEAL",
          title: "Replace pump seal — revised",
          materials: [expect.objectContaining({ material_code: "SEAL-25" })],
        }),
        expect.any(Array),
        { asNewVersion: true },
      ),
    );
    expect(adoptJobPlan).not.toHaveBeenCalled();
    expect(applyJobPlan).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Draft version 2 saved/),
    ).toBeInTheDocument();
    expect(screen.getByText(/adopted plan is unchanged/)).toBeInTheDocument();
  });

  it("opens the existing draft instead of authoring a second version", async () => {
    const openDraft = {
      ...DRAFT_PLAN,
      id: "p-open",
      plan_key: "JP-SEAL",
      title: "Open seal revision",
    };
    listJobPlans.mockResolvedValue({
      plans: [openDraft, ADOPTED_PLAN],
      note: "Only adopted plans apply.",
    });
    getJobPlanDetail.mockImplementation(async (id: string) => ({
      id,
      plan_key: "JP-SEAL",
      title: id === "p-open" ? "Open seal revision" : "Replace pump seal",
      scope: "Seal replacement.",
      applies_to_asset_class: "",
      applies_to_system_group: "",
      basis: "",
      status: id === "p-open" ? "draft" : "adopted",
      version: id === "p-open" ? 2 : 1,
      steps: [
        {
          step_number: 1,
          description: "Isolate",
          craft: "",
          crew_size: 1,
          estimated_hours: 1,
        },
      ],
      materials: [],
      tools: [],
      permits: [],
      checks: [
        {
          check_description: "Leak check",
          acceptance_criterion: "Zero visible leakage",
          is_hold_point: false,
        },
      ],
    }));
    upsertJobPlan.mockResolvedValue({
      job_plan_id: "p-open",
      plan_key: "JP-SEAL",
      version: 2,
      steps: 1,
      status: "draft",
    });
    renderPage();
    fireEvent.click(await screen.findByText("Revise"));
    expect(await screen.findByText(/already open/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Plan title")).toHaveValue(
      "Open seal revision",
    );
    expect(screen.queryByTestId("job-plan-revision")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(getJobPlanDetail).toHaveBeenCalledWith("p-open"),
    );
    expect(getJobPlanDetail).not.toHaveBeenCalledWith("p-adopted");
    fireEvent.click(screen.getByText("Save draft"));
    await waitFor(() => expect(upsertJobPlan).toHaveBeenCalled());
    expect(upsertJobPlan.mock.calls[0][2]).toBeUndefined();
    expect(adoptJobPlan).not.toHaveBeenCalled();
  });

  it("does not offer Revise to a role the database will refuse", async () => {
    role = "technician";
    listJobPlans.mockResolvedValue({
      plans: [ADOPTED_PLAN],
      note: "Only adopted plans apply.",
    });
    renderPage();
    expect(await screen.findByText("Apply")).toBeInTheDocument();
    expect(screen.queryByText("Revise")).not.toBeInTheDocument();
    expect(screen.queryByText("Author a plan")).not.toBeInTheDocument();
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
