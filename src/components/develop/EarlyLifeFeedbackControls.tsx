import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  getCaseEarlyLifeFeedbackWorkspace,
  linkCaseEarlyLifeFailure,
  type EarlyLifeFeedbackWorkspace,
  type TransitionFailure,
} from "../../services/syncTransitionService";

const inputClass =
  "w-full rounded border border-white/10 bg-overlook-deep p-2 text-xs text-slate-200 placeholder:text-slate-500";

const words = (value: string) => value.replaceAll("_", " ");

export function EarlyLifeFeedbackControls({
  caseId,
  failures,
  canLink,
}: {
  caseId: string;
  failures: TransitionFailure[];
  canLink: boolean;
}) {
  const [workspace, setWorkspace] = useState<EarlyLifeFeedbackWorkspace | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkingFailure, setLinkingFailure] = useState<number | null>(null);
  const [requirementId, setRequirementId] = useState("");
  const [evidenceItemId, setEvidenceItemId] = useState("");
  const [basis, setBasis] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setWorkspace(await getCaseEarlyLifeFeedbackWorkspace(caseId));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load early-life feedback",
      );
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const linksByFailure = useMemo(() => {
    const grouped = new Map<number, EarlyLifeFeedbackWorkspace["links"]>();
    for (const link of workspace?.links ?? []) {
      grouped.set(link.failureId, [
        ...(grouped.get(link.failureId) ?? []),
        link,
      ]);
    }
    return grouped;
  }, [workspace]);

  const startLink = (failureId: number) => {
    setLinkingFailure(failureId);
    setRequirementId("");
    setEvidenceItemId("");
    setBasis("");
    setNote(null);
    setError(null);
  };

  const submit = async () => {
    if (linkingFailure === null) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await linkCaseEarlyLifeFailure({
        caseId,
        failureId: linkingFailure,
        requirementId: Number(requirementId),
        evidenceItemId,
        basis,
      });
      setNote(result.note);
      setLinkingFailure(null);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The feedback link was refused",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-signal-cyan" aria-hidden />
        <h3 className="text-xs font-semibold text-slate-200">
          Design-feedback closure
        </h3>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        {workspace?.boundary ??
          "Loading the canonical requirement and evidence links…"}
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded border border-rose-400/25 bg-rose-400/10 p-2 text-xs text-rose-300"
        >
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="rounded border border-signal-cyan/25 bg-signal-cyan/5 p-2 text-xs text-signal-cyan">
          {note}
        </p>
      ) : null}
      {workspace && workspace.requirements.length === 0 ? (
        <p className="rounded border border-amber-400/25 bg-amber-400/5 p-2 text-xs text-amber-200">
          This case has no canonical design requirement to carry the learning.
          Record the requirement in the case workspace before claiming feedback
          closure.
        </p>
      ) : null}

      {failures.map((failure) => {
        const links = linksByFailure.get(failure.id) ?? [];
        const eliminated = links.some(
          (link) => link.eliminationStatus === "verified_eliminated",
        );
        const ineffective =
          links.length > 0 &&
          links.every((link) => link.eliminationStatus === "ineffective");
        return (
          <div
            key={failure.id}
            className="rounded border border-white/8 bg-white/[0.015] p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-300">
                <span className="font-semibold">
                  {failure.assetName}:{" "}
                  {failure.failureMode ?? "Failure mode not recorded"}
                </span>
                <span className="ml-2 text-slate-500">
                  {failure.sourceReference ?? "no source reference"}
                </span>
              </div>
              <span
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
                  eliminated
                    ? "bg-emerald-400/10 text-emerald-200"
                    : ineffective
                      ? "bg-rose-400/10 text-rose-200"
                      : links.length > 0
                        ? "bg-amber-400/10 text-amber-200"
                        : "bg-white/5 text-slate-400"
                }`}
              >
                {eliminated ? (
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                ) : ineffective ? (
                  <TriangleAlert className="h-3 w-3" aria-hidden />
                ) : null}
                {eliminated
                  ? "verified eliminated"
                  : ineffective
                    ? "linked remedy failed or waived"
                    : links.length > 0
                      ? "feedback linked; verification pending"
                      : "feedback open"}
              </span>
            </div>
            {links.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[11px] text-slate-500">
                {links.map((link) => (
                  <li key={link.id}>
                    <span className="font-mono text-slate-300">
                      {link.requirementRef}
                    </span>{" "}
                    · {words(link.verificationStatus)} · {link.basis}
                  </li>
                ))}
              </ul>
            ) : null}
            {canLink && workspace && workspace.requirements.length > 0 ? (
              <button
                type="button"
                className="mt-2 rounded bg-signal-cyan/15 px-2.5 py-1.5 text-[11px] font-semibold text-signal-cyan hover:bg-signal-cyan/25"
                onClick={() => startLink(failure.id)}
              >
                Link retained evidence to a design requirement
              </button>
            ) : null}
            {linkingFailure === failure.id && workspace ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <select
                  aria-label="Design requirement"
                  className={inputClass}
                  value={requirementId}
                  onChange={(event) => setRequirementId(event.target.value)}
                >
                  <option value="">Design requirement…</option>
                  {workspace.requirements.map((requirement) => (
                    <option key={requirement.id} value={requirement.id}>
                      {requirement.requirementRef} · {requirement.requirement}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Verified feedback evidence"
                  className={inputClass}
                  value={evidenceItemId}
                  onChange={(event) => setEvidenceItemId(event.target.value)}
                >
                  <option value="">Verified feedback evidence…</option>
                  {workspace.evidence.map((evidence) => (
                    <option key={evidence.id} value={evidence.id}>
                      {evidence.description}
                    </option>
                  ))}
                </select>
                <textarea
                  aria-label="Feedback linkage basis"
                  className={`${inputClass} md:col-span-2`}
                  rows={2}
                  minLength={20}
                  placeholder="Why this exact design requirement addresses the observed failure (20+ characters)"
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                />
                <div className="flex gap-2 md:col-span-2">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !requirementId ||
                      !evidenceItemId ||
                      basis.trim().length < 20
                    }
                    className="rounded bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
                    onClick={() => void submit()}
                  >
                    {busy ? "Linking…" : "Record feedback link"}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-white/10 px-3 py-2 text-xs text-slate-300"
                    onClick={() => setLinkingFailure(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
