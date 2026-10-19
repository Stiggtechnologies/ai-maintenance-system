import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldPage } from "./FieldPage";

const listRecentFieldReports = vi.fn();
const reportFailure = vi.fn();

vi.mock("../services/fieldReports", () => ({
  listRecentFieldReports: () => listRecentFieldReports(),
}));

vi.mock("../services/fieldCapture", () => ({
  reportFailure: (...args: unknown[]) => reportFailure(...args),
}));

const dictationStart = vi.fn();
let dictationCallback: ((text: string) => void) | null = null;
vi.mock("../hooks/useDictation", () => ({
  useDictation: (cb: (text: string) => void) => {
    dictationCallback = cb;
    return {
      supported: true,
      listening: false,
      error: null,
      start: dictationStart,
      stop: vi.fn(),
    };
  },
}));

const ASSET_ID = "3f2a9c1e-8b7d-4e6f-9a1b-2c3d4e5f6a7b";

function renderField(path = "/field") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <FieldPage />
    </MemoryRouter>,
  );
}

const REPORT = {
  id: "n-1",
  description: "Hydraulic leak at the boom joint",
  notification_type: "fault",
  status: "open",
  reported_by: "Technician 2",
  created_at: "2026-08-28T06:00:00Z",
  asset_id: "a-1",
  asset_tag: "T301",
  asset_name: "Haul truck T301",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FieldPage", () => {
  it("first paint is the composer, not a how-to landing or /assets hop", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByPlaceholderText("What did you observe?"),
    ).toBeTruthy();
    expect(screen.getByTestId("sample-seed-chip")).toHaveTextContent(
      "Seal weep on the inboard gland",
    );
    expect(screen.queryByLabelText("Camera")).toBeNull();
    expect(screen.queryByLabelText("QR")).toBeNull();
    expect(screen.queryByText(/Find the asset \(then scan its label\)/i)).toBeNull();
    expect(screen.queryByText(/Report a failure on the equipment/i)).toBeNull();
    expect(document.querySelector('[data-layout="chat-first"]')).toBeTruthy();
  });

  it("renders a filed report as a user turn, not a home list", async () => {
    listRecentFieldReports.mockResolvedValue([REPORT]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Hydraulic leak at the boom joint/)).toBeTruthy();
    expect(screen.getByText(/T301/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("surfaces load errors", async () => {
    listRecentFieldReports.mockRejectedValue(new Error("rls refused"));
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/rls refused/i);
  });

  it("sending a note creates a user turn in the thread", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("What did you observe?");
    fireEvent.change(screen.getByPlaceholderText("What did you observe?"), {
      target: { value: "Seal weep on the inboard gland" },
    });
    fireEvent.click(screen.getByTitle("Send message"));
    expect(await screen.findByText("Seal weep on the inboard gland")).toBeTruthy();
  });

  it("QR is a composer tool that attaches to the turn", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("What did you observe?");
    fireEvent.click(screen.getByTestId("sample-seed-chip"));
    fireEvent.click(screen.getByLabelText("QR"));
    fireEvent.change(screen.getByLabelText("Asset tag or QR payload"), {
      target: { value: "T301" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(screen.getByText("T301")).toBeTruthy();
    expect(screen.getByText(/Asset tag will be sent with this turn/)).toBeTruthy();
    expect(screen.getByLabelText("Camera")).toBeTruthy();
  });

  it("says plainly when a note was not filed because no asset is attached", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    renderField();
    await screen.findByPlaceholderText("What did you observe?");
    fireEvent.change(screen.getByPlaceholderText("What did you observe?"), {
      target: { value: "Seal weep on the inboard gland" },
    });
    fireEvent.click(screen.getByTitle("Send message"));
    expect(await screen.findByText(/Not filed\. Add the asset first/)).toBeTruthy();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("refuses a tag that is not an asset id instead of silently dropping it", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    renderField("/field?mode=hands-free");
    await screen.findByPlaceholderText("What did you observe?");
    fireEvent.click(screen.getByRole("button", { name: /Enter asset/ }));
    fireEvent.change(screen.getByLabelText("Asset tag or QR payload"), {
      target: { value: "T301" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    fireEvent.change(screen.getByPlaceholderText("What did you observe?"), {
      target: { value: "Hydraulic leak at the boom joint" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    expect(await screen.findByText(/"T301" is a tag, not an asset ID/)).toBeTruthy();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("hands-free shows labelled tools on first paint and files with the chosen type", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    reportFailure.mockResolvedValue({ notificationId: "n-42" });
    renderField("/field?mode=hands-free");
    await screen.findByPlaceholderText("What did you observe?");
    expect(document.querySelector('[data-mode="hands-free"]')).toBeTruthy();
    for (const label of [/Speak/, /Take photo/, /Enter asset/, /Send report/]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Safety" }));
    expect(screen.getByRole("button", { name: "Safety" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Enter asset/ }));
    fireEvent.change(screen.getByLabelText("Asset tag or QR payload"), {
      target: { value: `https://app.syncai.ca/assets/${ASSET_ID}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    fireEvent.change(screen.getByPlaceholderText("What did you observe?"), {
      target: { value: "Guard missing on tail pulley" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    expect(await screen.findByText(/Filed as a safety notification \(n-42\)/)).toBeTruthy();
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: ASSET_ID,
        description: "Guard missing on tail pulley",
        notificationType: "safety",
      }),
    );
  });

  it("voice dictation fills the report and voice commands set type and send", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    renderField("/field?mode=hands-free");
    await screen.findByPlaceholderText("What did you observe?");
    fireEvent.click(screen.getByRole("button", { name: /Speak/ }));
    expect(dictationStart).toHaveBeenCalled();
    await act(async () => dictationCallback?.("Bearing running hot on the drive end"));
    expect(screen.getByPlaceholderText("What did you observe?")).toHaveValue(
      "Bearing running hot on the drive end",
    );
    await act(async () => dictationCallback?.("Fault."));
    expect(screen.getByRole("button", { name: "Fault" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => dictationCallback?.("send report"));
    expect(await screen.findByText(/Not filed\. Add the asset first/)).toBeTruthy();
  });

  it("surfaces a filing error as a not-filed turn", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    reportFailure.mockRejectedValue(new Error("choose the equipment this was observed on"));
    renderField("/field?mode=hands-free");
    await screen.findByPlaceholderText("What did you observe?");
    fireEvent.click(screen.getByRole("button", { name: /Enter asset/ }));
    fireEvent.change(screen.getByLabelText("Asset tag or QR payload"), {
      target: { value: ASSET_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    fireEvent.change(screen.getByPlaceholderText("What did you observe?"), {
      target: { value: "Belt tracking off" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    expect(await screen.findByText(/Not filed: choose the equipment/)).toBeTruthy();
  });
});
