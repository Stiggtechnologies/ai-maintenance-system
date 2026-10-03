import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { listOrgEvidenceItems } from "../../services/developService";
import { ProjectEvidenceSearch } from "./ProjectEvidenceSearch";
vi.mock("../../services/developService", () => ({ listOrgEvidenceItems: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it("retrieves older evidence by exact identity without submitting the enclosing form", async () => {
  const id = "98551000-0000-4000-8000-000000000001";
  const rows = [{ id, description: "Archived source", evidence_class: "DOCUMENTED" }];
  vi.mocked(listOrgEvidenceItems).mockResolvedValue(rows);
  const results = vi.fn(); const submit = vi.fn((event) => event.preventDefault());
  render(<form onSubmit={submit}><ProjectEvidenceSearch onResults={results} /></form>);
  fireEvent.change(screen.getByLabelText("Find supporting evidence"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Search evidence" }));
  expect(await screen.findByRole("status")).toHaveTextContent("1 evidence matches");
  expect(listOrgEvidenceItems).toHaveBeenCalledWith(id);
  expect(results).toHaveBeenCalledWith(rows);
  expect(submit).not.toHaveBeenCalled();
});
it("preserves existing options on a search error instead of reporting no matches", async () => {
  vi.mocked(listOrgEvidenceItems).mockRejectedValue(new Error("Evidence unavailable"));
  const results = vi.fn();
  render(<ProjectEvidenceSearch onResults={results} />);
  fireEvent.click(screen.getByRole("button", { name: "Search evidence" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Evidence unavailable");
  expect(results).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
