/**
 * Sync Develop Slice 6A — procurement, the sealed-bid tender and the contract.
 *
 *   D6.03/D6.09  the ProcurementPackage with its four §25 status dimensions,
 *                its lateness arithmetic and the gate blockers it raises. Every
 *                dimension is shown, always — a dimension quietly omitted reads
 *                as a dimension that is fine.
 *   D6.04        the tender: the bidder register, sealed bids, THE OPEN ACT,
 *                and the two evaluations. While the envelope is sealed this
 *                panel shows that a bid was lodged and nothing about what it
 *                said, because the server returns nothing else.
 *   D6.05/D6.08  the §24 Contract, awarded through an adopted delegation, and
 *                its commitments posted into Slice 4's ONE cost model.
 *
 * AN AWARD NOBODY CAN MAKE FROM THE PRODUCT IS A CEREMONIAL ROW. Every act in
 * this slice has its control here: record a package, move a dimension, invite a
 * bidder, issue the tender, lodge a bid, open the envelopes, evaluate, award,
 * commit, approve.
 *
 * THE SURFACE CONVENTION, unchanged from 5A/5B/5C/5D: a REFUSAL is an answer
 * and is rendered as prose, never as an error and never as a zero.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Package } from "lucide-react";

import { CommercialPanel } from "./CommercialPanels";

import {
  BID_EVALUATION_KINDS,
  BID_EVALUATION_OUTCOMES,
  CONTRACT_TYPES,
  PROCUREMENT_STATUS_DIMENSIONS,
  PROCUREMENT_STATUS_VALUES,
  awardReadiness,
  commitmentTotal,
  contractTypeLabel,
  sealedBidDisclosure,
  statusHeadline,
  statusLabel,
  unknownStatusValues,
} from "../../lib/develop/procurement";
import {
  approveContractCommitments,
  awardContract,
  computeCaseProcurementPosition,
  getCaseProcurement,
  getPackageTender,
  invitePackageBidder,
  listCaseCostItemRefs,
  listOrgSuppliers,
  openPackageBidding,
  openPackageBids,
  recordBidEvaluation,
  recordContractCommitmentLine,
  recordPackageDeliveryForecast,
  recordPackageDeliveryReceipt,
  recordProcurementPackage,
  setProcurementPackageStatus,
  submitSealedBid,
  withdrawSealedBid,
  type CaseProcurement,
  type PackageTender,
  type ProcurementPackageRow,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const btnClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

function money(value: number | null | undefined, currency?: string | null) {
  // An absent figure is stated as absent. `?? 0` here is how a sealed bid or
  // an unpriced commitment becomes a zero-dollar fact on screen.
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "not recorded";
  }
  return `${currency ? `${currency} ` : ""}${value.toLocaleString()}`;
}

/* ───────────────── D6.03/D6.09 — the package and its four dimensions ─────── */

