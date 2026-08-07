/**
 * TaxonomyGovernance — the enterprise failure taxonomy as versioned master
 * data (capability register C3.01–C3.12).
 *
 * Definitions seed as DRAFTS with their conceptual basis stated; an
 * accountable human adopts them (recorded), and revisions create new draft
 * versions rather than editing adopted truth.
 */
import { BookMarked, CheckCircle2, FileClock } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { LoadingState, ErrorState } from "./ui/AsyncStates";
import { useState } from "react";

interface TaxonomyDef {
  id: string;
  def_key: string;
  title: string;
  definition: string;
  basis: string | null;
  register_ref: string;
  version: number;
  status: "draft" | "adopted" | "superseded";
}

async function getDefinitions(): Promise<TaxonomyDef[]> {
  const { data, error } = await supabase
    .from("taxonomy_definitions")
    .select(
      "id, def_key, title, definition, basis, register_ref, version, status",
    )
    .neq("status", "superseded")
    .order("register_ref");
  if (error) throw new Error(error.message);
  return (data ?? []) as TaxonomyDef[];
}

const ADOPT_ROLES = new Set([
  "admin",
  "ai_admin",
  "reliability_engineer",
  "maintenance_manager",
]);

export function TaxonomyGovernance() {
  const { profile } = useAuth();
  const { data, loading, error, refetch } = useAsyncData<TaxonomyDef[]>(
    getDefinitions,
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const canAdopt = ADOPT_ROLES.has((profile?.role as string) ?? "");

  if (loading) return <LoadingState label="Loading failure taxonomy" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const defs = data ?? [];
  const adopted = defs.filter((d) => d.status === "adopted").length;

  return (
    <section aria-labelledby="taxonomy-heading" className="space-y-4">
      <div>
        <h2
          id="taxonomy-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <BookMarked className="h-5 w-5 text-signal-cyan" aria-hidden />
          Enterprise Failure Taxonomy
          <span className="text-xs font-normal text-slate-500">
            {adopted}/{defs.length} adopted
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          The governed definitions every site must share — versioned master
          data. Drafts state their conceptual basis; adoption is an accountable
          human act, and revisions supersede rather than overwrite.
        </p>
      </div>

      <ul className="grid gap-3 lg:grid-cols-2">
        {defs.map((d) => (
          <li
            key={d.id}
            className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-200">
                {d.title}
              </h3>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[11px] text-slate-500">
                  {d.register_ref} · v{d.version}
                </span>
                {d.status === "adopted" ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-xs text-teal-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden /> adopted
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-signal-gold/30 bg-signal-gold/10 px-2 py-0.5 text-xs text-signal-gold">
                    <FileClock className="h-3 w-3" aria-hidden /> draft
                  </span>
                )}
              </div>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {d.definition}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">Basis: {d.basis}</span>
              {d.status === "draft" && canAdopt && (
                <button
                  disabled={busy === d.id}
                  onClick={async () => {
                    setBusy(d.id);
                    try {
                      await supabase.rpc("adopt_taxonomy_definition", {
                        p_id: d.id,
                      });
                      refetch();
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="rounded-lg border border-signal-gold/40 bg-signal-gold/10 px-2.5 py-1 text-xs font-medium text-signal-gold hover:bg-signal-gold/20 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
                >
                  Adopt
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
