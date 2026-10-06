/**
 * Reachability of risk-based inspection planning (BOK-05, register E2.06):
 * the calculation runs on the shared kernel and a plan is recorded only when a
 * person adopts it through the existing record_inspection_plan door.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { RbiPlanner } from "./RbiPlanner";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillValid(target = "0.05") {
  fill("Corrosion circuit ID", "7");
  fill("Generic failure frequency (per year)", "0.00003");
  fill(
    "GFF source (licensed table, edition)",
    "Licensed API 581 Part 2 Table 3.1",
  );
  fill("Damage mechanism", "Internal thinning");
  fill(
    "Damage-factor source (assessment, CML trend)",
    "CML trend 2018–2025 owner assessment",
  );
  fill("Damage factor now", "1");
  fill("Assessed horizon (years)", "10");
  fill("Damage factor at horizon", "101");
  fill("Why this combination (procedure ref.)", "Integrity procedure IP-4 §3");
  fill("Management-system factor", "1");
  fill("F_MS source (audit, score)", "2025 PSM audit score");
  fill("Consequence of failure", "100");
  fill("Consequence source (study ref.)", "Consequence study CA-22");
  fill("Risk target", target);
  fill("Risk-target source (owner criterion)", "Integrity risk target IRT-1");
}

describe("RbiPlanner", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("calculates without recording, then adopts through record_inspection_plan", async () => {
    rpc.mockResolvedValue({
      data: { id: 42, status: "recorded" },
      error: null,
      status: 200,
    });
    render(<RbiPlanner />);
    fillValid();
    fireEvent.click(screen.getByText("Calculate risk"));
    expect(
      await screen.findByText(/Proposed plan: every 18 months/),
    ).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Adopt as inspection plan"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [name, args] = rpc.mock.calls[0] as [
      string,
      { p_plan: Record<string, string> },
    ];
    expect(name).toBe("record_inspection_plan");
    expect(args.p_plan.circuit_id).toBe("7");
    expect(args.p_plan.interval_months).toBe("18");
    expect(args.p_plan.interval_basis).toContain(
      "Licensed API 581 Part 2 Table 3.1",
    );
    expect(
      await screen.findByText("Inspection plan 42 recorded."),
    ).toBeTruthy();
  });

  it("offers no interval when risk is already over target", async () => {
    render(<RbiPlanner />);
    fillValid("0.001");
    fireEvent.click(screen.getByText("Calculate risk"));
    expect(await screen.findByText(/No interval proposed/)).toBeTruthy();
    expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the kernel's refusal when a source is too thin", async () => {
    render(<RbiPlanner />);
    fillValid();
    fill("GFF source (licensed table, edition)", "table");
    fireEvent.click(screen.getByText("Calculate risk"));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /stated basis/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a server refusal from the governed door", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "process-safety authority is required", code: "42501" },
      status: 403,
    });
    render(<RbiPlanner />);
    fillValid();
    fireEvent.click(screen.getByText("Calculate risk"));
    fireEvent.click(await screen.findByText("Adopt as inspection plan"));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /process-safety authority/,
    );
  });

  it.each([
    ["Corrosion circuit ID", "8"],
    ["Generic failure frequency (per year)", "0.00004"],
    ["GFF source (licensed table, edition)", "Another licensed source"],
    ["Damage mechanism", "Another damage mechanism"],
    [
      "Damage-factor source (assessment, CML trend)",
      "Another assessment source",
    ],
    ["Damage factor now", "100"],
    ["Assessed horizon (years)", "8"],
    ["Damage factor at horizon", "51"],
    ["Second mechanism (optional)", "External thinning"],
    ["Second mechanism source", "Another mechanism source"],
    ["Second D_f now", "2"],
    ["Second horizon (years)", "8"],
    ["Second D_f at horizon", "80"],
    ["Combine damage factors", "governing"],
    ["Why this combination (procedure ref.)", "Another approved procedure"],
    ["Management-system factor", "2"],
    ["F_MS source (audit, score)", "Another management audit"],
    ["Consequence of failure", "200"],
    ["Consequence unit", "currency"],
    ["Consequence source (study ref.)", "Another consequence study"],
    ["Risk target", "0.06"],
    ["Risk-target source (owner criterion)", "Another target criterion"],
  ])("invalidates adoption when %s changes", async (label, value) => {
    render(<RbiPlanner />);
    fillValid();
    fireEvent.click(screen.getByText("Calculate risk"));
    expect(await screen.findByText("Adopt as inspection plan")).toBeEnabled();
    fill(label, value);
    expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
    expect(screen.queryByText(/Proposed plan:/)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  const second = [
    ["Second mechanism (optional)", "External thinning"],
    ["Second mechanism source", "External corrosion assessment"],
    ["Second D_f now", "100"],
    ["Second horizon (years)", "10"],
    ["Second D_f at horizon", "200"],
  ];
  it.each(Array.from({ length: 30 }, (_, i) => i + 1))(
    "refuses partial optional mechanism field set %i without recording",
    async (mask) => {
      render(<RbiPlanner />);
      fillValid();
      second.forEach(([label, value], index) => {
        if (mask & (1 << index)) fill(label, value);
      });
      fireEvent.click(screen.getByText("Calculate risk"));
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /second.*incomplete/i,
      );
      expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("includes a complete second mechanism instead of ignoring its current risk", async () => {
    render(<RbiPlanner />);
    fillValid();
    second.forEach(([label, value]) => fill(label, value));
    fireEvent.click(screen.getByText("Calculate risk"));
    expect(await screen.findByText(/No interval proposed/)).toBeTruthy();
    expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["1", "9007199254740992", "9007199254740993", "9223372036854775807"])(
    "preserves exact bigint circuit %s in the proposal, basis and governed RPC",
    async (id) => {
      rpc.mockResolvedValue({
        data: { id: 42, status: "recorded" },
        error: null,
        status: 200,
      });
      render(<RbiPlanner />);
      fillValid();
      fill("Corrosion circuit ID", id);
      fireEvent.click(screen.getByText("Calculate risk"));
      expect(
        await screen.findByText(`Calculated for corrosion circuit ${id}.`),
      ).toBeTruthy();
      fireEvent.click(screen.getByText("Adopt as inspection plan"));
      await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
      expect(rpc.mock.calls[0][1].p_plan.circuit_id).toBe(id);
      expect(rpc.mock.calls[0][1].p_plan.interval_basis).toContain(
        `for circuit ${id}.`,
      );
    },
  );

  it.each([
    "0",
    "-1",
    "1.5",
    "1e3",
    "Infinity",
    "NaN",
    "0x10",
    "+1",
    "007",
    "7oops",
    "9223372036854775808",
    "999999999999999999999999",
  ])(
    "refuses invalid/out-of-range circuit identity %s before calculation",
    async (id) => {
      render(<RbiPlanner />);
      fillValid();
      fill("Corrosion circuit ID", id);
      fireEvent.submit(screen.getByText("Calculate risk").closest("form")!);
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /circuit/i,
      );
      expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each(["success", "refusal"])(
    "freezes submission and cannot apply an old %s to a changed proposal",
    async (outcome) => {
      let resolve!: (value: unknown) => void;
      const pending = new Promise((done) => {
        resolve = done;
      });
      rpc.mockReturnValueOnce(pending).mockResolvedValueOnce({
        data: { id: 43, status: "recorded" },
        error: null,
        status: 200,
      });
      render(<RbiPlanner />);
      fillValid();
      fireEvent.click(screen.getByText("Calculate risk"));
      fireEvent.click(await screen.findByText("Adopt as inspection plan"));
      expect(screen.getByLabelText("Corrosion circuit ID")).toBeDisabled();
      expect(screen.getByLabelText("Combine damage factors")).toBeDisabled();
      expect(screen.getByText("Calculate risk")).toBeDisabled();
      // Programmatic events deliberately go beyond the disabled UI guard.
      fill("Corrosion circuit ID", "8");
      fill("Damage factor at horizon", "51");
      fireEvent.submit(screen.getByText("Calculate risk").closest("form")!);
      expect(screen.queryByText(/Proposed plan: every 37 months/)).toBeNull();
      await act(async () =>
        resolve(
          outcome === "success"
            ? { data: { id: 42, status: "recorded" }, error: null, status: 200 }
            : {
                data: null,
                error: { message: "OLD_REQUEST_REFUSAL", code: "42501" },
                status: 403,
              },
        ),
      );
      expect(screen.queryByText("Inspection plan 42 recorded.")).toBeNull();
      expect(screen.queryByText("OLD_REQUEST_REFUSAL")).toBeNull();
      expect(screen.getByText("Calculate risk")).toBeEnabled();
      fireEvent.click(screen.getByText("Calculate risk"));
      expect(
        await screen.findByText(/Proposed plan: every 37 months/),
      ).toBeTruthy();
      expect(
        screen.getByText("Calculated for corrosion circuit 8."),
      ).toBeTruthy();
      fireEvent.click(screen.getByText("Adopt as inspection plan"));
      expect(
        await screen.findByText("Inspection plan 43 recorded."),
      ).toBeTruthy();
      expect(rpc.mock.calls[0][1].p_plan.circuit_id).toBe("7");
      expect(rpc.mock.calls[1][1].p_plan.circuit_id).toBe("8");
      expect(rpc.mock.calls[1][1].p_plan.interval_months).toBe("37");
    },
  );

  it("prevents repeated in-flight and acknowledged adoption", async () => {
    let resolve!: (value: unknown) => void;
    rpc.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<RbiPlanner />);
    fillValid();
    fireEvent.click(screen.getByText("Calculate risk"));
    const button = await screen.findByText("Adopt as inspection plan");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve({
        data: { id: 42, status: "recorded" },
        error: null,
        status: 200,
      }),
    );
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("clears the busy state and refuses a false success or automatic retry after transport rejection", async () => {
    rpc.mockRejectedValue(new Error("NETWORK_FAILURE"));
    render(<RbiPlanner />);
    fillValid();
    fireEvent.click(screen.getByText("Calculate risk"));
    fireEvent.click(await screen.findByText("Adopt as inspection plan"));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /outcome.*unknown/i,
    );
    expect(screen.getByText("Calculate risk")).toBeEnabled();
    expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
    expect(screen.queryByText(/Inspection plan .* recorded/)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { id: 42, status: "unexpected" },
    { id: 9007199254740992, status: "recorded" },
  ])(
    "does not assert a saved plan without an exact governed acknowledgement %j",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null, status: 200 });
      render(<RbiPlanner />);
      fillValid();
      fireEvent.click(screen.getByText("Calculate risk"));
      fireEvent.click(await screen.findByText("Adopt as inspection plan"));
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /outcome.*unknown/i,
      );
      expect(screen.queryByText(/Inspection plan .* recorded/)).toBeNull();
      expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
    },
  );
  it.each(["fetch", "abort"])(
    "handles the actual Supabase SDK's resolved %s failure after a synthetic commit without duplicate POST",
    async (failure) => {
      let committed = 0;
      const fetch = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          expect(init?.method).toBe("POST");
          committed += 1;
          if (failure === "abort")
            throw new DOMException("Synthetic lost response", "AbortError");
          throw new TypeError("Synthetic response lost after commit");
        },
      );
      const client = createClient(
        "https://synthetic.invalid",
        "synthetic-test-key",
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: `rbi-${failure}`,
          },
          global: { fetch },
        },
      );
      rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
        client.rpc(name, args),
      );
      render(<RbiPlanner />);
      fillValid();
      fireEvent.click(screen.getByText("Calculate risk"));
      fireEvent.click(await screen.findByText("Adopt as inspection plan"));
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /outcome.*unknown/i,
      );
      expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
      expect(screen.getByText("Calculate risk")).toBeEnabled();
      expect(committed).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [0, ""],
    [502, "P0001"],
    [503, "42501"],
    [504, ""],
    [403, "PGRST301"],
    [400, ""],
    [undefined, "42501"],
  ])(
    "treats unqualified RPC outcome status=%s code=%s as unknown",
    async (status, code) => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: "Unqualified provider response", code },
        status,
      });
      render(<RbiPlanner />);
      fillValid();
      fireEvent.click(screen.getByText("Calculate risk"));
      fireEvent.click(await screen.findByText("Adopt as inspection plan"));
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /outcome.*unknown/i,
      );
      expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("retains the qualified governed SQL refusal without claiming a saved plan", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "process-safety authority is required", code: "42501" },
      status: 403,
    });
    render(<RbiPlanner />);
    fillValid();
    fireEvent.click(screen.getByText("Calculate risk"));
    fireEvent.click(await screen.findByText("Adopt as inspection plan"));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /process-safety authority/,
    );
    expect(screen.queryByText(/Inspection plan .* recorded/)).toBeNull();
    expect(screen.getByText("Adopt as inspection plan")).toBeEnabled();
  });

  it.each(["recorded", "refused"])(
    "qualifies the actual SDK's %s response",
    async (outcome) => {
      const fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              outcome === "recorded"
                ? { id: "9223372036854775807", status: "recorded" }
                : {
                    code: "42501",
                    message: "process-safety authority is required",
                    details: null,
                    hint: null,
                  },
            ),
            {
              status: outcome === "recorded" ? 200 : 403,
              headers: { "Content-Type": "application/json" },
            },
          ),
      );
      const client = createClient(
        "https://synthetic.invalid",
        "synthetic-test-key",
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: `rbi-${outcome}`,
          },
          global: { fetch },
        },
      );
      rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
        client.rpc(name, args),
      );
      render(<RbiPlanner />);
      fillValid();
      fireEvent.click(screen.getByText("Calculate risk"));
      fireEvent.click(await screen.findByText("Adopt as inspection plan"));
      if (outcome === "recorded") {
        expect(
          await screen.findByText(
            "Inspection plan 9223372036854775807 recorded.",
          ),
        ).toBeTruthy();
        expect(screen.getByText("Adopt as inspection plan")).toBeDisabled();
      } else {
        expect((await screen.findByRole("alert")).textContent).toMatch(
          /process-safety authority/,
        );
        expect(screen.getByText("Adopt as inspection plan")).toBeEnabled();
        expect(screen.queryByText(/Inspection plan .* recorded/)).toBeNull();
      }
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, 0, 403, 500, 200.5])(
    "requires a qualified success status %s as well as a saved-plan body",
    async (status) => {
      rpc.mockResolvedValue({
        data: { id: 42, status: "recorded" },
        error: null,
        status,
      });
      render(<RbiPlanner />);
      fillValid();
      fireEvent.click(screen.getByText("Calculate risk"));
      fireEvent.click(await screen.findByText("Adopt as inspection plan"));
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /outcome.*unknown/i,
      );
      expect(screen.queryByText(/Inspection plan .* recorded/)).toBeNull();
      expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
    },
  );
});
