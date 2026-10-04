import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Leaf,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getEnterpriseHseWorkspace,
  recordHseEvent,
  recordHseReportingSource,
  verifyHseEvent,
  type HseEventDomain,
  type HseMetricDomain,
} from "../services/enterpriseHseEventsService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20";
const labelClass = "space-y-1 text-xs font-medium text-slate-300";

function MetricCard({
  title,
  icon,
  metric,
}: {
  title: string;
  icon: ReactNode;
  metric: HseMetricDomain;
}) {
  return (
    <article className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          {icon}
          {title}
        </h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            metric.reportingCoverageComplete
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : "border-amber-400/30 bg-amber-400/10 text-amber-200"
          }`}
        >
          {metric.reportingCoverageComplete
            ? "Reporting covered"
            : "Coverage required"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-2xl font-semibold tabular-nums text-white">
            {metric.actualEvents ?? "—"}
          </p>
          <p className="text-xs text-slate-400">Actual events</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums text-white">
            {metric.nearMisses ?? "—"}
          </p>
          <p className="text-xs text-slate-400">Near misses</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums text-white">
            {metric.independentlyVerified}
          </p>
          <p className="text-xs text-slate-400">Verified</p>
        </div>
        <div>
          <p
            className={`text-2xl font-semibold tabular-nums ${
              metric.pendingClassification > 0 ? "text-amber-300" : "text-white"
            }`}
          >
            {metric.pendingClassification}
          </p>
          <p className="text-xs text-slate-400">Pending classification</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-400">
        {metric.basis}
      </p>
    </article>
  );
}

export function EnterpriseHseEvents() {
  const { data, loading, error, refetch } = useAsyncData(
    () => getEnterpriseHseWorkspace(30),
    [],
  );
  const [panel, setPanel] = useState<"event" | "source" | "verify" | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [eventDomain, setEventDomain] = useState<HseEventDomain>(
    "occupational_safety",
  );

  const pendingEvents = useMemo(
    () => data?.events.filter((event) => !event.verifiedAt) ?? [],
    [data],
  );

  async function runAction(action: () => Promise<unknown>, success: string) {
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      setPanel(null);
      await refetch();
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "The governed action failed.",
      );
    } finally {
      setSaving(false);
    }
  }

  function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const eventType = String(form.get("eventType"));
    void runAction(
      () =>
        recordHseEvent({
          eventRef: String(form.get("eventRef")),
          expectedVersion: 0,
          status: "active",
          domain: eventDomain,
          eventType: eventType as Parameters<
            typeof recordHseEvent
          >[0]["eventType"],
          actuality: String(form.get("actuality")) as "actual" | "near_miss",
          occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
          siteId: String(form.get("siteId") || "") || null,
          assetId: String(form.get("assetId") || "") || null,
          containmentLossId: form.get("containmentLossId")
            ? Number(form.get("containmentLossId"))
            : null,
          recordability: String(form.get("recordability")) as Parameters<
            typeof recordHseEvent
          >[0]["recordability"],
          regulatoryReportability: String(
            form.get("regulatoryReportability"),
          ) as Parameters<typeof recordHseEvent>[0]["regulatoryReportability"],
          severityLabel: String(form.get("severityLabel") || "") || null,
          severityScaleReference:
            String(form.get("severityScaleReference") || "") || null,
          description: String(form.get("description")),
          sourceReference: String(form.get("sourceReference")),
          basis: String(form.get("basis")),
        }),
      "Event recorded as an immutable, human-classified version.",
    );
  }

  function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scope = String(form.get("scope")) as "enterprise" | "site";
    const sourceKind = String(form.get("sourceKind")) as
      "manual_register" | "external_system" | "hybrid";
    void runAction(
      () =>
        recordHseReportingSource({
          sourceRef: String(form.get("sourceRef")),
          expectedVersion: 0,
          domain: String(form.get("domain")) as Parameters<
            typeof recordHseReportingSource
          >[0]["domain"],
          scope,
          siteId: scope === "site" ? String(form.get("siteId") || "") : null,
          sourceName: String(form.get("sourceName")),
          sourceKind,
          connectorId:
            sourceKind === "manual_register"
              ? null
              : String(form.get("connectorId") || ""),
          status: "active",
          coverageStart: new Date(
            String(form.get("coverageStart")),
          ).toISOString(),
          sourceReference: String(form.get("sourceReference")),
          evidenceItemId: String(form.get("evidenceItemId")),
          basis: String(form.get("basis")),
        }),
      "Reporting source attested. Coverage will now be evaluated from its evidence and dates.",
    );
  }

  function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runAction(
      () =>
        verifyHseEvent(
          String(form.get("eventId")),
          String(form.get("evidenceItemId")),
          String(form.get("note")),
        ),
      "Event classification independently verified.",
    );
  }

  if (loading) return <LoadingState label="Loading enterprise HSE truth" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const eventTypes =
    eventDomain === "occupational_safety"
      ? [
          "injury",
          "occupational_illness",
          "exposure",
          "unsafe_condition",
          "other",
        ]
      : [
          "spill_release",
          "permit_exceedance",
          "water_nonconformance",
          "waste_nonconformance",
          "wildlife_impact",
          "other",
        ];

  return (
    <section aria-labelledby="hse-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="hse-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <ShieldCheck className="h-5 w-5 text-cyan-300" aria-hidden />
            Enterprise safety &amp; environmental events
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            Governed event truth for the last 30 days. Safety events and
            Environmental events remain separate; linked containment losses are
            counted once.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            A zero is shown only for an attested source covering the reporting
            window. Missing coverage stays unknown.
          </p>
        </div>
        {data.canRecord && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPanel(panel === "event" ? null : "event")}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-400/15"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Record event
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "source" ? null : "source")}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              <Database className="h-3.5 w-3.5" aria-hidden /> Attest reporting
              source
            </button>
            <button
              type="button"
              disabled={pendingEvents.length === 0}
              onClick={() => setPanel(panel === "verify" ? null : "verify")}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Verify event
              evidence
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
          {notice}
        </div>
      )}
      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {actionError}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <MetricCard
          title="Safety events"
          icon={<ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden />}
          metric={data.metrics.safety}
        />
        <MetricCard
          title="Environmental events"
          icon={<Leaf className="h-4 w-4 text-emerald-300" aria-hidden />}
          metric={data.metrics.environmental}
        />
      </div>

      {panel === "event" && (
        <form
          onSubmit={submitEvent}
          className="grid gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 md:grid-cols-2"
        >
          <h3 className="md:col-span-2 text-sm font-semibold text-white">
            Record a governed event
          </h3>
          <label className={labelClass}>
            Stable event reference
            <input
              name="eventRef"
              required
              minLength={3}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Occurred at
            <input
              name="occurredAt"
              type="datetime-local"
              required
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Domain
            <select
              name="domain"
              value={eventDomain}
              onChange={(event) =>
                setEventDomain(event.target.value as HseEventDomain)
              }
              className={inputClass}
            >
              <option value="occupational_safety">Occupational safety</option>
              <option value="environmental">Environmental</option>
            </select>
          </label>
          <label className={labelClass}>
            Event type
            <select name="eventType" className={inputClass}>
              {eventTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Actuality
            <select name="actuality" className={inputClass}>
              <option value="actual">Actual event</option>
              <option value="near_miss">Near miss</option>
            </select>
          </label>
          <label className={labelClass}>
            Site (optional)
            <select name="siteId" className={inputClass}>
              <option value="">Not assigned</option>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Asset (optional)
            <select name="assetId" className={inputClass}>
              <option value="">Not assigned</option>
              {data.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.tag || asset.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Recordability
            <select name="recordability" className={inputClass}>
              <option value="pending_determination">
                Pending determination
              </option>
              <option value="recordable">Recordable</option>
              <option value="not_recordable">Not recordable</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </label>
          <label className={labelClass}>
            Regulatory reportability
            <select name="regulatoryReportability" className={inputClass}>
              <option value="pending_determination">
                Pending determination
              </option>
              <option value="reportable">Reportable</option>
              <option value="not_reportable">Not reportable</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </label>
          {eventDomain === "environmental" && (
            <label className={labelClass}>
              Canonical containment loss (optional)
              <select name="containmentLossId" className={inputClass}>
                <option value="">Not linked</option>
                {data.containmentLosses.map((loss) => (
                  <option key={loss.id} value={loss.id}>
                    #{loss.id} · {loss.substance || "substance not named"} ·{" "}
                    {loss.tier.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={labelClass}>
            Severity label (optional)
            <input name="severityLabel" className={inputClass} />
          </label>
          <label className={labelClass}>
            Severity scale reference (required with label)
            <input name="severityScaleReference" className={inputClass} />
          </label>
          <label className={`${labelClass} md:col-span-2`}>
            Description
            <textarea
              name="description"
              required
              minLength={20}
              rows={3}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Source reference
            <input
              name="sourceReference"
              required
              minLength={2}
              className={inputClass}
            />
          </label>
          <label className={`${labelClass} md:col-span-2`}>
            Human classification basis
            <textarea
              name="basis"
              required
              minLength={20}
              rows={3}
              className={inputClass}
            />
          </label>
          <button
            disabled={saving}
            className="w-fit rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {saving ? "Recording…" : "Record immutable event"}
          </button>
        </form>
      )}

      {panel === "source" && (
        <form
          onSubmit={submitSource}
          className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 md:grid-cols-2"
        >
          <h3 className="md:col-span-2 text-sm font-semibold text-white">
            Attest reporting source
          </h3>
          <label className={labelClass}>
            Stable source reference
            <input
              name="sourceRef"
              required
              minLength={3}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Source name
            <input name="sourceName" required className={inputClass} />
          </label>
          <label className={labelClass}>
            Domain
            <select name="domain" className={inputClass}>
              <option value="occupational_safety">Occupational safety</option>
              <option value="process_safety">Process safety</option>
              <option value="environmental">Environmental</option>
            </select>
          </label>
          <label className={labelClass}>
            Scope
            <select name="scope" className={inputClass}>
              <option value="enterprise">Enterprise</option>
              <option value="site">Site</option>
            </select>
          </label>
          <label className={labelClass}>
            Site (required for site scope)
            <select name="siteId" className={inputClass}>
              <option value="">Select site</option>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Source kind
            <select name="sourceKind" className={inputClass}>
              <option value="manual_register">Manual register</option>
              <option value="external_system">External system</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label className={labelClass}>
            Connector (external/hybrid)
            <select name="connectorId" className={inputClass}>
              <option value="">Select connector</option>
              {data.connectors.map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Coverage starts
            <input
              name="coverageStart"
              type="datetime-local"
              required
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Verified coverage evidence
            <select name="evidenceItemId" required className={inputClass}>
              <option value="">Select evidence</option>
              {data.verifiedEvidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description || item.sourceSystem || item.id}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Evidence source reference
            <input
              name="sourceReference"
              required
              minLength={2}
              className={inputClass}
            />
          </label>
          <label className={`${labelClass} md:col-span-2`}>
            Attestation basis
            <textarea
              name="basis"
              required
              minLength={20}
              rows={3}
              className={inputClass}
            />
          </label>
          <button
            disabled={saving}
            className="w-fit rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {saving ? "Attesting…" : "Attest source coverage"}
          </button>
        </form>
      )}

      {panel === "verify" && (
        <form
          onSubmit={submitVerification}
          className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 md:grid-cols-2"
        >
          <h3 className="md:col-span-2 text-sm font-semibold text-white">
            Verify event evidence
          </h3>
          <label className={labelClass}>
            Unverified event
            <select name="eventId" required className={inputClass}>
              <option value="">Select event</option>
              {pendingEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.eventRef} · {event.eventType.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Independent verified evidence
            <select name="evidenceItemId" required className={inputClass}>
              <option value="">Select evidence</option>
              {data.verifiedEvidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description || item.sourceSystem || item.id}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} md:col-span-2`}>
            Verification note
            <textarea
              name="note"
              required
              minLength={20}
              rows={3}
              className={inputClass}
            />
          </label>
          <button
            disabled={saving}
            className="w-fit rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {saving ? "Verifying…" : "Verify classification"}
          </button>
        </form>
      )}

      <p className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-slate-400">
        {data.decisionBoundary} Changes require a named human, verified MFA and
        an AAL2 session.
      </p>
    </section>
  );
}
