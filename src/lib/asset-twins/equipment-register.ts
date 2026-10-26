import { parseCSV } from "../fleet-import";
import type { SystemNode, SystemReferenceModel } from "./system-model";

/**
 * Equipment-register walk-down: the sheet a site team fills in, unit by unit,
 * to record what is actually installed (make, model, serial, install year,
 * filter size) against a reference model's equipment units.
 *
 * Writes nothing. `walkdownCsv` builds the blank sheet; `parseWalkdown`
 * turns a returned sheet into asset proposals and issues for a person to
 * review before anything is loaded through the governed asset path.
 */

export const WALKDOWN_COLUMNS = [
  "property",
  "unit",
  "system",
  "equipment",
  "reference_node",
  "asset_class_code",
  "make",
  "model",
  "serial",
  "install_year",
  "filter_size",
  "location_note",
  "photo_link",
] as const;

export type WalkdownColumn = (typeof WALKDOWN_COLUMNS)[number];
export type WalkdownRow = Record<WalkdownColumn, string>;

export interface WalkdownArea {
  /** Property or building, e.g. "230 Wilson Drive". */
  property: string;
  /** Unit, suite or "common" for shared building systems. */
  unit: string;
}

/** Template code when one is bound; otherwise "planned:<node code>". */
function classCodeFor(node: SystemNode): string {
  return node.assetClassTemplateCode ?? `planned:${node.code}`;
}

function systemNameFor(model: SystemReferenceModel, node: SystemNode): string {
  const byCode = new Map(model.nodes.map((n) => [n.code, n]));
  let cur: SystemNode | undefined = node;
  while (cur && cur.level !== "system") cur = cur.parentCode ? byCode.get(cur.parentCode) : undefined;
  return cur?.name ?? "";
}

export function walkdownRows(model: SystemReferenceModel, areas: WalkdownArea[]): WalkdownRow[] {
  const equipment = model.nodes.filter((n) => n.level === "equipment_unit");
  return areas.flatMap((area) =>
    equipment.map((node) => ({
      property: area.property.trim(),
      unit: area.unit.trim(),
      system: systemNameFor(model, node),
      equipment: node.name,
      reference_node: node.code,
      asset_class_code: classCodeFor(node),
      make: "",
      model: "",
      serial: "",
      install_year: "",
      filter_size: "",
      location_note: "",
      photo_link: "",
    })),
  );
}

const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function walkdownCsv(model: SystemReferenceModel, areas: WalkdownArea[]): string {
  const rows = walkdownRows(model, areas);
  return [WALKDOWN_COLUMNS.join(","), ...rows.map((r) => WALKDOWN_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n");
}

export interface WalkdownProposal {
  row: number;
  property: string;
  unit: string;
  referenceNodeCode: string;
  assetClassCode: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  operatingContext: {
    installYear?: number;
    filterSize?: string;
    locationNote?: string;
    photoLink?: string;
  };
  /** Recorded on the sheet, not verified: a person confirms before loading. */
  status: "proposed";
}

export interface WalkdownIssue {
  row: number;
  column?: WalkdownColumn;
  message: string;
}

/**
 * Parse a returned walk-down sheet. Rows with nothing recorded are skipped
 * (not every unit has every item). Nothing is inferred: a blank stays blank.
 */
export function parseWalkdown(
  csvText: string,
  model: SystemReferenceModel,
  options: { currentYear: number },
): { proposals: WalkdownProposal[]; issues: WalkdownIssue[] } {
  const rows = parseCSV(csvText);
  const issues: WalkdownIssue[] = [];
  const proposals: WalkdownProposal[] = [];
  if (rows.length === 0) return { proposals, issues: [{ row: 0, message: "sheet is empty" }] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index = new Map(header.map((h, i) => [h, i]));
  const missing = WALKDOWN_COLUMNS.filter((c) => !index.has(c));
  if (missing.length) return { proposals, issues: [{ row: 1, message: `missing columns: ${missing.join(", ")}` }] };

  const nodes = new Map(model.nodes.filter((n) => n.level === "equipment_unit").map((n) => [n.code, n]));
  const seenSerials = new Map<string, number>();

  rows.slice(1).forEach((raw, i) => {
    const rowNumber = i + 2;
    const get = (c: WalkdownColumn) => (raw[index.get(c)!] ?? "").trim();
    const recorded = (["make", "model", "serial", "install_year", "filter_size", "location_note", "photo_link"] as const).some(
      (c) => get(c) !== "",
    );
    if (!recorded) return;

    const rowIssues: WalkdownIssue[] = [];
    const node = nodes.get(get("reference_node"));
    if (!get("property")) rowIssues.push({ row: rowNumber, column: "property", message: "property is required" });
    if (!get("unit")) rowIssues.push({ row: rowNumber, column: "unit", message: "unit is required" });
    if (!node) {
      rowIssues.push({ row: rowNumber, column: "reference_node", message: "not an equipment unit of this reference model" });
    } else if (get("asset_class_code") !== classCodeFor(node)) {
      rowIssues.push({ row: rowNumber, column: "asset_class_code", message: `expected ${classCodeFor(node)} for ${node.code}` });
    }

    let installYear: number | undefined;
    const yearText = get("install_year");
    if (yearText) {
      if (!/^\d{4}$/.test(yearText)) rowIssues.push({ row: rowNumber, column: "install_year", message: "install year must be a four-digit year or blank" });
      else if (Number(yearText) > options.currentYear) rowIssues.push({ row: rowNumber, column: "install_year", message: "install year is in the future" });
      else installYear = Number(yearText);
    }

    const photo = get("photo_link");
    if (photo && !/^https:\/\//i.test(photo)) rowIssues.push({ row: rowNumber, column: "photo_link", message: "photo link must be an https URL or blank" });

    const serial = get("serial");
    if (serial) {
      const key = `${get("make").toLowerCase()}|${serial.toLowerCase()}`;
      const first = seenSerials.get(key);
      if (first !== undefined) rowIssues.push({ row: rowNumber, column: "serial", message: `same make and serial as row ${first}` });
      else seenSerials.set(key, rowNumber);
    }

    if (rowIssues.length) {
      issues.push(...rowIssues);
      return;
    }
    proposals.push({
      row: rowNumber,
      property: get("property"),
      unit: get("unit"),
      referenceNodeCode: node!.code,
      assetClassCode: classCodeFor(node!),
      manufacturer: get("make") || undefined,
      model: get("model") || undefined,
      serialNumber: serial || undefined,
      operatingContext: {
        installYear,
        filterSize: get("filter_size") || undefined,
        locationNote: get("location_note") || undefined,
        photoLink: photo || undefined,
      },
      status: "proposed",
    });
  });

  return { proposals, issues };
}
