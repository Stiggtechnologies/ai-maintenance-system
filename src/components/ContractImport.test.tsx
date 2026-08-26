/**
 * The surface half of the chain: surface → caller → RPC.
 *
 * WHAT THESE PROTECT.
 *   1. The caller must call `ingest_rows`, never a validator directly. The
 *      whole point of 20261004090000 is that the RUN chooses the validator; a
 *      caller that picks its own RPC re-creates the misroute — an operating
 *      state run handed to ingest_batch, every row refused with a message that
 *      blames the customer's spreadsheet.
 *   2. The entity type the operator SELECTED must be the one the door opens.
 *      It was hardcoded to "maintenance_plan" in the shipped component.
 *   3. A run must never be left `running`. The shipped component returned from
 *      inside its try on a mid-batch error and leaked exactly that; the
 *      connector then reads as stale for ever.
 *   4. A file with a cell the database cannot cast must not be sent at all,
 *      because that raise aborts the batch and destroys the retained rejects.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContractImport } from "./ContractImport";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

function csvFile(text: string, name = "upload.csv") {
  const file = new File([text], name, { type: "text/csv" });
  // jsdom's File has no text(); the component only ever calls that.
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  return file;
}

async function upload(text: string) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [csvFile(text)] } });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /^Import \d+ row/ }),
    ).toBeTruthy(),
  );
}

const GOOD_STATES = [
  "asset_name,external_id,state,started_at,ended_at,load_pct",
  "Conveyor C-22,OS-1,running,2026-08-01T06:00:00Z,2026-08-01T14:00:00Z,72",
  "Conveyor C-22,OS-2,idle,2026-08-01T14:00:00Z,2026-08-01T18:00:00Z,",
].join("\n");

function ok(counts: Partial<Record<string, number>>) {
  return {
    data: { read: 0, accepted: 0, duplicate: 0, rejected: 0, ...counts },
    error: null,
  };
}

beforeEach(() => {
  rpc.mockReset();
});

describe("the caller never picks the validator", () => {
  it("opens the run for the SELECTED entity type and posts rows to ingest_rows", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "begin_manual_import")
        return Promise.resolve({ data: { run_id: "run-1" }, error: null });
      if (fn === "ingest_rows")
        return Promise.resolve(ok({ read: 2, accepted: 2 }));
      return Promise.resolve({ data: {}, error: null });
    });

    render(<ContractImport initialEntity="maintenance_plan" />);
    fireEvent.click(screen.getByText("Operating states (duty history)"));
    await upload(GOOD_STATES);
    fireEvent.click(screen.getByRole("button", { name: /^Import 2 row/ }));

    await waitFor(() => expect(screen.getByText(/accepted 2/)).toBeTruthy());

    const begin = rpc.mock.calls.find((c) => c[0] === "begin_manual_import");
    expect(begin?.[1]).toEqual({
      p_entity_type: "operating_state",
      p_source_name: "Manual upload",
    });

    const called = rpc.mock.calls.map((c) => c[0]);
    expect(called).toContain("ingest_rows");
    expect(called).not.toContain("ingest_batch");
    expect(called).not.toContain("ingest_context_batch");
  });

  it("sends the descriptor's columns, with blanks as null and the identity resolved", async () => {
    rpc.mockImplementation((fn: string) =>
      fn === "begin_manual_import"
        ? Promise.resolve({ data: { run_id: "run-1" }, error: null })
        : Promise.resolve(ok({ read: 2, accepted: 2 })),
    );
    render(<ContractImport initialEntity="operating_state" />);
    await upload(GOOD_STATES);
    fireEvent.click(screen.getByRole("button", { name: /^Import 2 row/ }));
    await waitFor(() => expect(screen.getByText(/accepted 2/)).toBeTruthy());

    const rows = rpc.mock.calls.find((c) => c[0] === "ingest_rows")?.[1] as {
      p_rows: Record<string, string | null>[];
    };
    expect(rows.p_rows[0]).toMatchObject({
      external_id: "OS-1",
      asset_name: "Conveyor C-22",
      state: "running",
      load_pct: "72",
    });
    expect(rows.p_rows[1].ended_at).toBe("2026-08-01T18:00:00Z");
    expect(rows.p_rows[1].load_pct).toBeNull();
  });
});

describe("a run is never left running", () => {
  it("finishes the run as failure when a batch throws mid-upload", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "begin_manual_import")
        return Promise.resolve({ data: { run_id: "run-9" }, error: null });
      if (fn === "ingest_rows")
        return Promise.resolve({
          data: null,
          error: { message: "connection lost" },
        });
      return Promise.resolve({ data: {}, error: null });
    });
    render(<ContractImport initialEntity="operating_state" />);
    await upload(GOOD_STATES);
    fireEvent.click(screen.getByRole("button", { name: /^Import 2 row/ }));

    await waitFor(() =>
      expect(screen.getByText(/connection lost/)).toBeTruthy(),
    );
    const finish = rpc.mock.calls.find((c) => c[0] === "finish_connector_run");
    expect(finish?.[1]).toMatchObject({
      p_run_id: "run-9",
      p_status: "failure",
    });
  });

  it("finishes as partial when rows were refused, so the watermark holds", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "begin_manual_import")
        return Promise.resolve({ data: { run_id: "run-2" }, error: null });
      if (fn === "ingest_rows")
        return Promise.resolve(ok({ read: 2, accepted: 1, rejected: 1 }));
      if (fn === "get_import_rejects")
        return Promise.resolve({
          data: [
            {
              external_id: "OS-2",
              reject_reason: 'unknown asset "No Such Machine"',
            },
          ],
          error: null,
        });
      return Promise.resolve({ data: {}, error: null });
    });
    render(<ContractImport initialEntity="operating_state" />);
    await upload(GOOD_STATES);
    fireEvent.click(screen.getByRole("button", { name: /^Import 2 row/ }));

    await waitFor(() => expect(screen.getByText(/unknown asset/)).toBeTruthy());
    const finish = rpc.mock.calls.filter(
      (c) => c[0] === "finish_connector_run",
    );
    expect(finish).toHaveLength(1);
    expect(finish[0][1]).toMatchObject({ p_status: "partial" });
    expect(screen.getByText(/watermark did not advance/)).toBeTruthy();
  });

  it("a door refusal is shown and no run is finished, because none was opened", async () => {
    rpc.mockImplementation((fn: string) =>
      fn === "begin_manual_import"
        ? Promise.resolve({
            data: {
              error:
                "importing master data requires a planning, engineering or administrator role",
            },
            error: null,
          })
        : Promise.resolve({ data: {}, error: null }),
    );
    render(<ContractImport initialEntity="operating_state" />);
    await upload(GOOD_STATES);
    fireEvent.click(screen.getByRole("button", { name: /^Import 2 row/ }));

    await waitFor(() =>
      expect(screen.getByText(/requires a planning/)).toBeTruthy(),
    );
    expect(rpc.mock.calls.some((c) => c[0] === "finish_connector_run")).toBe(
      false,
    );
    expect(rpc.mock.calls.some((c) => c[0] === "ingest_rows")).toBe(false);
  });
});

describe("a cell the database cannot read is named before the file is sent", () => {
  it("blocks the upload and names the cell", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    render(<ContractImport initialEntity="operating_state" />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          csvFile(
            [
              "asset_name,external_id,state,started_at,ended_at",
              "Conveyor C-22,OS-1,running,yesterday,2026-08-01T14:00:00Z",
            ].join("\n"),
          ),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByText(/not a date the database can read/)).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: /^Import 1 row/ })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("what the operator is told before uploading is per entity type", () => {
  it("states the prerequisite for the two types nothing in the product can load first", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    render(<ContractImport initialEntity="condition_reading" />);
    expect(screen.getByText(/The sensors must already exist/)).toBeTruthy();

    fireEvent.click(screen.getByText("Spares on hand"));
    expect(
      screen.getByText(/material catalogue must be loaded first/),
    ).toBeTruthy();
  });

  it("says UPDATES for a plan and DUPLICATE for a state, not one sentence for both", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    render(<ContractImport initialEntity="maintenance_plan" />);
    expect(
      screen.getByText(/A re-upload UPDATES the matching plan/),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Operating states (duty history)"));
    expect(screen.getByText(/counted as DUPLICATE and skipped/)).toBeTruthy();
    expect(
      screen.queryByText(/A re-upload UPDATES the matching plan/),
    ).toBeNull();
  });

  it("warns that an overlapping state period is refused, not silently doubled", () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    render(<ContractImport initialEntity="operating_state" />);
    expect(screen.getByText(/ONE state at a time/)).toBeTruthy();
  });

  it("says a blank ended_at is not allowed on an upload, before a file is chosen", () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    render(<ContractImport initialEntity="operating_state" />);
    expect(
      screen.getByText(/a file cannot assert that a machine is still in this/),
    ).toBeTruthy();
  });

  it("lists the allowed notification types and statuses rather than leaving them to a CHECK", () => {
    // Both columns carry a CHECK. Shipped without an allowlist, the ordinary
    // word "malfunction" raised inside the insert and took the whole file with
    // it — no rows, and no retained rejects to explain why.
    rpc.mockResolvedValue({ data: {}, error: null });
    render(<ContractImport initialEntity="maintenance_notification" />);
    expect(
      screen.getByText(/fault, observation, request or safety/),
    ).toBeTruthy();
    expect(
      screen.getByText(/open, in_planning, converted, rejected or merged/),
    ).toBeTruthy();
  });

  it("switching entity type clears the parsed file, so it cannot be sent to the wrong door", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    render(<ContractImport initialEntity="operating_state" />);
    await upload(GOOD_STATES);
    fireEvent.click(screen.getByText("Work orders"));
    expect(screen.queryByRole("button", { name: /^Import 2 row/ })).toBeNull();
  });
});
