/**
 * Profiling, and the row count that was wrong.
 *
 * THE BUG THIS FILE EXISTS FOR. The shipped uploader computed a work-order
 * export's record count as
 *
 *     text.split(/\r?\n/).filter(Boolean).length - 1
 *
 * A CSV field may contain a newline when it is quoted, and work-order
 * `long_text` — the free-text fault description — contains them constantly.
 * Every such line was counted as another work order, so the number shown to a
 * customer against their own export was reliably too big, and reliably too big
 * by an amount that scaled with how much their technicians wrote. The first
 * test below is that bug, stated as a case: four work orders, one of which has
 * a two-line description, and the old arithmetic returns five.
 *
 * The wider property is that profiling MEASURES and never guesses. An absent
 * column and an empty column are different facts, and a customer paying for an
 * evidence-graded assessment is owed the difference.
 */
import { describe, expect, it } from "vitest";
import { REQUIRED_FIELDS, profileFile } from "./riaDataRoom";

/** The arithmetic the shipped uploader used, kept so the bug stays visible. */
function shippedRecordCount(text: string): number {
  return Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1);
}

const WORK_ORDERS_WITH_A_MULTILINE_DESCRIPTION = [
  "work_order_id,asset_id,created_date,complete_date,work_type,status,short_text,long_text",
  "WO-1,HT-101,2026-01-04,2026-01-06,CM,CLSD,Strut leak,Seal weeping",
  'WO-2,HT-102,2026-02-11,2026-02-12,CM,CLSD,Strut leak,"Operator reports a knock over rough ground.',
  'Second visit found the gland nut loose."',
  "WO-3,HT-101,2026-03-02,2026-03-04,PM,CLSD,500h service,Routine",
  "WO-4,HT-103,2026-04-21,2026-04-25,CM,CLSD,Hose burst,Replaced",
  "",
].join("\n");

describe("the record count the customer is shown", () => {
  it("counts work orders, not lines — the shipped arithmetic did not", () => {
    const text = WORK_ORDERS_WITH_A_MULTILINE_DESCRIPTION;
    // The bug, demonstrated: one quoted line break inflates the count by one.
    expect(shippedRecordCount(text)).toBe(5);
    return profileFile("work_orders", text).then((profile) => {
      expect(profile.row_count).toBe(4);
    });
  });

  it("reads the header width correctly across the quoted break", async () => {
    const profile = await profileFile(
      "work_orders",
      WORK_ORDERS_WITH_A_MULTILINE_DESCRIPTION,
    );
    expect(profile.column_count).toBe(8);
    expect(profile.headers).toContain("long_text");
  });

  it("survives an Excel BOM without corrupting the first header", async () => {
    const profile = await profileFile(
      "asset_register",
      "\ufeffasset_id,asset_description,asset_class,site_or_fleet,status\nHT-1,Haul truck,haul_truck,FTM,ACTIVE\n",
    );
    // A BOM left in place prefixes the first header with U+FEFF, which
    // matches no required field — the register would report its own key column
    // as absent.
    expect(profile.missing_required_fields).toEqual([]);
    expect(profile.row_count).toBe(1);
  });
});

describe("required fields are reported, never invented", () => {
  it("names the pack's required fields that are absent", async () => {
    const profile = await profileFile(
      "asset_register",
      "asset_id,asset_description\nHT-1,Haul truck\n",
    );
    expect(profile.missing_required_fields).toEqual([
      "asset_class",
      "site_or_fleet",
      "status",
    ]);
  });

  it("matches headers whatever casing or separator the export used", async () => {
    const profile = await profileFile(
      "asset_register",
      "Asset ID,Asset-Description,ASSET_CLASS,Site Or Fleet,Status\nHT-1,Haul truck,haul_truck,FTM,ACTIVE\n",
    );
    expect(profile.missing_required_fields).toEqual([]);
  });

  it("keeps the pack's required-field lists for every dataset", () => {
    // §3 of the intake pack. If a dataset loses its list, its exports stop
    // being checked at all and every one of them looks complete.
    for (const key of Object.keys(REQUIRED_FIELDS)) {
      expect(
        REQUIRED_FIELDS[key as keyof typeof REQUIRED_FIELDS].length,
        `${key} has no required fields`,
      ).toBeGreaterThan(0);
    }
    expect(REQUIRED_FIELDS.work_orders).toContain("complete_date");
    expect(REQUIRED_FIELDS.pm_plans).toContain("active_status");
  });
});

