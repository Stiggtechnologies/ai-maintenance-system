import { useState } from "react";
import type { ApprovalStatus, DecisionApproval } from "../../lib/decision-case";
import type { EstablishedFact } from "../../lib/chat/recommendation-turn";
import { delegateCandidates } from "../../lib/chat/recommendation-turn";

export function RecommendationTurn({
  established,
  notProven,
  recommendation,
  recommendationDetail,
  authorityName,
  authorityRole,
  publicMode,
  canDispose,
  frozen,
  approvals,
  onDecide,
}: {
  established: EstablishedFact[];
  notProven: string[];
  recommendation: string;
  recommendationDetail: string;
  authorityName: string;
  authorityRole: string;
  publicMode: boolean;
  canDispose: boolean;
  frozen: ApprovalStatus | null;
  approvals: DecisionApproval[];
  onDecide: (status: ApprovalStatus, extra?: { delegateName?: string }) => void;
}) {
  const [openSource, setOpenSource] = useState<string | null>(null);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const delegates = delegateCandidates(approvals, authorityName);
  const approveLabel = publicMode ? "Simulate" : "Approve";
  const disabled = !canDispose || Boolean(frozen);

  return (
    <div className="dw-rec" data-testid="recommendation-turn">
      <section className="dw-rec-block">
        <h3>Established</h3>
        <ul>
          {established.map((item) => (
            <li key={item.id}>
              <span>{item.fact}</span>
              <button
                type="button"
                className="dw-rec-source"
                onClick={() =>
                  setOpenSource((current) =>
                    current === item.id ? null : item.id,
                  )
                }
              >
                {item.sourceTitle}
              </button>
              {openSource === item.id && (
                <div className="dw-rec-source-body">
                  <p>{item.record}</p>
                  <p>{item.lineage}</p>
                  <p>{item.sourceSystem}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="dw-rec-block">
        <h3>Not proven</h3>
        <ul>
          {notProven.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="dw-rec-block dw-rec-recommendation">
        <h3>Recommendation · not authorization</h3>
        <p>{recommendation}</p>
        {recommendationDetail && <p>{recommendationDetail}</p>}
        <p className="dw-rec-authority">
          Authority: {authorityName}, {authorityRole}
        </p>
        {frozen ? (
          <p className="dw-rec-frozen" data-testid="disposition-record">
            Disposition recorded: {frozen.replaceAll("_", " ")}
          </p>
        ) : (
          <>
            <div className="dw-rec-actions" role="group" aria-label="Disposition">
              <button
                type="button"
                className="dw-rec-approve"
                disabled={disabled}
                onClick={() => onDecide("approved")}
              >
                {approveLabel}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDecide("changes_requested")}
              >
                Request changes
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setDelegateOpen((value) => !value)}
              >
                Delegate
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDecide("rejected")}
              >
                Reject
              </button>
            </div>
            {disabled && (
              <p className="dw-rec-waiting">
                Waiting on {authorityName}, {authorityRole}
              </p>
            )}
            {delegateOpen && !disabled && (
              <div className="dw-rec-delegate" data-testid="delegate-picker">
                {delegates.length === 0 ? (
                  <p>No other named human is on this turn.</p>
                ) : (
                  delegates.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        onDecide("delegated", { delegateName: item.name });
                        setDelegateOpen(false);
                      }}
                    >
                      {item.name}, {item.role}
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
