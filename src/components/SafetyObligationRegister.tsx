import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Gavel, Link2, TriangleAlert } from "lucide-react";
import {
  getSafetyObligationRegister,
  saveSafetyCriticalObligation,
  type SafetyObligationWorkspace,
} from "../services/safetyObligationService";

const control =
  "w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100";
export function SafetyObligationRegister() {
  const [workspace, setWorkspace] = useState<SafetyObligationWorkspace | null>(
    null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sceId, setSceId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [status, setStatus] = useState("undetermined");
  const [basis, setBasis] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [missing, setMissing] = useState("");
  const reload = useCallback(
    async () => setWorkspace(await getSafetyObligationRegister()),
    [],
  );
  useEffect(() => {
    void reload().catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [reload]);
  const names = useMemo(
    () => ({
      sce: new Map(
        (workspace?.elements ?? []).map((x) => [x.id, `${x.ref} · ${x.label}`]),
      ),
      requirement: new Map(
        (workspace?.requirements ?? []).map((x) => [
          x.id,
          `${x.ref} · ${x.regulator}`,
        ]),
      ),
    }),
    [workspace],
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveSafetyCriticalObligation({
        sceId: Number(sceId),
        requirementId: Number(requirementId),
        applicabilityStatus: status,
        basis,
        evidenceItemIds: evidenceIds,
        missingEvidence: missing
          .split(";")
          .map((x) => x.trim())
          .filter(Boolean),
      });
      setNotice(
        "Applicability saved without changing regulatory or operational authority.",
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded-xl border border-white/6 p-4"
      aria-labelledby="safety-obligation-heading"
    >
      <h3
        id="safety-obligation-heading"
        className="flex items-center gap-2 text-sm font-semibold text-white"
      >
        <Gavel className="h-4 w-4 text-signal-cyan" aria-hidden />
        Safety-critical regulatory obligations
      </h3>
      <p className="mt-1 text-xs text-slate-400">
        Connect the canonical barrier register to the canonical law and
        regulation chain. A link records applicability; it does not grant a
        permit or authorize work.
      </p>
      <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100">
        {workspace?.authority_boundary ?? "Loading governed register…"}
      </div>
      {error && (
        <p role="alert" className="mt-2 flex gap-2 text-xs text-rose-300">
          <TriangleAlert className="h-4 w-4" />
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-xs text-emerald-300">
          {notice}
        </p>
      )}
      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Current applicability
          </h4>
          {(workspace?.links.length ?? 0) === 0 ? (
            <p className="text-xs text-slate-500">
              No applicability links recorded. Absence is not treated as proof
              that no obligation applies.
            </p>
          ) : (
            workspace?.links.map((link) => (
              <div
                key={`${link.sce_id}-${link.requirement_id}`}
                className="rounded-lg border border-white/6 p-3 text-xs"
              >
                <div className="flex flex-wrap gap-2 text-slate-200">
                  <Link2 className="h-3.5 w-3.5" />
                  <span>{names.sce.get(link.sce_id)}</span>
                  <span className="text-slate-500">→</span>
                  <span>{names.requirement.get(link.requirement_id)}</span>
                  <span className="rounded bg-white/5 px-1.5 uppercase text-slate-400">
                    {link.applicability_status}
                  </span>
                </div>
                <p className="mt-1 text-slate-400">{link.basis}</p>
                {link.missing_evidence.length > 0 && (
                  <p className="mt-1 text-amber-300">
                    Missing: {link.missing_evidence.join(" · ")}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
        <form
          className="space-y-3 rounded-lg border border-white/6 p-3"
          onSubmit={submit}
        >
          <h4 className="text-sm font-medium text-white">
            Record applicability
          </h4>
          <select
            aria-label="Safety-critical element"
            required
            className={control}
            value={sceId}
            onChange={(e) => setSceId(e.target.value)}
          >
            <option value="">Select safety-critical element…</option>
            {workspace?.elements.map((x) => (
              <option key={x.id} value={x.id}>
                {x.ref} · {x.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Regulatory requirement"
            required
            className={control}
            value={requirementId}
            onChange={(e) => setRequirementId(e.target.value)}
          >
            <option value="">Select regulatory requirement…</option>
            {workspace?.requirements.map((x) => (
              <option key={x.id} value={x.id}>
                {x.ref} · {x.regulator} · {x.status}
              </option>
            ))}
          </select>
          <select
            aria-label="Applicability status"
            className={control}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {["undetermined", "applicable", "conditional", "superseded"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
          <textarea
            required
            className={control}
            placeholder="Substantive applicability basis"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          />
          <label className="block text-xs text-slate-400">
            Verified canonical evidence
            <select
              multiple
              aria-label="Verified canonical evidence"
              className={`${control} mt-1 min-h-24`}
              value={evidenceIds}
              onChange={(e) =>
                setEvidenceIds(
                  Array.from(e.currentTarget.selectedOptions).map(
                    (x) => x.value,
                  ),
                )
              }
            >
              {workspace?.evidence
                .filter((x) => x.verification_status === "verified")
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.description} · verified
                  </option>
                ))}
            </select>
          </label>
          <input
            className={control}
            placeholder="Missing evidence; separate with semicolons"
            value={missing}
            onChange={(e) => setMissing(e.target.value)}
          />
          <button
            disabled={busy}
            className="rounded-lg bg-signal-cyan px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            Save applicability
          </button>
        </form>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Create safety-critical elements above. Source regulatory requirements
        remain authored in Sync Develop’s governed requirement → application →
        approval → condition chain.
      </p>
    </section>
  );
}
