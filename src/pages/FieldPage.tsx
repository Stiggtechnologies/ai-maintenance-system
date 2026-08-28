/**
 * Field — the mobile-first technician surface (E6.13 first slice).
 *
 * Big-button, gloves-on-first: scan the asset QR on the equipment (any phone
 * camera) to reach the asset's failure-capture panel, or review the team's
 * filed reports here. Read-only for the report list (RLS org-scoped); the
 * capture flow lives on the asset page where the QR lands.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { listRecentFieldReports, type FieldReport } from "../services/fieldReports";

const TYPE_COLORS: Record<string, string> = {
  fault: "bg-red-500/10 text-red-400 border border-red-500/20",
  observation: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  safety: "bg-orange-500/10 text-orange-400 border border-orange-500/20",
  request: "bg-sky-500/10 text-sky-400 border border-sky-500/20",
};

export function FieldPage() {
  const [reports, setReports] = useState<FieldReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await listRecentFieldReports());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load field reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-industrial-text">Field</h1>
          <p className="text-sm text-industrial-muted">
            Report failures from the equipment — evidence lands governed.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-industrial-border px-3 py-2 text-sm font-medium text-industrial-text hover:bg-industrial-surface disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* The QR scan flow — big-button, first thing a glove sees. */}
      <section className="mt-5 rounded-xl border border-[#3A8DFF]/30 bg-[#3A8DFF]/10 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-industrial-text">
          <QrCode className="h-5 w-5 text-[#3A8DFF]" />
          Report a failure on the equipment
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-industrial-muted">
          <li>Scan the <strong className="text-industrial-text">asset QR label</strong> with your phone camera — it opens the asset directly.</li>
          <li>Tap <strong className="text-industrial-text">Report failure from the field</strong>.</li>
          <li>Capture the photo, describe the observation, file it.</li>
        </ol>
        <Link
          to="/assets"
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#3A8DFF] px-4 py-4 text-base font-semibold text-white hover:bg-[#2E7AE6] sm:w-auto"
        >
          <Camera className="h-5 w-5" />
          Find the asset (then scan its label)
        </Link>
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <h2 className="mt-6 mb-3 flex items-center gap-2 text-lg font-semibold text-industrial-text">
        <ShieldCheck className="h-5 w-5 text-teal-400" />
        Filed reports{" "}
        <span className="text-sm font-normal text-industrial-muted">
          ({reports.length})
        </span>
      </h2>

      {loading ? (
        <div role="status" className="py-10 text-center text-sm text-industrial-muted">
          Loading field reports…
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-industrial-border py-10 text-center">
          <p className="text-sm text-industrial-muted">
            No field reports filed yet. The first one lands here the moment a
            photo is captured on the equipment.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-industrial-border rounded-xl border border-industrial-border bg-industrial-surface/30">
          {reports.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[r.notification_type] ?? TYPE_COLORS.request}`}>
                  {r.notification_type}
                </span>
                <span className="text-xs text-industrial-muted">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 text-sm text-industrial-text">{r.description}</p>
              <p className="mt-1 text-xs text-industrial-muted">
                {r.asset_tag ?? "Unassigned asset"} · reported by {r.reported_by} ·{" "}
                <span className="capitalize">{r.status}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
