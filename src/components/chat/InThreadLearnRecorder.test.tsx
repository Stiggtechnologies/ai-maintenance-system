import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InThreadLearnRecorder } from "./InThreadLearnRecorder";

function fillAndSubmit(note = "leak rate 0 drops/min vs 2 after 48h, 2026-09-04") {
  fireEvent.click(screen.getByLabelText("Achieved"));
  fireEvent.change(screen.getByPlaceholderText(/what was measured/i), {
    target: { value: note },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record outcome" }));
}

describe("InThreadLearnRecorder", () => {
  it("keeps submit disabled until both a result and a measured note are set", () => {
    const onSubmit = vi.fn();
    render(<InThreadLearnRecorder onSubmit={onSubmit} />);
    const submit = screen.getByRole("button", { name: "Record outcome" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/what was measured/i), {
      target: { value: "vibration 2.1 mm/s vs 3.0 limit, 2026-08-29" },
    });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Not achieved"));
    expect(submit).toBeEnabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the server detail only after persist resolves", async () => {
    const onSubmit = vi.fn().mockResolvedValue(
      "Outcome verified as achieved, with the measurement on record. This loop is closed.",
    );
    render(<InThreadLearnRecorder onSubmit={onSubmit} />);
    fillAndSubmit();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "achieved",
        "leak rate 0 drops/min vs 2 after 48h, 2026-09-04",
      ),
    );
    expect(
      await screen.findByText(/This loop is closed/),
    ).toBeTruthy();
    expect(screen.getByTestId("learn-recorded")).toBeTruthy();
  });

  it("surfaces a persist refusal and does not claim a recorded outcome", async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new Error(
        "Recording a verification result is a §70 human act. The AI-operator identity may report that an obligation is open, overdue or unverified; it may not say whether the outcome was achieved.",
      ),
    );
    render(<InThreadLearnRecorder onSubmit={onSubmit} />);
    fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/§70 human act/);
    expect(screen.queryByTestId("learn-recorded")).toBeNull();
  });

  it("refuses an empty persist detail as a failed write", async () => {
    const onSubmit = vi.fn().mockResolvedValue("   ");
    render(<InThreadLearnRecorder onSubmit={onSubmit} />);
    fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /was not recorded/,
    );
    expect(screen.queryByTestId("learn-recorded")).toBeNull();
  });
});
