import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  getRepairableUnitRegister,
  recordRepairableUnitEvent,
  registerRepairableUnit,
  type RepairableUnit,
  type RepairableUnitEventType,
  type RepairableUnitRegisterPayload,
  type RepairableUnitState,
} from "../services/repairableMaterialsService";

type LifecycleEvent = Exclude<RepairableUnitEventType, "registered">;

const eventLabels: Record<LifecycleEvent, string> = {
  installed: "Install on asset",
  removed: "Remove from asset",
  sent_for_repair: "Send for repair",
  received_from_repair: "Receive from repair",
  quarantined: "Quarantine",
  released_from_quarantine: "Release from quarantine",
  scrapped: "Scrap",
};

const allowedEvents: Record<RepairableUnitState, LifecycleEvent[]> = {
  available: ["installed", "quarantined", "scrapped"],
  installed: ["removed"],
  removed: ["sent_for_repair", "quarantined", "scrapped"],
  in_repair: ["received_from_repair", "quarantined", "scrapped"],
  quarantined: ["released_from_quarantine", "scrapped"],
  scrapped: [],
};

function localNow() {
  const current = new Date();
  const local = new Date(
    current.getTime() - current.getTimezoneOffset() * 60_000,
  );
  return local.toISOString().slice(0, 16);
}

function optionalNumber(values: FormData, name: string): number | null {
  const raw = String(values.get(name) ?? "").trim();
  return raw === "" ? null : Number(raw);
}

function stateLabel(value: RepairableUnitState) {
  return value.replaceAll("_", " ");
}

