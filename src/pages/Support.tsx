import { ArrowLeft, CircleHelp, Mail, ShieldAlert } from "lucide-react";
import { BrandWordmark } from "../components/BrandWordmark";

const supportAreas = [
  {
    icon: CircleHelp,
    title: "Account and activation",
    description:
      "Get help resolving a Marketplace purchase, confirming the selected offer and plan, or completing activation for an authorized SyncAI organization.",
  },
  {
    icon: ShieldAlert,
    title: "Security reports",
    description:
      "Report a suspected security issue without including credentials, secrets, or confidential operational records in the initial message.",
  },
] as const;

export function Support() {
  return (
    <div className="min-h-screen bg-industrial-black px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <BrandWordmark className="mb-8 h-9" />
        <a
          href="/signin"
          className="mb-8 flex items-center gap-2 text-industrial-muted hover:text-industrial-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sign In
        </a>

        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
          Customer support
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-industrial-text">
          Help with SyncAI access, activation, and service questions.
        </h1>
        <p className="mt-5 max-w-3xl leading-7 text-industrial-muted">
          Contact SyncAI with the organization name, Marketplace subscription
          context, and a concise description of the issue. Do not send
          passwords, access tokens, production secrets, or confidential
          maintenance records by email.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {supportAreas.map(({ icon: Icon, title, description }) => (
            <section
              key={title}
              className="rounded-xl border border-industrial-border bg-industrial-slate p-6"
            >
              <Icon className="h-5 w-5 text-teal-300" />
              <h2 className="mt-4 text-lg font-semibold text-industrial-text">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-industrial-muted">
                {description}
              </p>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-industrial-border bg-industrial-slate p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-[#3A8DFF]" />
            <h2 className="font-semibold text-industrial-text">
              Contact support
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-industrial-muted">
            Email{" "}
            <a
              className="text-[#3A8DFF] hover:underline"
              href="mailto:support@syncai.ca"
            >
              support@syncai.ca
            </a>
            . Response targets, support hours, escalation paths, and service
            levels are governed by the applicable order or customer agreement.
          </p>
          <p className="mt-3 text-sm leading-6 text-industrial-muted">
            For security reports, email{" "}
            <a
              className="text-[#3A8DFF] hover:underline"
              href="mailto:security@syncai.ca"
            >
              security@syncai.ca
            </a>
            . Privacy requests can be sent to{" "}
            <a
              className="text-[#3A8DFF] hover:underline"
              href="mailto:privacy@syncai.ca"
            >
              privacy@syncai.ca
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
