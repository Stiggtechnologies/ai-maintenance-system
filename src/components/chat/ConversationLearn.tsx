/**
 * In-thread LEARN after a disposition. Happy path: a signed-in named human
 * records through `recordVerificationResult` (the same write as /learning-loop).
 * If the write cannot happen — anonymous, no open obligation, load error,
 * RPC refusal — fail visibly. Do not render a recorded outcome.
 */
import { useEffect, useState } from "react";
import {
  getOpenObligationIdForRecommendation,
  getOpenVerifications,
  recordVerificationResult,
  type OpenVerification,
  type VerificationResultKind,
} from "../../services/operatingLoopService";
import {
  findOpenVerification,
  recommendationScopedOpen,
} from "../../lib/chat/conversation-learn";
import { Link } from "react-router-dom";
import { InThreadLearnRecorder } from "./InThreadLearnRecorder";
import { LearnUnpersistedPointer } from "./LearnUnpersistedPointer";

export function ConversationLearn({
  signedIn,
  recommendationId,
  simulatedApproval,
}: {
  signedIn: boolean;
  recommendationId?: string | null;
  simulatedApproval: boolean;
}) {
  const [open, setOpen] = useState<OpenVerification[] | null>(null);
  const [boundId, setBoundId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [sourceKey, setSourceKey] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(signedIn);

  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      setOpen(null);
      setBoundId(null);
      setSelectedId("");
      setSourceKey("");
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const boundRecommendation = recommendationId?.trim() || null;
    void Promise.all([
      getOpenVerifications(),
      boundRecommendation
        ? getOpenObligationIdForRecommendation(boundRecommendation)
        : Promise.resolve(null),
    ])
      .then(([rows, bound]) => {
        if (cancelled) return;
        const scoped = recommendationScopedOpen(rows);
        setOpen(scoped);
        setBoundId(bound);
        if (bound) {
          setSelectedId(bound);
        } else {
          // Unbound after Simulate: never auto-pick, even a lone Learning Loop
          // obligation. Explicit pick or refuse.
          setSelectedId("");
        }
        setSourceKey("");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setOpen(null);
        setBoundId(null);
        setSelectedId("");
        setSourceKey("");
        setLoadError(
          caught instanceof Error
            ? caught.message
            : "Could not load open verifications.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, recommendationId]);

  if (!signedIn) {
    return <LearnUnpersistedPointer />;
  }

  if (loading) {
    return (
      <aside className="dw-learn" data-testid="learn-loading">
        <p>Looking up an open verification obligation…</p>
      </aside>
    );
  }

  if (loadError) {
    return (
      <aside className="dw-learn" data-testid="learn-load-error">
        <p role="alert">{loadError}</p>
        <p>Nothing was written.</p>
      </aside>
    );
  }

  const boundRecommendation = recommendationId?.trim() || null;
  if (boundRecommendation && !boundId) {
    return (
      <aside className="dw-learn" data-testid="learn-no-obligation">
        <p role="alert">
          No open verification obligation for this recommendation, so nothing
          was written.
        </p>
        <p>
          Record achieved / not_achieved / inconclusive on{" "}
          <Link to="/learning-loop">Learning Loop</Link> if an obligation
          exists there.
        </p>
      </aside>
    );
  }

  const candidates = open ?? [];
  if (!boundId && candidates.length === 0) {
    return <LearnUnpersistedPointer />;
  }

  const obligationId = boundId || selectedId;
  const selected = obligationId
    ? findOpenVerification(candidates, obligationId)
    : undefined;

  return (
    <div className="dw-learn-stack" data-testid="conversation-learn">
      {simulatedApproval && !boundId && (
        <p className="dw-learn-honest">
          The simulated approval did not create an obligation. Recording here
          writes to an existing Learning Loop obligation — not this demo
          approval. A recommendation is not authorization.
        </p>
      )}
      {!boundId && candidates.length > 0 && (
        <label className="dw-learn-pick">
          <span>Open verification</span>
          <select
            data-testid="learn-obligation-select"
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setSourceKey("");
            }}
          >
            <option value="">Select an open obligation…</option>
            {candidates.map((row) => (
              <option key={row.obligationId} value={row.obligationId}>
                {row.recommendationTitle}
                {row.assetName ? ` · ${row.assetName}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected?.planComplete === false ? (
        <aside className="dw-learn" data-testid="learn-plan-needed">
          <p role="alert">
            This legacy obligation needs an explicit method, acceptance
            criteria, outcome date and named owner before it can close.
          </p>
          <p>
            Complete the governed plan on{" "}
            <Link to="/learning-loop">Learning Loop</Link>. Nothing was
            written.
          </p>
        </aside>
      ) : null}
      {obligationId &&
        selected?.planComplete !== false &&
        selected?.evidenceRequired && (
          <label className="dw-learn-pick">
            <span>Governed evidence source</span>
            <select
              data-testid="learn-evidence-select"
              value={sourceKey}
              onChange={(event) => setSourceKey(event.target.value)}
              disabled={(selected.evidenceCandidates ?? []).length === 0}
            >
              <option value="">Select validated evidence…</option>
              {(selected.evidenceCandidates ?? []).map((candidate) => (
                <option
                  key={`${candidate.kind}:${candidate.id}`}
                  value={`${candidate.kind}:${candidate.id}`}
                >
                  {candidate.kind === "cmms_work_order"
                    ? "CMMS work order"
                    : "Validated evidence"}
                  {` · ${candidate.label}`}
                </option>
              ))}
            </select>
            {(selected.evidenceCandidates ?? []).length === 0 && (
              <span role="alert">
                No eligible source is available. Validate recommendation
                evidence or synchronize a completed same-asset CMMS work
                order. Nothing was written.
              </span>
            )}
          </label>
        )}
      {obligationId &&
      selected?.planComplete !== false &&
      (!selected?.evidenceRequired || sourceKey !== "") ? (
        <InThreadLearnRecorder
          obligationLabel={
            selected?.recommendationTitle ?? "Open verification obligation"
          }
          method={selected?.method}
          onSubmit={async (result, note) => {
            const source = (selected?.evidenceCandidates ?? []).find(
              (candidate) =>
                `${candidate.kind}:${candidate.id}` === sourceKey,
            );
            const recorded = await recordVerificationResult(
              obligationId,
              result as VerificationResultKind,
              note,
              source?.kind === "evidence_item" ? source.id : null,
              source?.kind === "cmms_work_order" ? source.id : null,
            );
            return recorded.detail;
          }}
        />
      ) : !obligationId ? (
        <aside className="dw-learn" data-testid="learn-select-needed">
          <p>
            Choose an open recommendation obligation. Nothing is written until
            a named human records a measured result.
          </p>
        </aside>
      ) : null}
    </div>
  );
}
