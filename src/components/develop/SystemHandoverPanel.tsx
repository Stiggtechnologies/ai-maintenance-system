import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  listOrgEvidenceItems,
  listOrgMembers,
  type OrgMember,
} from "../../services/developService";
import {
  acceptSystemHandoverPackage,
  assembleSystemHandoverPackage,
  getCaseSystemHandoverPackages,
  type CaseSystemHandoverPackages,
  type HandoverReadinessDimension,
} from "../../services/handoverPackageService";
import { OperationsReadinessBriefing } from "./OperationsReadinessBriefing";

const input =
  "rounded border border-white/10 bg-overlook-deep p-2 text-xs text-slate-200";
const label = (value: string) => value.replaceAll("_", " ");
const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();
const person = (member: OrgMember) =>
  member.full_name || member.email || member.id;

function Dimension({
  title,
  dimension,
}: {
  title: string;
  dimension: HandoverReadinessDimension;
}) {
  const ready = dimension.status === "READY";
  return (
    <div className="rounded border border-white/8 bg-black/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-slate-200">{title}</h4>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold ${ready ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}`}
        >
          {label(dimension.status)}
        </span>
      </div>
      <p className="mt-2 text-xl font-bold text-white">
        {dimension.percent === null ? "—" : `${dimension.percent}%`}
      </p>
      <p className="text-[11px] text-slate-500">
        {dimension.satisfied}/{dimension.total} evidence-complete ·{" "}
        {dimension.source}
      </p>
      {dimension.categories && (
        <p className="mt-1 text-[10px] text-slate-600">
          {dimension.categories.map(label).join(" · ")}
        </p>
      )}
      {dimension.gaps.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] text-amber-300">
          {dimension.gaps.slice(0, 8).map((gap, index) => (
            <li key={gap.itemId ?? gap.testId ?? `${gap.item}-${index}`}>
              {gap.asset ? `${gap.asset} · ` : ""}
              {gap.item ?? gap.testRef ?? "Unnamed evidence gap"}
              {gap.category ? ` · ${label(gap.category)}` : ""}
            </li>
          ))}
          {dimension.gaps.length > 8 && (
            <li>{dimension.gaps.length - 8} more named gap(s)</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function SystemHandoverPanel({
  caseId,
  role,
}: {
  caseId: string;
  role: string | null | undefined;
}) {
  const [model, setModel] = useState<CaseSystemHandoverPackages | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [evidence, setEvidence] = useState<
    Array<{ id: string; description: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedRole = String(role ?? "").toLowerCase();
  const canPrepare = [
    "admin",
    "executive",
    "maintenance_manager",
    "reliability_engineer",
    "planner",
    "supervisor",
    "ai_admin",
  ].includes(normalizedRole);
  const canAccept = [
    "operator",
    "maintenance_manager",
    "executive",
    "admin",
  ].includes(normalizedRole);
  const operationsOwners = members.filter((member) =>
    ["operator", "maintenance_manager", "executive", "admin"].includes(
      String(member.role ?? "").toLowerCase(),
    ),
  );
  const load = useCallback(async () => {
    setError(null);
    try {
      const [next, people, sources] = await Promise.all([
        getCaseSystemHandoverPackages(caseId),
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
          : "Could not load system handover packages",
      );
    }
  }, [caseId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function assemble(
    systemId: number,
    ownerFrom: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await assembleSystemHandoverPackage({
        systemId,
        ownerFrom,
        ownerTo: value(data, "ownerTo"),
        requiredAcceptanceDate: value(data, "requiredAcceptanceDate"),
        basis: value(data, "basis"),
        evidenceItemId: value(data, "evidenceItemId"),
      });
      form.reset();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Package assembly refused",
      );
    } finally {
      setBusy(false);
    }
  }

  async function accept(packageId: number, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await acceptSystemHandoverPackage({
        packageId,
        basis: value(data, "basis"),
        evidenceItemId: value(data, "evidenceItemId"),
      });
      form.reset();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Handover acceptance refused",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div>
        <h2 className="text-sm font-semibold text-white">
          System handover packages
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Per-system transfer from the accountable commissioning owner to the
          named operations owner. This is distinct from equipment
          return-to-service.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded border border-rose-400/20 bg-rose-400/10 p-3 text-xs text-rose-300"
        >
          {error}
        </p>
      )}
      {!model && !error && (
        <p className="mt-3 text-xs text-slate-500">
          Loading canonical handover evidence…
        </p>
      )}
      {model && (
        <>
          <div className="mt-4">
            <OperationsReadinessBriefing model={model} />
          </div>
          {model.systems.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded border border-white/8">
              <table className="min-w-full text-left text-[11px] text-slate-400">
                <thead className="bg-white/[0.03] text-slate-300">
                  <tr>
                    <th className="p-2">System</th>
                    <th className="p-2">Commissioning</th>
                    <th className="p-2">Punchlist</th>
                    <th className="p-2">As-built</th>
                    <th className="p-2">Asset data</th>
                    <th className="p-2">Residual risk</th>
                    <th className="p-2">Operations acceptance</th>
                  </tr>
                </thead>
                <tbody>
                  {model.systems.map((system) => (
                    <tr
                      key={system.systemId}
                      className="border-t border-white/6"
                    >
                      <td className="p-2 text-slate-200">{system.systemRef}</td>
                      <td className="p-2">
                        {system.readiness.physicalReadiness.satisfied}/
                        {system.readiness.physicalReadiness.total} released
                      </td>
                      <td className="p-2">
                        {system.readiness.physicalReadiness.openPunchCount ?? 0}{" "}
                        open
                      </td>
                      <td className="p-2">
                        {
                          system.readiness.informationReadiness.gaps.filter(
                            (gap) => gap.category === "documentation",
                          ).length
                        }{" "}
                        documentation gap(s)
                      </td>
                      <td className="p-2">
                        {system.readiness.informationReadiness.status ===
                        "READY"
                          ? "Evidence complete"
                          : "Gaps remain"}
                      </td>
                      <td className="p-2">
                        {system.readiness.acceptedResidualRiskCount}/
                        {system.readiness.residualRiskCount} accepted
                      </td>
                      <td className="p-2">
                        {system.package?.status === "accepted"
                          ? "Accepted"
                          : system.package
                            ? "Awaiting named owner"
                            : "Not assembled"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 space-y-4">
            {model.systems.length === 0 && (
              <p className="text-xs text-slate-500">
                No commissioning systems exist. No handover readiness is
                inferred.
              </p>
            )}
            {model.systems.map((system) => (
              <article
                key={system.systemId}
                className="rounded-lg border border-white/8 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      {system.systemRef} · {system.title}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Commissioning state {system.currentState ?? "not started"}
                      {system.package
                        ? ` · package v${system.package.version} ${system.package.status}`
                        : " · no package assembled"}
                    </p>
                  </div>
                  <span
                    className={`rounded px-2 py-1 text-[10px] font-semibold ${system.readiness.canAccept ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}`}
                  >
                    {system.readiness.canAccept
                      ? "EVIDENCE COMPLETE"
                      : "BLOCKED"}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <Dimension
                    title="Physical readiness"
                    dimension={system.readiness.physicalReadiness}
                  />
                  <Dimension
                    title="Information readiness"
                    dimension={system.readiness.informationReadiness}
                  />
                  <Dimension
                    title="Operational readiness"
                    dimension={system.readiness.operationalReadiness}
                  />
                </div>
                <div className="mt-3 rounded border border-white/8 p-3">
                  <h4 className="text-xs font-semibold text-slate-200">
                    Residual risks
                  </h4>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {system.readiness.acceptedResidualRiskCount}/
                    {system.readiness.residualRiskCount} have a current
                    canonical human risk acceptance.
                  </p>
                  <div className="mt-2 space-y-1">
                    {system.readiness.residualRisks.length === 0 ? (
                      <p className="text-[11px] text-slate-600">
                        No current case or bound-asset risks were found when
                        this package was assembled.
                      </p>
                    ) : (
                      system.readiness.residualRisks.map((risk) => (
                        <p
                          key={risk.riskId}
                          className="text-[11px] text-slate-400"
                        >
                          {risk.accepted ? "Accepted" : "Not accepted"} ·{" "}
                          {risk.title}
                          {risk.riskLevel ? ` · ${risk.riskLevel}` : ""}
                        </p>
                      ))
                    )}
                  </div>
                </div>
                {system.readiness.blockers.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-amber-300">
                    {system.readiness.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                )}
                {system.package && (
                  <p className="mt-3 text-[11px] text-slate-500">
                    From {system.package.ownerFrom ?? "unnamed owner"} to{" "}
                    {system.package.ownerTo ?? "unnamed owner"} · required by{" "}
                    {system.package.requiredAcceptanceDate}
                    {system.package.acceptedAt
                      ? ` · accepted ${new Date(system.package.acceptedAt).toLocaleString()}`
                      : ""}
                  </p>
                )}
                {canPrepare && system.package?.status !== "accepted" && (
                  <form
                    onSubmit={(event) =>
                      void assemble(
                        system.systemId,
                        system.systemOwnerId,
                        event,
                      )
                    }
                    className="mt-4 grid gap-2 md:grid-cols-3"
                  >
                    <h4 className="text-xs font-semibold text-slate-200 md:col-span-3">
                      {system.package
                        ? "Reassemble current draft"
                        : "Assemble draft"}
                    </h4>
                    <select name="ownerTo" required className={input}>
                      <option value="">Operations owner-to…</option>
                      {operationsOwners.map((member) => (
                        <option key={member.id} value={member.id}>
                          {person(member)} ·{" "}
                          {label(member.role ?? "role not recorded")}
                        </option>
                      ))}
                    </select>
                    <input
                      name="requiredAcceptanceDate"
                      type="date"
                      required
                      className={input}
                    />
                    <select name="evidenceItemId" required className={input}>
                      <option value="">Preparation evidence…</option>
                      {evidence.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.description}
                        </option>
                      ))}
                    </select>
                    <textarea
                      name="basis"
                      required
                      minLength={20}
                      placeholder="Why this package scope and ownership are complete (20+ characters)"
                      className={`${input} md:col-span-3`}
                    />
                    <button
                      disabled={busy}
                      className="rounded bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50 md:col-span-3"
                    >
                      {busy ? "Working…" : "Assemble evidence-linked draft"}
                    </button>
                  </form>
                )}
                {canAccept && system.package?.status === "draft" && (
                  <form
                    onSubmit={(event) => void accept(system.package!.id, event)}
                    className="mt-4 grid gap-2 md:grid-cols-2"
                  >
                    <h4 className="text-xs font-semibold text-slate-200 md:col-span-2">
                      Named owner-to acceptance
                    </h4>
                    <select name="evidenceItemId" required className={input}>
                      <option value="">Acceptance evidence…</option>
                      {evidence.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.description}
                        </option>
                      ))}
                    </select>
                    <textarea
                      name="basis"
                      required
                      minLength={20}
                      placeholder="What was checked before accepting operations ownership (20+ characters)"
                      className={input}
                    />
                    <button
                      disabled={busy || !system.readiness.canAccept}
                      className="rounded bg-emerald-400 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50 md:col-span-2"
                    >
                      {busy
                        ? "Working…"
                        : "Accept package and system ownership"}
                    </button>
                  </form>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
