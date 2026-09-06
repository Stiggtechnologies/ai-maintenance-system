/**
 * JobPlanEditor — draft authoring form for C8.07.
 *
 * Saving writes a draft through upsert_job_plan. It does not authorize work.
 * Adoption is a separate named-human act on the library.
 */
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  JobPlanDraft,
  JobPlanMaterialLine,
  MaterialOption,
} from "../services/jobPlanService";
import {
  emptyCheck,
  emptyMaterial,
  emptyPermit,
  emptyStep,
  emptyTool,
} from "../services/jobPlanService";

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600";
const labelClass = "mb-1 block text-xs font-medium text-slate-400";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

export function JobPlanEditor({
  draft,
  catalogue,
  busy,
  planKeyLocked,
  onChange,
  onCancel,
  onSave,
}: {
  draft: JobPlanDraft;
  catalogue: MaterialOption[];
  busy: boolean;
  planKeyLocked: boolean;
  onChange: (next: JobPlanDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<JobPlanDraft>) => onChange({ ...draft, ...patch });

  const saveDisabled =
    busy ||
    draft.plan_key.trim().length === 0 ||
    draft.title.trim().length === 0 ||
    draft.scope.trim().length === 0;

  return (
    <form
      aria-label="Job plan draft"
      className="space-y-5 rounded-xl border border-white/8 bg-overlook-deep/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <p className="text-xs text-slate-500">
        Saving writes a draft. A draft has no execution authority. Adoption is
        a named-human act and is refused without at least one step and one
        quality check that states an acceptance criterion.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Plan key *">
          <input
            aria-label="Plan key"
            value={draft.plan_key}
            disabled={planKeyLocked}
            onChange={(e) => set({ plan_key: e.target.value })}
            placeholder="JP-PUMP-SEAL"
            className={fieldClass}
          />
        </Field>
        <Field label="Title *">
          <input
            aria-label="Plan title"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Replace pump mechanical seal"
            className={fieldClass}
          />
        </Field>
        <Field label="Applies to asset class">
          <input
            aria-label="Applies to asset class"
            value={draft.applies_to_asset_class}
            onChange={(e) => set({ applies_to_asset_class: e.target.value })}
            placeholder="e.g. centrifugal pump"
            className={fieldClass}
          />
        </Field>
        <Field label="Applies to system group">
          <input
            aria-label="Applies to system group"
            value={draft.applies_to_system_group}
            onChange={(e) => set({ applies_to_system_group: e.target.value })}
            placeholder="e.g. process water"
            className={fieldClass}
          />
        </Field>
      </div>

      <Field label="Scope *">
        <textarea
          aria-label="Plan scope"
          value={draft.scope}
          onChange={(e) => set({ scope: e.target.value })}
          rows={3}
          placeholder="What this plan is for, and the boundary of the work."
          className={fieldClass}
        />
      </Field>
      <Field label="Authoring basis">
        <textarea
          aria-label="Authoring basis"
          value={draft.basis}
          onChange={(e) => set({ basis: e.target.value })}
          rows={2}
          placeholder="Source of this draft — procedure, OEM overlay, or field practice. Not an authorization."
          className={fieldClass}
        />
      </Field>

      <LineSection
        title="Sequence and labour"
        hint="Each step needs a description and estimated hours greater than zero. Crew size defaults to 1."
        onAdd={() =>
          set({
            steps: [...draft.steps, emptyStep(draft.steps.length + 1)],
          })
        }
        addLabel="Add step"
      >
        {draft.steps.map((step, i) => (
          <div
            key={`step-${i}`}
            className="grid gap-2 rounded-lg border border-white/6 p-3 md:grid-cols-[2.5rem_1fr_8rem_5rem_6rem_2rem]"
          >
            <span className="pt-2 font-mono text-xs text-slate-500">
              #{step.step_number || i + 1}
            </span>
            <input
              aria-label={`Step ${i + 1} description`}
              value={step.description}
              onChange={(e) => {
                const steps = [...draft.steps];
                steps[i] = { ...step, description: e.target.value };
                set({ steps });
              }}
              placeholder="What is done"
              className={fieldClass}
            />
            <input
              aria-label={`Step ${i + 1} craft`}
              value={step.craft}
              onChange={(e) => {
                const steps = [...draft.steps];
                steps[i] = { ...step, craft: e.target.value };
                set({ steps });
              }}
              placeholder="craft"
              className={fieldClass}
            />
            <input
              aria-label={`Step ${i + 1} crew size`}
              type="number"
              min={1}
              value={step.crew_size}
              onChange={(e) => {
                const steps = [...draft.steps];
                steps[i] = { ...step, crew_size: Number(e.target.value) };
                set({ steps });
              }}
              className={fieldClass}
            />
            <input
              aria-label={`Step ${i + 1} estimated hours`}
              type="number"
              min={0.1}
              step={0.1}
              value={step.estimated_hours}
              onChange={(e) => {
                const steps = [...draft.steps];
                steps[i] = {
                  ...step,
                  estimated_hours: Number(e.target.value),
                };
                set({ steps });
              }}
              className={fieldClass}
            />
            <IconButton
              label={`Remove step ${i + 1}`}
              onClick={() =>
                set({ steps: draft.steps.filter((_, j) => j !== i) })
              }
            />
          </div>
        ))}
      </LineSection>

      <LineSection
        title="Materials"
        hint={
          catalogue.length === 0
            ? "The materials catalogue is empty. Lines whose code does not resolve are dropped by the database — none can be attached until a catalogue exists."
            : "Only catalogue codes are sent. The database silently drops any other code; this form will not offer one."
        }
        onAdd={
          catalogue.length === 0
            ? undefined
            : () => set({ materials: [...draft.materials, emptyMaterial()] })
        }
        addLabel="Add material"
      >
        {draft.materials.map((line, i) => (
          <MaterialRow
            key={`mat-${i}`}
            index={i}
            line={line}
            catalogue={catalogue}
            onChange={(next) => {
              const materials = [...draft.materials];
              materials[i] = next;
              set({ materials });
            }}
            onRemove={() =>
              set({
                materials: draft.materials.filter((_, j) => j !== i),
              })
            }
          />
        ))}
      </LineSection>

      <LineSection
        title="Tools"
        onAdd={() => set({ tools: [...draft.tools, emptyTool()] })}
        addLabel="Add tool"
      >
        {draft.tools.map((tool, i) => (
          <div key={`tool-${i}`} className="grid gap-2 md:grid-cols-[1fr_1fr_2rem]">
            <input
              aria-label={`Tool ${i + 1}`}
              value={tool.tool}
              onChange={(e) => {
                const tools = [...draft.tools];
                tools[i] = { ...tool, tool: e.target.value };
                set({ tools });
              }}
              placeholder="Tool"
              className={fieldClass}
            />
            <input
              aria-label={`Tool ${i + 1} note`}
              value={tool.note}
              onChange={(e) => {
                const tools = [...draft.tools];
                tools[i] = { ...tool, note: e.target.value };
                set({ tools });
              }}
              placeholder="Note"
              className={fieldClass}
            />
            <IconButton
              label={`Remove tool ${i + 1}`}
              onClick={() =>
                set({ tools: draft.tools.filter((_, j) => j !== i) })
              }
            />
          </div>
        ))}
      </LineSection>

      <LineSection
        title="Permits and isolations"
        hint="A permit here is a requirement the work carries. Isolation is the physical state the permit authorises, not a second permit type. Applying a plan with a permit safety-flags the work order."
        onAdd={() => set({ permits: [...draft.permits, emptyPermit()] })}
        addLabel="Add permit"
      >
        {draft.permits.map((permit, i) => (
          <div
            key={`permit-${i}`}
            className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_2rem]"
          >
            <input
              aria-label={`Permit ${i + 1} type`}
              value={permit.permit_type}
              onChange={(e) => {
                const permits = [...draft.permits];
                permits[i] = { ...permit, permit_type: e.target.value };
                set({ permits });
              }}
              placeholder="Permit type"
              className={fieldClass}
            />
            <input
              aria-label={`Permit ${i + 1} isolation`}
              value={permit.isolation_required}
              onChange={(e) => {
                const permits = [...draft.permits];
                permits[i] = {
                  ...permit,
                  isolation_required: e.target.value,
                };
                set({ permits });
              }}
              placeholder="Isolation required"
              className={fieldClass}
            />
            <input
              aria-label={`Permit ${i + 1} verification`}
              value={permit.verification_note}
              onChange={(e) => {
                const permits = [...draft.permits];
                permits[i] = {
                  ...permit,
                  verification_note: e.target.value,
                };
                set({ permits });
              }}
              placeholder="Verification note"
              className={fieldClass}
            />
            <IconButton
              label={`Remove permit ${i + 1}`}
              onClick={() =>
                set({ permits: draft.permits.filter((_, j) => j !== i) })
              }
            />
          </div>
        ))}
      </LineSection>

      <LineSection
        title="Quality checks and acceptance criteria"
        hint="A check without an acceptance criterion is an opinion and will not be saved. Adoption is refused if this list is empty."
        onAdd={() => set({ checks: [...draft.checks, emptyCheck()] })}
        addLabel="Add check"
      >
        {draft.checks.map((check, i) => (
          <div
            key={`check-${i}`}
            className="grid gap-2 md:grid-cols-[1fr_1fr_8rem_2rem]"
          >
            <input
              aria-label={`Check ${i + 1} description`}
              value={check.check_description}
              onChange={(e) => {
                const checks = [...draft.checks];
                checks[i] = { ...check, check_description: e.target.value };
                set({ checks });
              }}
              placeholder="What is checked"
              className={fieldClass}
            />
            <input
              aria-label={`Check ${i + 1} acceptance criterion`}
              value={check.acceptance_criterion}
              onChange={(e) => {
                const checks = [...draft.checks];
                checks[i] = {
                  ...check,
                  acceptance_criterion: e.target.value,
                };
                set({ checks });
              }}
              placeholder="Measurable done-state"
              className={fieldClass}
            />
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                aria-label={`Check ${i + 1} hold point`}
                checked={check.is_hold_point}
                onChange={(e) => {
                  const checks = [...draft.checks];
                  checks[i] = { ...check, is_hold_point: e.target.checked };
                  set({ checks });
                }}
              />
              Hold point
            </label>
            <IconButton
              label={`Remove check ${i + 1}`}
              onClick={() =>
                set({ checks: draft.checks.filter((_, j) => j !== i) })
              }
            />
          </div>
        ))}
      </LineSection>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saveDisabled}
          className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-sm text-teal-300 disabled:opacity-50"
        >
          Save draft
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function LineSection({
  title,
  hint,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  hint?: string;
  onAdd?: () => void;
  addLabel: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-200">{title}</h3>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300"
          >
            <Plus className="h-3 w-3" aria-hidden />
            {addLabel}
          </button>
        )}
      </div>
      {hint && <p className="mb-2 text-xs text-slate-500">{hint}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function MaterialRow({
  index,
  line,
  catalogue,
  onChange,
  onRemove,
}: {
  index: number;
  line: JobPlanMaterialLine;
  catalogue: MaterialOption[];
  onChange: (next: JobPlanMaterialLine) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[14rem_1fr_5rem_2rem]">
      <select
        aria-label={`Material ${index + 1} code`}
        value={line.material_code}
        onChange={(e) => {
          const picked = catalogue.find((m) => m.material_code === e.target.value);
          onChange({
            ...line,
            material_code: e.target.value,
            description: picked?.description ?? "",
          });
        }}
        className={fieldClass}
      >
        <option value="">Select catalogue code…</option>
        {catalogue.map((m) => (
          <option key={m.id} value={m.material_code}>
            {m.material_code}
          </option>
        ))}
      </select>
      <span className="truncate pt-2 text-xs text-slate-500">
        {line.description || "—"}
      </span>
      <input
        aria-label={`Material ${index + 1} quantity`}
        type="number"
        min={0.01}
        step={0.01}
        value={line.qty}
        onChange={(e) => onChange({ ...line, qty: Number(e.target.value) })}
        className={fieldClass}
      />
      <IconButton label={`Remove material ${index + 1}`} onClick={onRemove} />
    </div>
  );
}

function IconButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-400"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
