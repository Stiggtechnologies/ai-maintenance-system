import { useEffect, useState } from "react";
import {
  Bot,
  ClipboardCheck,
  PackageCheck,
  UserRoundCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  assignMroMaterialReview,
  loadMroMaterialsAgentWorkspace,
  runMroMaterialsAgent,
} from "../services/mroMaterialsAgentService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const defaultDue = new Date(Date.now() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

function readable(value: string) {
  return value.replaceAll("_", " ");
}

export function MroMaterialsAgentWorkbench({
  refreshVersion = 0,
}: {
  refreshVersion?: number;
}) {
  const { data, loading, error, refetch } = useAsyncData(
    loadMroMaterialsAgentWorkspace,
    [refreshVersion],
    { isEmpty: () => false },
  );
  const [materialId, setMaterialId] = useState("");
  const [windowDays, setWindowDays] = useState(365);
  const [packId, setPackId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue);
  const [note, setNote] = useState(
    "Review inventory, demand, repair-loop and supplier evidence before any material action.",
  );
  const [busy, setBusy] = useState<"run" | "assign" | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!materialId && data?.materials?.[0])
      setMaterialId(data.materials[0].materialId);
    if (!packId && data?.packs?.[0]) setPackId(data.packs[0].packId);
    if (!ownerId && data?.members?.[0]) setOwnerId(data.members[0].id);
  }, [data, materialId, ownerId, packId]);

  const pack = data?.packs?.find((item) => item.packId === packId) ?? null;

  async function act(kind: "run" | "assign", fn: () => Promise<void>) {
    setBusy(kind);
    setNotice(null);
    try {
      await fn();
      setNotice({
        kind: "ok",
        text:
          kind === "run"
            ? "Immutable MRO material assessment created from exact catalogue, inventory, demand and supplier evidence."
            : "Named-human review ownership recorded. No inventory, procurement or work action was taken.",
      });
      await refetch();
    } catch (actionError) {
      setNotice({
        kind: "error",
        text:
          actionError instanceof Error
            ? actionError.message
            : "Governed MRO-material action failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading MRO Materials Specialist" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-400/20 bg-[#071510]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.12),transparent_48%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <Bot className="h-4 w-4" aria-hidden /> MRO Materials Specialist
            </div>
            <h2 className="text-xl font-semibold text-white">
              Governed material-position review
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Assess critical spares, existing reorder policies, repairables,
              stockouts and obsolescence from retained customer evidence. The
              specialist discloses unknowns and produces a review plan; it
              cannot buy, reserve, issue, substitute, change policy or release
              work.
            </p>
          </div>
          <div className="grid min-w-80 gap-2 sm:grid-cols-[minmax(0,1fr)_104px_auto]">
            <select
              aria-label="MRO material"
              value={materialId}
              onChange={(event) => setMaterialId(event.target.value)}
              className="min-w-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
            >
              <option value="">Select customer material…</option>
              {(data?.materials ?? []).map((material) => (
                <option key={material.materialId} value={material.materialId}>
                  {material.materialCode} ·{" "}
                  {material.criticality ?? "unclassified"}
                  {material.openShortLines
                    ? ` · ${material.openShortLines} short`
                    : ""}
                </option>
              ))}
            </select>
            <select
              aria-label="MRO evidence window"
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
              className="rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-sm text-white"
            >
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
              <option value={730}>2 years</option>
              <option value={1095}>3 years</option>
            </select>
            <button
              type="button"
              disabled={!materialId || busy !== null}
              onClick={() =>
                act("run", async () => {
                  const receipt = await runMroMaterialsAgent({
                    materialId,
                    windowDays,
                  });
                  setPackId(receipt.packId);
                })
              }
              className="rounded-lg bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-200 disabled:opacity-40"
            >
              {busy === "run" ? "Assessing…" : "Run assessment"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Retained assessment
            <select
              value={packId}
              onChange={(event) => setPackId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white"
            >
              <option value="">No retained assessment</option>
              {(data?.packs ?? []).map((item) => (
                <option key={item.packId} value={item.packId}>
                  {item.materialCode} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-3 text-xs leading-5 text-slate-500">{data?.basis}</p>
          {!data?.materials.length ? (
            <p className="mt-3 rounded-lg border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80">
              No customer material is available. Template material classes are
              deliberately excluded; create or ingest a customer catalogue
              identity first.
            </p>
          ) : null}
        </div>

        {pack ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">
                    {pack.materialCode} · {pack.description}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {pack.windowDays}-day evidence window · retained run{" "}
                    {pack.agentRunId.slice(0, 8)}
                  </p>
                </div>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-200">
                  Human review required
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {pack.assessment.interpretation}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <ModeCard
                label="Critical spares"
                state={pack.assessment.criticalSpares.state}
              />
              <ModeCard
                label="Reorder policy"
                state={pack.assessment.reorderPolicy.state}
              />
              <ModeCard
                label="Repairables"
                state={pack.assessment.repairables.state}
              />
              <ModeCard
                label="Stockouts"
                state={pack.assessment.stockouts.state}
              />
              <ModeCard
                label="Obsolescence"
                state={pack.assessment.obsolescence.state}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Available"
                value={pack.assessment.inventoryPosition.available}
              />
              <Metric
                label="Open shortages"
                value={pack.assessment.stockouts.openShortLines}
              />
              <Metric
                label="Approved sources"
                value={pack.assessment.obsolescence.approvedSuppliers}
              />
              <Metric
                label="Issue events"
                value={pack.assessment.demandEvidence.issueEvents}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/8 p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <PackageCheck
                    className="h-4 w-4 text-emerald-300"
                    aria-hidden
                  />
                  Evidence gaps
                </h4>
                {pack.assessment.evidenceGaps.length ? (
                  <ul className="mt-3 space-y-2">
                    {pack.assessment.evidenceGaps.map((gap) => (
                      <li
                        key={gap.code}
                        className="text-sm leading-5 text-slate-300"
                      >
                        <span className="mr-2 text-xs font-semibold uppercase text-amber-300">
                          {gap.severity}
                        </span>
                        {gap.detail}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">
                    No configured gap was found. Adequacy and operational action
                    still require human review.
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-white/8 p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ClipboardCheck
                    className="h-4 w-4 text-emerald-300"
                    aria-hidden
                  />
                  Material evidence plan
                </h4>
                <ol className="mt-3 space-y-2">
                  {pack.assessment.evidencePlan.map((step) => (
                    <li key={step.sequence} className="flex gap-3 text-sm">
                      <span className="font-mono text-emerald-300">
                        {step.sequence}
                      </span>
                      <div>
                        <div className="text-slate-200">{step.question}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {step.owner} · {step.completion}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="rounded-xl border border-white/8 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                <UserRoundCheck
                  className="h-4 w-4 text-emerald-300"
                  aria-hidden
                />
                Named-human review
              </h4>
              {pack.assignment ? (
                <p className="mt-2 text-sm text-slate-300">
                  {pack.assignment.ownerName} owns review by{" "}
                  {pack.assignment.dueDate}. {pack.assignment.note}
                </p>
              ) : (
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1.4fr)_auto]">
                  <select
                    aria-label="MRO material review owner"
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  >
                    <option value="">Select reviewer…</option>
                    {(data?.members ?? []).map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} · {member.role}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="MRO material review due date"
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  />
                  <input
                    aria-label="MRO material review note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    disabled={
                      !ownerId ||
                      !dueDate ||
                      note.trim().length < 10 ||
                      busy !== null
                    }
                    onClick={() =>
                      act("assign", () =>
                        assignMroMaterialReview({
                          packId: pack.packId,
                          assignedTo: ownerId,
                          dueDate,
                          note,
                        }),
                      )
                    }
                    className="rounded-lg border border-emerald-300/30 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-300/10 disabled:opacity-40"
                  >
                    {busy === "assign" ? "Assigning…" : "Assign review"}
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80">
              {pack.assessment.limitations.join(" ")}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
            Run a governed assessment to retain exact MRO evidence and its
            human-review boundary.
          </div>
        )}
      </div>

      {notice ? (
        <div
          role="status"
          className={`border-t border-white/8 px-5 py-3 text-sm ${
            notice.kind === "ok" ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {notice.text}
        </div>
      ) : null}
    </section>
  );
}

function ModeCard({ label, state }: { label: string; state: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/10 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold capitalize text-white">
        {readable(state)}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/10 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold capitalize text-white">
        {value}
      </div>
    </div>
  );
}
