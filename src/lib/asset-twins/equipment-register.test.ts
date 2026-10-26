import { describe, expect, it } from "vitest";
import { ASSET_IMPORT_COLUMNS, parseWalkdown, WALKDOWN_COLUMNS, walkdownCsv, walkdownRows, walkdownToAssetImportCsv } from "./equipment-register";
import { residentialDwellingReferenceModel as model } from "./residential-dwelling-reference-model";
import { parseCSV } from "../fleet-import";

const areas = [
  { property: "230 Wilson Drive", unit: "Townhouse 1" },
  { property: "230 Wilson Drive", unit: "Townhouse 2" },
];

function fill(csv: string, edits: Record<string, Partial<Record<(typeof WALKDOWN_COLUMNS)[number], string>>>): string {
  const rows = parseCSV(csv);
  const header = rows[0];
  return [
    header.join(","),
    ...rows.slice(1).map((r) => {
      const key = `${r[1]}|${r[4]}`;
      const edit = edits[key] ?? {};
      return header.map((h, i) => (edit[h as keyof typeof edit] ?? r[i]).replace(/,/g, " ")).join(",");
    }),
  ].join("\n");
}

describe("equipment register walk-down", () => {
  it("lists every equipment unit of the model for every area, with its system and class", () => {
    const rows = walkdownRows(model, areas);
    const units = model.nodes.filter((n) => n.level === "equipment_unit");
    expect(rows).toHaveLength(units.length * areas.length);
    const furnace = rows.find((r) => r.unit === "Townhouse 1" && r.reference_node === "RES-FURNACE-UNIT")!;
    expect(furnace).toMatchObject({ system: "Heating and ventilation", asset_class_code: "RES-FURNACE", make: "", serial: "" });
    expect(rows.find((r) => r.reference_node === "RES-SUMP")!.asset_class_code).toBe("planned:RES-SUMP");
  });

  it("writes a CSV whose header is the walk-down columns", () => {
    const csv = walkdownCsv(model, areas);
    expect(csv.split("\n")[0]).toBe(WALKDOWN_COLUMNS.join(","));
    expect(parseCSV(csv)).toHaveLength(1 + walkdownRows(model, areas).length);
  });

  it("turns recorded rows into proposals and skips untouched rows", () => {
    const csv = fill(walkdownCsv(model, areas), {
      "Townhouse 1|RES-FURNACE-UNIT": { make: "Example Make", model: "X1", serial: "SN-1", install_year: "2014", filter_size: "16x25x1" },
      "Townhouse 2|RES-WATER-HEATER-UNIT": { make: "Example Make", serial: "SN-2", photo_link: "https://example.com/p.jpg" },
    });
    const { proposals, issues } = parseWalkdown(csv, model, { currentYear: 2026 });
    expect(issues).toEqual([]);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      unit: "Townhouse 1",
      assetClassCode: "RES-FURNACE",
      serialNumber: "SN-1",
      operatingContext: { installYear: 2014, filterSize: "16x25x1" },
      status: "proposed",
    });
    expect(proposals[1].operatingContext.installYear).toBeUndefined();
  });

  it("reports bad years, links, duplicate serials, wrong classes and missing columns instead of guessing", () => {
    const csv = fill(walkdownCsv(model, areas), {
      "Townhouse 1|RES-FURNACE-UNIT": { make: "M", serial: "DUP", install_year: "14" },
      "Townhouse 2|RES-FURNACE-UNIT": { make: "M", serial: "DUP", install_year: "2031" },
      "Townhouse 1|RES-AC-UNIT": { make: "M", photo_link: "file://c/photo.jpg", asset_class_code: "RES-FURNACE" },
    });
    const { proposals, issues } = parseWalkdown(csv, model, { currentYear: 2026 });
    expect(proposals).toEqual([]);
    const messages = issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "install year must be a four-digit year or blank",
        "install year is in the future",
        "photo link must be an https URL or blank",
        "expected RES-HEAT-PUMP for RES-AC-UNIT",
      ]),
    );
    expect(messages.some((m) => m.startsWith("same make and serial as row"))).toBe(true);
    expect(parseWalkdown("property,unit\nA,B", model, { currentYear: 2026 }).issues[0].message).toMatch(/missing columns/);
  });

  it("hands reviewed proposals to Asset Management's existing import without deciding criticality", () => {
    const csv = fill(walkdownCsv(model, areas), {
      "Townhouse 1|RES-FURNACE-UNIT": { make: "Example Make", model: "X1", serial: "SN-1" },
    });
    const { proposals } = parseWalkdown(csv, model, { currentYear: 2026 });
    const out = parseCSV(walkdownToAssetImportCsv(proposals, model));
    expect(out[0]).toEqual([...ASSET_IMPORT_COLUMNS]);
    expect(out[1]).toEqual([
      "230 Wilson Drive · Townhouse 1 · Forced-air furnace",
      "",
      "RES-FURNACE",
      "230 Wilson Drive / Townhouse 1",
      "",
      "",
      "Example Make",
      "X1",
      "SN-1",
    ]);
  });

  it("matches the header Asset Management's import accepts", async () => {
    const fs = await import("node:fs");
    const wizard = fs.readFileSync("src/components/CSVImportWizard.tsx", "utf8");
    expect(wizard).toContain(ASSET_IMPORT_COLUMNS.join(","));
  });
});
