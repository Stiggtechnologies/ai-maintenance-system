/**
 * The Data Room's readiness flow.
 *
 * What these tests protect is that the screen can be TRUSTED about what is
 * missing, and that a refused write never looks like a successful one.
 *
 * The shipped data room listed the files that had arrived and showed a
 * percentage. Neither can express "the dealer repair records were never
 * supplied and here is why that limits the conclusion", which is the sentence
 * a customer is actually owed at kickoff — so the first group asserts that a
 * dataset with no file is rendered as a state, with the pack's meaning, rather
 * than omitted.
 *
 * The second group is the ApprovalQueue failure in this surface's clothing: an
 * RLS refusal on PostgREST is zero rows and NO error, so a write the database
 * refused returns cleanly. The Data Room's mutations go through RPCs that
 * return `{error}` in the payload rather than raising, which is the same trap
 * one level up — `data.error` with no `error`. If those are mishandled, a
 * sponsor whose role cannot supply data sees a success and believes their
 * export landed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataRoom } from "./DataRoom";

const rpc = vi.fn();
const from = vi.fn();
const storageRemove = vi.fn();

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    auth: { getUser: vi.fn() },
    storage: {
      from: () => ({
        remove: (...args: unknown[]) => storageRemove(...args),
        upload: vi.fn(),
      }),
    },
  },
}));

const ASSESSMENT = "44444444-0000-0000-0000-000000000001";
const ORG = "11111111-1111-1111-1111-111111111111";

function slot(
  key: string,
  requirement: string,
  readiness: string,
  note: string | null = null,
) {
  return {
    id: `slot-${key}`,
    assessment_id: ASSESSMENT,
    organization_id: ORG,
    dataset_key: key,
    requirement,
    label: key.replaceAll("_", " "),
    minimum_fields: ["asset_id"],
    preferred_history: "24-36 months",
    readiness,
    readiness_note: note,
    rated_at: null,
  };
}

const SLOTS = [
  slot("asset_register", "required", "green", "Identifiers coherent."),
  slot(
    "work_orders",
    "required",
    "amber",
    "Failure coding present on 31% of corrective orders.",
  ),
  slot("pm_plans", "required", "missing"),
  slot(
    "dealer_oem",
    "preferred",
    "missing",
    "Not supplied; external repair spend is not visible.",
  ),
];

const SOURCE = {
  id: "src-1",
  assessment_id: ASSESSMENT,
  slot_id: "slot-work_orders",
  category: "work_orders",
  file_name: "Northstar_WorkOrders_20260809_v01.csv",
  status: "profiled",
  quality_grade: "partial",
  record_count: 21894,
  row_count: 21894,
  column_count: 17,
  identifier_coverage: 0.982,
  coverage_from: "2024-07-01",
  coverage_to: "2026-08-14",
  dq_exceptions: [
    { rows: 15108, reason: "failure_code empty on a corrective order" },
  ],
  missing_required_fields: ["cause_code"],
  content_sha256: "abcdef0123456789",
  object_path: `${ORG}/${ASSESSMENT}/uuid-Northstar_WorkOrders.csv`,
  sensitivity: "customer_confidential" as const,
  raw_retained: true,
  profiled_at: "2026-08-11T00:00:00Z",
  deleted_at: null,
  delete_note: null,
  notes: null,
  created_at: "2026-08-11T00:00:00Z",
};

const RETIRED_SOURCE = {
  ...SOURCE,
  id: "src-2",
  slot_id: "slot-pm_plans",
  category: "pm_plans",
  file_name: "Northstar_PMPlans_20260812_v01.csv",
  deleted_at: "2026-08-18T00:00:00Z",
  delete_note: "Superseded by the 2026-08-19 export.",
};

const CLARIFICATION = {
  id: "clar-1",
  dataset_key: "work_orders",
  question: "Which failure codes does the site consider unreliable?",
  context: "failure_code is empty on 15,108 of 48,600 corrective orders.",
  blocks_analysis: true,
  status: "open" as const,
  answer: null,
  asked_at: "2026-08-13T00:00:00Z",
  answered_at: null,
};

const READINESS = {
  assessment_id: ASSESSMENT,
  scope_confirmed: true,
  asset_register_received: true,
  work_orders_received: true,
  primary_question_agreed: true,
  gaps_explicitly_logged: false,
  kickoff_data_ready: false,
  required_datasets_missing: 1,
  open_blocking_clarifications: 1,
  slots: [],
};

/** PostgREST's shape: a chainable builder resolving to {data, error}. */
function tableRows(rows: unknown[]) {
  const result = Promise.resolve({ data: rows, error: null });
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    builder[method] = () => builder;
  }
  builder.then = result.then.bind(result);
  return builder;
}

