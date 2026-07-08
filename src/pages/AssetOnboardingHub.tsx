/**
 * Asset Onboarding Hub — the autonomous RAM-checklist onboarding surface.
 *
 * The engine (migration 11) auto-fills everything findable from live data,
 * queues deducible items for the AI pass, and routes only what can be neither
 * found nor deduced to the human-in-the-loop queue on this page. Go-live is
 * gated on the Section-21 minimum data set plus explicit SME approval.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Loader2,
  Radar,
  RefreshCw,
  Rocket,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { LiveBadge } from "../components/ui/LiveBadge";
import {
  approveAssetGolive,
  formatItemValue,
  getGoliveReadiness,
  getOnboardingChecklist,
  getOnboardingOverview,
  groupChecklistBySection,
  isItemHumanQueue,
  ITEM_STATUS_META,
  provideOnboardingItem,
  requestAiDeductionPass,
  runOnboardingAutofill,
  type OnboardingItem,
} from "../services/assetOnboardingAutonomy";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

const TONE_STYLES: Record<string, string> = {
  auto: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  ai: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  human: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  muted: "bg-slate-500/10 text-slate-300 border-slate-500/30",
};

function StatusChip({ status }: { status: OnboardingItem["status"] }) {
  const meta = ITEM_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${TONE_STYLES[meta.tone]}`}
    >
      {meta.tone === "ai" && <Bot className="h-3 w-3" aria-hidden />}
      {meta.tone === "human" && <UserRound className="h-3 w-3" aria-hidden />}
      {meta.label}
    </span>
  );
}

interface GapFormProps {
  item: OnboardingItem;
  onSubmit: (
    item: OnboardingItem,
    summary: string,
    notApplicable: boolean,
  ) => Promise<void>;
}

function GapForm({ item, onSubmit }: GapFormProps) {
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (notApplicable: boolean) => {
    if (!notApplicable && !answer.trim()) return;
    setSaving(true);
    try {
      await onSubmit(item, answer.trim(), notApplicable);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-amber-500/20 bg-slate-800/60 p-3"
      data-testid={`gap-${item.requirement_key}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-white">
            {item.requirement.item_label}
            {item.requirement.required_for_golive && (
              <span className="ml-2 text-xs text-amber-300">
                required for go-live
              </span>
            )}
          </p>
          <p className="text-xs text-slate-400">
            {item.requirement.section_title}
            {item.requirement.hint ? ` — ${item.requirement.hint}` : ""}
          </p>
          {item.note && (
            <p className="mt-1 text-xs text-blue-300">{item.note}</p>
          )}
        </div>
        <StatusChip status={item.status} />
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit(false);
          }}
          placeholder={
            item.requirement.hint ?? "Provide the missing information"
          }
          aria-label={`Answer for ${item.requirement.item_label}`}
          className="min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
        <button
          onClick={() => void submit(false)}
          disabled={saving || !answer.trim()}
          className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />
          ) : (
            "Save"
          )}
        </button>
        <button
          onClick={() => void submit(true)}
          disabled={saving}
          title="Mark this requirement as not applicable to this asset"
          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
        >
          N/A
        </button>
      </div>
    </div>
  );
}

export function AssetOnboardingHub() {
  const overview = useAsyncData(getOnboardingOverview);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && overview.data && overview.data.length > 0) {
      setSelectedId(overview.data[0].asset_id);
    }
  }, [overview.data, selectedId]);

  const checklist = useAsyncData(
    () =>
      selectedId ? getOnboardingChecklist(selectedId) : Promise.resolve([]),
    [selectedId],
  );
  const readiness = useAsyncData(
    () => (selectedId ? getGoliveReadiness(selectedId) : Promise.resolve(null)),
    [selectedId],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const selected =
    overview.data?.find((o) => o.asset_id === selectedId) ?? null;
  const sections = useMemo(
    () => groupChecklistBySection(checklist.data ?? []),
    [checklist.data],
  );
  const humanQueue = useMemo(
    () => (checklist.data ?? []).filter((i) => isItemHumanQueue(i.status)),
    [checklist.data],
  );

  const refreshAll = () => {
    overview.refetch();
    checklist.refetch();
    readiness.refetch();
  };
  // AI deductions and autonomous passes land live — no manual refresh needed.
  const { live } = useRealtimeRefetch(
    ["asset_onboarding_items", "asset_onboarding_state"],
    refreshAll,
  );

  const handleAutofill = async () => {
    if (!selectedId) return;
    setBusy("autofill");
    try {
      const result = await runOnboardingAutofill(selectedId);
      setToast(
        `Autonomous pass: ${result.auto_filled} auto-filled, ${result.pending_ai} queued for AI, ${result.human_required} need human input.`,
      );
      refreshAll();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Autonomous pass failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleAiPass = async () => {
    setBusy("ai");
    try {
      const result = await requestAiDeductionPass();
      setToast(
        result.requested
          ? "AI deduction pass requested — deduced answers land within a minute."
          : `AI pass skipped: ${result.skipped === "not_configured" ? "AI deduction not configured in this environment" : result.skipped}.`,
      );
      setTimeout(refreshAll, 8000);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "AI pass request failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleProvide = async (
    item: OnboardingItem,
    summary: string,
    notApplicable: boolean,
  ) => {
    try {
      const result = await provideOnboardingItem(item.id, summary, {
        notApplicable,
      });
      setToast(
        `${item.requirement.item_label} ${notApplicable ? "marked not applicable" : "recorded"} — asset now ${result.completion_pct}% complete.`,
      );
      refreshAll();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Could not save answer.");
    }
  };

  const handleApprove = async () => {
    if (!selectedId) return;
    setBusy("approve");
    try {
      const result = await approveAssetGolive(selectedId);
      setToast(
        result.approved
          ? `${result.asset} approved for live monitoring by ${result.approved_by}.`
          : `Not ready — ${result.missing?.length ?? 0} required item(s) outstanding.`,
      );
      refreshAll();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setBusy(null);
    }
  };

  if (overview.loading)
    return <LoadingState label="Loading asset onboarding" />;
  if (overview.error)
    return <ErrorState message={overview.error} onRetry={overview.refetch} />;
  if (overview.isEmpty)
    return (
      <EmptyState message="No assets in onboarding yet — add an asset to the register and it will onboard itself automatically." />
    );

  const liveCount = overview.data!.filter((o) => o.status === "live").length;
  const avgCompletion = Math.round(
    overview.data!.reduce((sum, o) => sum + o.completion_pct, 0) /
      overview.data!.length,
  );
  const totalHuman = overview.data!.reduce(
    (sum, o) => sum + o.human_required_count,
    0,
  );

  return (
    <div className="space-y-6 p-6" data-testid="onboarding-hub">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-white">
              Asset Onboarding
            </h1>
            <LiveBadge live={live} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">
            Fully autonomous RAM-checklist onboarding (DoD RAM Guide aligned).
            SyncAI fills everything it can find or deduce — you only answer what
            it can&apos;t, then approve go-live.
          </p>
        </div>
        <button
          onClick={() => void handleAiPass()}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/20 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          {busy === "ai" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Bot className="h-4 w-4" aria-hidden />
          )}
          Run AI deduction pass
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          {
            label: "Assets in onboarding",
            value: overview.data!.length,
            icon: Radar,
          },
          { label: "Live on SyncAI", value: liveCount, icon: ShieldCheck },
          {
            label: "Avg completion",
            value: `${avgCompletion}%`,
            icon: ClipboardCheck,
          },
          { label: "Awaiting human input", value: totalHuman, icon: UserRound },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4"
          >
            <div className="flex items-center gap-2 text-slate-300">
              <stat.icon className="h-4 w-4" aria-hidden />
              <span className="text-xs">{stat.label}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold text-white">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Asset list */}
        <div className="space-y-2" data-testid="onboarding-asset-list">
          {overview.data!.map((entry) => (
            <button
              key={entry.asset_id}
              onClick={() => setSelectedId(entry.asset_id)}
              aria-pressed={entry.asset_id === selectedId}
              className={`w-full rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 ${
                entry.asset_id === selectedId
                  ? "border-teal-500/50 bg-teal-500/5"
                  : "border-slate-700/60 bg-slate-800/40 hover:border-slate-500"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-white">{entry.asset.name}</p>
                {entry.status === "live" ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-xs text-teal-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden /> Live
                  </span>
                ) : (
                  entry.human_required_count > 0 && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                      {entry.human_required_count} for you
                    </span>
                  )
                )}
              </div>
              <p className="text-xs text-slate-400">
                {entry.asset.tag} · {entry.asset.asset_class}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700"
                  role="progressbar"
                  aria-valuenow={entry.completion_pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${entry.asset.name} onboarding completion`}
                >
                  <div
                    className="h-full rounded-full bg-teal-400"
                    style={{ width: `${entry.completion_pct}%` }}
                  />
                </div>
                <span className="text-xs text-slate-300">
                  {entry.completion_pct}%
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        {selected && (
          <div className="space-y-4">
            {/* Go-live gate */}
            <div
              className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-5"
              data-testid="golive-gate"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Rocket className="h-5 w-5 text-teal-300" aria-hidden />
                  <h2 className="text-lg font-semibold text-white">
                    Go-live gate — {selected.asset.name}
                  </h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleAutofill()}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
                  >
                    {busy === "autofill" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="h-4 w-4" aria-hidden />
                    )}
                    Re-run autonomous pass
                  </button>
                  {selected.status !== "live" && (
                    <button
                      onClick={() => void handleApprove()}
                      disabled={busy !== null || !readiness.data?.ready}
                      title={
                        readiness.data?.ready
                          ? "Approve this asset for live SyncAI monitoring"
                          : "Complete the required items below first"
                      }
                      data-testid="approve-golive"
                      className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
                    >
                      {busy === "approve" ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                      )}
                      Approve go-live
                    </button>
                  )}
                </div>
              </div>

              {selected.status === "live" ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-teal-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Live on SyncAI monitoring — approved by{" "}
                  {selected.approved_by_label}
                  {selected.approved_at
                    ? ` on ${new Date(selected.approved_at).toLocaleDateString()}`
                    : ""}
                </p>
              ) : readiness.data ? (
                <div className="mt-3">
                  <p className="text-sm text-slate-300">
                    {readiness.data.satisfied} of {readiness.data.required}{" "}
                    go-live requirements satisfied
                    {readiness.data.ready ? " — ready for SME approval." : "."}
                  </p>
                  {readiness.data.missing.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {readiness.data.missing.map((m) => (
                        <span
                          key={m.key}
                          className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300"
                        >
                          {m.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Human-in-the-loop queue */}
            {humanQueue.length > 0 && selected.status !== "live" && (
              <div
                className="rounded-xl border border-amber-500/20 bg-slate-800/40 p-5"
                data-testid="hitl-queue"
              >
                <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                  <UserRound className="h-4 w-4 text-amber-300" aria-hidden />
                  Needs you ({humanQueue.length})
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  SyncAI could not find or deduce these. Items marked “AI
                  queued” will be answered by the next AI pass — or answer them
                  now.
                </p>
                <div className="mt-3 space-y-3">
                  {humanQueue.map((item) => (
                    <GapForm
                      key={item.id}
                      item={item}
                      onSubmit={handleProvide}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Checklist by section */}
            {checklist.loading ? (
              <LoadingState label="Loading checklist" />
            ) : (
              <div className="space-y-2" data-testid="onboarding-checklist">
                {sections.map((section) => {
                  const open = openSections.has(section.sectionNumber);
                  return (
                    <div
                      key={section.sectionNumber}
                      className="rounded-xl border border-slate-700/60 bg-slate-800/40"
                    >
                      <button
                        onClick={() =>
                          setOpenSections((prev) => {
                            const next = new Set(prev);
                            if (next.has(section.sectionNumber))
                              next.delete(section.sectionNumber);
                            else next.add(section.sectionNumber);
                            return next;
                          })
                        }
                        aria-expanded={open}
                        className="flex w-full items-center justify-between px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
                      >
                        <span className="text-sm font-medium text-white">
                          {section.sectionNumber}. {section.sectionTitle}
                        </span>
                        <span className="flex items-center gap-3">
                          <span
                            className={`text-xs ${
                              section.satisfied === section.items.length
                                ? "text-teal-300"
                                : "text-slate-300"
                            }`}
                          >
                            {section.satisfied}/{section.items.length}
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
                            aria-hidden
                          />
                        </span>
                      </button>
                      {open && (
                        <div className="border-t border-slate-700/60 px-4 py-3">
                          <ul className="space-y-2">
                            {section.items.map((item) => (
                              <li
                                key={item.id}
                                className="flex flex-wrap items-start justify-between gap-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm text-slate-200">
                                    {item.requirement.item_label}
                                    {item.requirement.required_for_golive && (
                                      <span
                                        className="ml-1 text-amber-300"
                                        title="Required for go-live"
                                      >
                                        *
                                      </span>
                                    )}
                                  </p>
                                  {item.value != null && (
                                    <p className="text-xs text-slate-400">
                                      {formatItemValue(item.value)}
                                    </p>
                                  )}
                                </div>
                                <StatusChip status={item.status} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-md items-start gap-3 rounded-lg border border-teal-500/30 bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-xl"
        >
          <span>{toast}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
