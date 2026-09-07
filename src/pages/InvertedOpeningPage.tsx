/**
 * Inverted onboarding P0.1 — Ask-first opening.
 * Arrive → Ask → Save (workspace) … Decision Case spine follows in P0.2+.
 * Examples are labeled Examples only — never seed a customer workspace.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Shield } from "lucide-react";
import {
  INVERTED_EXAMPLE_PROMPTS,
  INVERTED_INTENT_CARDS,
  INVERTED_OPENING_AUTHORITY,
  INVERTED_OPENING_HEADLINE,
  type InvertedIntentId,
} from "../lib/onboarding/inverted-opening";

export function InvertedOpeningPage() {
  const navigate = useNavigate();
  const [ask, setAsk] = useState("");
  const [intent, setIntent] = useState<InvertedIntentId>("solve");
  const [savePrompt, setSavePrompt] = useState(false);

  const canSave = useMemo(() => ask.trim().length >= 12, [ask]);

  return (
    <main
      data-testid="inverted-opening"
      className="min-h-screen bg-[#0B0F14] px-4 py-10 text-[#E6EDF3]"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">
            Sync · first decision
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            {INVERTED_OPENING_HEADLINE}
          </h1>
          <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" />
            <span>{INVERTED_OPENING_AUTHORITY}</span>
          </div>
        </header>

        <section className="space-y-3">
          <label className="block text-sm font-semibold text-slate-200">
            Ask
          </label>
          <textarea
            data-testid="inverted-ask"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            rows={4}
            placeholder="What engineering decision do you need to make?"
            className="w-full rounded-2xl border border-white/10 bg-[#0D1520] px-4 py-3 text-sm text-white outline-none ring-teal-400/40 placeholder:text-slate-500 focus:ring-2"
          />
          <div className="flex flex-wrap gap-2">
            {INVERTED_EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.id}
                type="button"
                data-testid={`inverted-example-${ex.id}`}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:border-teal-400/40"
                onClick={() => setAsk(ex.prompt)}
              >
                <span className="mr-1 font-semibold text-slate-500">
                  {ex.label}:
                </span>
                {ex.prompt.slice(0, 42)}…
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-sm font-semibold text-slate-200">
            What are you here to do?
          </p>
          <p className="text-xs text-slate-500">
            Intent cards — not permission roles. Permissions are configured
            later.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {INVERTED_INTENT_CARDS.map((card) => (
              <button
                key={card.id}
                type="button"
                data-testid={`inverted-intent-${card.id}`}
                onClick={() => setIntent(card.id)}
                className={`rounded-2xl border p-3 text-left ${
                  intent === card.id
                    ? "border-teal-400/50 bg-teal-500/10"
                    : "border-white/10 bg-[#0D1520]"
                }`}
              >
                <p className="text-sm font-semibold text-white">{card.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {card.body}
                </p>
              </button>
            ))}
          </div>
        </section>

        {!savePrompt ? (
          <button
            type="button"
            data-testid="inverted-continue"
            disabled={!canSave}
            onClick={() => setSavePrompt(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-40"
          >
            Continue with this question
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <div
            data-testid="inverted-save-gate"
            className="space-y-3 rounded-2xl border border-teal-500/30 bg-[#0D1520] p-4"
          >
            <p className="text-sm font-semibold text-white">
              Save this assessment and continue?
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              Creating a workspace keeps this Decision Case durable. Ask came
              first — heavy setup waits. Pricing is out of this 20-minute path.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-slate-950"
                onClick={() => {
                  const q = encodeURIComponent(ask.trim());
                  const i = encodeURIComponent(intent);
                  navigate(`/?view=signup&invertedAsk=${q}&intent=${i}`);
                }}
              >
                Save and continue
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200"
                onClick={() => setSavePrompt(false)}
              >
                Keep editing Ask
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-slate-600">
          P0.1 opening only — Decision Case auto-build, evidence, disposition,
          and verification ship in follow-on PRs. Not marketed as seamless
          self-guided until the acceptance test passes.
        </p>
      </div>
    </main>
  );
}
