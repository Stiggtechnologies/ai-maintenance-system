import { describe, expect, it } from "vitest";
import {
  buildInvestigationPlan,
  isDataIntegrityKpi,
  isSafetyKpi,
  prioritizeKpis,
} from "../../../supabase/functions/_shared/sync-investigation";

describe("Sync investigation planner", () => {
  it("makes the highest-risk question perform the operational checks shown to the user", () => {
    const plan = buildInvestigationPlan({
      question: "what is the highest risk in my operation today?",
    });
    expect(plan.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "operational-kpis",
        "asset-data-integrity",
        "safety-indicators",
        "open-recommendations",
        "risk-ranking",
      ]),
    );
  });

  it("adds asset/work/attachment checks only when they are actually relevant", () => {
    const plan = buildInvestigationPlan({
      question: "diagnose this work order on the asset",
      entityType: "asset",
      attachmentCount: 2,
    });
    expect(plan.map((item) => item.id)).toEqual(
      expect.arrayContaining(["current-asset", "work-context", "attachments"]),
    );
  });

  it("uses a truthful generic check rather than inventing operational work", () => {
    const plan = buildInvestigationPlan({ question: "explain this failure mechanism" });
    expect(plan).toHaveLength(1);
    expect(plan[0].id).toBe("governed-context");
  });
});

describe("KPI evidence selection", () => {
  const rows = [
    { kpi_key: "good", name: "Good", value: 90, unit: "%", status: "on_target" as const },
    { kpi_key: "watch", name: "Watch", value: 70, unit: "%", status: "watch" as const },
    { kpi_key: "breach", name: "Breach", value: 10, unit: "%", status: "breach" as const },
  ];

  it("puts breached/watch indicators before green indicators", () => {
    expect(prioritizeKpis(rows).map((row) => row.kpi_key)).toEqual([
      "breach",
      "watch",
      "good",
    ]);
  });

  it("recognizes data-integrity and safety KPIs without hardcoding one metric", () => {
    expect(
      isDataIntegrityKpi({
        kpi_key: "asset_register_accuracy",
        name: "Asset Register Accuracy",
        value: 0,
        unit: "%",
        status: "breach",
      }),
    ).toBe(true);
    expect(
      isSafetyKpi({
        kpi_key: "incident_rate",
        name: "Incident rate",
        page: "risk_safety",
        value: 0,
        unit: null,
        status: "on_target",
      }),
    ).toBe(true);
  });
});
