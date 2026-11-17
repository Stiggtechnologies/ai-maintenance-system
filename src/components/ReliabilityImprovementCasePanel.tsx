import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  loadReliabilityImprovementWorkspace,
  startReliabilityImprovementCase,
  type ReliabilityImprovementCaseResult,
} from "../services/reliabilityImprovementCaseService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

function dateLabel(value: string | null): string {
  if (!value) return "No completed corrective history";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function ReliabilityImprovementCasePanel() {
  const navigate = useNavigate();
  const [windowDays, setWindowDays] = useState(365);
  const { data, loading, error, refetch } = useAsyncData(
    () => loadReliabilityImprovementWorkspace(windowDays),
    [windowDays],
    { isEmpty: () => false },
  );
  const [assetId, setAssetId] = useState("");
  const [packId, setPackId] = useState("");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [frameworkId, setFrameworkId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ReliabilityImprovementCaseResult | null>(
    null,
  );

  useEffect(() => {
    if (!assetId && data?.rankedAssets[0]) {
      setAssetId(data.rankedAssets[0].assetId);
    }
  }, [assetId, data]);

  const asset = useMemo(
    () => data?.rankedAssets.find((item) => item.assetId === assetId) ?? null,
    [assetId, data],
  );

  useEffect(() => {
    if (!asset) return;
    const available = asset.fracasPacks.find(
      (pack) => !pack.caseId && pack.assignedTo,
    );
    const anyPack = available ?? asset.fracasPacks[0] ?? null;
    setPackId(anyPack?.packId ?? "");
    setTitle(`Reliability improvement — ${asset.assetTag}`);
    setProblem(
      `${asset.assetTag} has ${asset.correctiveEvents} completed corrective event${asset.correctiveEvents === 1 ? "" : "s"} and ${asset.downtimeHours} recorded downtime hours in the selected tenant-history window. The causal mechanism, FMEA/RCM coverage, maintenance-strategy options, value case, and outcome verification require governed review.`,
    );
    setOpportunity("");
    setResult(null);
    setNotice(null);
  }, [asset]);

  const pack =
    asset?.fracasPacks.find((item) => item.packId === packId) ?? null;
  const canStart = Boolean(
    asset &&
    pack &&
    pack.assignedTo &&
    !pack.caseId &&
    title.trim().length >= 3 &&
    problem.trim().length >= 20,
  );

  async function startCase() {
    if (!canStart || !pack) return;
    setBusy(true);
    setNotice(null);
    try {
      const created = await startReliabilityImprovementCase({
        fracasPackId: pack.packId,
        title: title.trim(),
        problemStatement: problem.trim(),
        opportunityStatement: opportunity.trim() || null,
        frameworkId: frameworkId || null,
      });
      setResult(created);
      setNotice(
        created.existing
          ? "This FRACAS pack already has a governed improvement case."
          : "Canonical improvement case created and the investigated asset was bound to its governed scope.",
      );
    } catch (actionError) {
      setNotice(
        actionError instanceof Error
          ? actionError.message
          : "The governed case could not be started.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading reliability-improvement intake" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#09131d]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.13),transparent_48%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <BriefcaseBusiness className="h-4 w-4" aria-hidden /> Reliability
              Engineer · improvement case
            </div>
            <h2 className="text-xl font-semibold text-white">
              Move a bad actor from investigation into governed follow-through
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Rank recorded corrective losses, require a retained FRACAS pack
              with a named investigator, then create the canonical Development
              Case and bind the same asset into its case-scoped RAM, FMEA/RCM,
              strategy and value workflow.
            </p>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            History window
            <select
              aria-label="Reliability screening window"
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
              className="mt-2 block rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white"
            >
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
              <option value={730}>730 days</option>
              <option value={1825}>5 years</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span>Data through {dateLabel(data?.dataThrough ?? null)}</span>
          <span className="text-slate-600">•</span>
          <span>{data?.rankingBasis}</span>
        </div>
      </div>

      {(data?.rankedAssets.length ?? 0) === 0 ? (
        <div className="p-6 text-sm text-slate-400">
          No completed corrective work is available for a tenant-grounded
          screening rank. Import or close work history before framing an
          improvement case.
        </div>
      ) : (
        <div className="grid gap-5 p-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ranked asset
              <select
                aria-label="Ranked reliability asset"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white"
              >
                {data?.rankedAssets.map((item) => (
                  <option key={item.assetId} value={item.assetId}>
                    #{item.rank} · {item.assetTag} · {item.downtimeHours} h
                  </option>
                ))}
              </select>
            </label>
            {asset && (
              <div className="grid grid-cols-2 gap-2">
                <Metric
                  label="Corrective events"
                  value={asset.correctiveEvents}
                />
                <Metric label="Downtime" value={`${asset.downtimeHours} h`} />
                <Metric label="Mechanism coded" value={asset.codedEvents} />
                <Metric label="Uncoded" value={asset.uncodedEvents} />
              </div>
            )}
            <p className="text-xs leading-5 text-slate-500">
              Screening does not normalize for operating exposure and does not
              replace criticality, causal analysis, or technical authority.
            </p>
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Retained FRACAS investigation
              <select
                aria-label="FRACAS investigation for improvement case"
                value={packId}
                onChange={(event) => {
                  setPackId(event.target.value);
                  setResult(null);
                  setNotice(null);
                }}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white"
              >
                <option value="">No retained investigation</option>
                {asset?.fracasPacks.map((item) => (
                  <option key={item.packId} value={item.packId}>
                    {item.workOrderNumber ?? item.workOrderId} ·{" "}
                    {item.ownerName ?? "unassigned"}
                    {item.caseId ? " · case started" : ""}
                  </option>
                ))}
              </select>
            </label>

            {!pack ? (
              <BoundaryNotice text="Build a governed RCA / FRACAS investigation for this asset before opening an improvement case." />
            ) : !pack.assignedTo ? (
              <BoundaryNotice text="Assign a named human investigator in the RCA / FRACAS workflow before opening an improvement case." />
            ) : pack.caseId ? (
              <div className="rounded-xl border border-teal-400/20 bg-teal-400/5 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Existing
                  governed case
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Case {pack.caseId} · {pack.caseStatus}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/develop/cases/${pack.caseId}#case-ram`)
                  }
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-teal-400/25 bg-teal-400/10 px-3 py-2 text-sm font-semibold text-teal-200 hover:bg-teal-400/15"
                >
                  Open case RAM / FMEA / strategy{" "}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold text-slate-400">
                  Case title
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm font-normal text-white"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-400">
                  Governing framework
                  <select
                    value={frameworkId}
                    onChange={(event) => setFrameworkId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm font-normal text-white"
                  >
                    <option value="">No framework attached yet</option>
                    {data?.frameworks.map((framework) => (
                      <option key={framework.id} value={framework.id}>
                        {framework.name} v{framework.version} ·{" "}
                        {framework.sourceAuthority}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-400 md:col-span-2">
                  Problem statement
                  <textarea
                    value={problem}
                    onChange={(event) => setProblem(event.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm font-normal leading-6 text-white"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-400 md:col-span-2">
                  Opportunity statement (optional)
                  <textarea
                    value={opportunity}
                    onChange={(event) => setOpportunity(event.target.value)}
                    rows={2}
                    placeholder="State the outcome opportunity without asserting an unverified benefit."
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm font-normal leading-6 text-white placeholder:text-slate-600"
                  />
                </label>
              </div>
            )}

            {pack && pack.assignedTo && !pack.caseId && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/15 p-4">
                <div className="max-w-2xl text-xs leading-5 text-slate-400">
                  Starting a case frames work for review. It does not verify
                  root cause, approve a maintenance strategy, authorize work,
                  accept risk, commit spend, or sanction the case.
                </div>
                <button
                  type="button"
                  disabled={!canStart || busy}
                  onClick={startCase}
                  className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-40"
                >
                  {busy ? "Starting…" : "Start governed improvement case"}
                </button>
              </div>
            )}

            {notice && (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                {notice}
              </div>
            )}
            {result && (
              <button
                type="button"
                onClick={() => navigate(result.route)}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-300/15"
              >
                Open case RAM / FMEA / strategy{" "}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
      <div className="text-lg font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function BoundaryNotice({ text }: { text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
      <TriangleAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
        aria-hidden
      />
      <span>{text}</span>
    </div>
  );
}
