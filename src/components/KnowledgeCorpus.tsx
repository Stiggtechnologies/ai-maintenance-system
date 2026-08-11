/**
 * KnowledgeCorpus — what the knowledge base is allowed to answer, and for whom
 * (capability register E12 data governance, U19 AI governance).
 *
 * Two things this panel exists to make visible, because neither is visible in a
 * retrieval result:
 *
 *   1. Standing. Every document class has jurisdiction over some kinds of claim
 *      and none over others. A brochure is authoritative about rated power and
 *      has nothing to say about how a final drive fails — and once chunked, both
 *      render as identical grey text with a citation.
 *
 *   2. Tenancy. Shared corpus and client-private material sit in one table. A
 *      client must be able to see how much of what answers them is theirs.
 */
import { useMemo } from "react";
import { BookLock, Info, ShieldAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { assessCorpus, type CorpusClassRow } from "../lib/knowledge-governance";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

const CLAIM_LABEL: Record<string, string> = {
  analysis_method: "method",
  failure_behaviour: "failure behaviour",
  component_structure: "construction",
  maintenance_task: "maintenance tasks",
  nameplate_spec: "rated figures",
};

export function KnowledgeCorpus() {
  const { data, loading, error, refetch } = useAsyncData<
    CorpusClassRow[]
  >(async () => {
    const { data: rows, error: e } = await supabase.rpc(
      "get_kb_corpus_posture",
    );
    if (e) throw new Error(e.message);
    return ((rows as CorpusClassRow[]) ?? []).map((r) => ({
      ...r,
      trustRank: Number(r.trustRank),
      sharedChunks: Number(r.sharedChunks),
      clientChunks: Number(r.clientChunks),
      sources: Number(r.sources),
    }));
  }, []);

  const posture = useMemo(() => assessCorpus(data ?? []), [data]);

  if (loading) return <LoadingState label="Loading knowledge corpus" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section aria-labelledby="corpus-heading" className="space-y-4">
      <div>
        <h2
          id="corpus-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <BookLock className="h-5 w-5 text-signal-cyan" aria-hidden />
          Knowledge Corpus
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A document can be authoritative about one thing and have nothing to
          say about another. Retrieval renders both the same way, so standing is
          enforced before the citation is written.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{posture.reason}</p>
      </div>

      {posture.policyConflicts.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {posture.policyConflicts.join(", ")} may sit in the shared corpus
            and may not be redistributed. Every tenant can retrieve text none of
            them may be shown.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/6">
        <table className="w-full min-w-[46rem] text-sm">
          <caption className="sr-only">
            Knowledge-base document classes, what each may be cited for, and how
            many chunks of each the corpus holds
          </caption>
          <thead>
            <tr className="border-b border-white/6 text-left text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="p-3 font-medium">
                Document class
              </th>
              <th scope="col" className="p-3 font-medium">
                May be cited for
              </th>
              <th scope="col" className="p-3 text-right font-medium">
                Shared
              </th>
              <th scope="col" className="p-3 text-right font-medium">
                Yours
              </th>
              <th scope="col" className="p-3 font-medium">
                Scope
              </th>
            </tr>
          </thead>
          <tbody>
            {posture.rows.map((r) => (
              <tr
                key={r.documentClass}
                className="border-b border-white/6 last:border-0"
              >
                <td className="p-3">
                  <span className="text-slate-200">{r.label}</span>
                  <span className="ml-2 font-mono text-xs text-slate-600">
                    rank {r.trustRank}
                  </span>
                </td>
                <td className="p-3">
                  {r.permittedClaims.length === 0 ? (
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-300">
                      nothing
                    </span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {r.permittedClaims.map((c) => (
                        <span
                          key={c}
                          className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-300"
                        >
                          {CLAIM_LABEL[c] ?? c}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="p-3 text-right font-mono tabular-nums text-slate-400">
                  {r.sharedChunks || "—"}
                </td>
                <td className="p-3 text-right font-mono tabular-nums text-signal-cyan">
                  {r.clientChunks || "—"}
                </td>
                <td className="p-3 text-xs text-slate-500">
                  {r.mayBeGlobal ? "shared corpus" : "per-client only"}
                  {!r.redistributable && " · cite, don't quote"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {posture.claimTypesWithNoSource.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">
          <p>
            No stocked source for{" "}
            {posture.claimTypesWithNoSource
              .map((c) => CLAIM_LABEL[c] ?? c)
              .join(", ")}
            . A question of that kind returns nothing because the shelf is
            empty, not because the corpus considered it — and those two look
            identical from the outside.
          </p>
        </div>
      )}
    </section>
  );
}
