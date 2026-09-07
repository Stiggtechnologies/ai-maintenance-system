/**
 * Reachability of the job-plan write path: upsert_job_plan, adopt_job_plan
 * and apply_job_plan must be invoked with the arguments the database
 * functions expect, and in-band refusals must surface as errors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyJobPlan,
  adoptJobPlan,
  buildUpsertPayload,
  canAuthorJobPlans,
  emptyDraft,
  upsertJobPlan,
} from "./jobPlanService";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

const CATALOGUE = [
  {
    id: "m1",
    material_code: "SEAL-25",
    description: "Mechanical seal 25mm",
    unit_of_measure: "each",
  },
];

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("canAuthorJobPlans", () => {
  it("admits planning and engineering roles and refuses others", () => {
    expect(canAuthorJobPlans("reliability_engineer")).toBe(true);
    expect(canAuthorJobPlans("planner")).toBe(true);
    expect(canAuthorJobPlans("technician")).toBe(false);
    expect(canAuthorJobPlans(null)).toBe(false);
  });
});

describe("buildUpsertPayload", () => {
  it("drops empty rows and unknown material codes instead of sending them", () => {
    const draft = emptyDraft();
    draft.plan_key = "JP-SEAL";
    draft.title = "Replace pump seal";
    draft.scope = "Mechanical seal replacement on process-water pumps.";
    draft.steps = [
      {
        step_number: 1,
        description: "Isolate and drain",
        craft: "fitter",
        crew_size: 2,
        estimated_hours: 1.5,
      },
      {
        step_number: 2,
        description: "   ",
        craft: "",
        crew_size: 1,
        estimated_hours: 1,
      },
    ];
    draft.materials = [
      { material_code: "SEAL-25", description: "Mechanical seal 25mm", qty: 1 },
      { material_code: "NO-SUCH", description: "Invented", qty: 4 },
    ];
    draft.checks = [
      {
        check_description: "No leak at 1.1× operating pressure",
        acceptance_criterion: "Zero visible leakage for 10 minutes",
        is_hold_point: true,
      },
      {
        check_description: "Missing criterion",
        acceptance_criterion: "  ",
        is_hold_point: false,
      },
    ];

    const { plan, droppedMaterialCodes } = buildUpsertPayload(draft, CATALOGUE);
    expect(droppedMaterialCodes).toEqual(["NO-SUCH"]);
    expect(plan.materials).toEqual([{ material_code: "SEAL-25", qty: 1 }]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.checks).toHaveLength(1);
  });
});

describe("job plan RPC callers", () => {
  it("calls upsert_job_plan with the jsonb payload", async () => {
    rpc.mockResolvedValue({
      data: {
        job_plan_id: "p1",
        plan_key: "JP-SEAL",
        steps: 1,
        status: "draft",
      },
      error: null,
    });
    const draft = emptyDraft();
    draft.plan_key = "JP-SEAL";
    draft.title = "Replace pump seal";
    draft.scope = "Seal replacement";
    draft.steps = [
      {
        step_number: 1,
        description: "Isolate",
        craft: "fitter",
        crew_size: 1,
        estimated_hours: 1,
      },
    ];
    const result = await upsertJobPlan(draft, CATALOGUE);
    expect(rpc).toHaveBeenCalledWith("upsert_job_plan", {
      p_plan: expect.objectContaining({
        plan_key: "JP-SEAL",
        title: "Replace pump seal",
        scope: "Seal replacement",
      }),
    });
    expect(result.job_plan_id).toBe("p1");
  });

  it("calls adopt_job_plan with the plan id and the human's note", async () => {
    rpc.mockResolvedValue({
      data: { adopted: "p1", steps: 2, checks: 1 },
      error: null,
    });
    await adoptJobPlan("p1", "OEM overlay reviewed against site isolations.");
    expect(rpc).toHaveBeenCalledWith("adopt_job_plan", {
      p_id: "p1",
      p_note: "OEM overlay reviewed against site isolations.",
    });
  });

  it("calls apply_job_plan with the work order and plan key", async () => {
    rpc.mockResolvedValue({
      data: {
        work_order_id: "wo1",
        plan: "JP-SEAL",
        tasks_created: 2,
        planned_hours: 4,
        materials_requested: 1,
        permits_required: 0,
        safety_flagged: false,
      },
      error: null,
    });
    await applyJobPlan("wo1", "JP-SEAL");
    expect(rpc).toHaveBeenCalledWith("apply_job_plan", {
      p_work_order_id: "wo1",
      p_plan_key: "JP-SEAL",
    });
  });

  it("surfaces an in-band database refusal as an error", async () => {
    rpc.mockResolvedValue({
      data: {
        error:
          "a plan whose completion cannot be verified is not executable — add at least one quality check with an acceptance criterion",
      },
      error: null,
    });
    await expect(adoptJobPlan("p1", "too short")).rejects.toThrow(
      /completion cannot be verified/,
    );
  });
});
