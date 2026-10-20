import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  FileWarning,
  PackageCheck,
  ShieldAlert,
  Truck,
} from "lucide-react";
import {
  assessVendorAdvisory,
  getSupplierGovernanceWorkspace,
  recordSupplierDelivery,
  recordSuspectPartCase,
  recordVendorAdvisory,
  type SupplierGovernanceWorkspace,
} from "../services/supplierGovernanceService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-signal-cyan/50";
const buttonClass =
  "rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-sm font-semibold text-signal-cyan transition hover:bg-signal-cyan/15 disabled:cursor-not-allowed disabled:opacity-40";

type SuspectStatus =
  "open" | "investigating" | "confirmed" | "cleared" | "closed";

const deliveryInitial = {
  deliveryReference: "",
  supplierId: "",
  materialId: "",
  orderedOn: "",
  promisedOn: "",
  receivedOn: "",
  quantity: "",
  qualityOutcome: "accepted",
  note: "",
  basis: "",
  evidenceItemId: "",
};

const suspectInitial = {
  selectedId: "",
  caseReference: "",
  materialId: "",
  supplierId: "",
  detectedOn: "",
  detectionMethod: "",
  concern: "counterfeit_suspected",
  quantityAffected: "",
  unitsAlreadyInstalled: "0",
  affectedAssetsIdentified: false,
  quarantined: true,
  reportedExternally: false,
  outcome: "",
  status: "open" as SuspectStatus,
  expectedVersion: undefined as number | undefined,
  basis: "",
  evidenceItemId: "",
};

const advisoryInitial = {
  advisoryReference: "",
  supplierId: "",
  issuedOn: "",
  title: "",
  advisoryKind: "service_bulletin",
  appliesToManufacturer: "",
  appliesToModel: "",
  mandatory: false,
  requiredBy: "",
  basis: "",
  evidenceItemId: "",
};

const assessmentInitial = {
  advisoryId: "",
  expectedVersion: 0,
  status: "planned" as "not_applicable" | "planned" | "complete",
  disposition: "",
  basis: "",
  evidenceItemId: "",
};

