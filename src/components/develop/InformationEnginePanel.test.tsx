import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { InformationEnginePanel } from "./EventBusPanels";

const read = vi.hoisted(() => vi.fn());
vi.mock("../../services/developService", () => ({ getCaseInformationEngine: read }));
beforeEach(() => read.mockReset());

it("removes previous case evidence when the next case cannot be read", async () => {
  read.mockResolvedValueOnce({ headline: "Case A evidence" })
    .mockRejectedValueOnce(new Error("Case B unavailable"));
  const { rerender } = render(<InformationEnginePanel caseId="a" />);
  await screen.findByText("Case A evidence");
  rerender(<InformationEnginePanel caseId="b" />);
  await screen.findByText("Case B unavailable");
  expect(screen.queryByText("Case A evidence")).not.toBeInTheDocument();
});

it("clears the previous reading during a same-case refresh and reports failure", async () => {
  let failRefresh!: (error: Error) => void;
  read.mockResolvedValueOnce({ headline: "Previous reading" })
    .mockReturnValueOnce(new Promise((_resolve, reject) => { failRefresh = reject; }));
  const { rerender } = render(<InformationEnginePanel caseId="a" reloadKey={0} />);
  await screen.findByText("Previous reading");
  rerender(<InformationEnginePanel caseId="a" reloadKey={1} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading information evidence");
  expect(screen.queryByText("Previous reading")).not.toBeInTheDocument();
  await act(async () => failRefresh(new Error("Refresh unavailable")));
  expect(screen.getByText("Refresh unavailable")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("ignores an old case failure after a current case succeeds", async () => {
  let failOld!: (error: Error) => void;
  read.mockReturnValueOnce(new Promise((_resolve, reject) => { failOld = reject; }))
    .mockResolvedValueOnce({ headline: "Current evidence" });
  const { rerender } = render(<InformationEnginePanel caseId="a" />);
  rerender(<InformationEnginePanel caseId="b" />);
  await screen.findByText("Current evidence");
  await act(async () => failOld(new Error("Old case failure")));
  expect(screen.queryByText("Old case failure")).not.toBeInTheDocument();
  expect(screen.getByText("Current evidence")).toBeInTheDocument();
});

it("ignores a previous case response arriving after the current case", async () => {
  let finishOld!: (value: Record<string, unknown>) => void;
  read.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce({ headline: "Case B evidence" });
  const { rerender } = render(<InformationEnginePanel caseId="a" />);
  rerender(<InformationEnginePanel caseId="b" />);
  await screen.findByText("Case B evidence");
  await act(async () => finishOld({ headline: "Case A evidence" }));
  expect(screen.getByText("Case B evidence")).toBeInTheDocument();
  expect(screen.queryByText("Case A evidence")).not.toBeInTheDocument();
});
