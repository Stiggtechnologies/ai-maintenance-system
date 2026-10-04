import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerControlledDocument,
  reviewControlledDocument,
} from "./controlledDocumentsService";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(),
  },
}));

describe("controlledDocumentsService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers the exact revision without accepting tenant or authority inputs", async () => {
    rpc.mockResolvedValue({
      data: {
        documentId: "doc-1",
        controlStatus: "under_review",
        documentNumber: "PID-100",
        revisionLabel: "B",
        engineeringAuthority: false,
        operationalAuthorization: false,
      },
      error: null,
    });
    await registerControlledDocument({
      documentId: "doc-1",
      kind: "pid",
      documentNumber: " PID-100 ",
      revisionLabel: " B ",
      applicability: " Process-water train one, all operating modes. ",
      basis: " Approved redline package and field walkdown. ",
      siteId: " site-1 ",
      supersedesDocumentId: " doc-0 ",
    });
    expect(rpc).toHaveBeenCalledWith("register_controlled_technical_document", {
      p_document_id: "doc-1",
      p_record: expect.objectContaining({
        kind: "pid",
        documentNumber: "PID-100",
        revisionLabel: "B",
        siteId: "site-1",
        supersedesDocumentId: "doc-0",
        standardWorkId: null,
        governanceStandardId: null,
        evidenceItemId: null,
      }),
    });
  });

  it("records an independent effectivity decision through the governed RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        documentId: "doc-1",
        controlStatus: "effective",
        supersededDocumentId: "doc-0",
        segregationOfDuties: true,
        engineeringAuthority: false,
        operationalAuthorization: false,
      },
      error: null,
    });
    await reviewControlledDocument({
      documentId: "doc-1",
      decision: "effective",
      basis: " Independent check against the approved redline package. ",
    });
    expect(rpc).toHaveBeenCalledWith("review_controlled_technical_document", {
      p_document_id: "doc-1",
      p_decision: "effective",
      p_basis: "Independent check against the approved redline package.",
    });
  });

  it("surfaces fail-closed canonical-source refusals", async () => {
    rpc.mockResolvedValue({
      data: {
        error:
          "procedure control requires the canonical same-tenant standard_work record",
      },
      error: null,
    });
    await expect(
      registerControlledDocument({
        documentId: "doc-2",
        kind: "procedure",
        documentNumber: "SOP-1",
        revisionLabel: "A",
        applicability: "The complete lubrication route at the north plant.",
        basis: "The uploaded document is the proposed controlled revision.",
      }),
    ).rejects.toThrow("canonical same-tenant standard_work");
  });
});
