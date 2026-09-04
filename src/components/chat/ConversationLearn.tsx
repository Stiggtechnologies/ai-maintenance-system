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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(signedIn);

  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      setOpen(null);
      setBoundId(null);
      setSelectedId("");
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
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setOpen(null);
        setBoundId(null);
        setSelectedId("");
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
            onChange={(event) => setSelectedId(event.target.value)}
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
      {obligationId ? (
        <InThreadLearnRecorder
          obligationLabel={
            selected?.recommendationTitle ?? "Open verification obligation"
          }
          method={selected?.method}
          onSubmit={async (result, note) => {
            const recorded = await recordVerificationResult(
              obligationId,
              result as VerificationResultKind,
              note,
            );
            return recorded.detail;
          }}
        />
      ) : (
        <aside className="dw-learn" data-testid="learn-select-needed">
          <p>
            Choose an open recommendation obligation. Nothing is written until
            a named human records a measured result.
          </p>
        </aside>
      )}
    </div>
  );
}
