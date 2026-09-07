/**
 * Sync Develop — problem-first intake (/develop/new). Slice 1, D1.05.
 *
 * The form's ORDER is the point: it opens with "what problem are we
 * solving?", never with a project name. The server enforces the same rule
 * (create_development_case refuses a token-thin problem statement), so this
 * page is a faithful rendering of the contract, not the contract itself.
 * Server refusals are surfaced verbatim.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import {
  createDevelopmentCase,
  listAdoptedFrameworks,
  screenApplicableProjectLessons,
  type FrameworkOption,
} from "../services/developService";
import { LIFECYCLE_TYPES } from "../lib/develop";

const CREATE_ROLES = [
  "admin",
  "ai_admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
  "planner",
];

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

export function DevelopIntakePage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canCreate =
    profile?.role != null && CREATE_ROLES.includes(profile.role);

  const [frameworks, setFrameworks] = useState<FrameworkOption[]>([]);
  const [frameworksLoaded, setFrameworksLoaded] = useState(false);

  const [problem, setProblem] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [title, setTitle] = useState("");
  const [lifecycleType, setLifecycleType] = useState("");
  const [frameworkId, setFrameworkId] = useState("");
  const [businessUnit, setBusinessUnit] = useState("");
  const [capex, setCapex] = useState("");
  const [expectedValue, setExpectedValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFrameworks(await listAdoptedFrameworks());
    } catch {
      // The list failing to load leaves the select empty with its honest
      // empty-state copy; creation without a framework remains valid.
    } finally {
      setFrameworksLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createDevelopmentCase({
        title,
        problemStatement: problem,
        lifecycleType,
        opportunityStatement: opportunity || null,
        frameworkId: frameworkId || null,
        businessUnit: businessUnit || null,
        estimatedCapex: capex === "" ? null : Number(capex),
        expectedValue: expectedValue === "" ? null : Number(expectedValue),
      });
      // D9.12: screen at creation, before the first workspace dollar.
      // Failures do not block intake — the workspace banner re-reads.
      const screened = await screenApplicableProjectLessons(
        result.case_id,
      ).catch(() => null);
      navigate(`/develop/cases/${result.case_id}`, {
        state: { applicableLessonCount: screened?.count ?? 0 },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <button
        onClick={() => navigate("/develop")}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All cases
      </button>

      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          What problem are we solving?
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          A development case begins with the problem or opportunity — the
          project, if there should be one, comes out of the gates.
        </p>
      </div>

      {!canCreate && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
          Your role does not create development cases; the server will refuse
          the submission. Framing is a planning, engineering or governance
          act.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={(e) => void submit(e)} className="space-y-5">
        <div>
          <label htmlFor="problem-statement" className="mb-1 block text-sm font-semibold text-slate-200">
            Problem / opportunity statement
          </label>
          <textarea
            id="problem-statement"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            rows={4}
            required
            minLength={20}
            placeholder="What is happening (or being missed), where, and what does it cost? 20 characters minimum — the server refuses less."
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-200">
            Objective — what does better look like?{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            value={opportunity}
            onChange={(e) => setOpportunity(e.target.value)}
            rows={2}
            placeholder="The outcome being pursued, in measurable terms where possible."
            className={inputClass}
          />
        </div>

        <div className="border-t border-white/6 pt-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="case-title" className="mb-1 block text-sm font-semibold text-slate-200">
                Case title
              </label>
              <input
                id="case-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={3}
                placeholder="Short working name"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="lifecycle-type" className="mb-1 block text-sm font-semibold text-slate-200">
                Lifecycle type
              </label>
              <select
                id="lifecycle-type"
                value={lifecycleType}
                onChange={(e) => setLifecycleType(e.target.value)}
                required
                className={inputClass}
              >
                <option value="" disabled>
                  Select…
                </option>
                {LIFECYCLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="framework-select" className="mb-1 block text-sm font-semibold text-slate-200">
              Governing framework
            </label>
            {frameworksLoaded && frameworks.length === 0 ? (
              <p className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
                No adopted framework in this organization yet. A case can be
                framed without one (gates attach when a framework is
                assigned); framework authoring is RPC-first this slice —
                create_project_framework → add_framework_stage →
                add_framework_gate → adopt_project_framework.
              </p>
            ) : (
              <select
                id="framework-select"
                value={frameworkId}
                onChange={(e) => setFrameworkId(e.target.value)}
                className={inputClass}
              >
                <option value="">No framework yet</option>
                {frameworks.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} v{f.version} ({f.source_authority})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="business-unit" className="mb-1 block text-sm font-semibold text-slate-200">
                Business unit
              </label>
              <input
                id="business-unit"
                value={businessUnit}
                onChange={(e) => setBusinessUnit(e.target.value)}
                placeholder="Optional"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="estimated-capex" className="mb-1 block text-sm font-semibold text-slate-200">
                Estimated capex ($)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                id="estimated-capex"
                value={capex}
                onChange={(e) => setCapex(e.target.value)}
                placeholder="If known"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="expected-value" className="mb-1 block text-sm font-semibold text-slate-200">
                Expected value ($/yr)
              </label>
              <input
                type="number"
                step="any"
                id="expected-value"
                value={expectedValue}
                onChange={(e) => setExpectedValue(e.target.value)}
                placeholder="If known"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-4 py-2 text-sm font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create development case"}
        </button>
      </form>
    </div>
  );
}
