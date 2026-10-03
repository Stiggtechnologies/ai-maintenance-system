import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecoveryFieldEvidenceCapture } from "./RecoveryFieldEvidenceCapture";

vi.mock("../services/recoveryFieldEvidence", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../services/recoveryFieldEvidence")>();
  return {
    ...original,
    uploadRecoveryFieldAttachment: vi.fn(),
  };
});

vi.mock("../services/syncRecoveryService", () => ({
  recoveryActions: { addFieldEvidence: vi.fn() },
}));

describe("RecoveryFieldEvidenceCapture", () => {
  it("offers the complete bounded field-input list", () => {
    render(
      <RecoveryFieldEvidenceCapture
        eventId="event-1"
        eventWorkId="work-1"
        disabled={false}
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: /input method/i }),
    ).toHaveTextContent("Video clip");
    expect(
      screen.getByRole("combobox", { name: /input method/i }),
    ).toHaveTextContent("Barcode / QR / RFID / NFC");
    expect(
      screen.getByRole("combobox", { name: /input method/i }),
    ).toHaveTextContent("Signature / attestation");
    expect(
      screen.getByRole("combobox", { name: /input method/i }),
    ).toHaveTextContent("Location / GPS");
  });

  it("exposes device capture for video and the no-authority boundary for signatures", () => {
    render(
      <RecoveryFieldEvidenceCapture
        eventId="event-1"
        eventWorkId="work-1"
        disabled={false}
        onSaved={vi.fn()}
      />,
    );
    const kind = screen.getByRole("combobox", { name: /input method/i });
    fireEvent.change(kind, { target: { value: "video" } });
    expect(screen.getByLabelText(/recovery evidence file/i)).toHaveAttribute(
      "accept",
      "video/*",
    );

    fireEvent.change(kind, { target: { value: "signature" } });
    expect(screen.getByText(/cannot approve a plan/i)).toBeInTheDocument();
    expect(
      screen.getByText(/authorize return to service/i),
    ).toBeInTheDocument();
  });

  it("shows structured controls for measurement, scans and location", () => {
    render(
      <RecoveryFieldEvidenceCapture
        eventId="event-1"
        eventWorkId="work-1"
        disabled={false}
        onSaved={vi.fn()}
      />,
    );
    const kind = screen.getByRole("combobox", { name: /input method/i });
    fireEvent.change(kind, { target: { value: "measurement" } });
    expect(
      screen.getByLabelText(/observed measurement value/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/measurement unit/i)).toBeInTheDocument();

    fireEvent.change(kind, { target: { value: "scan" } });
    expect(screen.getByLabelText(/observed scan value/i)).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /scan symbology/i }),
    ).toBeInTheDocument();

    fireEvent.change(kind, { target: { value: "location" } });
    expect(screen.getByLabelText("Latitude")).toBeInTheDocument();
    expect(screen.getByLabelText("Longitude")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use device location/i }),
    ).toBeInTheDocument();
  });
});
