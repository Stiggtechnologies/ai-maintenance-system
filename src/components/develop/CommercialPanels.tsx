/**
 * Sync Develop Slice 6B — the commercial life of a contract after signature.
 *
 *   D6.06  Commitment, ChangeOrder, Claim, Invoice, Warranty (spec I.16). The
 *          commitment half is Slice 6A's and is shown here read-only, from the
 *          ONE predicate; the other four get their acts.
 *   D6.01  the VendorQualityRecord, accrued from recorded acts. It REFUSES
 *          when no period has been measured, and this panel renders that
 *          refusal as prose — not as a zero, and not as an empty table.
 *   D6.07  the specification-to-failure commercial thread, both directions.
 *
 * A LIFECYCLE NOBODY CAN DRIVE FROM THE PRODUCT IS A SCHEMA. Every act has its
 * control here: record a change order and decide it, receive an invoice,
 * certify it, pay it once; raise a claim and answer it; record a warranty term
 * that must expire, claim under it, submit and settle; record a performance
 * period; link a specification and walk the thread.
 *
 * THE SURFACE CONVENTION, unchanged from 5A/5B/5C/5D/6A: a REFUSAL is an
 * answer and is rendered as prose, never as an error and never as a zero.
 * Nothing here computes money — every figure comes from the server predicate
 * that owns it, so this screen cannot show a number a door would refuse.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  CLAIM_DIRECTIONS,
  claimDirectionLabel,
  contractValuePosition,
  invoicePayability,
  warrantyTermStatesNoExpiry,
} from "../../lib/develop/commercial";
import {
  answerContractClaim,
  answerWarrantyClaim,
  certifyContractInvoice,
  decideContractChangeOrder,
  getContractCommercial,
  getSpecificationFailureThread,
  getVendorQualityRecord,
  linkPackageSpecification,
  listCaseRequirementRefs,
  raiseWarrantyClaim,
  recordContractChangeOrder,
  recordContractClaim,
  recordContractInvoice,
  recordContractPerformancePeriod,
  recordInvoicePayment,
  recordWarrantyTerm,
  submitWarrantyClaim,
  withdrawContractChangeOrder,
  withdrawContractClaim,
  withdrawWarrantyClaim,
  type ContractCommercial,
  type SpecificationFailureThread,
  type VendorQualityRecord,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const btnClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.015] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

/** A refusal is an answer. Rendered as prose, never as an error. */
function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p className="rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-amber-200/90">
      {text}
    </p>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-md border border-rose-400/20 bg-rose-400/[0.06] px-2 py-1.5 text-[11px] text-rose-200">
      {error}
    </p>
  );
}

function money(value: number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined) return "—";
  return `${currency ? `${currency} ` : ""}${value.toLocaleString()}`;
}

