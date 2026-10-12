// Synthetic source records only. No network, credentials, or production reads.
// Native witnesses pass these real mapper outputs to the canonical RPCs.
import {
  applyDataLakeMapping,
  parseDataLakeObject,
} from "../supabase/functions/_shared/adls-data-lake.ts";
import { mapP6ScheduleSnapshot } from "../supabase/functions/_shared/p6-schedule-read.ts";
import { mapSapMaterialStock } from "../supabase/functions/_shared/sap-s4-inventory-read.ts";
import { mapSapGlActuals } from "../supabase/functions/_shared/sap-s4-financial-read.ts";
const [kind, identity, observedAt, digest, today] = process.argv.slice(2);
let rows: unknown;
if (kind === "adls") {
  rows = parseDataLakeObject(
    "id,label,code\nSITE-1,ADLS Site One,S1\nSITE-BAD,,\n",
    "csv",
    "",
  ).map((row) =>
    applyDataLakeMapping(
      row,
      { external_id: "id", name: "label", code: "code" },
      {},
      {},
      JSON.parse(identity),
    ),
  );
} else if (kind === "p6") {
  rows = mapP6ScheduleSnapshot(
    [
      {
        ObjectId: 101,
        Id: "A-100",
        Name: "Isolate train",
        ProjectObjectId: 4101,
        PlannedDuration: 1,
        PlannedStartDate: "2027-05-01T08:00:00Z",
        PlannedFinishDate: "2027-05-01T16:00:00Z",
        CalendarName: "Explicit synthetic eight-hour day",
      },
      {
        ObjectId: 102,
        Id: "A-200",
        Name: "Open exchanger",
        ProjectObjectId: 4101,
        PlannedDuration: 2,
        PlannedStartDate: "2027-05-02T08:00:00Z",
        PlannedFinishDate: "2027-05-03T00:00:00Z",
        CalendarName: "Explicit synthetic eight-hour day",
      },
    ],
    [
      {
        ObjectId: 201,
        PredecessorProjectObjectId: 4101,
        SuccessorProjectObjectId: 4101,
        PredecessorActivityObjectId: 101,
        SuccessorActivityObjectId: 102,
        PredecessorActivityId: "A-100",
        SuccessorActivityId: "A-200",
        Type: "Finish to Start",
        Lag: 0.25,
      },
    ],
    {
      projectObjectId: 4101,
      developmentCaseId: identity,
      scheduleName: "Turnaround 2027",
      durationToHours: 8,
      maxActivities: 50,
      maxRelationships: 100,
    },
  );
} else if (kind === "inventory") {
  rows = mapSapMaterialStock(
    ["MAT-001", "MAT-002"].map((Material, i) => ({
      Material,
      Plant: "1000",
      StorageLocation: "0001",
      InventoryStockType: "01",
      InventorySpecialStockType: "",
      MaterialBaseUnit: "EA",
      MatlWrhsStkQtyInMatlBaseUnit: i ? "4" : "12",
    })),
    {
      plant: "1000",
      storageLocation: "0001",
      siteId: identity,
      observedAt,
      maxRows: 100,
    },
  );
} else if (kind === "finance") {
  const mappings = [
    {
      wbsElementInternalId: "WB0001",
      glAccount: "0041000000",
      costItemRef: "CIVIL",
    },
    {
      wbsElementInternalId: "WB0002",
      glAccount: "0042000000",
      costItemRef: "ELEC",
    },
  ];
  const result = mapSapGlActuals(
    [
      ["WB0001", "0041000000", "500"],
      ["WB0001", "0041000000", "200"],
      ["WB0002", "0042000000", "200"],
    ].map(([WBSElementInternalID, GLAccount, AmountInCompanyCodeCurrency]) => ({
      Ledger: "0L",
      CompanyCode: "CA01",
      CompanyCodeCurrency: "CAD",
      PostingDate: today,
      WBSElementInternalID,
      GLAccount,
      AmountInCompanyCodeCurrency,
    })),
    {
      ledger: "0L",
      companyCode: "CA01",
      currency: "CAD",
      postingDateFrom: "2026-01-01",
      postingDateTo: today,
      developmentCaseId: identity,
      mappings,
      observedAt,
      sourceDigest: digest,
      maxRows: 100,
    },
  );
  if (result.missingMappings.length)
    throw new Error("Synthetic mapping incomplete");
  rows = result.rows;
} else throw new Error("Unknown synthetic adapter fixture");
process.stdout.write(JSON.stringify(rows));
