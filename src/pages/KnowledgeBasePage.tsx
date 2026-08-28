/**
 * Knowledge Base — C2.15 document intake surface (Reliability Knowledge
 * Activation). Lists the tenant's ingested documents and, for
 * reliability/admin roles, accepts new documents (paste or text/csv/md file).
 *
 * Data flow: upload → kb-document-intake edge function (auth + role gate +
 * chunking) → kb_ingest_document RPC (tenant-scoped, audited) →
 * reliability_kb_chunks. This page reads kb_intake_documents via RLS.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, UploadCloud } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { needsOcr, ocrPdfToText, type OcrProgress } from "../services/kbOcr";
import {
  ingestKbDocument,
  listKbDocumentClasses,
  listKbIntakeDocuments,
  type KbDocumentClass,
  type KbIntakeDocument,
} from "../services/kbIntake";

const INTAKE_ROLES = ["admin", "ai_admin", "reliability_engineer"];

const TEXT_FILE_RE = /\.(txt|csv|md|markdown|json|log|pdf)$/i;

export function KnowledgeBasePage() {
  const { profile } = useAuth();
  const canIngest =
    profile?.role != null && INTAKE_ROLES.includes(profile.role);

  const [documents, setDocuments] = useState<KbIntakeDocument[]>([]);
  const [classes, setClasses] = useState<KbDocumentClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrAvailable, setOcrAvailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload form state
  const [title, setTitle] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [documentClass, setDocumentClass] = useState("unclassified");
  const [pageStart, setPageStart] = useState("");
  const [pageEnd, setPageEnd] = useState("");
  const [pasted, setPasted] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docs, cls] = await Promise.all([
        listKbIntakeDocuments(),
        listKbDocumentClasses(),
      ]);
      setDocuments(docs);
      setClasses(cls);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load knowledge base",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setTitle("");
    setSourceId("");
    setDocumentClass("unclassified");
    setPageStart("");
    setPageEnd("");
    setPasted("");
    setSelectedFile(null);
    setOcrAvailable(false);
    setOcrProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const pageStartNum = pageStart ? Number(pageStart) : null;
    const pageEndNum = pageEnd ? Number(pageEnd) : null;
    if (
      pageStartNum != null &&
      pageEndNum != null &&
      pageEndNum < pageStartNum
    ) {
      setError("Page end must be >= page start");
      return;
    }

    // Paste/OCR text takes precedence: after a browser-OCR run the recognized
    // text IS the document, and re-sending the raw file would just re-trigger
    // the server-side scanned-PDF rejection.
    const usePaste = pasted.trim().length >= 20;
    let file_base64: string | undefined;
    let filename: string | undefined;
    if (!usePaste && selectedFile) {
      if (!TEXT_FILE_RE.test(selectedFile.name)) {
        setError(
          "Unsupported file type. Text, CSV, Markdown, PDF (text layer) are supported — for anything else, paste the document text.",
        );
        return;
      }
      const raw = await selectedFile.arrayBuffer();
      const bytes = new Uint8Array(raw);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      file_base64 = btoa(bin);
      filename = selectedFile.name;
    }

    if (!usePaste && !file_base64) {
      setError(
        "Provide a text file or paste at least 20 characters of content",
      );
      return;
    }

    setBusy(true);
    try {
      const result = await ingestKbDocument({
        source_id: sourceId.trim(),
        title: title.trim(),
        document_class: documentClass,
        original_filename: filename ?? null,
        file_base64,
        filename,
        content: usePaste ? pasted : undefined,
        page_start: pageStartNum,
        page_end: pageEndNum,
      });
      setNotice(
        `Ingested "${result.source_id}" — ${result.chunks_created} chunk(s) indexed.`,
      );
      resetForm();
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ingest failed";
      if (needsOcr(message) && selectedFile) {
        setOcrAvailable(true);
        setError(
          "This PDF has no text layer (it's a scan). You can read it in your browser instead — the document never leaves your machine.",
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const runOcr = async () => {
    if (!selectedFile) return;
    setOcrBusy(true);
    setError(null);
    try {
      const result = await ocrPdfToText(selectedFile, setOcrProgress);
      setPasted(result.text);
      setNotice(
        `Browser OCR complete: ${result.pageCount} page(s) read locally. Review the text below, then submit — the document itself never left your machine.`,
      );
      setOcrAvailable(false);
      setOcrProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setOcrBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-industrial-text">
            Knowledge Base
          </h1>
          <p className="text-sm text-industrial-muted">
            Governed document intake for the Reliability Knowledge Agent — every
            chunk is tenant-scoped, class-trusted and audited.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-industrial-border px-3 py-2 text-sm font-medium text-industrial-text transition-colors hover:bg-industrial-surface disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          {notice}
        </div>
      )}

      {canIngest && (
        <form
          onSubmit={handleSubmit}
          className="mb-8 rounded-xl border border-industrial-border bg-industrial-surface/50 p-5"
        >
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-industrial-text">
            <UploadCloud className="h-5 w-5 text-[#3A8DFF]" />
            Ingest a document
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-industrial-text">
                Title *
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={2}
                placeholder="HT-027 Service Manual"
                className="w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text placeholder:text-industrial-muted/60 focus:border-[#3A8DFF] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-industrial-text">
                Source ID * (stable slug — re-upload replaces)
              </span>
              <input
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                required
                minLength={3}
                pattern="[A-Za-z0-9._-]+"
                placeholder="ht027-service-manual"
                className="w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text placeholder:text-industrial-muted/60 focus:border-[#3A8DFF] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-industrial-text">
                Document class *
              </span>
              <select
                value={documentClass}
                onChange={(e) => setDocumentClass(e.target.value)}
                className="w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text focus:border-[#3A8DFF] focus:outline-none"
              >
                {classes.length === 0 && (
                  <option value="unclassified">unclassified</option>
                )}
                {classes.map((c) => (
                  <option key={c.class_key} value={c.class_key}>
                    {c.label} ({c.class_key})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-industrial-text">
                  Page start
                </span>
                <input
                  type="number"
                  min={1}
                  value={pageStart}
                  onChange={(e) => setPageStart(e.target.value)}
                  placeholder="1"
                  className="w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text focus:border-[#3A8DFF] focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-industrial-text">
                  Page end
                </span>
                <input
                  type="number"
                  min={1}
                  value={pageEnd}
                  onChange={(e) => setPageEnd(e.target.value)}
                  placeholder="12"
                  className="w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text focus:border-[#3A8DFF] focus:outline-none"
                />
              </label>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-industrial-text">
                File (txt / csv / md / json / log / pdf)
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv,.md,.markdown,.json,.log,.pdf,text/plain,text/csv,text/markdown,application/json,application/pdf"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-industrial-muted file:mr-3 file:rounded-lg file:border-0 file:bg-[#3A8DFF] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#2E7AE6]"
              />
            </label>
            <div className="flex items-end justify-end gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-industrial-border px-4 py-2 text-sm font-medium text-industrial-muted transition-colors hover:bg-industrial-surface"
              >
                Clear
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-[#3A8DFF] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2E7AE6] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Ingesting…" : "Ingest"}
              </button>
            </div>
          </div>

          {ocrAvailable && selectedFile && (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-200">
                Scanned PDF detected — read it in your browser with OCR (up to
                50 pages, English). The document stays on your machine; only the
                recognized text is submitted.
              </p>
              {ocrProgress && (
                <p className="mt-2 text-xs text-industrial-muted" role="status">
                  {ocrProgress.stage === "render" ? "Rendering" : "Recognizing"}{" "}
                  page {ocrProgress.page} of {ocrProgress.total}…
                </p>
              )}
              <button
                type="button"
                onClick={() => void runOcr()}
                disabled={ocrBusy}
                className="mt-3 rounded-lg border border-amber-400/60 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ocrBusy ? "Reading document…" : "Run browser OCR on this PDF"}
              </button>
            </div>
          )}

          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium text-industrial-text">
              …or paste document text
            </span>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={5}
              placeholder="Paste runbook, procedure or manual text (min 20 characters). PDFs are read from their text layer; scanned PDFs wait for the OCR lane."
              className="w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text placeholder:text-industrial-muted/60 focus:border-[#3A8DFF] focus:outline-none"
            />
          </label>
        </form>
      )}

      <h2 className="mb-3 text-lg font-semibold text-industrial-text">
        Ingested documents{" "}
        <span className="text-sm font-normal text-industrial-muted">
          ({documents.length})
        </span>
      </h2>

      {loading ? (
        <div
          role="status"
          className="py-12 text-center text-sm text-industrial-muted"
        >
          Loading knowledge base…
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-industrial-border py-12 text-center">
          <p className="text-sm text-industrial-muted">
            No documents ingested yet.
            {canIngest
              ? " Use the form above to add your first runbook, procedure or manual."
              : " Ask a reliability engineer or admin to ingest documents."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-industrial-border rounded-xl border border-industrial-border bg-industrial-surface/30">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p
                  className="truncate font-medium text-industrial-text"
                  title={doc.title}
                >
                  {doc.title}
                </p>
                <p
                  className="truncate text-xs text-industrial-muted"
                  title={doc.source_id}
                >
                  {doc.source_id}
                  {doc.original_filename ? ` · ${doc.original_filename}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-industrial-muted">
                <span className="rounded-full border border-industrial-border px-2 py-0.5">
                  {doc.document_class ?? "unclassified"}
                </span>
                <span>{doc.chunk_count} chunk(s)</span>
                {doc.page_count != null && <span>{doc.page_count} p.</span>}
                <span>{new Date(doc.uploaded_at).toLocaleString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
