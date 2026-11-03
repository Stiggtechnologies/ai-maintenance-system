import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentRevisionControl } from "./DocumentRevisionControl";
import {
  decideDocumentRevision,
  getDocumentRevisionRegister,
  listDocumentRevisionCandidates,
  submitDocumentRevision,
  type DocumentRevisionRegister,
} from "../services/documentRevisionService";

let role = "reliability_engineer";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    profile: {
      id: "reviewer-1",
      role,
    },
  }),
}));
vi.mock("../services/documentRevisionService", () => ({
  getDocumentRevisionRegister: vi.fn(),
  listDocumentRevisionCandidates: vi.fn(),
  submitDocumentRevision: vi.fn(),
  decideDocumentRevision: vi.fn(),
}));

const register: DocumentRevisionRegister = {
  coverage: {
    policy: 1,
    data_standard: 0,
    form: 0,
    specification: 0,
    work_instruction: 0,
  },
  missingEffectiveKinds: [
    "data_standard",
    "form",
    "specification",
    "work_instruction",
  ],
  decisionBoundary:
    "Approving a document revision records controlled standing only. It does not approve work, accept risk, change an operating limit or authorize return to service.",
  documents: [
    {
      id: "doc-review",
      sourceId: "policy-100-b",
      title: "Data retention policy",
      documentClass: "client_supplied",
      kind: "policy",
      documentNumber: "POL-100",
      revisionLabel: "B",
      controlStatus: "under_review",
      securityStatus: "cleared",
      applicability: "Applies to governed records retained for this tenant.",
      effectiveAt: null,
      reviewDueAt: null,
      supersedesDocumentId: "doc-effective",
      supersededByDocumentId: null,
      controlBasis: "Cleared upload of the revised retention policy.",
      controlledBy: "author-1",
      controlledAt: "2026-10-02T18:00:00Z",
      reviewedBy: null,
      reviewedAt: null,
      reviewBasis: null,
    },
    {
      id: "doc-effective",
      sourceId: "policy-100-a",
      title: "Data retention policy",
      documentClass: "client_supplied",
      kind: "policy",
      documentNumber: "POL-100",
      revisionLabel: "A",
      controlStatus: "effective",
      securityStatus: "released",
      applicability: "Applies to governed records retained for this tenant.",
      effectiveAt: "2026-01-01T00:00:00Z",
      reviewDueAt: null,
      supersedesDocumentId: null,
      supersededByDocumentId: null,
      controlBasis: "Original controlled retention policy.",
      controlledBy: "author-1",
      controlledAt: "2026-01-01T00:00:00Z",
      reviewedBy: "reviewer-9",
      reviewedAt: "2026-01-02T00:00:00Z",
      reviewBasis: "Independent approval of the original revision.",
    },
  ],
};

describe("DocumentRevisionControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    role = "reliability_engineer";
    vi.mocked(getDocumentRevisionRegister).mockResolvedValue(register);
    vi.mocked(listDocumentRevisionCandidates).mockResolvedValue([
      {
        id: "doc-new",
        source_id: "form-22-a",
        title: "Calibration record form",
        original_filename: "form-22-a.pdf",
        document_class: "client_supplied",
        security_status: "cleared",
        uploaded_at: "2026-10-03T00:00:00Z",
      },
    ]);
    vi.mocked(submitDocumentRevision).mockResolvedValue({
      documentId: "doc-new",
      controlStatus: "under_review",
      documentNumber: "FRM-22",
      revisionLabel: "A",
      kind: "form",
      operationalAuthorization: false,
    });
    vi.mocked(decideDocumentRevision).mockResolvedValue({
      documentId: "doc-review",
      controlStatus: "effective",
      decision: "approved",
      supersededDocumentId: "doc-effective",
      segregationOfDuties: true,
      operationalAuthorization: false,
    });
  });

  it("shows the authority boundary, coverage and a revision waiting for approval", async () => {
    render(<DocumentRevisionControl />);
    expect(
      await screen.findByRole("heading", { name: "Document revision control" }),
    ).toBeVisible();
    expect(screen.getByText(/controlled standing only/i)).toBeVisible();
    expect(screen.getByText("POL-100 rev B")).toBeVisible();
    expect(screen.getByText(/supersedes a prior revision/i)).toBeVisible();
    expect(screen.getAllByText("No effective revision").length).toBeGreaterThan(
      0,
    );
  });

  it("submits a new revision against the cleared upload and the current effective revision", async () => {
    render(<DocumentRevisionControl />);
    await screen.findByRole("option", { name: /Calibration record form/ });
    fireEvent.change(screen.getByLabelText("Cleared upload"), {
      target: { value: "doc-new" },
    });
    fireEvent.change(screen.getByLabelText("Controlled class"), {
      target: { value: "form" },
    });
    fireEvent.change(screen.getByLabelText("Document number"), {
      target: { value: "FRM-22" },
    });
    fireEvent.change(screen.getByLabelText("Revision"), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByLabelText("Applicability"), {
      target: {
        value: "Used when a named human records instrument calibration.",
      },
    });
    fireEvent.change(screen.getByLabelText("Control basis"), {
      target: { value: "Cleared form upload with no invented interval." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit revision" }));
    await waitFor(() =>
      expect(submitDocumentRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: "doc-new",
          kind: "form",
          documentNumber: "FRM-22",
          revisionLabel: "A",
          supersedesDocumentId: null,
        }),
      ),
    );
    expect(
      await screen.findByText(/No work or operating authority was granted/),
    ).toBeVisible();
  });

  it("approves another person's revision and keeps the refusal visible", async () => {
    render(<DocumentRevisionControl />);
    await screen.findByText("POL-100 rev B");
    fireEvent.change(screen.getByLabelText("Independent review basis"), {
      target: {
        value:
          "Checked the submitted text against the prior effective revision.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve revision" }));
    await waitFor(() =>
      expect(decideDocumentRevision).toHaveBeenCalledWith({
        documentId: "doc-review",
        decision: "approved",
        basis:
          "Checked the submitted text against the prior effective revision.",
      }),
    );
    expect(
      await screen.findByText(/No work, risk or return-to-service approval/),
    ).toBeVisible();
  });

  it("refuses a short review basis before calling the server", async () => {
    render(<DocumentRevisionControl />);
    await screen.findByText("POL-100 rev B");
    fireEvent.change(screen.getByLabelText("Independent review basis"), {
      target: { value: "Too short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject revision" }));
    expect(decideDocumentRevision).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at least 20 characters",
    );
  });

  it("hides submission and approval from a role the server also refuses", async () => {
    role = "ai_admin";
    render(<DocumentRevisionControl />);
    await screen.findByText("POL-100 rev B");
    expect(
      screen.queryByRole("button", { name: "Submit revision" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Approve revision" }),
    ).toBeNull();
  });

  it("shows a server refusal and does not treat it as approval", async () => {
    vi.mocked(decideDocumentRevision).mockRejectedValue(
      new Error("the document controller cannot approve their own revision"),
    );
    render(<DocumentRevisionControl />);
    await screen.findByText("POL-100 rev B");
    fireEvent.change(screen.getByLabelText("Independent review basis"), {
      target: {
        value: "A same-person decision must remain a visible refusal.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "cannot approve their own revision",
    );
  });
});
