import { useEffect, useMemo, useState } from "react";
import { GitBranch, Network, Plus, ShieldAlert } from "lucide-react";
import type { DevelopmentPortfolioRow } from "../../lib/develop/developmentPortfolio";
import {
  addProjectToDevelopmentProgram,
  analyzeDevelopmentProgramSchedule,
  createDevelopmentProgram,
  getDevelopmentProgramWorkspace,
  recordDevelopmentProjectDependency,
  type DevelopmentProgramWorkspace,
  type ProgramDependencyKind,
} from "../../services/developmentProgramService";

const dependencyKinds: ProgramDependencyKind[] = [
  "finish_to_start",
  "shared_resource",
  "shared_interface",
  "shared_shutdown",
  "regulatory_sequence",
];

function number(value: number | null, unit = ""): string {
  if (value == null) return "Not assessable";
  return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ""}`;
}

function label(value: string): string {
  return value.replaceAll("_", " ");
}

export function ProgramPortfolioPanel({
  portfolioRows,
}: {
  portfolioRows: DevelopmentPortfolioRow[];
}) {
  const [workspace, setWorkspace] =
    useState<DevelopmentProgramWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMember, setShowMember] = useState(false);
  const [showDependency, setShowDependency] = useState(false);

  async function refresh(programId?: string) {
    setBusy(true);
    setMessage(null);
    try {
      setWorkspace(await getDevelopmentProgramWorkspace(programId));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Program workspace unavailable",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const schedule = useMemo(
    () =>
      workspace?.program
        ? analyzeDevelopmentProgramSchedule(workspace, portfolioRows)
        : null,
    [workspace, portfolioRows],
  );

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      const result = await createDevelopmentProgram({
        programCode: String(form.get("programCode") ?? ""),
        title: String(form.get("title") ?? ""),
        sharedObjectiveId: String(form.get("sharedObjectiveId") ?? ""),
        ownerId: String(form.get("ownerId") ?? ""),
        sharedOutcomeLabel: String(form.get("sharedOutcomeLabel") ?? ""),
        sharedOutcomeTarget: Number(form.get("sharedOutcomeTarget")),
        sharedOutcomeUnit: String(form.get("sharedOutcomeUnit") ?? ""),
        outcomeCapacityLimit:
          String(form.get("outcomeCapacityLimit") ?? "").trim() === ""
            ? null
            : Number(form.get("outcomeCapacityLimit")),
        outcomeBasis: String(form.get("outcomeBasis") ?? ""),
        evidenceItemId: String(form.get("evidenceItemId") ?? ""),
        targetStart: String(form.get("targetStart") ?? "") || null,
        targetFinish: String(form.get("targetFinish") ?? "") || null,
      });
      setShowCreate(false);
      setMessage(
        "Draft program created. It authorizes no project or funding decision.",
      );
      await refresh(result.programId);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Program could not be created",
      );
      setBusy(false);
    }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace?.program) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await addProjectToDevelopmentProgram({
        programId: workspace.program.id,
        caseId: String(form.get("caseId") ?? ""),
        contributionBasis: String(form.get("contributionBasis") ?? ""),
      });
      setShowMember(false);
      await refresh(workspace.program.id);
      setMessage("Project linked to the program with its contribution basis.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Project could not be linked",
      );
      setBusy(false);
    }
  }

  async function addDependency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace?.program) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await recordDevelopmentProjectDependency({
        programId: workspace.program.id,
        predecessorCaseId: String(form.get("predecessorCaseId") ?? ""),
        successorCaseId: String(form.get("successorCaseId") ?? ""),
        dependencyKind: String(
          form.get("dependencyKind"),
        ) as ProgramDependencyKind,
        basis: String(form.get("basis") ?? ""),
        evidenceItemId: String(form.get("evidenceItemId") ?? ""),
      });
      setShowDependency(false);
      await refresh(workspace.program.id);
      setMessage("Evidence-backed project dependency recorded.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Dependency could not be recorded",
      );
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.035] p-5"
      data-testid="program-portfolio"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Network className="h-5 w-5 text-violet-300" aria-hidden />
            Sync Portfolio · programs and dependencies
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            See whether individually healthy projects still deliver the shared
            program outcome, and where cross-project dependencies move the
            enterprise forecast.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200"
            onClick={() => setShowCreate((value) => !value)}
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" /> New program
          </button>
          {workspace?.program && (
            <select
              className="rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-xs"
              value={workspace.program.id}
              onChange={(event) => void refresh(event.target.value)}
            >
              {workspace.programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.code} · {program.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {message && (
        <p
          role="status"
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200"
        >
          {message}
        </p>
      )}

      {showCreate && workspace && (
        <form
          onSubmit={create}
          className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 md:grid-cols-3"
        >
          <Field name="programCode" title="Program code" />
          <Field name="title" title="Program title" />
          <Select
            name="sharedObjectiveId"
            title="Adopted shared objective"
            options={workspace.adoptedObjectives.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
          />
          <Select
            name="ownerId"
            title="Program owner"
            options={workspace.members.map((item) => ({
              value: item.id,
              label: `${item.name} · ${label(item.role)}`,
            }))}
          />
          <Field name="sharedOutcomeLabel" title="Shared outcome" />
          <Field
            name="sharedOutcomeTarget"
            title="Outcome target"
            type="number"
          />
          <Field name="sharedOutcomeUnit" title="Outcome unit" />
          <Field
            name="outcomeCapacityLimit"
            title="Capacity constraint (optional)"
            type="number"
            required={false}
          />
          <Select
            name="evidenceItemId"
            title="Independently verified evidence"
            options={workspace.verifiedEvidence.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
          />
          <Field
            name="targetStart"
            title="Target start"
            type="date"
            required={false}
          />
          <Field
            name="targetFinish"
            title="Target finish"
            type="date"
            required={false}
          />
          <label className="text-xs text-slate-300 md:col-span-3">
            Outcome and constraint basis
            <textarea
              className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
              name="outcomeBasis"
              required
            />
          </label>
          <button
            className="rounded-lg bg-violet-300 px-3 py-2 text-xs font-semibold text-slate-950 md:col-span-3"
            disabled={busy}
          >
            Create governed draft program
          </button>
        </form>
      )}

      {!workspace?.program ? (
        <div className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-400">
          No program has been configured. Create one to connect projects to a
          shared outcome.
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Metric
              title="Project claims"
              value={number(
                workspace.benefitIntegrity?.claimedOutcome ?? 0,
                workspace.program.sharedOutcomeUnit,
              )}
            />
            <Metric
              title="Constraint-adjusted"
              value={number(
                workspace.benefitIntegrity?.constraintAdjustedClaim ?? null,
                workspace.program.sharedOutcomeUnit,
              )}
            />
            <Metric
              title="Shared target"
              value={number(
                workspace.program.sharedOutcomeTarget,
                workspace.program.sharedOutcomeUnit,
              )}
            />
            <Metric
              title="Potential double count"
              value={number(
                workspace.benefitIntegrity?.potentialDoubleCount ?? null,
                workspace.program.sharedOutcomeUnit,
              )}
              danger={
                (workspace.benefitIntegrity?.potentialDoubleCount ?? 0) > 0
              }
            />
          </div>
          <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-xs text-amber-100">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />{" "}
            {workspace.benefitIntegrity?.interpretation}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200"
              onClick={() => setShowMember((value) => !value)}
            >
              Add project
            </button>
            <button
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-40"
              disabled={workspace.projects.length < 2}
              onClick={() => setShowDependency((value) => !value)}
            >
              Record dependency
            </button>
          </div>

          {showMember && (
            <form
              onSubmit={addMember}
              className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 md:grid-cols-[1fr_2fr_auto]"
            >
              <Select
                name="caseId"
                title="Project"
                options={workspace.availableCases.map((item) => ({
                  value: item.id,
                  label: item.title,
                }))}
              />
              <Field
                name="contributionBasis"
                title="How this project contributes to the shared outcome"
              />
              <button
                className="self-end rounded-lg bg-violet-300 px-3 py-2 text-xs font-semibold text-slate-950"
                disabled={busy}
              >
                Link project
              </button>
            </form>
          )}

          {showDependency && (
            <form
              onSubmit={addDependency}
              className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 md:grid-cols-3"
            >
              <Select
                name="predecessorCaseId"
                title="Predecessor"
                options={workspace.projects.map((item) => ({
                  value: item.caseId,
                  label: item.title,
                }))}
              />
              <Select
                name="successorCaseId"
                title="Dependent project"
                options={workspace.projects.map((item) => ({
                  value: item.caseId,
                  label: item.title,
                }))}
              />
              <Select
                name="dependencyKind"
                title="Dependency type"
                options={dependencyKinds.map((item) => ({
                  value: item,
                  label: label(item),
                }))}
              />
              <Select
                name="evidenceItemId"
                title="Verified evidence"
                options={workspace.verifiedEvidence.map((item) => ({
                  value: item.id,
                  label: item.label,
                }))}
              />
              <label className="text-xs text-slate-300 md:col-span-2">
                Dependency basis
                <textarea
                  className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  name="basis"
                  required
                />
              </label>
              <button
                className="rounded-lg bg-violet-300 px-3 py-2 text-xs font-semibold text-slate-950 md:col-span-3"
                disabled={busy}
              >
                Record dependency
              </button>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="min-w-[65rem] text-left text-xs">
              <thead className="border-b border-white/8 bg-white/[0.03] text-slate-400">
                <tr>
                  <th className="px-3 py-2">Project</th>
                  <th>Claim</th>
                  <th>Standalone finish</th>
                  <th>Dependency-adjusted</th>
                  <th>Enterprise status</th>
                  <th>Critical path</th>
                </tr>
              </thead>
              <tbody>
                {workspace.projects.map((project) => {
                  const result = schedule?.rows.find(
                    (row) => row.caseId === project.caseId,
                  );
                  const upstream = workspace.dependencies
                    .filter((edge) => edge.successorCaseId === project.caseId)
                    .map(
                      (edge) =>
                        workspace.projects.find(
                          (item) => item.caseId === edge.predecessorCaseId,
                        )?.title ?? edge.predecessorCaseId,
                    );
                  const downstream = workspace.dependencies
                    .filter((edge) => edge.predecessorCaseId === project.caseId)
                    .map(
                      (edge) =>
                        workspace.projects.find(
                          (item) => item.caseId === edge.successorCaseId,
                        )?.title ?? edge.successorCaseId,
                    );
                  return (
                    <tr
                      key={project.caseId}
                      className="border-b border-white/6 text-slate-200 last:border-0"
                    >
                      <td className="px-3 py-2 font-medium">
                        {project.title}
                        <p className="mt-1 max-w-sm text-[10px] text-slate-500">
                          {project.contributionBasis}
                        </p>
                        {upstream.length > 0 && (
                          <p className="mt-1 text-[10px] text-amber-200">
                            Depends on: {upstream.join(", ")}
                          </p>
                        )}
                        {downstream.length > 0 && (
                          <p className="mt-1 text-[10px] text-cyan-200">
                            Enables: {downstream.join(", ")}
                          </p>
                        )}
                      </td>
                      <td>
                        {number(
                          project.claimedOutcome,
                          workspace.program!.sharedOutcomeUnit,
                        )}
                      </td>
                      <td>{result?.standaloneFinish ?? "Not assessed"}</td>
                      <td>{result?.dependencyAdjustedFinish ?? "Withheld"}</td>
                      <td
                        className={
                          result?.status === "red"
                            ? "text-red-300"
                            : result?.status === "green"
                              ? "text-emerald-300"
                              : "text-amber-200"
                        }
                      >
                        {result?.status.toUpperCase() ?? "UNASSESSED"}
                        <p className="mt-1 max-w-xs text-[10px] text-slate-500">
                          {result?.reason}
                        </p>
                      </td>
                      <td>{result?.critical ? "Yes" : "No"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {schedule && schedule.refusals.length > 0 && (
            <ul className="list-disc space-y-1 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-4 pl-8 text-xs text-amber-100">
              {schedule.refusals.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-violet-100">
            <GitBranch className="mr-1 inline h-3.5 w-3.5" />
            {schedule?.interpretation}
          </p>
          <footer className="text-xs text-slate-400">
            {workspace.decisionBoundary}
          </footer>
        </>
      )}
    </section>
  );
}

function Field({
  name,
  title,
  type = "text",
  required = true,
}: {
  name: string;
  title: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs text-slate-300">
      {title}
      <input
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
        name={name}
        type={type}
        required={required}
      />
    </label>
  );
}

function Select({
  name,
  title,
  options,
}: {
  name: string;
  title: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-xs text-slate-300">
      {title}
      <select
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
        name={name}
        required
        defaultValue=""
      >
        <option value="" disabled>
          Select…
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({
  title,
  value,
  danger = false,
}: {
  title: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p
        className={`mt-1 font-semibold ${danger ? "text-red-300" : "text-white"}`}
      >
        {value}
      </p>
    </div>
  );
}
