import { useMemo, useState } from "react";
import { Building2, CheckCircle2, GitBranch, ShieldAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";
import { listSites, type SiteOption } from "../services/reliabilityCallers";
import {
  adoptEnterpriseMethod,
  adoptSiteStrategy,
  authorEnterpriseMethod,
  authorSiteStrategy,
  canAuthorEnterpriseMethod,
  canAuthorSiteStrategy,
  getEnterpriseMethodFederation,
  type FederationPayload,
} from "../services/enterpriseMethodFederation";

const field =
  "w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200";
const button =
  "rounded-lg border border-signal-cyan/35 bg-signal-cyan/10 px-3 py-1.5 text-sm font-medium text-signal-cyan disabled:opacity-40";

const EMPTY_METHOD = {
  sourceStandardId: undefined as string | undefined,
  standardKey: "",
  title: "",
  method: "",
  applicability: "",
  basis: "",
  mandatory: true,
  ownerRole: "reliability_engineer",
  varianceApproverRole: "reliability_engineer",
};

const EMPTY_STRATEGY = {
  standardId: "",
  siteId: "",
  strategyKey: "",
  title: "",
  localContext: "",
  implementationMethod: "",
  evidenceBasis: "",
  conformance: "aligned" as "aligned" | "variance",
  varianceId: "",
};

export function EnterpriseMethodFederation() {
  const { profile } = useAuth();
  const role = profile?.role as string | undefined;
  const federation = useAsyncData<FederationPayload>(
    getEnterpriseMethodFederation,
    [],
  );
  const sites = useAsyncData<SiteOption[]>(listSites, []);
  const [method, setMethod] = useState(EMPTY_METHOD);
  const [strategy, setStrategy] = useState(EMPTY_STRATEGY);
  const [adoptingMethod, setAdoptingMethod] = useState<string | null>(null);
  const [adoptingStrategy, setAdoptingStrategy] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const adoptedMethods = useMemo(
    () =>
      (federation.data?.methods ?? []).filter((x) => x.status === "adopted"),
    [federation.data],
  );
  const matchingVariances = (federation.data?.available_variances ?? []).filter(
    (v) =>
      v.standard_id === strategy.standardId && v.site_id === strategy.siteId,
  );

  if (federation.loading)
    return <LoadingState label="Loading enterprise methods" />;
  if (federation.error)
    return (
      <ErrorState message={federation.error} onRetry={federation.refetch} />
    );

  const payload = federation.data;
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage(success);
      setReviewNote("");
      await federation.refetch();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="federation-heading" className="space-y-5">
      <div>
        <h2
          id="federation-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <GitBranch className="h-5 w-5 text-signal-cyan" aria-hidden />
          Enterprise method federation
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Adopt one evidence-backed enterprise method, then show how each site
          inherits it or implements an approved local strategy.
        </p>
        <p
          data-testid="federation-authority"
          className="mt-2 rounded-xl border border-white/8 bg-industrial-black/60 px-4 py-3 text-xs text-slate-400"
        >
          A site strategy is governance context, not permission to execute.
          Non-conforming strategies require the existing approved, unexpired
          site variance. Adoption is a named-human act; the AI-operator identity
          is refused.
        </p>
      </div>

      {message && (
        <p className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm text-slate-200">
          {message}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {(payload?.methods ?? []).map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-white/8 bg-overlook-deep/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-slate-200">{item.title}</p>
                <p className="text-[11px] text-slate-500">
                  {item.standard_key} · v{item.version}
                </p>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${item.status === "adopted" ? "border-green-500/30 text-green-300" : "border-amber-500/30 text-amber-300"}`}
              >
                {item.status}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {item.method}
            </p>
            <p className="mt-2 text-[11px] text-slate-500">
              Applies to: {item.applicability}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Basis: {item.basis}
            </p>
            {item.status === "draft" && canAuthorEnterpriseMethod(role) && (
              <button
                className="mt-3 rounded-lg border border-green-500/30 px-2.5 py-1 text-xs text-green-300"
                onClick={() => {
                  setAdoptingMethod(item.id);
                  setAdoptingStrategy(null);
                  setReviewNote("");
                }}
              >
                Review for adoption
              </button>
            )}
            {item.status === "adopted" && canAuthorEnterpriseMethod(role) && (
              <button
                className="mt-3 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300"
                onClick={() =>
                  setMethod({
                    sourceStandardId: item.id,
                    standardKey: item.standard_key,
                    title: item.title,
                    method: item.method,
                    applicability: item.applicability ?? "",
                    basis: item.basis,
                    mandatory: item.mandatory,
                    ownerRole: item.owner_role,
                    varianceApproverRole: item.variance_approver_role,
                  })
                }
              >
                Create next version
              </button>
            )}
          </article>
        ))}
      </div>

      {(payload?.effective_site_methods ?? []).length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No effective site matrix yet. Adopt an enterprise method and register
          a site; until then SyncAI will not imply a federation exists.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/8">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-white/4 text-slate-400">
              <tr>
                <th className="p-3">Enterprise method</th>
                <th className="p-3">Site</th>
                <th className="p-3">Resolution</th>
                <th className="p-3">Implementation</th>
                <th className="p-3">Control</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.effective_site_methods ?? []).map((row) => (
                <tr
                  key={`${row.standard_id}:${row.site_id}`}
                  className="border-t border-white/6 align-top"
                >
                  <td className="p-3 text-slate-200">{row.standard_title}</td>
                  <td className="p-3 text-slate-300">{row.site}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 text-signal-cyan">
                      {row.resolution === "site_strategy" ? (
                        <Building2 className="h-3.5 w-3.5" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {row.resolution === "site_strategy"
                        ? "Site strategy"
                        : "Inherited standard"}
                    </span>
                  </td>
                  <td className="p-3 text-slate-400">
                    <p>{row.strategy_title ?? row.implementation_method}</p>
                    {row.local_context && (
                      <p className="mt-1 text-slate-500">{row.local_context}</p>
                    )}
                  </td>
                  <td className="p-3 text-slate-400">
                    {row.conformance === "variance" ? (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Variance {row.variance_status}
                      </span>
                    ) : row.conformance === "aligned" ? (
                      "Aligned"
                    ) : (
                      "Enterprise inheritance"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(payload?.site_strategy_drafts ?? []).length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <h3 className="text-sm font-medium text-amber-200">
            Site strategies awaiting adoption
          </h3>
          <ul className="mt-2 space-y-2">
            {payload!.site_strategy_drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span className="text-slate-300">
                  {draft.site} · {draft.standard_title} · {draft.title} (
                  {draft.conformance})
                </span>
                {canAuthorSiteStrategy(role) && (
                  <button
                    className="rounded border border-green-500/30 px-2 py-1 text-green-300"
                    onClick={() => {
                      setAdoptingStrategy(draft.id);
                      setAdoptingMethod(null);
                      setReviewNote("");
                    }}
                  >
                    Review for adoption
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(payload?.blocked_site_strategies ?? []).length > 0 && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-red-200">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Local strategies no longer in force
          </h3>
          <ul className="mt-2 space-y-2">
            {payload!.blocked_site_strategies.map((blocked) => (
              <li key={blocked.id} className="text-xs text-slate-300">
                {blocked.site} · {blocked.standard_title} · {blocked.title}
                <p className="mt-0.5 text-red-300">{blocked.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(adoptingMethod || adoptingStrategy) && (
        <form
          aria-label="Adoption review"
          className="space-y-3 rounded-xl border border-green-500/20 bg-green-500/5 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const id = adoptingMethod ?? adoptingStrategy!;
            void run(
              () =>
                adoptingMethod
                  ? adoptEnterpriseMethod(id, reviewNote)
                  : adoptSiteStrategy(id, reviewNote),
              adoptingMethod
                ? "Enterprise method adopted. Sites now inherit it until an approved local strategy replaces the resolution."
                : "Site strategy adopted. The effective matrix now shows the local resolution.",
            ).then((ok) => {
              if (ok) {
                setAdoptingMethod(null);
                setAdoptingStrategy(null);
              }
            });
          }}
        >
          <p className="text-sm text-slate-300">
            Record the evidence and human review basis. Adoption does not
            authorize work or change operating limits.
          </p>
          <textarea
            aria-label="Adoption review basis"
            className={field}
            rows={3}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
          />
          <div className="flex gap-2">
            <button
              className={button}
              disabled={busy || reviewNote.trim().length < 20}
            >
              Adopt
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400"
              onClick={() => {
                setAdoptingMethod(null);
                setAdoptingStrategy(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {canAuthorEnterpriseMethod(role) && (
        <form
          aria-label="Author enterprise method"
          className="grid gap-3 rounded-xl border border-white/8 bg-white/2 p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => authorEnterpriseMethod(method),
              "Enterprise method saved as draft. A named human must review and adopt it.",
            ).then((ok) => {
              if (ok) setMethod(EMPTY_METHOD);
            });
          }}
        >
          <h3 className="md:col-span-2 text-sm font-medium text-slate-200">
            {method.sourceStandardId
              ? "Author the next enterprise-method version"
              : "Author an enterprise reliability method"}
          </h3>
          <input
            aria-label="Method key"
            className={field}
            placeholder="method_key"
            value={method.standardKey}
            onChange={(e) =>
              setMethod({ ...method, standardKey: e.target.value })
            }
          />
          <input
            aria-label="Method title"
            className={field}
            placeholder="Method title"
            value={method.title}
            onChange={(e) => setMethod({ ...method, title: e.target.value })}
          />
          <textarea
            aria-label="Enterprise method"
            className={`${field} md:col-span-2`}
            rows={3}
            placeholder="Required standard method"
            value={method.method}
            onChange={(e) => setMethod({ ...method, method: e.target.value })}
          />
          <textarea
            aria-label="Method applicability"
            className={field}
            rows={3}
            placeholder="Where this method applies and its limits"
            value={method.applicability}
            onChange={(e) =>
              setMethod({ ...method, applicability: e.target.value })
            }
          />
          <textarea
            aria-label="Method evidence basis"
            className={field}
            rows={3}
            placeholder="Evidence, procedure, standard or review basis"
            value={method.basis}
            onChange={(e) => setMethod({ ...method, basis: e.target.value })}
          />
          <button
            className={`${button} md:col-span-2`}
            disabled={
              busy ||
              method.standardKey.length < 3 ||
              method.title.length < 5 ||
              method.method.trim().length < 20 ||
              method.applicability.trim().length < 10 ||
              method.basis.trim().length < 20
            }
          >
            Save method draft
          </button>
        </form>
      )}

      {canAuthorSiteStrategy(role) &&
        adoptedMethods.length > 0 &&
        (sites.data ?? []).length > 0 && (
          <form
            aria-label="Author site strategy"
            className="grid gap-3 rounded-xl border border-white/8 bg-white/2 p-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  authorSiteStrategy({
                    ...strategy,
                    varianceId: strategy.varianceId || undefined,
                  }),
                "Site strategy saved as draft. It changes no effective method until human adoption.",
              ).then((ok) => {
                if (ok) setStrategy(EMPTY_STRATEGY);
              });
            }}
          >
            <h3 className="md:col-span-2 text-sm font-medium text-slate-200">
              Author a site-specific strategy
            </h3>
            <select
              aria-label="Strategy enterprise method"
              className={field}
              value={strategy.standardId}
              onChange={(e) =>
                setStrategy({
                  ...strategy,
                  standardId: e.target.value,
                  varianceId: "",
                })
              }
            >
              <option value="">Enterprise method</option>
              {adoptedMethods.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Strategy site"
              className={field}
              value={strategy.siteId}
              onChange={(e) =>
                setStrategy({
                  ...strategy,
                  siteId: e.target.value,
                  varianceId: "",
                })
              }
            >
              <option value="">Site</option>
              {(sites.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Strategy key"
              className={field}
              placeholder="strategy_key"
              value={strategy.strategyKey}
              onChange={(e) =>
                setStrategy({ ...strategy, strategyKey: e.target.value })
              }
            />
            <input
              aria-label="Strategy title"
              className={field}
              placeholder="Strategy title"
              value={strategy.title}
              onChange={(e) =>
                setStrategy({ ...strategy, title: e.target.value })
              }
            />
            <textarea
              aria-label="Site local context"
              className={field}
              rows={3}
              placeholder="Site duty, environment and constraints"
              value={strategy.localContext}
              onChange={(e) =>
                setStrategy({ ...strategy, localContext: e.target.value })
              }
            />
            <textarea
              aria-label="Site implementation method"
              className={field}
              rows={3}
              placeholder="How this site will implement the method"
              value={strategy.implementationMethod}
              onChange={(e) =>
                setStrategy({
                  ...strategy,
                  implementationMethod: e.target.value,
                })
              }
            />
            <textarea
              aria-label="Site strategy evidence basis"
              className={`${field} md:col-span-2`}
              rows={3}
              placeholder="Local evidence and review basis"
              value={strategy.evidenceBasis}
              onChange={(e) =>
                setStrategy({ ...strategy, evidenceBasis: e.target.value })
              }
            />
            <select
              aria-label="Strategy conformance"
              className={field}
              value={strategy.conformance}
              onChange={(e) =>
                setStrategy({
                  ...strategy,
                  conformance: e.target.value as "aligned" | "variance",
                  varianceId: "",
                })
              }
            >
              <option value="aligned">Aligned with enterprise method</option>
              <option value="variance">
                Non-conforming — approved variance required
              </option>
            </select>
            {strategy.conformance === "variance" && (
              <select
                aria-label="Covering approved variance"
                className={field}
                value={strategy.varianceId}
                onChange={(e) =>
                  setStrategy({ ...strategy, varianceId: e.target.value })
                }
              >
                <option value="">Approved variance</option>
                {matchingVariances.map((x) => (
                  <option key={x.id} value={x.id}>
                    Expires {new Date(x.expires_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            )}
            <button
              className={`${button} md:col-span-2`}
              disabled={
                busy ||
                !strategy.standardId ||
                !strategy.siteId ||
                strategy.strategyKey.length < 3 ||
                strategy.title.length < 5 ||
                strategy.localContext.trim().length < 20 ||
                strategy.implementationMethod.trim().length < 20 ||
                strategy.evidenceBasis.trim().length < 20 ||
                (strategy.conformance === "variance" && !strategy.varianceId)
              }
            >
              Save site strategy draft
            </button>
          </form>
        )}
    </section>
  );
}