function StatusDimensions({
  pkg,
  canPlan,
  onChanged,
}: {
  pkg: ProcurementPackageRow;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [dimension, setDimension] = useState<string>("technical");
  const [status, setStatus] = useState<string>("");
  const [basis, setBasis] = useState("");
  const [forecast, setForecast] = useState("");
  const [forecastBasis, setForecastBasis] = useState("");
  const [received, setReceived] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unknown = unknownStatusValues(pkg.status);

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      await setProcurementPackageStatus(
        pkg.packageId,
        dimension,
        status,
        basis,
      );
      setBasis("");
      setStatus("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* ALL FOUR, ALWAYS. §25 names four dimensions and a package shown with
          three reads as complete on the one nobody tracked. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PROCUREMENT_STATUS_DIMENSIONS.map((d) => (
          <div
            key={d}
            className="rounded border border-white/8 bg-white/[0.02] px-2 py-1.5"
          >
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              {d}
            </div>
            <div className="text-xs text-slate-200">
              {statusLabel(pkg.status[d])}
            </div>
          </div>
        ))}
      </div>
      {unknown.length > 0 && (
        <Refusal
          text={`This package carries a status value the server's §25 vocabulary does not know (${unknown.join(
            "; ",
          )}). It is shown as recorded rather than mapped onto a neighbouring value — a silent guess inside a governance model is worse than an unknown.`}
        />
      )}
      {canPlan && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <select
            aria-label="Status dimension"
            value={dimension}
            onChange={(e) => {
              setDimension(e.target.value);
              setStatus("");
            }}
            className={inputClass}
          >
            {PROCUREMENT_STATUS_DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            aria-label="New status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputClass}
          >
            <option value="">Move to…</option>
            {PROCUREMENT_STATUS_VALUES[
              dimension as keyof typeof PROCUREMENT_STATUS_VALUES
            ].map((v) => (
              <option key={v} value={v}>
                {statusLabel(v)}
              </option>
            ))}
          </select>
          <input
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="What moved it (10 characters minimum)"
            className={`${inputClass} sm:col-span-2`}
          />
          <button
            onClick={() => void move()}
            disabled={busy || !status || basis.trim().length < 10}
            className={btnClass}
          >
            {busy ? "Recording…" : "Move dimension"}
          </button>
        </div>
      )}
      {canPlan && (
        // The delivery forecast: the one §25 field that may move on an AWARDED
        // package, and the fact the mandatory long-lead slippage blocker
        // measures. Without this control the blocker is unreachable from the
        // product after award — which is exactly when it matters.
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="date"
            aria-label="Forecast delivery date"
            value={forecast}
            onChange={(e) => setForecast(e.target.value)}
            className={inputClass}
          />
          <input
            value={forecastBasis}
            onChange={(e) => setForecastBasis(e.target.value)}
            placeholder="Where the forecast comes from (10 characters minimum)"
            className={inputClass}
          />
          <button
            onClick={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await recordPackageDeliveryForecast(
                    pkg.packageId,
                    forecast,
                    forecastBasis,
                  );
                  setForecast("");
                  setForecastBasis("");
                  onChanged();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              })()
            }
            disabled={busy || !forecast || forecastBasis.trim().length < 10}
            className={btnClass}
          >
            Record delivery forecast
          </button>
        </div>
      )}
      {canPlan && !pkg.actualDeliveryDate && (
        // THE DATED RECEIPT. `set_procurement_package_status` refuses
        // `delivery = received_and_inspected` BY NAME, because a status one
        // planner can type with a ten-character basis is not evidence that
        // anything arrived — it used to discharge the mandatory long-lead
        // slippage blocker while the recorded dates still said the equipment
        // was 45 days late. Without this control the discharge would be
        // unreachable from the product.
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="date"
            aria-label="Date received and inspected"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            className={inputClass}
          />
          <input
            value={receiptNote}
            onChange={(e) => setReceiptNote(e.target.value)}
            placeholder="What arrived, who inspected it, against what (20 characters minimum)"
            className={inputClass}
          />
          <button
            onClick={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await recordPackageDeliveryReceipt(
                    pkg.packageId,
                    received,
                    receiptNote,
                  );
                  setReceived("");
                  setReceiptNote("");
                  onChanged();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              })()
            }
            disabled={busy || !received || receiptNote.trim().length < 20}
            className={btnClass}
          >
            Record delivery receipt
          </button>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/* ─────────────────────── D6.04 — the sealed-bid tender ──────────────────── */

