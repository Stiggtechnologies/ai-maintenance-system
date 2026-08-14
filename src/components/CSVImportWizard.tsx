/**
 * CSVImportWizard — bulk-load an asset register.
 *
 * This importer shipped writing tenant_id, type and location — three columns
 * the assets table has never had — so every row failed at PostgREST and the
 * success count was structurally zero: a customer-facing importer that
 * silently imported nothing. It matters more than a broken widget normally
 * would, because the asset register is the FIRST thing a customer loads and
 * everything downstream refuses rows against unknown assets: the ingest
 * contract rejects work orders, notifications and maintenance plans whose
 * asset cannot be resolved, and fleet-history import only creates assets as a
 * side effect of history rows. This is the one surface for "here is my
 * equipment list".
 *
 * Rules it now follows:
 *  - Real columns only: organization_id (from the org context, never the user
 *    id), name, tag, asset_class, area, criticality, status, manufacturer,
 *    model, serial_number. The old template's `type` and `location` headers
 *    are still accepted as aliases so a saved copy keeps working.
 *  - Re-import must not duplicate. Existing assets are matched by name within
 *    the organization — the same rule commit_history_import uses — and
 *    reported as skipped rather than silently re-created.
 *  - Every refused row is shown with its reason. A rejection nobody sees is
 *    the same as a dropped row.
 */
import { useState, useCallback } from "react";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { parseCSV } from "../lib/fleet-import";
import { getOrgContext } from "../services/operatingLoopService";

interface ImportResult {
  success: number;
  skipped: number;
  failed: number;
  errors: string[];
}

const CRITICALITIES = new Set(["critical", "high", "medium", "low"]);

/** The old template shipped different names for two columns; honour both. */
const HEADER_ALIASES: Record<string, string> = {
  type: "asset_class",
  location: "area",
};

/** Parse the file once, normalising headers through the alias map. */
function parseRows(text: string): Record<string, string>[] {
  const all = parseCSV(text);
  if (all.length < 2) return [];
  const [hdr, ...body] = all;
  const headers = hdr.map((h) => {
    const key = h.trim().toLowerCase();
    return HEADER_ALIASES[key] ?? key;
  });
  return body
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])),
    );
}

