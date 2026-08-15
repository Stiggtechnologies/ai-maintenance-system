/**
 * WorkOrderPlanningPanel — the planning acts on a work order
 * (capability register C9.02 planning assist + materials checks, C6.14).
 *
 * The functions behind this panel shipped in the job-plans and MRO-materials
 * slices and sat uncalled: apply_job_plan, record_task_actual and
 * request_wo_material had zero callers, so a planner could SEE job plans and
 * the planning-accuracy metric while nobody could apply a plan, record an
 * actual hour, or request a part. Planning accuracy in particular could never
 * accumulate real data — it is computed from applied plans and recorded
 * actuals, and neither had a write path in the product.
 *
 * Three deliberate constraints, all enforced in the database and merely
 * surfaced here:
 *  - Only an ADOPTED plan may be applied; apply_job_plan refuses drafts, so
 *    the picker shows adopted plans only rather than offering something the
 *    database will refuse.
 *  - Recording an actual is the moment planning accuracy becomes honest:
 *    the metric compares planned to actual hours, and an estimate with no
 *    recorded actual is a forecast, not a measurement.
 *  - Refusals are shown in the database's own words.
 */
import { useState } from "react";
import { ClipboardList, PackagePlus, ShieldCheck, Timer } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAsyncData } from "../hooks/useAsyncData";

interface PlanOption {
  plan_key: string;
  title: string;
  status: string;
  steps: number;
  estimated_hours: number;
  materials: number;
  permits: number;
  applies_to: string;
}

interface MaterialOption {
  id: string;
  material_code: string;
  description: string;
  unit_of_measure: string;
}

interface Task {
  id: string;
  task_sequence: number;
  description: string;
  status: string;
  estimated_hours: number | null;
  actual_hours: number | null;
}

