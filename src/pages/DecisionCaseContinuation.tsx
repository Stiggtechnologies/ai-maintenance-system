import { useState } from "react";
import type { DecisionCase } from "../lib/decision-case";
import {
  caseReplayPath,
  nextRolloutPhase,
  verificationReturnDue,
  type ContinuationCommand,
  type RolloutProposal,
} from "../lib/decision-case-continuation";
import {
  listDecisionCaseRolloutScope,
  loadDecisionCaseReplay,
  type DecisionCaseAuthorityDirectoryEntry,
} from "../services/decisionCaseService";

type Scope = Awaited<ReturnType<typeof listDecisionCaseRolloutScope>>;
const fieldClass =
  "block w-full rounded border border-white/20 bg-slate-950 p-2 text-sm";
export function DecisionCaseContinuation({
  decisionCase,
  userId,
  directory,
  busy,
  command,
}: {
  decisionCase: DecisionCase;
  userId: string;
  directory: DecisionCaseAuthorityDirectoryEntry[];
  busy: boolean;
  command: (
    command: ContinuationCommand,
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [recipient, setRecipient] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [version, setVersion] = useState(String(decisionCase.revision));
  const [replay, setReplay] = useState<DecisionCase | null>(null);
  const [notice, setNotice] = useState("");
  const [scope, setScope] = useState<Scope | null>(null);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [metric, setMetric] = useState("");
  const [unit, setUnit] = useState("");
  const [baseline, setBaseline] = useState("");
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<"at_most" | "at_least">("at_most");
  const [observations, setObservations] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");
  const [handoverPlan, setHandoverPlan] = useState("");
  const [residualRiskBasis, setResidualRiskBasis] = useState("");
  const [receivingOwnerId, setReceivingOwnerId] = useState("");
  const [actual, setActual] = useState("");
  const phase = nextRolloutPhase(decisionCase);
  const reminder = decisionCase.verificationReturn;
  const rollout = decisionCase.rollout;
  const eligibleEvidence = decisionCase.evidence.filter(
    (e) =>
      ["high", "medium"].includes(e.quality) && e.persistence !== "pending",
  );
  const date = (value: string) => new Date(value).toISOString();
  const act = async (
    name: ContinuationCommand,
    payload: Record<string, unknown>,
  ) => {
    setNotice("");
    await command(name, payload);
  };
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      setNotice("");
      await fn();
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "The request did not complete.",
      );
    }
  };
  const personOptions = directory.map((p) => (
    <option key={p.userId} value={p.userId}>
      {p.name} · {p.role}
    </option>
  ));
  const input = (
    label: string,
    value: string,
    set: (value: string) => void,
    type = "text",
  ) => (
    <label className="block">
      {label}
      <input
        className={fieldClass}
        type={type}
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
  return (
    <section
      data-testid="case-continuation"
      className="space-y-4 rounded-2xl border border-white/10 bg-[#0D1520] p-4 text-sm text-slate-200"
    >
      <h2 className="font-semibold">Return, review and expand deliberately</h2>
      <p>
        These are saved decision gates. They never dispatch work, grant access,
        send reminders or assert engineering suitability.
      </p>
      <label className="block">
        Decision or reminder reason
        <textarea
          aria-label="Decision or reminder reason"
          className={fieldClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <details>
        <summary>Reconsider the decision</summary>
        <p>
          Preserve the prior decision in its immutable audit revision. Reopening
          invalidates current approval, verification and rollout standing; new
          evidence needs a fresh disposition and independent approval.
        </p>
        <button
          disabled={
            busy ||
            !decisionCase.humanApproval ||
            decisionCase.requiredPerson?.userId !== userId ||
            reason.trim().length < 20
          }
          onClick={() => void act("reconsider", { reason })}
        >
          Reopen for changed evidence
        </button>
        {decisionCase.reconsideration && (
          <p>Reopened: {decisionCase.reconsideration.reason}</p>
        )}
      </details>
      <details open={verificationReturnDue(decisionCase)}>
        <summary>Verification return and internal reminder</summary>
        <p>
          {reminder
            ? `${reminder.status} · due ${reminder.dueAt}${verificationReturnDue(decisionCase) ? " · due for review" : ""}`
            : "Define a verification plan to create a saved return obligation."}
        </p>
        <p>
          The verification owner sees this obligation on their saved-work return
          list. No email or external notification is sent.
        </p>
        {input("Remind me again at", dueAt, setDueAt, "datetime-local")}
        <button
          disabled={
            busy ||
            reminder?.ownerId !== userId ||
            reminder.status === "completed" ||
            reason.trim().length < 8
          }
          onClick={() =>
            void act("verification_return", { action: "acknowledge", reason })
          }
        >
          Acknowledge verification return
        </button>
        <button
          disabled={
            busy ||
            reminder?.ownerId !== userId ||
            reminder.status === "completed" ||
            !dueAt ||
            reason.trim().length < 8
          }
          onClick={() =>
            void attempt(() =>
              act("verification_return", {
                action: "snooze",
                reason,
                dueAt: date(dueAt),
              }),
            )
          }
        >
          Save internal reminder date
        </button>
      </details>
      <details>
        <summary>Controlled reference and historical replay</summary>
        <p>
          References require existing same-tenant access and a signed-in
          account. Revocation closes this reference; it does not remove a
          colleague's existing case access.
        </p>
        <label>
          Existing colleague
          <select
            aria-label="Share recipient"
            className={fieldClass}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          >
            <option value="">Choose a current tenant colleague</option>
            {personOptions}
          </select>
        </label>
        {input("Reference expiry", expiresAt, setExpiresAt, "datetime-local")}
        <button
          disabled={busy || !recipient || !expiresAt}
          onClick={() =>
            void attempt(() =>
              act("record_share", {
                recipientId: recipient,
                expiresAt: date(expiresAt),
              }),
            )
          }
        >
          Create authenticated reference
        </button>
        {decisionCase.shares
          ?.filter((s) => s.createdBy === userId || s.recipientId === userId)
          .map((s) => (
            <div key={s.id}>
              <p>
                Revision {s.version} · {s.status} · expires {s.expiresAt}
              </p>
              {s.status === "active" && (
                <>
                  <a href={caseReplayPath(decisionCase.id, s)}>
                    Open authenticated replay
                  </a>
                  <button
                    onClick={() =>
                      void attempt(async () => {
                        await navigator.clipboard.writeText(
                          new URL(
                            caseReplayPath(decisionCase.id, s),
                            window.location.origin,
                          ).href,
                        );
                        setNotice("Reference copied. No message was sent.");
                      })
                    }
                  >
                    Copy reference
                  </button>
                </>
              )}
              <button
                disabled={
                  busy || s.status !== "active" || s.createdBy !== userId
                }
                onClick={() => void act("revoke_share", { shareId: s.id })}
              >
                Revoke reference
              </button>
            </div>
          ))}
        {input("Historical revision", version, setVersion, "number")}
        <button
          disabled={busy}
          onClick={() =>
            void attempt(async () => {
              setReplay(null);
              setReplay(
                await loadDecisionCaseReplay(decisionCase.id, Number(version)),
              );
            })
          }
        >
          Load read-only revision
        </button>
        {replay && (
          <div>
            <p>
              Historical revision {replay.revision}; current case is unchanged.
            </p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(replay, null, 2)}
            </pre>
            <button onClick={() => setReplay(null)}>
              Close historical revision
            </button>
          </div>
        )}
      </details>
      <details>
        <summary>Bounded pilot → site → fleet → enterprise → handover</summary>
        <p>
          Current stage: {rollout?.acceptedPhase ?? "No stage accepted"}. Next:{" "}
          {phase ?? "All stages accepted"}. Each stage needs scoped evidence,
          measured criteria and an independent human decision. Enterprise and
          handover require an existing admin/executive receiving authority.
        </p>
        {rollout && (
          <p>
            Proposal: {rollout.proposal.phase} · {rollout.status}
            {rollout.result
              ? ` · criteria ${rollout.result.criteriaMet ? "met" : "not met"} (${rollout.result.actual} ${rollout.proposal.unit}, ${rollout.result.observations} observations)`
              : " · no measured result"}
          </p>
        )}
        <button
          disabled={busy}
          onClick={() =>
            void attempt(async () =>
              setScope(await listDecisionCaseRolloutScope()),
            )
          }
        >
          Load existing sites and assets
        </button>
        {scope && (
          <>
            <fieldset>
              <legend>Canonical sites</legend>
              {scope.sites.map((s) => (
                <label className="block" key={s.id}>
                  <input
                    type="checkbox"
                    checked={siteIds.includes(s.id)}
                    onChange={(e) =>
                      setSiteIds(
                        e.target.checked
                          ? [...siteIds, s.id]
                          : siteIds.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.name}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Canonical fleet assets</legend>
              {scope.assets
                .filter((a) => siteIds.includes(a.site_id))
                .map((a) => (
                  <label className="block" key={a.id}>
                    <input
                      type="checkbox"
                      checked={assetIds.includes(a.id)}
                      onChange={(e) =>
                        setAssetIds(
                          e.target.checked
                            ? [...assetIds, a.id]
                            : assetIds.filter((id) => id !== a.id),
                        )
                      }
                    />
                    {a.name}
                  </label>
                ))}
            </fieldset>
          </>
        )}
        {input("Acceptance metric", metric, setMetric)}
        {input("Measurement unit", unit, setUnit)}
        {input("Measured baseline", baseline, setBaseline, "number")}
        {input("Acceptance target", target, setTarget, "number")}
        <label>
          Acceptance direction
          <select
            aria-label="Acceptance direction"
            className={fieldClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            <option value="at_most">At most target</option>
            <option value="at_least">At least target</option>
          </select>
        </label>
        {input(
          "Minimum observations / observed count",
          observations,
          setObservations,
          "number",
        )}
        {input(
          "Measurement window closes",
          windowEnd,
          setWindowEnd,
          "datetime-local",
        )}
        <label>
          Case evidence
          <select
            aria-label="Rollout evidence"
            className={fieldClass}
            value={evidenceId}
            onChange={(e) => setEvidenceId(e.target.value)}
          >
            <option value="">Choose supplied evidence</option>
            {eligibleEvidence.map((e) => (
              <option value={e.id} key={e.id}>
                {e.title} · {e.id}
              </option>
            ))}
          </select>
        </label>
        {input("Rollback plan", rollbackPlan, setRollbackPlan)}
        {input("Handover plan", handoverPlan, setHandoverPlan)}
        {input(
          "Residual-risk review basis",
          residualRiskBasis,
          setResidualRiskBasis,
        )}
        <label>
          Receiving authority
          <select
            aria-label="Receiving authority"
            className={fieldClass}
            value={receivingOwnerId}
            onChange={(e) => setReceivingOwnerId(e.target.value)}
          >
            <option value="">Choose an independent receiving owner</option>
            {personOptions}
          </select>
        </label>
        <button
          disabled={
            busy ||
            !phase ||
            rollout?.status === "proposed" ||
            !siteIds.length ||
            !evidenceId ||
            !windowEnd ||
            !baseline ||
            !target ||
            !observations ||
            !receivingOwnerId ||
            decisionCase.humanApproval?.decision !== "approved"
          }
          onClick={() =>
            void attempt(() => {
              const proposal: RolloutProposal = {
                phase: phase!,
                siteIds,
                assetIds,
                metric,
                unit,
                baseline: Number(baseline),
                target: Number(target),
                direction,
                minimumObservations: Number(observations),
                windowEnd: date(windowEnd),
                acceptanceEvidenceIds: [evidenceId],
                rollbackPlan,
                handoverPlan,
                residualRiskBasis,
                receivingOwnerId,
              };
              return act("propose_rollout", { proposal });
            })
          }
        >
          Propose next bounded stage
        </button>
        {input("Observed actual", actual, setActual, "number")}
        <button
          disabled={
            busy ||
            rollout?.status !== "proposed" ||
            Boolean(rollout.result) ||
            !actual ||
            !observations ||
            !evidenceId ||
            reminder?.ownerId !== userId
          }
          onClick={() =>
            void act("record_rollout_result", {
              actual: Number(actual),
              observations: Number(observations),
              evidenceId,
            })
          }
        >
          Record measured stage result
        </button>
        <button
          disabled={
            busy ||
            rollout?.status !== "proposed" ||
            !rollout.result?.criteriaMet ||
            reason.trim().length < 20
          }
          onClick={() =>
            void act("decide_rollout", { decision: "accepted", reason })
          }
        >
          Accept bounded stage as authorized human
        </button>
        <button
          disabled={
            busy || rollout?.status !== "proposed" || reason.trim().length < 20
          }
          onClick={() =>
            void act("decide_rollout", { decision: "rejected", reason })
          }
        >
          Reject stage proposal
        </button>
        <p>
          A recorded acceptance does not release ACTION or qualify live
          deployment. Deployment and operating handover require their existing
          release controls.
        </p>
      </details>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
