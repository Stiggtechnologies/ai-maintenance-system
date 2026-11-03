/**
 * Settings → Security. Tenant recovery objectives and restore verification.
 * Durations start empty. The outcome shown is the one the database computed.
 */
import { useCallback, useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  adoptRecoveryObjective,
  getRecoveryPosture,
  recordRestoreVerification,
  stateRecoveryObjective,
  withdrawRecoveryObjectiveDraft,
  type RecoveryPosture,
  type VerificationOutcome,
} from "../services/recoveryGovernanceService";

const OUTCOME_LABEL: Record<VerificationOutcome, string> = {
  within_objectives: "Within the adopted objectives",
  outside_objectives: "Outside the adopted objectives",
  checks_not_run: "Checks not run — not a pass",
};

function secondsLabel(value: number): string {
  return `${value} seconds`;
}

export function RecoveryObjectivesPanel() {
  const { user, profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canManage = role === "admin" || role === "executive";
  const viewerId = user?.id ?? null;
  const [posture, setPosture] = useState<RecoveryPosture | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rpo, setRpo] = useState("");
  const [rto, setRto] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [procedure, setProcedure] = useState("");
  const [basis, setBasis] = useState("");
  const [adoptNote, setAdoptNote] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [backupLabel, setBackupLabel] = useState("");
  const [restoreTarget, setRestoreTarget] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [measuredLoss, setMeasuredLoss] = useState("");
  const [measuredRestore, setMeasuredRestore] = useState("");
  const [rowCheck, setRowCheck] = useState("");
  const [witness, setWitness] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPosture(await getRecoveryPosture());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load recovery posture.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const draft = posture?.draft ?? null;
  const adopted = posture?.adopted ?? null;
  const sameStater = draft != null && draft.stated_by === viewerId;

  return (
    <section
      aria-labelledby="recovery-objectives-heading"
      className="rounded-xl border border-white/10 bg-black/20 p-4"
      data-testid="recovery-objectives"
    >
      <h2
        id="recovery-objectives-heading"
        className="flex items-center gap-2 text-lg font-semibold text-industrial-text"
      >
        <LifeBuoy className="h-5 w-5" aria-hidden />
        Disaster recovery
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Recovery point and recovery time are yours to state. This screen does
        not fill them in. A restore is within those objectives only when the
        recorded measurements and both checks say so.
      </p>

      {loading && (
        <p className="mt-3 text-sm text-slate-400">Loading recovery posture…</p>
      )}
      {error && (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="mt-3 text-sm text-slate-300">{notice}</p>}

      {posture && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-white/10 p-3 text-sm text-slate-300">
            <p>{posture.documentation.boundary}</p>
            <p className="mt-2 text-xs text-slate-400">
              Tested database procedure: {posture.documentation.database_drill}.
              Runbook: {posture.documentation.runbook}. Production PITR proven:{" "}
              {posture.documentation.production_pitr_proven ? "yes" : "no"}.
              Storage bytes proven:{" "}
              {posture.documentation.storage_object_bytes_proven ? "yes" : "no"}
              . Vault root proven:{" "}
              {posture.documentation.vault_root_key_proven ? "yes" : "no"}.
            </p>
          </div>

          <div data-testid="recovery-adopted">
            <h3 className="text-sm font-semibold text-slate-200">
              Adopted objective
            </h3>
            {adopted ? (
              <p className="mt-1 text-sm text-slate-300">
                RPO {secondsLabel(adopted.rpo_seconds)}, RTO{" "}
                {secondsLabel(adopted.rto_seconds)}. Owner{" "}
                {adopted.recovery_owner_name}. Procedure{" "}
                {adopted.procedure_reference}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-400">
                No recovery objective has been adopted. There is no platform
                default RPO or RTO.
              </p>
            )}
          </div>

          {canManage && !draft && (
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await stateRecoveryObjective({
                    rpoSeconds: rpo.trim(),
                    rtoSeconds: rto.trim(),
                    recoveryOwnerId: ownerId,
                    procedureReference: procedure.trim(),
                    basis: basis.trim(),
                  });
                  setNotice(
                    "Draft stated. A different named human adopts it before it is the objective.",
                  );
                  setRpo("");
                  setRto("");
                  setBasis("");
                });
              }}
            >
              <label className="block text-xs text-slate-400">
                Recovery point (seconds)
                <input
                  data-testid="recovery-rpo"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={rpo}
                  onChange={(event) => setRpo(event.target.value)}
                  inputMode="decimal"
                  placeholder="Seconds from your instrument"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Recovery time (seconds)
                <input
                  data-testid="recovery-rto"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={rto}
                  onChange={(event) => setRto(event.target.value)}
                  inputMode="decimal"
                  placeholder="Seconds from your instrument"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Named recovery owner
                <select
                  data-testid="recovery-owner"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={ownerId}
                  onChange={(event) => setOwnerId(event.target.value)}
                >
                  <option value="">Choose a named person…</option>
                  {posture.candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.full_name} ({candidate.role})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-400">
                Backup and restore procedure
                <input
                  data-testid="recovery-procedure"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={procedure}
                  onChange={(event) => setProcedure(event.target.value)}
                  placeholder="Cite the procedure you will test"
                />
              </label>
              <label className="block text-xs text-slate-400 md:col-span-2">
                Instrument (20+ characters)
                <input
                  data-testid="recovery-basis"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                  placeholder="The decision that sets these objectives"
                />
              </label>
              <button
                type="submit"
                data-testid="recovery-state"
                disabled={
                  busy ||
                  rpo.trim() === "" ||
                  rto.trim() === "" ||
                  ownerId === "" ||
                  procedure.trim().length < 10 ||
                  basis.trim().length < 20
                }
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40"
              >
                State objective
              </button>
            </form>
          )}

          {canManage && draft && (
            <div className="rounded-lg border border-amber-500/30 p-3 text-sm text-slate-300">
              <p>
                Draft version {draft.version}: RPO{" "}
                {secondsLabel(draft.rpo_seconds)}, RTO{" "}
                {secondsLabel(draft.rto_seconds)}, stated by{" "}
                {draft.stated_by_name}.
              </p>
              {sameStater ? (
                <p className="mt-2 text-xs text-amber-200">
                  You stated this objective. A different named administrator or
                  executive adopts it.
                </p>
              ) : (
                <label className="mt-3 block text-xs text-slate-400">
                  Adoption note (20+ characters)
                  <input
                    data-testid="recovery-adopt-note"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                    value={adoptNote}
                    onChange={(event) => setAdoptNote(event.target.value)}
                  />
                </label>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {!sameStater && (
                  <button
                    type="button"
                    data-testid="recovery-adopt"
                    disabled={busy || adoptNote.trim().length < 20}
                    className="rounded-lg bg-teal-500/90 px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-40"
                    onClick={() =>
                      void run(async () => {
                        await adoptRecoveryObjective({
                          objectiveId: draft.id,
                          note: adoptNote.trim(),
                        });
                        setNotice("Recovery objective adopted.");
                        setAdoptNote("");
                      })
                    }
                  >
                    Adopt objective
                  </button>
                )}
                <label className="block text-xs text-slate-400">
                  Withdrawal note
                  <input
                    data-testid="recovery-withdraw-note"
                    className="mt-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                    value={withdrawNote}
                    onChange={(event) => setWithdrawNote(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || withdrawNote.trim().length < 10}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40"
                  onClick={() =>
                    void run(async () => {
                      await withdrawRecoveryObjectiveDraft({
                        objectiveId: draft.id,
                        note: withdrawNote.trim(),
                      });
                      setNotice("Draft withdrawn. No objective was assumed.");
                      setWithdrawNote("");
                    })
                  }
                >
                  Withdraw draft
                </button>
              </div>
            </div>
          )}

          {canManage && adopted && (
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await recordRestoreVerification({
                    objectiveId: adopted.id,
                    backupLabel: backupLabel.trim(),
                    restoreTarget: restoreTarget.trim(),
                    evidenceReference: evidenceRef.trim(),
                    measuredDataLossSeconds: measuredLoss.trim(),
                    measuredRestoreSeconds: measuredRestore.trim(),
                    canonicalRowCheck: rowCheck as
                      "matched" | "mismatched" | "not_run",
                    tenantIsolationWitness: witness as
                      "passed" | "failed" | "not_run",
                  });
                  setNotice(OUTCOME_LABEL[result.verification_outcome]);
                  setBackupLabel("");
                  setRestoreTarget("");
                  setEvidenceRef("");
                  setMeasuredLoss("");
                  setMeasuredRestore("");
                  setRowCheck("");
                  setWitness("");
                });
              }}
            >
              <h3 className="text-sm font-semibold text-slate-200 md:col-span-2">
                Record a restore verification
              </h3>
              <label className="block text-xs text-slate-400">
                Backup label
                <input
                  data-testid="recovery-backup"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={backupLabel}
                  onChange={(event) => setBackupLabel(event.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Isolated restore target
                <input
                  data-testid="recovery-target"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={restoreTarget}
                  onChange={(event) => setRestoreTarget(event.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Measured data loss (seconds)
                <input
                  data-testid="recovery-loss"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={measuredLoss}
                  onChange={(event) => setMeasuredLoss(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Measured restore duration (seconds)
                <input
                  data-testid="recovery-duration"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={measuredRestore}
                  onChange={(event) => setMeasuredRestore(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Canonical rows
                <select
                  data-testid="recovery-rows"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={rowCheck}
                  onChange={(event) => setRowCheck(event.target.value)}
                >
                  <option value="">Choose…</option>
                  <option value="matched">Matched</option>
                  <option value="mismatched">Mismatched</option>
                  <option value="not_run">Not run</option>
                </select>
              </label>
              <label className="block text-xs text-slate-400">
                Tenant isolation witness
                <select
                  data-testid="recovery-witness"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={witness}
                  onChange={(event) => setWitness(event.target.value)}
                >
                  <option value="">Choose…</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="not_run">Not run</option>
                </select>
              </label>
              <label className="block text-xs text-slate-400 md:col-span-2">
                Evidence reference
                <input
                  data-testid="recovery-evidence"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={evidenceRef}
                  onChange={(event) => setEvidenceRef(event.target.value)}
                  placeholder="Where the retained drill evidence lives"
                />
              </label>
              <button
                type="submit"
                data-testid="recovery-verify"
                disabled={
                  busy ||
                  backupLabel.trim().length < 8 ||
                  restoreTarget.trim().length < 8 ||
                  evidenceRef.trim().length < 20 ||
                  measuredLoss.trim() === "" ||
                  measuredRestore.trim() === "" ||
                  rowCheck === "" ||
                  witness === ""
                }
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40"
              >
                Record verification
              </button>
            </form>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              Restore verifications
            </h3>
            {posture.verifications.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">
                No restore has been recorded against an adopted objective.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {posture.verifications.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-white/10 p-3 text-sm text-slate-300"
                  >
                    <p>{OUTCOME_LABEL[item.verification_outcome]}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Loss {item.measured_data_loss_seconds}s against RPO{" "}
                      {item.rpo_seconds_applied}s. Restore{" "}
                      {item.measured_restore_seconds}s against RTO{" "}
                      {item.rto_seconds_applied}s. Rows{" "}
                      {item.canonical_row_check}. Witness{" "}
                      {item.tenant_isolation_witness}. Recorded by{" "}
                      {item.recorded_by_name}.
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
