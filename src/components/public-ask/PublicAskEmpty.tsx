import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  FileCheck,
  GraduationCap,
  Heart,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Wrench,
  X,
} from "lucide-react";
import {
  PUBLIC_ASK_INTENTS,
  type PublicAskIntent,
  type PublicAskIntentId,
} from "../../lib/public-ask-intents";
import { submitPilotIntake } from "../../services/pilotIntake";
import { BrandWordmark } from "../BrandWordmark";

const PILL_ICONS: Record<PublicAskIntentId, ReactNode> = {
  compare: <BarChart3 size={15} />,
  troubleshoot: <Wrench size={15} />,
  health: <Heart size={15} />,
  learn: <GraduationCap size={15} />,
  "fact-check": <FileCheck size={15} />,
};

type PublicAskEmptyProps = {
  askBar: ReactNode;
  attachmentInputs?: ReactNode;
  attachmentState?: ReactNode;
  onSelectIntent: (intent: PublicAskIntent) => void;
};

export function PublicAskEmpty({
  askBar,
  attachmentInputs,
  attachmentState,
  onSelectIntent,
}: PublicAskEmptyProps) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("syncai-public-theme") === "dark";
  });

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    window.localStorage.setItem("syncai-public-theme", next ? "dark" : "light");
  };

  return (
    <main
      className={`bolt-empty${darkMode ? " is-dark" : ""}`}
      data-testid="first-paint-empty"
      data-theme={darkMode ? "dark" : "light"}
    >
      <button
        type="button"
        className="bolt-theme-toggle"
        onClick={toggleTheme}
        aria-label={darkMode ? "Use light mode" : "Use dark mode"}
        title={darkMode ? "Use light mode" : "Use dark mode"}
      >
        {darkMode ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <section className="bolt-sales-hero" aria-labelledby="public-hero-title">
        <div className="bolt-sales-copy">
          <div className="bolt-brand">
            <h1 className="bolt-wordmark">SyncAI</h1>
            <BrandWordmark className="bolt-brand-original" />
            <span className="bolt-pro">pro</span>
          </div>
          <p className="bolt-eyebrow">
            <Sparkles size={14} /> Industrial reliability intelligence
          </p>
          <h2 id="public-hero-title">
            Turn maintenance data into defensible engineering decisions.
          </h2>
          <p className="bolt-hero-lede">
            Find what is driving repeat failures, where the evidence is weak,
            and what your team should do next—without surrendering engineering
            authority to AI.
          </p>
          <div className="bolt-hero-actions">
            <button
              type="button"
              className="bolt-primary-cta"
              onClick={() => setIntakeOpen(true)}
            >
              Start an assessment <ArrowRight size={17} />
            </button>
            <a className="bolt-secondary-cta" href="#try-syncai">
              Try the Reliability Engineer
            </a>
          </div>
          <div className="bolt-trust-line" aria-label="Product safeguards">
            <span>
              <ShieldCheck size={15} /> Evidence graded
            </span>
            <span>
              <Check size={15} /> Human approved
            </span>
            <span>
              <Check size={15} /> No production access required
            </span>
          </div>
        </div>

        <aside
          className="bolt-offer-card"
          aria-label="Reliability Intelligence Assessment"
        >
          <div className="bolt-offer-topline">
            <span>Entry engagement</span>
            <span>6–8 weeks</span>
          </div>
          <h3>Reliability Intelligence Assessment</h3>
          <p>Know what your maintenance data actually proves.</p>
          <ul>
            <li>
              <Check size={16} /> Evidence-graded findings
            </li>
            <li>
              <Check size={16} /> Prioritized failure opportunities
            </li>
            <li>
              <Check size={16} /> Governed 90-day action plan
            </li>
            <li>
              <Check size={16} /> Executive decision briefing
            </li>
          </ul>
          <div className="bolt-offer-footer">
            <div>
              <span>Standard fee</span>
              <strong>US$35,000</strong>
            </div>
            <button type="button" onClick={() => setIntakeOpen(true)}>
              Request scope <ArrowRight size={15} />
            </button>
          </div>
        </aside>
      </section>

      <section
        className="bolt-demo"
        id="try-syncai"
        aria-labelledby="demo-title"
      >
        <div className="bolt-demo-heading">
          <div>
            <span>Live product</span>
            <h2 id="demo-title">Ask SyncAI about a reliability decision</h2>
          </div>
          <p>
            Use public or synthetic information only. Start with a question or
            choose a path.
          </p>
        </div>
        {attachmentInputs}
        {attachmentState}
        {askBar}
        <ul className="bolt-pills">
          {PUBLIC_ASK_INTENTS.map((intent) => (
            <li key={intent.id}>
              <button
                type="button"
                className="bolt-pill"
                aria-label={intent.label}
                data-testid="ask-intent-pill"
                data-intent={intent.id}
                data-seed-index={String(intent.seedIndex)}
                title={`${intent.module}: ${intent.explanation}`}
                onClick={() => onSelectIntent(intent)}
              >
                {PILL_ICONS[intent.id]}
                <span className="bolt-pill-copy">
                  <strong>{intent.label}</strong>
                  <small>{intent.module}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="bolt-value-strip"
        aria-label="How the assessment works"
      >
        <article>
          <span>01</span>
          <div>
            <h3>Export</h3>
            <p>
              Share bounded maintenance and work-history exports through an
              agreed transfer method.
            </p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <h3>Prove</h3>
            <p>
              SyncAI separates supported findings from hypotheses and missing
              evidence.
            </p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <h3>Act</h3>
            <p>
              Your team receives a prioritized, approval-ready 90-day action
              plan.
            </p>
          </div>
        </article>
      </section>

      <footer className="bolt-public-footer">
        <span>© {new Date().getFullYear()} SyncAI</span>
        <nav aria-label="Legal">
          <a href="/security">Security</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>

      {intakeOpen ? (
        <AssessmentIntake onClose={() => setIntakeOpen(false)} />
      ) : null}
    </main>
  );
}

function AssessmentIntake({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (String(form.get("website") ?? "")) return;
    setStatus("sending");
    setError("");
    try {
      await submitPilotIntake({
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        company: String(form.get("company") ?? ""),
        role: String(form.get("role") ?? ""),
        industry: String(form.get("industry") ?? ""),
        assetScope: String(form.get("assetScope") ?? ""),
        systemOfRecord: "To be confirmed during scoping",
        historyAvailable: "To be confirmed during scoping",
        primaryPain: String(form.get("primaryPain") ?? ""),
        dataReadiness: "To be confirmed during assessment scoping",
        securityNeed:
          "Governed data-transfer method to be agreed after scope confirmation",
        commercialModel:
          "Reliability Intelligence Assessment - Standard - US$35,000",
        notes: "Submitted from the public SyncAI product experience.",
      });
      setStatus("sent");
    } catch (caught) {
      setStatus("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Your request could not be sent.",
      );
    }
  }

  return (
    <div
      className="bolt-intake-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="bolt-intake"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-title"
      >
        <button
          type="button"
          className="bolt-intake-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={20} />
        </button>
        {status === "sent" ? (
          <div className="bolt-intake-success">
            <span>
              <Check size={28} />
            </span>
            <p className="bolt-eyebrow">Request received</p>
            <h2 id="intake-title">Let’s scope the right first decision.</h2>
            <p>
              Your request is in SyncAI’s assessment queue. A person will review
              the context and follow up using the work email you provided.
            </p>
            <button
              type="button"
              className="bolt-primary-cta"
              onClick={onClose}
            >
              Return to SyncAI
            </button>
          </div>
        ) : (
          <>
            <p className="bolt-eyebrow">Reliability Intelligence Assessment</p>
            <h2 id="intake-title">
              Tell us where reliability is getting expensive.
            </h2>
            <p className="bolt-intake-lede">
              We’ll use this to prepare a focused scoping conversation. Do not
              include confidential operating data here.
            </p>
            <form onSubmit={submit}>
              <div className="bolt-form-grid">
                <label>
                  Full name
                  <input
                    ref={firstField}
                    name="name"
                    required
                    minLength={2}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Work email
                  <input
                    name="email"
                    required
                    type="email"
                    autoComplete="email"
                  />
                </label>
                <label>
                  Company
                  <input
                    name="company"
                    required
                    minLength={2}
                    autoComplete="organization"
                  />
                </label>
                <label>
                  Role
                  <input name="role" autoComplete="organization-title" />
                </label>
                <label>
                  Industry
                  <input name="industry" />
                </label>
                <label>
                  Asset or system scope
                  <input
                    name="assetScope"
                    required
                    minLength={2}
                    placeholder="e.g. rotating equipment fleet"
                  />
                </label>
              </div>
              <label>
                What reliability problem matters most?
                <textarea
                  name="primaryPain"
                  required
                  minLength={2}
                  rows={3}
                  placeholder="Repeat failures, bad actors, maintenance strategy, data confidence…"
                />
              </label>
              <label className="bolt-honeypot" aria-hidden="true">
                Website
                <input
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                />
              </label>
              {status === "error" ? (
                <p className="bolt-form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="bolt-form-submit">
                <p>
                  Standard engagement: US$35,000 · final scope and terms are set
                  in the proposal/SOW.
                </p>
                <button
                  type="submit"
                  className="bolt-primary-cta"
                  disabled={status === "sending"}
                >
                  {status === "sending" ? "Sending…" : "Request assessment"}{" "}
                  <ArrowRight size={17} />
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
