import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck, BrainCircuit, HardHat, Wrench } from "lucide-react";
import {
  getWorkforceExecutionWorkspace,
  recordCrewTemplate,
  recordKnowledgeArea,
  recordKnowledgeHolder,
  recordKnowledgeTransferPlan,
  recordSpecialisedTool,
  registerWorkforceStandard,
  type WorkforceExecutionWorkspace,
} from "../services/workforceExecutionService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-signal-cyan/50";
const buttonClass =
  "rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-sm font-semibold text-signal-cyan transition hover:bg-signal-cyan/15 disabled:cursor-not-allowed disabled:opacity-40";

const emptyRole = () => ({
  roleLabel: "",
  craft: "",
  headcount: "1",
  requiredCompetencyId: "",
  isMandatory: true,
});

export function WorkforceExecutionControls({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [workspace, setWorkspace] =
    useState<WorkforceExecutionWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [crew, setCrew] = useState({
    templateKey: "",
    title: "",
    description: "",
    basis: "",
    evidenceItemId: "",
    roles: [emptyRole()],
  });
  const [tool, setTool] = useState({
    toolKey: "",
    title: "",
    quantityAvailable: "",
    requiredCompetencyId: "",
    leadTimeDays: "",
    ownedBy: "",
    basis: "",
    evidenceItemId: "",
  });
  const [areaSelection, setAreaSelection] = useState("");
  const [area, setArea] = useState({
    areaKey: "",
    title: "",
    consequenceIfLost: "",
    criticality: "medium" as "critical" | "high" | "medium" | "low",
    documentedWhere: "",
    basis: "",
    evidenceItemId: "",
    expectedVersion: undefined as number | undefined,
  });
  const [holder, setHolder] = useState({
    areaId: "",
    memberId: "",
    action: "assign" as "assign" | "end",
    depth: "competent" as "aware" | "competent" | "expert",
    basis: "",
    evidenceItemId: "",
  });
  const [transfer, setTransfer] = useState({
    knowledgeAreaId: "",
    memberId: "",
    competencyId: "",
    planKind: "succession" as "succession" | "cross_training",
    targetDate: "",
    driver: "",
  });
  const [standard, setStandard] = useState({
    workKey: "",
    title: "",
    language: "",
    content: "",
    basis: "",
    evidenceItemId: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await getWorkforceExecutionWorkspace());
    } catch (error) {
      setNotice({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Workforce execution records are unavailable.",
      });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const run = async (
    action: () => Promise<{ note?: string; status?: string }>,
    fallback: string,
  ) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setNotice({ ok: true, text: result.note ?? fallback });
      await load();
      onChanged?.();
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : `${fallback} failed.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const evidenceOptions = workspace?.evidence ?? [];
  const competencyOptions = workspace?.competencies ?? [];
  const memberOptions = workspace?.members ?? [];
  const knowledgeOptions = workspace?.knowledgeAreas ?? [];

  return (
    <details className="rounded-xl border border-white/8 bg-[#0D1520]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100 marker:hidden">
        Govern crews, tools, knowledge and standard work
        <span className="ml-2 text-xs font-normal text-slate-500">
          evidence-backed execution inputs · no dispatch or competency inference
        </span>
      </summary>
      <div className="space-y-5 border-t border-white/8 p-4">
        <p className="max-w-4xl text-xs leading-relaxed text-slate-400">
          Crew and tool records constrain planning but never release work.
          Knowledge holding is not a qualification. Standard content is an
          existing controlled procedure verified by a named human—SyncAI does
          not translate, certify, or invent standard time.
        </p>
        {notice && (
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200" : "border-rose-400/25 bg-rose-400/5 text-rose-200"}`}
          >
            {notice.text}
          </div>
        )}
        {loading && (
          <p className="text-xs text-slate-500">
            Loading governed execution resources…
          </p>
        )}

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <HardHat className="h-4 w-4 text-signal-cyan" aria-hidden />
            Crew composition
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Record a retained version with at least one mandatory role and
            independently verified source evidence.
          </p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <input
              aria-label="Crew template key"
              value={crew.templateKey}
              onChange={(event) =>
                setCrew({ ...crew, templateKey: event.target.value })
              }
              placeholder="Stable crew key"
              className={inputClass}
            />
            <input
              aria-label="Crew template title"
              value={crew.title}
              onChange={(event) =>
                setCrew({ ...crew, title: event.target.value })
              }
              placeholder="Crew title"
              className={inputClass}
            />
            <input
              aria-label="Crew description"
              value={crew.description}
              onChange={(event) =>
                setCrew({ ...crew, description: event.target.value })
              }
              placeholder="Scope and operating context"
              className={`${inputClass} lg:col-span-2`}
            />
            {crew.roles.map((role, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-lg border border-white/8 p-3 lg:col-span-2 lg:grid-cols-5"
              >
                <input
                  aria-label={`Crew role ${index + 1} label`}
                  value={role.roleLabel}
                  onChange={(event) => {
                    const roles = [...crew.roles];
                    roles[index] = { ...role, roleLabel: event.target.value };
                    setCrew({ ...crew, roles });
                  }}
                  placeholder="Role"
                  className={inputClass}
                />
                <input
                  aria-label={`Crew role ${index + 1} craft`}
                  value={role.craft}
                  onChange={(event) => {
                    const roles = [...crew.roles];
                    roles[index] = { ...role, craft: event.target.value };
                    setCrew({ ...crew, roles });
                  }}
                  placeholder="Craft"
                  className={inputClass}
                />
                <input
                  aria-label={`Crew role ${index + 1} headcount`}
                  type="number"
                  min="1"
                  max="100"
                  value={role.headcount}
                  onChange={(event) => {
                    const roles = [...crew.roles];
                    roles[index] = { ...role, headcount: event.target.value };
                    setCrew({ ...crew, roles });
                  }}
                  className={inputClass}
                />
                <select
                  aria-label={`Crew role ${index + 1} competency`}
                  value={role.requiredCompetencyId}
                  onChange={(event) => {
                    const roles = [...crew.roles];
                    roles[index] = {
                      ...role,
                      requiredCompetencyId: event.target.value,
                    };
                    setCrew({ ...crew, roles });
                  }}
                  className={inputClass}
                >
                  <option value="">No competency specified</option>
                  {competencyOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={role.isMandatory}
                    onChange={(event) => {
                      const roles = [...crew.roles];
                      roles[index] = {
                        ...role,
                        isMandatory: event.target.checked,
                      };
                      setCrew({ ...crew, roles });
                    }}
                  />
                  Mandatory
                </label>
              </div>
            ))}
            <button
              type="button"
              className={buttonClass}
              disabled={busy || crew.roles.length >= 20}
              onClick={() =>
                setCrew({ ...crew, roles: [...crew.roles, emptyRole()] })
              }
            >
              Add crew role
            </button>
            <select
              aria-label="Crew evidence"
              value={crew.evidenceItemId}
              onChange={(event) =>
                setCrew({ ...crew, evidenceItemId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Choose verified crew evidence</option>
              {evidenceOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Crew composition basis"
              value={crew.basis}
              onChange={(event) =>
                setCrew({ ...crew, basis: event.target.value })
              }
              placeholder="Why this composition is the governed planning input"
              className={`${inputClass} min-h-20 lg:col-span-2`}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    recordCrewTemplate({
                      ...crew,
                      description: crew.description || undefined,
                      roles: crew.roles.map((role) => ({
                        ...role,
                        craft: role.craft || undefined,
                        requiredCompetencyId:
                          role.requiredCompetencyId || undefined,
                      })),
                    }),
                  "Crew composition recorded.",
                )
              }
            >
              Record crew composition
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Wrench className="h-4 w-4 text-signal-cyan" aria-hidden />
            Specialized-tool availability
          </h4>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {(
              [
                ["toolKey", "Tool key", "Stable tool key"],
                ["title", "Tool title", "Tool title"],
                [
                  "quantityAvailable",
                  "Quantity available",
                  "Observed quantity",
                ],
                ["leadTimeDays", "Tool lead time days", "Optional lead time"],
                ["ownedBy", "Tool custodian", "Owner or custodian"],
              ] as const
            ).map(([key, label, placeholder]) => (
              <input
                key={key}
                aria-label={label}
                type={
                  key.includes("quantity") || key.includes("lead")
                    ? "number"
                    : "text"
                }
                min={
                  key.includes("quantity") || key.includes("lead")
                    ? "0"
                    : undefined
                }
                value={tool[key]}
                onChange={(event) =>
                  setTool({ ...tool, [key]: event.target.value })
                }
                placeholder={placeholder}
                className={inputClass}
              />
            ))}
            <select
              aria-label="Tool operator competency"
              value={tool.requiredCompetencyId}
              onChange={(event) =>
                setTool({ ...tool, requiredCompetencyId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">No operator competency specified</option>
              {competencyOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Tool evidence"
              value={tool.evidenceItemId}
              onChange={(event) =>
                setTool({ ...tool, evidenceItemId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Choose verified tool evidence</option>
              {evidenceOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Tool availability basis"
              value={tool.basis}
              onChange={(event) =>
                setTool({ ...tool, basis: event.target.value })
              }
              placeholder="Inspection, inventory count or controlled source basis"
              className={`${inputClass} min-h-20 lg:col-span-2`}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    recordSpecialisedTool({
                      ...tool,
                      requiredCompetencyId:
                        tool.requiredCompetencyId || undefined,
                      leadTimeDays: tool.leadTimeDays || undefined,
                      ownedBy: tool.ownedBy || undefined,
                    }),
                  "Specialized-tool availability recorded.",
                )
              }
            >
              Record tool availability
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <BrainCircuit className="h-4 w-4 text-signal-cyan" aria-hidden />
            Knowledge retention
          </h4>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <select
              aria-label="Knowledge definition"
              value={areaSelection}
              onChange={(event) => {
                const selected = knowledgeOptions.find(
                  (item) => item.id === Number(event.target.value),
                );
                setAreaSelection(event.target.value);
                setArea(
                  selected
                    ? {
                        areaKey: selected.areaKey,
                        title: selected.title,
                        consequenceIfLost: selected.consequenceIfLost,
                        criticality: selected.criticality,
                        documentedWhere: selected.documentedWhere ?? "",
                        basis: "",
                        evidenceItemId: "",
                        expectedVersion: selected.version,
                      }
                    : {
                        areaKey: "",
                        title: "",
                        consequenceIfLost: "",
                        criticality: "medium",
                        documentedWhere: "",
                        basis: "",
                        evidenceItemId: "",
                        expectedVersion: undefined,
                      },
                );
              }}
              className={`${inputClass} lg:col-span-2`}
            >
              <option value="">New knowledge definition</option>
              {knowledgeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version}
                </option>
              ))}
            </select>
            <input
              aria-label="Knowledge area key"
              disabled={Boolean(areaSelection)}
              value={area.areaKey}
              onChange={(event) =>
                setArea({ ...area, areaKey: event.target.value })
              }
              placeholder="Stable knowledge key"
              className={inputClass}
            />
            <input
              aria-label="Knowledge area title"
              value={area.title}
              onChange={(event) =>
                setArea({ ...area, title: event.target.value })
              }
              placeholder="Knowledge area title"
              className={inputClass}
            />
            <select
              aria-label="Knowledge criticality"
              value={area.criticality}
              onChange={(event) =>
                setArea({
                  ...area,
                  criticality: event.target.value as typeof area.criticality,
                })
              }
              className={inputClass}
            >
              {(["critical", "high", "medium", "low"] as const).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <input
              aria-label="Knowledge documentation location"
              value={area.documentedWhere}
              onChange={(event) =>
                setArea({ ...area, documentedWhere: event.target.value })
              }
              placeholder="Controlled repository or procedure"
              className={inputClass}
            />
            <textarea
              aria-label="Knowledge loss consequence"
              value={area.consequenceIfLost}
              onChange={(event) =>
                setArea({ ...area, consequenceIfLost: event.target.value })
              }
              placeholder="What stops or becomes unsafe if this knowledge is lost"
              className={`${inputClass} min-h-20 lg:col-span-2`}
            />
            <select
              aria-label="Knowledge definition evidence"
              value={area.evidenceItemId}
              onChange={(event) =>
                setArea({ ...area, evidenceItemId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Choose verified knowledge evidence</option>
              {evidenceOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Knowledge definition basis"
              value={area.basis}
              onChange={(event) =>
                setArea({ ...area, basis: event.target.value })
              }
              placeholder="Why this definition or update is supported"
              className={`${inputClass} min-h-20`}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    recordKnowledgeArea({
                      ...area,
                      documentedWhere: area.documentedWhere || undefined,
                    }),
                  "Critical-knowledge definition recorded.",
                )
              }
            >
              Record knowledge definition
            </button>
          </div>

          <div className="mt-5 grid gap-2 border-t border-white/8 pt-4 lg:grid-cols-2">
            <select
              aria-label="Knowledge holder area"
              value={holder.areaId}
              onChange={(event) =>
                setHolder({ ...holder, areaId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Choose knowledge area</option>
              {knowledgeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Knowledge holder member"
              value={holder.memberId}
              onChange={(event) =>
                setHolder({ ...holder, memberId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Choose workforce member</option>
              {memberOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
            <select
              aria-label="Knowledge holder action"
              value={holder.action}
              onChange={(event) =>
                setHolder({
                  ...holder,
                  action: event.target.value as typeof holder.action,
                })
              }
              className={inputClass}
            >
              <option value="assign">assign</option>
              <option value="end">end</option>
            </select>
            <select
              aria-label="Knowledge holder depth"
              value={holder.depth}
              onChange={(event) =>
                setHolder({
                  ...holder,
                  depth: event.target.value as typeof holder.depth,
                })
              }
              className={inputClass}
            >
              <option value="aware">aware</option>
              <option value="competent">competent</option>
              <option value="expert">expert</option>
            </select>
            <select
              aria-label="Knowledge holder evidence"
              value={holder.evidenceItemId}
              onChange={(event) =>
                setHolder({ ...holder, evidenceItemId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Choose verified holder evidence</option>
              {evidenceOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Knowledge holder basis"
              value={holder.basis}
              onChange={(event) =>
                setHolder({ ...holder, basis: event.target.value })
              }
              placeholder="Observed work, assessment, authorization or ending basis"
              className={`${inputClass} min-h-20`}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !holder.areaId || !holder.memberId}
              onClick={() =>
                void run(
                  () =>
                    recordKnowledgeHolder({
                      ...holder,
                      areaId: Number(holder.areaId),
                      memberId: Number(holder.memberId),
                    }),
                  "Knowledge-holder evidence recorded.",
                )
              }
            >
              Record knowledge-holder act
            </button>
          </div>

          <div className="mt-5 grid gap-2 border-t border-white/8 pt-4 lg:grid-cols-2">
            <select
              aria-label="Transfer knowledge area"
              value={transfer.knowledgeAreaId}
              onChange={(event) =>
                setTransfer({
                  ...transfer,
                  knowledgeAreaId: event.target.value,
                })
              }
              className={inputClass}
            >
              <option value="">Choose knowledge area</option>
              {knowledgeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Transfer target member"
              value={transfer.memberId}
              onChange={(event) =>
                setTransfer({ ...transfer, memberId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Choose target member</option>
              {memberOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
            <select
              aria-label="Transfer competency"
              value={transfer.competencyId}
              onChange={(event) =>
                setTransfer({ ...transfer, competencyId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Choose transfer competency</option>
              {competencyOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Transfer plan kind"
              value={transfer.planKind}
              onChange={(event) =>
                setTransfer({
                  ...transfer,
                  planKind: event.target.value as typeof transfer.planKind,
                })
              }
              className={inputClass}
            >
              <option value="succession">succession</option>
              <option value="cross_training">cross training</option>
            </select>
            <input
              aria-label="Transfer target date"
              type="date"
              value={transfer.targetDate}
              onChange={(event) =>
                setTransfer({ ...transfer, targetDate: event.target.value })
              }
              className={inputClass}
            />
            <textarea
              aria-label="Transfer plan driver"
              value={transfer.driver}
              onChange={(event) =>
                setTransfer({ ...transfer, driver: event.target.value })
              }
              placeholder="Why this exact knowledge transfer is required"
              className={`${inputClass} min-h-20`}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={
                busy ||
                !transfer.knowledgeAreaId ||
                !transfer.memberId ||
                !transfer.competencyId
              }
              onClick={() =>
                void run(
                  () =>
                    recordKnowledgeTransferPlan({
                      ...transfer,
                      knowledgeAreaId: Number(transfer.knowledgeAreaId),
                      memberId: Number(transfer.memberId),
                      competencyId: Number(transfer.competencyId),
                    }),
                  "Knowledge-transfer plan recorded.",
                )
              }
            >
              Record knowledge-transfer plan
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <BookOpenCheck className="h-4 w-4 text-signal-cyan" aria-hidden />
            Standard work and verified languages
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Register existing controlled content. Reuse the same standard key
            and title to add another human-verified language; content is never
            machine-certified by SyncAI.
          </p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <input
              aria-label="Standard work key"
              value={standard.workKey}
              onChange={(event) =>
                setStandard({ ...standard, workKey: event.target.value })
              }
              placeholder="Stable standard key"
              className={inputClass}
            />
            <input
              aria-label="Standard work title"
              value={standard.title}
              onChange={(event) =>
                setStandard({ ...standard, title: event.target.value })
              }
              placeholder="Controlled procedure title"
              className={inputClass}
            />
            <input
              aria-label="Procedure language code"
              value={standard.language}
              onChange={(event) =>
                setStandard({ ...standard, language: event.target.value })
              }
              placeholder="BCP 47 language code, for example en-CA"
              className={inputClass}
            />
            <select
              aria-label="Standard work evidence"
              value={standard.evidenceItemId}
              onChange={(event) =>
                setStandard({ ...standard, evidenceItemId: event.target.value })
              }
              className={inputClass}
            >
              <option value="">
                Choose verified controlled-document evidence
              </option>
              {evidenceOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Controlled procedure content"
              value={standard.content}
              onChange={(event) =>
                setStandard({ ...standard, content: event.target.value })
              }
              placeholder="Existing controlled procedure content"
              className={`${inputClass} min-h-28 lg:col-span-2`}
            />
            <textarea
              aria-label="Standard work source basis"
              value={standard.basis}
              onChange={(event) =>
                setStandard({ ...standard, basis: event.target.value })
              }
              placeholder="Source revision, owner and verification basis"
              className={`${inputClass} min-h-20 lg:col-span-2`}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void run(
                  () => registerWorkforceStandard(standard),
                  "Existing controlled procedure recorded.",
                )
              }
            >
              Register verified procedure language
            </button>
          </div>
        </section>

        {workspace && (
          <p className="text-xs leading-relaxed text-slate-500">
            {workspace.crewTemplates.filter((item) => item.active).length}{" "}
            active crew template(s) ·{" "}
            {workspace.tools.filter((item) => item.active).length} active
            specialized tool record(s) · {workspace.knowledgeAreas.length}{" "}
            governed knowledge area(s) · {workspace.standards.length} standard
            version(s).
          </p>
        )}
      </div>
    </details>
  );
}