export function RepairableUnitRegister({
  refreshVersion = 0,
}: {
  refreshVersion?: number;
}) {
  const [register, setRegister] =
    useState<RepairableUnitRegisterPayload | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<LifecycleEvent | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getRepairableUnitRegister();
      setRegister(payload);
      setSelectedUnitId((current) =>
        current && payload.units.some((unit) => unit.id === current)
          ? current
          : null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Serialized repairable evidence could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshVersion]);

  const selectedUnit = useMemo(
    () => register?.units.find((unit) => unit.id === selectedUnitId) ?? null,
    [register, selectedUnitId],
  );

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await registerRepairableUnit({
        materialId: String(values.get("materialId") ?? ""),
        serialNumber: String(values.get("serialNumber") ?? ""),
        sourceSystem: String(values.get("sourceSystem") ?? ""),
        sourceRef: String(values.get("sourceRef") ?? ""),
        basis: String(values.get("basis") ?? ""),
      });
      setNotice(
        `Serialized unit registered as available at version ${result.version}; no stock receipt or installation was inferred.`,
      );
      setFormVersion((value) => value + 1);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unit could not be registered.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUnit || !selectedEvent) return;
    const values = new FormData(event.currentTarget);
    const occurredAt = new Date(
      String(values.get("occurredAt") ?? ""),
    ).toISOString();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recordRepairableUnitEvent({
        repairableUnitId: selectedUnit.id,
        eventType: selectedEvent,
        occurredAt,
        basis: String(values.get("eventBasis") ?? ""),
        expectedVersion: selectedUnit.version,
        sourceSystem: String(values.get("eventSource") ?? ""),
        assetId: String(values.get("assetId") ?? "") || null,
        component: String(values.get("component") ?? "") || null,
        position: String(values.get("position") ?? "") || null,
        meterHours: optionalNumber(values, "meterHours"),
        workOrderId: String(values.get("workOrderId") ?? "") || null,
        supplierId: optionalNumber(values, "supplierId"),
        repairCostUsd: optionalNumber(values, "repairCostUsd"),
        repairOrderRef: String(values.get("repairOrderRef") ?? "") || null,
        evidenceRef: String(values.get("evidenceRef") ?? "") || null,
      });
      setNotice(
        `${eventLabels[selectedEvent]} recorded at sequence ${result.sequence}; current state is ${stateLabel(result.currentState)}.`,
      );
      setSelectedUnitId(null);
      setSelectedEvent(null);
      setFormVersion((value) => value + 1);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Lifecycle event could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  function chooseUnit(unit: RepairableUnit) {
    const events = allowedEvents[unit.currentState];
    setSelectedUnitId(unit.id);
    setSelectedEvent(events[0] ?? null);
    setError(null);
    setNotice(null);
    setFormVersion((value) => value + 1);
  }

  return (
    <section
      aria-labelledby="repairable-register-title"
      className="space-y-5 rounded-xl border border-slate-700 bg-slate-900 p-5"
    >
      <div>
        <h2
          id="repairable-register-title"
          className="text-lg font-semibold text-white"
        >
          Serialized repairables
        </h2>
        <p className="text-sm text-slate-400">
          Follow one repairable or rotable identity through installation,
          removal, vendor repair, return, quarantine and retirement. Events are
          append-only evidence; they do not receive stock, release work or
          accept a repair.
        </p>
      </div>

      <form
        key={`register-${formVersion}`}
        onSubmit={submitRegistration}
        className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4"
      >
        <h3 className="font-medium text-slate-100">Register serialized unit</h3>
        <fieldset
          disabled={busy}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="text-sm text-slate-300 sm:col-span-2">
            Repairable material
            <select
              name="materialId"
              required
              defaultValue=""
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            >
              <option value="" disabled>
                Select a classified material
              </option>
              {(register?.materials ?? []).map((material) => (
                <option key={material.id} value={material.id}>
                  {material.materialCode} · {material.description} ·{" "}
                  {material.classification}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Serial number
            <input
              name="serialNumber"
              required
              maxLength={200}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Source system
            <input
              name="sourceSystem"
              required
              defaultValue="customer_component_register"
              maxLength={160}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Source reference
            <input
              name="sourceRef"
              maxLength={500}
              placeholder="Register, document or transaction ID"
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300 sm:col-span-2 lg:col-span-3">
            Registration basis
            <textarea
              name="basis"
              required
              minLength={20}
              maxLength={8000}
              rows={2}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
        </fieldset>
        <button
          type="submit"
          disabled={busy || !(register?.materials.length ?? 0)}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Recording…" : "Register unit"}
        </button>
      </form>

      {selectedUnit && selectedEvent && (
        <form
          key={`event-${selectedUnit.id}-${selectedEvent}-${formVersion}`}
          onSubmit={submitEvent}
          className="space-y-3 rounded-lg border border-sky-800/70 bg-sky-950/20 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-slate-100">
              Record event · {selectedUnit.materialCode} /{" "}
              {selectedUnit.serialNumber}
            </h3>
            <button
              type="button"
              onClick={() => {
                setSelectedUnitId(null);
                setSelectedEvent(null);
              }}
              className="text-sm text-sky-300"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Current state: {stateLabel(selectedUnit.currentState)} · expected
            version {selectedUnit.version}. A concurrent change will refuse this
            event.
          </p>
          <fieldset
            disabled={busy}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label className="text-sm text-slate-300">
              Event
              <select
                name="eventType"
                value={selectedEvent}
                onChange={(event) =>
                  setSelectedEvent(event.target.value as LifecycleEvent)
                }
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
              >
                {allowedEvents[selectedUnit.currentState].map((event) => (
                  <option key={event} value={event}>
                    {eventLabels[event]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              Occurred at
              <input
                name="occurredAt"
                type="datetime-local"
                required
                defaultValue={localNow()}
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
              />
            </label>
            <label className="text-sm text-slate-300">
              Evidence source
              <input
                name="eventSource"
                required
                defaultValue="maintenance_record"
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
              />
            </label>
            <label className="text-sm text-slate-300">
              Meter hours
              <input
                name="meterHours"
                type="number"
                min="0"
                step="any"
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
              />
            </label>

            {selectedEvent === "installed" && (
              <>
                <label className="text-sm text-slate-300 sm:col-span-2">
                  Asset
                  <select
                    name="assetId"
                    required
                    defaultValue=""
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
                  >
                    <option value="" disabled>
                      Select tenant asset
                    </option>
                    {(register?.assets ?? []).map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.tag ? `${asset.tag} · ` : ""}
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Component
                  <input
                    name="component"
                    required
                    placeholder="Final drive"
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
                  />
                </label>
                <label className="text-sm text-slate-300">
                  Position
                  <input
                    name="position"
                    required
                    placeholder="Left rear"
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
                  />
                </label>
              </>
            )}

            {(selectedEvent === "sent_for_repair" ||
              selectedEvent === "received_from_repair") && (
              <>
                <label className="text-sm text-slate-300 sm:col-span-2">
                  Repair supplier
                  <select
                    name="supplierId"
                    required={selectedEvent === "sent_for_repair"}
                    defaultValue=""
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
                  >
                    <option value="">
                      {selectedEvent === "sent_for_repair"
                        ? "Select repair supplier"
                        : "Not repeated on receipt"}
                    </option>
                    {(register?.suppliers ?? []).map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.code} · {supplier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Repair order reference
                  <input
                    name="repairOrderRef"
                    required={selectedEvent === "sent_for_repair"}
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
                  />
                </label>
                <label className="text-sm text-slate-300">
                  Repair cost USD
                  <input
                    name="repairCostUsd"
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
                  />
                </label>
              </>
            )}

            <label className="text-sm text-slate-300 sm:col-span-2">
              Evidence reference
              <input
                name="evidenceRef"
                required={selectedEvent === "received_from_repair"}
                placeholder="Inspection, repair report or transaction ID"
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
              />
            </label>
            <label className="text-sm text-slate-300 sm:col-span-2">
              Work order ID (optional)
              <input
                name="workOrderId"
                placeholder="Tenant work-order UUID"
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
              />
            </label>
            <label className="text-sm text-slate-300 sm:col-span-2 lg:col-span-4">
              Event basis
              <textarea
                name="eventBasis"
                required
                minLength={20}
                maxLength={8000}
                rows={2}
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
              />
            </label>
          </fieldset>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Recording…" : `Record ${eventLabels[selectedEvent]}`}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-300">
          {notice}
        </p>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-200">Unit histories</h3>
          <span className="text-xs text-slate-500">
            {loading
              ? "Loading…"
              : `${register?.units.length ?? 0} serialized identities`}
          </span>
        </div>
        {!loading && !(register?.units.length ?? 0) ? (
          <p className="rounded border border-dashed border-slate-700 p-4 text-sm text-slate-400">
            No serialized repairable history is recorded. Turnaround and repair
            yield remain unknown.
          </p>
        ) : (
          register?.units.map((unit) => (
            <article
              key={unit.id}
              className="rounded-lg border border-slate-800 bg-slate-950/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-white">
                    {unit.materialCode} · {unit.serialNumber}
                  </div>
                  <div className="text-xs text-slate-500">
                    {unit.classification} · {unit.description}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-slate-600 px-2 py-1 text-xs capitalize text-slate-200">
                    {stateLabel(unit.currentState)}
                  </span>
                  {allowedEvents[unit.currentState].length > 0 && (
                    <button
                      type="button"
                      onClick={() => chooseUnit(unit)}
                      className="rounded border border-sky-700 px-3 py-1 text-xs text-sky-300"
                    >
                      Record event
                    </button>
                  )}
                </div>
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Current installation</dt>
                  <dd className="text-slate-300">
                    {unit.currentAsset
                      ? `${unit.currentAsset} · ${unit.currentComponent} / ${unit.currentPosition}`
                      : "Not installed"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Repair turnaround</dt>
                  <dd className="text-slate-300">
                    {unit.repairTurnaroundHours == null
                      ? "Not measurable"
                      : `${unit.repairTurnaroundHours} hours`}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Evidence version</dt>
                  <dd className="text-slate-300">
                    v{unit.version} · {unit.sourceSystem}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-slate-500">
                {unit.turnaroundBasis}
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-sky-300">
                  Evidence history ({unit.events.length})
                </summary>
                <ol className="mt-3 space-y-2 border-l border-slate-700 pl-4">
                  {unit.events.map((history) => (
                    <li key={history.id} className="text-xs text-slate-400">
                      <div className="font-medium text-slate-200">
                        #{history.sequence} ·{" "}
                        {eventLabels[history.eventType as LifecycleEvent] ??
                          "Registered"}
                      </div>
                      <div>
                        {new Date(history.occurredAt).toLocaleString()} ·{" "}
                        {history.fromState
                          ? `${stateLabel(history.fromState)} → `
                          : ""}
                        {stateLabel(history.toState)}
                      </div>
                      <div>{history.basis}</div>
                      {history.evidenceRef && (
                        <div>Evidence: {history.evidenceRef}</div>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            </article>
          ))
        )}
      </div>
      <p className="text-xs text-slate-500">
        {register?.authority ??
          "Human evidence recording only; operational authority remains separate."}
      </p>
    </section>
  );
}
