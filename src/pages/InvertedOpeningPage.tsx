/**
 * Inverted onboarding P0 — Ask-first Decision Case.
 * Arrive → Ask → Save (workspace) → evidence → recommend → decide → verify.
 * Example prompts fill the box only. They are never written to a workspace.
 */
import { useState } from "react";
import { ArrowRight, Shield } from "lucide-react";
import { useOptionalAuth } from "../components/AuthProvider";
import {
  INVERTED_EXAMPLE_PROMPTS,
  INVERTED_INTENT_CARDS,
  INVERTED_OPENING_AUTHORITY,
  INVERTED_OPENING_HEADLINE,
  INVERTED_OPENING_SUB,
  isExamplePrompt,
  type InvertedIntentId,
} from "../lib/onboarding/inverted-opening";
import {
  SPINE_SAVED_CASE_KEY,
  buildSpineDecisionCase,
} from "../lib/onboarding/decision-case-spine";
import type { DecisionCase } from "../lib/decision-case";
import {
  createPersistedDecisionCase,
  isPersistedDecisionCase,
  loadPersistedDecisionCase,
} from "../services/decisionCaseService";
import { DecisionCaseSpine } from "./DecisionCaseSpine";

function rememberSavedCase(id: string) {
  if (!isPersistedDecisionCase(id)) return;
  try {
    localStorage.setItem(SPINE_SAVED_CASE_KEY, id);
  } catch {
    /* The case itself remains on the workspace if the write succeeded. */
  }
}

export function InvertedOpeningPage() {
  const auth = useOptionalAuth();
  const [ask, setAsk] = useState("");
  const [intent, setIntent] = useState<InvertedIntentId>("solve");
  const [savePrompt, setSavePrompt] = useState(false);
  const [spineQuestion, setSpineQuestion] = useState("");
  const [examplePreview, setExamplePreview] = useState(false);
  const [persistedCase, setPersistedCase] = useState<
    DecisionCase | undefined
  >();
  const [persistError, setPersistError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const canSave = ask.trim().length >= 12;
  const exampleText = isExamplePrompt(ask);

  const openSpine = (
    question: string,
    preview: boolean,
    saved?: DecisionCase,
    error?: string | null,
  ) => {
    setExamplePreview(preview);
    setPersistedCase(saved);
    setPersistError(error ?? null);
    setSpineQuestion(question);
  };

  const confirmSave = async () => {
    const question = ask.trim();
    if (isExamplePrompt(question)) {
      openSpine(question, true);
      return;
    }
    let draft: DecisionCase;
    try {
      draft = buildSpineDecisionCase({ question, intent });
    } catch (caught) {
      setPersistError(
        caught instanceof Error
          ? caught.message
          : "This question cannot start a case.",
      );
      return;
    }
    if (!auth?.user) {
      openSpine(question, false);
      return;
    }
    setBusy(true);
    try {
      const persisted = await createPersistedDecisionCase(draft, {});
      rememberSavedCase(persisted.id);
      openSpine(question, false, persisted, null);
    } catch (caught) {
      openSpine(
        question,
        false,
        undefined,
        caught instanceof Error
          ? caught.message
          : "Workspace save did not complete. The assessment stays in this session.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resumeSaved = async () => {
    let id: string;
    try {
      id = localStorage.getItem(SPINE_SAVED_CASE_KEY) ?? "";
    } catch {
      id = "";
    }
    if (!isPersistedDecisionCase(id)) {
      setResumeError("No saved Decision Case is recorded in this browser.");
      return;
    }
    setBusy(true);
    try {
      const loaded = await loadPersistedDecisionCase(id);
      if (!loaded || isExamplePrompt(loaded.objective)) {
        setResumeError("That saved case could not be loaded.");
        return;
      }
      setIntent(
        loaded.intakeRole === "coordinate" || loaded.intakeRole === "connect"
          ? loaded.intakeRole
          : "solve",
      );
      setAsk(loaded.objective);
      openSpine(loaded.objective, false, loaded, null);
    } catch (caught) {
      setResumeError(
        caught instanceof Error
          ? caught.message
          : "Could not reload the saved case.",
      );
    } finally {
      setBusy(false);
    }
  };

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
          <p className="text-sm leading-relaxed text-slate-300">
            {INVERTED_OPENING_SUB}
          </p>
          <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" />
            <span>{INVERTED_OPENING_AUTHORITY}</span>
          </div>
        </header>

        {!spineQuestion ? (
          <>
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
                What are you here to accomplish?
              </p>
              <p className="text-xs text-slate-500">
                Intent — not a permission role. Approval authority is named on
                the Decision Case when the decision needs it.
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
                    <p className="text-sm font-semibold text-white">
                      {card.title}
                    </p>
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
                onClick={() => {
                  setPersistError(null);
                  setSavePrompt(true);
                }}
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
                  {exampleText
                    ? "This text is an Example prompt. It stays an affordance and is not saved into your workspace. Rewrite it as your question, or preview the loop without saving."
                    : auth?.user
                      ? "Saving creates the Decision Case on your evaluation workspace. Ask already happened — org setup is not repeated here. Pricing stays out of this path."
                      : "The Decision Case continues now, before an organization form. A workspace is created only if you save after sign-in. Pricing stays out of this path."}
                </p>
                {persistError ? (
                  <p role="alert" className="text-xs text-red-300">
                    {persistError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="inverted-save-continue"
                    disabled={busy}
                    className="rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"
                    onClick={() => void confirmSave()}
                  >
                    {busy
                      ? "Saving…"
                      : exampleText
                        ? "Preview without saving"
                        : "Save and continue"}
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
            <button
              type="button"
              data-testid="inverted-resume"
              className="text-xs font-semibold text-teal-300"
              onClick={() => void resumeSaved()}
            >
              Resume a saved Decision Case
            </button>
            {resumeError ? (
              <p role="alert" className="text-xs text-red-300">
                {resumeError}
              </p>
            ) : null}
          </>
        ) : null}

        {spineQuestion ? (
          <DecisionCaseSpine
            question={spineQuestion}
            intent={intent}
            initialCase={persistedCase}
            initiallySaved={Boolean(persistedCase)}
            blockWorkspacePersist={examplePreview}
            openingNotice={persistError}
          />
        ) : (
          <p className="text-center text-[11px] text-slate-600">
            Decision Case spine opens after save. Not marketed as seamless
            self-guided until the acceptance test passes.
          </p>
        )}
      </div>
    </main>
  );
}