function mockLoad({
  slots = SLOTS,
  sources = [SOURCE, RETIRED_SOURCE],
  clarifications = [CLARIFICATION],
  aliases = [] as unknown[],
} = {}) {
  from.mockImplementation((table: string) => {
    if (table === "ria_dataset_slots") return tableRows(slots);
    if (table === "ria_data_sources") return tableRows(sources);
    if (table === "ria_clarifications") return tableRows(clarifications);
    if (table === "ria_asset_aliases") return tableRows(aliases);
    if (table === "assets")
      return tableRows([
        { id: "asset-1", name: "Haul Truck 101", tag: "HT-101" },
        { id: "asset-2", name: "Grader 07", tag: "GR-07" },
      ]);
    return tableRows([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad();
  rpc.mockImplementation((name: string) => {
    if (name === "get_ria_readiness")
      return Promise.resolve({ data: READINESS, error: null });
    return Promise.resolve({ data: { ok: true }, error: null });
  });
});

function renderRoom(
  props: Partial<React.ComponentProps<typeof DataRoom>> = {},
) {
  return render(
    <DataRoom assessmentId={ASSESSMENT} organizationId={ORG} {...props} />,
  );
}

describe("a dataset that never arrived is a state, not an omission", () => {
  it("renders every slot the pack asks for, including the empty ones", async () => {
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("slot-asset_register")).toBeTruthy(),
    );
    // The two that have no file at all are the whole point.
    expect(screen.getByTestId("slot-pm_plans")).toBeTruthy();
    expect(screen.getByTestId("slot-dealer_oem")).toBeTruthy();
  });

  it("shows each readiness state with the pack's meaning, not just a colour", async () => {
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("readiness-work_orders").textContent).toBe(
        "amber",
      ),
    );
    expect(screen.getByTestId("readiness-asset_register").textContent).toBe(
      "green",
    );
    expect(screen.getByTestId("readiness-pm_plans").textContent).toBe(
      "missing",
    );
    expect(
      screen.getByText(
        /Material gaps or inconsistent coding, but useful analysis remains possible/,
      ),
    ).toBeTruthy();
  });

  it("says so when a missing dataset has no gap logged against it", async () => {
    // §8: kickoff is data-ready only when known missing datasets are
    // EXPLICITLY logged. A silent 'missing' slot is the state that blocks it,
    // and the screen has to name that rather than look merely incomplete.
    renderRoom();
    await waitFor(() => expect(screen.getByText(/No gap logged/)).toBeTruthy());
    // …and the one that IS accounted for shows its reason instead.
    expect(
      screen.getByText(/external repair spend is not visible/),
    ).toBeTruthy();
  });

  it("shows the four kickoff conditions separately, not as a percentage", async () => {
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("kickoff-acceptance")).toBeTruthy(),
    );
    const panel = screen.getByTestId("kickoff-acceptance");
    expect(panel.textContent).toContain("Not yet data-ready");
    expect(panel.textContent).toContain("Known gaps explicitly logged");
    expect(panel.textContent).toContain("Asset register received");
    expect(panel.textContent).not.toMatch(/\d+%/);
  });

  it("reports blocking clarifications as blocking", async () => {
    renderRoom();
    // Named in two places on purpose: the kickoff panel counts them, and the
    // clarification itself is badged where it is answered.
    await waitFor(() =>
      expect(screen.getAllByText(/block(s)? analysis/i).length).toBeGreaterThan(
        1,
      ),
    );
    expect(
      screen
        .getByTestId("kickoff-acceptance")
        .textContent?.includes("1 open clarification"),
    ).toBe(true);
    expect(screen.getByText("Blocks analysis")).toBeTruthy();
  });
});

