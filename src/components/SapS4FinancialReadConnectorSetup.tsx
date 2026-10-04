import { useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  listCaseCostItemRefs,
  listDevelopmentCases,
} from "../services/developService";
import {
  parseSapGlCostMappings,
  sapS4FinancialReadActions,
} from "../services/sapS4FinancialRead";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

type CaseOption = { id: string; title: string };
type CostOption = { ref: string; description: string; currency: string };

export function SapS4FinancialReadConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const admin = String(profile?.role ?? "").toLowerCase() === "admin";
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [costItems, setCostItems] = useState<CostOption[]>([]);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [serviceRoot, setServiceRoot] = useState("");
  const [caseId, setCaseId] = useState("");
  const [ledger, setLedger] = useState("0L");
  const [companyCode, setCompanyCode] = useState("");
  const [currency, setCurrency] = useState("");
  const [postingStartDate, setPostingStartDate] = useState("");
  const [mappingText, setMappingText] = useState("");
  const [maxRows, setMaxRows] = useState("25000");
  const [pageSize, setPageSize] = useState("1000");
  const [maxPages, setMaxPages] = useState("50");
  const [interval, setInterval] = useState("1440");
  const [credential, setCredential] = useState("");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    void listDevelopmentCases()
      .then((rows) => {
        if (active) setCases(rows.map(({ id, title }) => ({ id, title })));
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [admin]);

  useEffect(() => {
    if (!admin || !caseId) {
      setCostItems([]);
      return;
    }
    let active = true;
    void listCaseCostItemRefs(caseId)
      .then((rows) => {
        if (active) setCostItems(rows);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [admin, caseId]);

  const parsedMappings = useMemo(() => {
    try {
      return parseSapGlCostMappings(mappingText);
    } catch {
      return null;
    }
  }, [mappingText]);

  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    serviceRoot.trim().length > 0 &&
    caseId.length > 0 &&
    ledger.trim().length > 0 &&
    companyCode.trim().length > 0 &&
    /^[A-Za-z]{3}$/.test(currency.trim()) &&
    /^\d{4}-\d{2}-\d{2}$/.test(postingStartDate) &&
    parsedMappings !== null &&
    Number.isSafeInteger(Number(maxRows)) &&
    Number(maxRows) >= 1 &&
    Number(maxRows) <= 25000 &&
    Number.isSafeInteger(Number(pageSize)) &&
    Number(pageSize) >= 1 &&
    Number(pageSize) <= Math.min(Number(maxRows), 5000) &&
    Number.isSafeInteger(Number(maxPages)) &&
    Number(maxPages) >= 2 &&
    Number(maxPages) <= 100 &&
    Number.isSafeInteger(Number(interval)) &&
    Number(interval) >= 1 &&
    credential.trim().length > 0 &&
    basis.trim().length >= 20;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const costMappings = parseSapGlCostMappings(mappingText);
      const result = await sapS4FinancialReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        serviceRoot: serviceRoot.trim(),
        developmentCaseId: caseId,
        ledger: ledger.trim().toUpperCase(),
        companyCode: companyCode.trim().toUpperCase(),
        currency: currency.trim().toUpperCase(),
        postingStartDate,
        costMappings,
        maxRows: Number(maxRows),
        pageSize: Number(pageSize),
        maxPages: Number(maxPages),
        interval: Number(interval),
        credentialRef: credential.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "SAP financial source saved."));
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pull = async (dryRun: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sapS4FinancialReadActions.pull(key.trim(), dryRun);
      const missing = Array.isArray(result.missing_mappings)
        ? ` ${result.missing_mappings.length} approved mapping(s) had no source rows; zero was not inferred.`
        : "";
      setMessage(
        `${dryRun ? "Dry run" : "Pull"}: ${String(result.raw_rows ?? 0)} journal rows mapped to ${String(result.mapped_rows ?? 0)} cumulative cost actuals across ${String(result.pages ?? 0)} pages.${missing}${dryRun ? " No run, staging, cost or watermark row was written." : ` Status ${String(result.status ?? "unknown")}; ${String(result.records_rejected ?? 0)} refused.`}`,
      );
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-5">
      <div className="flex items-start gap-3">
        <BadgeDollarSign className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            SAP S/4HANA G/L actuals (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Aggregate one approved ledger, company, posting window and exact
            WBS/G/L mappings into existing coded cost lines. SyncAI never
            creates project structure, changes a baseline or writes to SAP.
          </p>
        </div>
      </div>

      {!admin ? (
        <p className="mt-4 text-sm text-slate-400">
          A named human administrator must configure or enable this source.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <input
              className={input}
              placeholder="SAP finance connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="SAP finance display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              placeholder="https://sap.example.com/sap/opu/odata/sap/API_GLACCOUNTLINEITEM_SRV"
              value={serviceRoot}
              onChange={(event) => setServiceRoot(event.target.value)}
            />
            <select
              className={input}
              aria-label="Development case"
              value={caseId}
              onChange={(event) => setCaseId(event.target.value)}
            >
              <option value="">Map to one tenant development case</option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <input
              className={input}
              aria-label="SAP ledger"
              placeholder="Ledger, for example 0L"
              value={ledger}
              onChange={(event) => setLedger(event.target.value)}
            />
            <input
              className={input}
              aria-label="SAP company code"
              placeholder="Company code, for example CA01"
              value={companyCode}
              onChange={(event) => setCompanyCode(event.target.value)}
            />
            <input
              className={input}
              aria-label="Company-code currency"
              placeholder="Currency, for example CAD"
              maxLength={3}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            />
            <input
              className={input}
              aria-label="Cumulative posting start date"
              type="date"
              value={postingStartDate}
              onChange={(event) => setPostingStartDate(event.target.value)}
            />
            <input
              className={input}
              aria-label="Maximum SAP journal rows"
              type="number"
              min="1"
              max="25000"
              value={maxRows}
              onChange={(event) => setMaxRows(event.target.value)}
            />
            <input
              className={input}
              aria-label="SAP page size"
              type="number"
              min="1"
              max="5000"
              value={pageSize}
              onChange={(event) => setPageSize(event.target.value)}
            />
            <input
              className={input}
              aria-label="Maximum SAP pages"
              type="number"
              min="2"
              max="100"
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
            />
            <input
              className={input}
              aria-label="Expected SAP finance interval minutes"
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/sap-s4-finance"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
          <textarea
            className={`${input} mt-3 font-mono`}
            rows={5}
            aria-label="Approved SAP WBS and G/L mappings"
            placeholder={
              "One mapping per line:\nSAP_WBS_INTERNAL_ID | GL_ACCOUNT | COST_ITEM_REF"
            }
            value={mappingText}
            onChange={(event) => setMappingText(event.target.value)}
          />
          {costItems.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Existing cost lines:{" "}
              {costItems
                .map((item) => `${item.ref} (${item.currency})`)
                .join(", ")}
            </p>
          )}
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority and exact ledger/company/posting-window/mapping basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable only after the exact SAP host, OAuth binding and mappings are
            approved
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!valid || busy}
              onClick={() => void save()}
              className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-industrial-navy disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save governed source
            </button>
            <button
              type="button"
              disabled={!key.trim() || busy}
              onClick={() => void pull(true)}
              className="rounded-lg border border-industrial-border px-4 py-2 text-sm text-industrial-text disabled:opacity-40"
            >
              Validate dry run
            </button>
            <button
              type="button"
              disabled={!key.trim() || busy}
              onClick={() => void pull(false)}
              className="rounded-lg border border-signal-cyan/50 px-4 py-2 text-sm text-signal-cyan disabled:opacity-40"
            >
              Pull cumulative actuals
            </button>
          </div>
          <div className="mt-3 flex items-start gap-2 text-xs text-slate-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
            GET only, bounded and page-hashed. Missing source rows never become
            zero. Accepted values use the canonical cost writer and preserve
            baseline, commitment, forecast, contingency and coding.
          </div>
        </>
      )}
      {message && (
        <p className="mt-3 text-sm text-slate-300" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
