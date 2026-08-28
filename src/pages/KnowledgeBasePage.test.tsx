/**
 * Knowledge Base page — C2.15 intake surface. The kbIntake service is mocked
 * (RLS/definer invariants are proven in their own lane); these assertions pin
 * product reachability: list -> empty/loaded states -> ingest form (role
 * gated) -> invoke -> refresh.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeBasePage } from "./KnowledgeBasePage";

const listKbIntakeDocuments = vi.fn();
const listKbDocumentClasses = vi.fn();
const ingestKbDocument = vi.fn();

const ocrPdfToText = vi.fn();

vi.mock("../services/kbOcr", () => ({
  needsOcr: (m: string | null | undefined) =>
    /no usable text layer/i.test(m ?? ""),
  ocrPdfToText: (...args: unknown[]) => ocrPdfToText(...(args as [File])),
  MAX_OCR_PAGES: 50,
}));

vi.mock("../services/kbIntake", () => ({
  listKbIntakeDocuments: () => listKbIntakeDocuments(),
  listKbDocumentClasses: () => listKbDocumentClasses(),
  ingestKbDocument: (input: unknown) => ingestKbDocument(input),
}));

let role = "reliability_engineer";
vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

const DOC = {
  id: "11111111-1111-1111-1111-111111111111",
  source_id: "ht027-service-manual",
  title: "HT-027 Service Manual",
  document_class: "oem_service_manual",
  document_type: null,
  original_filename: "HT027_manual.txt",
  status: "indexed",
  chunk_count: 12,
  page_count: 14,
  uploaded_at: "2026-08-27T00:00:00Z",
  error_message: null,
};

const CLASSES = [
  {
    class_key: "engineering_standard",
    label: "Engineering standard or handbook",
    trust_rank: 100,
  },
  {
    class_key: "oem_service_manual",
    label: "OEM service or parts manual",
    trust_rank: 80,
  },
  { class_key: "unclassified", label: "Unclassified document", trust_rank: 0 },
];

beforeEach(() => {
  role = "reliability_engineer";
  vi.clearAllMocks();
  listKbDocumentClasses.mockResolvedValue(CLASSES);
});

describe("KnowledgeBasePage", () => {
  it("renders an empty state when nothing is ingested", async () => {
    listKbIntakeDocuments.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No documents ingested yet/i)).toBeTruthy();
  });

  it("lists ingested documents with class, chunk count and date", async () => {
    listKbIntakeDocuments.mockResolvedValue([DOC]);
    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("HT-027 Service Manual")).toBeTruthy();
    expect(screen.getByText("oem_service_manual")).toBeTruthy();
    expect(screen.getByText("12 chunk(s)")).toBeTruthy();
  });

  it("shows the ingest form for reliability_engineer", async () => {
    listKbIntakeDocuments.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Ingest a document/i)).toBeTruthy();
    expect(screen.getByLabelText(/Title/i)).toBeTruthy();
    expect(screen.getByLabelText(/Source ID/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ingest" })).toBeTruthy();
  });

  it("hides the ingest form for read-only roles", async () => {
    role = "technician";
    listKbIntakeDocuments.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    await screen.findByText(/No documents ingested yet/i);
    expect(screen.queryByText(/Ingest a document/i)).toBeNull();
  });

  it("ingests pasted content and refreshes the list", async () => {
    listKbIntakeDocuments.mockResolvedValue([]);
    ingestKbDocument.mockResolvedValue({
      source_id: "ht027-service-manual",
      document_class: "oem_service_manual",
      chunks_created: 12,
      status: "indexed",
    });
    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ingest a document/i);

    fireEvent.change(screen.getByLabelText(/Title/i), {
      target: { value: "HT-027 Service Manual" },
    });
    fireEvent.change(screen.getByLabelText(/Source ID/i), {
      target: { value: "ht027-service-manual" },
    });
    fireEvent.change(screen.getByLabelText(/Document class/i), {
      target: { value: "oem_service_manual" },
    });
    fireEvent.change(screen.getByLabelText(/document text/i), {
      target: {
        value:
          "Preventive maintenance instructions for the haul truck engine system. ".repeat(
            20,
          ),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }));

    await waitFor(() => expect(ingestKbDocument).toHaveBeenCalledTimes(1));
    const input = ingestKbDocument.mock.calls[0][0] as Record<string, unknown>;
    expect(input.source_id).toBe("ht027-service-manual");
    expect(input.document_class).toBe("oem_service_manual");
    expect(input.file_base64).toBeUndefined();
    // Refresh happened after ingest.
    await waitFor(() => expect(listKbIntakeDocuments).toHaveBeenCalledTimes(2));
  });

  it("rejects unsupported file types with an actionable message", async () => {
    listKbIntakeDocuments.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ingest a document/i);
    fireEvent.change(screen.getByLabelText(/Title/i), {
      target: { value: "Word Doc" },
    });
    fireEvent.change(screen.getByLabelText(/Source ID/i), {
      target: { value: "word-doc" },
    });
    const file = new File(["docx-bytes"], "manual.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByLabelText(/File/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Unsupported file type/i,
    );
    expect(ingestKbDocument).not.toHaveBeenCalled();
  });

  it("offers browser OCR when the server reports a scanned PDF, then submits the recognized text", async () => {
    listKbIntakeDocuments.mockResolvedValue([]);
    ingestKbDocument
      .mockRejectedValueOnce(
        new Error(
          "This PDF has no usable text layer (scanned or image-only). The OCR lane is not wired yet.",
        ),
      )
      .mockResolvedValueOnce({
        source_id: "scanned-manual",
        document_class: "unclassified",
        chunks_created: 6,
        status: "indexed",
      });
    ocrPdfToText.mockResolvedValue({
      text: "[Page 1]\nRecognized service text from the scanned manual.",
      pageCount: 3,
    });

    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ingest a document/i);
    fireEvent.change(screen.getByLabelText(/Title/i), {
      target: { value: "Scanned Manual" },
    });
    fireEvent.change(screen.getByLabelText(/Source ID/i), {
      target: { value: "scanned-manual" },
    });
    const file = new File(["%PDF-1.4 fake"], "manual.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText(/File/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }));

    // The scanned-PDF error arms the browser-OCR lane.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /never leaves your machine/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run browser OCR/i }));

    await waitFor(() => expect(ocrPdfToText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Browser OCR complete/i)).toBeTruthy();

    // The recognized text lands in the paste area and submits through the
    // normal audited path.
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }));
    await waitFor(() => expect(ingestKbDocument).toHaveBeenCalledTimes(2));
    const input = ingestKbDocument.mock.calls[1][0] as Record<string, unknown>;
    expect(input.content).toContain("Recognized service text");
    expect(input.file_base64).toBeUndefined();
  });

  it("accepts PDF files (text layer extracted server-side)", async () => {
    listKbIntakeDocuments.mockResolvedValue([]);
    ingestKbDocument.mockResolvedValue({
      source_id: "pdf-manual",
      document_class: "unclassified",
      chunks_created: 8,
      status: "indexed",
    });
    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ingest a document/i);
    fireEvent.change(screen.getByLabelText(/Title/i), {
      target: { value: "PDF Manual" },
    });
    fireEvent.change(screen.getByLabelText(/Source ID/i), {
      target: { value: "pdf-manual" },
    });
    const file = new File(["%PDF-1.4 fake"], "manual.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText(/File/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }));
    await waitFor(() => expect(ingestKbDocument).toHaveBeenCalledTimes(1));
    const input = ingestKbDocument.mock.calls[0][0] as Record<string, unknown>;
    expect(input.file_base64).toBeDefined();
    expect(input.filename).toBe("manual.pdf");
  });

  it("surfaces ingest errors", async () => {
    listKbIntakeDocuments.mockResolvedValue([]);
    ingestKbDocument.mockRejectedValue(
      new Error("intake failed: source_id already in use"),
    );
    render(
      <MemoryRouter>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    await screen.findByText(/Ingest a document/i);
    fireEvent.change(screen.getByLabelText(/Title/i), {
      target: { value: "Some Title" },
    });
    fireEvent.change(screen.getByLabelText(/Source ID/i), {
      target: { value: "some-source" },
    });
    fireEvent.change(screen.getByLabelText(/document text/i), {
      target: {
        value:
          "A sufficient amount of pasted document text to pass validation. ".repeat(
            5,
          ),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /intake failed/i,
    );
  });
});
