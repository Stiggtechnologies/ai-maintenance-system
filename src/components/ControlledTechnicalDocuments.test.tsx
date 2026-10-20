import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlledTechnicalDocuments } from "./ControlledTechnicalDocuments";
import {
  getControlledDocumentRegister,
  listControlledDocumentCandidates,
  registerControlledDocument,
  reviewControlledDocument,
  type ControlledDocumentRegister,
} from "../services/controlledDocumentsService";

vi.mock("../services/controlledDocumentsService", () => ({
  getControlledDocumentRegister: vi.fn(),
  listControlledDocumentCandidates: vi.fn(),
  registerControlledDocument: vi.fn(),
  reviewControlledDocument: vi.fn(),
}));

const register: ControlledDocumentRegister = {
  coverage: {
    drawing: 0,
    pid: 0,
    manual: 0,
    procedure: 0,
    inspection_record: 0,
    engineering_standard: 0,
  },
  missingEffectiveKinds: [
    "drawing",
    "pid",
    "manual",
    "procedure",
    "inspection_record",
    "engineering_standard",
  ],
  decisionBoundary:
    "Document effectivity records controlled standing only. It does not approve work or return to service.",
  documents: [
    {
      id: "doc-review",
      sourceId: "pid-100-b",
      title: "Process water P&ID",
      documentClass: "controlled_procedure",
      kind: "pid",
      documentNumber: "PID-100",
      revisionLabel: "B",
      controlStatus: "under_review",
      securityStatus: "cleared",
      applicability: "Process-water train one under all operating modes.",
      effectiveAt: null,
      reviewDueAt: null,
      assetId: null,
      siteId: null,
      standardWorkId: null,
      governanceStandardId: null,
      evidenceItemId: null,
      inspectionPlanId: null,
      supersedesDocumentId: null,
      supersededByDocumentId: null,
      controlBasis: "Approved field redline package for independent review.",
      controlledBy: "engineer-1",
      controlledAt: "2026-10-02T18:00:00Z",
      reviewedBy: null,
      reviewedAt: null,
      reviewBasis: null,
    },
  ],
};

describe("ControlledTechnicalDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getControlledDocumentRegister).mockResolvedValue(register);
    vi.mocked(listControlledDocumentCandidates).mockResolvedValue([
      {
        id: "doc-new",
        source_id: "drawing-22-a",
        title: "Pump arrangement drawing",
        original_filename: "drawing-22-a.pdf",
        document_class: "manufacturer_manual",
        security_status: "cleared",
        uploaded_at: "2026-10-02T17:00:00Z",
      },
    ]);
  });

  it("registers a cleared upload for independent review without authority", async () => {
    vi.mocked(registerControlledDocument).mockResolvedValue({
      documentId: "doc-new",
      controlStatus: "under_review",
      documentNumber: "DWG-22",
      revisionLabel: "A",
      engineeringAuthority: false,
      operationalAuthorization: false,
    });
    render(<ControlledTechnicalDocuments canControl canReview />);
    await screen.findByText("PID-100 · rev B");
    fireEvent.change(screen.getByLabelText("Cleared upload"), {
      target: { value: "doc-new" },
    });
    fireEvent.change(screen.getByLabelText("Document number"), {
      target: { value: "DWG-22" },
    });
    fireEvent.change(screen.getByLabelText("Revision"), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByLabelText("Applicability"), {
      target: { value: "Pump P-22 arrangement at the process-water station." },
    });
    fireEvent.change(screen.getByLabelText("Control basis"), {
      target: {
        value: "Checked manufacturer issue and approved field redline.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Register for independent review",
      }),
    );
    await screen.findByRole("status");
    expect(registerControlledDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-new",
        kind: "drawing",
        documentNumber: "DWG-22",
        revisionLabel: "A",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No work or operating authority was granted",
    );
  });

  it("requires and records an independent AAL2 review basis", async () => {
    vi.mocked(reviewControlledDocument).mockResolvedValue({
      documentId: "doc-review",
      controlStatus: "effective",
      supersededDocumentId: null,
      segregationOfDuties: true,
      engineeringAuthority: false,
      operationalAuthorization: false,
    });
    render(<ControlledTechnicalDocuments canControl={false} canReview />);
    await screen.findByText("PID-100 · rev B");
    fireEvent.change(
      screen.getByPlaceholderText(
        "Independent review basis (minimum 20 characters)",
      ),
      {
        target: {
          value: "Verified against the approved redline and field walkdown.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Mark revision effective" }),
    );
    await screen.findByRole("status");
    expect(reviewControlledDocument).toHaveBeenCalledWith({
      documentId: "doc-review",
      decision: "effective",
      basis: "Verified against the approved redline and field walkdown.",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "no work, risk or return-to-service approval",
    );
  });
});
