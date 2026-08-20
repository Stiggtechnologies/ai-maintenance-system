/**
 * The Data Room — §4 of the workspace specification.
 *
 * One slot per dataset the customer intake pack asks for, present from the
 * moment the assessment exists, so a dataset that has NOT arrived is something
 * the screen states rather than something it omits. The shipped version showed
 * a list of uploaded files and a percentage; a list of what arrived cannot
 * show what did not.
 *
 * WHAT THIS SCREEN WILL NOT DO. It will not colour a dataset. Green/Amber/Red
 * is the engineer's judgement about whether the customer's question is
 * answerable from what arrived, it is recorded with its reason and its author,
 * and the database refuses it otherwise. Uploading a file advances a slot to
 * `received` and profiling advances it to `profiled` — both observations, and
 * neither is a rating.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleHelp,
  FileWarning,
  Link2,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  type Clarification,
  type DataRoomSource,
  type DataRoomState,
  type DatasetKey,
  type DatasetSlot,
  type Readiness,
  answerClarification,
  loadDataRoom,
  openClarification,
  rateDataset,
  retireSource,
  uploadSource,
  upsertAlias,
} from "../../services/riaDataRoom";

interface DataRoomProps {
  assessmentId: string;
  organizationId: string;
  /** Menu-level affordance only. The database is the boundary. */
  canSupply?: boolean;
  canRate?: boolean;
}

const READINESS_STYLE: Record<Readiness, string> = {
  missing: "border-white/10 bg-white/[0.02] text-slate-400",
  received: "border-sky-300/20 bg-sky-300/5 text-sky-200",
  profiled: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  green: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  amber: "border-amber-300/25 bg-amber-300/10 text-amber-200",
  red: "border-red-300/25 bg-red-300/10 text-red-200",
};

/** The pack's §4 "assessment response" column, verbatim in meaning. */
const READINESS_MEANING: Record<Readiness, string> = {
  missing: "Not supplied.",
  received: "Received, not yet profiled.",
  profiled: "Profiled. Awaiting an engineering readiness rating.",
  green: "Key identifiers, dates and operating measure are coherent.",
  amber:
    "Material gaps or inconsistent coding, but useful analysis remains possible.",
  red: "Asset linkage, chronology or operating denominator is too weak for the requested conclusion.",
};

function percent(share: number | null): string {
  if (share === null) return "no such column";
  return `${Math.round(share * 100)}%`;
}