export function WorkOrderPlanningPanel({
  workOrderId,
  assetId,
  safetyFlag,
  tasks,
  onChanged,
}: {
  workOrderId: string;
  assetId: string | null;
  safetyFlag: boolean;
  tasks: Task[];
  onChanged: () => void;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planKey, setPlanKey] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isolationConfirmed, setIsolationConfirmed] = useState(false);
  const [releaseNote, setReleaseNote] = useState("");

  const plans = useAsyncData<PlanOption[]>(async () => {
    const { data, error } = await supabase.rpc("get_job_plans", {});
    if (error) throw new Error(error.message);
    const all = (data?.plans ?? []) as PlanOption[];
    // apply_job_plan refuses a draft; offering one would be a button that
    // exists to fail.
    return all.filter((p) => p.status === "adopted");
  }, []);

  const materials = useAsyncData<MaterialOption[]>(async () => {
    const { data, error } = await supabase
      .from("materials")
      .select("id,material_code,description,unit_of_measure")
      .order("material_code");
    if (error) throw new Error(error.message);
    return (data ?? []) as MaterialOption[];
  }, []);

  const call = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw new Error(error.message);
      const r = data as Record<string, unknown> | null;
      if (r && typeof r.error === "string") {
        setFlash(r.error);
        return null;
      }
      return r;
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "That did not work.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = async () => {
    if (!planKey) return;
    const r = await call("apply_job_plan", {
      p_work_order_id: workOrderId,
      p_plan_key: planKey,
    });
    if (r) {
      setFlash(
        `Applied: ${r.tasks_created} task(s), ${r.planned_hours}h planned, ` +
          `${r.materials_requested} material demand(s)` +
          (r.safety_flagged
            ? ". Permits required — this work order is now safety-flagged."
            : "."),
      );
      onChanged();
    }
  };

  const recordActual = async (taskId: string) => {
    const hours = Number(drafts[taskId]);
    if (!Number.isFinite(hours)) {
      setFlash("Enter the hours actually worked.");
      return;
    }
    const r = await call("record_task_actual", {
      p_task_id: taskId,
      p_actual_hours: hours,
      p_status: "complete",
    });
    if (r) {
      setFlash("Recorded. Planning accuracy measures against this now.");
      setDrafts((d) => ({ ...d, [taskId]: "" }));
      onChanged();
    }
  };

  const requestMaterial = async () => {
    const q = Number(qty);
    if (!materialId || !Number.isFinite(q)) {
      setFlash("Choose a material and a quantity.");
      return;
    }
    const r = await call("request_wo_material", {
      p_work_order_id: workOrderId,
      p_material_id: materialId,
      p_qty: q,
    });
    if (r) {
      setFlash("Material demand recorded against this work order.");
      setQty("");
    }
  };

  const releaseEquipment = async () => {
    const r = await call("release_equipment", {
      p_asset_id: assetId,
      p_work_order_id: workOrderId,
      p_isolation_confirmed: isolationConfirmed,
      p_isolation_note: releaseNote || null,
    });
    if (r) {
      setFlash("Equipment released. The work order can now be completed.");
      onChanged();
    }
  };

  const unrecorded = tasks.filter(
    (t) => t.actual_hours == null && t.status !== "completed",
  );

  return (
    <div className="space-y-4">
      {flash && (
        <div className="rounded-lg border border-white/10 bg-industrial-black px-4 py-3 text-sm text-slate-300">
          {flash}
        </div>
      )}

      {tasks.length === 0 && (
        <div className="rounded-lg border border-white/8 bg-industrial-black p-4">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-slate-400" />
            <p className="text-sm font-medium text-industrial-text">
              Apply a job plan
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            An adopted plan brings its steps, labour estimates, material demand
            and permit requirements with it. Drafts are not offered — the
            database refuses them on real work.
          </p>
          {plans.loading ? (
            <p className="mt-2 text-xs text-slate-500">Loading plans…</p>
          ) : (plans.data ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              No adopted plans yet. Adopt one in the planning library first.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                aria-label="Job plan"
                value={planKey}
                onChange={(e) => setPlanKey(e.target.value)}
                className="rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200"
              >
                <option value="">Select an adopted plan…</option>
                {(plans.data ?? []).map((p) => (
                  <option key={p.plan_key} value={p.plan_key}>
                    {p.title} — {p.steps} steps, {p.estimated_hours}h,{" "}
                    {p.materials} materials
                    {p.permits > 0 ? `, ${p.permits} permits` : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={applyPlan}
                disabled={busy || !planKey}
                className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-sm text-teal-300 disabled:opacity-50"
              >
                Apply plan
              </button>
            </div>
          )}
        </div>
      )}

      {unrecorded.length > 0 && (
        <div className="rounded-lg border border-white/8 bg-industrial-black p-4">
          <div className="flex items-center gap-2">
            <Timer size={16} className="text-slate-400" />
            <p className="text-sm font-medium text-industrial-text">
              Record actual hours
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Planning accuracy compares planned to actual. An estimate with no
            recorded actual is a forecast, not a measurement.
          </p>
          <div className="mt-3 space-y-2">
            {unrecorded.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span className="w-8 shrink-0 font-mono text-xs text-slate-500">
                  #{t.task_sequence}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                  {t.description}
                </span>
                <input
                  aria-label={`Actual hours for task ${t.task_sequence}`}
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder={
                    t.estimated_hours != null ? `est ${t.estimated_hours}h` : "hours"
                  }
                  value={drafts[t.id] ?? ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [t.id]: e.target.value }))
                  }
                  className="w-24 rounded-lg border border-white/10 bg-industrial-black px-2 py-1.5 text-xs text-slate-200"
                />
                <button
                  onClick={() => recordActual(t.id)}
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 disabled:opacity-50"
                >
                  Record
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-white/8 bg-industrial-black p-4">
        <div className="flex items-center gap-2">
          <PackagePlus size={16} className="text-slate-400" />
          <p className="text-sm font-medium text-industrial-text">
            Request material
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Material"
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            className="min-w-52 rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200"
          >
            <option value="">Select material…</option>
            {(materials.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.material_code} — {m.description}
              </option>
            ))}
          </select>
          <input
            aria-label="Quantity"
            type="number"
            min="0"
            step="1"
            placeholder="qty"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-20 rounded-lg border border-white/10 bg-industrial-black px-2 py-2 text-sm text-slate-200"
          />
          <button
            onClick={requestMaterial}
            disabled={busy}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 disabled:opacity-50"
          >
            Request
          </button>
        </div>
      </div>

      {/* Work carrying a permit cannot be completed until operations releases
          the equipment — the database refuses the completion outright, and
          maintenance cannot release equipment to itself. Surfacing the act
          here means that refusal arrives as a sentence a person can act on
          instead of a raw trigger error at close-out. */}
      {safetyFlag && assetId && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-amber-300" />
            <p className="text-sm font-medium text-industrial-text">
              Equipment release
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            This work carries permit or isolation requirements. Completion is
            refused until an operations role releases the equipment — a
            maintenance role attempting this will be refused, by design.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={isolationConfirmed}
                onChange={(e) => setIsolationConfirmed(e.target.checked)}
              />
              Isolation verified
            </label>
            <input
              aria-label="Isolation note"
              value={releaseNote}
              onChange={(e) => setReleaseNote(e.target.value)}
              placeholder="e.g. LOTO points 1–3 verified"
              className="min-w-52 rounded-lg border border-white/10 bg-industrial-black px-2 py-1.5 text-xs text-slate-200"
            />
            <button
              onClick={releaseEquipment}
              disabled={busy}
              className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-50"
            >
              Release equipment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
