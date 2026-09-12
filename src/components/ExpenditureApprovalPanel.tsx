import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Banknote, ShieldCheck } from "lucide-react";
import {
  decideExpenditureCommitment,
  getExpenditureApprovalWorkspace,
  requestExpenditureCommitment,
  type ExpenditureApprovalWorkspace,
} from "../services/expenditureApprovalService";
import {
  adoptAuthorityLimit,
  draftAuthorityCeiling,
  stateAuthorityCeiling,
} from "../services/developService";

const input =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const button =
  "rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

export function ExpenditureApprovalPanel() {
  const [workspace, setWorkspace] =
    useState<ExpenditureApprovalWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});
  const [limitId, setLimitId] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [basis, setBasis] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setWorkspace(await getExpenditureApprovalWorkspace());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void act(async () => {
      await requestExpenditureCommitment({
        title: String(form.get("title") ?? ""),
        amount: String(form.get("amount") ?? ""),
        currency: String(form.get("currency") ?? ""),
        purpose: String(form.get("purpose") ?? ""),
        evidenceBasis: String(form.get("evidence") ?? ""),
        consequenceOfWrong: String(form.get("consequence") ?? ""),
      });
      formElement.reset();
    });
  };
  const delegations = workspace?.delegations.delegations ?? [];
  const drafts = delegations.filter((d) => d.status === "draft");
  const selected = delegations.find((d) => d.id === limitId);

  return (
    <section
      className="rounded-xl border border-emerald-400/15 bg-[#0D1520] p-5"
      aria-labelledby="expenditure-approval-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="expenditure-approval-title"
            className="flex items-center gap-2 text-sm font-semibold text-slate-100"
          >
            <Banknote className="h-4 w-4 text-emerald-300" />
            Significant expenditure approval
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-400">
            Request a bounded financial commitment, route it to an independent
            human, and prove the exact adopted amount-and-currency ceiling used.
          </p>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">
          C5.16 · governed
        </span>
      </div>
      <p className="mt-3 rounded-lg border border-amber-400/15 bg-amber-400/5 p-3 text-xs text-amber-100">
        {workspace?.control ?? "Loading control boundary…"}
      </p>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200"
        >
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <form
          onSubmit={submit}
          className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-4"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Request approval
          </h3>
          <input
            name="title"
            required
            minLength={5}
            placeholder="Commitment title"
            className={input}
          />
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder="Amount"
              className={input}
            />
            <input
              name="currency"
              required
              defaultValue="CAD"
              maxLength={3}
              aria-label="Currency"
              className={input}
            />
          </div>
          <textarea
            name="purpose"
            required
            minLength={20}
            placeholder="Business purpose and intended outcome (20+ characters)"
            className={input}
          />
          <textarea
            name="evidence"
            required
            minLength={20}
            placeholder="Evidence supporting the request (20+ characters)"
            className={input}
          />
          <textarea
            name="consequence"
            required
            minLength={20}
            placeholder="Consequence if this decision is wrong (20+ characters)"
            className={input}
          />
          <button
            disabled={busy || workspace?.canRequest === false}
            className={button}
          >
            Route for independent approval
          </button>
        </form>

        <div className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Adopted expenditure ceilings
          </h3>
          {delegations.length === 0 ? (
            <p className="text-xs text-amber-200">
              No expenditure delegation exists. Every approval will refuse.
            </p>
          ) : (
            delegations.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 border-b border-white/5 py-2 text-xs"
              >
                <span className="text-slate-300">
                  {d.roleKey} · {d.status}
                </span>
                <span
                  className={
                    d.maxCommitment == null
                      ? "text-amber-200"
                      : "text-emerald-200"
                  }
                >
                  {d.maxCommitment == null
                    ? "ceiling unstated — refuses"
                    : `${d.maxCommitmentCurrency} ${d.maxCommitment.toLocaleString()}`}
                </span>
              </div>
            ))
          )}
          {workspace?.delegations.canState && drafts.length > 0 && (
            <div className="space-y-2 pt-2">
              <select
                aria-label="Draft expenditure delegation"
                value={limitId}
                onChange={(e) => setLimitId(e.target.value)}
                className={input}
              >
                <option value="">Select draft delegation…</option>
                {drafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.roleKey} · v{d.version}
                  </option>
                ))}
              </select>
              {selected?.selfAdoptionRefusal && (
                <p className="text-xs text-amber-200">
                  {selected.selfAdoptionRefusal}
                </p>
              )}
              <div className="grid grid-cols-[1fr_96px] gap-2">
                <input
                  value={ceiling}
                  onChange={(e) => setCeiling(e.target.value)}
                  placeholder="Ceiling"
                  className={input}
                />
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  aria-label="Ceiling currency"
                  className={input}
                />
              </div>
              <input
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
                placeholder="Delegation instrument and basis (20+ characters)"
                className={input}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={
                    busy ||
                    !limitId ||
                    !ceiling ||
                    currency.length !== 3 ||
                    basis.trim().length < 20 ||
                    !!selected?.selfAdoptionRefusal
                  }
                  className={button}
                  onClick={() =>
                    void act(() =>
                      stateAuthorityCeiling({
                        limitId,
                        maxCommitment: ceiling,
                        currency,
                        basis,
                      }),
                    )
                  }
                >
                  State ceiling
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !limitId ||
                    selected?.maxCommitment == null ||
                    !!selected?.selfAdoptionRefusal
                  }
                  className={button}
                  onClick={() =>
                    void act(() =>
                      adoptAuthorityLimit({
                        limitId,
                        note:
                          basis.trim().length >= 10
                            ? basis
                            : "Adopted under the approved delegation instrument.",
                      }),
                    )
                  }
                >
                  Adopt
                </button>
              </div>
            </div>
          )}
          {delegations
            .filter(
              (d) => d.status === "adopted" && workspace?.delegations.canState,
            )
            .map((d) => (
              <button
                key={`redraft-${d.id}`}
                type="button"
                disabled={busy}
                className="text-xs text-signal-cyan"
                onClick={() =>
                  void act(() =>
                    draftAuthorityCeiling({
                      limitId: d.id,
                      note: "Redrafted to restate the expenditure ceiling through the governed product workflow.",
                    }),
                  )
                }
              >
                Redraft {d.roleKey} ceiling
              </button>
            ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          Approval queue
        </h3>
        {(workspace?.commitments.length ?? 0) === 0 ? (
          <p className="text-xs text-slate-500">
            No expenditure requests have been recorded.
          </p>
        ) : (
          workspace?.commitments.map((c) => (
            <article
              key={c.id}
              className="rounded-lg border border-white/6 bg-white/[0.02] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">
                    {c.title}
                  </h4>
                  <p className="mt-1 text-xs text-slate-400">{c.purpose}</p>
                </div>
                <div className="text-right">
                  <strong className="text-sm text-emerald-200">
                    {c.currency} {c.amount.toLocaleString()}
                  </strong>
                  <p className="text-[11px] text-slate-500">{c.status}</p>
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                <p>
                  <span className="text-slate-500">Evidence:</span>{" "}
                  {c.evidenceBasis}
                </p>
                <p>
                  <span className="text-slate-500">Consequence:</span>{" "}
                  {c.consequenceOfWrong}
                </p>
              </div>
              {c.authorityCeiling != null && (
                <p className="mt-2 text-xs text-emerald-200">
                  Decided under ceiling {c.authorityCurrency}{" "}
                  {c.authorityCeiling.toLocaleString()} · {c.decidedBy}
                </p>
              )}
              {c.status === "pending" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    aria-label={`Decision basis for ${c.title}`}
                    value={decisionNote[c.id] ?? ""}
                    onChange={(e) =>
                      setDecisionNote({
                        ...decisionNote,
                        [c.id]: e.target.value,
                      })
                    }
                    placeholder="Independent decision basis (20+ characters)"
                    className={`${input} min-w-[280px] flex-1`}
                  />
                  <button
                    disabled={
                      busy ||
                      c.isOwnRequest ||
                      (decisionNote[c.id] ?? "").trim().length < 20
                    }
                    className={button}
                    onClick={() =>
                      void act(() =>
                        decideExpenditureCommitment({
                          id: c.id,
                          outcome: "approved",
                          note: decisionNote[c.id] ?? "",
                        }),
                      )
                    }
                  >
                    Approve within delegation
                  </button>
                  <button
                    disabled={
                      busy ||
                      c.isOwnRequest ||
                      (decisionNote[c.id] ?? "").trim().length < 20
                    }
                    className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-200 disabled:opacity-40"
                    onClick={() =>
                      void act(() =>
                        decideExpenditureCommitment({
                          id: c.id,
                          outcome: "rejected",
                          note: decisionNote[c.id] ?? "",
                        }),
                      )
                    }
                  >
                    Reject
                  </button>
                  {c.isOwnRequest && (
                    <p className="w-full text-xs text-amber-200">
                      You requested this commitment; an independent budget
                      holder must decide it.
                    </p>
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
