import { ReactNode } from "react";
import { BadgeCheck, FileCheck2, ShieldCheck } from "lucide-react";
import { PublicJourneyHeader } from "./PublicJourneyHeader";
import { HelpCenterWidget } from "./HelpCenterWidget";
import { usePublicJourneyTheme } from "../lib/use-public-journey-theme";
import { BrandWordmark } from "./BrandWordmark";

interface AuthShellProps {
  children: ReactNode;
  /** False hides "Create a workspace" after this account already exists. */
  offerWorkspace?: boolean;
  /** Matches the active auth tab. Signup must not reuse the sign-in heading. */
  intent?: "signin" | "signup";
  journey?: {
    caseNumber: string;
    asset: string;
    organization: string;
    site: string;
    statusLabel: string;
    version: string;
  } | null;
}

const PROOF = [
  {
    icon: FileCheck2,
    label: "Decision record",
    value: "context retained",
  },
  { icon: BadgeCheck, label: "Human authority", value: "review required" },
  { icon: ShieldCheck, label: "Value proof", value: "verification required" },
];

export function AuthShell({
  children,
  journey,
  offerWorkspace,
  intent = "signin",
}: AuthShellProps) {
  const { theme } = usePublicJourneyTheme();
  const signup = intent === "signup";
  return (
    <div className="public-journey" data-theme={theme}>
      <PublicJourneyHeader offerWorkspace={offerWorkspace} />
      <main className="journey-auth-layout">
        <section className="journey-auth-story">
          <p className="journey-eyebrow">Governed engineering intelligence</p>
          <h1>
            {signup
              ? "Create your evaluation workspace."
              : journey
                ? `Continue ${journey.caseNumber}.`
                : "Sign in to your governed workspace."}
          </h1>
          <p>
            {signup
              ? journey
                ? `This workspace keeps ${journey.caseNumber}, including the question and evidence you started. Creating the workspace does not approve a recommendation or run the plant.`
                : "Sign up to keep a Decision Case on an evaluation workspace. You can ask a question first. This does not grant production access."
              : journey
                ? "Your question and evidence remain browser drafts. Sign in to continue reviewing them; authentication does not grant approval or verify an outcome."
                : "Return to the decisions, evidence, approvals, controlled work, and measured outcomes your team is governing."}
          </p>
          {journey && (
            <div className="journey-auth-case">
              <p className="journey-eyebrow">Decision Case ready to secure</p>
              <strong>{journey.asset}</strong>
              <p>
                {journey.organization} · {journey.site}
              </p>
              <p>
                {journey.statusLabel} · {journey.version}
              </p>
            </div>
          )}
          <dl className="journey-auth-proof">
            {PROOF.map(({ icon: Icon, label, value }) => (
              <div key={label}>
                <dt>
                  <Icon size={14} aria-hidden />
                  {label}
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="journey-auth-form">
          <div className="mb-6 lg:hidden">
            <span className="journey-brand">
              <BrandWordmark className="h-7" />
            </span>
            {journey && (
              <p className="mt-3 text-sm">
                Continue {journey.caseNumber} · {journey.asset}
              </p>
            )}
          </div>
          {children}
        </section>
      </main>
      <HelpCenterWidget />
    </div>
  );
}
