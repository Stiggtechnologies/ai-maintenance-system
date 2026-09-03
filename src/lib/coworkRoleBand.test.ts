import { describe, expect, it } from "vitest";
import {
  COWORK_BAND_COPY,
  COWORK_TEMPLATE_LEAD_IDS,
  coworkRoleBand,
  orderCoworkTemplates,
} from "./coworkRoleBand";

describe("coworkRoleBand", () => {
  it("maps the org ladder onto the four collaboration bands", () => {
    expect(coworkRoleBand("board")).toBe("portfolio");
    expect(coworkRoleBand("executive")).toBe("portfolio");
    expect(coworkRoleBand("maintenance_manager")).toBe("crew");
    expect(coworkRoleBand("supervisor")).toBe("crew");
    expect(coworkRoleBand("reliability_engineer")).toBe("engineering");
    expect(coworkRoleBand("planner")).toBe("engineering");
    expect(coworkRoleBand("technician")).toBe("field");
    expect(coworkRoleBand("operator")).toBe("field");
    expect(coworkRoleBand("admin")).toBe("engineering");
    expect(coworkRoleBand("ai_admin")).toBe("engineering");
    expect(coworkRoleBand(null)).toBe("engineering");
  });

  it("never mentions Pump P-101 in band copy", () => {
    for (const copy of Object.values(COWORK_BAND_COPY)) {
      expect(JSON.stringify(copy)).not.toMatch(/P-101/i);
    }
  });

  it("does not lead portfolio with field-execution templates", () => {
    const lead = COWORK_TEMPLATE_LEAD_IDS.portfolio;
    expect(lead[0]).toBe("t-5");
    expect(lead).not.toContain("t-11");
    expect(lead).not.toContain("t-12");
    expect(lead).not.toContain("t-13");
  });

  it("does not lead field with Executive Briefing", () => {
    const lead = COWORK_TEMPLATE_LEAD_IDS.field;
    expect(lead[0]).toBe("t-11");
    expect(lead).not.toContain("t-5");
  });

  it("reorders templates without dropping any", () => {
    const templates = [
      { id: "t-1" },
      { id: "t-5" },
      { id: "t-11" },
      { id: "t-2" },
    ];
    const field = orderCoworkTemplates(templates, "field");
    expect(field.map((t) => t.id)).toEqual(["t-11", "t-1", "t-5", "t-2"]);
    expect(field).toHaveLength(templates.length);

    const portfolio = orderCoworkTemplates(templates, "portfolio");
    expect(portfolio[0].id).toBe("t-5");
    expect(portfolio.map((t) => t.id)).toContain("t-11");
  });
});
