import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StandardBaselineForm } from "./StandardBaselineForm";
import {
  listOrgEvidenceItems,
  registerStandardWorkBaseline,
} from "../../services/developService";
vi.mock("../../services/developService", () => ({
  listOrgEvidenceItems: vi.fn(),
  registerStandardWorkBaseline: vi.fn(),
}));
it("requires explicit attestation and preserves inputs when authority is refused", async () => {
  vi.mocked(listOrgEvidenceItems).mockResolvedValue([
    { id: "e", description: "Controlled manual", evidence_class: "document" },
  ]);
  vi.mocked(registerStandardWorkBaseline).mockRejectedValue(
    new Error("Approval authority required"),
  );
  render(<StandardBaselineForm onSaved={vi.fn()} />);
  await screen.findByRole("option", { name: "Controlled manual" });
  for (const [label, value] of [
    ["Standard key", "estimate"],
    ["Standard title", "Estimate review"],
    ["Language code", "en"],
    ["Existing procedure content", "Review scope"],
    ["Existing procedure source basis", "Controlled manual section 2"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.change(screen.getByLabelText("Controlled-procedure evidence"), {
    target: { value: "e" },
  });
  expect(
    screen.getByRole("button", { name: "Register verified baseline" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Register verified baseline" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Approval authority required",
  );
  expect(screen.getByLabelText("Existing procedure content")).toHaveValue(
    "Review scope",
  );
});
