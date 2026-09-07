/**
 * Stage-1 operator runbook (Operator Help M2).
 * Local progress only — never writes VERIFIED. Not plant execute. Not an LMS.
 */
import { useCallback, useMemo, useState } from "react";
import { CheckSquare, Square, ExternalLink, BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";

const STORAGE_KEY = "syncai.stage1-operator-runbook.v1";

export type Stage1GateId =
  | "assessment"
  | "connector"
  | "learn"
  | "dw-honesty"
  | "job-plan"
  | "authority";

type Gate = {
  id: Stage1GateId;
  title: string;
  pass: string;
  href: string;
  linkLabel: string;
};

export const STAGE1_GATES: readonly Gate[] = [
  {
    id: "assessment",
    title: "1. Assessment / RIA package",
    pass: "Site-scoped assessment package reachable (RIA workspace and/or exports).",
    href: "/assessments",
    linkLabel: "Open Assessments",
  },
  {
    id: "connector",
    title: "2. One thin verified connector",
    pass: "Historian pull or CMMS read WO live-configured — not seed/sim; honesty labels correct; not a certified vendor adapter.",
    href: "/integrations",
    linkLabel: "Open Integrations",
  },
  {
    id: "learn",
    title: "3. One recorded LEARN",
    pass: "Named human records verification via record_verification_result; fails visibly if unpersisted; not demo seed.",
    href: "/decision-cases",
    linkLabel: "Open Decision Workspace",
  },
  {
    id: "dw-honesty",
    title: "4. Decision Workspace honesty",
    pass: "Signed-in org session does not silently bind a demo/seed case; demo only via deliberate path.",
    href: "/decision-cases",
    linkLabel: "Open Decision Workspace",
  },
  {
    id: "job-plan",
    title: "5. Job-plan spine (if work planned)",
    pass: "Draft does not equal adopt; named-human adopt — or mark N/A if Stage-1 does not plan work.",
    href: "/job-plans",
    linkLabel: "Open Job Plans",
  },
  {
    id: "authority",
    title: "6. Authority boundary",
    pass: "Recommend is not authorize. Approval and LEARN are human acts. Plant execute stays disabled.",
    href: "/decision-cases",
    linkLabel: "Open Decision Workspace",
  },
] as const;

function readProgress(): Partial<Record<Stage1GateId, boolean>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<Stage1GateId, boolean>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeProgress(next: Partial<Record<Stage1GateId, boolean>>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function Stage1OperatorRunbook() {
  const navigate = useNavigate();
  const [done, setDone] = useState(readProgress);
  const [collapsed, setCollapsed] = useState(false);

  const checkedCount = useMemo(
    () => STAGE1_GATES.filter((g) => done[g.id]).length,
    [done],
  );

  const toggle = useCallback((id: Stage1GateId) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeProgress(next);
      return next;
    });
  }, []);

  return (
    <section
      data-testid="stage1-operator-runbook"
      className="rounded-2xl border border-teal-500/25 bg-[#0D1520] p-4 md:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">
              Stage-1 operator runbook
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Pilot proof checklist for one lighthouse site. Local progress only
              — does not certify the site. Not plant execute. Not an LMS.
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {checkedCount} / {STAGE1_GATES.length} gates marked locally
            </p>
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs font-semibold text-teal-300/90 hover:text-teal-200"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <ol className="mt-4 space-y-3">
          {STAGE1_GATES.map((gate) => {
            const checked = Boolean(done[gate.id]);
            return (
              <li
                key={gate.id}
                data-testid={\`stage1-gate-\${gate.id}\`}
                className="rounded-xl border border-white/8 bg-black/20 p-3"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    aria-pressed={checked}
                    aria-label={
                      checked
                        ? \`Unmark \${gate.title}\`
                        : \`Mark \${gate.title} locally\`
                    }
                    className="mt-0.5 text-teal-300"
                    onClick={() => toggle(gate.id)}
                  >
                    {checked ? (
                      <CheckSquare className="h-4 w-4" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-100">
                      {gate.title}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      {gate.pass}
                    </p>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-300 hover:text-teal-200"
                      onClick={() => navigate(gate.href)}
                    >
                      {gate.linkLabel}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
