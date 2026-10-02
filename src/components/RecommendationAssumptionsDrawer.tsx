import { useEffect, useState } from "react";
import { ClipboardList, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getRecommendationAssumptionPacket,
  recordRecommendationAssumptions,
  type RecommendationAssumptionDisposition,
  type RecommendationAssumptionItem,
} from "../services/recommendationAssumptionService";
import type { RecommendationRow } from "../types/operating";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const INPUT =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-teal-500/50 focus:outline-none";

const EMPTY_ITEM: RecommendationAssumptionItem = {
  statement: "",
  basis: "",
  consequence_if_wrong: "",
  validation_method: "",
};

function Field({
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
    <label className="block text-xs text-slate-400">
      {label}
      <textarea
        className={`${INPUT} mt-1 min-h-20`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        minLength={24}
        required
      />
    </label>
  );
}

export function RecommendationAssumptionsDrawer({
  rec,
  canGovern,
  onClose,
}: {
  rec: RecommendationRow;
  canGovern: boolean;
  onClose: () => void;
}) {
  const { data, loading, error, refetch } = useAsyncData(
    () => getRecommendationAssumptionPacket(rec.id),
    [rec.id],
  );
  const [disposition, setDisposition] =
    useState<RecommendationAssumptionDisposition>("recorded");
  const [basis, setBasis] = useState("");
  const [items, setItems] = useState<RecommendationAssumptionItem[]>([
    { ...EMPTY_ITEM },
  ]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.packet) return;
    setDisposition(data.packet.disposition);
    setBasis(data.packet.basis);
    setItems(
      data.packet.items.length > 0 ? data.packet.items : [{ ...EMPTY_ITEM }],
    );
  }, [data]);

  const locked = ["approved", "released", "scheduled"].includes(
    data?.recommendationStatus ?? rec.status,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const result = await recordRecommendationAssumptions({
        recommendationId: rec.id,
        packet: {
          disposition,
          basis: basis.trim(),
          items:
            disposition === "recorded"
              ? items.map((item) => ({
                  statement: item.statement.trim(),
                  basis: item.basis.trim(),
                  consequence_if_wrong: item.consequence_if_wrong.trim(),
                  validation_method: item.validation_method.trim(),
                }))
              : [],
        },
        note: note.trim(),
      });
      setSaved(
        `Assumption assessment recorded · ${result.packetSha256.slice(0, 12)}`,
      );
      setNote("");
      refetch();
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Could not save assumptions.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close recommendation assumptions"
        className="absolute inset-0 bg-black/65"
        onClick={onClose}
      />
      <aside
        aria-labelledby="recommendation-assumptions-heading"
        className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#0B121B] p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="recommendation-assumptions-heading"
              className="flex items-center gap-2 text-sm font-semibold text-slate-100"
            >
              <ClipboardList className="h-4 w-4 text-teal-400" aria-hidden />
              Recommendation assumptions
            </h2>
            <p className="mt-1 text-xs text-slate-400">{rec.title}</p>
          </div>
          <button
            aria-label="Close"
            className="text-slate-400 hover:text-white"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && <LoadingState label="Loading assumption assessment" />}
        {error && <ErrorState message={error} onRetry={refetch} />}

        {!loading && !error && data && (
          <>
            <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
              {data.packet ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[11px] font-semibold text-teal-300">
                      {data.packet.disposition === "recorded"
                        ? `${data.packet.items.length} assumption${data.packet.items.length === 1 ? "" : "s"} recorded`
                        : "No material assumptions identified"}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {data.recordedByName ?? "Named user"}
                      {data.recordedAt
                        ? ` · ${new Date(data.recordedAt).toLocaleString()}`
                        : ""}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-300">
                    {data.packet.basis}
                  </p>
                  {data.packet.items.map((item, index) => (
                    <div
                      key={`${item.statement}-${index}`}
                      className="mt-3 rounded-lg border border-white/6 bg-black/20 p-3 text-xs leading-5"
                    >
                      <p className="font-semibold text-slate-200">
                        {item.statement}
                      </p>
                      <p className="mt-1 text-slate-400">
                        <span className="text-slate-500">Basis:</span>{" "}
                        {item.basis}
                      </p>
                      <p className="mt-1 text-amber-200/80">
                        <span className="text-slate-500">If wrong:</span>{" "}
                        {item.consequence_if_wrong}
                      </p>
                      <p className="mt-1 text-teal-200/80">
                        <span className="text-slate-500">Validate:</span>{" "}
                        {item.validation_method}
                      </p>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex gap-2 text-sm text-amber-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    No assumption assessment is recorded. This recommendation is
                    not releasable: a blank does not mean no assumptions.
                  </p>
                </div>
              )}
            </div>

            <p className="mt-3 rounded-lg border border-sky-500/15 bg-sky-500/5 p-3 text-xs leading-5 text-slate-400">
              {data.boundary}
            </p>

            {canGovern && !locked && (
              <form className="mt-5 space-y-4" onSubmit={submit}>
                <fieldset>
                  <legend className="text-xs font-semibold text-slate-300">
                    Named-human disposition
                  </legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(["recorded", "none_identified"] as const).map((value) => (
                      <label
                        key={value}
                        className={`cursor-pointer rounded-lg border p-3 text-xs ${disposition === value ? "border-teal-500/40 bg-teal-500/10 text-teal-200" : "border-white/8 text-slate-400"}`}
                      >
                        <input
                          className="mr-2"
                          type="radio"
                          name="assumption-disposition"
                          value={value}
                          checked={disposition === value}
                          onChange={() => setDisposition(value)}
                        />
                        {value === "recorded"
                          ? "Record material assumptions"
                          : "No material assumptions identified"}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <Field
                  label="Overall assessment basis"
                  value={basis}
                  onChange={setBasis}
                  placeholder="Explain the scope examined and why this disposition is defensible."
                />

                {disposition === "recorded" && (
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div
                        key={index}
                        className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-xs font-semibold text-slate-300">
                            Assumption {index + 1}
                          </p>
                          {items.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Remove assumption ${index + 1}`}
                              onClick={() =>
                                setItems((current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                )
                              }
                              className="text-slate-500 hover:text-red-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {(
                            [
                              [
                                "statement",
                                "Assumption",
                                "State what is being treated as true.",
                              ],
                              [
                                "basis",
                                "Evidence or reasoning basis",
                                "State why this assumption is currently necessary.",
                              ],
                              [
                                "consequence_if_wrong",
                                "Consequence if wrong",
                                "State how the decision, risk or value case changes.",
                              ],
                              [
                                "validation_method",
                                "Validation method",
                                "State the observation, test or source that will resolve it.",
                              ],
                            ] as const
                          ).map(([key, label, placeholder]) => (
                            <Field
                              key={key}
                              label={label}
                              value={item[key]}
                              placeholder={placeholder}
                              onChange={(value) =>
                                setItems((current) =>
                                  current.map((entry, itemIndex) =>
                                    itemIndex === index
                                      ? { ...entry, [key]: value }
                                      : entry,
                                  ),
                                )
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setItems((current) => [...current, { ...EMPTY_ITEM }])
                      }
                      className="flex items-center gap-1.5 text-xs font-medium text-teal-300 hover:text-teal-200"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add another assumption
                    </button>
                  </div>
                )}

                <Field
                  label="Review note"
                  value={note}
                  onChange={setNote}
                  placeholder="Record why this assessment is appropriate for this recommendation."
                />

                {saveError && (
                  <p className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">
                    {saveError}
                  </p>
                )}
                {saved && (
                  <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                    {saved}
                  </p>
                )}
                <button
                  disabled={saving}
                  className="rounded-lg border border-teal-500/30 bg-teal-500/20 px-4 py-2 text-xs font-semibold text-teal-200 hover:bg-teal-500/30 disabled:opacity-50"
                  type="submit"
                >
                  {saving ? "Recording…" : "Record assumption assessment"}
                </button>
              </form>
            )}

            {locked && (
              <p className="mt-4 text-xs text-slate-500">
                This recommendation is {data.recommendationStatus}; its decision
                basis is frozen. Return it to governed review before recording a
                different assumption packet.
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
