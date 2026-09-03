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
import {
  canGovernTaxonomy,
  proposeTaxonomyRevision,
} from "../services/reliabilityCallers";

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

export function TaxonomyGovernance() {
  const { profile } = useAuth();
  const { data, loading, error, refetch } = useAsyncData<TaxonomyDef[]>(
    getDefinitions,
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [proposing, setProposing] = useState<string | null>(null);
  const [definition, setDefinition] = useState("");
  const [basis, setBasis] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const canAdopt = canGovernTaxonomy(profile?.role as string | undefined);

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
        <p
          data-testid="taxonomy-honesty"
          className="mt-2 rounded-xl border border-white/8 bg-industrial-black/60 px-4 py-3 text-xs text-slate-400"
        >
          Proposing a revision writes the next version as a draft. It does not
          replace adopted truth. Adoption records the signed-in person. The
          AI-operator identity is not offered propose or adopt.
        </p>
      </div>

      {flash && (
        <p className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm text-slate-200">
          {flash}
        </p>
      )}

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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-600">Basis: {d.basis}</span>
              <div className="flex gap-2">
                {canAdopt && (
                  <button
                    type="button"
                    onClick={() => {
                      setProposing(d.def_key);
                      setDefinition(d.definition);
                      setBasis("");
                      setFlash(null);
                    }}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-white/5"
                  >
                    Propose revision
                  </button>
                )}
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
            </div>
          </li>
        ))}
      </ul>

      {proposing && (
        <form
          aria-label="Propose taxonomy revision"
          className="space-y-3 rounded-xl border border-white/8 bg-overlook-deep/40 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(proposing);
            setFlash(null);
            try {
              const result = await proposeTaxonomyRevision(
                proposing,
                definition,
                basis,
              );
              setFlash(
                `Draft v${result.version} written. Adopted truth is unchanged until a named human adopts this draft.`,
              );
              setProposing(null);
              setDefinition("");
              setBasis("");
              refetch();
            } catch (err) {
              setFlash(
                err instanceof Error ? err.message : "That did not work.",
              );
            } finally {
              setBusy(null);
            }
          }}
        >
          <p className="text-sm text-slate-300">
            Proposing <span className="font-mono">{proposing}</span> creates the
            next version as a draft. It does not authorize the new wording.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">
              Proposed definition
            </span>
            <textarea
              aria-label="Proposed taxonomy definition"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">
              Basis for the proposal
            </span>
            <input
              aria-label="Taxonomy revision basis"
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy === proposing || definition.trim().length < 20}
              className="rounded-lg border border-signal-gold/40 bg-signal-gold/10 px-3 py-1.5 text-sm font-medium text-signal-gold hover:bg-signal-gold/20 disabled:opacity-40"
            >
              Submit proposal
            </button>
            <button
              type="button"
              onClick={() => setProposing(null)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