export function CSVImportWizard({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      alert("Please upload a CSV file");
      return;
    }

    setFile(file);
    setParsing(true);

    try {
      const text = await file.text();
      setPreview(parseRows(text).slice(0, 5));
    } catch (error) {
      console.error("Error parsing CSV:", error);
      alert("Error parsing CSV file");
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    const errors: string[] = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    try {
      const ctx = await getOrgContext();
      const rows = parseRows(await file.text());
      if (rows.length === 0) {
        setResult({
          success: 0,
          skipped: 0,
          failed: 0,
          errors: ["The file needs a header row and at least one asset."],
        });
        return;
      }

      // Existing names, fetched once. Matching by name within the organization
      // is the same identity rule commit_history_import applies, so the two
      // import paths cannot disagree about which assets already exist.
      const { data: existingRows, error: existingErr } = await supabase
        .from("assets")
        .select("name")
        .eq("organization_id", ctx.organizationId);
      if (existingErr) throw new Error(existingErr.message);
      const existing = new Set(
        (existingRows ?? []).map((r) => (r.name as string).toLowerCase()),
      );
      const seenInFile = new Set<string>();

      const toInsert: Record<string, string | null>[] = [];
      rows.forEach((row, i) => {
        const line = i + 2; // 1-based, after the header
        if (!row.name) {
          errors.push(`Row ${line}: missing name`);
          failedCount++;
          return;
        }
        const key = row.name.toLowerCase();
        if (existing.has(key)) {
          errors.push(`Row ${line}: "${row.name}" already exists — skipped, not duplicated`);
          skippedCount++;
          return;
        }
        if (seenInFile.has(key)) {
          errors.push(`Row ${line}: "${row.name}" appears twice in this file — second occurrence skipped`);
          skippedCount++;
          return;
        }
        if (row.criticality && !CRITICALITIES.has(row.criticality.toLowerCase())) {
          errors.push(
            `Row ${line}: criticality "${row.criticality}" is not one of critical, high, medium, low`,
          );
          failedCount++;
          return;
        }
        seenInFile.add(key);
        toInsert.push({
          organization_id: ctx.organizationId,
          name: row.name,
          tag: row.tag || null,
          asset_class: row.asset_class || null,
          area: row.area || null,
          criticality: row.criticality?.toLowerCase() || "medium",
          status: row.status || "operational",
          manufacturer: row.manufacturer || null,
          model: row.model || null,
          serial_number: row.serial_number || null,
        });
      });

      for (let i = 0; i < toInsert.length; i += 100) {
        const chunk = toInsert.slice(i, i + 100);
        const { error } = await supabase.from("assets").insert(chunk);
        if (error) {
          errors.push(`Rows ${i + 2}–${i + 1 + chunk.length}: ${error.message}`);
          failedCount += chunk.length;
        } else {
          successCount += chunk.length;
        }
      }

      setResult({
        success: successCount,
        skipped: skippedCount,
        failed: failedCount,
        errors,
      });
    } catch (error) {
      console.error("Import error:", error);
      setResult({
        success: 0,
        skipped: 0,
        failed: 0,
        errors: [error instanceof Error ? error.message : "Failed to process CSV file"],
      });
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const template =
      "name,tag,asset_class,area,criticality,status,manufacturer,model,serial_number\n" +
      "Pump P-101,P-101,Centrifugal Pump,Process Building A,high,operational,,,\n" +
      "Motor M-205,M-205,Electric Motor,Process Building B,medium,operational,,,\n" +
      "Compressor C-300,C-300,Air Compressor,Utilities,critical,operational,,,";
    const blob = new Blob([template], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "syncai-asset-template.csv";
    a.click();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-industrial-graphite rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="bg-linear-to-r from-teal-600 to-blue-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-industrial-graphite/20 rounded-xl flex items-center justify-center backdrop-blur-xs">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Import Assets from CSV</h2>
                <p className="text-teal-100">
                  Bulk upload your asset inventory
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-industrial-graphite/20 hover:bg-industrial-graphite/30 transition-colors flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-8 overflow-y-auto max-h-[calc(90vh-120px)]">
          {!result ? (
            <>
              {/* Step 1: Download Template */}
              {!file && (
                <div className="mb-8">
                  <h3 className="font-semibold text-industrial-text mb-4">
                    Step 1: Download Template
                  </h3>
                  <div className="bg-industrial-black rounded-xl p-6 border border-industrial-border">
                    <p className="text-slate-400 mb-4">
                      Start with our CSV template to ensure your data is
                      formatted correctly.
                    </p>
                    <button
                      onClick={downloadTemplate}
                      className="flex items-center space-x-2 px-4 py-2 bg-industrial-graphite border border-gray-300 rounded-lg hover:bg-industrial-black transition-colors text-sm font-medium"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download CSV Template</span>
                    </button>
                    <div className="mt-4 text-sm text-slate-400">
                      <p className="font-medium mb-2">Columns:</p>
                      <ul className="list-disc list-inside space-y-1 text-gray-500">
                        <li>
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            name
                          </code>{" "}
                          - Asset name (required; re-imports match on it, so an
                          existing name is skipped rather than duplicated)
                        </li>
                        <li>
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            tag
                          </code>{" "}
                          - Your tag number (optional)
                        </li>
                        <li>
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            asset_class
                          </code>{" "}
                          - e.g. Centrifugal Pump (optional;{" "}
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            type
                          </code>{" "}
                          from the old template still works)
                        </li>
                        <li>
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            area
                          </code>{" "}
                          - Physical location (optional;{" "}
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            location
                          </code>{" "}
                          still works)
                        </li>
                        <li>
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            criticality
                          </code>{" "}
                          - low, medium, high, critical (optional, default
                          medium)
                        </li>
                        <li>
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            status
                          </code>
                          ,{" "}
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            manufacturer
                          </code>
                          ,{" "}
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            model
                          </code>
                          ,{" "}
                          <code className="bg-white/6 px-1 py-0.5 rounded-sm">
                            serial_number
                          </code>{" "}
                          - optional
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Upload File */}
              <div>
                <h3 className="font-semibold text-industrial-text mb-4">
                  {file ? "Step 3: Review & Import" : "Step 2: Upload CSV File"}
                </h3>

                {!file ? (
                  <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                      dragActive
                        ? "border-teal-500 bg-teal-50"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <Upload
                      className={`w-16 h-16 mx-auto mb-4 ${
                        dragActive ? "text-teal-600" : "text-gray-400"
                      }`}
                    />
                    <p className="text-lg font-medium text-industrial-text mb-2">
                      {dragActive
                        ? "Drop your CSV file here"
                        : "Drag and drop your CSV file"}
                    </p>
                    <p className="text-sm text-slate-400 mb-4">or</p>
                    <label className="inline-flex items-center space-x-2 px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors cursor-pointer font-medium">
                      <Upload className="w-5 h-5" />
                      <span>Browse Files</span>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* File Info */}
                    <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <FileSpreadsheet className="w-8 h-8 text-teal-600" />
                        <div>
                          <p className="font-medium text-industrial-text">
                            {file.name}
                          </p>
                          <p className="text-sm text-slate-400">
                            {(file.size / 1024).toFixed(2)} KB • Ready to import
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setFile(null);
                          setPreview([]);
                        }}
                        className="text-slate-400 hover:text-gray-800"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Preview */}
                    {preview.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-slate-300 mb-3">
                          Preview (first 5 rows):
                        </p>
                        <div className="overflow-x-auto border border-industrial-border rounded-lg">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-industrial-black">
                              <tr>
                                {Object.keys(preview[0]).map((key) => (
                                  <th
                                    key={key}
                                    className="px-4 py-2 text-left text-xs font-medium text-slate-300 uppercase tracking-wider"
                                  >
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="bg-industrial-graphite divide-y divide-gray-200">
                              {preview.map((row, idx) => (
                                <tr key={idx}>
                                  {Object.values(row).map((val, i) => (
                                    <td
                                      key={i}
                                      className="px-4 py-2 text-sm text-industrial-text"
                                    >
                                      {val}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Import Button */}
                    <div className="flex justify-end space-x-3">
                      <button
                        onClick={() => {
                          setFile(null);
                          setPreview([]);
                        }}
                        className="px-6 py-3 border border-gray-300 text-slate-300 rounded-lg hover:bg-industrial-black transition-colors font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleImport}
                        disabled={importing || parsing}
                        className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                      >
                        {importing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Importing...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-5 h-5" />
                            <span>Import Assets</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Results */
            <div className="space-y-6">
              <div
                className={`p-6 rounded-xl border-2 ${
                  result.failed === 0
                    ? "bg-green-50 border-green-200"
                    : "bg-yellow-50 border-yellow-200"
                }`}
              >
                <div className="flex items-center space-x-3 mb-4">
                  {result.failed === 0 ? (
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  ) : (
                    <AlertCircle className="w-8 h-8 text-yellow-600" />
                  )}
                  <div>
                    <h3
                      className={`text-xl font-bold ${
                        result.failed === 0
                          ? "text-green-900"
                          : "text-yellow-900"
                      }`}
                    >
                      Import{" "}
                      {result.failed === 0
                        ? "Complete!"
                        : "Completed with Errors"}
                    </h3>
                    <p
                      className={`text-sm ${
                        result.failed === 0
                          ? "text-green-700"
                          : "text-yellow-700"
                      }`}
                    >
                      {result.success} assets imported
                      {result.skipped > 0 &&
                        `, ${result.skipped} skipped as already existing`}
                      {result.failed > 0 && `, ${result.failed} failed`}
                    </p>
                  </div>
                </div>

                {result.errors.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-yellow-900 mb-2">
                      Row details — skipped and refused rows, with reasons:
                    </p>
                    <div className="bg-industrial-graphite rounded-lg p-4 max-h-48 overflow-y-auto">
                      <ul className="space-y-1 text-sm text-yellow-800">
                        {result.errors.map((error, idx) => (
                          <li key={idx}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setResult(null);
                    setFile(null);
                    setPreview([]);
                  }}
                  className="px-6 py-3 border border-gray-300 text-slate-300 rounded-lg hover:bg-industrial-black transition-colors font-medium"
                >
                  Import More
                </button>
                <button
                  onClick={() => {
                    onComplete();
                    onClose();
                  }}
                  className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
