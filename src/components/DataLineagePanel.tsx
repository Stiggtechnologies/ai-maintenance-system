import { useState, type FormEvent, type ReactNode } from "react";
import { GitBranch } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  lineageProposalFromMappedSapStock,
  validateLineageDraft,
  type LineageDraft,
  type LineageSubjectClass,
} from "../lib/data-governance/lineage";
import {
  loadDataLineageRegister,
  readDataLineage,
  recordDataLineageEdge,
  type DataLineageChain,
} from "../services/dataLineageService";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white";

const emptyDraft = (): LineageDraft => ({
  domainId: "",
  relationship: "sourced_from",
  subjectClass: "asset",
  subjectId: "",
  sourceSystem: "",
  sourceObject: "",
  sourceKey: "",
  transformation: "",
  observedAt: "",
  basis: "",
  evidenceReference: "",
  parentEdgeId: "",
  supersedesEdgeId: "",
  connectorId: "",
});

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className="block text-xs text-slate-400">
      {label}
      {children}
    </label>
  );
}

export function DataLineagePanel() {
  const { data, loading, error, refetch } = useAsyncData(
    loadDataLineageRegister,
    [],
    {
      isEmpty: () => false,
    },
  );
  const [draft, setDraft] = useState<LineageDraft>(emptyDraft);
  const [mappedJson, setMappedJson] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [chain, setChain] = useState<DataLineageChain | null>(null);

  function update<K extends keyof LineageDraft>(
    key: K,
    value: LineageDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onRecord(event: FormEvent) {
    event.preventDefault();
    const reason = validateLineageDraft(draft, new Date().toISOString());
    if (reason) {
      setFormError(reason);
      setNotice(null);
      return;
    }
    setBusy("record");
    setFormError(null);
    setNotice(null);
    try {
      const receipt = await recordDataLineageEdge(draft);
      setNotice(
        receipt.status === "already_recorded"
          ? `This exact lineage edge is already recorded (${receipt.edgeId}). No source system was contacted.`
          : `Lineage edge ${receipt.edgeId} recorded. No source system was contacted and no canonical value changed.`,
      );
      refetch();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Lineage recording failed",
      );
    } finally {
      setBusy("");
    }
  }

  async function onReadChain() {
    if (
      !draft.subjectClass ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        draft.subjectId.trim(),
      )
    ) {
      setFormError(
        "A canonical subject class and id are required to read lineage",
      );
      return;
    }
    setBusy("read");
    setFormError(null);
    try {
      setChain(
        await readDataLineage(draft.subjectClass, draft.subjectId.trim()),
      );
    } catch (caught) {
      setChain(null);
      setFormError(
        caught instanceof Error ? caught.message : "Lineage read failed",
      );
    } finally {
      setBusy("");
    }
  }

  function onPrefillSap() {
    let mapped: unknown;
    try {
      mapped = JSON.parse(mappedJson);
    } catch {
      setFormError("The SAP mapping must be JSON. Lineage does not call SAP.");
      return;
    }
    const proposal = lineageProposalFromMappedSapStock({
      mapped,
      materialStockId: draft.subjectId,
      dataDomainId: draft.domainId,
      basis: draft.basis,
      evidenceReference: draft.evidenceReference,
      connectorId: draft.connectorId,
      nowIso: new Date().toISOString(),
    });
    if (!proposal.ok) {
      setNotice(null);
      setFormError(proposal.reason);
      return;
    }
    setDraft(proposal.draft);
    setFormError(null);
    setNotice(
      "Filled from the reviewed SAP mapping on this page. SAP was not called. Record the edge only if the canonical stock row is the one this mapping loaded.",
    );
  }

  return (
    <section aria-labelledby="data-lineage-heading" className="space-y-4">
      <div>
        <h2
          id="data-lineage-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <GitBranch className="h-5 w-5 text-signal-cyan" aria-hidden />
          Data lineage
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A named maintenance, reliability or administrator human can record
          where a canonical asset, sensor, work order, material-stock balance or
          evidence item came from. Recording an edge does not call SAP, change
          the canonical row, merge records, or authorize work.
        </p>
      </div>

      {loading && (
        <p role="status" className="text-sm text-slate-400">
          Loading data lineage
        </p>
      )}
      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs"
            onClick={refetch}
          >
            Retry lineage read
          </button>
        </div>
      )}

      {data && data.edges.length === 0 && (
        <p className="text-sm text-slate-400">
          No lineage edges are recorded. Absence is not proof that a source does
          not exist.
        </p>
      )}
      {data && data.edges.length > 0 && (
        <ul className="space-y-2">
          {data.edges.map((edge) => (
            <li
              key={edge.id}
              className="rounded-xl border border-white/6 px-3 py-2 text-sm text-slate-200"
            >
              <span className="text-slate-400">
                {edge.current ? "current" : "superseded"}
              </span>
              {" · "}
              {edge.relationship} · {edge.subjectClass} · {edge.sourceSystem} ·{" "}
              {edge.sourceKey}
              <button
                type="button"
                className="ml-3 text-xs text-signal-cyan"
                onClick={() => {
                  update("domainId", String(edge.domainId));
                  update(
                    "subjectClass",
                    edge.subjectClass as LineageSubjectClass,
                  );
                  update("subjectId", edge.subjectId);
                  update("supersedesEdgeId", edge.current ? edge.id : "");
                  update("relationship", edge.relationship);
                  update("sourceSystem", edge.sourceSystem);
                  update("sourceObject", edge.sourceObject);
                  update("sourceKey", edge.sourceKey);
                  update("parentEdgeId", edge.parentEdgeId ?? "");
                }}
              >
                Use as correction target
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onRecord} className="grid gap-3 md:grid-cols-2">
        <Field id="lineage-domain" label="Data domain id">
          <input
            id="lineage-domain"
            className={inputClass}
            value={draft.domainId}
            onChange={(event) => update("domainId", event.target.value)}
          />
        </Field>
        <Field id="lineage-relationship" label="Relationship">
          <select
            id="lineage-relationship"
            className={inputClass}
            value={draft.relationship}
            onChange={(event) =>
              update(
                "relationship",
                event.target.value as LineageDraft["relationship"],
              )
            }
          >
            <option value="sourced_from">sourced from</option>
            <option value="derived_from">derived from</option>
          </select>
        </Field>
        <Field id="lineage-subject-class" label="Canonical subject class">
          <select
            id="lineage-subject-class"
            className={inputClass}
            value={draft.subjectClass}
            onChange={(event) =>
              update("subjectClass", event.target.value as LineageSubjectClass)
            }
          >
            <option value="asset">asset</option>
            <option value="sensor">sensor</option>
            <option value="work_order">work order</option>
            <option value="material_stock">material stock</option>
            <option value="evidence_item">evidence item</option>
          </select>
        </Field>
        <Field id="lineage-subject-id" label="Canonical subject id">
          <input
            id="lineage-subject-id"
            className={inputClass}
            value={draft.subjectId}
            onChange={(event) => update("subjectId", event.target.value)}
          />
        </Field>
        <Field id="lineage-source-system" label="Source system">
          <input
            id="lineage-source-system"
            className={inputClass}
            value={draft.sourceSystem}
            onChange={(event) => update("sourceSystem", event.target.value)}
          />
        </Field>
        <Field id="lineage-source-object" label="Source object">
          <input
            id="lineage-source-object"
            className={inputClass}
            value={draft.sourceObject}
            onChange={(event) => update("sourceObject", event.target.value)}
          />
        </Field>
        <Field id="lineage-source-key" label="Source key">
          <input
            id="lineage-source-key"
            className={inputClass}
            value={draft.sourceKey}
            onChange={(event) => update("sourceKey", event.target.value)}
          />
        </Field>
        <Field id="lineage-observed-at" label="Observation time">
          <input
            id="lineage-observed-at"
            className={inputClass}
            placeholder="2026-11-03T12:00:00Z"
            value={draft.observedAt}
            onChange={(event) => update("observedAt", event.target.value)}
          />
        </Field>
        <Field id="lineage-transformation" label="Transformation">
          <textarea
            id="lineage-transformation"
            className={inputClass}
            value={draft.transformation}
            onChange={(event) => update("transformation", event.target.value)}
          />
        </Field>
        <Field id="lineage-basis" label="Lineage basis">
          <textarea
            id="lineage-basis"
            className={inputClass}
            value={draft.basis}
            onChange={(event) => update("basis", event.target.value)}
          />
        </Field>
        <Field id="lineage-evidence" label="Lineage evidence reference">
          <input
            id="lineage-evidence"
            className={inputClass}
            value={draft.evidenceReference}
            onChange={(event) =>
              update("evidenceReference", event.target.value)
            }
          />
        </Field>
        <Field id="lineage-parent" label="Parent edge id">
          <input
            id="lineage-parent"
            className={inputClass}
            value={draft.parentEdgeId}
            onChange={(event) => update("parentEdgeId", event.target.value)}
          />
        </Field>
        <Field id="lineage-supersedes" label="Supersedes edge id">
          <input
            id="lineage-supersedes"
            className={inputClass}
            value={draft.supersedesEdgeId}
            onChange={(event) => update("supersedesEdgeId", event.target.value)}
          />
        </Field>
        <Field id="lineage-connector" label="Connector id">
          <input
            id="lineage-connector"
            className={inputClass}
            value={draft.connectorId}
            onChange={(event) => update("connectorId", event.target.value)}
          />
        </Field>
        <div className="md:col-span-2">
          <label
            htmlFor="lineage-sap-mapping"
            className="block text-xs text-slate-400"
          >
            Reviewed SAP stock mapping
            <textarea
              id="lineage-sap-mapping"
              className={inputClass}
              value={mappedJson}
              onChange={(event) => setMappedJson(event.target.value)}
            />
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Paste a row already produced by the material-stock mapper. This
            prefills the form on this page and does not call SAP.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button
            type="submit"
            disabled={busy !== ""}
            className="rounded-lg bg-signal-cyan/20 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Record lineage edge
          </button>
          <button
            type="button"
            disabled={busy !== ""}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200"
            onClick={onReadChain}
          >
            Read lineage chain
          </button>
          <button
            type="button"
            disabled={busy !== ""}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200"
            onClick={onPrefillSap}
          >
            Prefill from reviewed SAP mapping
          </button>
        </div>
      </form>

      {formError && (
        <p role="alert" className="text-sm text-amber-200">
          {formError}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-slate-300">
          {notice}
        </p>
      )}
      {chain && (
        <div className="rounded-xl border border-white/6 p-3 text-sm text-slate-300">
          <p>
            {chain.subjectPresent
              ? "Canonical subject is present in this tenant."
              : "Canonical subject is not in this tenant."}
          </p>
          <p>{chain.currentEdges.length} current edge(s).</p>
          {chain.gaps.map((gap, index) => (
            <p key={`${index}:${gap}`}>{gap}</p>
          ))}
          {chain.truncated && (
            <p>
              The chain is longer than the returned hops. Missing hops are not
              treated as absent.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
