/**
 * Reachability of the Reliability RPC callers: each named function is
 * invoked with the arguments the database expects, and in-band refusals
 * surface as errors. AI is not an authorizer on any of these paths.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptRisk,
  adoptPfInterval,
  canAcceptRisk,
  canAdoptPfInterval,
  canAdoptTaxonomy,
  canDecideVariance,
  canProposeTaxonomy,
  decideStandardVariance,
  deriveObservedPf,
  getOperatingContext,
  getOperatingRegime,
  linkAlertToWork,
  listOpenWorkOrders,
  proposeTaxonomyRevision,
  requestStandardVariance,
  suggestedWindowDays,
} from "./reliabilityCallers";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("role gates", () => {
  it("admits the roles the RPCs name and refuses the rest", () => {
    expect(canAdoptPfInterval("reliability_engineer")).toBe(true);
    expect(canAdoptPfInterval("admin")).toBe(true);
    expect(canAdoptPfInterval("ai_admin")).toBe(false);
    expect(canAdoptPfInterval("technician")).toBe(false);
    expect(canAdoptTaxonomy("maintenance_manager")).toBe(true);
    expect(canAdoptTaxonomy("ai_admin")).toBe(false);
    expect(canProposeTaxonomy("ai_admin")).toBe(true);
    expect(canProposeTaxonomy("technician")).toBe(false);
    expect(canDecideVariance("admin")).toBe(true);
    expect(canDecideVariance("ai_admin")).toBe(false);
    expect(canAcceptRisk("reliability_engineer")).toBe(true);
    expect(canAcceptRisk("ai_admin")).toBe(false);
    expect(canAcceptRisk(null)).toBe(false);
  });
});

describe("operating-context readers", () => {
  it("calls get_operating_context with asset and window", async () => {
    rpc.mockResolvedValue({
      data: {
        asset_id: "a1",
        window_days: 90,
        states: [{ state: "running", hours: 80, pct_of_covered: 100 }],
        starts_in_window: 2,
        hours_covered: 80,
        coverage_pct: 3.7,
        records_total: 12,
        data_span_from: "2010-01-01T00:00:00Z",
        data_span_to: "2012-12-31T00:00:00Z",
        basis: "Only 3.7% of the window is covered by state records.",
      },
      error: null,
    });
    const result = await getOperatingContext("a1", 90);
    expect(rpc).toHaveBeenCalledWith("get_operating_context", {
      p_asset_id: "a1",
      p_window_days: 90,
    });
    expect(result.coverage_pct).toBe(3.7);
    expect(result.states[0].state).toBe("running");
  });

  it("calls get_operating_regime and keeps Unknown duty as a real answer", async () => {
    rpc.mockResolvedValue({ data: "Unknown duty", error: null });
    const at = new Date("2026-09-03T12:00:00Z");
    const result = await getOperatingRegime("a1", at);
    expect(rpc).toHaveBeenCalledWith("get_operating_regime", {
      p_asset_id: "a1",
      p_at: at.toISOString(),
    });
    expect(result.regime).toBe("Unknown duty");
    expect(result.basis).toMatch(/load_pct was not recorded/);
  });

  it("does not invent a running state when the regime RPC returns nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const result = await getOperatingRegime("a1", new Date());
    expect(result.regime).toBeNull();
    expect(result.basis).toMatch(/does not assume/);
  });

  it("suggests a window that reaches recorded history instead of claiming none", () => {
    const days = suggestedWindowDays(
      {
        asset_id: "a1",
        window_days: 90,
        states: [],
        starts_in_window: 0,
        hours_covered: 0,
        coverage_pct: 0,
        records_total: 12,
        data_span_from: "2010-01-01T00:00:00Z",
        data_span_to: "2012-12-31T00:00:00Z",
        basis: "none in this window",
      },
      new Date("2026-09-03T00:00:00Z"),
    );
    expect(days).toBeGreaterThan(365 * 14);
  });
});

describe("adopt_pf_interval", () => {
  it("calls adopt_pf_interval with id, days and the human's basis note", async () => {
    rpc.mockResolvedValue({
      data: {
        adopted: "pf1",
        pf_interval_days: 45,
        recommended_inspection_days: 22.5,
      },
      error: null,
    });
    await adoptPfInterval(
      "pf1",
      45,
      "Site vibration programme: 45-day warning on this bearing class.",
    );
    expect(rpc).toHaveBeenCalledWith("adopt_pf_interval", {
      p_id: "pf1",
      p_days: 45,
      p_note: "Site vibration programme: 45-day warning on this bearing class.",
    });
  });

  it("refuses a short basis before calling the database", async () => {
    await expect(adoptPfInterval("pf1", 45, "too short")).rejects.toThrow(
      /20 characters/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an in-band database refusal", async () => {
    rpc.mockResolvedValue({
      data: {
        error: "adopting a P-F interval requires the reliability engineer role",
      },
      error: null,
    });
    await expect(
      adoptPfInterval(
        "pf1",
        45,
        "Site vibration programme: 45-day warning on this bearing class.",
      ),
    ).rejects.toThrow(/reliability engineer role/);
  });
});

describe("propose_taxonomy_revision", () => {
  it("calls propose_taxonomy_revision with key, definition and basis", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, id: "t2", version: 2 },
      error: null,
    });
    await proposeTaxonomyRevision(
      "failure",
      "An event in which an asset loses a required function to the stated standard, recorded at the maintainable item.",
      "Revised against site boundary drawings.",
    );
    expect(rpc).toHaveBeenCalledWith("propose_taxonomy_revision", {
      p_def_key: "failure",
      p_definition:
        "An event in which an asset loses a required function to the stated standard, recorded at the maintainable item.",
      p_basis: "Revised against site boundary drawings.",
    });
  });

  it("refuses a non-substantive definition before calling the database", async () => {
    await expect(
      proposeTaxonomyRevision("failure", "too short", "basis note here"),
    ).rejects.toThrow(/substantive definition/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("variance and accept-risk writers", () => {
  it("calls request_standard_variance with the named fields", async () => {
    rpc.mockResolvedValue({
      data: {
        variance_id: "v1",
        status: "pending",
        approver_role: "reliability_engineer",
      },
      error: null,
    });
    await requestStandardVariance({
      standardId: "s1",
      siteId: "site1",
      justification:
        "The site cannot meet the isolation standard this quarter.",
      compensatingControls: "Additional permit holder and double isolation.",
      expiresAt: "2027-01-01T00:00:00Z",
    });
    expect(rpc).toHaveBeenCalledWith("request_standard_variance", {
      p_standard_id: "s1",
      p_site_id: "site1",
      p_justification:
        "The site cannot meet the isolation standard this quarter.",
      p_compensating_controls: "Additional permit holder and double isolation.",
      p_expires_at: "2027-01-01T00:00:00Z",
    });
  });

  it("calls decide_standard_variance with the human's decision note", async () => {
    rpc.mockResolvedValue({
      data: { variance_id: "v1", status: "approved" },
      error: null,
    });
    await decideStandardVariance(
      "v1",
      true,
      "Compensating controls reviewed against the isolation standard.",
    );
    expect(rpc).toHaveBeenCalledWith("decide_standard_variance", {
      p_variance_id: "v1",
      p_approve: true,
      p_note: "Compensating controls reviewed against the isolation standard.",
    });
  });

  it("calls accept_risk on the six-argument form for a standard", async () => {
    rpc.mockResolvedValue({
      data: {
        acceptance_id: "ra1",
        expires_at: "2027-03-01T00:00:00Z",
        ceiling_checked: false,
      },
      error: null,
    });
    await acceptRisk({
      subjectType: "standard",
      subjectId: "s1",
      riskLevel: "Medium",
      rationale: "Residual leak risk is tolerable with weekly visual checks.",
      compensatingControls: "Weekly visual plus vibration route on this class.",
      expiresAt: "2027-03-01T00:00:00Z",
    });
    expect(rpc).toHaveBeenCalledWith("accept_risk", {
      p_subject_type: "standard",
      p_subject_id: "s1",
      p_risk_level: "Medium",
      p_rationale: "Residual leak risk is tolerable with weekly visual checks.",
      p_compensating_controls:
        "Weekly visual plus vibration route on this class.",
      p_expires_at: "2027-03-01T00:00:00Z",
    });
  });

  it("calls link_alert_to_work with the alert and work order", async () => {
    rpc.mockResolvedValue({
      data: { linked: "al1", work_order_id: "wo1" },
      error: null,
    });
    await linkAlertToWork("al1", "wo1");
    expect(rpc).toHaveBeenCalledWith("link_alert_to_work", {
      p_alert_id: "al1",
      p_work_order_id: "wo1",
    });
  });

  it("calls derive_observed_pf and does not invent a sample", async () => {
    rpc.mockResolvedValue({
      data: {
        observed: [],
        available: false,
        min_samples: 3,
        basis: "Not enough linked alert-to-failure history yet.",
      },
      error: null,
    });
    const result = await deriveObservedPf(3);
    expect(rpc).toHaveBeenCalledWith("derive_observed_pf", {
      p_min_samples: 3,
    });
    expect(result.available).toBe(false);
  });

  it("lists open work orders for the link picker", async () => {
    const is = vi.fn().mockReturnValue({
      order: () => ({
        limit: () =>
          Promise.resolve({
            data: [
              {
                id: "wo1",
                wo_number: "WO-1",
                title: "Inspect",
                status: "open",
                asset_id: "a1",
              },
            ],
            error: null,
          }),
      }),
    });
    from.mockReturnValue({
      select: () => ({ is }),
    });
    const rows = await listOpenWorkOrders();
    expect(from).toHaveBeenCalledWith("work_orders");
    expect(rows[0].wo_number).toBe("WO-1");
  });

  it("surfaces a database SoD refusal in the database's words", async () => {
    rpc.mockResolvedValue({
      data: {
        error:
          "segregation of duties: you requested this variance and cannot also decide it",
      },
      error: null,
    });
    await expect(
      decideStandardVariance("v1", true, "Looks acceptable to me."),
    ).rejects.toThrow(/cannot also decide/);
  });
});
