import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Network, ShieldCheck, UsersRound } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { normaliseRate } from "../lib/asset-ontology";
import {
  listAssetPopulations,
  listPopulationEvidence,
  listPopulationFailureEvents,
  listPopulationObservationPeriods,
  listPopulationSites,
  recordAssetPopulation,
  recordPopulationFailureEvent,
  recordPopulationObservationPeriod,
} from "../services/assetOntologyService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

type Mode = "population" | "exposure" | "failure";
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function PopulationGovernancePanel({
  revision,
  onRecorded,
}: {
  revision: number;
  onRecorded: () => void;
}) {
  const sites = useAsyncData(listPopulationSites, [revision]);
  const populations = useAsyncData(listAssetPopulations, [revision]);
  const evidence = useAsyncData(listPopulationEvidence, [revision]);
  const [mode, setMode] = useState<Mode>("population");
  const [populationId, setPopulationId] = useState("");
  const [evidenceItemId, setEvidenceItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [siteId, setSiteId] = useState("");
  const [populationCode, setPopulationCode] = useState("");
  const [description, setDescription] = useState("");
  const [unitCount, setUnitCount] = useState("");
  const [membersTracked, setMembersTracked] = useState(false);
  const [installStart, setInstallStart] = useState("");
  const [installEnd, setInstallEnd] = useState("");
  const [populationBasis, setPopulationBasis] = useState("");

  const [observedFrom, setObservedFrom] = useState("");
  const [observedTo, setObservedTo] = useState("");
  const [unitsExposed, setUnitsExposed] = useState("");
  const [exposureBasis, setExposureBasis] = useState("");

  const [observationPeriodId, setObservationPeriodId] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [failureCount, setFailureCount] = useState("1");
  const [failureMode, setFailureMode] = useState("");
  const [failureNote, setFailureNote] = useState("");

  const selectedPopulation = (populations.data ?? []).find(
    (population) => String(population.id) === populationId,
  );
  const periods = useAsyncData(
    () =>
      selectedPopulation
        ? listPopulationObservationPeriods(selectedPopulation.id)
        : Promise.resolve([]),
    [selectedPopulation?.id, revision],
  );
  const failures = useAsyncData(
    () =>
      selectedPopulation
        ? listPopulationFailureEvents(selectedPopulation.id)
        : Promise.resolve([]),
    [selectedPopulation?.id, revision],
  );

  const rate = useMemo(() => {
    const recordedPeriods = periods.data ?? [];
    const periodIds = new Set(recordedPeriods.map((period) => period.id));
    const unitYears = recordedPeriods.reduce((total, period) => {
      const duration =
        new Date(period.observed_to).getTime() -
        new Date(period.observed_from).getTime();
      return total + (period.units_exposed * duration) / YEAR_MS;
    }, 0);
    const governedFailures = (failures.data ?? [])
      .filter(
        (event) =>
          event.observation_period_id !== null &&
          periodIds.has(event.observation_period_id),
      )
      .reduce((total, event) => total + event.failure_count, 0);
    const excludedEvents = (failures.data ?? []).filter(
      (event) =>
        event.observation_period_id === null ||
        !periodIds.has(event.observation_period_id),
    ).length;
    return {
      result: normaliseRate(
        "population",
        governedFailures,
        unitYears,
        "unit-year",
      ),
      governedFailures,
      unitYears,
      excludedEvents,
    };
  }, [failures.data, periods.data]);

  useEffect(() => {
    setEvidenceItemId("");
    setMessage(null);
    setObservationPeriodId("");
  }, [mode, populationId]);

  if (sites.loading || populations.loading || evidence.loading) {
    return <LoadingState label="Loading governed asset populations" />;
  }
  if (sites.error) return <ErrorState message={sites.error} onRetry={sites.refetch} />;
  if (populations.error)
    return <ErrorState message={populations.error} onRetry={populations.refetch} />;
  if (evidence.error)
    return <ErrorState message={evidence.error} onRetry={evidence.refetch} />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "population") {
        await recordAssetPopulation({
          siteId: siteId || null,
          populationCode,
          description,
          unitCount: Number(unitCount),
          membersIndividuallyTracked: membersTracked,
          installPeriodStart: installStart || null,
          installPeriodEnd: installEnd || null,
          basis: populationBasis,
          evidenceItemId,
        });
        setMessage(
          "Population identity recorded. Exposure and failures remain separate evidence-backed records.",
        );
        setPopulationCode("");
        setDescription("");
        setUnitCount("");
        setPopulationBasis("");
      } else if (mode === "exposure") {
        await recordPopulationObservationPeriod({
          populationId: Number(populationId),
          observedFrom,
          observedTo,
          unitsExposed: Number(unitsExposed),
          basis: exposureBasis,
          evidenceItemId,
        });
        setMessage(
          "Unit-time exposure recorded, including zero-failure time without inventing events.",
        );
        setObservedFrom("");
        setObservedTo("");
        setUnitsExposed("");
        setExposureBasis("");
      } else {
        await recordPopulationFailureEvent({
          populationId: Number(populationId),
          observationPeriodId: Number(observationPeriodId),
          occurredAt,
          failureCount: Number(failureCount),
          failureMode,
          note: failureNote,
          evidenceItemId,
        });
        setMessage(
          "Aggregate failure observation recorded without inventing individual member identity or causal attribution.",
        );
        setOccurredAt("");
        setFailureCount("1");
        setFailureMode("");
        setFailureNote("");
      }
      await Promise.all([
        populations.refetch(),
        periods.refetch(),
        failures.refetch(),
      ]);
      onRecorded();
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not record population evidence",
      );
    } finally {
      setBusy(false);
    }
  }

  const needsPopulation = mode !== "population";

  return (
    <section
      className="rounded-2xl border border-violet-400/15 bg-violet-400/4 p-5"
      aria-labelledby="population-governance-heading"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-violet-400/10 p-2 text-violet-300">
          <Network className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3
            id="population-governance-heading"
            className="text-sm font-semibold text-white"
          >
            Governed distributed-network populations
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            Model meters, poles, sensors and other fleets as populations when
            individual identity does not exist. Rates use verified unit-time
            exposure—including zero-failure periods—not today’s unit count.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist">
        {(
          [
            ["population", "Create population"],
            ["exposure", "Record exposure"],
            ["failure", "Record failure"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
              mode === value
                ? "border-violet-300/40 bg-violet-300/10 text-violet-100"
                : "border-white/10 text-slate-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {message ? (
        <p className="mt-4 rounded-lg border border-violet-400/20 bg-violet-400/5 p-3 text-xs text-slate-200">
          {message}
        </p>
      ) : null}

      <form className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.8fr]" onSubmit={submit}>
        <div className="space-y-3">
          {needsPopulation ? (
            <label className="block text-xs font-semibold text-slate-300">
              Canonical population
              <select
                required
                value={populationId}
                onChange={(event) => setPopulationId(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
              >
                <option value="">Select a population</option>
                {(populations.data ?? []).map((population) => (
                  <option key={population.id} value={population.id}>
                    {population.population_code} · {population.unit_count} units
                    {population.members_individually_tracked
                      ? " · tracked"
                      : " · aggregate"}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="block text-xs font-semibold text-slate-300">
                Site (optional)
                <select
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                >
                  <option value="">Enterprise-wide or site not assigned</option>
                  {(sites.data ?? []).map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
              <TextInput
                label="Population code"
                value={populationCode}
                onChange={setPopulationCode}
                minLength={3}
                placeholder="POLES-NORTH-01"
              />
              <TextInput
                label="Population description"
                value={description}
                onChange={setDescription}
                minLength={10}
                placeholder="North distribution pole-top transformer population"
              />
              <NumberInput
                label="Current recorded unit count"
                value={unitCount}
                onChange={setUnitCount}
                step="1"
              />
              <label className="flex items-center gap-2 rounded-lg border border-white/8 p-3 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={membersTracked}
                  onChange={(event) => setMembersTracked(event.target.checked)}
                />
                Every member has an individual canonical identity
              </label>
              <div className="grid grid-cols-2 gap-3">
                <DateInput
                  label="Install period start"
                  value={installStart}
                  onChange={setInstallStart}
                />
                <DateInput
                  label="Install period end"
                  value={installEnd}
                  onChange={setInstallEnd}
                />
              </div>
              <TextArea
                label="Population basis and limitations"
                value={populationBasis}
                onChange={setPopulationBasis}
                placeholder="Name the asset register or survey and disclose untracked, estimated or changing membership."
              />
            </>
          )}

          {mode === "exposure" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <DateTimeInput
                  label="Observed from"
                  value={observedFrom}
                  onChange={setObservedFrom}
                />
                <DateTimeInput
                  label="Observed to"
                  value={observedTo}
                  onChange={setObservedTo}
                />
              </div>
              <NumberInput
                label="Units exposed during the period"
                value={unitsExposed}
                onChange={setUnitsExposed}
                step="any"
              />
              <TextArea
                label="Exposure basis and limitations"
                value={exposureBasis}
                onChange={setExposureBasis}
                placeholder="Name the period source and explain outages, additions, removals or sampling limitations."
              />
            </>
          ) : null}

          {mode === "failure" ? (
            <>
              <label className="block text-xs font-semibold text-slate-300">
                Observation period
                <select
                  required
                  value={observationPeriodId}
                  onChange={(event) =>
                    setObservationPeriodId(event.target.value)
                  }
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                >
                  <option value="">Select the denominator window</option>
                  {(periods.data ?? []).map((period) => (
                    <option key={period.id} value={period.id}>
                      {new Date(period.observed_from).toLocaleDateString()}–
                      {new Date(period.observed_to).toLocaleDateString()} · {period.units_exposed} units
                    </option>
                  ))}
                </select>
              </label>
              <DateTimeInput
                label="Failure occurred at"
                value={occurredAt}
                onChange={setOccurredAt}
              />
              <NumberInput
                label="Aggregate failure count"
                value={failureCount}
                onChange={setFailureCount}
                step="1"
              />
              <TextInput
                label="Observed failure mode"
                value={failureMode}
                onChange={setFailureMode}
                minLength={3}
                placeholder="Loss of supply"
              />
              <TextArea
                label="Observation and limitations"
                value={failureNote}
                onChange={setFailureNote}
                placeholder="State what was counted, how duplicates were handled and what member identity is unavailable."
              />
            </>
          ) : null}
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-300">
            Verified population evidence
            <select
              required
              value={evidenceItemId}
              onChange={(event) => setEvidenceItemId(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
            >
              <option value="">Select non-asset-specific evidence</option>
              {(evidence.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.evidence_class ?? "UNCLASSIFIED"} · {item.description}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-white">
              <UsersRound className="h-4 w-4 text-violet-300" aria-hidden />
              Population event rate
            </h4>
            {selectedPopulation ? (
              <>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  {rate.result.reason}
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  {rate.governedFailures} governed failure(s) · {rate.unitYears.toFixed(4)} unit-years · 365.25-day calendar-year conversion
                </p>
                {rate.excludedEvents > 0 ? (
                  <p className="mt-2 text-xs text-amber-200">
                    {rate.excludedEvents} legacy event record(s) excluded because
                    no governed exposure period is linked.
                  </p>
                ) : null}
                {!selectedPopulation.members_individually_tracked ? (
                  <p className="mt-2 text-xs text-violet-100">
                    Individual-asset MTBF is not available because members are
                    not individually identified.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Select a population to evaluate recorded failures against
                verified unit-year exposure.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs leading-relaxed text-slate-300">
            Population records do not invent individual member identity, infer
            cause, establish condition, create work, recommend replacement or
            approve action. Current unit count is never substituted for elapsed
            unit-time exposure.
          </div>

          <button
            type="submit"
            disabled={
              busy ||
              !evidenceItemId ||
              (needsPopulation && !selectedPopulation)
            }
            className="inline-flex items-center gap-2 rounded-lg bg-violet-400 px-4 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {busy
              ? "Recording…"
              : mode === "population"
                ? "Record governed population"
                : mode === "exposure"
                  ? "Record unit-time exposure"
                  : "Record aggregate failure"}
          </button>
        </div>
      </form>
    </section>
  );
}

function TextInput({
  label,
  value,
  onChange,
  minLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minLength: number;
  placeholder: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        required
        minLength={minLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        required
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function DateTimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        required
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <textarea
        required
        minLength={20}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 min-h-24 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
      />
    </label>
  );
}
