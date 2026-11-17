import { describe, expect, it } from "vitest";
import {
  mapSapGlActuals,
  readSapGlODataPage,
  sapGlActualsUrl,
  validateSapGlNextUrl,
} from "../../supabase/functions/_shared/sap-s4-financial-read";

const root = new URL(
  "https://sap.example.com/sap/opu/odata/sap/API_GLACCOUNTLINEITEM_SRV",
);
const mappings = [
  {
    wbsElementInternalId: "WB0001",
    glAccount: "0041000000",
    costItemRef: "CIVIL",
  },
  {
    wbsElementInternalId: "WB0001",
    glAccount: "0042000000",
    costItemRef: "CIVIL",
  },
  {
    wbsElementInternalId: "WB0002",
    glAccount: "0043000000",
    costItemRef: "ELECTRICAL",
  },
];

describe("SAP S/4 financial actuals core", () => {
  it("builds one tightly filtered GET query", () => {
    const url = sapGlActualsUrl(
      root,
      {
        ledger: "0L",
        companyCode: "CA01",
        postingDateFrom: "2026-01-01",
        postingDateTo: "2026-10-03",
        mappings,
      },
      500,
    );
    expect(url.pathname).toMatch(/GLAccountLineItem$/);
    expect(url.searchParams.get("$filter")).toContain("Ledger eq '0L'");
    expect(url.searchParams.get("$filter")).toContain("CompanyCode eq 'CA01'");
    expect(url.searchParams.get("$filter")).toContain(
      "WBSElementInternalID eq 'WB0001'",
    );
    expect(url.searchParams.get("$select")).toContain(
      "AmountInCompanyCodeCurrency",
    );
    expect(url.searchParams.get("$top")).toBe("500");
  });

  it("accepts only same-resource invariant pagination", () => {
    const first = sapGlActualsUrl(
      root,
      {
        ledger: "0L",
        companyCode: "CA01",
        postingDateFrom: "2026-01-01",
        postingDateTo: "2026-10-03",
        mappings,
      },
      500,
    );
    const next = new URL(first);
    next.searchParams.set("$skiptoken", "opaque");
    expect(
      validateSapGlNextUrl(next.href, first).searchParams.get("$skiptoken"),
    ).toBe("opaque");
    next.searchParams.set("$filter", "CompanyCode eq 'OTHER'");
    expect(() => validateSapGlNextUrl(next.href, first)).toThrow(
      /changed.*filter/i,
    );
    expect(() =>
      validateSapGlNextUrl("https://evil.example/steal", first),
    ).toThrow(/approved HTTPS resource/i);
    const widened = new URL(first);
    widened.searchParams.set("$skip", "500");
    widened.searchParams.set("$top", "5000");
    expect(() => validateSapGlNextUrl(widened.href, first)).toThrow(
      /changed.*top/i,
    );
    const ambiguous = new URL(first);
    ambiguous.searchParams.set("$skip", "500");
    ambiguous.searchParams.set("$skiptoken", "opaque");
    expect(() => validateSapGlNextUrl(ambiguous.href, first)).toThrow(
      /exactly one paging cursor/i,
    );
  });

  it("reads the OData V2 envelope", () => {
    expect(
      readSapGlODataPage({
        d: { results: [{ Ledger: "0L" }], __next: "/next" },
      }),
    ).toEqual({
      rows: [{ Ledger: "0L" }],
      nextUrl: "/next",
    });
  });

  it("aggregates signed journal lines through approved mappings only", () => {
    const result = mapSapGlActuals(
      [
        {
          Ledger: "0L",
          CompanyCode: "CA01",
          WBSElementInternalID: "WB0001",
          GLAccount: "0041000000",
          PostingDate: "/Date(1788220800000)/",
          CompanyCodeCurrency: "CAD",
          AmountInCompanyCodeCurrency: "125",
        },
        {
          Ledger: "0L",
          CompanyCode: "CA01",
          WBSElementInternalID: "WB0001",
          GLAccount: "0042000000",
          PostingDate: "/Date(1788220800000)/",
          CompanyCodeCurrency: "CAD",
          AmountInCompanyCodeCurrency: -25,
        },
      ],
      {
        ledger: "0L",
        companyCode: "CA01",
        currency: "CAD",
        postingDateFrom: "2026-01-01",
        postingDateTo: "2026-10-03",
        developmentCaseId: "00000000-0000-0000-0000-000000000111",
        mappings,
        observedAt: "2026-10-03T06:00:00.000Z",
        sourceDigest: "a".repeat(64),
        maxRows: 100,
      },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      cost_item_ref: "CIVIL",
      actual_to_date: "100",
      currency: "CAD",
    });
    expect(result.missingMappings).toEqual(["WB0002/0043000000"]);
  });

  it("aggregates currency as exact decimal rather than binary floating point", () => {
    const result = mapSapGlActuals(
      ["9007199254740993.01", "0.09", "-0.10"].map((amount) => ({
        Ledger: "0L",
        CompanyCode: "CA01",
        WBSElementInternalID: "WB0001",
        GLAccount: "0041000000",
        PostingDate: "/Date(1788220800000)/",
        CompanyCodeCurrency: "CAD",
        AmountInCompanyCodeCurrency: amount,
      })),
      {
        ledger: "0L",
        companyCode: "CA01",
        currency: "CAD",
        postingDateFrom: "2026-01-01",
        postingDateTo: "2026-10-03",
        developmentCaseId: "00000000-0000-0000-0000-000000000111",
        mappings,
        observedAt: "2026-10-03T06:00:00.000Z",
        sourceDigest: "c".repeat(64),
        maxRows: 100,
      },
    );
    expect(result.rows[0]?.actual_to_date).toBe("9007199254740993");
    expect(() =>
      mapSapGlActuals(
        [
          {
            Ledger: "0L",
            CompanyCode: "CA01",
            WBSElementInternalID: "WB0001",
            GLAccount: "0041000000",
            PostingDate: "/Date(1788220800000)/",
            CompanyCodeCurrency: "CAD",
            AmountInCompanyCodeCurrency: 0.1,
          },
        ],
        {
          ledger: "0L",
          companyCode: "CA01",
          currency: "CAD",
          postingDateFrom: "2026-01-01",
          postingDateTo: "2026-10-03",
          developmentCaseId: "00000000-0000-0000-0000-000000000111",
          mappings,
          observedAt: "2026-10-03T06:00:00.000Z",
          sourceDigest: "d".repeat(64),
          maxRows: 100,
        },
      ),
    ).toThrow(/exact decimal string/i);
  });

  it("refuses empty, escaped, mixed-currency and negative cumulative evidence", () => {
    const scope = {
      ledger: "0L",
      companyCode: "CA01",
      currency: "CAD",
      postingDateFrom: "2026-01-01",
      postingDateTo: "2026-10-03",
      developmentCaseId: "case",
      mappings,
      observedAt: "2026-10-03T06:00:00.000Z",
      sourceDigest: "b".repeat(64),
      maxRows: 100,
    };
    expect(() => mapSapGlActuals([], scope)).toThrow(/infer zero/i);
    const row = {
      Ledger: "0L",
      CompanyCode: "CA01",
      WBSElementInternalID: "WB0001",
      GLAccount: "0041000000",
      PostingDate: "2026-10-03",
      CompanyCodeCurrency: "USD",
      AmountInCompanyCodeCurrency: 1,
    };
    expect(() => mapSapGlActuals([row], scope)).toThrow(/currency/i);
    expect(() =>
      mapSapGlActuals(
        [{ ...row, CompanyCodeCurrency: "CAD", GLAccount: "999" }],
        scope,
      ),
    ).toThrow(/escaped/i);
    expect(() =>
      mapSapGlActuals(
        [
          {
            ...row,
            CompanyCodeCurrency: "CAD",
            AmountInCompanyCodeCurrency: -1,
          },
        ],
        scope,
      ),
    ).toThrow(/negative/i);
    expect(() =>
      mapSapGlActuals(
        [
          {
            ...row,
            CompanyCodeCurrency: "CAD",
            PostingDate: "2025-12-31",
          },
        ],
        scope,
      ),
    ).toThrow(/posting window/i);
  });
});
