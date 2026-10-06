import { ArrowRight, ShieldCheck } from "lucide-react";
import {
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  CUSTOMER_FIRST_WALKTHROUGH,
  PRODUCT_CUSTOMER_FLOW,
  PRODUCT_ENTRY_PATHS,
  productEntryById,
  productEntryDestination,
} from "../lib/product-entry-paths";

function attributionFromSearch(params: URLSearchParams) {
  return {
    source: params.get("source") || "solutions",
    campaign: params.get("campaign") || undefined,
    variant: params.get("variant") || undefined,
  };
}

export function ProductEntryPathsPage() {
  const [params] = useSearchParams();
  const attribution = attributionFromSearch(params);

  return (
    <main className="min-h-screen bg-[#0B0F14] px-5 py-12 text-[#E6EDF3]">
      <div className="mx-auto max-w-6xl">
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">
            Ten ways in · one governed platform
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            Start with the reliability decision that is already costing you.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300">
            Each entry path starts from a different buyer job, then converges on
            the same evidence, recommendation, human approval, controlled work,
            and verified-value loop.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            The named agent is the bounded product. The shared SyncAI copilot is
            the conversational experience for starting and working with those
            agents.
          </p>
        </header>

        <section
          className="mt-10 rounded-2xl border border-white/10 bg-white/[0.025] p-6"
          aria-labelledby="customer-flow-title"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-200">
            One customer flow behind every entry
          </p>
          <h2
            id="customer-flow-title"
            className="mt-2 text-2xl font-semibold text-white"
          >
            The pain changes. The governed path does not.
          </h2>
          <ol className="mt-6 grid gap-3 md:grid-cols-5">
            {PRODUCT_CUSTOMER_FLOW.map((stage, index) => (
              <li
                key={stage.id}
                className="rounded-xl border border-white/10 bg-[#0D1520] p-4"
              >
                <p className="text-xs font-semibold text-teal-200">
                  {String(index + 1).padStart(2, "0")}
                  {stage.optional ? " · when needed" : ""}
                </p>
                <h3 className="mt-2 font-semibold text-white">{stage.label}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  {stage.detail}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm text-slate-300">
            At every scope: Ask → Understand → Save → Prove → Recommend → Decide
            → Approve → Verify → Collaborate → Learn.
          </p>
        </section>

        <section
          className="mt-6 rounded-2xl border border-amber-200/20 bg-amber-100/[0.04] p-6"
          aria-labelledby="walkthrough-title"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">
            Customer-first walkthrough · research hypothesis
          </p>
          <h2
            id="walkthrough-title"
            className="mt-2 text-2xl font-semibold text-white"
          >
            One decision experience to test behind every pain-led message.
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
            The product supports this sequence, but support is not market
            validation. Keep the walkthrough consistent, attribute every
            entrance, and let completed decision and verified-outcome evidence
            determine which messages deserve more investment.
          </p>
          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CUSTOMER_FIRST_WALKTHROUGH.map((stage, index) => (
              <li
                key={stage.id}
                className="rounded-xl border border-white/10 bg-[#0D1520] p-4"
              >
                <p className="text-xs font-semibold text-amber-200">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 font-semibold text-white">{stage.label}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  {stage.detail}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="mt-10 grid gap-4 md:grid-cols-2"
          aria-label="SyncAI entry paths"
        >
          {PRODUCT_ENTRY_PATHS.map((entry) => (
            <article
              key={entry.id}
              className={`rounded-2xl border p-6 ${
                entry.priority === "primary"
                  ? "border-teal-300/40 bg-teal-300/[0.08]"
                  : "border-white/10 bg-white/[0.025]"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-200">
                  {entry.priority === "primary"
                    ? "Test first"
                    : entry.priority === "secondary"
                      ? "Contrast test"
                      : "Portfolio test"}
                </span>
                <ShieldCheck className="h-5 w-5 text-teal-300" aria-hidden />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-white">
                {entry.name}
              </h2>
              <p className="mt-1 text-sm font-semibold text-teal-100">
                {entry.agentProduct}
              </p>
              <p className="mt-1 text-xs text-teal-200/80">
                {entry.platformSurface}
              </p>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-200">
                {entry.buyerQuestion}
              </p>
              <dl className="mt-5 space-y-3 text-sm leading-6">
                <div>
                  <dt className="font-semibold text-slate-200">Bring</dt>
                  <dd className="text-slate-400">{entry.input}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-200">Receive</dt>
                  <dd className="text-slate-400">{entry.outcome}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-200">Measure</dt>
                  <dd className="text-slate-400">{entry.successMetric}</dd>
                </div>
              </dl>
              <p className="mt-5 border-l-2 border-white/15 pl-3 text-xs leading-5 text-slate-500">
                {entry.boundary}
              </p>
              <a
                href={productEntryDestination(entry, attribution)}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-teal-300 px-4 py-2.5 text-sm font-bold text-slate-950"
              >
                Try this decision path{" "}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

export function ProductEntryGateway() {
  const { entryId } = useParams<{ entryId: string }>();
  const location = useLocation();
  const entry = entryId ? productEntryById(entryId) : undefined;
  if (!entry) return <Navigate to="/solutions" replace />;

  const incoming = new URLSearchParams(location.search);
  return (
    <Navigate
      to={productEntryDestination(entry, attributionFromSearch(incoming))}
      replace
    />
  );
}
