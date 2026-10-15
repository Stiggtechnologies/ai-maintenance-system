import { useEffect, useState } from "react";
import { AuthShell } from "../components/AuthShell";
import { AuthTabs } from "../components/AuthTabs";
import { useOptionalAuth } from "../components/AuthProvider";
import { SelfServeProgressChecklist } from "../components/onboarding/SelfServeProgressChecklist";
import { PasswordField } from "../components/PasswordField";
import { safeAuthReturnTo } from "../lib/auth-return";
import { isExamplePrompt } from "../lib/onboarding/inverted-opening";
import { readFirstDecisionDraft } from "../lib/onboarding/first-decision-handoff";
import { selfServeProgress } from "../lib/onboarding/self-serve-progress";
import { hasWorkspaceMembership, signUp } from "../lib/auth";
import {
  SIGNUP_INDUSTRY_OPTIONS,
  toStoredIndustryCode,
} from "../lib/industry-catalog";
import { motion } from "framer-motion";

interface SignupProps {
  onSuccess: () => void | Promise<void>;
  onTabChange: (
    tab: "signin" | "signup" | "enterprise" | "privacy" | "terms" | "security",
  ) => void;
}

export function Signup({ onSuccess, onTabChange }: SignupProps) {
  const auth = useOptionalAuth();
  const [formData, setFormData] = useState({
    fullName: "",
    company: "",
    role: "",
    industry: "",
    customIndustry: "",
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [draft] = useState(() =>
    readFirstDecisionDraft(window.sessionStorage, window.location.search),
  );
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
  const example = draft ? isExamplePrompt(draft.objective) : false;
  const retainedNotes = (draft?.evidence ?? []).filter(
    (item) => item.quality === "high" || item.quality === "medium",
  );
  const journey =
    draft && !example
      ? {
          caseNumber: draft.caseNumber,
          asset: draft.asset,
          organization: draft.organization,
          site: draft.site,
          statusLabel: draft.statusLabel,
          version: draft.version,
        }
      : null;
  const accountExists = Boolean(auth?.user) || confirmationEmail.length > 0;
  const progress = selfServeProgress({
    signedIn: Boolean(auth?.user),
    hasWorkspace,
    accountExists,
    question: draft?.objective ?? "",
    draftOpen: Boolean(draft) && !example,
    caseSaved: false,
    exampleOnly: example,
    savedSuppliedEvidence: 0,
    savedRecommendation: false,
    emphasizeSignup: !accountExists,
  });
  const signupHref = `/?view=signup&returnTo=${encodeURIComponent(
    safeAuthReturnTo(
      new URLSearchParams(window.location.search).get("returnTo"),
      window.location.origin,
      "/get-started",
    ),
  )}`;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters long");
      setLoading(false);
      return;
    }

    const { customIndustry, ...signupFields } = formData;
    const result = await signUp({
      ...signupFields,
      industry: toStoredIndustryCode(formData.industry, customIndustry),
    });
    if (!result.success) {
      setError(
        result.error?.message ||
          "We could not create your evaluation workspace.",
      );
      setLoading(false);
      return;
    }

    if (result.requiresConfirmation) {
      setConfirmationEmail(formData.email);
      setLoading(false);
      return;
    }

    // Route through the canonical sign-in transition. That transition persists
    // any staged public Reliability Engineer Decision Case before entering the app.
    try {
      await onSuccess();
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Your evaluation workspace could not be authorized.",
      );
      setLoading(false);
      return;
    }
    const returnTo = safeAuthReturnTo(
      new URLSearchParams(window.location.search).get("returnTo"),
      window.location.origin,
      "/start",
    );
    window.location.assign(`/signin?returnTo=${encodeURIComponent(returnTo)}`);
  };

  if (confirmationEmail || auth?.user) {
    return (
      <AuthShell offerWorkspace={false} intent="signup" journey={journey}>
        <div className="mb-6">
          <SelfServeProgressChecklist
            progress={progress}
            signupHref={signupHref}
          />
        </div>
        <div className="bg-industrial-slate rounded-xl p-8 border border-industrial-border">
          <h1 className="text-2xl font-semibold text-industrial-text">
            {confirmationEmail
              ? "Verify your work email"
              : "You already have an account"}
          </h1>
          {confirmationEmail ? null : (
            <p className="mt-3 text-sm leading-6 text-industrial-muted">
              {hasWorkspace
                ? "Your workspace is already available. This screen will not create another one."
                : "This account is already signed up. This screen will not create another workspace."}
            </p>
          )}
          {confirmationEmail ? (
            <p className="mt-3 text-sm leading-6 text-industrial-muted">
              We sent a confirmation link to{" "}
              <strong className="text-industrial-text">
                {confirmationEmail}
              </strong>
              . Keep this tab open while you verify so the Reliability Engineer
              case you started remains staged for handoff. This screen will not
              create another workspace.
            </p>
          ) : null}
          <button
            onClick={() => onTabChange("signin")}
            className="mt-6 w-full rounded-lg bg-[#3A8DFF] px-4 py-3 font-medium text-white"
          >
            Continue to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  const inputClass =
    "w-full px-4 py-3 bg-industrial-black border border-industrial-border rounded-lg text-industrial-text focus:outline-hidden focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF]";
  return (
    <AuthShell intent="signup" journey={journey}>
      <div className="bg-industrial-slate rounded-xl p-8 border border-industrial-border backdrop-blur-xs">
        <div className="mb-6">
          <SelfServeProgressChecklist
            progress={progress}
            signupHref={signupHref}
          />
        </div>
        <AuthTabs activeTab="signup" onTabChange={onTabChange} />
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-industrial-text">
            Create a private evaluation workspace
          </h1>
          <p className="mt-2 text-sm leading-6 text-industrial-text">
            Continue the Reliability Engineer work you started. Self-signups
            receive an isolated evaluation organization; production tenant
            membership remains invitation-controlled.
          </p>
          {draft && !example ? (
            <div
              data-testid="signup-retained-draft"
              className="mt-4 rounded-lg border border-industrial-border p-3 text-sm leading-6 text-industrial-text"
            >
              <p className="font-semibold">
                Your question and evidence stay with this signup.
              </p>
              <p className="mt-2">{draft.objective}</p>
              {retainedNotes.length > 0 ? (
                <ul className="mt-2 list-disc pl-5">
                  {retainedNotes.map((item) => (
                    <li key={item.id}>{item.summary || item.finding}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2">No evidence note is on this draft yet.</p>
              )}
              <p className="mt-2">
                After you sign in, this draft is saved as your first Decision
                Case. It is not saved yet.
              </p>
            </div>
          ) : null}
        </div>
        <form onSubmit={handleSignup} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-industrial-text">
              Full Name
              <input
                aria-label="Full Name"
                className={`${inputClass} mt-2`}
                value={formData.fullName}
                onChange={(e) =>
                  setFormData({ ...formData, fullName: e.target.value })
                }
                required
              />
            </label>
            <label className="text-sm font-medium text-industrial-text">
              Company
              <input
                aria-label="Company"
                className={`${inputClass} mt-2`}
                value={formData.company}
                onChange={(e) =>
                  setFormData({ ...formData, company: e.target.value })
                }
                required
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-industrial-text">
              Role
              <select
                aria-label="Role"
                className={`${inputClass} mt-2`}
                value={formData.role}
                onChange={(e) =>
                  setFormData({ ...formData, role: e.target.value })
                }
                required
              >
                <option value="">Select role</option>
                <option value="reliability">Reliability Engineer</option>
                <option value="maintenance">Maintenance Planner</option>
                <option value="operations">Operations Manager</option>
                <option value="vp">VP Operations</option>
                <option value="executive">Executive</option>
              </select>
            </label>
            <label className="text-sm font-medium text-industrial-text">
              Industry
              <select
                aria-label="Industry"
                className={`${inputClass} mt-2`}
                value={formData.industry}
                onChange={(e) =>
                  setFormData({ ...formData, industry: e.target.value })
                }
                required
              >
                <option value="">Select industry</option>
                {SIGNUP_INDUSTRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formData.industry === "custom" && (
            <label className="block text-sm font-medium text-industrial-text">
              Industry name
              <input
                aria-label="Industry name"
                className={`${inputClass} mt-2`}
                value={formData.customIndustry}
                onChange={(e) =>
                  setFormData({ ...formData, customIndustry: e.target.value })
                }
                maxLength={120}
                required
              />
            </label>
          )}
          <label className="block text-sm font-medium text-industrial-text">
            Work Email
            <input
              aria-label="Work Email"
              type="email"
              autoComplete="email"
              className={`${inputClass} mt-2`}
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              required
            />
          </label>
          <div>
            <label
              htmlFor="signup-password"
              className="block text-sm font-medium text-industrial-text"
            >
              Password
            </label>
            <PasswordField
              id="signup-password"
              aria-label="Password"
              autoComplete="new-password"
              wrapperClassName="mt-2"
              className={inputClass}
              value={formData.password}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              minLength={8}
              required
            />
            <span className="mt-2 block text-sm text-industrial-text">
              Minimum 8 characters.
            </span>
          </div>
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
            >
              {error}
            </motion.div>
          )}
          <motion.button
            type="submit"
            disabled={loading}
            whileTap={{ scale: 0.99 }}
            className="w-full rounded-lg bg-teal-400 px-4 py-3 font-medium text-slate-950 hover:bg-teal-300 disabled:opacity-50"
          >
            {loading ? "Creating workspace…" : "Continue Reliability Engineer"}
          </motion.button>
          <p className="text-center text-sm leading-6 text-industrial-text">
            Evaluation access is isolated from customer production tenants.
            Enterprise access is granted through an authorized organization
            invitation.
          </p>
        </form>
        <div className="mt-7 flex justify-center gap-4 border-t border-industrial-border pt-5 text-sm text-industrial-text">
          <button
            onClick={() => onTabChange("security")}
            className="hover:text-industrial-text"
          >
            Security
          </button>
          <span>•</span>
          <button
            onClick={() => onTabChange("privacy")}
            className="hover:text-industrial-text"
          >
            Privacy
          </button>
          <span>•</span>
          <button
            onClick={() => onTabChange("terms")}
            className="hover:text-industrial-text"
          >
            Terms
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
