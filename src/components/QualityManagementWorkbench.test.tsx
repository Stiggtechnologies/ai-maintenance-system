import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { QualityManagementWorkbench } from "./QualityManagementWorkbench";
import {
  executeQualityAction,
  getQualityCockpit,
  type QualityCockpit,
} from "../services/qualityManagementService";

const auth = vi.hoisted(() => ({
  context: {
    loading: false,
    user: { id: "author-a" },
    profile: { id: "author-a", organization_id: "org-a", role: "manager" },
  } as {
    loading: boolean;
    user: { id: string } | null;
    profile: { id: string; organization_id: string; role: string } | null;
  },
  getUser: vi.fn(),
}));
vi.mock("./AuthProvider", () => ({ useOptionalAuth: () => auth.context }));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: auth.getUser } },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

vi.mock("../services/qualityManagementService", () => ({
  getQualityCockpit: vi.fn().mockResolvedValue({
    metrics: [
      "First-pass yield",
      "Defect rate",
      "Rework rate",
      "Scrap rate",
      "Acceptance-test pass rate",
      "NCR closure rate",
      "Overdue open-NCR rate",
    ].map((label, index) => ({
      key: `metric-${index}`,
      label,
      value: 90,
      unit: "%",
      numerator: 9,
      denominator: 10,
      formula: "derived",
    })),
    ncrAging: {
      open: 1,
      overdue: 1,
      averageOpenAgeDays: 3,
      oldestOpenAgeDays: 3,
    },
    costByCurrency: [
      {
        currency: "CAD",
        prevention: 10,
        appraisal: 20,
        internalFailure: 30,
        externalFailure: 40,
        copqByTerm: {
          rework: 10,
          scrap: 5,
          retesting: 4,
          delay: 6,
          claims: 40,
          startup_failures: 5,
        },
        unattributedFailure: 0,
        costOfPoorQuality: 70,
        totalCostOfQuality: 100,
      },
    ],
    forecastAttribution: [
      {
        developmentCaseId: "case-1",
        caseRef: "DEV-001",
        caseTitle: "Debottleneck project",
        currency: "CAD",
        qualityFailureGrowth: 7_800_000,
        scopeGrowth: 2_200_000,
        combinedGrowth: 10_000_000,
        qualitySharePct: 78,
        qualityEntryCount: 3,
        scopeChangeCount: 2,
        uncostedScopeChangeCount: 0,
        basis: "Recorded attribution only.",
      },
    ],
    requirements: [],
    itps: [],
    itpPoints: [],
    ncrs: [],
    defects: [],
    rework: [],
    acceptanceTests: [],
    basis: "Derived from atomic evidence.",
  }),
  executeQualityAction: vi.fn().mockResolvedValue({ id: 1, status: "draft" }),
}));

