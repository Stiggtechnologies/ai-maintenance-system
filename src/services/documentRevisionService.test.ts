import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideDocumentRevision,
  submitDocumentRevision,
} from "./documentRevisionService";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(),
  },
}));

describe("documentRevisionService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits the exact revision without accepting a tenant or authority input", async () => {
    rpc.mockResolvedValue({
      data: {
        documentId: "doc-1",
        controlStatus: "under_review",
        documentNumber: "POL-100",
        revisionLabel: "B",
        kind: "policy",
        operationalAuthorization: false,
      },
      error: null,
    });
    await submitDocumentRevision({
      documentId: "doc-1",
      kind: "policy",
      documentNumber: " POL-100 ",
      revisionLabel: " B ",
      applicability: " Site data-governance policy for controlled records. ",
      basis: " Named steward review of the cleared upload. ",
      reviewDueAt: "2026-12-01T00:00:00.000Z",
      supersedesDocumentId: " doc-0 ",
    });
    expect(rpc).toHaveBeenCalledWith("submit_document_revision", {
      p_document_id: "doc-1",
      p_record: {
        kind: "policy",
        documentNumber: "POL-100",
        revisionLabel: "B",
        applicability: "Site data-governance policy for controlled records.",
        basis: "Named steward review of the cleared upload.",
        reviewDueAt: "2026-12-01T00:00:00.000Z",
        supersedesDocumentId: "doc-0",
      },
    });
  });

  it("records an independent approval through the governed decision", async () => {
    rpc.mockResolvedValue({
      data: {
        documentId: "doc-1",
        controlStatus: "effective",
        decision: "approved",
        supersededDocumentId: "doc-0",
        segregationOfDuties: true,
        operationalAuthorization: false,
      },
      error: null,
    });
    await decideDocumentRevision({
      documentId: "doc-1",
      decision: "approved",
      basis:
        " Independent check of the submitted revision and its predecessor. ",
    });
    expect(rpc).toHaveBeenCalledWith("decide_document_revision", {
      p_document_id: "doc-1",
      p_decision: "approved",
      p_basis:
        "Independent check of the submitted revision and its predecessor.",
    });
  });

  it("surfaces a fail-closed server refusal", async () => {
    rpc.mockResolvedValue({
      data: {
        error: "the document controller cannot approve their own revision",
      },
      error: null,
    });
    await expect(
      decideDocumentRevision({
        documentId: "doc-1",
        decision: "rejected",
        basis: "This self-approval must be refused by the server.",
      }),
    ).rejects.toThrow("cannot approve their own revision");
  });
});
