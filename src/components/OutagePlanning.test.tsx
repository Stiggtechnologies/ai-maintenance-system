import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutagePlanning } from "./OutagePlanning";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => {
    if (name === "create_outage_window") {
      return { data: { id: "o1", status: "planned" }, error: null };
    }
    return {
      data: {
        windows: [],
        craft_capacity_recorded: 0,
        note: "No invisible scope growth.",
      },
      error: null,
    };
  });
});

describe("OutagePlanning", () => {
  it("lets an accountable user record a planning window without implying release", async () => {
    render(<OutagePlanning />);
    fireEvent.click(await screen.findByRole("button", { name: "Plan outage window" }));
    fireEvent.change(screen.getByLabelText("Window key"), { target: { value: "TA-27" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Spring turnaround" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2027-04-01T08:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2027-04-02T08:00" } });
    expect(screen.getByText(/does not add work, freeze scope, or authorize execution/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record window" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_outage_window", expect.objectContaining({
      p_window_key: "TA-27",
      p_title: "Spring turnaround",
      p_kind: "shutdown",
      p_site_id: null,
    })));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Record window" })).not.toBeInTheDocument());
  });
});
