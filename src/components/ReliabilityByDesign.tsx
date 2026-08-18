/**
 * ReliabilityByDesign — the decisions made before anything is bought
 * (capability register E8.01–E8.14).
 *
 * The centre of this panel is the RAM allocation, because it is the one place
 * a project's availability promise meets arithmetic. A 99% target across four
 * series subsystems is not 99% four times; it is 99.75% four times, and the
 * panel shows the difference and names the subsystem that cannot deliver it.
 *
 * The feedback-loop table is the other half: which failure modes the plant
 * actually suffers, and whether any design requirement has ever referenced
 * one. Usually none has, and the empty column is the finding.
 *
 * The RAM allocation reads the org's OWN capital_projects (org-scoped RLS) —
 * it used to hardcode get_ram_allocation({p_project_code: "DEMO-CP-01"}), a
 * code that exists only in the demo org's seed, so every real tenant rendered
 * a silently empty panel forever (the P-7 defect class,
 * navigation-lifecycle-ia.md §2 Group 5). Now the projects are enumerated,
 * one is selected, and an org with no capital projects is told so in words.
 */
import { useMemo, useState } from "react";
import { DraftingCompass, Info, Repeat2, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { allocateAvailability, analyseEarlyLife } from "../lib/design";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  projects_total: number;
  requirements_total: number;
  requirements_open: number;
  requirements_waived: number;
  requirements_traced_to_failure_mode: number;
  studies_without_maintainer: number;
  open_punch_items: number;
  early_life_failures_total: number;
  early_life_fed_back: number;
  basis: string;
}

interface RamTarget {
  systemLabel: string;
  targetAvailability: number;
  configuration: "series" | "parallel" | "mixed";
  targetBasis: string | null;
  subsystems: {
    label: string;
    allocated: number | null;
    demonstrated: number | null;
    complexityWeight: number;
    evidence: string | null;
  }[];
}

interface LoopRow {
  failure_mode: string;
  occurrences: number;
  assets_affected: number;
  requirements_referencing: number;
  loop_closed: boolean;
}

interface EarlyRow {
  months_since_handover: number;
  attributed_to: string | null;
  fed_back_to_design: boolean;
}