describe("QualityManagementWorkbench", () => {
  let fixture: QualityCockpit;
  beforeAll(async () => {
    fixture = await getQualityCockpit();
  });
  beforeEach(() => {
    auth.context = {
      loading: false,
      user: { id: "author-a" },
      profile: { id: "author-a", organization_id: "org-a", role: "manager" },
    };
    auth.getUser.mockReset().mockImplementation(async () => ({
      data: { user: auth.context.user },
      error: null,
    }));
    vi.mocked(getQualityCockpit).mockReset().mockResolvedValue(fixture);
    vi.mocked(executeQualityAction)
      .mockReset()
      .mockResolvedValue({ id: 1, status: "draft" });
  });
  it("exposes the seven metrics, COPQ and all controlled quality actions", async () => {
    render(<QualityManagementWorkbench />);
    expect(
      await screen.findByText("Quality management & assurance"),
    ).toBeInTheDocument();
    expect(screen.getByText("First-pass yield")).toBeInTheDocument();
    expect(screen.getByText("Overdue open-NCR rate")).toBeInTheDocument();
    expect(
      screen.getByText(/COPQ = internal 30 \+ external 40/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Rework 10/)).toBeInTheDocument();
    expect(screen.getByText(/Quality-driven 7,800,000/)).toBeInTheDocument();
    expect(screen.getByText(/78% of attributed growth/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("Quality action").querySelectorAll("option"),
    ).toHaveLength(13);
    expect(
      screen.getByText(/ONE project requirement table/),
    ).toBeInTheDocument();
  });

  it("refuses malformed action JSON before execution", async () => {
    render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    fireEvent.change(screen.getByLabelText("Governed quality payload"), {
      target: { value: "{" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & record" }));
    expect(screen.getByText("Payload must be valid JSON.")).toBeInTheDocument();
  });

  it("hides all customer data and payload immediately on sign-out", async () => {
    const view = render(<QualityManagementWorkbench />);
    await screen.findByText("Debottleneck project", { exact: false });
    auth.context = { loading: false, user: null, profile: null };
    view.rerender(<QualityManagementWorkbench />);
    expect(screen.queryByText(/Debottleneck project/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Governed quality payload"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Sign in to access governed quality records/),
    ).toBeInTheDocument();
  });

  it("does not read or write while the profile belongs to a different user", async () => {
    auth.context.user = { id: "author-b" };
    render(<QualityManagementWorkbench />);
    expect(getQualityCockpit).not.toHaveBeenCalled();
    expect(executeQualityAction).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Governed quality payload"),
    ).not.toBeInTheDocument();
  });

  it("discards an old read even after switching away and back to the same scope", async () => {
    const baseline = await getQualityCockpit();
    const old = deferred<typeof baseline>();
    vi.mocked(getQualityCockpit)
      .mockResolvedValueOnce(baseline)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(baseline);
    const view = render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh quality records" }),
    );
    await waitFor(() => expect(getQualityCockpit).toHaveBeenCalledTimes(3));
    auth.context.profile = {
      ...auth.context.profile!,
      organization_id: "org-b",
    };
    view.rerender(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    auth.context.profile = {
      ...auth.context.profile!,
      organization_id: "org-a",
    };
    view.rerender(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    await act(async () =>
      old.resolve({ ...baseline, basis: "obsolete tenant read" }),
    );
    expect(screen.queryByText("obsolete tenant read")).not.toBeInTheDocument();
  });

  it("clears prior data when refresh authentication fails, without a sign-out event", async () => {
    render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    auth.getUser.mockRejectedValueOnce(new Error("Session validation failed"));
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh quality records" }),
    );
    await screen.findByText("Session validation failed");
    expect(screen.queryByText(/Debottleneck project/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Governed quality payload"),
    ).not.toBeInTheDocument();
    expect(getQualityCockpit).toHaveBeenCalledTimes(1);
  });

  it("freezes pending intent and discards mutation completion after an org switch", async () => {
    const pending = deferred<Record<string, unknown>>();
    vi.mocked(executeQualityAction).mockReturnValueOnce(pending.promise);
    const view = render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    fireEvent.click(screen.getByRole("button", { name: "Validate & record" }));
    await waitFor(() => expect(executeQualityAction).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Quality action")).toBeDisabled();
    expect(screen.getByLabelText("Governed quality payload")).toBeDisabled();
    auth.context.profile = {
      ...auth.context.profile!,
      organization_id: "org-b",
    };
    view.rerender(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    const reads = vi.mocked(getQualityCockpit).mock.calls.length;
    await act(async () =>
      pending.resolve({ id: 999, status: "old tenant result" }),
    );
    expect(screen.queryByText(/old tenant result/)).not.toBeInTheDocument();
    expect(getQualityCockpit).toHaveBeenCalledTimes(reads);
  });

  it.each(["organization", "user", "role", "unmount"])(
    "does not start a write after deferred preflight and %s change",
    async (change) => {
      const pending = deferred<{
        data: { user: { id: string } };
        error: null;
      }>();
      const view = render(<QualityManagementWorkbench />);
      await screen.findByText("Quality management & assurance");
      auth.getUser.mockReturnValueOnce(pending.promise);
      fireEvent.click(
        screen.getByRole("button", { name: "Validate & record" }),
      );
      if (change === "unmount") view.unmount();
      else {
        if (change === "organization")
          auth.context.profile = {
            ...auth.context.profile!,
            organization_id: "org-b",
          };
        if (change === "role")
          auth.context.profile = { ...auth.context.profile!, role: "viewer" };
        if (change === "user")
          auth.context = {
            loading: false,
            user: { id: "author-b" },
            profile: {
              id: "author-b",
              organization_id: "org-b",
              role: "manager",
            },
          };
        view.rerender(<QualityManagementWorkbench />);
      }
      await act(async () =>
        pending.resolve({ data: { user: { id: "author-a" } }, error: null }),
      );
      expect(executeQualityAction).not.toHaveBeenCalled();
    },
  );

  it.each(["missing-org", "missing-role", "loading"])(
    "fails closed for %s",
    (state) => {
      if (state === "missing-org") auth.context.profile!.organization_id = "";
      if (state === "missing-role") auth.context.profile!.role = "";
      if (state === "loading") auth.context.loading = true;
      render(<QualityManagementWorkbench />);
      expect(getQualityCockpit).not.toHaveBeenCalled();
      expect(
        screen.queryByLabelText("Governed quality payload"),
      ).not.toBeInTheDocument();
    },
  );

  it("retains acknowledgement when the subsequent refresh fails", async () => {
    render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    vi.mocked(getQualityCockpit).mockRejectedValueOnce(
      new Error("Read unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Validate & record" }));
    await screen.findByText("Read unavailable");
    expect(
      screen.getByText(/The last action was acknowledged/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Debottleneck project/)).not.toBeInTheDocument();
    expect(executeQualityAction).toHaveBeenCalledTimes(1);
  });

  it("removes private ACK details and draft after post-commit authentication denial", async () => {
    render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    vi.mocked(executeQualityAction).mockResolvedValueOnce({
      id: 1,
      title: "private returned title",
    });
    fireEvent.change(screen.getByLabelText("Governed quality payload"), {
      target: { value: '{"title":"private draft"}' },
    });
    auth.getUser
      .mockResolvedValueOnce({
        data: { user: { id: "author-a" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: "Session denied after commit" },
      });
    fireEvent.click(screen.getByRole("button", { name: "Validate & record" }));
    await screen.findByText("Session denied after commit");
    expect(
      screen.getByText(/The last action was acknowledged/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/private returned title/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Governed quality payload"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Quality management & assurance");
    expect(screen.getByLabelText("Governed quality payload")).not.toHaveValue(
      '{"title":"private draft"}',
    );
    expect(executeQualityAction).toHaveBeenCalledTimes(1);
  });

  it("does not automatically replay a write after a lost acknowledgement", async () => {
    render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    vi.mocked(executeQualityAction).mockRejectedValueOnce(
      new Error("Network response lost"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Validate & record" }));
    await screen.findByText(/outcome may be unknown/);
    expect(executeQualityAction).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/The last action was acknowledged/),
    ).not.toBeInTheDocument();
  });

  it("does not carry a previous acknowledgement into a new uncertain command", async () => {
    render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    fireEvent.click(screen.getByRole("button", { name: "Validate & record" }));
    await waitFor(() => expect(getQualityCockpit).toHaveBeenCalledTimes(2));
    await screen.findByText("Quality management & assurance");
    vi.mocked(executeQualityAction).mockRejectedValueOnce(
      new Error("New response lost"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Validate & record" }));
    await screen.findByText(/outcome may be unknown/);
    vi.mocked(getQualityCockpit).mockRejectedValueOnce(
      new Error("Refresh also unavailable"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh quality records" }),
    );
    await screen.findByText("Refresh also unavailable");
    expect(
      screen.queryByText(/The last action was acknowledged/),
    ).not.toBeInTheDocument();
    expect(executeQualityAction).toHaveBeenCalledTimes(2);
  });

  it("ignores a second submission while authentication preflight is pending", async () => {
    const pending = deferred<{ data: { user: { id: string } }; error: null }>();
    render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    auth.getUser.mockReturnValueOnce(pending.promise);
    const submit = screen.getByRole("button", { name: "Validate & record" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    expect(executeQualityAction).not.toHaveBeenCalled();
    await act(async () =>
      pending.resolve({ data: { user: { id: "author-a" } }, error: null }),
    );
    await screen.findByText("Quality management & assurance");
    expect(executeQualityAction).toHaveBeenCalledTimes(1);
  });

  it("ignores rejected old reads after the observed organization changes", async () => {
    const pending = deferred<QualityCockpit>();
    vi.mocked(getQualityCockpit).mockReturnValueOnce(pending.promise);
    const view = render(<QualityManagementWorkbench />);
    await waitFor(() => expect(getQualityCockpit).toHaveBeenCalledTimes(1));
    auth.context.profile = {
      ...auth.context.profile!,
      organization_id: "org-b",
    };
    view.rerender(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    await act(async () => pending.reject(new Error("Old organization failed")));
    expect(
      screen.queryByText("Old organization failed"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Quality management & assurance"),
    ).toBeInTheDocument();
  });

  it("fences StrictMode lifecycle replay before the old preflight starts a read", async () => {
    render(
      <StrictMode>
        <QualityManagementWorkbench />
      </StrictMode>,
    );
    await screen.findByText("Quality management & assurance");
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    expect(getQualityCockpit).toHaveBeenCalledTimes(1);
  });

  it.each(["null", "different", "error"])(
    "clears cached data when refreshed authentication returns %s",
    async (state) => {
      render(<QualityManagementWorkbench />);
      await screen.findByText("Quality management & assurance");
      auth.getUser.mockResolvedValueOnce({
        data: {
          user:
            state === "null"
              ? null
              : { id: state === "different" ? "other-user" : "author-a" },
        },
        error: state === "error" ? { message: "Auth no longer valid" } : null,
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh quality records" }),
      );
      await screen.findByText("Showing no data rather than stale values.");
      expect(
        screen.queryByText(/Debottleneck project/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Governed quality payload"),
      ).not.toBeInTheDocument();
      expect(getQualityCockpit).toHaveBeenCalledTimes(1);
      expect(executeQualityAction).not.toHaveBeenCalled();
    },
  );
});
