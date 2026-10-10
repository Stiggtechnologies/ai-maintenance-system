import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImplementationJourneyPanel } from "./ImplementationJourneyPanel";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  resources: vi.fn(),
  send: vi.fn(),
  authCallback: null as null | ((event: string) => void),
}));
vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "actor" } }, error: null }),
      onAuthStateChange: (callback: (event: string) => void) => {
        mocks.authCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));
vi.mock("../../services/implementation/service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../services/implementation/service")
    >();
  return {
    ...actual,
    loadImplementationWorkspace: mocks.load,
    loadImplementationResources: mocks.resources,
    sendImplementationCommand: mocks.send,
  };
});
const w = {
  organizationId: "org",
  receipts: [],
  subscriptions: [
    {
      id: "billing",
      plan: "Plan",
      status: "active",
      source: "azure_marketplace",
    },
  ],
  journeys: [
    {
      id: "journey",
      billingId: "billing",
      outcome: "Find the real failure cause",
      revision: 3,
      phase: "prepared",
      current: false,
      scope: {
        assets: [
          { assetId: "asset", templateId: "twin", mappingEvidenceId: "map" },
        ],
        runIds: [],
      },
      failure: null,
    },
  ],
};
const r = {
  assets: [
    { id: "asset", name: "Customer pump", tag: "P-1", asset_class: "Pump" },
  ],
  templates: [{ id: "twin", title: "Pump", asset_class: "Pump" }],
  evidence: [
    {
      id: "result",
      description: "Verified test result",
      asset_id: "asset",
      evidence_type: "first_result",
    },
  ],
  runs: [],
};
const mount = () =>
  render(
    <MemoryRouter>
      <ImplementationJourneyPanel />
    </MemoryRouter>,
  );
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(structuredClone(w));
  mocks.resources.mockResolvedValue(r);
});
describe("native implementation controls", () => {
  it("makes subscription, asset approval and acceptance separate and links existing services", async () => {
    mount();
    await screen.findByText(
      "Verified company membership loaded. Subscription status below comes from the existing billing authority.",
    );
    fireEvent.click(screen.getByText("Find the real failure cause — prepared"));
    expect(screen.getByText(/Complete asset approval/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Asset checklist and human approval" }),
    ).toHaveAttribute("href", "/onboarding");
    expect(
      screen.queryByRole("button", {
        name: "Accept implementation and handoff",
      }),
    ).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("restores interrupted intent and refuses new commands until it is reconciled", async () => {
    const pending = {
      commandId: "retained",
      billingId: "billing",
      instanceId: "journey",
      revision: 2,
      action: "prepare",
      payload: {},
    };
    sessionStorage.setItem(
      "syncai-implementation-intent:actor:org",
      JSON.stringify(pending),
    );
    mount();
    await screen.findByText("Retry retained command");
    expect(
      screen.getByText("Start or resume purchased implementation"),
    ).toBeDisabled();
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.send.mockResolvedValue({
      commandId: "retained",
      instanceId: "journey",
      revision: 3,
    });
    fireEvent.click(screen.getByText("Retry retained command"));
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(pending, false),
    );
    await waitFor(() =>
      expect(
        sessionStorage.getItem("syncai-implementation-intent:actor:org"),
      ).toBeNull(),
    );
  });
  it("recovers an acknowledgement lost after commitment by reading the canonical receipt", async () => {
    sessionStorage.setItem(
      "syncai-implementation-intent:actor:org",
      JSON.stringify({
        commandId: "retained",
        billingId: "billing",
        instanceId: "journey",
        revision: 2,
        action: "prepare",
        payload: {},
      }),
    );
    mocks.load.mockResolvedValue({
      ...w,
      receipts: [{ commandId: "retained", instanceId: "journey", revision: 3 }],
    });
    mount();
    await screen.findByText("Find the real failure cause — prepared");
    expect(
      screen.queryByText("Retry retained command"),
    ).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem("syncai-implementation-intent:actor:org"),
    ).toBeNull();
  });
  it("retains an unknown outcome and never automatically retries it", async () => {
    const { ImplementationCommandError } =
      await import("../../services/implementation/service");
    mocks.send.mockRejectedValue(
      new ImplementationCommandError("Unknown outcome", "unknown"),
    );
    mount();
    await screen.findByText("Find the real failure cause — prepared");
    fireEvent.click(screen.getByText("Find the real failure cause — prepared"));
    fireEvent.click(screen.getByText("Prepare drafts using existing services"));
    await screen.findByText("Unknown outcome");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      sessionStorage.getItem("syncai-implementation-intent:actor:org"),
    ).not.toBeNull();
    expect(screen.getByText("Retry retained command")).toBeInTheDocument();
  });
  it("requires a successful retained-status read before retrying a new unknown outcome", async () => {
    const { ImplementationCommandError } =
      await import("../../services/implementation/service");
    mocks.send.mockRejectedValue(
      new ImplementationCommandError("Unknown outcome", "unknown"),
    );
    mount();
    await screen.findByText("Find the real failure cause — prepared");
    fireEvent.click(screen.getByText("Find the real failure cause — prepared"));
    fireEvent.click(screen.getByText("Prepare drafts using existing services"));
    await screen.findByText("Unknown outcome");
    expect(screen.getByText("Retry retained command")).toBeDisabled();
    fireEvent.click(screen.getByText("Reload retained status"));
    await waitFor(() =>
      expect(screen.getByText("Retry retained command")).not.toBeDisabled(),
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("preserves a recovered commitment if a later resource read fails", async () => {
    sessionStorage.setItem(
      "syncai-implementation-intent:actor:org",
      JSON.stringify({
        commandId: "retained",
        billingId: "billing",
        instanceId: "journey",
        revision: 2,
        action: "prepare",
        payload: {},
      }),
    );
    mocks.load.mockResolvedValue({
      ...w,
      receipts: [{ commandId: "retained", instanceId: "journey", revision: 3 }],
    });
    mocks.resources.mockRejectedValue(new Error("Resource read unavailable"));
    mount();
    await screen.findByText("Resource read unavailable");
    expect(
      sessionStorage.getItem("syncai-implementation-intent:actor:org"),
    ).toBeNull();
    expect(
      screen.queryByText("Retry retained command"),
    ).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("discards a late response from the previous account and clears visible customer data", async () => {
    let resolve!: (value: unknown) => void;
    mocks.send.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    mount();
    await screen.findByText("Find the real failure cause — prepared");
    fireEvent.click(screen.getByText("Find the real failure cause — prepared"));
    fireEvent.click(screen.getByText("Prepare drafts using existing services"));
    act(() => mocks.authCallback!("SIGNED_OUT"));
    await act(async () => resolve({ instanceId: "journey", revision: 4 }));
    expect(
      screen.queryByText("Find the real failure cause — prepared"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Account changed. Reload the implementation workspace."),
    ).toBeInTheDocument();
    expect(
      sessionStorage.getItem("syncai-implementation-intent:actor:org"),
    ).not.toBeNull();
  });
  it("never claims completed implementation from stale acceptance standing", async () => {
    mocks.load.mockResolvedValue({
      ...w,
      journeys: [{ ...w.journeys[0], phase: "accepted", current: false }],
    });
    mount();
    await screen.findByText("Find the real failure cause — accepted");
    fireEvent.click(screen.getByText("Find the real failure cause — accepted"));
    expect(screen.getByText(/Source standing changed/)).toBeInTheDocument();
  });
});
