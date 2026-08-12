/**
 * GovernanceStandards — global standards vs site authority, risk acceptances
 * and engineering approval rules
 * (capability register E4.01, E4.04, E4.06).
 *
 * The failure mode a multi-site operator actually has is not deviation from a
 * standard — it is UNRECORDED deviation. So a variance is a first-class
 * object: the standard names who may grant one, every granted variance carries
 * compensating controls, and all of them expire. A permanent exception is a
 * standard nobody updated.
 *
 * Risk acceptances work the same way and are bound to the delegation ladder —
 * an acceptance above your own risk ceiling is refused, and an active
 * acceptance is what legitimately lets an approval past that ceiling.
 */
import { Globe, MapPin, ShieldQuestion, HardHat, Clock } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Variance {
  id: string;
  site: string;
  status: string;
  justification: string;
  compensating_controls: string;
  expires_at: string | null;
  decision_note: string | null;
}

interface Standard {
  id: string;
  standard_key: string;
  title: string;
  requirement: string;
  mandatory: boolean;
  owner_role: string;
  variance_approver_role: string;
  status: string;
  basis: string;
  variances: Variance[];
}

interface RiskAcceptance {
  id: string;
  subject_type: string;
  risk_level: string;
  accepted_role: string;
  accepted_at: string;
  expires_at: string;
  rationale: string;
  compensating_controls: string;
}

interface EngRule {
  change_class: string;
  title: string;
  required_role: string;
  basis: string;
}

interface Payload {
  standards: Standard[];
  risk_acceptances: RiskAcceptance[];
  engineering_rules: EngRule[];
}

const RISK_STYLE: Record<string, string> = {
  Low: "border-slate-600 bg-slate-800/60 text-slate-300",
  Medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  High: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  Critical: "border-red-500/30 bg-red-500/10 text-red-300",
};

const daysLeft = (iso: string) =>
  Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);

export function GovernanceStandards() {
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_governance_standards",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Payload;
  }, []);

  if (loading) return <LoadingState label="Loading governance standards" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const standards = data?.standards ?? [];
  const acceptances = data?.risk_acceptances ?? [];
  const rules = data?.engineering_rules ?? [];
  const openVariances = standards.reduce(
    (n, s) => n + s.variances.filter((v) => v.status !== "rejected").length,
    0,
  );

  return (
    <section aria-labelledby="standards-heading" className="space-y-4">
      <div>
        <h2
          id="standards-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Globe className="h-5 w-5 text-signal-cyan" aria-hidden />
          Standards & Site Authority
          <span className="text-xs font-normal text-slate-500">
            {standards.length} standards · {openVariances} variances
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Standards are set centrally; sites deviate only through a recorded
          variance with compensating controls and an expiry. The standard names
          who may grant one.
        </p>
      </div>

      <ul className="space-y-2">
        {standards.map((s) => (
          <li
            key={s.id}
            className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-slate-200">{s.title}</p>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={`rounded-full border px-2 py-0.5 ${
                    s.mandatory
                      ? "border-signal-gold/30 bg-signal-gold/10 text-signal-gold"
                      : "border-slate-600 bg-slate-800/60 text-slate-400"
                  }`}
                >
                  {s.mandatory ? "Mandatory" : "Advisory"}
                </span>
                <span className="text-slate-500">
                  variance: {s.variance_approver_role.replace(/_/g, " ")}
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {s.requirement}
            </p>

            {s.variances.length > 0 && (
              <ul className="mt-2.5 space-y-1.5 border-l border-white/10 pl-3">
                {s.variances.map((v) => (
                  <li key={v.id} className="text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <MapPin
                        className="h-3.5 w-3.5 text-slate-500"
                        aria-hidden
                      />
                      <span className="text-slate-300">{v.site}</span>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                          v.status === "approved"
                            ? "border-green-500/30 bg-green-500/10 text-green-300"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        }`}
                      >
                        {v.status}
                      </span>
                      {v.expires_at && (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <Clock className="h-3 w-3" aria-hidden />
                          {daysLeft(v.expires_at)} days left
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-slate-500">
                      {v.justification}{" "}
                      <span className="text-slate-400">
                        Compensating: {v.compensating_controls}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="pt-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <ShieldQuestion
            className="h-4.5 w-4.5 text-signal-gold"
            aria-hidden
          />
          Active risk acceptances
          <span className="text-xs font-normal text-slate-500">
            {acceptances.length}
          </span>
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Who may accept what residual risk comes from the delegation ladder. An
          active acceptance is what legitimately carries an approval past a risk
          ceiling — and every one of them expires.
        </p>
      </div>

      {acceptances.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No residual risk is currently accepted. Approvals are held to the
          ceilings in the delegation ladder.
        </p>
      ) : (
        <ul className="space-y-2">
          {acceptances.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-white/6 bg-overlook-deep/40 p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full border px-2 py-0.5 ${RISK_STYLE[a.risk_level]}`}
                >
                  {a.risk_level}
                </span>
                <span className="text-slate-400">
                  accepted by {a.accepted_role.replace(/_/g, " ")}
                </span>
                <span aria-hidden className="text-slate-600">
                  ·
                </span>
                <span
                  className={
                    daysLeft(a.expires_at) < 30
                      ? "text-amber-300"
                      : "text-slate-500"
                  }
                >
                  expires in {daysLeft(a.expires_at)} days
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{a.rationale}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Compensating: {a.compensating_controls}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="pt-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <HardHat className="h-4.5 w-4.5 text-slate-300" aria-hidden />
          Changes requiring engineering sign-off
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          These change classes cannot be approved on maintenance authority alone
          — the named discipline must sign first, administrators included.
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {rules.map((r) => (
          <li
            key={r.change_class}
            className="rounded-xl border border-white/6 bg-white/2 p-3.5"
          >
            <p className="text-sm text-slate-200">{r.title}</p>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              {r.change_class} → {r.required_role}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {r.basis}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