function TenderPanel({
  pkg,
  canPlan,
  canAward,
  costItems,
  currentUserEmail,
  onChanged,
}: {
  pkg: ProcurementPackageRow;
  canPlan: boolean;
  canAward: boolean;
  costItems: { ref: string; description: string; currency: string }[];
  /**
   * The signed-in person, so the separation-of-duties blocker can actually
   * fire on this screen. Null when the viewer is unknown, and the blocker then
   * stays off rather than guessing.
   */
  currentUserEmail: string | null;
  onChanged: () => void;
}) {
  const [tender, setTender] = useState<PackageTender | null>(null);
  const [suppliers, setSuppliers] = useState<
    { id: number; name: string; supplierCode: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  const [prequal, setPrequal] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [bidSupplier, setBidSupplier] = useState("");
  const [bidPrice, setBidPrice] = useState("");
  const [bidCurrency, setBidCurrency] = useState("CAD");
  const [bidHours, setBidHours] = useState("");
  const [bidFactor, setBidFactor] = useState("");
  const [openNote, setOpenNote] = useState("");
  const [withdrawBid, setWithdrawBid] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [evalBid, setEvalBid] = useState("");
  const [evalKind, setEvalKind] = useState<string>(BID_EVALUATION_KINDS[0]);
  const [evalOutcome, setEvalOutcome] = useState<string>(
    BID_EVALUATION_OUTCOMES[0],
  );
  const [evalRationale, setEvalRationale] = useState("");
  const [awardBid, setAwardBid] = useState("");
  const [awardType, setAwardType] = useState<string>(CONTRACT_TYPES[0]);
  const [awardPerf, setAwardPerf] = useState("");
  const [awardBasis, setAwardBasis] = useState("");
  const [awardStart, setAwardStart] = useState("");
  const [awardFinish, setAwardFinish] = useState("");
  const [lineRef, setLineRef] = useState("");
  const [lineCost, setLineCost] = useState("");
  const [lineDesc, setLineDesc] = useState("");
  const [lineBasis, setLineBasis] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [approveNote, setApproveNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        getPackageTender(pkg.packageId),
        listOrgSuppliers(),
      ]);
      setTender(t);
      setSuppliers(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [pkg.packageId]);

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

  if (!tender) {
    return <ErrorLine error={error} />;
  }

  const liveBids = tender.bids.filter((b) => !b.withdrawn);
  const winner = tender.bids.find((b) => String(b.bidId) === awardBid);
  const readiness = awardReadiness({
    packageCode: tender.packageCode,
    bidsOpened: tender.bidsOpenedAt !== null,
    liveBidCount: liveBids.length,
    withdrawnBidCount: tender.bids.length - liveBids.length,
    evaluationsOnWinner: (winner?.evaluations ?? []).map((e) => e.kind),
    outcomesOnWinner: (winner?.evaluations ?? []).map((e) => e.outcome),
    // COMPUTED, NOT HARD-CODED OFF. This was `false` unconditionally, so the
    // one blocker that matters to the person about to press Award never fired
    // — and `awardReadiness` exists precisely "so the screen does not offer a
    // button the server will refuse". The evaluator's identity is in the
    // payload; the viewer's own is threaded in from the workspace.
    awarderEvaluated:
      currentUserEmail !== null &&
      tender.bids.some((b) =>
        b.evaluations.some((e) => e.evaluator === currentUserEmail),
      ),
  });

  return (
    <div className="space-y-3 rounded-lg border border-white/8 bg-white/[0.015] p-3">
      <ErrorLine error={error} />

      {/* The bidder register (I.16 Bidder). */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Bidder register
        </div>
        {tender.bidders.length === 0 ? (
          <Refusal text="No bidder has been invited to this package. That is not a competitive tender with zero responses — nobody has been asked." />
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-slate-300">
            {tender.bidders.map((b) => (
              <li key={b.bidderId}>
                {b.supplier} ({b.supplierCode}) — {b.status}
                {!b.prequalificationStated && (
                  <span className="text-amber-300">
                    {" "}
                    · no prequalification basis recorded
                  </span>
                )}
                {b.safetyQualificationStatus !== "qualified" && (
                  <span className="text-amber-300">
                    {" "}
                    · safety qualification {b.safetyQualificationStatus}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canPlan && tender.bidsOpenedAt === null && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              aria-label="Supplier to invite"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={inputClass}
            >
              <option value="">Invite a bidder…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              value={prequal}
              onChange={(e) => setPrequal(e.target.value)}
              placeholder="Prequalification basis (why this bidder can do the work)"
              className={inputClass}
            />
            <button
              onClick={() =>
                void act(() =>
                  invitePackageBidder(
                    pkg.packageId,
                    Number(supplierId),
                    prequal.trim() || undefined,
                  ),
                )
              }
              disabled={busy || !supplierId}
              className={btnClass}
            >
              Invite bidder
            </button>
          </div>
        )}
      </div>

      {/* Issue the tender. */}
      {canPlan && tender.bidsCloseAt === null && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="datetime-local"
            aria-label="Tender close"
            value={closeAt}
            onChange={(e) => setCloseAt(e.target.value)}
            className={inputClass}
          />
          <button
            onClick={() =>
              void act(() =>
                openPackageBidding(
                  pkg.packageId,
                  new Date(closeAt).toISOString(),
                ),
              )
            }
            disabled={busy || !closeAt}
            className={btnClass}
          >
            Issue tender
          </button>
        </div>
      )}

      {/* The bids. Sealed until the open act. */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {/* A package NOBODY TENDERED is not "sealed". `bidsOpenedAt is null`
              is also true of one that was never issued, so a package that had
              never been to market rendered as "Bids (SEALED)" under a note
              asserting that the envelopes were sealed. */}
          Bids{" "}
          {!tender.tendered
            ? "(not tendered)"
            : tender.sealed
              ? "(SEALED)"
              : "(opened)"}
        </div>
        <Refusal text={tender.sealNote} />
        {tender.bids.length === 0 ? (
          // The server distinguishes the three things an empty list used to
          // mean — not tendered, tendered and unanswered, opened and empty.
          <Refusal text={tender.bidsRefusal} />
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-slate-300">
            {tender.bids.map((b) => (
              <li key={b.bidId}>
                {sealedBidDisclosure({
                  bidRef: b.bidRef,
                  supplier: b.supplier,
                  sealed: b.sealed,
                  price: b.price,
                  currency: b.currency,
                  withdrawn: b.withdrawn,
                })}
                {b.evaluations.length > 0 && (
                  <span className="text-slate-400">
                    {" "}
                    ·{" "}
                    {b.evaluations
                      .map((e) => `${e.kind}: ${e.outcome}`)
                      .join(", ")}
                  </span>
                )}
                {!b.sealed &&
                  !b.withdrawn &&
                  b.assumedProductivityFactor === null && (
                    <span className="text-amber-300">
                      {" "}
                      · no productivity assumption stated, so this bid is not
                      comparable on price
                    </span>
                  )}
              </li>
            ))}
          </ul>
        )}
        {canPlan && tender.bidsCloseAt !== null && tender.sealed && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-5">
            <select
              aria-label="Bidder"
              value={bidSupplier}
              onChange={(e) => setBidSupplier(e.target.value)}
              className={inputClass}
            >
              <option value="">Bidder…</option>
              {tender.bidders.map((b) => (
                <option key={b.bidderId} value={b.supplierCode}>
                  {b.supplier}
                </option>
              ))}
            </select>
            <input
              value={bidPrice}
              onChange={(e) => setBidPrice(e.target.value)}
              placeholder="Price"
              className={inputClass}
            />
            <input
              value={bidCurrency}
              onChange={(e) => setBidCurrency(e.target.value.toUpperCase())}
              placeholder="CAD"
              className={inputClass}
            />
            <input
              value={bidHours}
              onChange={(e) => setBidHours(e.target.value)}
              placeholder="Labour hours"
              className={inputClass}
            />
            <input
              value={bidFactor}
              onChange={(e) => setBidFactor(e.target.value)}
              placeholder="Productivity factor"
              className={inputClass}
            />
            <button
              onClick={() =>
                void act(() =>
                  submitSealedBid(pkg.packageId, {
                    supplier_code: bidSupplier,
                    price: bidPrice,
                    currency: bidCurrency,
                    labour_hours: bidHours || undefined,
                    assumed_productivity_factor: bidFactor || undefined,
                  }),
                )
              }
              disabled={busy || !bidSupplier || !bidPrice}
              className={btnClass}
            >
              Lodge sealed bid
            </button>
          </div>
        )}
      </div>

      {/* Withdrawal — the ONE permitted change to a sealed bid after
          submission, and only before the envelopes are opened. The row and its
          price survive: a bid that was received and a bid that never arrived
          must not look the same. */}
      {canPlan && tender.sealed && liveBids.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            aria-label="Bid to withdraw"
            value={withdrawBid}
            onChange={(e) => setWithdrawBid(e.target.value)}
            className={inputClass}
          >
            <option value="">Withdraw a bid…</option>
            {liveBids.map((b) => (
              <option key={b.bidId} value={String(b.bidId)}>
                {b.supplier}
              </option>
            ))}
          </select>
          <input
            value={withdrawReason}
            onChange={(e) => setWithdrawReason(e.target.value)}
            placeholder="Why it is withdrawn (10 characters minimum) — a withdrawal is final for this bidder"
            className={inputClass}
          />
          <button
            onClick={() =>
              void act(() =>
                withdrawSealedBid(Number(withdrawBid), withdrawReason),
              )
            }
            disabled={busy || !withdrawBid || withdrawReason.trim().length < 10}
            className={btnClass}
          >
            Withdraw bid
          </button>
        </div>
      )}

      {/* THE OPEN ACT (§70). */}
      {canPlan && tender.sealed && tender.bidsCloseAt !== null && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            value={openNote}
            onChange={(e) => setOpenNote(e.target.value)}
            placeholder="Who was present, and what was in the envelopes (20 characters minimum)"
            className={`${inputClass} sm:col-span-2`}
          />
          <button
            onClick={() =>
              void act(() => openPackageBids(pkg.packageId, openNote))
            }
            disabled={busy || openNote.trim().length < 20}
            className={btnClass}
          >
            Open the bids
          </button>
        </div>
      )}

      {/* The two evaluations (I.16). */}
      {canPlan && !tender.sealed && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <select
            aria-label="Bid to evaluate"
            value={evalBid}
            onChange={(e) => setEvalBid(e.target.value)}
            className={inputClass}
          >
            <option value="">Bid…</option>
            {liveBids.map((b) => (
              <option key={b.bidId} value={String(b.bidId)}>
                {b.supplier}
              </option>
            ))}
          </select>
          <select
            aria-label="Evaluation kind"
            value={evalKind}
            onChange={(e) => setEvalKind(e.target.value)}
            className={inputClass}
          >
            {BID_EVALUATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select
            aria-label="Evaluation outcome"
            value={evalOutcome}
            onChange={(e) => setEvalOutcome(e.target.value)}
            className={inputClass}
          >
            {BID_EVALUATION_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {statusLabel(o)}
              </option>
            ))}
          </select>
          <input
            value={evalRationale}
            onChange={(e) => setEvalRationale(e.target.value)}
            placeholder="Reasoning (20 characters minimum) — an evaluation is frozen once recorded"
            className={inputClass}
          />
          <button
            onClick={() =>
              void act(() =>
                recordBidEvaluation(Number(evalBid), {
                  evaluation_kind: evalKind,
                  outcome: evalOutcome,
                  rationale: evalRationale,
                }),
              )
            }
            disabled={busy || !evalBid || evalRationale.trim().length < 20}
            className={btnClass}
          >
            Record evaluation
          </button>
        </div>
      )}

      {/* The §24 award, routed through the adopted delegation. */}
      {!tender.contract && canAward && !tender.sealed && (
        <div className="space-y-2 rounded border border-emerald-400/20 bg-emerald-400/5 p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200">
            Award (spec §24) — checked against your adopted contract-award
            delegation
          </div>
          {readiness.blockers.map((b) => (
            <Refusal key={b} text={b} />
          ))}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              aria-label="Winning bid"
              value={awardBid}
              onChange={(e) => setAwardBid(e.target.value)}
              className={inputClass}
            >
              <option value="">Winning bid…</option>
              {liveBids.map((b) => (
                <option key={b.bidId} value={String(b.bidId)}>
                  {b.supplier} — {money(b.price, b.currency)}
                </option>
              ))}
            </select>
            <select
              aria-label="Contract type"
              value={awardType}
              onChange={(e) => setAwardType(e.target.value)}
              className={inputClass}
            >
              {CONTRACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {contractTypeLabel(t)}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Contract start"
              value={awardStart}
              onChange={(e) => setAwardStart(e.target.value)}
              className={inputClass}
            />
            <input
              type="date"
              aria-label="Contract completion"
              value={awardFinish}
              onChange={(e) => setAwardFinish(e.target.value)}
              className={inputClass}
            />
            <input
              value={awardPerf}
              onChange={(e) => setAwardPerf(e.target.value)}
              placeholder="Performance requirements (20 characters minimum)"
              className={inputClass}
            />
            <input
              value={awardBasis}
              onChange={(e) => setAwardBasis(e.target.value)}
              placeholder="Why this bid is the award (20 characters minimum)"
              className={inputClass}
            />
          </div>
          <button
            onClick={() =>
              void act(() =>
                awardContract(pkg.packageId, {
                  bid_id: awardBid,
                  contract_type: awardType,
                  performance_requirements: awardPerf,
                  award_basis: awardBasis,
                  contract_start_date: awardStart,
                  contract_completion_date: awardFinish,
                }),
              )
            }
            disabled={
              busy ||
              !awardBid ||
              !awardStart ||
              !awardFinish ||
              awardPerf.trim().length < 20 ||
              awardBasis.trim().length < 20
            }
            className={btnClass}
          >
            {busy ? "Checking authority…" : "Award this contract"}
          </button>
        </div>
      )}

      {/* The contract, once awarded, and its commitments into the ONE cost
          model. */}
      {tender.contract && (
        <div className="space-y-2 rounded border border-white/10 bg-white/[0.02] p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Contract (spec §24)
          </div>
          <div className="text-xs text-slate-300">
            {contractTypeLabel(tender.contract.contractType)} to{" "}
            {tender.contract.supplier ?? "an unnamed supplier"} —{" "}
            {money(tender.contract.value, tender.contract.currency)},{" "}
            {tender.contract.start ?? "no start"} →{" "}
            {tender.contract.completion ?? "no completion"}. Awarded by{" "}
            {tender.contract.awardedBy ?? "somebody"} under{" "}
            {tender.contract.authorityTier ?? "an unnamed tier"} (ceiling{" "}
            {money(tender.contract.authorityCeiling)}).
          </div>
          {!tender.contract.warrantyTermId && (
            <Refusal text="This contract references no warranty term. §24 lists warranty_terms as a field of the Contract, and a contract with none has no recorded remedy when the equipment fails inside its warranty." />
          )}
          {/* THE POSITION, RENDERED FROM THE LINES THE SERVER SUMMED.
              `contract_commitment_position` is the predicate
              `approve_contract_commitments` refuses on; `commitmentTotal`
              restates the same four refusal conditions — empty set, any
              unpriced line, a mixed-currency sum, a non-finite or negative
              amount — over exactly the rows the server returned, so the number
              on screen is derived, never trusted. The SERVER's refusal is shown
              underneath whenever the two are not both answers. */}
          {(() => {
            // THE NUMBER ON SCREEN IS THE NUMBER THE SERVER POSTED. This used
            // to render a JS `reduce` over float-parsed amounts and never show
            // `tender.commitment.total` at all whenever the client answered —
            // a second implementation of the server's `numeric` sum, free to
            // disagree in the trailing digits with the figure actually written
            // to the cost model. `commitmentTotal` now runs only as a CHECK on
            // the same rows: if the two disagree, that is said out loud rather
            // than resolved in the client's favour.
            const check = commitmentTotal(
              tender.commitmentLines.map((l) => ({
                lineRef: l.lineRef,
                description: l.description,
                amount: l.amount,
                currency: l.currency,
              })),
              tender.packageCode,
            );
            if (!tender.commitment.answered) {
              return (
                <>
                  <Refusal text={tender.commitment.refusal} />
                  {check.answered && (
                    <Refusal
                      text={`The lines on this screen add to ${money(
                        check.total,
                        check.currency,
                      )}, but the server refused to answer this contract's commitment total. The server's answer is the one the approval acts on; this line is shown so the disagreement is visible rather than silent.`}
                    />
                  )}
                </>
              );
            }
            return (
              <>
                <div className="text-xs text-slate-300">
                  Commitment{" "}
                  {money(tender.commitment.total, tender.commitment.currency)}{" "}
                  across {tender.commitment.lines} line(s);{" "}
                  {tender.commitmentLines.filter((l) => l.posted).length} posted
                  to the cost model.
                </div>
                {(!check.answered ||
                  check.total !== tender.commitment.total) && (
                  <Refusal
                    text={`The commitment lines on this screen do not add to the total the server posted (${money(
                      tender.commitment.total,
                      tender.commitment.currency,
                    )}). Do not act on either figure until they agree — one of them is being computed over rows the other one cannot see.`}
                  />
                )}
              </>
            );
          })()}
          {canPlan && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              <input
                value={lineRef}
                onChange={(e) => setLineRef(e.target.value)}
                placeholder="Line ref"
                className={inputClass}
              />
              <select
                aria-label="Cost line"
                value={lineCost}
                onChange={(e) => setLineCost(e.target.value)}
                className={inputClass}
              >
                <option value="">Cost line…</option>
                {costItems.map((c) => (
                  <option key={c.ref} value={c.ref}>
                    {c.ref} — {c.description}
                  </option>
                ))}
              </select>
              <input
                value={lineDesc}
                onChange={(e) => setLineDesc(e.target.value)}
                placeholder="Description"
                className={inputClass}
              />
              <input
                value={lineAmount}
                onChange={(e) => setLineAmount(e.target.value)}
                placeholder="Amount (leave blank if not agreed)"
                className={inputClass}
              />
              <input
                value={lineBasis}
                onChange={(e) => setLineBasis(e.target.value)}
                placeholder="Basis (10 characters minimum)"
                className={inputClass}
              />
              <button
                onClick={() =>
                  void act(() =>
                    recordContractCommitmentLine(pkg.packageId, {
                      line_ref: lineRef,
                      cost_item_ref: lineCost,
                      description: lineDesc,
                      basis: lineBasis,
                      // OMITTED, never "0": an unagreed price is not zero, and
                      // the server keeps it NULL so the total can refuse.
                      amount: lineAmount.trim() || undefined,
                    }),
                  )
                }
                disabled={
                  busy ||
                  !lineRef ||
                  !lineCost ||
                  lineDesc.trim().length < 5 ||
                  lineBasis.trim().length < 10
                }
                className={btnClass}
              >
                Record commitment line
              </button>
            </div>
          )}
          {canAward && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
                placeholder="What is being approved and against what (20 characters minimum)"
                className={`${inputClass} sm:col-span-2`}
              />
              <button
                onClick={() =>
                  void act(() =>
                    approveContractCommitments(pkg.packageId, approveNote),
                  )
                }
                disabled={busy || approveNote.trim().length < 20}
                className={btnClass}
              >
                Approve commitments
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── the section ─────────────────────────────── */

export function ProcurementPanel({
  caseId,
  canPlan,
  canAward,
  currentUserEmail,
  reloadKey,
}: {
  caseId: string;
  canPlan: boolean;
  canAward: boolean;
  /** The signed-in person's email, for the separation-of-duties pre-empt. */
  currentUserEmail?: string | null;
  reloadKey?: number;
}) {
  const [payload, setPayload] = useState<CaseProcurement | null>(null);
  const [costItems, setCostItems] = useState<
    { ref: string; description: string; currency: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [commercial, setCommercial] = useState<number | null>(null);

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [required, setRequired] = useState("");
  const [lead, setLead] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [mandatoryBasis, setMandatoryBasis] = useState("");
  const [releaseBasis, setReleaseBasis] = useState("");
  const [sow, setSow] = useState("");
  const [accept, setAccept] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [interfaces, setInterfaces] = useState("");
  const [siteConditions, setSiteConditions] = useState(false);
  const [wbsCode, setWbsCode] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        getCaseProcurement(caseId),
        listCaseCostItemRefs(caseId),
      ]);
      setPayload(p);
      setCostItems(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const record = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordProcurementPackage(caseId, {
        package_code: code,
        title,
        equipment_or_scope: scope,
        scope_of_work: sow || undefined,
        acceptance_criteria: accept || undefined,
        exclusions: exclusions || undefined,
        interfaces: interfaces || undefined,
        site_conditions_stated: siteConditions,
        wbs_code: wbsCode || undefined,
        required_date: required || undefined,
        lead_time_days: lead || undefined,
        // OMITTED MEANS UNCHANGED. `false` is only ever sent alongside a
        // stated release basis, because clearing the flag takes a gate blocker
        // off the board.
        ...(mandatory
          ? { is_mandatory: true, mandatory_basis: mandatoryBasis }
          : releaseBasis.trim().length >= 20
            ? { is_mandatory: false, mandatory_release_basis: releaseBasis }
            : {}),
      });
      setCode("");
      setTitle("");
      setScope("");
      setReleaseBasis("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Package className="h-4 w-4 text-signal-cyan" />}
      title="Procurement, tender and contract (spec I.16, §24, §25)"
      subtitle="A package carries all four §25 status dimensions; a mandatory long-lead package that cannot arrive when the project needs it BLOCKS the gate through the same predicate a breached permit condition rides. Bids are sealed until the envelopes are opened, an evaluation is frozen once recorded, and the person who evaluates cannot be the person who awards — enforced at the database, not on this screen."
    >
      <ErrorLine error={error} />

      {payload && !payload.answered && <Refusal text={payload.refusal} />}
      {payload?.assessabilityNote && (
        <Refusal text={payload.assessabilityNote} />
      )}

      {payload && payload.blockerCount > 0 && (
        <div className="rounded border border-red-400/30 bg-red-400/10 p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-red-300">
            {payload.blockerCount} procurement gate blocker(s)
          </div>
          <ul className="mt-1 space-y-1 text-xs text-red-200">
            {payload.blockers.map((b) => (
              <li key={`${b.type}-${b.id}`}>{b.name}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-red-300/80">
            A gate review recorded as a pass while these stand is refused at the
            database, not on this screen — these are the rows{" "}
            <code>enforce_gate_review_outstanding_obligations</code> reads.
          </p>
        </div>
      )}

      {payload?.deliveryAssessabilityNote && (
        <Refusal text={payload.deliveryAssessabilityNote} />
      )}

      {payload?.answered &&
        payload.packages.map((p) => {
          // ONE ANSWER PER QUESTION. This used to run a CLIENT re-derivation of
          // the lateness rule (`packageLateness`) and render its headline
          // directly above the blocker list that comes from the server
          // predicate — and the two disagreed on the live fixture, because the
          // client copy omitted the discharge term and did not require the
          // mandatory flag. The screen said "delivery is forecast 45 day(s)
          // late" while the blocker list beside it was empty and the gate was
          // passable. The server's own fields are rendered instead; the client
          // predicate is gone.
          const parts: string[] = [];
          if (!p.awarded && p.awardRequiredBy !== null) {
            parts.push(`the award had to be placed by ${p.awardRequiredBy}`);
          }
          if (p.slippageDays !== null && p.slippageDays > 0) {
            parts.push(
              `delivery is forecast ${p.slippageDays} day(s) after the ${p.requiredDate} the project needs it`,
            );
          }
          if (p.actualDeliveryDate) {
            parts.push(`received and inspected ${p.actualDeliveryDate}`);
          }
          const headline = !p.assessable
            ? `${p.packageCode}: lateness NOT ASSESSABLE.`
            : parts.length === 0
              ? `${p.packageCode}: on track against ${p.requiredDate}${
                  p.isMandatory ? " (mandatory long-lead)" : ""
                }.`
              : `${p.packageCode}${
                  p.isMandatory ? " (mandatory long-lead)" : ""
                }: ${parts.join("; ")}.`;
          return (
            <div
              key={p.packageId}
              className="rounded-lg border border-white/8 bg-white/[0.02] p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    {p.packageCode} — {p.title}
                    {p.isMandatory && (
                      <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                        mandatory long-lead
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    {p.equipmentOrScope}
                  </div>
                  <div className="mt-1 text-xs text-slate-300">{headline}</div>
                  {/* ALL FOUR §25 DIMENSIONS IN ONE LINE, always named. */}
                  <div className="text-[11px] text-slate-500">
                    {statusHeadline(p.status)}
                  </div>
                  {p.schedulePositionNote && (
                    <div className="text-[11px] text-slate-500">
                      {p.schedulePositionNote}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setExpanded(expanded === p.packageId ? null : p.packageId)
                    }
                    className={btnClass}
                  >
                    {expanded === p.packageId ? "Hide tender" : "Tender"}
                  </button>
                  {p.awarded && (
                    <button
                      onClick={() =>
                        setCommercial(
                          commercial === p.packageId ? null : p.packageId,
                        )
                      }
                      className={btnClass}
                    >
                      {commercial === p.packageId
                        ? "Hide commercial"
                        : "Commercial"}
                    </button>
                  )}
                </div>
              </div>

              <Refusal text={p.notAssessableReason} />
              <Refusal text={p.deliveryNotAssessableReason} />
              {!p.commitment.answered && p.awarded && (
                <Refusal text={p.commitment.refusal} />
              )}

              {/* Slice 6B — what happened to the contract after signature, on
                  the screen a planner already reads. The figures come from the
                  server's ONE summary; nothing is computed here. */}
              {p.awarded && p.commercial?.answered && (
                <div className="mt-1 text-[11px] text-slate-400">
                  Contract value{" "}
                  {money(p.commercial.currentValue, p.commercial.currency)} ·{" "}
                  {p.commercial.changeOrdersApproved} approved change order(s)
                  {p.commercial.changeOrdersDraft > 0
                    ? `, ${p.commercial.changeOrdersDraft} awaiting a decision`
                    : ""}{" "}
                  {p.commercial.invoices !== null
                    ? ` · ${p.commercial.invoices} invoice(s), ${p.commercial.invoicesAwaitingPayment} certified and unpaid`
                    : ""}{" "}
                  ·{" "}
                  {p.commercial.claimsRaised === 0
                    ? "no claim raised"
                    : `${p.commercial.claimsRaised} claim(s), ${p.commercial.claimsOpen} open`}{" "}
                  · {p.commercial.warrantyTerms} warranty term(s)
                  {p.commercial.warrantyExpired > 0
                    ? `, ${p.commercial.warrantyExpired} expired`
                    : ""}
                  {p.commercial.warrantyNotAssessable > 0
                    ? `, ${p.commercial.warrantyNotAssessable} whose cover cannot be answered`
                    : ""}
                </div>
              )}
              {p.awarded && p.commercial?.answered && (
                <>
                  {/* The ONE invoice position's refusal, not a zero. A contract
                      nobody has billed against and a contract paid in full are
                      the same number to a counter that starts at zero. */}
                  <Refusal text={p.commercial.invoiceRefusal} />
                  <Refusal text={p.commercial.settlementNote} />
                  <Refusal text={p.commercial.warrantyGap} />
                </>
              )}

              <div className="mt-2">
                <StatusDimensions
                  pkg={p}
                  canPlan={canPlan}
                  onChanged={() => void load()}
                />
              </div>

              {expanded === p.packageId && (
                <div className="mt-3">
                  <TenderPanel
                    pkg={p}
                    canPlan={canPlan}
                    canAward={canAward}
                    costItems={costItems}
                    currentUserEmail={currentUserEmail ?? null}
                    onChanged={() => void load()}
                  />
                </div>
              )}

              {/* Slice 6B — the contract's life after signature. Only an
                  AWARDED package has one, and the server says so too. */}
              {commercial === p.packageId && p.awarded && (
                <div className="mt-3">
                  <CommercialPanel
                    packageId={p.packageId}
                    canPlan={canPlan}
                    canApprove={canAward}
                    onChanged={() => void load()}
                  />
                </div>
              )}
            </div>
          );
        })}

      {canPlan && (
        <div className="rounded-lg border border-white/8 bg-white/[0.015] p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Record a procurement package (spec §25)
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Package code"
              className={inputClass}
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className={inputClass}
            />
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="Equipment or scope (20 characters minimum)"
              className={inputClass}
            />
            <input
              type="date"
              aria-label="Required date"
              value={required}
              onChange={(e) => setRequired(e.target.value)}
              className={inputClass}
            />
            <input
              value={lead}
              onChange={(e) => setLead(e.target.value)}
              placeholder="Lead time (days)"
              className={inputClass}
            />
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={mandatory}
                onChange={(e) => setMandatory(e.target.checked)}
              />
              Mandatory long-lead item
            </label>
            {mandatory && (
              <input
                value={mandatoryBasis}
                onChange={(e) => setMandatoryBasis(e.target.value)}
                placeholder="Why it is mandatory (20 characters minimum) — this flag is what blocks a gate"
                className={`${inputClass} sm:col-span-3`}
              />
            )}
            {/* THIS FORM UPSERTS ON THE PACKAGE CODE, and it is blank-slate: it
                does not load an existing package's values. It therefore sends
                `is_mandatory` ONLY when the box is ticked, or when a release
                basis has been written. Sending an unticked box as `false` on
                every save is what silently cleared the flag — and with it a
                live gate blocker — on a cosmetic retitle, with the audit row
                recording `is_mandatory: false` as though the author had asked
                for it. Removing the flag is its own judgement and it states
                its own reason. */}
            {!mandatory && (
              <input
                value={releaseBasis}
                onChange={(e) => setReleaseBasis(e.target.value)}
                placeholder="Only to REMOVE an existing mandatory flag: what changed (20 characters minimum). Leave blank to keep the package exactly as it is."
                className={`${inputClass} sm:col-span-3`}
              />
            )}
            <input
              value={sow}
              onChange={(e) => setSow(e.target.value)}
              placeholder="Scope of work — a tender cannot be issued without it"
              className={inputClass}
            />
            <input
              value={accept}
              onChange={(e) => setAccept(e.target.value)}
              placeholder="Acceptance criteria — a tender cannot be issued without it"
              className={`${inputClass} sm:col-span-2`}
            />
            {/* E7.02's own words: scope clarity is not a feeling, and these are
                the questions a claim gets made against later. All four are
                authored here rather than left to the RPC's argument list. */}
            <input
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              placeholder="Exclusions — what this package is NOT buying"
              className={inputClass}
            />
            <input
              value={interfaces}
              onChange={(e) => setInterfaces(e.target.value)}
              placeholder="Interfaces — where this package meets another one"
              className={inputClass}
            />
            <input
              value={wbsCode}
              onChange={(e) => setWbsCode(e.target.value)}
              placeholder="WBS code (optional) — links the package to the case's scope"
              className={inputClass}
            />
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={siteConditions}
                onChange={(e) => setSiteConditions(e.target.checked)}
              />
              Site conditions stated to bidders
            </label>
          </div>
          <button
            onClick={() => void record()}
            disabled={busy || !code || !title || scope.trim().length < 20}
            className={`${btnClass} mt-2`}
          >
            {busy ? "Recording…" : "Record package"}
          </button>
        </div>
      )}

      {canPlan && (
        <button
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                setPayload(await computeCaseProcurementPosition(caseId));
                setError(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })()
          }
          disabled={busy}
          className={btnClass}
        >
          Compute the procurement position (records a lineage run)
        </button>
      )}
      {payload?.calculationRunId && (
        <p className="text-[11px] text-slate-500">
          Recorded as calculation run {payload.calculationRunId} under{" "}
          {payload.codeVersion}. Every refusal above travelled into it.
        </p>
      )}
    </Section>
  );
}