describe("what arrived is described by measurement", () => {
  it("shows the profile, the absent required fields and the DQ exceptions", async () => {
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("source-src-1")).toBeTruthy(),
    );
    const card = screen.getByTestId("source-src-1");
    expect(card.textContent).toContain("21,894 rows");
    expect(card.textContent).toContain("98%");
    expect(card.textContent).toContain("2024-07-01");
    // The rejects surface. A rejection nobody sees is a dropped row.
    expect(card.textContent).toContain("15,108 rows");
    expect(card.textContent).toContain(
      "failure_code empty on a corrective order",
    );
    expect(card.textContent).toContain("cause_code");
  });

  it("keeps a retired source visible as its audit stub", async () => {
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("retired-src-2")).toBeTruthy(),
    );
    const stub = screen.getByTestId("retired-src-2");
    expect(stub.textContent).toContain("Northstar_PMPlans_20260812_v01.csv");
    expect(stub.textContent).toContain("Superseded by the 2026-08-19 export.");
  });
});

describe("a refused write is never rendered as a success", () => {
  it("surfaces the RPC's refusal payload instead of reporting success", async () => {
    // The trap: PostgREST returns error:null and the refusal lives in the
    // jsonb payload. Treating that as success tells a sponsor their rating
    // landed when the database declined it.
    rpc.mockImplementation((name: string) => {
      if (name === "get_ria_readiness")
        return Promise.resolve({ data: READINESS, error: null });
      return Promise.resolve({
        data: {
          error:
            "rating dataset readiness requires an engineering or administrator role",
        },
        error: null,
      });
    });
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("slot-pm_plans")).toBeTruthy(),
    );

    const slotCard = screen.getByTestId("slot-pm_plans");
    fireEvent.click(slotCard.querySelector("button")!);
    fireEvent.change(screen.getByLabelText("Readiness reason for pm plans"), {
      target: { value: "Looks fine to me." },
    });
    fireEvent.click(screen.getByText("Record rating"));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((a) =>
          a.textContent?.includes(
            "requires an engineering or administrator role",
          ),
        ),
      ).toBe(true);
    });
  });

  it("surfaces a transport error too", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_ria_readiness")
        return Promise.resolve({ data: READINESS, error: null });
      return Promise.resolve({
        data: null,
        error: { message: "permission denied for function" },
      });
    });
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("slot-pm_plans")).toBeTruthy(),
    );
    fireEvent.click(screen.getByLabelText("Answer: " + CLARIFICATION.question));
    fireEvent.change(
      screen.getByLabelText("Answer: " + CLARIFICATION.question),
      { target: { value: "Codes 3xx are unreliable." } },
    );
    fireEvent.click(screen.getByText("Record answer"));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((a) =>
          a.textContent?.includes("permission denied for function"),
        ),
      ).toBe(true);
    });
  });

  it("reports the rollup's own refusal rather than rendering an empty room", async () => {
    rpc.mockImplementation(() =>
      Promise.resolve({
        data: { error: "assessment not found in current organization" },
        error: null,
      }),
    );
    renderRoom();
    await waitFor(() => {
      expect(
        screen.getByText(/assessment not found in current organization/),
      ).toBeTruthy();
    });
  });
});

