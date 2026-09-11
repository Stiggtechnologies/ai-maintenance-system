/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, TriangleAlert } from "lucide-react";
import { supabase } from "../lib/supabase";

type Check = { key: string; label: string; required: boolean };
type Definition = {
  id: number;
  round_ref: string;
  version: number;
  title: string;
  cadence: string;
  checks: Check[];
};
type Execution = {
  id: number;
  definition_id: number;
  status: string;
  started_at: string;
};
type RoundHistory = Execution & { completed_at: string | null };
const control =
  "mt-1 w-full rounded border border-white/10 bg-industrial-black px-2 py-1.5 text-sm text-slate-100";

export function OperatorRounds({ assetId }: { assetId: string }) {
  const [mode, setMode] = useState<"perform" | "define">("perform");
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [history, setHistory] = useState<RoundHistory[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const client = supabase as any;
    const [definitionResult, executionResult, historyResult] =
      await Promise.all([
        client
          .from("operator_round_definitions")
          .select("id,round_ref,version,title,cadence,checks")
          .eq("asset_id", assetId)
          .eq("active", true)
          .order("created_at", { ascending: false }),
        client
          .from("operator_round_executions")
          .select("id,definition_id,status,started_at")
          .eq("asset_id", assetId)
          .eq("status", "in_progress")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        client
          .from("operator_round_executions")
          .select("id,definition_id,status,started_at,completed_at")
          .eq("asset_id", assetId)
          .neq("status", "in_progress")
          .order("completed_at", { ascending: false })
          .limit(5),
      ]);
    setDefinitions((definitionResult.data ?? []) as Definition[]);
    setExecution((executionResult.data ?? null) as Execution | null);
    setHistory((historyResult.data ?? []) as RoundHistory[]);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await (supabase as any).rpc(name, args);
    setBusy(false);
    if (response.error) {
      setError(response.error.message);
      return null;
    }
    return response.data as Record<string, unknown>;
  };

  async function defineRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const lines = String(data.get("checks") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const checks = lines.map((label, index) => ({
      key: `check-${index + 1}`,
      label,
      required: true,
    }));
    const result = await rpc("define_operator_round", {
      p_record: {
        asset_id: assetId,
        round_ref: data.get("round_ref"),
        title: data.get("title"),
        cadence: data.get("cadence"),
        checks,
        evidence_basis: data.get("evidence_basis"),
      },
    });
    if (result) {
      setMessage("Round definition approved and available to operators.");
      event.currentTarget.reset();
      await load();
    }
  }

  async function startRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const definitionId = Number(
      new FormData(event.currentTarget).get("definition_id"),
    );
    const result = await rpc("start_operator_round", {
      p_definition_id: definitionId,
    });
    if (result) {
      setMessage(
        "Round started. Record every required check before completion.",
      );
      await load();
    }
  }

  async function recordObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!execution) return;
    const data = new FormData(event.currentTarget);
    const result = await rpc("record_operator_round_observation", {
      p_record: {
        execution_id: execution.id,
        check_key: data.get("check_key"),
        classification: data.get("classification"),
        reading_numeric: data.get("reading_numeric"),
        reading_text: data.get("reading_text"),
        unit: data.get("unit"),
        note: data.get("note"),
        observed_at: new Date().toISOString(),
      },
    });
    if (result) {
      setMessage("Observation recorded as canonical field evidence.");
      event.currentTarget.reset();
    }
  }

  async function completeRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!execution) return;
    const note = new FormData(event.currentTarget).get("completion_note");
    const result = await rpc("complete_operator_round", {
      p_execution_id: execution.id,
      p_note: note,
    });
    if (result) {
      setMessage(`Round ${String(result.status).replaceAll("_", " ")}.`);
      await load();
    }
  }

  const selected = definitions.find(
    (item) => item.id === execution?.definition_id,
  );
  return (
    <section
      className="rounded-xl border border-industrial-border bg-industrial-graphite p-6"
      aria-labelledby="operator-rounds-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="operator-rounds-heading"
            className="flex items-center gap-2 text-lg font-semibold text-industrial-text"
          >
            <ClipboardCheck className="h-5 w-5 text-signal-cyan" aria-hidden />{" "}
            Operator rounds
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Human-attested field checks. SyncAI records the approved checklist,
            evidence, and deviations; it does not invent limits or operating
            decisions.
          </p>
        </div>
        <div className="flex rounded border border-white/10 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("perform")}
            className={`rounded px-2 py-1 ${mode === "perform" ? "bg-signal-cyan text-slate-950" : "text-slate-300"}`}
          >
            Perform
          </button>
          <button
            type="button"
            onClick={() => setMode("define")}
            className={`rounded px-2 py-1 ${mode === "define" ? "bg-signal-cyan text-slate-950" : "text-slate-300"}`}
          >
            Define
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 flex gap-2 text-xs text-rose-300">
          <TriangleAlert className="h-4 w-4" />
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 flex gap-2 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </p>
      )}

      {mode === "define" ? (
        <form onSubmit={defineRound} className="mt-4 grid gap-3 lg:grid-cols-2">
          <Field name="round_ref" label="Round reference" />
          <Field name="title" label="Round title" />
          <Field
            name="cadence"
            label="Owner-approved cadence"
            placeholder="For example: each operating shift"
          />
          <Field name="checks" label="Required checks (one per line)" area />
          <Field
            name="evidence_basis"
            label="Procedure / approved basis"
            area
          />
          <button
            disabled={busy}
            className="w-fit rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            Approve definition
          </button>
        </form>
      ) : execution ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-200">
            In progress:{" "}
            <span className="font-semibold">
              {selected?.title ?? `Round ${execution.definition_id}`}
            </span>
          </p>
          <form
            onSubmit={recordObservation}
            className="grid gap-3 lg:grid-cols-2"
          >
            <label className="block text-xs text-slate-300">
              Approved check
              <select
                required
                name="check_key"
                className={control}
                defaultValue=""
              >
                <option value="" disabled>
                  Select a check
                </option>
                {selected?.checks.map((check) => (
                  <option key={check.key} value={check.key}>
                    {check.label}
                    {check.required ? " *" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-300">
              Human classification
              <select
                required
                name="classification"
                className={control}
                defaultValue="normal"
              >
                <option value="normal">Normal</option>
                <option value="deviation">Deviation</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <Field
              name="reading_numeric"
              label="Numeric reading (optional)"
              type="number"
              optional
            />
            <Field name="unit" label="Unit (optional)" optional />
            <Field
              name="reading_text"
              label="Text reading (optional)"
              optional
            />
            <Field
              name="note"
              label="Field note (required for deviations)"
              area
              optional
            />
            <button
              disabled={busy}
              className="w-fit rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              Record observation
            </button>
          </form>
          <form
            onSubmit={completeRound}
            className="border-t border-white/10 pt-4"
          >
            <Field
              name="completion_note"
              label="Completion note (optional)"
              area
              optional
            />
            <button
              disabled={busy}
              className="mt-3 rounded border border-emerald-400/40 px-3 py-1.5 text-sm text-emerald-200 disabled:opacity-50"
            >
              Complete required checks
            </button>
          </form>
        </div>
      ) : definitions.length ? (
        <form
          onSubmit={startRound}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <label className="min-w-64 flex-1 text-xs text-slate-300">
            Approved round
            <select required name="definition_id" className={control}>
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.round_ref} v{definition.version} ·{" "}
                  {definition.title} · {definition.cadence}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy}
            className="rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            Start round
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-slate-400">
          No approved round exists for this asset. An accountable supervisor or
          engineer must define one from the governing procedure.
        </p>
      )}
      {mode === "perform" && history.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Recent completed rounds
          </h3>
          <ul className="mt-2 space-y-2 text-xs text-slate-300">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap justify-between gap-2 rounded bg-industrial-black px-3 py-2"
              >
                <span>
                  Round #{item.id} · {item.status.replaceAll("_", " ")}
                </span>
                <time>
                  {new Date(
                    item.completed_at ?? item.started_at,
                  ).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Field({
  name,
  label,
  type = "text",
  optional = false,
  area = false,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  optional?: boolean;
  area?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs text-slate-300">
      {label}
      {area ? (
        <textarea
          name={name}
          required={!optional}
          rows={3}
          placeholder={placeholder}
          className={control}
        />
      ) : (
        <input
          name={name}
          required={!optional}
          type={type}
          step={type === "number" ? "any" : undefined}
          placeholder={placeholder}
          className={control}
        />
      )}
    </label>
  );
}
