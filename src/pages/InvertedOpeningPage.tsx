/**
 * Inverted onboarding P0 — Ask-first Decision Case.
 * Arrive → Ask → Save (workspace) → evidence → recommend → decide → verify.
 * Example prompts fill the box only. They are never written to a workspace.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Shield } from "lucide-react";
import { useOptionalAuth } from "../components/AuthProvider";
import { hasWorkspaceMembership } from "../lib/auth";
import {
  INVERTED_EXAMPLE_PROMPTS,
  INVERTED_INTENT_CARDS,
  INVERTED_OPENING_AUTHORITY,
  INVERTED_OPENING_HEADLINE,
  INVERTED_OPENING_SUB,
  INVERTED_RETENTION_NOTICE,
  isExamplePrompt,
  type InvertedIntentId,
} from "../lib/onboarding/inverted-opening";
import {
  SPINE_SAVED_CASE_KEY,
  bannedSeedSubjectMessage,
  buildSpineDecisionCase,
  findBannedSeedSubject,
} from "../lib/onboarding/decision-case-spine";
import {
  normalizeDecisionIndustry,
  stageDecisionCaseHandoff,
  type DecisionCase,
} from "../lib/decision-case";
import { isSeedDecisionCaseId } from "../lib/decision-case-honesty";
import {
  createPersistedDecisionCase,
  isPersistedDecisionCase,
  listRecentPersistedDecisionCases,
  loadPersistedDecisionCase,
  type RecentDecisionCase,
} from "../services/decisionCaseService";
import {
  evaluationRestoreDestination,
  readEvaluationDraftLocation,
  rememberEvaluationDraft,
} from "../lib/onboarding/evaluation-assistant-handoff";
import { DecisionCaseSpine } from "./DecisionCaseSpine";
import { productEntryById } from "../lib/product-entry-paths";
import { PublicJourneyHeader } from "../components/PublicJourneyHeader";
import { HelpCenterWidget } from "../components/HelpCenterWidget";
import { SelfServeProgressChecklist } from "../components/onboarding/SelfServeProgressChecklist";
import {
  isReviewableSavedRecommendation,
  selfServeProgress,
  suppliedEvidenceCount,
} from "../lib/onboarding/self-serve-progress";
import { usePublicJourneyTheme } from "../lib/use-public-journey-theme";
import type { SelfServeNavInput } from "../lib/onboarding/self-serve-nav";

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
  const entry = productEntryById(
    new URLSearchParams(window.location.search).get("entry") ?? "",
  );
  const [hasWorkspace, setHasWorkspace] = useState(false);
  useEffect(() => {
    const userId = auth?.user?.id ?? "";
    if (!userId) {
      setHasWorkspace(false);
      return;
    }
    let cancelled = false;
    void hasWorkspaceMembership(userId).then((value) => {
      if (!cancelled) setHasWorkspace(value);
    });
    return () => {
      cancelled = true;
    };
  }, [auth?.user?.id]);
  const journeyTheme = usePublicJourneyTheme();
  const [restored] = useState(() =>
    readEvaluationDraftLocation(window.location.search, window.sessionStorage),
  );
  const [ask, setAsk] = useState(restored?.decisionCase.objective ?? "");
  const [intent, setIntent] = useState<InvertedIntentId>(() =>
    restored?.decisionCase.intakeRole === "coordinate" ||
    restored?.decisionCase.intakeRole === "connect"
      ? restored.decisionCase.intakeRole
      : "solve",
  );
  const [savePrompt, setSavePrompt] = useState(false);
  const [spineQuestion, setSpineQuestion] = useState(
    restored && restored.view !== "ask" ? restored.decisionCase.objective : "",
  );
  const [examplePreview, setExamplePreview] = useState(false);
  const [persistedCase, setPersistedCase] = useState<DecisionCase | undefined>(
    restored?.decisionCase,
  );
  // A restored case owns its industry; a new case uses the acquisition link.
  const industry = normalizeDecisionIndustry(
    persistedCase?.industry ??
      new URLSearchParams(window.location.search).get("industry"),
  );
  const [caseSaved, setCaseSaved] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [stageNarration, setStageNarration] = useState<string | null>(null);
  const onNarrationScript = useCallback((script: string) => {
    setStageNarration(script);
  }, []);
  useEffect(() => {
    if (!spineQuestion) setStageNarration(null);
  }, [spineQuestion]);

  const rememberCurrentCase = useCallback(
    (next: DecisionCase, currentRevisionSaved: boolean) => {
      setPersistedCase(next);
      setCaseSaved(currentRevisionSaved);
      try {
        const search = window.location.search;
        window.history.replaceState(
          null,
          "",
          rememberEvaluationDraft(next, search, window.sessionStorage),
        );
        if (
          !isExamplePrompt(next.objective) &&
          !isSeedDecisionCaseId(next.id)
        ) {
          stageDecisionCaseHandoff(window.sessionStorage, next);
        }
      } catch {
        setPersistError(
          "This browser could not retain the draft through refresh. Keep this page open and export the proof summary.",
        );
      }
    },
    [],
  );

  const [resumeCandidate, setResumeCandidate] =
    useState<RecentDecisionCase | null>(null);

  useEffect(() => {
    if (!auth?.user) {
      setResumeCandidate(null);
      return;
    }
    let active = true;
    void listRecentPersistedDecisionCases(1)
      .then((rows) => {
        if (active) setResumeCandidate(rows[0] ?? null);
      })
      .catch(() => {
        // Resume remains available through the browser pointer. Discovery is
        // an enhancement and must not turn a transient list error into a dead
        // end on the first-decision page.
      });
    return () => {
      active = false;
    };
  }, [auth?.user]);

  const seedPhrase = findBannedSeedSubject(ask);
  const canSave = ask.trim().length >= 12 && !seedPhrase;
  const exampleText = isExamplePrompt(ask);
  const savedRevision =
    caseSaved &&
    persistedCase != null &&
    isPersistedDecisionCase(persistedCase.id);
  const progress = selfServeProgress({
    signedIn: Boolean(auth?.user),
    hasWorkspace,
    accountExists: Boolean(auth?.user),
    question: spineQuestion || ask,
    draftOpen: Boolean(spineQuestion) && !savedRevision,
    caseSaved: savedRevision,
    exampleOnly: examplePreview || (!spineQuestion && exampleText),
    savedSuppliedEvidence: savedRevision
      ? suppliedEvidenceCount(persistedCase?.evidence)
      : 0,
    savedRecommendation:
      savedRevision &&
      isReviewableSavedRecommendation(persistedCase?.recommendation),
  });
  const signupReturn = persistedCase
    ? evaluationRestoreDestination(persistedCase, window.location.search)
    : `/get-started${window.location.search}`;
  const signupHref = `/?view=signup&returnTo=${encodeURIComponent(signupReturn)}`;
  const carriedCaseId = new URLSearchParams(window.location.search).get("case");
  const draftCarried =
    Boolean(persistedCase) &&
    carriedCaseId === persistedCase?.id &&
    persistedCase.objective.trim() === ask.trim();
  const firstValueDone =
    progress.steps.find((step) => step.id === "first_value")?.status === "done";
  const selfServeGate: SelfServeNavInput = savedRevision
    ? {
        decisionCaseSaved: true,
        draftOpen: false,
        continueHref: signupHref,
        continueLabel: "Save this Decision Case",
        askHref: "#inverted-ask",
      }
    : examplePreview
      ? {
          decisionCaseSaved: false,
          draftOpen: true,
          continueHref: "#back-to-question",
          continueLabel: "Rewrite in your own words",
          askHref: "#inverted-ask",
        }
      : spineQuestion
        ? {
            decisionCaseSaved: false,
            draftOpen: true,
            continueHref: auth?.user ? "#spine-save-workspace" : signupHref,
            continueLabel: "Save this Decision Case",
            askHref: "#inverted-ask",
          }
        : canSave && !exampleText
          ? {
              decisionCaseSaved: false,
              draftOpen: true,
              continueHref: "#inverted-continue",
              continueLabel: "Continue with this question",
              askHref: "#inverted-ask",
            }
          : {
              decisionCaseSaved: false,
              draftOpen: false,
              continueHref: signupHref,
              continueLabel: "Save this Decision Case",
              askHref: "#inverted-ask",
            };
  const unsavedQuestionWarning =
    ask.trim().length >= 12 && !exampleText && !seedPhrase && !draftCarried
      ? "This question is not saved. Leave this page?"
      : undefined;

  const openSpine = (
    question: string,
    preview: boolean,
    saved?: DecisionCase,
    error?: string | null,
    currentRevisionSaved = false,
  ) => {
    setExamplePreview(preview);
    setPersistedCase(saved);
    setCaseSaved(currentRevisionSaved);
    setPersistError(error ?? null);
    setSpineQuestion(question);
  };

  const confirmSave = async () => {
    const question = ask.trim();
    if (
      persistedCase?.objective === question &&
      persistedCase.intakeRole === intent
    ) {
      openSpine(
        question,
        isExamplePrompt(question),
        persistedCase,
        null,
        caseSaved,
      );
      return;
    }
    if (isExamplePrompt(question)) {
      openSpine(question, true);
      return;
    }
    let draft: DecisionCase;
    try {
      draft = buildSpineDecisionCase({ question, intent, industry });
    } catch (caught) {
      setPersistError(
        caught instanceof Error
          ? caught.message
          : "This question cannot start a case.",
      );
      return;
    }
    if (!auth?.user) {
      openSpine(question, false, draft);
      return;
    }
    setBusy(true);
    try {
      const persisted = await createPersistedDecisionCase(draft, {});
      if (!isPersistedDecisionCase(persisted.id))
        throw new Error("Workspace save did not return a persisted case.");
      rememberSavedCase(persisted.id);
      setResumeCandidate({
        id: persisted.id,
        decisionCase: persisted,
        updatedAt: persisted.updatedAt,
      });
      openSpine(question, false, persisted, null, true);
    } catch (caught) {
      openSpine(
        question,
        false,
        draft,
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
    setBusy(true);
    try {
      const loaded = isPersistedDecisionCase(id)
        ? await loadPersistedDecisionCase(id)
        : (resumeCandidate?.decisionCase ??
          (await listRecentPersistedDecisionCases(1))[0]?.decisionCase ??
          null);
      if (!loaded || isExamplePrompt(loaded.objective)) {
        setResumeError(
          auth?.user
            ? "No tenant-scoped Decision Case is available to resume."
            : "No saved Decision Case is recorded in this browser.",
        );
        return;
      }
      rememberSavedCase(loaded.id);
      setIntent(
        loaded.intakeRole === "coordinate" || loaded.intakeRole === "connect"
          ? loaded.intakeRole
          : "solve",
      );
      setAsk(loaded.objective);
      openSpine(loaded.objective, false, loaded, null, true);
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

  // Bumped when the canonical case loaded from the workspace is newer than
  // the copy restored from this tab's session, so the Spine remounts on the
  // server state instead of keeping a stale browser copy (same case id).
  const [canonicalLoad, setCanonicalLoad] = useState(0);
  const restoredRevision = useRef(
    restored
      ? {
          id: restored.decisionCase.id,
          revision: restored.decisionCase.revision ?? 0,
        }
      : null,
  );

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("case") ?? "";
    if (!isPersistedDecisionCase(id)) return;
    let cancelled = false;
    void loadPersistedDecisionCase(id)
      .then((loaded) => {
        if (cancelled || !loaded || isExamplePrompt(loaded.objective)) return;
        setAsk(loaded.objective);
        setIntent(
          loaded.intakeRole === "coordinate" || loaded.intakeRole === "connect"
            ? loaded.intakeRole
            : "solve",
        );
        setPersistedCase(loaded);
        setCaseSaved(true);
        setExamplePreview(false);
        if (
          restoredRevision.current?.id === loaded.id &&
          restoredRevision.current.revision !== (loaded.revision ?? 0)
        ) {
          setCanonicalLoad((count) => count + 1);
        }
        if (new URLSearchParams(window.location.search).get("view") !== "ask") {
          setSpineQuestion(loaded.objective);
        }
      })
      .catch(() => {
        /* The session draft stays visible and is not claimed as saved. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signInToSave = () => {
    const question = ask.trim();
    if (!question || exampleText || findBannedSeedSubject(question)) return;
    let draftCase = persistedCase;
    if (
      !draftCase ||
      draftCase.objective !== question ||
      draftCase.intakeRole !== intent
    ) {
      try {
        draftCase = buildSpineDecisionCase({ question, intent, industry });
      } catch (caught) {
        setPersistError(
          caught instanceof Error
            ? caught.message
            : "This question cannot start a case.",
        );
        return;
      }
    }
    try {
      const search = window.location.search;
      rememberEvaluationDraft(draftCase, search, window.sessionStorage);
      if (!isSeedDecisionCaseId(draftCase.id)) {
        stageDecisionCaseHandoff(window.sessionStorage, draftCase);
      }
      const returnTo = evaluationRestoreDestination(draftCase, search);
      window.location.assign(
        `/?view=signup&returnTo=${encodeURIComponent(returnTo)}`,
      );
    } catch {
      setPersistError(
        "This browser could not retain the draft. Keep this page open.",
      );
    }
  };

  return (
    <main
      data-testid="inverted-opening"
      className="public-journey journey-evaluation"
      data-theme={journeyTheme.theme}
    >
      <PublicJourneyHeader
        unsavedQuestionWarning={unsavedQuestionWarning}
        selfServeGate={selfServeGate}
      />
      <div className="journey-evaluation-body mx-auto flex w-full flex-col gap-6">
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
        <SelfServeProgressChecklist
          progress={progress}
          signupHref={signupHref}
          narrationScript={
            spineQuestion ? (stageNarration ?? undefined) : undefined
          }
        />

        {entry ? (
          <aside
            data-testid="entry-context"
            className="rounded-xl border border-teal-300/20 p-4 text-sm text-slate-300"
          >
            <h2 className="font-semibold text-white">{entry.name}</h2>
            <p className="mt-2">Bring: {entry.input}</p>
            <p className="mt-2">{entry.boundary}</p>
            <p className="mt-2">
              Describe your own question below. This entry does not load example
              data or grant workspace permissions.
            </p>
          </aside>
        ) : null}

        {!spineQuestion ? (
          <>
            <section className="space-y-3">
              <label className="block text-sm font-semibold text-slate-200">
                Ask
              </label>
              <textarea
                id="inverted-ask"
                data-testid="inverted-ask"
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                rows={4}
                placeholder="What engineering decision do you need to make?"
                className="w-full rounded-2xl border border-white/10 bg-[#0D1520] px-4 py-3 text-sm text-white outline-none ring-teal-400/40 placeholder:text-slate-500 focus:ring-2"
              />
              <div
                data-testid="inverted-retention"
                className="space-y-1 rounded-xl border border-white/10 px-3 py-2 text-xs leading-relaxed text-slate-400"
              >
                <p className="font-semibold text-slate-200">
                  What is kept and who can see it
                </p>
                <p>{INVERTED_RETENTION_NOTICE.beforeSignIn}</p>
                <p>{INVERTED_RETENTION_NOTICE.afterSave}</p>
                <p>{INVERTED_RETENTION_NOTICE.authority}</p>
              </div>
              {seedPhrase ? (
                <p
                  role="alert"
                  data-testid="inverted-seed-warning"
                  className="text-sm leading-relaxed text-amber-100"
                >
                  {bannedSeedSubjectMessage(seedPhrase)}
                </p>
              ) : null}
              <div className="flex flex-col gap-2">
                {INVERTED_EXAMPLE_PROMPTS.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    data-testid={`inverted-example-${ex.id}`}
                    className="whitespace-normal rounded-2xl border border-white/15 px-3 py-2 text-left text-xs leading-relaxed text-slate-200 hover:border-teal-400/40"
                    onClick={() => setAsk(ex.prompt)}
                  >
                    <span className="mr-1 font-semibold text-slate-500">
                      {ex.label}:
                    </span>
                    <span data-testid={`inverted-example-text-${ex.id}`}>
                      {ex.prompt}
                    </span>
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
                {INVERTED_INTENT_CARDS.map((card) => {
                  const connectWaiting =
                    card.id === "connect" && !firstValueDone;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      data-testid={`inverted-intent-${card.id}`}
                      data-selected={intent === card.id ? "true" : "false"}
                      data-connect-ready={
                        card.id === "connect"
                          ? firstValueDone
                            ? "true"
                            : "false"
                          : undefined
                      }
                      aria-disabled={connectWaiting ? true : undefined}
                      onClick={() => {
                        if (connectWaiting) return;
                        setIntent(card.id);
                      }}
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
                      {connectWaiting ? (
                        <p className="mt-2 text-xs font-semibold text-slate-200">
                          Available after first value. Ask and save first.
                        </p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            {!savePrompt ? (
              <button
                type="button"
                id="inverted-continue"
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
                  {exampleText
                    ? "Preview this example without saving?"
                    : auth?.user
                      ? "Save this assessment and continue?"
                      : "Continue in this browser?"}
                </p>
                <p className="text-sm leading-relaxed text-slate-200">
                  {exampleText
                    ? "This is an example question. Previewing it shows how a Decision Case works, and nothing is saved. To keep a case, rewrite it as your own question."
                    : auth?.user
                      ? "Saving creates the Decision Case on your evaluation workspace. Ask already happened — org setup is not repeated here. Pricing stays out of this path."
                      : "The Decision Case continues in this browser. It is not saved until you sign in. Pricing stays out of this path."}
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
                    disabled={busy || Boolean(seedPhrase)}
                    className="rounded-lg bg-teal-400 px-3 py-2 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-teal-900 disabled:text-slate-100"
                    onClick={() => void confirmSave()}
                  >
                    {busy
                      ? "Saving…"
                      : exampleText
                        ? "Preview without saving"
                        : auth?.user
                          ? "Save and continue"
                          : "Continue in this browser"}
                  </button>
                  {!exampleText && !auth?.user ? (
                    <button
                      type="button"
                      data-testid="inverted-signin-to-save"
                      className="rounded-lg border border-white/30 px-3 py-2 text-sm font-semibold text-slate-100"
                      onClick={signInToSave}
                    >
                      Sign in to save this Decision Case
                    </button>
                  ) : null}
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
              {resumeCandidate
                ? `Resume ${resumeCandidate.decisionCase.caseNumber}`
                : "Resume a saved Decision Case"}
            </button>
            {resumeCandidate ? (
              <div
                data-testid="inverted-resume-candidate"
                className="rounded-xl border border-white/10 bg-[#0D1520] px-3 py-2 text-xs text-slate-400"
              >
                <p className="font-semibold text-slate-200">
                  {resumeCandidate.decisionCase.title}
                </p>
                <p className="mt-1">
                  Saved on this tenant workspace · updated{" "}
                  {new Date(resumeCandidate.updatedAt).toLocaleString()}
                </p>
              </div>
            ) : null}
            {resumeError ? (
              <p role="alert" className="text-xs text-red-300">
                {resumeError}
              </p>
            ) : null}
          </>
        ) : null}

        {spineQuestion ? (
          <section aria-label="Your Decision Case">
            <button
              type="button"
              id="back-to-question"
              className="mb-4 text-sm text-teal-300"
              onClick={() => {
                setPersistError(null);
                setSpineQuestion("");
                if (persistedCase) {
                  try {
                    window.history.replaceState(
                      null,
                      "",
                      rememberEvaluationDraft(
                        persistedCase,
                        window.location.search,
                        window.sessionStorage,
                        "ask",
                      ),
                    );
                  } catch {
                    setPersistError(
                      "The draft remains in memory; browser retention did not complete.",
                    );
                  }
                }
                setExamplePreview(false);
                setSavePrompt(false);
              }}
            >
              Back to your question
            </button>
            {persistError ? (
              <p role="alert" className="mb-3 text-sm text-amber-200">
                {persistError}
              </p>
            ) : null}
            <DecisionCaseSpine
              key={`${persistedCase?.id ?? spineQuestion}:${canonicalLoad}`}
              question={spineQuestion}
              intent={intent}
              industry={industry}
              initialCase={persistedCase}
              initiallySaved={caseSaved}
              onCaseChange={rememberCurrentCase}
              onNarrationScript={onNarrationScript}
              blockWorkspacePersist={examplePreview}
              openingNotice={persistError}
            />
          </section>
        ) : (
          <p className="text-center text-sm leading-relaxed text-slate-200">
            Start with your own question, or preview a labeled example. Review
            the evidence and next steps before saving a customer case.
          </p>
        )}
      </div>
      <HelpCenterWidget />
    </main>
  );
}
