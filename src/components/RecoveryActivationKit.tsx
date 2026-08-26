import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  DatabaseZap,
  FileSpreadsheet,
  Link2,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { parseCSV } from "../lib/fleet-import";
import {
  applyRecoveryMapping,
  autoMapRecoveryHeaders,
  getRecoveryActivationEntity,
  RECOVERY_ACTIVATION_ENTITIES,
  type RecoveryActivationEntity,
} from "../lib/recovery-activation";
import {
  getRecoveryActivationReadiness,
  getRecoveryActivationWorkOrders,
  recoveryActivationActions,
  type RecoveryActivationBatchResult,
  type RecoveryActivationReadiness,
  type RecoveryActivationWorkOrder,
} from "../services/syncRecoveryService";
import { useAuth } from "./AuthProvider";

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-teal-500";
const cardClass =
  "rounded-xl border border-industrial-border bg-industrial-graphite p-5";

function parseObject<T extends Record<string, unknown>>(
  text: string,
  label: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as T;
}

function Summary({ result }: { result: RecoveryActivationBatchResult }) {
  return (
    <div className="rounded-lg border border-white/8 bg-industrial-slate/50 p-3 text-sm text-slate-300">
      Read {result.read} · accepted {result.accepted} · duplicate{" "}
      {result.duplicate} · rejected{" "}
      <span className={result.rejected ? "text-red-300" : "text-emerald-300"}>
        {result.rejected}
      </span>
      {result.dry_run && (
        <span className="ml-2 text-slate-500">dry run; nothing written</span>
      )}
    </div>
  );
}

