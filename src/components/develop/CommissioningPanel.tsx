import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EVIDENCE_CLASSES } from "../../services/operatingModelReadinessService";
import {
  listOrgEvidenceItems,
  listOrgMembers,
  type OrgMember,
} from "../../services/developService";
import {
  getCaseCommissioning,
  recordCommissioningObject,
  recordCommissioningResult,
  type CaseCommissioning,
} from "../../services/commissioningService";

const input =
  "rounded border border-white/10 bg-overlook-deep p-2 text-xs text-slate-200";
const label = (value: string) => value.replaceAll("_", " ");
const val = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function CommissioningPanel({
  caseId,
  role,
}: {
  caseId: string;
  role: string | null | undefined;
}) {
  const [model, setModel] = useState<CaseCommissioning | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [evidence, setEvidence] = useState<
    Array<{ id: string; description: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = [
    "admin",
    "executive",
    "maintenance_manager",
    "reliability_engineer",
    "planner",
    "supervisor",
  ].includes(String(role ?? "").toLowerCase());
  const load = useCallback(async () => {
    try {
      const [next, people, sources] = await Promise.all([
        getCaseCommissioning(caseId),
        listOrgMembers(),
        listOrgEvidenceItems(),
      ]);
      setModel(next);
      setMembers(people);
      setEvidence(sources);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load commissioning workspace",
      );
    }
  }, [caseId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(
    kind: "system" | "subsystem" | "test_package" | "procedure",
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const d = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await recordCommissioningObject(caseId, kind, {
        ref: val(d, "ref"),
        title: val(d, "title"),
        description: val(d, "description"),
        ownerId: val(d, "ownerId"),
        systemId: val(d, "systemId"),
        subsystemId: val(d, "subsystemId"),
        testPackageId: val(d, "testPackageId"),
        requiredBy: val(d, "requiredBy"),
        acceptanceCriteria: val(d, "acceptanceCriteria"),
        sourceReference: val(d, "sourceReference"),
        evidenceClass: val(d, "evidenceClass"),
        assessmentBasis: val(d, "assessmentBasis"),
      });
      form.reset();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Commissioning record refused",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const d = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await recordCommissioningResult(caseId, Number(val(d, "procedureId")), {
        testRef: val(d, "testRef"),
        testStage: val(d, "testStage"),
        performedOn: val(d, "performedOn"),
        outcome: val(d, "outcome"),
        punchItemsRaised: val(d, "punchItemsRaised"),
        punchItemsOpen: val(d, "punchItemsOpen"),
        witnessedByOwner: d.get("witnessedByOwner") === "on",
        evidenceItemId: val(d, "evidenceItemId"),
      });
      form.reset();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Commissioning result refused",
      );
    } finally {
      setBusy(false);
    }
  }
  const packages =
    model?.systems.flatMap((s) =>
      s.testPackages.map((p) => ({ ...p, system: s })),
    ) ?? [];
  const procedures = packages.flatMap((p) =>
    p.procedures.map((pr) => ({ ...pr, package: p })),
  );
  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Commissioning systems
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            System → subsystem → test package → controlled procedure → canonical
            acceptance result.
          </p>
        </div>
        <Link to="/risk" className="text-xs text-signal-cyan hover:underline">
          Independent release: Risk workspace → Quality
        </Link>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded border border-rose-400/20 bg-rose-400/10 p-2 text-xs text-rose-300"
        >
          {error}
        </p>
      )}
      {!model && !error && (
        <p className="mt-3 text-xs text-slate-500">
          Loading commissioning evidence…
        </p>
      )}
      {model && (
        <>
          <div className="mt-4 space-y-3">
            {model.systems.length ? (
              model.systems.map((system) => (
                <article
                  key={system.id}
                  className="rounded border border-white/8 p-3 text-xs"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong className="text-slate-200">
                      {system.ref} · {system.title}
                    </strong>
                    <span className="text-slate-400">
                      {system.rollup.resultCount} results ·{" "}
                      {system.rollup.releasedCount} released ·{" "}
                      {system.rollup.failedCount} failed ·{" "}
                      {system.rollup.openPunchCount} open punch ·{" "}
                      {system.rollup.pendingReleaseCount} awaiting release
                    </span>
                  </div>
                  <p className="mt-1 text-slate-500">
                    {system.subsystems.length} subsystem(s) ·{" "}
                    {system.testPackages.length} package(s)
                  </p>
                </article>
              ))
            ) : (
              <p className="text-xs text-slate-500">
                No commissioning systems recorded. No readiness is inferred from
                this empty state.
              </p>
            )}
          </div>
          {model.results.length > 0 && (
            <div className="mt-4 space-y-1">
              {model.results.map((result) => (
                <p key={result.id} className="text-xs text-slate-400">
                  {result.testRef}: {label(result.outcome)} ·{" "}
                  {result.punchItemsOpen} open punch ·{" "}
                  {label(result.releaseStatus)}
                </p>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-500">
            {model.decisionBoundary}
          </p>
          {canWrite && (
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <form
                onSubmit={(e) => void submit("system", e)}
                className="grid gap-2"
              >
                <h3 className="text-xs font-semibold text-slate-200">
                  Add system
                </h3>
                <input
                  name="ref"
                  required
                  placeholder="System reference"
                  className={input}
                />
                <input
                  name="title"
                  required
                  placeholder="Title"
                  className={input}
                />
                <textarea
                  name="description"
                  required
                  minLength={20}
                  placeholder="System boundary and scope (20+ characters)"
                  className={input}
                />
                <select name="ownerId" required className={input}>
                  <option value="">Accountable owner…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy}
                  className="rounded bg-signal-cyan p-2 text-xs font-semibold text-slate-950"
                >
                  Record system
                </button>
              </form>
              <form
                onSubmit={(e) => void submit("subsystem", e)}
                className="grid gap-2"
              >
                <h3 className="text-xs font-semibold text-slate-200">
                  Add subsystem
                </h3>
                <select name="systemId" required className={input}>
                  <option value="">Parent system…</option>
                  {model.systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.ref} · {s.title}
                    </option>
                  ))}
                </select>
                <input
                  name="ref"
                  required
                  placeholder="Subsystem reference"
                  className={input}
                />
                <input
                  name="title"
                  required
                  placeholder="Title"
                  className={input}
                />
                <textarea
                  name="description"
                  required
                  minLength={20}
                  placeholder="Subsystem boundary and scope (20+ characters)"
                  className={input}
                />
                <select name="ownerId" required className={input}>
                  <option value="">Accountable owner…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy || model.systems.length === 0}
                  className="rounded bg-signal-cyan p-2 text-xs font-semibold text-slate-950"
                >
                  Record subsystem
                </button>
              </form>
              <form
                onSubmit={(e) => void submit("test_package", e)}
                className="grid gap-2"
              >
                <h3 className="text-xs font-semibold text-slate-200">
                  Add test package
                </h3>
                <select name="systemId" required className={input}>
                  <option value="">System…</option>
                  {model.systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.ref} · {s.title}
                    </option>
                  ))}
                </select>
                <select name="subsystemId" className={input}>
                  <option value="">System-level package</option>
                  {model.systems.flatMap((s) =>
                    s.subsystems.map((ss) => (
                      <option key={ss.id} value={ss.id}>
                        {s.ref} / {ss.ref}
                      </option>
                    )),
                  )}
                </select>
                <input
                  name="ref"
                  required
                  placeholder="Package reference"
                  className={input}
                />
                <input
                  name="title"
                  required
                  placeholder="Title"
                  className={input}
                />
                <textarea
                  name="description"
                  required
                  minLength={20}
                  placeholder="Test scope (20+ characters)"
                  className={input}
                />
                <input name="requiredBy" type="date" className={input} />
                <select name="ownerId" required className={input}>
                  <option value="">Accountable owner…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy || model.systems.length === 0}
                  className="rounded bg-signal-cyan p-2 text-xs font-semibold text-slate-950"
                >
                  Record package
                </button>
              </form>
              <form
                onSubmit={(e) => void submit("procedure", e)}
                className="grid gap-2"
              >
                <h3 className="text-xs font-semibold text-slate-200">
                  Add controlled procedure
                </h3>
                <select name="testPackageId" required className={input}>
                  <option value="">Test package…</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.system.ref} / {p.ref}
                    </option>
                  ))}
                </select>
                <input
                  name="ref"
                  required
                  placeholder="Procedure reference"
                  className={input}
                />
                <input
                  name="title"
                  required
                  placeholder="Title"
                  className={input}
                />
                <textarea
                  name="acceptanceCriteria"
                  required
                  minLength={10}
                  placeholder="Recorded acceptance criteria"
                  className={input}
                />
                <input
                  name="sourceReference"
                  required
                  placeholder="Controlled source reference"
                  className={input}
                />
                <select name="evidenceClass" required className={input}>
                  <option value="">Evidence provenance…</option>
                  {EVIDENCE_CLASSES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <textarea
                  name="assessmentBasis"
                  required
                  minLength={20}
                  placeholder="Basis for procedure and criteria (20+ characters)"
                  className={input}
                />
                <button
                  disabled={busy || packages.length === 0}
                  className="rounded bg-signal-cyan p-2 text-xs font-semibold text-slate-950"
                >
                  Record procedure
                </button>
              </form>
              <form
                onSubmit={submitResult}
                className="grid gap-2 xl:col-span-2"
              >
                <h3 className="text-xs font-semibold text-slate-200">
                  Record executed result
                </h3>
                <div className="grid gap-2 md:grid-cols-3">
                  <select name="procedureId" required className={input}>
                    <option value="">Controlled procedure…</option>
                    {procedures.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.package.system.ref} / {p.package.ref} / {p.ref}
                      </option>
                    ))}
                  </select>
                  <input
                    name="testRef"
                    required
                    placeholder="Unique result reference"
                    className={input}
                  />
                  <select name="testStage" required className={input}>
                    <option value="commissioning">Commissioning</option>
                    <option value="pre_commissioning">Pre-commissioning</option>
                    <option value="performance_test">Performance test</option>
                    <option value="reliability_run">Reliability run</option>
                  </select>
                  <input
                    name="performedOn"
                    type="date"
                    required
                    className={input}
                  />
                  <select name="outcome" required className={input}>
                    <option value="">Outcome…</option>
                    <option value="pass">Pass</option>
                    <option value="pass_with_punch">Pass with punch</option>
                    <option value="fail">Fail</option>
                    <option value="not_performed">Not performed</option>
                  </select>
                  <select name="evidenceItemId" required className={input}>
                    <option value="">Test evidence…</option>
                    {evidence.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.description}
                      </option>
                    ))}
                  </select>
                  <input
                    name="punchItemsRaised"
                    type="number"
                    min="0"
                    defaultValue="0"
                    className={input}
                  />
                  <input
                    name="punchItemsOpen"
                    type="number"
                    min="0"
                    defaultValue="0"
                    className={input}
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input name="witnessedByOwner" type="checkbox" /> Witnessed
                    by owner
                  </label>
                </div>
                <button
                  disabled={
                    busy || procedures.length === 0 || evidence.length === 0
                  }
                  className="rounded bg-signal-cyan p-2 text-xs font-semibold text-slate-950"
                >
                  Record result in acceptance tests
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
