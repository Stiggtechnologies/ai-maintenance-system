/**
 * Browser-side OCR lane for the C2.15 KB intake (scanned PDFs).
 *
 * Constraint honored: the document never leaves the customer's browser —
 * pdfjs renders each page to a canvas and Tesseract (WASM, loaded lazily)
 * reads it locally. Only the recognized TEXT travels, through the same
 * audited intake path as typed content.
 *
 * The English recognition model (~15 MB) is fetched once from the public
 * tessdata CDN — a model download, not a data upload. Bounded: v1 OCRs at
 * most MAX_OCR_PAGES pages per document (in-browser OCR is slow by nature;
 * larger scans are a quoted add-on).
 */

export const MAX_OCR_PAGES = 50;

export interface OcrProgress {
  page: number;
  total: number;
  stage: "render" | "recognize";
}

export interface OcrResult {
  text: string;
  pageCount: number;
}

/** Error messages from the intake path that mean "this PDF needs OCR". */
export function needsOcr(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  return /no usable text layer/i.test(errorMessage);
}

/**
 * OCR a scanned PDF entirely in the browser. Heavy imports are dynamic so
 * the main bundle never carries pdfjs/tesseract until OCR is requested.
 */
export async function ocrPdfToText(
  file: File,
  onProgress?: (p: OcrProgress) => void,
  maxPages: number = MAX_OCR_PAGES,
): Promise<OcrResult> {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] =
    await Promise.all([import("pdfjs-dist"), import("tesseract.js")]);

  // Vite resolves the worker asset at build time.
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const total = Math.min(pdf.numPages, maxPages);
  if (total < 1) throw new Error("The PDF has no pages to read.");

  const { createWorker } = workerModule;
  const worker = await createWorker("eng");

  const parts: string[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      onProgress?.({ page: i, total, stage: "render" });
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx)
        throw new Error(
          "Canvas 2D context unavailable — OCR requires a modern browser.",
        );
      await page.render({ canvasContext: ctx, viewport }).promise;

      onProgress?.({ page: i, total, stage: "recognize" });
      const { data: rec } = await worker.recognize(canvas);
      const pageText = (rec?.text ?? "").trim();
      if (pageText.length > 0) {
        parts.push(`[Page ${i}]\n${pageText}`);
      }
    }
  } finally {
    await worker.terminate();
  }

  const text = parts.join("\n\n").trim();
  if (text.length < 20) {
    throw new Error(
      "OCR could not read enough text from this scan. Try a cleaner scan, higher-resolution source, or paste the text manually.",
    );
  }
  return { text, pageCount: total };
}