export function CommercialPanel({
  packageId,
  canPlan,
  canApprove,
  onChanged,
}: {
  packageId: number;
  /** Planning/engineering roles record; they do not decide. */
  canPlan: boolean;
  /** Management/executive roles decide — the §70 acts the server also gates. */
  canApprove: boolean;
  onChanged: () => void;
}) {
  const [payload, setPayload] = useState<ContractCommercial | null>(null);
  const [vendor, setVendor] = useState<VendorQualityRecord | null>(null);
  const [thread, setThread] = useState<SpecificationFailureThread | null>(null);
  const [requirements, setRequirements] = useState<
    { ref: string; requirement: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [coRef, setCoRef] = useState("");
  const [coDesc, setCoDesc] = useState("");
  const [coReason, setCoReason] = useState("");
  const [coDelta, setCoDelta] = useState("");
  const [coDays, setCoDays] = useState("");
  const [coDecide, setCoDecide] = useState("");
  const [coNote, setCoNote] = useState("");

  const [invRef, setInvRef] = useState("");
  const [invDate, setInvDate] = useState("");
  const [invDesc, setInvDesc] = useState("");
  const [invAmount, setInvAmount] = useState("");
  const [certifyId, setCertifyId] = useState("");
  const [certifyAmount, setCertifyAmount] = useState("");
  const [certifyNote, setCertifyNote] = useState("");
  const [payId, setPayId] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payNote, setPayNote] = useState("");

  const [clRef, setClRef] = useState("");
  const [clDirection, setClDirection] = useState<string>(CLAIM_DIRECTIONS[0]);
  const [clGrounds, setClGrounds] = useState("");
  const [clValue, setClValue] = useState("");
  const [clDays, setClDays] = useState("");
  const [clAnswerId, setClAnswerId] = useState("");
  const [clAnswer, setClAnswer] = useState<string>("accepted");
  const [clSettled, setClSettled] = useState("");
  const [clNote, setClNote] = useState("");

  const [wRef, setWRef] = useState("");
  const [wStarts, setWStarts] = useState("");
  const [wEnds, setWEnds] = useState("");
  const [wLimit, setWLimit] = useState("");
  const [wUnit, setWUnit] = useState("");
  const [wWindow, setWWindow] = useState("");
  const [wCovers, setWCovers] = useState("");
  const [wBasis, setWBasis] = useState("");
  const [wAsset, setWAsset] = useState("");
  const [wcWarranty, setWcWarranty] = useState("");
  const [wcRef, setWcRef] = useState("");
  const [wcFailure, setWcFailure] = useState("");
  const [wcValue, setWcValue] = useState("");
  const [wcUsage, setWcUsage] = useState("");
  // Required by raise_warranty_claim: a claim value with no unit is not money,
  // and the vendor record that decides the next award is where it ends up.
  const [wcCurrency, setWcCurrency] = useState("");
  const [wcClaimId, setWcClaimId] = useState("");
  const [wcNote, setWcNote] = useState("");
  const [wcRecovered, setWcRecovered] = useState("");

  const [perfFrom, setPerfFrom] = useState("");
  const [perfTo, setPerfTo] = useState("");
  const [perfPlannedH, setPerfPlannedH] = useState("");
  const [perfActualH, setPerfActualH] = useState("");
  const [perfRework, setPerfRework] = useState("");
  const [perfSafety, setPerfSafety] = useState("");
  const [perfBasis, setPerfBasis] = useState("");

  const [specRef, setSpecRef] = useState("");
  const [specBasis, setSpecBasis] = useState("");
  const [threadRef, setThreadRef] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        getContractCommercial(packageId),
        listCaseRequirementRefs(),
      ]);
      setPayload(c);
      setRequirements(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [packageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!payload) {
    return <ErrorLine error={error} />;
  }
  if (!payload.answered) {
    return (
      <div className="space-y-2">
        <ErrorLine error={error} />
        <Refusal text={payload.refusal} />
      </div>
    );
  }

  const changeOrders = payload.changeOrders ?? [];
  const invoices = payload.invoices ?? [];
  const claims = payload.claims ?? [];
  const warranties = payload.warranties ?? [];
  const currency = payload.currency ?? "";

  // A REFUSAL-ONLY cross-check. Every FIGURE on this screen is the server's —
  // there is one predicate per question and a client copy rendered beside it
  // would disagree the day either was repaired, inside one payload. What this
  // adds is the refusal the client can see for itself: a change order in
  // another currency, or one carrying NaN, makes the contract's value
  // unsummable, and saying so beats rendering the server's total as if it
  // were whole.
  const clientValue = contractValuePosition(
    payload.awardedValue ?? null,
    payload.currency ?? null,
    changeOrders.map((c) => ({
      changeOrderRef: c.changeOrderRef,
      valueDelta: c.valueDelta,
      currency: c.currency,
      status: c.status,
    })),
    payload.packageCode,
  );

  // THE ONLY THING THIS SCREEN DECIDES ABOUT COVER, AND IT COMPUTES NOTHING.
  // A term that states neither an end date nor a usage limit is the one branch
  // warranty_cover_position refuses over for EVERY date, so two null checks
  // close the control with no second expiry arithmetic anywhere near it. What
  // is rendered beside it is the SERVER's own `coverToday` sentence. Cover on
  // the failure date is a question for the door: it answers in the predicate's
  // words and the answer arrives through ErrorLine. The client copy that used
  // to gate this button had already diverged from the server on a non-finite
  // usage reading.
  const wcTerm = warranties.find((w) => String(w.warrantyId) === wcWarranty);
  const wcBlocked = wcTerm !== undefined && warrantyTermStatesNoExpiry(wcTerm);

  return (
    <div className="space-y-3">
      <ErrorLine error={error} />

      <Block title="What this contract is worth today (spec §21)">
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase text-slate-500">Awarded</div>
            {money(payload.awardedValue, currency)}
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500">
              Approved change
            </div>
            {money(
              (payload.summary as { changeOrderDelta?: number } | undefined)
                ?.changeOrderDelta,
              currency,
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500">
              Contract value
            </div>
            {money(payload.currentValue, currency)}
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500">Supplier</div>
            {payload.supplier ?? "—"}
          </div>
        </div>
        {!clientValue.answered && <Refusal text={clientValue.refusal} />}
        <p className="text-[11px] text-slate-500">
          The award is frozen once made. A contract moves after signature
          through change orders and nowhere else, and every approved one is
          checked against the same delegated ceiling the award passed.
        </p>
        <Refusal
          text={
            (payload.summary as { settlementNote?: string | null } | undefined)
              ?.settlementNote
          }
        />
      </Block>

      <Block title="Change orders">
        {changeOrders.length === 0 && (
          <p className="text-[11px] text-slate-500">
            No change order has been recorded. This contract is being performed
            exactly as it was signed.
          </p>
        )}
        {changeOrders.map((c) => (
          <div
            key={c.changeOrderId}
            className="rounded-md border border-white/8 px-2 py-1.5 text-xs text-slate-300"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-slate-100">
                {c.changeOrderRef} · {money(c.valueDelta, c.currency)}
                {c.timeDeltaDays !== 0 ? ` · ${c.timeDeltaDays} day(s)` : ""}
              </span>
              <span className="text-[10px] uppercase text-slate-500">
                {c.status}
                {c.frozen ? " · frozen" : ""}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">{c.description}</div>
            {c.status === "approved" && (
              <div className="text-[11px] text-slate-500">
                Took the contract from{" "}
                {money(c.contractValueBefore, c.currency)} to{" "}
                {money(c.contractValueAfter, c.currency)}.
              </div>
            )}
            {c.decisionNote && (
              <div className="text-[11px] text-slate-500">{c.decisionNote}</div>
            )}
          </div>
        ))}
        {canPlan && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={coRef}
              onChange={(e) => setCoRef(e.target.value)}
              placeholder="Change order ref"
              className={inputClass}
            />
            <input
              value={coDelta}
              onChange={(e) => setCoDelta(e.target.value)}
              placeholder="Value change (signed; negative releases money)"
              className={inputClass}
            />
            <input
              value={coDays}
              onChange={(e) => setCoDays(e.target.value)}
              placeholder="Time change in days (optional)"
              className={inputClass}
            />
            <input
              value={coDesc}
              onChange={(e) => setCoDesc(e.target.value)}
              placeholder="What the contractor will now do (20 characters)"
              className={inputClass}
            />
            <input
              value={coReason}
              onChange={(e) => setCoReason(e.target.value)}
              placeholder="Why it is needed (20 characters)"
              className={`${inputClass} sm:col-span-2`}
            />
            <button
              onClick={() =>
                void act(async () => {
                  await recordContractChangeOrder(packageId, {
                    change_order_ref: coRef,
                    description: coDesc,
                    reason: coReason,
                    value_delta: coDelta,
                    ...(coDays ? { time_delta_days: coDays } : {}),
                  });
                  setCoRef("");
                  setCoDelta("");
                  setCoDays("");
                  setCoDesc("");
                  setCoReason("");
                })
              }
              disabled={busy || !coRef || !coDelta || coDesc.length < 20}
              className={btnClass}
            >
              Record change order (draft)
            </button>
          </div>
        )}
        {canApprove && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={coDecide}
              onChange={(e) => setCoDecide(e.target.value)}
              className={inputClass}
            >
              <option value="">Change order to decide…</option>
              {changeOrders
                .filter((c) => c.status === "draft")
                .map((c) => (
                  <option key={c.changeOrderId} value={String(c.changeOrderId)}>
                    {c.changeOrderRef} · {money(c.valueDelta, c.currency)}
                  </option>
                ))}
            </select>
            <input
              value={coNote}
              onChange={(e) => setCoNote(e.target.value)}
              placeholder="Decision note (20 characters)"
              className={inputClass}
            />
            <div className="flex gap-2">
              <button
                onClick={() =>
                  void act(async () => {
                    await decideContractChangeOrder(
                      Number(coDecide),
                      "approved",
                      coNote,
                    );
                    setCoDecide("");
                    setCoNote("");
                  })
                }
                disabled={busy || !coDecide || coNote.length < 20}
                className={btnClass}
              >
                Approve (checks the delegation)
              </button>
              <button
                onClick={() =>
                  void act(async () => {
                    await decideContractChangeOrder(
                      Number(coDecide),
                      "rejected",
                      coNote,
                    );
                    setCoDecide("");
                    setCoNote("");
                  })
                }
                disabled={busy || !coDecide || coNote.length < 20}
                className={btnClass}
              >
                Reject
              </button>
              <button
                onClick={() =>
                  void act(async () => {
                    await withdrawContractChangeOrder(Number(coDecide), coNote);
                    setCoDecide("");
                    setCoNote("");
                  })
                }
                disabled={busy || !coDecide || coNote.length < 20}
                className={btnClass}
              >
                Withdraw
              </button>
            </div>
          </div>
        )}
      </Block>

      <Block title="Invoices — payable once">
        {invoices.length === 0 && (
          <p className="text-[11px] text-slate-500">
            No invoice has been recorded against this contract. That is not
            &ldquo;nothing outstanding&rdquo; and it is not &ldquo;paid in
            full&rdquo;.
          </p>
        )}
        {invoices.map((i) => {
          const pay = invoicePayability({
            invoiceRef: i.invoiceRef,
            status: i.status,
            grossAmount: i.grossAmount,
            certifiedAmount: i.certifiedAmount,
            currency: i.currency,
            paidAt: i.paidAt,
            paymentReference: i.paymentReference,
          });
          return (
            <div
              key={i.invoiceId}
              className="rounded-md border border-white/8 px-2 py-1.5 text-xs text-slate-300"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-slate-100">
                  {i.invoiceRef} · {money(i.grossAmount, i.currency)}
                  {i.certifiedAmount !== null
                    ? ` · certified ${money(i.certifiedAmount, i.currency)}`
                    : ""}
                </span>
                <span className="text-[10px] uppercase text-slate-500">
                  {i.status}
                  {i.frozen ? " · frozen" : ""}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">{i.description}</div>
              {!pay.payable && <Refusal text={pay.reason} />}
              {i.withheld !== null && i.withheld > 0 && (
                <div className="text-[11px] text-slate-500">
                  {money(i.withheld, i.currency)} withheld from the gross.
                </div>
              )}
            </div>
          );
        })}
        {canPlan && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={invRef}
              onChange={(e) => setInvRef(e.target.value)}
              placeholder="Supplier's invoice number"
              className={inputClass}
            />
            <input
              value={invDate}
              onChange={(e) => setInvDate(e.target.value)}
              placeholder="Invoice date (YYYY-MM-DD)"
              className={inputClass}
            />
            <input
              value={invAmount}
              onChange={(e) => setInvAmount(e.target.value)}
              placeholder="Gross amount"
              className={inputClass}
            />
            <input
              value={invDesc}
              onChange={(e) => setInvDesc(e.target.value)}
              placeholder="What is being invoiced"
              className={inputClass}
            />
            <button
              onClick={() =>
                void act(async () => {
                  await recordContractInvoice(packageId, {
                    invoice_ref: invRef,
                    invoice_date: invDate,
                    description: invDesc,
                    gross_amount: invAmount,
                  });
                  setInvRef("");
                  setInvDate("");
                  setInvAmount("");
                  setInvDesc("");
                })
              }
              disabled={busy || !invRef || !invDate || !invAmount}
              className={btnClass}
            >
              Record invoice (received)
            </button>
          </div>
        )}
        {canApprove && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={certifyId}
              onChange={(e) => setCertifyId(e.target.value)}
              className={inputClass}
            >
              <option value="">Invoice to certify…</option>
              {invoices
                .filter((i) => i.status === "received")
                .map((i) => (
                  <option key={i.invoiceId} value={String(i.invoiceId)}>
                    {i.invoiceRef} · {money(i.grossAmount, i.currency)}
                  </option>
                ))}
            </select>
            <input
              value={certifyAmount}
              onChange={(e) => setCertifyAmount(e.target.value)}
              placeholder="Amount certified (blank = in full)"
              className={inputClass}
            />
            <input
              value={certifyNote}
              onChange={(e) => setCertifyNote(e.target.value)}
              placeholder="Certification note (20 characters)"
              className={`${inputClass} sm:col-span-2`}
            />
            <div className="flex gap-2">
              <button
                onClick={() =>
                  void act(async () => {
                    await certifyContractInvoice(
                      Number(certifyId),
                      "certified",
                      certifyNote,
                      certifyAmount || undefined,
                    );
                    setCertifyId("");
                    setCertifyAmount("");
                    setCertifyNote("");
                  })
                }
                disabled={busy || !certifyId || certifyNote.length < 20}
                className={btnClass}
              >
                Certify
              </button>
              <button
                onClick={() =>
                  void act(async () => {
                    await certifyContractInvoice(
                      Number(certifyId),
                      "rejected",
                      certifyNote,
                    );
                    setCertifyId("");
                    setCertifyNote("");
                  })
                }
                disabled={busy || !certifyId || certifyNote.length < 20}
                className={btnClass}
              >
                Reject
              </button>
            </div>
            <select
              value={payId}
              onChange={(e) => setPayId(e.target.value)}
              className={inputClass}
            >
              <option value="">Certified invoice to pay…</option>
              {invoices
                .filter((i) => i.payable)
                .map((i) => (
                  <option key={i.invoiceId} value={String(i.invoiceId)}>
                    {i.invoiceRef} · {money(i.certifiedAmount, i.currency)}
                  </option>
                ))}
            </select>
            <input
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              placeholder="Bank/ledger payment reference"
              className={inputClass}
            />
            <input
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="Payment note (10 characters)"
              className={inputClass}
            />
            <button
              onClick={() =>
                void act(async () => {
                  await recordInvoicePayment(Number(payId), payRef, payNote);
                  setPayId("");
                  setPayRef("");
                  setPayNote("");
                })
              }
              disabled={
                busy || !payId || payRef.length < 3 || payNote.length < 10
              }
              className={btnClass}
            >
              Record payment (once)
            </button>
          </div>
        )}
      </Block>

      <Block title="Claims — frozen once answered">
        {claims.length === 0 && (
          <p className="text-[11px] text-slate-500">
            No claim has been made under this contract in either direction.
          </p>
        )}
        {claims.map((c) => (
          <div
            key={c.claimId}
            className="rounded-md border border-white/8 px-2 py-1.5 text-xs text-slate-300"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-slate-100">
                {c.claimRef} · {claimDirectionLabel(c.direction)} ·{" "}
                {money(c.claimedValue, c.currency)}
              </span>
              <span className="text-[10px] uppercase text-slate-500">
                {c.status}
                {c.frozen ? " · frozen" : ""}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">{c.grounds}</div>
            {c.settledValue !== null && (
              <div className="text-[11px] text-slate-500">
                Settled at {money(c.settledValue, c.currency)}.{" "}
                {c.answerNote ?? ""}
              </div>
            )}
          </div>
        ))}
        {canPlan && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={clRef}
              onChange={(e) => setClRef(e.target.value)}
              placeholder="Claim ref"
              className={inputClass}
            />
            <select
              value={clDirection}
              onChange={(e) => setClDirection(e.target.value)}
              className={inputClass}
            >
              {CLAIM_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {claimDirectionLabel(d)}
                </option>
              ))}
            </select>
            <input
              value={clValue}
              onChange={(e) => setClValue(e.target.value)}
              placeholder="Amount claimed"
              className={inputClass}
            />
            <input
              value={clDays}
              onChange={(e) => setClDays(e.target.value)}
              placeholder="Time claimed in days (optional)"
              className={inputClass}
            />
            <input
              value={clGrounds}
              onChange={(e) => setClGrounds(e.target.value)}
              placeholder="Grounds — the clause and the facts relied on (20 characters)"
              className={`${inputClass} sm:col-span-2`}
            />
            <button
              onClick={() =>
                void act(async () => {
                  await recordContractClaim(packageId, {
                    claim_ref: clRef,
                    direction: clDirection as "from_supplier",
                    grounds: clGrounds,
                    claimed_value: clValue,
                    ...(clDays ? { time_claimed_days: clDays } : {}),
                  });
                  setClRef("");
                  setClValue("");
                  setClDays("");
                  setClGrounds("");
                })
              }
              disabled={busy || !clRef || !clValue || clGrounds.length < 20}
              className={btnClass}
            >
              Record claim (open)
            </button>
          </div>
        )}
        {canApprove && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={clAnswerId}
              onChange={(e) => setClAnswerId(e.target.value)}
              className={inputClass}
            >
              <option value="">Claim to answer…</option>
              {claims
                .filter((c) => c.status === "open")
                .map((c) => (
                  <option key={c.claimId} value={String(c.claimId)}>
                    {c.claimRef} · {money(c.claimedValue, c.currency)}
                  </option>
                ))}
            </select>
            <select
              value={clAnswer}
              onChange={(e) => setClAnswer(e.target.value)}
              className={inputClass}
            >
              <option value="accepted">Accepted in full</option>
              <option value="partially_accepted">Partially accepted</option>
              <option value="rejected">Rejected</option>
            </select>
            <input
              value={clSettled}
              onChange={(e) => setClSettled(e.target.value)}
              placeholder="Settled at (partial acceptance)"
              className={inputClass}
            />
            <input
              value={clNote}
              onChange={(e) => setClNote(e.target.value)}
              placeholder="Answer (20 characters)"
              className={inputClass}
            />
            <div className="flex gap-2">
              <button
                onClick={() =>
                  void act(async () => {
                    await answerContractClaim(
                      Number(clAnswerId),
                      clAnswer as "accepted",
                      clNote,
                      clSettled || undefined,
                    );
                    setClAnswerId("");
                    setClSettled("");
                    setClNote("");
                  })
                }
                disabled={busy || !clAnswerId || clNote.length < 20}
                className={btnClass}
              >
                Answer (freezes the claim)
              </button>
              <button
                onClick={() =>
                  void act(async () => {
                    await withdrawContractClaim(Number(clAnswerId), clNote);
                    setClAnswerId("");
                    setClNote("");
                  })
                }
                disabled={busy || !clAnswerId || clNote.length < 20}
                className={btnClass}
              >
                Withdraw
              </button>
            </div>
          </div>
        )}
      </Block>

      <Block title="Warranty — it must expire, and an expired one stops covering">
        {warranties.length === 0 && (
          <Refusal text="This contract carries no warranty term. Spec §24 lists warranty_terms as a field of the Contract, and a contract with none has no recorded remedy when the equipment fails." />
        )}
        {warranties.map((w) => (
          <div
            key={w.warrantyId}
            className="rounded-md border border-white/8 px-2 py-1.5 text-xs text-slate-300"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-slate-100">
                {w.warrantyRef ?? `#${w.warrantyId}`} · {w.startsOn} →{" "}
                {w.endsOn ?? "no end date"}
                {w.usageLimit !== null
                  ? ` · ${w.usageLimit} ${w.usageUnit ?? "units"}`
                  : ""}
              </span>
              <span className="text-[10px] uppercase text-slate-500">
                {w.coverToday.answered
                  ? w.coverToday.covered
                    ? "in cover"
                    : "not in cover"
                  : "not assessable"}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">{w.covers}</div>
            {w.coverToday.answered ? (
              !w.coverToday.covered && <Refusal text={w.coverToday.reason} />
            ) : (
              <Refusal text={w.coverToday.refusal} />
            )}
            {w.claims.map((wc) => (
              <div key={wc.claimId} className="text-[11px] text-slate-500">
                {wc.claimRef} · failure {wc.failureOn} ·{" "}
                {money(wc.claimValue, wc.currency)} · {wc.status}
                {wc.recoveredValue !== null
                  ? ` · recovered ${money(wc.recoveredValue, wc.currency)}`
                  : ""}
              </div>
            ))}
          </div>
        ))}
        {canPlan && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={wRef}
              onChange={(e) => setWRef(e.target.value)}
              placeholder="Warranty ref"
              className={inputClass}
            />
            <input
              value={wAsset}
              onChange={(e) => setWAsset(e.target.value)}
              placeholder="Asset id the warranty attaches to"
              className={inputClass}
            />
            <input
              value={wStarts}
              onChange={(e) => setWStarts(e.target.value)}
              placeholder="Cover starts (YYYY-MM-DD)"
              className={inputClass}
            />
            <input
              value={wEnds}
              onChange={(e) => setWEnds(e.target.value)}
              placeholder="Cover ends (YYYY-MM-DD)"
              className={inputClass}
            />
            <input
              value={wLimit}
              onChange={(e) => setWLimit(e.target.value)}
              placeholder="Usage limit (optional)"
              className={inputClass}
            />
            <input
              value={wUnit}
              onChange={(e) => setWUnit(e.target.value)}
              placeholder="Usage unit (e.g. operating hours)"
              className={inputClass}
            />
            <input
              value={wWindow}
              onChange={(e) => setWWindow(e.target.value)}
              placeholder="Claim window in days"
              className={inputClass}
            />
            <input
              value={wBasis}
              onChange={(e) => setWBasis(e.target.value)}
              placeholder="Where the terms come from (10 characters)"
              className={inputClass}
            />
            <input
              value={wCovers}
              onChange={(e) => setWCovers(e.target.value)}
              placeholder="What it covers — the remedy, in the contract's words (20 characters)"
              className={`${inputClass} sm:col-span-2`}
            />
            <button
              onClick={() =>
                void act(async () => {
                  await recordWarrantyTerm({
                    warranty_ref: wRef,
                    covers: wCovers,
                    basis: wBasis,
                    starts_on: wStarts,
                    ...(wEnds ? { ends_on: wEnds } : {}),
                    ...(wLimit ? { usage_limit: wLimit } : {}),
                    ...(wUnit ? { usage_unit: wUnit } : {}),
                    ...(wWindow ? { claim_window_days: wWindow } : {}),
                    ...(wAsset ? { asset_id: wAsset } : {}),
                    package_id: String(packageId),
                  });
                  setWRef("");
                  setWStarts("");
                  setWEnds("");
                  setWLimit("");
                  setWUnit("");
                  setWWindow("");
                  setWCovers("");
                  setWBasis("");
                  setWAsset("");
                })
              }
              disabled={busy || !wRef || !wStarts || wCovers.length < 20}
              className={btnClass}
            >
              Record warranty term
            </button>
            <div className="sm:col-span-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                value={wcWarranty}
                onChange={(e) => setWcWarranty(e.target.value)}
                className={inputClass}
              >
                <option value="">Warranty to claim under…</option>
                {warranties.map((w) => (
                  <option key={w.warrantyId} value={String(w.warrantyId)}>
                    {w.warrantyRef ?? `#${w.warrantyId}`}
                  </option>
                ))}
              </select>
              <input
                value={wcRef}
                onChange={(e) => setWcRef(e.target.value)}
                placeholder="Warranty claim ref"
                className={inputClass}
              />
              <input
                value={wcFailure}
                onChange={(e) => setWcFailure(e.target.value)}
                placeholder="Failure date (YYYY-MM-DD) — cover is tested here"
                className={inputClass}
              />
              <input
                value={wcValue}
                onChange={(e) => setWcValue(e.target.value)}
                placeholder="Amount claimed"
                className={inputClass}
              />
              <input
                value={wcUsage}
                onChange={(e) => setWcUsage(e.target.value)}
                placeholder="Usage at failure (optional)"
                className={inputClass}
              />
              <input
                value={wcCurrency}
                onChange={(e) => setWcCurrency(e.target.value.toUpperCase())}
                placeholder="Currency (e.g. CAD)"
                maxLength={3}
                className={inputClass}
              />
              {wcTerm !== undefined && (
                <div className="sm:col-span-2">
                  {wcTerm.coverToday.answered ? (
                    !wcTerm.coverToday.covered && (
                      <Refusal text={wcTerm.coverToday.reason} />
                    )
                  ) : (
                    <Refusal text={wcTerm.coverToday.refusal} />
                  )}
                </div>
              )}
              <button
                onClick={() =>
                  void act(async () => {
                    await raiseWarrantyClaim(Number(wcWarranty), {
                      claim_ref: wcRef,
                      failure_on: wcFailure,
                      claim_value: wcValue,
                      currency: wcCurrency,
                      ...(wcUsage ? { usage_at_failure: wcUsage } : {}),
                    });
                    setWcRef("");
                    setWcFailure("");
                    setWcValue("");
                    setWcUsage("");
                  })
                }
                disabled={
                  busy ||
                  !wcWarranty ||
                  !wcRef ||
                  !wcFailure ||
                  !wcValue ||
                  !wcCurrency ||
                  wcBlocked
                }
                className={btnClass}
              >
                Raise warranty claim
              </button>
            </div>
          </div>
        )}
        {(canPlan || canApprove) && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={wcClaimId}
              onChange={(e) => setWcClaimId(e.target.value)}
              className={inputClass}
            >
              <option value="">Warranty claim…</option>
              {warranties.flatMap((w) =>
                w.claims
                  .filter(
                    (c) => c.status === "raised" || c.status === "submitted",
                  )
                  .map((c) => (
                    <option key={c.claimId} value={String(c.claimId)}>
                      {c.claimRef ?? `#${c.claimId}`} · {c.status}
                    </option>
                  )),
              )}
            </select>
            <input
              value={wcNote}
              onChange={(e) => setWcNote(e.target.value)}
              placeholder="Note (20 characters for a settlement)"
              className={inputClass}
            />
            <input
              value={wcRecovered}
              onChange={(e) => setWcRecovered(e.target.value)}
              placeholder="Recovered amount (acceptance)"
              className={inputClass}
            />
            <div className="flex flex-wrap gap-2">
              {canPlan && (
                <button
                  onClick={() =>
                    void act(async () => {
                      await submitWarrantyClaim(Number(wcClaimId), wcNote);
                      setWcClaimId("");
                      setWcNote("");
                    })
                  }
                  disabled={busy || !wcClaimId || wcNote.length < 10}
                  className={btnClass}
                >
                  Submit to supplier
                </button>
              )}
              {canApprove && (
                <>
                  <button
                    onClick={() =>
                      void act(async () => {
                        await answerWarrantyClaim(
                          Number(wcClaimId),
                          "accepted",
                          wcNote,
                          wcRecovered || undefined,
                        );
                        setWcClaimId("");
                        setWcNote("");
                        setWcRecovered("");
                      })
                    }
                    disabled={busy || !wcClaimId || wcNote.length < 20}
                    className={btnClass}
                  >
                    Accept settlement
                  </button>
                  <button
                    onClick={() =>
                      void act(async () => {
                        await answerWarrantyClaim(
                          Number(wcClaimId),
                          "rejected",
                          wcNote,
                        );
                        setWcClaimId("");
                        setWcNote("");
                      })
                    }
                    disabled={busy || !wcClaimId || wcNote.length < 20}
                    className={btnClass}
                  >
                    Record refusal
                  </button>
                </>
              )}
              {canPlan && (
                <button
                  onClick={() =>
                    void act(async () => {
                      await withdrawWarrantyClaim(Number(wcClaimId), wcNote);
                      setWcClaimId("");
                      setWcNote("");
                    })
                  }
                  disabled={busy || !wcClaimId || wcNote.length < 20}
                  className={btnClass}
                >
                  Withdraw
                </button>
              )}
            </div>
          </div>
        )}
      </Block>

      <Block title="Vendor quality record — accrued, never typed (spec I.13)">
        {canPlan && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={perfFrom}
              onChange={(e) => setPerfFrom(e.target.value)}
              placeholder="Period start (YYYY-MM-DD)"
              className={inputClass}
            />
            <input
              value={perfTo}
              onChange={(e) => setPerfTo(e.target.value)}
              placeholder="Period end (must have finished)"
              className={inputClass}
            />
            <input
              value={perfPlannedH}
              onChange={(e) => setPerfPlannedH(e.target.value)}
              placeholder="Planned hours"
              className={inputClass}
            />
            <input
              value={perfActualH}
              onChange={(e) => setPerfActualH(e.target.value)}
              placeholder="Actual hours"
              className={inputClass}
            />
            <input
              value={perfRework}
              onChange={(e) => setPerfRework(e.target.value)}
              placeholder="Rework events"
              className={inputClass}
            />
            <input
              value={perfSafety}
              onChange={(e) => setPerfSafety(e.target.value)}
              placeholder="Safety incidents"
              className={inputClass}
            />
            <input
              value={perfBasis}
              onChange={(e) => setPerfBasis(e.target.value)}
              placeholder="Where these figures come from (10 characters)"
              className={`${inputClass} sm:col-span-2`}
            />
            <button
              onClick={() =>
                void act(async () => {
                  await recordContractPerformancePeriod(packageId, {
                    period_start: perfFrom,
                    period_end: perfTo,
                    basis: perfBasis,
                    ...(perfPlannedH ? { planned_hours: perfPlannedH } : {}),
                    ...(perfActualH ? { actual_hours: perfActualH } : {}),
                    ...(perfRework ? { rework_events: perfRework } : {}),
                    ...(perfSafety ? { safety_incidents: perfSafety } : {}),
                  });
                  setPerfFrom("");
                  setPerfTo("");
                  setPerfPlannedH("");
                  setPerfActualH("");
                  setPerfRework("");
                  setPerfSafety("");
                  setPerfBasis("");
                })
              }
              disabled={busy || !perfFrom || !perfTo || perfBasis.length < 10}
              className={btnClass}
            >
              Record performance period
            </button>
          </div>
        )}
        <button
          onClick={() =>
            void (async () => {
              if (!payload.supplierId) return;
              setBusy(true);
              try {
                setVendor(await getVendorQualityRecord(payload.supplierId));
                setError(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })()
          }
          disabled={busy || !payload.supplierId}
          className={btnClass}
        >
          Read this vendor&rsquo;s quality record
        </button>
        {vendor && !vendor.answered && <Refusal text={vendor.refusal} />}
        {vendor?.answered && (
          <div className="space-y-1 text-xs text-slate-300">
            <div>
              {vendor.periods} measured period(s), {vendor.firstPeriod} to{" "}
              {vendor.lastPeriod}, across {vendor.awardedContracts} awarded
              contract(s).
            </div>
            {vendor.productivityFactor !== null &&
            vendor.productivityFactor !== undefined ? (
              <div>
                Productivity factor {vendor.productivityFactor} (planned ÷
                actual).
              </div>
            ) : (
              <Refusal text={vendor.productivityNote} />
            )}
            <div>
              {vendor.reworkEvents} rework event(s), {vendor.safetyIncidents}{" "}
              safety incident(s), {vendor.qualityEscapes} quality escape(s).
            </div>
            <Refusal text={vendor.reworkRateNote} />

            {/* THE HALVES THIS PANEL USED TO DROP. Each is returned by the RPC
                with its own refusal, and a record whose distinctive sentences
                are in the payload and on no screen is not reachable from the
                product. Every figure below is the server's. */}
            {vendor.cost && (
              <div>
                {vendor.cost.answered ? (
                  <span>
                    Cost: planned{" "}
                    {money(
                      vendor.cost.plannedCost,
                      vendor.cost.currency ?? null,
                    )}
                    , actual{" "}
                    {money(
                      vendor.cost.actualCost,
                      vendor.cost.currency ?? null,
                    )}
                    {vendor.cost.costPerformanceFactor !== null &&
                    vendor.cost.costPerformanceFactor !== undefined
                      ? ` · cost performance factor ${vendor.cost.costPerformanceFactor}`
                      : ""}
                    .
                  </span>
                ) : (
                  <Refusal text={vendor.cost.refusal} />
                )}
                {vendor.cost.answered && (
                  <Refusal text={vendor.cost.costFactorNote} />
                )}
              </div>
            )}
            {vendor.deliveries && (
              <div>
                <span>
                  {vendor.deliveries.recorded} delivery event(s),{" "}
                  {vendor.deliveries.rejectedOnReceipt} rejected on receipt
                  {vendor.deliveries.onTimeRate !== null
                    ? ` · ${Math.round(vendor.deliveries.onTimeRate * 100)}% on time over ${vendor.deliveries.assessable} dated delivery(ies)`
                    : ""}
                  .
                </span>
                <Refusal text={vendor.deliveries.refusal} />
              </div>
            )}
            {vendor.warranty && (
              <div>
                <span>
                  {vendor.warranty.terms} warranty term(s),{" "}
                  {vendor.warranty.claims} claim(s) of which{" "}
                  {vendor.warranty.accepted} accepted and{" "}
                  {vendor.warranty.timeBarred} time-barred
                  {vendor.warranty.recoveredValue !== null &&
                  vendor.warranty.recoveredValue !== undefined
                    ? ` · ${money(vendor.warranty.recoveredValue, vendor.warranty.currency)} recovered`
                    : ""}
                  .
                </span>
                <Refusal text={vendor.warranty.refusal} />
                <Refusal text={vendor.warranty.timeBarredNote} />
              </div>
            )}
            {vendor.contractClaims && (
              <div>
                {vendor.contractClaims.refusal ? (
                  <Refusal text={vendor.contractClaims.refusal} />
                ) : (
                  <span>
                    {vendor.contractClaims.raised} contract claim(s):{" "}
                    {money(
                      vendor.contractClaims.settledFromSupplier,
                      vendor.contractClaims.currency ?? null,
                    )}{" "}
                    settled FROM the supplier,{" "}
                    {money(
                      vendor.contractClaims.settledAgainstSupplier,
                      vendor.contractClaims.currency ?? null,
                    )}{" "}
                    AGAINST — net{" "}
                    {money(
                      vendor.contractClaims.settledNet,
                      vendor.contractClaims.currency ?? null,
                    )}
                    . The two sit on opposite sides of the contract and are
                    never added.
                  </span>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-500">{vendor.basis}</p>
          </div>
        )}
      </Block>

      <Block title="Specification → failure history (spec I.16)">
        {canPlan && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={specRef}
              onChange={(e) => setSpecRef(e.target.value)}
              className={inputClass}
            >
              <option value="">
                Requirement this package was tendered against…
              </option>
              {requirements.map((r) => (
                <option key={r.ref} value={r.ref}>
                  {r.ref} · {r.requirement.slice(0, 60)}
                </option>
              ))}
            </select>
            <input
              value={specBasis}
              onChange={(e) => setSpecBasis(e.target.value)}
              placeholder="How the requirement reaches this package (20 characters)"
              className={inputClass}
            />
            <button
              onClick={() =>
                void act(async () => {
                  await linkPackageSpecification(packageId, specRef, specBasis);
                  setSpecRef("");
                  setSpecBasis("");
                })
              }
              disabled={busy || !specRef || specBasis.length < 20}
              className={btnClass}
            >
              Link the specification
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            value={threadRef}
            onChange={(e) => setThreadRef(e.target.value)}
            className={inputClass}
          >
            <option value="">Walk the thread from…</option>
            {requirements.map((r) => (
              <option key={r.ref} value={r.ref}>
                {r.ref}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  setThread(await getSpecificationFailureThread(threadRef));
                  setError(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              })()
            }
            disabled={busy || !threadRef}
            className={btnClass}
          >
            Walk it to the failures
          </button>
        </div>
        {thread && !thread.answered && <Refusal text={thread.refusal} />}
        {thread?.answered && (
          <div className="space-y-1 text-xs text-slate-300">
            <div>
              {thread.requirementRef} → {thread.packageCount} package(s),{" "}
              {thread.awardedPackages} awarded → {thread.vendors?.length ?? 0}{" "}
              vendor(s) → {thread.materials} material(s) →{" "}
              {thread.installedAssets} installed asset(s) →{" "}
              {thread.failureTotal} corrective work order(s).
            </div>
            {(thread.failures ?? []).slice(0, 5).map((f) => (
              <div key={f.failureMode} className="text-[11px] text-slate-400">
                {f.failureMode}: {f.occurrences} on {f.assetsAffected} asset(s)
              </div>
            ))}
            <Refusal text={thread.failureNote} />
            <Refusal text={thread.backwardNote} />
            <p className="text-[11px] text-slate-500">{thread.basis}</p>
          </div>
        )}
      </Block>
    </div>
  );
}