function SlotCard({
  slot,
  sources,
  canSupply,
  canRate,
  busy,
  onUpload,
  onRate,
  onRetire,
}: {
  slot: DatasetSlot;
  sources: DataRoomSource[];
  canSupply: boolean;
  canRate: boolean;
  busy: string | null;
  onUpload: (slot: DatasetSlot, file: File) => void;
  onRate: (
    slot: DatasetSlot,
    readiness: "green" | "amber" | "red",
    note: string,
  ) => void;
  onRetire: (source: DataRoomSource) => void;
}) {
  const [rating, setRating] = useState<"green" | "amber" | "red">("amber");
  const [note, setNote] = useState("");
  const [rateOpen, setRateOpen] = useState(false);
  const live = sources.filter((s) => s.deleted_at === null);
  const retired = sources.filter((s) => s.deleted_at !== null);

  return (
    <div
      className="rounded-xl border border-white/10 bg-white/[0.01] p-5"
      data-testid={`slot-${slot.dataset_key}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-white">{slot.label}</p>
          <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">
            {slot.requirement}
            {slot.preferred_history ? ` · ${slot.preferred_history}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs ${READINESS_STYLE[slot.readiness]}`}
          data-testid={`readiness-${slot.dataset_key}`}
        >
          {slot.readiness}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-400">
        {READINESS_MEANING[slot.readiness]}
      </p>
      {slot.readiness_note && (
        <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm leading-6 text-slate-300">
          {slot.readiness_note}
        </p>
      )}
      {!slot.readiness_note && slot.readiness === "missing" && (
        <p className="mt-2 text-xs text-amber-200/80">
          No gap logged. Kickoff is not data-ready until a missing dataset is
          explicitly accounted for.
        </p>
      )}

      {slot.minimum_fields.length > 0 && (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Minimum fields: {slot.minimum_fields.join(", ")}
        </p>
      )}

      {live.map((source) => (
        <div
          key={source.id}
          className="mt-4 rounded-lg border border-white/10 bg-[#0B151F] p-4"
          data-testid={`source-${source.id}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm font-medium text-white">{source.file_name}</p>
            {canSupply && (
              <button
                onClick={() => onRetire(source)}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-200"
                aria-label={`Retire ${source.file_name}`}
              >
                <Trash2 size={13} />
                Retire
              </button>
            )}
          </div>
          {source.profiled_at ? (
            <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
              <p>
                {source.row_count?.toLocaleString() ?? "?"} rows ·{" "}
                {source.column_count ?? "?"} columns
              </p>
              <p>Identifier coverage: {percent(source.identifier_coverage)}</p>
              <p>
                Coverage:{" "}
                {source.coverage_from && source.coverage_to
                  ? `${source.coverage_from} → ${source.coverage_to}`
                  : "no date column recognised"}
              </p>
              <p>
                {source.raw_retained
                  ? "Raw export retained"
                  : "Raw export not retained"}
                {source.content_sha256
                  ? ` · sha256 ${source.content_sha256.slice(0, 12)}…`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Received, not yet profiled.
            </p>
          )}

          {source.missing_required_fields.length > 0 && (
            <p className="mt-3 flex items-start gap-2 text-xs text-amber-200">
              <FileWarning size={13} className="mt-0.5 shrink-0" />
              Absent required fields:{" "}
              {source.missing_required_fields.join(", ")}
            </p>
          )}

          {source.dq_exceptions.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Data-quality exceptions
              </p>
              <ul className="mt-2 space-y-1">
                {source.dq_exceptions.map((exception, index) => (
                  <li key={index} className="text-xs text-slate-400">
                    {exception.rows?.toLocaleString() ?? "?"} rows —{" "}
                    {exception.reason ?? "unstated"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      {retired.map((source) => (
        <div
          key={source.id}
          className="mt-3 rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-500"
          data-testid={`retired-${source.id}`}
        >
          <span className="line-through">{source.file_name}</span> — retired.{" "}
          {source.delete_note}
        </div>
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canSupply && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/5">
            {busy === slot.id ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {busy === slot.id ? "Uploading…" : "Upload export"}
            <input
              type="file"
              className="hidden"
              aria-label={`Upload ${slot.label}`}
              disabled={busy !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(slot, file);
                event.target.value = "";
              }}
            />
          </label>
        )}
        {canRate && (
          <button
            onClick={() => setRateOpen((open) => !open)}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
          >
            Rate readiness
          </button>
        )}
      </div>

      {rateOpen && canRate && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <label className="text-xs text-slate-400">
            Rating
            <select
              aria-label={`Readiness rating for ${slot.label}`}
              value={rating}
              onChange={(event) =>
                setRating(event.target.value as "green" | "amber" | "red")
              }
              className="mt-1 w-full rounded-md border border-white/10 bg-[#081018] px-2 py-2 text-sm text-white"
            >
              <option value="green">Green</option>
              <option value="amber">Amber</option>
              <option value="red">Red</option>
            </select>
          </label>
          <label className="mt-3 block text-xs text-slate-400">
            Reason — what is coherent, what the gap is, or why the conclusion is
            unreachable
            <textarea
              aria-label={`Readiness reason for ${slot.label}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-white/10 bg-[#081018] px-2 py-2 text-sm text-white"
            />
          </label>
          <button
            onClick={() => {
              onRate(slot, rating, note);
              setNote("");
              setRateOpen(false);
            }}
            className="mt-3 rounded-md bg-teal-300 px-3 py-2 text-xs font-semibold text-slate-950"
          >
            Record rating
          </button>
        </div>
      )}
    </div>
  );
}

function ClarificationQueue({
  clarifications,
  canAnswer,
  canAsk,
  onAsk,
  onAnswer,
}: {
  clarifications: Clarification[];
  canAnswer: boolean;
  canAsk: boolean;
  onAsk: (question: string, blocks: boolean) => void;
  onAnswer: (id: string, answer: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [blocks, setBlocks] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const open = clarifications.filter((c) => c.status === "open");

  return (
    <section className="mt-8" aria-labelledby="clarifications-heading">
      <h2
        id="clarifications-heading"
        className="text-xl font-semibold text-white"
      >
        Clarification queue
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        {open.length === 0
          ? "Nothing outstanding."
          : `${open.length} open — ${open.filter((c) => c.blocks_analysis).length} of them block analysis.`}
      </p>

      <div className="mt-4 space-y-3">
        {clarifications.map((clarification) => (
          <div
            key={clarification.id}
            className="rounded-xl border border-white/10 p-4"
            data-testid={`clarification-${clarification.id}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="flex items-start gap-2 text-sm text-white">
                <CircleHelp
                  size={15}
                  className="mt-0.5 shrink-0 text-slate-500"
                />
                {clarification.question}
              </p>
              {clarification.blocks_analysis &&
                clarification.status === "open" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-200">
                    <AlertTriangle size={12} />
                    Blocks analysis
                  </span>
                )}
            </div>
            {clarification.context && (
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {clarification.context}
              </p>
            )}
            {clarification.status === "answered" ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-white/[0.02] p-3 text-sm text-slate-300">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-300" />
                {clarification.answer}
              </p>
            ) : (
              canAnswer && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    aria-label={`Answer: ${clarification.question}`}
                    value={answers[clarification.id] ?? ""}
                    onChange={(event) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [clarification.id]: event.target.value,
                      }))
                    }
                    className="flex-1 rounded-md border border-white/10 bg-[#081018] px-3 py-2 text-sm text-white"
                    placeholder="Answer"
                  />
                  <button
                    onClick={() =>
                      onAnswer(
                        clarification.id,
                        answers[clarification.id] ?? "",
                      )
                    }
                    className="rounded-md bg-teal-300 px-3 py-2 text-sm font-semibold text-slate-950"
                  >
                    Record answer
                  </button>
                </div>
              )
            )}
          </div>
        ))}
      </div>

      {canAsk && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <label className="text-xs text-slate-400">
            Raise a clarification
            <input
              aria-label="New clarification"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-[#081018] px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={blocks}
              onChange={(event) => setBlocks(event.target.checked)}
            />
            This blocks analysis
          </label>
          <button
            onClick={() => {
              onAsk(question, blocks);
              setQuestion("");
              setBlocks(false);
            }}
            className="mt-3 rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-white"
          >
            Add to queue
          </button>
        </div>
      )}
    </section>
  );
}

function AliasMap({
  aliases,
  canEdit,
  onAdd,
}: {
  aliases: DataRoomState["aliases"];
  canEdit: boolean;
  onAdd: (system: string, alias: string, canonical: string) => void;
}) {
  const [system, setSystem] = useState("");
  const [alias, setAlias] = useState("");
  const [canonical, setCanonical] = useState("");

  return (
    <section className="mt-8" aria-labelledby="alias-heading">
      <h2 id="alias-heading" className="text-xl font-semibold text-white">
        Alias map
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        Dealer and legacy identifiers mapped to the asset register. An
        unresolved alias is a join that will silently fail, so it is held rather
        than dropped.
      </p>

      <div className="mt-4 space-y-2">
        {aliases.length === 0 && (
          <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
            No aliases recorded.
          </p>
        )}
        {aliases.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3"
            data-testid={`alias-${entry.id}`}
          >
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">{entry.source_system}</span> ·{" "}
              {entry.source_alias}
              <Link2 size={12} className="mx-2 inline text-slate-600" />
              {entry.canonical_asset_ref ?? entry.canonical_asset_id ?? "—"}
            </p>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs ${
                entry.resolved
                  ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                  : "border-amber-300/25 bg-amber-300/10 text-amber-200"
              }`}
            >
              {entry.resolved ? "resolved" : "unresolved"}
            </span>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <input
            aria-label="Alias source system"
            placeholder="Source system"
            value={system}
            onChange={(event) => setSystem(event.target.value)}
            className="rounded-md border border-white/10 bg-[#081018] px-3 py-2 text-sm text-white"
          />
          <input
            aria-label="Source alias"
            placeholder="Alias"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            className="rounded-md border border-white/10 bg-[#081018] px-3 py-2 text-sm text-white"
          />
          <input
            aria-label="Canonical asset reference"
            placeholder="Canonical asset ref"
            value={canonical}
            onChange={(event) => setCanonical(event.target.value)}
            className="rounded-md border border-white/10 bg-[#081018] px-3 py-2 text-sm text-white"
          />
          <button
            onClick={() => {
              onAdd(system, alias, canonical);
              setSystem("");
              setAlias("");
              setCanonical("");
            }}
            className="rounded-md border border-white/15 px-3 py-2 text-sm font-semibold text-white"
          >
            Map alias
          </button>
        </div>
      )}
    </section>
  );
}

export function DataRoom({
  assessmentId,
  organizationId,
  canSupply = true,
  canRate = true,
}: DataRoomProps) {
  const [state, setState] = useState<DataRoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState(await loadDataRoom(assessmentId));
  }, [assessmentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadDataRoom(assessmentId);
        if (!cancelled) setState(next);
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "The data room could not be loaded.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  /** Every mutation reports its own refusal rather than failing silently. */
  const run = useCallback(
    async (key: string, action: () => Promise<string | void>) => {
      setBusy(key);
      setError("");
      setNotice("");
      try {
        const message = await action();
        if (message) setNotice(message);
        await refresh();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "The action failed.",
        );
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const sourcesBySlot = useMemo(() => {
    const map = new Map<string, DataRoomSource[]>();
    for (const source of state?.sources ?? []) {
      const key = source.slot_id ?? `category:${source.category}`;
      map.set(key, [...(map.get(key) ?? []), source]);
    }
    return map;
  }, [state]);

  if (loading)
    return (
      <p className="text-slate-400" role="status">
        Loading the data room…
      </p>
    );

  if (error && !state)
    return (
      <div
        className="rounded-xl border border-red-300/20 bg-red-300/5 p-5 text-sm text-red-200"
        role="alert"
      >
        {error}
      </div>
    );

  if (!state) return null;

  const readiness = state.readiness;

  return (
    <div>
      <h1 className="text-3xl font-semibold text-white">Data Room</h1>
      <p className="mt-3 max-w-3xl text-slate-400">
        The assessment is export-based: no production credentials, no
        installation. Each dataset below is a slot the intake pack asks for, and
        a slot with nothing in it is stated rather than hidden.
      </p>

      {readiness && (
        <div
          className="mt-6 rounded-xl border border-white/10 bg-[#0B151F] p-5"
          data-testid="kickoff-acceptance"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Kickoff acceptance
          </p>
          <p className="mt-2 text-lg font-semibold text-white">
            {readiness.kickoff_data_ready
              ? "Data-ready for kickoff"
              : "Not yet data-ready"}
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ["Bounded scope confirmed", readiness.scope_confirmed],
              ["Asset register received", readiness.asset_register_received],
              ["Work-order history received", readiness.work_orders_received],
              ["Primary question agreed", readiness.primary_question_agreed],
              [
                "Known gaps explicitly logged",
                readiness.gaps_explicitly_logged,
              ],
            ].map(([label, met]) => (
              <li
                key={String(label)}
                className={`flex items-center gap-2 text-sm ${met ? "text-emerald-200" : "text-slate-400"}`}
              >
                {met ? (
                  <Check size={14} />
                ) : (
                  <AlertTriangle size={14} className="text-amber-300" />
                )}
                {label}
              </li>
            ))}
          </ul>
          {readiness.open_blocking_clarifications > 0 && (
            <p className="mt-4 text-sm text-amber-200">
              {readiness.open_blocking_clarifications} open clarification
              {readiness.open_blocking_clarifications === 1 ? "" : "s"} block
              analysis. Readiness is not evidence sufficiency.
            </p>
          )}
        </div>
      )}

      {error && (
        <div
          className="mt-5 rounded-lg border border-red-300/20 bg-red-300/5 p-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-200"
          role="status"
        >
          {notice}
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {state.slots.map((slot) => (
          <SlotCard
            key={slot.id}
            slot={slot}
            sources={
              sourcesBySlot.get(slot.id) ??
              sourcesBySlot.get(`category:${slot.dataset_key}`) ??
              []
            }
            canSupply={canSupply}
            canRate={canRate}
            busy={busy}
            onUpload={(target, file) =>
              void run(target.id, async () => {
                const result = await uploadSource(
                  organizationId,
                  assessmentId,
                  target.dataset_key as DatasetKey,
                  file,
                );
                return result.profiled ? undefined : result.profileError;
              })
            }
            onRate={(target, rating, note) =>
              void run(target.id, () => rateDataset(target.id, rating, note))
            }
            onRetire={(source) =>
              void run(source.id, () => {
                const note = globalThis.prompt?.(
                  "Why is this source being retired? The stub keeps the file name, its fingerprint and this note.",
                );
                if (!note) throw new Error("Retirement needs a note.");
                return retireSource(source.id, note);
              })
            }
          />
        ))}
      </div>

      <ClarificationQueue
        clarifications={state.clarifications}
        canAnswer={canSupply}
        canAsk={canRate}
        onAsk={(question, blocks) =>
          void run("ask", () =>
            openClarification(assessmentId, question, undefined, blocks),
          )
        }
        onAnswer={(id, answer) =>
          void run(id, () => answerClarification(id, answer))
        }
      />

      <AliasMap
        aliases={state.aliases}
        canEdit={canSupply}
        onAdd={(system, alias, canonical) =>
          void run("alias", () =>
            upsertAlias(assessmentId, system, alias, canonical),
          )
        }
      />
    </div>
  );
}