describe("the screen cannot colour a dataset by itself", () => {
  it("offers no rating control to a role that may not rate", async () => {
    renderRoom({ canRate: false });
    await waitFor(() =>
      expect(screen.getByTestId("slot-pm_plans")).toBeTruthy(),
    );
    expect(screen.queryByText("Rate readiness")).toBeNull();
  });

  it("offers no upload control to a role that may not supply", async () => {
    renderRoom({ canSupply: false });
    await waitFor(() =>
      expect(screen.getByTestId("slot-pm_plans")).toBeTruthy(),
    );
    expect(screen.queryByLabelText(/^Upload /)).toBeNull();
  });

  it("sends the rating through the governed RPC, with its reason", async () => {
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("slot-pm_plans")).toBeTruthy(),
    );
    const slotCard = screen.getByTestId("slot-pm_plans");
    fireEvent.click(slotCard.querySelector("button")!);
    fireEvent.change(screen.getByLabelText("Readiness rating for pm plans"), {
      target: { value: "red" },
    });
    fireEvent.change(screen.getByLabelText("Readiness reason for pm plans"), {
      target: { value: "No PM plans supplied; compliance is unmeasurable." },
    });
    fireEvent.click(screen.getByText("Record rating"));

    await waitFor(() =>
      expect(
        rpc.mock.calls.some(
          ([name, args]) =>
            name === "set_ria_dataset_readiness" &&
            (args as { p_readiness: string }).p_readiness === "red" &&
            (args as { p_note: string }).p_note.includes("unmeasurable"),
        ),
      ).toBe(true),
    );
  });

  // -------------------------------------------------------------------------
  // Retention: the card renders a claim, so the claim has to be true.
  // -------------------------------------------------------------------------

  it("states each source's sensitivity, because handling depends on it", async () => {
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("slot-work_orders")).toBeTruthy(),
    );
    expect(screen.getByTestId("slot-work_orders").textContent).toContain(
      "customer confidential",
    );
  });

  it("retirement purges the raw export and says so when it worked", async () => {
    // THE DEFECT. retire_ria_data_source() keeps the metadata row forever, and
    // the first storage DELETE policy refused any object still referenced by
    // one — so the raw customer export was permanently undeletable through the
    // application, while the card said "Raw export retained" from a flag
    // nothing could ever clear. Retirement now: stub first, then remove the
    // object, then flip the flag — in that order, and only on success.
    storageRemove.mockResolvedValue({ data: [{}], error: null });
    vi.stubGlobal("prompt", () => "Contracted retention period elapsed.");
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("slot-work_orders")).toBeTruthy(),
    );
    fireEvent.click(screen.getByLabelText(/Retire/i));

    await waitFor(() =>
      expect(
        rpc.mock.calls.some(([name]) => name === "retire_ria_data_source"),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(storageRemove).toHaveBeenCalledWith([SOURCE.object_path]),
    );
    await waitFor(() =>
      expect(
        rpc.mock.calls.some(
          ([name]) => name === "confirm_ria_source_raw_purged",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "raw export purged",
      ),
    );
    vi.unstubAllGlobals();
  });

  it("...and says the opposite, loudly, when the purge failed", async () => {
    // The stub is written either way. Whether the file left the bucket is a
    // separate fact and is reported as one — a retention claim the software
    // cannot back up is worse than no claim.
    storageRemove.mockResolvedValue({
      data: null,
      error: { message: "storage: object not owned by caller" },
    });
    vi.stubGlobal("prompt", () => "Contracted retention period elapsed.");
    renderRoom();
    await waitFor(() =>
      expect(screen.getByTestId("slot-work_orders")).toBeTruthy(),
    );
    fireEvent.click(screen.getByLabelText(/Retire/i));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "was NOT purged",
      ),
    );
    // The flag is never flipped on a failed removal.
    expect(
      rpc.mock.calls.some(([name]) => name === "confirm_ria_source_raw_purged"),
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // The alias map could not reach a canonical asset at all.
  // -------------------------------------------------------------------------

  it("resolves an alias to the CANONICAL asset, not only to free text", async () => {
    // `p_canonical_asset_id: null` was hardcoded, so canonical_asset_id was
    // permanently NULL, `resolved` could only ever be earned by a string, and
    // the RPC's org-checked asset lookup was unreachable. Invariant 1 is one
    // canonical asset hierarchy; an alias map that can only point at a string
    // is a second one.
    renderRoom();
    await waitFor(() =>
      expect(screen.getByLabelText("Canonical asset")).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText("Alias source system"), {
      target: { value: "Finning" },
    });
    fireEvent.change(screen.getByLabelText("Source alias"), {
      target: { value: "CAT-793-0041" },
    });
    fireEvent.change(screen.getByLabelText("Canonical asset"), {
      target: { value: "asset-1" },
    });
    fireEvent.click(screen.getByText("Map alias"));

    await waitFor(() =>
      expect(
        rpc.mock.calls.some(
          ([name, args]) =>
            name === "upsert_ria_asset_alias" &&
            (args as { p_canonical_asset_id: string | null })
              .p_canonical_asset_id === "asset-1",
        ),
      ).toBe(true),
    );
  });

  it("offers the tenant's own assets, and only those RLS returned", async () => {
    renderRoom();
    await waitFor(() =>
      expect(screen.getByLabelText("Canonical asset")).toBeTruthy(),
    );
    const options = [
      ...screen.getByLabelText("Canonical asset").querySelectorAll("option"),
    ].map((o) => o.textContent);
    expect(options).toContain("HT-101 — Haul Truck 101");
    expect(options).toContain("GR-07 — Grader 07");
  });
});