function StatusPill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "amber" | "rose";
}) {
  const styles = {
    slate: "border-white/10 bg-white/5 text-slate-300",
    green: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    rose: "border-rose-400/20 bg-rose-400/10 text-rose-200",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

export function SupplierGovernanceControls() {
  const [workspace, setWorkspace] =
    useState<SupplierGovernanceWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [delivery, setDelivery] = useState(deliveryInitial);
  const [suspect, setSuspect] = useState(suspectInitial);
  const [advisory, setAdvisory] = useState(advisoryInitial);
  const [assessment, setAssessment] = useState(assessmentInitial);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await getSupplierGovernanceWorkspace());
    } catch (error) {
      setNotice({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Supplier governance records are unavailable.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const run = async (
    action: () => Promise<{ note?: string }>,
    fallback: string,
    reset: () => void,
  ) => {
    setBusy(true);
    setNotice(null);
    try {
      const receipt = await action();
      setNotice({ ok: true, text: receipt.note ?? fallback });
      reset();
      await load();
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : `${fallback} failed.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const openClaims = useMemo(
    () =>
      workspace?.warranties
        .flatMap((item) => item.claims)
        .filter(
          (claim) => claim.status === "raised" || claim.status === "submitted",
        ).length ?? 0,
    [workspace],
  );
  const scopeGaps =
    workspace?.contractPackages.filter((item) => !item.scopeComplete).length ??
    0;
  const lateDeliveries =
    workspace?.deliveries.filter((item) => !item.onTime).length ?? 0;
  const openSuspects =
    workspace?.suspectCases.filter(
      (item) => item.status !== "cleared" && item.status !== "closed",
    ).length ?? 0;
  const openAdvisories =
    workspace?.advisories.filter(
      (item) =>
        item.assessmentStatus !== "complete" &&
        item.assessmentStatus !== "not_applicable",
    ).length ?? 0;
  const evidence = workspace?.evidence ?? [];
  const suppliers = workspace?.suppliers ?? [];
  const materials = workspace?.materials ?? [];

  const chooseSuspect = (id: string) => {
    if (!id) return setSuspect(suspectInitial);
    const item = workspace?.suspectCases.find((row) => String(row.id) === id);
    if (!item) return;
    setSuspect({
      selectedId: id,
      caseReference: item.caseReference,
      materialId: item.materialId,
      supplierId: item.supplierId ? String(item.supplierId) : "",
      detectedOn: item.detectedOn,
      detectionMethod: item.detectionMethod ?? "",
      concern: item.concern as typeof suspectInitial.concern,
      quantityAffected: "",
      unitsAlreadyInstalled: String(item.unitsAlreadyInstalled),
      affectedAssetsIdentified: item.affectedAssetsIdentified,
      quarantined: item.quarantined,
      reportedExternally: item.reportedExternally,
      outcome: item.outcome ?? "",
      status: item.status,
      expectedVersion: item.version,
      basis: "",
      evidenceItemId: "",
    });
  };

  const chooseAdvisory = (id: string) => {
    const item = workspace?.advisories.find((row) => String(row.id) === id);
    setAssessment(
      item
        ? {
            ...assessmentInitial,
            advisoryId: id,
            expectedVersion: item.version,
          }
        : assessmentInitial,
    );
  };

  return (
    <details className="rounded-2xl border border-white/8 bg-[#0D1520] shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
      <summary className="cursor-pointer list-none px-5 py-4 marker:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <BadgeCheck className="h-4 w-4 text-signal-cyan" aria-hidden />
              Supplier &amp; contractor governance
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Contract scope · measured performance · warranty recovery ·
              deliveries · suspect parts · vendor advisories
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={scopeGaps ? "amber" : "green"}>
              {scopeGaps} scope gap{scopeGaps === 1 ? "" : "s"}
            </StatusPill>
            <StatusPill tone={lateDeliveries ? "amber" : "green"}>
              {lateDeliveries} late
            </StatusPill>
            <StatusPill tone={openSuspects ? "rose" : "green"}>
              {openSuspects} suspect
            </StatusPill>
            <StatusPill tone={openAdvisories ? "amber" : "green"}>
              {openAdvisories} advisory
            </StatusPill>
          </div>
        </div>
      </summary>

      <div className="space-y-5 border-t border-white/8 p-5">
        <p className="max-w-5xl text-xs leading-relaxed text-slate-400">
          {workspace?.boundary ??
            "Observed supplier evidence informs decisions; it never makes them."}
        </p>
        {notice && (
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200" : "border-rose-400/25 bg-rose-400/5 text-rose-200"}`}
          >
            {notice.text}
          </div>
        )}
        {loading && (
          <p className="text-xs text-slate-500">Loading supplier governance…</p>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/8 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <PackageCheck className="h-4 w-4 text-signal-cyan" aria-hidden />{" "}
              Scope clarity
            </div>
            <p className="mt-2 text-2xl font-semibold text-white">
              {workspace?.contractPackages.length ?? 0}
            </p>
            <p className="text-xs text-slate-500">
              canonical packages · {scopeGaps} with material gaps
            </p>
          </div>
          <div className="rounded-xl border border-white/8 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Truck className="h-4 w-4 text-signal-cyan" aria-hidden />{" "}
              Measured performance
            </div>
            <p className="mt-2 text-2xl font-semibold text-white">
              {workspace?.performancePeriods.length ?? 0}
            </p>
            <p className="text-xs text-slate-500">
              retained periods · {workspace?.deliveries.length ?? 0} delivery
              events
            </p>
          </div>
          <div className="rounded-xl border border-white/8 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <BadgeCheck className="h-4 w-4 text-signal-cyan" aria-hidden />{" "}
              Warranty recovery
            </div>
            <p className="mt-2 text-2xl font-semibold text-white">
              {workspace?.warranties.length ?? 0}
            </p>
            <p className="text-xs text-slate-500">
              terms · {openClaims} open claim{openClaims === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {(workspace?.contractPackages.length ?? 0) > 0 && (
          <section className="rounded-xl border border-white/8 p-4">
            <h4 className="text-sm font-semibold text-slate-100">
              Commercial chain
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              Scope, performance and warranty actions remain on their governed
              case workspace.
            </p>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {workspace?.contractPackages.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/6 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-200">
                      {item.packageCode} · {item.title}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.scopeComplete ? (
                        <StatusPill tone="green">scope ready</StatusPill>
                      ) : (
                        Object.keys(item.scopeGaps).map((gap) => (
                          <StatusPill key={gap} tone="amber">
                            {gap}
                          </StatusPill>
                        ))
                      )}
                    </div>
                  </div>
                  {item.developmentCaseId && (
                    <Link
                      className="shrink-0 text-xs text-signal-cyan hover:underline"
                      to={`/develop/cases/${item.developmentCaseId}`}
                    >
                      Open case
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Truck className="h-4 w-4 text-signal-cyan" aria-hidden /> Record
            verified delivery
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Append one inspected receipt. This measures performance; it does not
            approve the supplier.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <input
              aria-label="Delivery reference"
              className={inputClass}
              placeholder="PO / receipt reference"
              value={delivery.deliveryReference}
              onChange={(e) =>
                setDelivery({ ...delivery, deliveryReference: e.target.value })
              }
            />
            <select
              aria-label="Delivery supplier"
              className={inputClass}
              value={delivery.supplierId}
              onChange={(e) =>
                setDelivery({ ...delivery, supplierId: e.target.value })
              }
            >
              <option value="">Supplier…</option>
              {suppliers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.supplierCode} — {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Delivery material"
              className={inputClass}
              value={delivery.materialId}
              onChange={(e) =>
                setDelivery({ ...delivery, materialId: e.target.value })
              }
            >
              <option value="">No material link</option>
              {materials.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.materialCode} — {item.description}
                </option>
              ))}
            </select>
            <input
              aria-label="Delivery quantity"
              className={inputClass}
              placeholder="Quantity (optional)"
              value={delivery.quantity}
              onChange={(e) =>
                setDelivery({ ...delivery, quantity: e.target.value })
              }
            />
            <input
              aria-label="Ordered on"
              type="date"
              className={inputClass}
              value={delivery.orderedOn}
              onChange={(e) =>
                setDelivery({ ...delivery, orderedOn: e.target.value })
              }
            />
            <input
              aria-label="Promised on"
              type="date"
              className={inputClass}
              value={delivery.promisedOn}
              onChange={(e) =>
                setDelivery({ ...delivery, promisedOn: e.target.value })
              }
            />
            <input
              aria-label="Received on"
              type="date"
              className={inputClass}
              value={delivery.receivedOn}
              onChange={(e) =>
                setDelivery({ ...delivery, receivedOn: e.target.value })
              }
            />
            <select
              aria-label="Delivery quality outcome"
              className={inputClass}
              value={delivery.qualityOutcome}
              onChange={(e) =>
                setDelivery({ ...delivery, qualityOutcome: e.target.value })
              }
            >
              <option value="accepted">Accepted</option>
              <option value="accepted_with_deviation">
                Accepted with deviation
              </option>
              <option value="rejected_wrong_item">Rejected — wrong item</option>
              <option value="rejected_quality">Rejected — quality</option>
              <option value="rejected_documentation">
                Rejected — documentation
              </option>
            </select>
            <input
              aria-label="Delivery evidence basis"
              className={`${inputClass} lg:col-span-2`}
              placeholder="Source and reconciliation basis (20+ characters)"
              value={delivery.basis}
              onChange={(e) =>
                setDelivery({ ...delivery, basis: e.target.value })
              }
            />
            <select
              aria-label="Delivery evidence"
              className={inputClass}
              value={delivery.evidenceItemId}
              onChange={(e) =>
                setDelivery({ ...delivery, evidenceItemId: e.target.value })
              }
            >
              <option value="">Verified evidence…</option>
              {evidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <button
              className={buttonClass}
              disabled={
                busy ||
                !delivery.deliveryReference ||
                !delivery.supplierId ||
                !delivery.orderedOn ||
                !delivery.promisedOn ||
                !delivery.receivedOn ||
                delivery.basis.length < 20 ||
                !delivery.evidenceItemId
              }
              onClick={() =>
                void run(
                  () =>
                    recordSupplierDelivery({
                      ...delivery,
                      ...(delivery.materialId ? {} : { materialId: undefined }),
                      ...(delivery.quantity ? {} : { quantity: undefined }),
                    }),
                  "Supplier delivery recorded.",
                  () => setDelivery(deliveryInitial),
                )
              }
            >
              Record delivery
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <ShieldAlert className="h-4 w-4 text-rose-300" aria-hidden />{" "}
            Suspect and unapproved parts
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            New cases start quarantined. Only an authorized human can confirm or
            close one; SyncAI never declares a part counterfeit.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <select
              aria-label="Existing suspect-part case"
              className={inputClass}
              value={suspect.selectedId}
              onChange={(e) => chooseSuspect(e.target.value)}
            >
              <option value="">New case</option>
              {workspace?.suspectCases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.caseReference} · v{item.version} · {item.status}
                </option>
              ))}
            </select>
            <input
              aria-label="Suspect-part case reference"
              className={inputClass}
              disabled={Boolean(suspect.selectedId)}
              placeholder="Case reference"
              value={suspect.caseReference}
              onChange={(e) =>
                setSuspect({ ...suspect, caseReference: e.target.value })
              }
            />
            <select
              aria-label="Suspect-part material"
              className={inputClass}
              value={suspect.materialId}
              onChange={(e) =>
                setSuspect({ ...suspect, materialId: e.target.value })
              }
            >
              <option value="">Material…</option>
              {materials.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.materialCode} — {item.description}
                </option>
              ))}
            </select>
            <select
              aria-label="Suspect-part supplier"
              className={inputClass}
              value={suspect.supplierId}
              onChange={(e) =>
                setSuspect({ ...suspect, supplierId: e.target.value })
              }
            >
              <option value="">Supplier unknown</option>
              {suppliers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.supplierCode} — {item.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Suspect-part detection date"
              type="date"
              className={inputClass}
              value={suspect.detectedOn}
              onChange={(e) =>
                setSuspect({ ...suspect, detectedOn: e.target.value })
              }
            />
            <select
              aria-label="Suspect-part concern"
              className={inputClass}
              value={suspect.concern}
              onChange={(e) =>
                setSuspect({
                  ...suspect,
                  concern: e.target.value as typeof suspect.concern,
                })
              }
            >
              <option value="counterfeit_suspected">
                Counterfeit suspected
              </option>
              <option value="unapproved_source">Unapproved source</option>
              <option value="documentation_missing">
                Documentation missing
              </option>
              <option value="documentation_falsified">
                Documentation falsified
              </option>
              <option value="specification_mismatch">
                Specification mismatch
              </option>
            </select>
            <select
              aria-label="Suspect-part status"
              className={inputClass}
              value={suspect.status}
              onChange={(e) =>
                setSuspect({
                  ...suspect,
                  status: e.target.value as typeof suspect.status,
                })
              }
            >
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="confirmed">Confirmed by human</option>
              <option value="cleared">Cleared by human</option>
              <option value="closed">Closed by human</option>
            </select>
            <input
              aria-label="Installed suspect units"
              className={inputClass}
              placeholder="Units already installed"
              value={suspect.unitsAlreadyInstalled}
              onChange={(e) =>
                setSuspect({
                  ...suspect,
                  unitsAlreadyInstalled: e.target.value,
                })
              }
            />
            <input
              aria-label="Suspect-part outcome"
              className={`${inputClass} lg:col-span-2`}
              placeholder="Outcome for terminal status (20+ characters)"
              value={suspect.outcome}
              onChange={(e) =>
                setSuspect({ ...suspect, outcome: e.target.value })
              }
            />
            <input
              aria-label="Suspect-part evidence basis"
              className={`${inputClass} lg:col-span-2`}
              placeholder="Evidence basis (20+ characters)"
              value={suspect.basis}
              onChange={(e) =>
                setSuspect({ ...suspect, basis: e.target.value })
              }
            />
            <select
              aria-label="Suspect-part evidence"
              className={inputClass}
              value={suspect.evidenceItemId}
              onChange={(e) =>
                setSuspect({ ...suspect, evidenceItemId: e.target.value })
              }
            >
              <option value="">Verified evidence…</option>
              {evidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 px-3 py-2 text-xs text-slate-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={suspect.quarantined}
                  onChange={(e) =>
                    setSuspect({ ...suspect, quarantined: e.target.checked })
                  }
                />{" "}
                Quarantined
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={suspect.affectedAssetsIdentified}
                  onChange={(e) =>
                    setSuspect({
                      ...suspect,
                      affectedAssetsIdentified: e.target.checked,
                    })
                  }
                />{" "}
                Assets identified
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={suspect.reportedExternally}
                  onChange={(e) =>
                    setSuspect({
                      ...suspect,
                      reportedExternally: e.target.checked,
                    })
                  }
                />{" "}
                Reported
              </label>
            </div>
            <button
              className={buttonClass}
              disabled={
                busy ||
                !suspect.caseReference ||
                !suspect.materialId ||
                !suspect.detectedOn ||
                suspect.basis.length < 20 ||
                !suspect.evidenceItemId
              }
              onClick={() =>
                void run(
                  () =>
                    recordSuspectPartCase({
                      caseReference: suspect.caseReference,
                      materialId: suspect.materialId,
                      supplierId: suspect.supplierId || undefined,
                      detectedOn: suspect.detectedOn,
                      detectionMethod: suspect.detectionMethod || undefined,
                      concern: suspect.concern,
                      quantityAffected: suspect.quantityAffected || undefined,
                      unitsAlreadyInstalled: suspect.unitsAlreadyInstalled,
                      affectedAssetsIdentified:
                        suspect.affectedAssetsIdentified,
                      quarantined: suspect.quarantined,
                      reportedExternally: suspect.reportedExternally,
                      outcome: suspect.outcome || undefined,
                      status: suspect.status,
                      expectedVersion: suspect.expectedVersion,
                      basis: suspect.basis,
                      evidenceItemId: suspect.evidenceItemId,
                    }),
                  "Suspect-part case recorded.",
                  () => setSuspect(suspectInitial),
                )
              }
            >
              {suspect.selectedId
                ? "Record next version"
                : "Open quarantined case"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <FileWarning className="h-4 w-4 text-amber-300" aria-hidden />{" "}
            Vendor technical advisories
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            The source is recorded first as unassessed. Applicability, planning
            and completion are separate human determinations with new evidence.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <input
              aria-label="Advisory reference"
              className={inputClass}
              placeholder="Vendor advisory reference"
              value={advisory.advisoryReference}
              onChange={(e) =>
                setAdvisory({ ...advisory, advisoryReference: e.target.value })
              }
            />
            <select
              aria-label="Advisory supplier"
              className={inputClass}
              value={advisory.supplierId}
              onChange={(e) =>
                setAdvisory({ ...advisory, supplierId: e.target.value })
              }
            >
              <option value="">Supplier…</option>
              {suppliers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.supplierCode} — {item.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Advisory issued on"
              type="date"
              className={inputClass}
              value={advisory.issuedOn}
              onChange={(e) =>
                setAdvisory({ ...advisory, issuedOn: e.target.value })
              }
            />
            <select
              aria-label="Advisory kind"
              className={inputClass}
              value={advisory.advisoryKind}
              onChange={(e) =>
                setAdvisory({ ...advisory, advisoryKind: e.target.value })
              }
            >
              <option value="safety_bulletin">Safety bulletin</option>
              <option value="service_bulletin">Service bulletin</option>
              <option value="recall">Recall</option>
              <option value="product_change_notice">
                Product change notice
              </option>
              <option value="obsolescence_notice">Obsolescence notice</option>
              <option value="cybersecurity_advisory">
                Cybersecurity advisory
              </option>
            </select>
            <input
              aria-label="Advisory title"
              className={`${inputClass} lg:col-span-2`}
              placeholder="Advisory title"
              value={advisory.title}
              onChange={(e) =>
                setAdvisory({ ...advisory, title: e.target.value })
              }
            />
            <input
              aria-label="Advisory manufacturer"
              className={inputClass}
              placeholder="Applicable manufacturer"
              value={advisory.appliesToManufacturer}
              onChange={(e) =>
                setAdvisory({
                  ...advisory,
                  appliesToManufacturer: e.target.value,
                })
              }
            />
            <input
              aria-label="Advisory model"
              className={inputClass}
              placeholder="Applicable model"
              value={advisory.appliesToModel}
              onChange={(e) =>
                setAdvisory({ ...advisory, appliesToModel: e.target.value })
              }
            />
            <label className="flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={advisory.mandatory}
                onChange={(e) =>
                  setAdvisory({ ...advisory, mandatory: e.target.checked })
                }
              />{" "}
              Vendor marks mandatory
            </label>
            <input
              aria-label="Advisory required by"
              type="date"
              className={inputClass}
              value={advisory.requiredBy}
              onChange={(e) =>
                setAdvisory({ ...advisory, requiredBy: e.target.value })
              }
            />
            <input
              aria-label="Advisory source basis"
              className={`${inputClass} lg:col-span-2`}
              placeholder="Source and applicability basis (20+ characters)"
              value={advisory.basis}
              onChange={(e) =>
                setAdvisory({ ...advisory, basis: e.target.value })
              }
            />
            <select
              aria-label="Advisory evidence"
              className={inputClass}
              value={advisory.evidenceItemId}
              onChange={(e) =>
                setAdvisory({ ...advisory, evidenceItemId: e.target.value })
              }
            >
              <option value="">Verified evidence…</option>
              {evidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <button
              className={buttonClass}
              disabled={
                busy ||
                !advisory.advisoryReference ||
                !advisory.supplierId ||
                !advisory.issuedOn ||
                !advisory.title ||
                advisory.basis.length < 20 ||
                !advisory.evidenceItemId ||
                (!advisory.appliesToManufacturer && !advisory.appliesToModel) ||
                (advisory.mandatory && !advisory.requiredBy)
              }
              onClick={() =>
                void run(
                  () =>
                    recordVendorAdvisory({
                      ...advisory,
                      ...(advisory.requiredBy ? {} : { requiredBy: undefined }),
                    }),
                  "Vendor advisory recorded as unassessed.",
                  () => setAdvisory(advisoryInitial),
                )
              }
            >
              Record unassessed advisory
            </button>
          </div>

          <div className="mt-4 grid gap-2 border-t border-white/8 pt-4 md:grid-cols-2 lg:grid-cols-4">
            <select
              aria-label="Advisory to assess"
              className={inputClass}
              value={assessment.advisoryId}
              onChange={(e) => chooseAdvisory(e.target.value)}
            >
              <option value="">Advisory to assess…</option>
              {workspace?.advisories
                .filter(
                  (item) =>
                    item.assessmentStatus !== "complete" &&
                    item.assessmentStatus !== "not_applicable",
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.advisoryReference} · v{item.version} ·{" "}
                    {item.assessmentStatus}
                  </option>
                ))}
            </select>
            <select
              aria-label="Advisory assessment status"
              className={inputClass}
              value={assessment.status}
              onChange={(e) =>
                setAssessment({
                  ...assessment,
                  status: e.target.value as typeof assessment.status,
                })
              }
            >
              <option value="planned">Planned</option>
              <option value="not_applicable">Not applicable</option>
              <option value="complete">Complete</option>
            </select>
            <input
              aria-label="Advisory disposition"
              className={`${inputClass} lg:col-span-2`}
              placeholder="Human disposition (20+ characters)"
              value={assessment.disposition}
              onChange={(e) =>
                setAssessment({ ...assessment, disposition: e.target.value })
              }
            />
            <input
              aria-label="Advisory assessment basis"
              className={`${inputClass} lg:col-span-2`}
              placeholder="Assessment evidence basis (20+ characters)"
              value={assessment.basis}
              onChange={(e) =>
                setAssessment({ ...assessment, basis: e.target.value })
              }
            />
            <select
              aria-label="Advisory assessment evidence"
              className={inputClass}
              value={assessment.evidenceItemId}
              onChange={(e) =>
                setAssessment({ ...assessment, evidenceItemId: e.target.value })
              }
            >
              <option value="">Verified evidence…</option>
              {evidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <button
              className={buttonClass}
              disabled={
                busy ||
                !assessment.advisoryId ||
                assessment.disposition.length < 20 ||
                assessment.basis.length < 20 ||
                !assessment.evidenceItemId
              }
              onClick={() =>
                void run(
                  () =>
                    assessVendorAdvisory({
                      ...assessment,
                      advisoryId: Number(assessment.advisoryId),
                    }),
                  "Advisory assessment recorded.",
                  () => setAssessment(assessmentInitial),
                )
              }
            >
              Record human assessment
            </button>
          </div>
        </section>
      </div>
    </details>
  );
}
