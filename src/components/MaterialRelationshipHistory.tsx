import { useState } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import { listMaterialRelationshipAudit } from "../services/materialsCallers";

export function MaterialRelationshipHistory() {
  const [page, setPage] = useState(0);
  const history = useAsyncData(
    () => listMaterialRelationshipAudit(page),
    [page],
  );
  return (
    <section
      aria-labelledby="material-history-title"
      className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4"
    >
      <h2
        id="material-history-title"
        className="text-lg font-semibold text-white"
      >
        Catalogue relationship history
      </h2>
      <p className="text-sm text-slate-400">
        Recorded source statements and actor identities from the canonical audit
        log. A source statement is not independent verification.
      </p>
      <button
        type="button"
        onClick={history.refetch}
        disabled={history.loading}
        className="text-sm text-blue-300"
      >
        Refresh relationship history
      </button>
      {history.loading ? (
        <p role="status">Loading relationship history…</p>
      ) : history.error ? (
        <p role="alert">{history.error}</p>
      ) : (
        <>
          {!history.data?.length && (
            <p>No relationship audit records on this page.</p>
          )}
          {history.data?.map((record) => (
            <article
              key={record.id}
              className="border-t border-slate-700 pt-3 text-sm text-slate-300"
            >
              <p>
                {record.entity_type.replaceAll("_", " ")} ·{" "}
                {record.event_data.action ?? "recorded"} ·{" "}
                {new Date(record.event_time).toLocaleString()}
              </p>
              <p>
                Source / basis:{" "}
                {record.event_data.basis ?? "No source basis recorded"}
              </p>
              <p className="text-xs text-slate-400">
                Actor: {record.event_data.actorId ?? "Identity not recorded"} (
                {record.actor})
              </p>
              <p className="text-xs text-slate-400 break-all">
                Material:{" "}
                {record.new_state?.material_code ??
                  record.new_state?.materialCode ??
                  record.new_state?.material_id ??
                  record.new_state?.materialId ??
                  "See audit record"}
                {record.new_state?.masterVersion
                  ? ` · Version ${record.new_state.masterVersion}`
                  : record.event_data.masterVersion
                    ? ` · Version ${record.event_data.masterVersion}`
                    : ""}
                {record.new_state?.supplier_id
                  ? ` · Supplier ${record.new_state.supplier_id}`
                  : ""}
                {record.new_state?.component_id
                  ? ` · Component ${record.new_state.component_id}`
                  : ""}
                {record.new_state?.asset_id
                  ? ` · Asset ${record.new_state.asset_id}`
                  : ""}
                {record.new_state?.asset_class
                  ? ` · Class ${record.new_state.asset_class}`
                  : ""}
              </p>
            </article>
          ))}
        </>
      )}
      <div className="flex gap-4 text-sm text-blue-300">
        <button
          type="button"
          disabled={page === 0 || history.loading}
          onClick={() => setPage((p) => p - 1)}
        >
          Newer records
        </button>
        <span className="text-slate-400">Page {page + 1}</span>
        <button
          type="button"
          disabled={
            history.loading ||
            !!history.error ||
            (history.data?.length ?? 0) < 25
          }
          onClick={() => setPage((p) => p + 1)}
        >
          Older records
        </button>
      </div>
    </section>
  );
}