describe("an absent column and an empty column are different facts", () => {
  it("reports identifier coverage as null when there is no such column", async () => {
    const profile = await profileFile(
      "asset_register",
      "description,class\nHaul truck,haul_truck\n",
    );
    // Not 0. Zero would read as "we have the column and it is empty", which is
    // a data-quality finding; this is a schema finding.
    expect(profile.identifier_coverage).toBeNull();
    expect(profile.missing_required_fields).toContain("asset_id");
  });

  it("reports the share when the column exists but is partly blank", async () => {
    const profile = await profileFile(
      "asset_register",
      [
        "asset_id,asset_description,asset_class,site_or_fleet,status",
        "HT-1,Haul truck,haul_truck,FTM,ACTIVE",
        ",Haul truck,haul_truck,FTM,ACTIVE",
        "HT-3,Haul truck,haul_truck,FTM,ACTIVE",
        "HT-4,Haul truck,haul_truck,FTM,ACTIVE",
        "",
      ].join("\n"),
    );
    expect(profile.identifier_coverage).toBe(0.75);
    expect(profile.dq_exceptions).toContainEqual({
      rows: 1,
      reason: "asset_id is blank",
    });
  });

  it("raises a DQ exception for a row whose width does not match the header", async () => {
    const profile = await profileFile(
      "asset_register",
      [
        "asset_id,asset_description,asset_class,site_or_fleet,status",
        "HT-1,Haul truck,haul_truck,FTM,ACTIVE",
        "HT-2,Haul truck,haul_truck",
        "",
      ].join("\n"),
    );
    expect(
      profile.dq_exceptions.some((e) =>
        e.reason.includes("different column count"),
      ),
    ).toBe(true);
  });
});

describe("date coverage is derived from the data, not assumed", () => {
  it("reports the true span of an ISO date column", async () => {
    const profile = await profileFile(
      "work_orders",
      [
        "work_order_id,asset_id,created_date,complete_date,work_type,status,short_text",
        "WO-1,HT-1,2024-03-05,2024-03-09,CM,CLSD,a",
        "WO-2,HT-1,2026-07-30,2026-08-02,CM,CLSD,b",
        "WO-3,HT-1,2025-01-15,2025-01-16,PM,CLSD,c",
        "",
      ].join("\n"),
    );
    expect(profile.coverage_from).toBe("2024-03-05");
    expect(profile.coverage_to).toBe("2026-08-02");
  });

  it("reports no coverage rather than a guess when nothing parses as a date", async () => {
    const profile = await profileFile(
      "work_orders",
      [
        "work_order_id,asset_id,created_date,complete_date,work_type,status,short_text",
        "WO-1,HT-1,week 12,week 12,CM,CLSD,a",
        "",
      ].join("\n"),
    );
    expect(profile.coverage_from).toBeNull();
    expect(profile.coverage_to).toBeNull();
  });

  it("handles an empty export without inventing a row", async () => {
    const profile = await profileFile(
      "asset_register",
      "asset_id,asset_description,asset_class,site_or_fleet,status\n",
    );
    expect(profile.row_count).toBe(0);
    expect(profile.identifier_coverage).toBeNull();
  });
});

describe("the fingerprint", () => {
  it("is stable for identical content and differs for changed content", async () => {
    const a = await profileFile("asset_register", "asset_id\nHT-1\n");
    const b = await profileFile("asset_register", "asset_id\nHT-1\n");
    const c = await profileFile("asset_register", "asset_id\nHT-2\n");
    // The stub keeps this after the raw file is gone, so it has to identify
    // the file it stood for.
    if (a.content_sha256 === null) {
      // No WebCrypto in this environment — the profile says so rather than
      // fabricating a digest.
      expect(b.content_sha256).toBeNull();
      return;
    }
    expect(a.content_sha256).toBe(b.content_sha256);
    expect(a.content_sha256).not.toBe(c.content_sha256);
  });
});