interface ProjectRow {
  project_code: string;
  title: string;
  status: string;
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

export function ReliabilityByDesign() {
  // The user's explicit pick; null until they make one, so the first project
  // the org actually has is the default rather than any hardcoded code.
  const [pickedCode, setPickedCode] = useState<string | null>(null);

  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    projects: ProjectRow[];
    loop: LoopRow[];
    early: EarlyRow[];
  }>(async () => {
    const [p, c, l, e] = await Promise.all([
      supabase.rpc("get_project_posture"),
      // The org's own projects via org-scoped RLS (capproj_read) — never a
      // literal project code.
      supabase
        .from("capital_projects")
        .select("project_code, title, status")
        .order("created_at", { ascending: true }),
      supabase.rpc("get_design_feedback_loop"),
      supabase
        .from("early_life_failures")
        .select("months_since_handover, attributed_to, fed_back_to_design"),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (c.error) throw new Error(c.error.message);
    if (l.error) throw new Error(l.error.message);
    if (e.error) throw new Error(e.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      projects: (c.data as ProjectRow[]) ?? [],
      loop: (l.data as LoopRow[]) ?? [],
      early: (e.data as EarlyRow[]) ?? [],
    };
  }, []);

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const selectedCode =
    pickedCode !== null &&
    projects.some((project) => project.project_code === pickedCode)
      ? pickedCode
      : (projects[0]?.project_code ?? null);
  const selectedProject =
    projects.find((project) => project.project_code === selectedCode) ?? null;

  // The RAM targets for the selected project only — refetched when the
  // selection changes, empty (not demo) when the org has no projects.
  const ram = useAsyncData<RamTarget[]>(async () => {
    if (selectedCode === null) return [];
    const { data: rows, error: ramError } = await supabase.rpc(
      "get_ram_allocation",
      { p_project_code: selectedCode },
    );
    if (ramError) throw new Error(ramError.message);
    return (rows as RamTarget[]) ?? [];
  }, [selectedCode]);

  const allocations = useMemo(
    () =>
      (ram.data ?? []).map((t) => ({
        target: t,
        result: allocateAvailability(
          Number(t.targetAvailability),
          t.subsystems.map((s) => ({
            label: s.label,
            complexityWeight: Number(s.complexityWeight),
            demonstrated:
              s.demonstrated !== null ? Number(s.demonstrated) : null,
          })),
          t.configuration === "parallel" ? "parallel" : "series",
        ),
      })),
    [ram.data],
  );

  const early = useMemo(
    () =>
      analyseEarlyLife(
        (data?.early ?? []).map((e) => ({
          assetLabel: "",
          monthsSinceHandover: Number(e.months_since_handover),
          attributedTo: e.attributed_to,
          fedBackToDesign: e.fed_back_to_design,
        })),
        12,
      ),
    [data],
  );

  if (loading) return <LoadingState label="Loading design posture" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;
  const loop = data?.loop ?? [];
  const closed = loop.filter((l) => l.loop_closed).length;

  return (
    <section aria-labelledby="design-heading" className="space-y-4">
      <div>
        <h2
          id="design-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <DraftingCompass className="h-5 w-5 text-signal-cyan" aria-hidden />
          Reliability by Design
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          An availability target is a promise about arithmetic. Allocating it is
          where the promise either holds or quietly does not.
        </p>
      </div>

      {posture && (
        <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      {/* Which project the RAM arithmetic runs against — the org's own
          register, never a hardcoded code. No projects is a stated fact, not
          a blank panel. */}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
          <h3 className="text-sm font-semibold text-white">
            No capital projects recorded
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            The RAM allocation runs against a capital project&apos;s stated
            availability targets, and this organization has none on record. When
            a project and its targets are loaded, the arithmetic runs here —
            nothing is simulated in the meantime.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/6 bg-white/2 p-4">
          {projects.length === 1 ? (
            <>
              <span className="text-sm font-medium text-slate-200">
                Capital project
              </span>
              <span className="text-sm text-slate-300">
                {selectedProject?.project_code} — {selectedProject?.title}
              </span>
            </>
          ) : (
            <>
              <label
                htmlFor="design-project"
                className="text-sm font-medium text-slate-200"
              >
                Capital project
              </label>
              <select
                id="design-project"
                value={selectedCode ?? ""}
                onChange={(event) => setPickedCode(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
              >
                {projects.map((project) => (
                  <option
                    key={project.project_code}
                    value={project.project_code}
                  >
                    {project.project_code} — {project.title}
                  </option>
                ))}
              </select>
            </>
          )}
          {selectedProject && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-400">
              {selectedProject.status.replace(/_/g, " ")}
            </span>
          )}
        </div>
      )}

      {/* RAM allocation for the selected project. */}
      {ram.loading && selectedCode !== null && (
        <LoadingState label="Loading RAM allocation" />
      )}
      {ram.error && <ErrorState message={ram.error} onRetry={ram.refetch} />}
      {selectedProject &&
        !ram.loading &&
        !ram.error &&
        allocations.length === 0 && (
          <div className="rounded-xl border border-white/6 p-4 text-sm text-slate-300">
            <h3 className="text-sm font-semibold text-white">
              No availability targets for {selectedProject.project_code}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              The project is on record but carries no RAM targets yet, so there
              is no promise for the arithmetic to check.
            </p>
          </div>
        )}
      {!ram.loading &&
        !ram.error &&
        allocations.map(({ target, result }) => (
          <div
            key={target.systemLabel}
            className={`rounded-xl border p-4 ${result.feasible ? "border-white/6" : "border-amber-500/25 bg-amber-500/5"}`}
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <TriangleAlert
                className={`h-4 w-4 ${result.feasible ? "text-signal-cyan" : "text-amber-400"}`}
                aria-hidden
              />
              {target.systemLabel} — {pct(Number(target.targetAvailability))}{" "}
              {target.configuration}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {result.reason}
            </p>
            {target.targetBasis && (
              <p className="mt-1 text-xs text-slate-500">
                {target.targetBasis}
              </p>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">
                  Availability allocated to each subsystem against what it
                  demonstrates
                </caption>
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Subsystem
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Weight
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Allocated
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Demonstrated
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Shortfall
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.subsystems.map((s) => (
                    <tr key={s.label} className="border-t border-white/6">
                      <td className="py-2 pr-4 text-slate-200">{s.label}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-500 tabular-nums">
                        {s.weight}
                      </td>
                      <td className="py-2 pr-4 font-mono text-slate-300 tabular-nums">
                        {pct(s.allocated)}
                      </td>
                      <td className="py-2 pr-4 font-mono text-slate-400 tabular-nums">
                        {s.demonstrated !== null ? pct(s.demonstrated) : "—"}
                      </td>
                      <td
                        className={`py-2 font-mono tabular-nums ${(s.shortfall ?? 0) > 0 ? "text-rose-300" : "text-slate-600"}`}
                      >
                        {s.shortfall === null
                          ? "unknown"
                          : s.shortfall > 0
                            ? `−${(s.shortfall * 100).toFixed(2)} pt`
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* Early life. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="text-sm font-semibold text-white">
          Early-life failures
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {early.reason}
        </p>
        {early.byAttribution.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {early.byAttribution.map((a) => (
              <li
                key={a.attributedTo}
                className="rounded bg-white/5 px-2 py-1 text-xs text-slate-300"
              >
                {a.attributedTo.replace(/_/g, " ")}:{" "}
                <span className="font-mono">{a.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The loop. */}
      {loop.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Repeat2 className="h-4 w-4 text-signal-cyan" aria-hidden />
            What the plant learned, and whether design heard it
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {closed} of the {loop.length} most frequent failure modes are
            referenced by a design requirement.{" "}
            {closed === 0
              ? "None of them. The plant knows what breaks and the next project does not."
              : "Every unreferenced mode is a problem the next project is free to buy again."}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <caption className="sr-only">
                Failure modes by frequency and whether a design requirement
                references them
              </caption>
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Failure mode
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Occurrences
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Assets
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    In a design requirement
                  </th>
                </tr>
              </thead>
              <tbody>
                {loop.slice(0, 8).map((l) => (
                  <tr key={l.failure_mode} className="border-t border-white/6">
                    <td className="py-2 pr-4 text-slate-200">
                      {l.failure_mode}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-300 tabular-nums">
                      {l.occurrences}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-400 tabular-nums">
                      {l.assets_affected}
                    </td>
                    <td className="py-2">
                      {l.loop_closed ? (
                        <span className="text-signal-cyan">
                          yes ({l.requirements_referencing})
                        </span>
                      ) : (
                        <span className="text-slate-600">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