export function RecoveryActivationKit({
  onPlanCreated,
}: {
  onPlanCreated: (eventId: string) => Promise<void>;
}) {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "").toLowerCase();
  const isAdmin = role === "admin" || role === "ai_admin";
  const canPlan = [
    "planner",
    "maintenance_manager",
    "reliability_engineer",
    "admin",
    "ai_admin",
  ].includes(role);

  const [readiness, setReadiness] =
    useState<RecoveryActivationReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [sourceKey, setSourceKey] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [systemKind, setSystemKind] = useState("file");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  const [credentialRef, setCredentialRef] = useState("");
  const [sourceBasis, setSourceBasis] = useState("");
  const [sourceEnabled, setSourceEnabled] = useState(true);

  const [entityType, setEntityType] =
    useState<RecoveryActivationEntity>("site");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [fileName, setFileName] = useState("");
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>(
    {},
  );
  const [sourceArrayPath, setSourceArrayPath] = useState("");
  const [valueMappingsText, setValueMappingsText] = useState("{}");
  const [constantsText, setConstantsText] = useState("{}");
  const [mappingBasis, setMappingBasis] = useState("");
  const [preview, setPreview] = useState<RecoveryActivationBatchResult | null>(
    null,
  );
  const [rejects, setRejects] = useState<
    Array<{ external_id: string | null; reject_reason: string }>
  >([]);

  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [workOrders, setWorkOrders] = useState<RecoveryActivationWorkOrder[]>(
    [],
  );
  const [selectedWork, setSelectedWork] = useState<Set<string>>(new Set());
  const [eventType, setEventType] = useState("planned");
  const [eventReason, setEventReason] = useState("");
  const [baselineReturnAt, setBaselineReturnAt] = useState("");
  const [baselineMethod, setBaselineMethod] = useState(
    "original_approved_schedule",
  );
  const [baselineBasis, setBaselineBasis] = useState("");

  const definition = getRecoveryActivationEntity(entityType);
  const selectedSource =
    readiness?.sources.find((source) => source.connector_key === sourceKey) ??
    null;
  const approvedMapping = selectedSource?.mappings.find(
    (mapping) =>
      mapping.entity_type === entityType && mapping.status === "approved",
  );

  async function refresh() {
    setLoading(true);
    try {
      const next = await getRecoveryActivationReadiness();
      setReadiness(next);
      if (!sourceKey && next.sources.length)
        setSourceKey(next.sources[0].connector_key);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPreview(null);
    setRejects([]);
    setColumnMapping(
      sourceRows.length ? autoMapRecoveryHeaders(entityType, headers) : {},
    );
  }, [entityType, headers, sourceRows.length]);

  useEffect(() => {
    if (!selectedAssetId) {
      setWorkOrders([]);
      setSelectedWork(new Set());
      return;
    }
    void getRecoveryActivationWorkOrders(selectedAssetId)
      .then((items) => {
        setWorkOrders(items);
        setSelectedWork(new Set());
        const candidate = readiness?.candidates.find(
          (item) => item.asset_id === selectedAssetId,
        );
        setEventType(candidate?.is_currently_down ? "unplanned" : "planned");
      })
      .catch((caught) => setError((caught as Error).message));
  }, [selectedAssetId, readiness?.candidates]);

  const mappedRows = useMemo(() => {
    try {
      const valueMaps = parseObject<Record<string, Record<string, string>>>(
        valueMappingsText,
        "Vocabulary mappings",
      );
      const constants = parseObject<Record<string, unknown>>(
        constantsText,
        "Constants",
      );
      return sourceRows.map((row) =>
        applyRecoveryMapping(row, columnMapping, valueMaps, constants),
      );
    } catch {
      return [];
    }
  }, [sourceRows, columnMapping, valueMappingsText, constantsText]);

  const constantFields = useMemo(() => {
    try {
      return new Set(
        Object.entries(
          parseObject<Record<string, unknown>>(constantsText, "Constants"),
        )
          .filter(([, value]) => value !== null && value !== "")
          .map(([key]) => key),
      );
    } catch {
      return new Set<string>();
    }
  }, [constantsText]);

  const missingRequired = definition.fields
    .filter(
      (field) =>
        field.required &&
        !columnMapping[field.key] &&
        !constantFields.has(field.key),
    )
    .map((field) => field.label);

  async function execute(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function configureSource() {
    await recoveryActivationActions.configureSource({
      key: sourceKey,
      name: sourceName,
      systemKind,
      endpointUrl: systemKind === "file" ? null : endpointUrl,
      expectedIntervalMinutes:
        systemKind === "file" ? null : Number(intervalMinutes),
      credentialBindingRef: systemKind === "file" ? null : credentialRef,
      enabled: sourceEnabled,
      basis: sourceBasis,
    });
    setMessage("Read-only activation source saved.");
    await refresh();
  }

  async function onFile(file: File) {
    setError(null);
    setPreview(null);
    setRejects([]);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError(
        "CSV is the controlled file fallback. Export spreadsheet files to CSV first.",
      );
      return;
    }
    const parsed = parseCSV(await file.text());
    if (parsed.length < 2) {
      setError("The CSV needs a header row and at least one data row.");
      return;
    }
    const [rawHeaders, ...body] = parsed;
    const uniqueHeaders = rawHeaders.map((header) => header.trim());
    if (
      uniqueHeaders.some((header) => !header) ||
      new Set(uniqueHeaders).size !== uniqueHeaders.length
    ) {
      setError("CSV headers must be non-empty and unique.");
      return;
    }
    const rows = body.map((row) =>
      Object.fromEntries(
        uniqueHeaders.map((header, index) => [
          header,
          (row[index] ?? "").trim(),
        ]),
      ),
    );
    setFileName(file.name);
    setHeaders(uniqueHeaders);
    setSourceRows(rows);
    setColumnMapping(autoMapRecoveryHeaders(entityType, uniqueHeaders));
  }

  async function saveMapping() {
    const valueMappings = parseObject<Record<string, Record<string, string>>>(
      valueMappingsText,
      "Vocabulary mappings",
    );
    const constants = parseObject<Record<string, unknown>>(
      constantsText,
      "Constants",
    );
    await recoveryActivationActions.saveMapping({
      connectorKey: sourceKey,
      entityType,
      sourceArrayPath,
      columnMapping,
      valueMappings,
      constants,
      approve: true,
      basis: mappingBasis,
    });
    setMessage(`${definition.label} mapping approved with human provenance.`);
    await refresh();
  }

  async function dryRunCsv() {
    const totals: RecoveryActivationBatchResult = {
      dry_run: true,
      read: 0,
      accepted: 0,
      duplicate: 0,
      rejected: 0,
      results: [],
    };
    for (let index = 0; index < mappedRows.length; index += 500) {
      const result = await recoveryActivationActions.preview(
        sourceKey,
        entityType,
        mappedRows.slice(index, index + 500),
      );
      totals.read += result.read;
      totals.accepted += result.accepted;
      totals.duplicate += result.duplicate;
      totals.rejected += result.rejected;
      for (const item of result.results ?? []) {
        if ((totals.results?.length ?? 0) >= 100) break;
        totals.results?.push({
          ...item,
          row_number: item.row_number + index,
        });
      }
    }
    setPreview(totals);
    setMessage(
      "Dry-run validation complete; no canonical or staging rows were written.",
    );
  }

  async function commitCsv() {
    const started = await recoveryActivationActions.beginRun(
      sourceKey,
      entityType,
    );
    const runId = String(started.run_id ?? "");
    if (!runId) throw new Error("Activation run did not return an identifier.");
    const totals: RecoveryActivationBatchResult = {
      read: 0,
      accepted: 0,
      duplicate: 0,
      rejected: 0,
    };
    try {
      for (let index = 0; index < mappedRows.length; index += 500) {
        const batch = await recoveryActivationActions.ingestBatch(
          runId,
          mappedRows.slice(index, index + 500),
        );
        totals.read += batch.read;
        totals.accepted += batch.accepted;
        totals.duplicate += batch.duplicate;
        totals.rejected += batch.rejected;
      }
      await recoveryActivationActions.finishRun(
        runId,
        totals.rejected ? "partial" : "success",
      );
      if (totals.rejected)
        setRejects(await recoveryActivationActions.getRejects(runId));
      setPreview({
        ...totals,
        run_id: runId,
        status: totals.rejected ? "partial" : "success",
      });
      setMessage(
        "CSV committed through the canonical replay-safe connector contract.",
      );
      await refresh();
    } catch (caught) {
      await recoveryActivationActions
        .finishRun(runId, "failed")
        .catch(() => undefined);
      throw caught;
    }
  }

  async function runRest(dryRun: boolean) {
    const result = await recoveryActivationActions.pullRest(
      sourceKey,
      entityType,
      dryRun,
    );
    setPreview(result);
    setMessage(
      dryRun
        ? "REST dry run complete; nothing was written."
        : "REST source imported through the canonical connector contract.",
    );
    await refresh();
  }

  async function createPlan() {
    const result = await recoveryActivationActions.prepareFirstPlan({
      assetId: selectedAssetId,
      workOrderIds: [...selectedWork],
      reason: eventReason,
      eventType,
      baselineReturnAt,
      baselineMethod,
      baselineBasis,
    });
    const eventId = String(result.event_id ?? "");
    if (!eventId)
      throw new Error("Draft plan did not return an event identifier.");
    setMessage("Governed draft plan created. It is not approved or released.");
    await refresh();
    await onPlanCreated(eventId);
  }

  if (loading && !readiness) {
    return (
      <div className="p-8 text-sm text-slate-400">
        Loading activation readiness…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className={cardClass}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-teal-300">
              <DatabaseZap className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Recovery Activation Kit</h2>
            </div>
            <p className="mt-2 max-w-4xl text-sm text-slate-400">
              Connect one real tenant, prove every row before promotion, and
              produce the first governed Recovery draft from customer-selected
              scope. All transports are read-only; no action writes back to the
              CMMS/EAM and no plan bypasses approval.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={working}
            className="inline-flex items-center gap-2 rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-300 disabled:opacity-40"
          >
            <RefreshCw className="h-4 w-4" /> Refresh readiness
          </button>
        </div>
        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {message}
          </p>
        )}
      </section>

      <section className={cardClass}>
        <div className="flex items-start gap-3">
          <Link2 className="mt-0.5 h-5 w-5 text-teal-400" />
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Step 1
            </div>
            <h3 className="font-semibold text-industrial-text">
              Bind a read-only tenant source
            </h3>
          </div>
        </div>
        {!isAdmin ? (
          <p className="mt-4 rounded-lg border border-industrial-border p-3 text-sm text-slate-400">
            An administrator must create or change endpoint, polling and secret
            bindings. Planning roles can use an already approved source.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <input
                className={inputClass}
                placeholder="Stable connector key"
                value={sourceKey}
                onChange={(event) => setSourceKey(event.target.value)}
              />
              <input
                className={inputClass}
                placeholder="Customer source name"
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
              />
              <select
                className={inputClass}
                value={systemKind}
                onChange={(event) => setSystemKind(event.target.value)}
              >
                <option value="file">CSV fallback</option>
                <option value="cmms">CMMS REST</option>
                <option value="eam">EAM REST</option>
                <option value="erp">ERP REST</option>
                <option value="inventory">Inventory REST</option>
                <option value="data_lake">Data-lake REST</option>
                <option value="scheduling">Production scheduling REST</option>
              </select>
              {systemKind !== "file" && (
                <>
                  <input
                    className={inputClass}
                    placeholder="HTTPS JSON endpoint (no credentials)"
                    value={endpointUrl}
                    onChange={(event) => setEndpointUrl(event.target.value)}
                  />
                  <input
                    className={inputClass}
                    type="number"
                    min="1"
                    placeholder="Polling interval (minutes)"
                    value={intervalMinutes}
                    onChange={(event) => setIntervalMinutes(event.target.value)}
                  />
                  <input
                    className={inputClass}
                    placeholder="Opaque binding, e.g. vault://tenant/cmms"
                    value={credentialRef}
                    onChange={(event) => setCredentialRef(event.target.value)}
                  />
                </>
              )}
            </div>
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Who authorized this source and what is its operational basis? (20+ characters)"
              value={sourceBasis}
              onChange={(event) => setSourceBasis(event.target.value)}
            />
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                className="mt-1"
                type="checkbox"
                checked={sourceEnabled}
                onChange={(event) => setSourceEnabled(event.target.checked)}
              />
              Enable this read-only import source. REST runs still fail closed
              until the deployment host allowlist and opaque secret binding both
              exist.
            </label>
            <button
              type="button"
              disabled={
                working ||
                sourceKey.trim().length < 3 ||
                sourceName.trim().length < 3 ||
                sourceBasis.trim().length < 20 ||
                (systemKind !== "file" &&
                  sourceEnabled &&
                  (endpointUrl.trim().length < 10 ||
                    credentialRef.trim().length < 8 ||
                    Number(intervalMinutes) < 1))
              }
              onClick={() => void execute(configureSource)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Save controlled source
            </button>
          </div>
        )}
        {(readiness?.sources.length ?? 0) > 0 && (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {readiness?.sources.map((source) => (
              <button
                key={source.connector_key}
                type="button"
                onClick={() => setSourceKey(source.connector_key)}
                className={`rounded-lg border p-3 text-left text-sm ${sourceKey === source.connector_key ? "border-teal-500/50 bg-teal-500/10" : "border-industrial-border"}`}
              >
                <span className="font-medium text-slate-200">
                  {source.name}
                </span>
                <span className="block font-mono text-xs text-slate-500">
                  {source.connector_key}
                </span>
                <span className="mt-1 block text-xs text-slate-400">
                  {source.system_kind} · {source.state.replaceAll("_", " ")} ·
                  read-only
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={cardClass}>
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 text-teal-400" />
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Step 2
            </div>
            <h3 className="font-semibold text-industrial-text">
              Map, dry-run, then import
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Load order: sites → assets → work orders/materials → stock/crews →
              operating state/production. Stable source IDs make retries and
              overlapping windows safe.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <select
            className={inputClass}
            value={sourceKey}
            onChange={(event) => setSourceKey(event.target.value)}
          >
            <option value="">Select configured source</option>
            {readiness?.sources.map((source) => (
              <option key={source.connector_key} value={source.connector_key}>
                {source.name}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={entityType}
            onChange={(event) =>
              setEntityType(event.target.value as RecoveryActivationEntity)
            }
          >
            {RECOVERY_ACTIVATION_ENTITIES.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.label}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="REST JSON array path, e.g. result.items"
            value={sourceArrayPath}
            onChange={(event) => setSourceArrayPath(event.target.value)}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">{definition.description}</p>

        <div className="mt-4 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-300">
              <Upload className="h-4 w-4" /> {fileName || "Choose CSV fallback"}
              <input
                className="hidden"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) =>
                  event.target.files?.[0] && void onFile(event.target.files[0])
                }
              />
            </label>
            {headers.length > 0 && (
              <div className="mt-4 space-y-2">
                {definition.fields.map((target) => (
                  <label
                    key={target.key}
                    className="grid gap-2 text-xs text-slate-400 sm:grid-cols-[12rem_1fr] sm:items-center"
                  >
                    <span>
                      {target.label}
                      {target.required ? " *" : ""}
                    </span>
                    <select
                      className={inputClass}
                      value={columnMapping[target.key] ?? ""}
                      onChange={(event) =>
                        setColumnMapping((current) => {
                          const next = { ...current };
                          if (event.target.value)
                            next[target.key] = event.target.value;
                          else delete next[target.key];
                          return next;
                        })
                      }
                    >
                      <option value="">Not mapped</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <textarea
              className={inputClass}
              rows={4}
              aria-label="Vocabulary mappings JSON"
              placeholder='Vocabulary mappings JSON, e.g. {"status":{"REL":"scheduled"}}'
              value={valueMappingsText}
              onChange={(event) => setValueMappingsText(event.target.value)}
            />
            <textarea
              className={inputClass}
              rows={3}
              aria-label="Mapping constants JSON"
              placeholder='Constants JSON, e.g. {"site_external_id":"MINE-1"}'
              value={constantsText}
              onChange={(event) => setConstantsText(event.target.value)}
            />
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Mapping decision and vocabulary basis (20+ characters)"
              value={mappingBasis}
              onChange={(event) => setMappingBasis(event.target.value)}
            />
            {missingRequired.length > 0 && headers.length > 0 && (
              <p className="text-xs text-amber-300">
                Required mappings still missing: {missingRequired.join(", ")}
              </p>
            )}
            {isAdmin && (
              <button
                type="button"
                disabled={
                  working ||
                  !sourceKey ||
                  mappingBasis.trim().length < 20 ||
                  (headers.length > 0 && missingRequired.length > 0)
                }
                onClick={() => void execute(saveMapping)}
                className="inline-flex items-center gap-2 rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-sm text-teal-300 disabled:opacity-40"
              >
                <ShieldCheck className="h-4 w-4" /> Save and approve mapping
              </button>
            )}
            {approvedMapping && (
              <p className="flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Approved mapping active for{" "}
                {definition.label}.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {sourceRows.length > 0 && (
            <>
              <button
                type="button"
                disabled={
                  working ||
                  !approvedMapping ||
                  mappedRows.length === 0 ||
                  missingRequired.length > 0
                }
                onClick={() => void execute(dryRunCsv)}
                className="rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
              >
                Dry-run validation
              </button>
              <button
                type="button"
                disabled={
                  working ||
                  !preview?.dry_run ||
                  preview.rejected > 0 ||
                  preview.read !== mappedRows.length
                }
                onClick={() => void execute(commitCsv)}
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Commit validated CSV
              </button>
            </>
          )}
          {selectedSource && selectedSource.system_kind !== "file" && (
            <>
              <button
                type="button"
                disabled={
                  working ||
                  !approvedMapping ||
                  selectedSource.state === "disabled"
                }
                onClick={() => void execute(() => runRest(true))}
                className="rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
              >
                Dry-run REST pull
              </button>
              <button
                type="button"
                disabled={
                  working ||
                  !approvedMapping ||
                  !preview?.dry_run ||
                  preview.rejected > 0
                }
                onClick={() => void execute(() => runRest(false))}
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Import REST pull
              </button>
            </>
          )}
        </div>
        {preview && (
          <div className="mt-4">
            <Summary result={preview} />
          </div>
        )}
        {(preview?.results ?? []).filter((result) => !result.ok).length > 0 && (
          <div className="mt-3 space-y-1 text-xs text-red-300">
            {(preview?.results ?? [])
              .filter((result) => !result.ok)
              .slice(0, 20)
              .map((result) => (
                <p key={result.row_number}>
                  Row {result.row_number} · {result.external_id ?? "no ID"} ·{" "}
                  {result.reason}
                </p>
              ))}
          </div>
        )}
        {rejects.length > 0 && (
          <div className="mt-3 space-y-1 text-xs text-red-300">
            {rejects.map((reject, index) => (
              <p key={`${reject.external_id}-${index}`}>
                {reject.external_id ?? "no ID"} · {reject.reject_reason}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className={cardClass}>
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 text-teal-400" />
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Step 3
            </div>
            <h3 className="font-semibold text-industrial-text">
              Review freshness, coverage and data quality
            </h3>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {readiness?.domains.map((domain) => (
            <div
              key={domain.key}
              className={`rounded-lg border p-3 ${domain.ready ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-200">
                  {domain.label}
                </span>
                <span
                  className={
                    domain.ready ? "text-emerald-300" : "text-amber-300"
                  }
                >
                  {domain.ready ? "ready" : "missing"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {domain.records} canonical record(s)
                {domain.open_records != null
                  ? ` · ${domain.open_records} open`
                  : ""}
                {domain.stock_records != null
                  ? ` · ${domain.stock_records} stock`
                  : ""}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-industrial-border p-3 text-sm">
            <span className="text-slate-500">Core draft inputs</span>
            <span
              className={`block font-medium ${readiness?.minimum_ready_for_draft ? "text-emerald-300" : "text-amber-300"}`}
            >
              {readiness?.minimum_ready_for_draft ? "present" : "incomplete"}
            </span>
          </div>
          <div className="rounded-lg border border-industrial-border p-3 text-sm">
            <span className="text-slate-500">All planning domains</span>
            <span
              className={`block font-medium ${readiness?.planning_inputs_complete ? "text-emerald-300" : "text-amber-300"}`}
            >
              {readiness?.planning_inputs_complete
                ? "present"
                : "gaps named above"}
            </span>
          </div>
          <div className="rounded-lg border border-industrial-border p-3 text-sm">
            <span className="text-slate-500">Rejected rows · 30d</span>
            <span
              className={`block font-medium ${readiness?.rejects_30d ? "text-red-300" : "text-emerald-300"}`}
            >
              {readiness?.rejects_30d ?? 0}
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {readiness?.note}
        </p>
      </section>

      <section className={cardClass}>
        <div className="flex items-start gap-3">
          <ArrowRight className="mt-0.5 h-5 w-5 text-teal-400" />
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Step 4
            </div>
            <h3 className="font-semibold text-industrial-text">
              Create governed draft plan
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              A human chooses the asset, work scope and counterfactual baseline.
              SyncAI creates a draft only; missing evidence and hard constraints
              still block approval.
            </p>
          </div>
        </div>
        {!canPlan ? (
          <p className="mt-4 rounded-lg border border-industrial-border p-3 text-sm text-slate-400">
            A planning, maintenance-management, reliability-engineering or
            administrator role must create the first draft.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <select
                className={inputClass}
                value={selectedAssetId}
                onChange={(event) => setSelectedAssetId(event.target.value)}
              >
                <option value="">Select asset with open work</option>
                {readiness?.candidates.map((candidate) => (
                  <option key={candidate.asset_id} value={candidate.asset_id}>
                    {candidate.asset} · {candidate.open_work_orders} open
                    {candidate.is_currently_down ? " · down" : ""}
                    {candidate.active_event_id ? " · active event exists" : ""}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
              >
                <option value="unplanned">Unplanned downtime</option>
                <option value="planned">Planned intervention</option>
                <option value="opportunity">Opportunity window</option>
                <option value="major_intervention">Major intervention</option>
              </select>
              <input
                className={inputClass}
                type="datetime-local"
                aria-label="Baseline return time"
                value={baselineReturnAt}
                onChange={(event) => setBaselineReturnAt(event.target.value)}
              />
              <select
                className={inputClass}
                value={baselineMethod}
                onChange={(event) => setBaselineMethod(event.target.value)}
              >
                <option value="original_approved_schedule">
                  Original approved schedule
                </option>
                <option value="historical_median">Historical median</option>
                <option value="control_estimate">Control estimate</option>
                <option value="manual_authorized">Manual authorized</option>
              </select>
            </div>
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Restoration event reason (10+ characters)"
              value={eventReason}
              onChange={(event) => setEventReason(event.target.value)}
            />
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Defensible baseline source and basis (20+ characters)"
              value={baselineBasis}
              onChange={(event) => setBaselineBasis(event.target.value)}
            />
            {workOrders.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Human-selected mandatory scope
                </p>
                {workOrders.map((work) => (
                  <label
                    key={work.id}
                    className="flex items-start gap-3 rounded-lg border border-industrial-border p-3 text-sm"
                  >
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={selectedWork.has(work.id)}
                      onChange={(event) =>
                        setSelectedWork((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(work.id);
                          else next.delete(work.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <span className="text-slate-200">
                        {work.wo_number ?? "WO"} · {work.title}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {work.priority ?? "priority unknown"} ·{" "}
                        {work.planned_hours ??
                          work.estimated_hours ??
                          "duration missing"}
                        {typeof (work.planned_hours ?? work.estimated_hours) ===
                        "number"
                          ? " h"
                          : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={
                working ||
                !readiness?.minimum_ready_for_draft ||
                !selectedAssetId ||
                selectedWork.size === 0 ||
                eventReason.trim().length < 10 ||
                !baselineReturnAt ||
                baselineBasis.trim().length < 20 ||
                Boolean(
                  readiness?.candidates.find(
                    (candidate) => candidate.asset_id === selectedAssetId,
                  )?.active_event_id,
                )
              }
              onClick={() => void execute(createPlan)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              <ShieldCheck className="h-4 w-4" /> Create governed draft plan
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
