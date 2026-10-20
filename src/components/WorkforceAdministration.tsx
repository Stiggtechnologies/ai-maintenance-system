import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CalendarClock, Gauge, UserRoundPlus } from "lucide-react";
import {
  getCompetencyRequirements,
  recordCapacityDeduction,
  recordCompetency,
  recordMemberCompetency,
  recordResourceCapacity,
  recordShiftAssignment,
  recordWorkforceMember,
  setWorkforceMemberActive,
  type CompetencyCatalogue,
} from "../services/developService";

type ActionResult = { answered: boolean; refusal?: string; note?: string };

const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-signal-cyan/50";
const buttonClass =
  "w-full rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-sm font-semibold text-signal-cyan transition hover:bg-signal-cyan/15 disabled:cursor-not-allowed disabled:opacity-40";

const competencyKinds = [
  "certification",
  "licence",
  "statutory_authorisation",
  "skill",
  "familiarisation",
];
const employmentTypes = ["employee", "contractor", "agency", "oem_specialist"];
const shiftKinds = ["day", "night", "swing", "callout", "overtime", "training", "leave"];
const deductionKinds = [
  "leave",
  "training",
  "sickness",
  "indirect_time",
  "travel",
  "toolbox_and_permits",
  "standby",
  "vacancy",
];

function ControlCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        {icon}
        {title}
      </h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

export function WorkforceAdministration({ onChanged }: { onChanged?: () => void }) {
  const [catalogue, setCatalogue] = useState<CompetencyCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [member, setMember] = useState({
    employeeRef: "",
    displayName: "",
    craft: "",
    employmentType: "employee",
    employer: "",
    fte: "1",
    hiredOn: "",
    expectedDeparture: "",
  });
  const [competency, setCompetency] = useState({
    competencyKey: "",
    title: "",
    kind: "certification",
    validityMonths: "",
    isStatutory: "false",
  });
  const [holding, setHolding] = useState({
    memberId: "",
    competencyId: "",
    grantedOn: "",
    expiresOn: "",
    evidenceReference: "",
  });
  const [shift, setShift] = useState({
    memberId: "",
    startsAt: "",
    endsAt: "",
    shiftKind: "day",
  });
  const [capacity, setCapacity] = useState({
    category: "labour",
    pool: "",
    weeklyHours: "",
    basis: "",
  });
  const [deduction, setDeduction] = useState({
    category: "labour",
    pool: "",
    deductionKind: "leave",
    weeklyHours: "",
    basis: "",
  });
  const [status, setStatus] = useState({ memberId: "", active: "false", reason: "" });

  const loadCatalogue = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCompetencyRequirements();
      setCatalogue(next);
      if (!next.answered) setNotice({ ok: false, text: next.refusal ?? "Workforce catalogue unavailable." });
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Workforce catalogue unavailable." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  const act = async (label: string, action: () => Promise<ActionResult>) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (!result.answered) {
        setNotice({ ok: false, text: result.refusal ?? `${label} was refused.` });
        return;
      }
      setNotice({ ok: true, text: result.note ?? `${label} recorded.` });
      await loadCatalogue();
      onChanged?.();
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : `${label} failed.` });
    } finally {
      setBusy(false);
    }
  };

  const members = catalogue?.members ?? [];
  const competencies = catalogue?.competencies ?? [];

  return (
    <details className="rounded-xl border border-white/8 bg-[#0D1520]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100 marker:hidden">
        Manage workforce evidence
        <span className="ml-2 text-xs font-normal text-slate-500">
          controlled human records, qualifications, shifts and delivered capacity
        </span>
      </summary>
      <div className="border-t border-white/8 p-4">
        <p className="mb-4 max-w-4xl text-xs leading-relaxed text-slate-400">
          These controls extend the canonical workforce, competency, shift and craft-capacity records.
          Role checks, tenant isolation, evidence requirements and the human-only competency act are
          enforced again at the database. SyncAI does not infer qualifications or theoretical capacity.
        </p>

        {notice && (
          <div
            role="status"
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              notice.ok
                ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200"
                : "border-rose-400/25 bg-rose-400/5 text-rose-200"
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <ControlCard
            icon={<UserRoundPlus className="h-4 w-4 text-signal-cyan" aria-hidden />}
            title="Workforce roster"
            description="Record employees, contractors, agency staff and OEM specialists without storing unnecessary personal data."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label="Employee reference" value={member.employeeRef} onChange={(e) => setMember({ ...member, employeeRef: e.target.value })} placeholder="Employee reference" className={inputClass} />
              <input aria-label="Workforce member name" value={member.displayName} onChange={(e) => setMember({ ...member, displayName: e.target.value })} placeholder="Display name" className={inputClass} />
              <input aria-label="Craft or discipline" value={member.craft} onChange={(e) => setMember({ ...member, craft: e.target.value })} placeholder="Craft or discipline" className={inputClass} />
              <select aria-label="Employment type" value={member.employmentType} onChange={(e) => setMember({ ...member, employmentType: e.target.value })} className={inputClass}>
                {employmentTypes.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
              </select>
              <input aria-label="Employer" value={member.employer} onChange={(e) => setMember({ ...member, employer: e.target.value })} placeholder="Employer, if external" className={inputClass} />
              <input aria-label="Full-time equivalent" type="number" min="0.01" max="1.5" step="0.01" value={member.fte} onChange={(e) => setMember({ ...member, fte: e.target.value })} placeholder="FTE" className={inputClass} />
              <label className="text-xs text-slate-500">
                Hire or contract start
                <input aria-label="Hire or contract start" type="date" value={member.hiredOn} onChange={(e) => setMember({ ...member, hiredOn: e.target.value })} className={`${inputClass} mt-1`} />
              </label>
              <label className="text-xs text-slate-500">
                Expected departure or contract end
                <input aria-label="Expected departure or contract end" type="date" min={member.hiredOn || undefined} value={member.expectedDeparture} onChange={(e) => setMember({ ...member, expectedDeparture: e.target.value })} className={`${inputClass} mt-1`} />
              </label>
            </div>
            <button type="button" onClick={() => void act("Workforce member", () => recordWorkforceMember({ ...member, hiredOn: member.hiredOn || undefined, expectedDeparture: member.expectedDeparture || undefined }))} disabled={busy || !member.employeeRef || !member.displayName || Boolean(member.hiredOn && member.expectedDeparture && member.expectedDeparture < member.hiredOn)} className={buttonClass}>Record workforce member</button>

            <div className="grid gap-2 border-t border-white/8 pt-3 sm:grid-cols-2">
              <select aria-label="Roster member" value={status.memberId} onChange={(e) => setStatus({ ...status, memberId: e.target.value })} className={inputClass} disabled={loading}>
                <option value="">Choose member</option>
                {members.map((row) => <option key={row.memberId} value={row.memberId}>{row.displayName} ({row.employeeRef}){row.active ? "" : " — inactive"}</option>)}
              </select>
              <select aria-label="Roster status" value={status.active} onChange={(e) => setStatus({ ...status, active: e.target.value })} className={inputClass}>
                <option value="false">Take off roster</option>
                <option value="true">Put back on roster</option>
              </select>
            </div>
            <textarea aria-label="Roster status reason" value={status.reason} onChange={(e) => setStatus({ ...status, reason: e.target.value })} placeholder="Reason — this changes readiness calculations" className={`${inputClass} min-h-20`} />
            <button type="button" onClick={() => void act("Roster status", () => setWorkforceMemberActive({ memberId: Number(status.memberId), active: status.active === "true", reason: status.reason }))} disabled={busy || !status.memberId || !status.reason.trim()} className={buttonClass}>Record roster status</button>
          </ControlCard>

          <ControlCard
            icon={<BadgeCheck className="h-4 w-4 text-signal-cyan" aria-hidden />}
            title="Competency and evidence"
            description="Define governed competency master data, then separately verify a named person against evidence."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label="Competency key" value={competency.competencyKey} onChange={(e) => setCompetency({ ...competency, competencyKey: e.target.value })} placeholder="Unique key" className={inputClass} />
              <input aria-label="Competency title" value={competency.title} onChange={(e) => setCompetency({ ...competency, title: e.target.value })} placeholder="Title" className={inputClass} />
              <select aria-label="Competency kind" value={competency.kind} onChange={(e) => setCompetency({ ...competency, kind: e.target.value })} className={inputClass}>
                {competencyKinds.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
              </select>
              <input aria-label="Competency validity months" type="number" min="1" step="1" value={competency.validityMonths} onChange={(e) => setCompetency({ ...competency, validityMonths: e.target.value })} placeholder="Validity months" className={inputClass} />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={competency.isStatutory === "true"} onChange={(e) => setCompetency({ ...competency, isStatutory: e.target.checked ? "true" : "false" })} />
              Statutory — validity period required and cannot be waived
            </label>
            <button type="button" onClick={() => void act("Competency", () => recordCompetency(competency))} disabled={busy || !competency.competencyKey || !competency.title} className={buttonClass}>Define competency</button>

            <div className="grid gap-2 border-t border-white/8 pt-3 sm:grid-cols-2">
              <select aria-label="Qualified member" value={holding.memberId} onChange={(e) => setHolding({ ...holding, memberId: e.target.value })} className={inputClass} disabled={loading}>
                <option value="">Choose member</option>
                {members.filter((row) => row.active).map((row) => <option key={row.memberId} value={row.memberId}>{row.displayName}</option>)}
              </select>
              <select aria-label="Verified competency" value={holding.competencyId} onChange={(e) => setHolding({ ...holding, competencyId: e.target.value })} className={inputClass} disabled={loading}>
                <option value="">Choose competency</option>
                {competencies.map((row) => <option key={row.competencyId} value={row.competencyId}>{row.title}</option>)}
              </select>
              <input aria-label="Competency granted on" type="date" value={holding.grantedOn} onChange={(e) => setHolding({ ...holding, grantedOn: e.target.value })} className={inputClass} />
              <input aria-label="Competency expires on" type="date" value={holding.expiresOn} onChange={(e) => setHolding({ ...holding, expiresOn: e.target.value })} className={inputClass} />
            </div>
            <input aria-label="Competency evidence reference" value={holding.evidenceReference} onChange={(e) => setHolding({ ...holding, evidenceReference: e.target.value })} placeholder="Certificate, assessment or authorization reference" className={inputClass} />
            <button type="button" onClick={() => void act("Competency holding", () => recordMemberCompetency({ memberId: Number(holding.memberId), competencyId: Number(holding.competencyId), grantedOn: holding.grantedOn || undefined, expiresOn: holding.expiresOn || undefined, evidenceReference: holding.evidenceReference }))} disabled={busy || !holding.memberId || !holding.competencyId || !holding.evidenceReference.trim()} className={buttonClass}>Verify competency holding</button>
          </ControlCard>

          <ControlCard
            icon={<CalendarClock className="h-4 w-4 text-signal-cyan" aria-hidden />}
            title="Shift calendar"
            description="Record when a named, active person is actually rostered; qualification alone does not create availability."
          >
            <select aria-label="Shift member" value={shift.memberId} onChange={(e) => setShift({ ...shift, memberId: e.target.value })} className={inputClass} disabled={loading}>
              <option value="">Choose active member</option>
              {members.filter((row) => row.active).map((row) => <option key={row.memberId} value={row.memberId}>{row.displayName}</option>)}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label="Shift starts" type="datetime-local" value={shift.startsAt} onChange={(e) => setShift({ ...shift, startsAt: e.target.value })} className={inputClass} />
              <input aria-label="Shift ends" type="datetime-local" value={shift.endsAt} onChange={(e) => setShift({ ...shift, endsAt: e.target.value })} className={inputClass} />
            </div>
            <select aria-label="Shift kind" value={shift.shiftKind} onChange={(e) => setShift({ ...shift, shiftKind: e.target.value })} className={inputClass}>
              {shiftKinds.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <button type="button" onClick={() => void act("Shift assignment", () => recordShiftAssignment({ memberId: Number(shift.memberId), startsAt: shift.startsAt, endsAt: shift.endsAt, shiftKind: shift.shiftKind }))} disabled={busy || !shift.memberId || !shift.startsAt || !shift.endsAt} className={buttonClass}>Roster shift</button>
          </ControlCard>

          <ControlCard
            icon={<Gauge className="h-4 w-4 text-signal-cyan" aria-hidden />}
            title="Delivered workforce capacity"
            description="Record the net hours the scheduler can use, with itemized deductions as explanation—not a second subtraction."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label="Capacity pool" value={capacity.pool} onChange={(e) => setCapacity({ ...capacity, pool: e.target.value })} placeholder="Craft, team or contractor pool" className={inputClass} />
              <input aria-label="Delivered weekly hours" type="number" min="0.01" step="0.01" value={capacity.weeklyHours} onChange={(e) => setCapacity({ ...capacity, weeklyHours: e.target.value })} placeholder="Net weekly hours" className={inputClass} />
            </div>
            <textarea aria-label="Capacity basis" value={capacity.basis} onChange={(e) => setCapacity({ ...capacity, basis: e.target.value })} placeholder="Basis for the delivered-hours figure (20 characters minimum)" className={`${inputClass} min-h-20`} />
            <button type="button" onClick={() => void act("Resource capacity", () => recordResourceCapacity(capacity))} disabled={busy || !capacity.pool || !capacity.weeklyHours || capacity.basis.trim().length < 20} className={buttonClass}>Record delivered capacity</button>

            <div className="grid gap-2 border-t border-white/8 pt-3 sm:grid-cols-3">
              <input aria-label="Deduction pool" value={deduction.pool} onChange={(e) => setDeduction({ ...deduction, pool: e.target.value })} placeholder="Same pool" className={inputClass} />
              <select aria-label="Capacity deduction kind" value={deduction.deductionKind} onChange={(e) => setDeduction({ ...deduction, deductionKind: e.target.value })} className={inputClass}>
                {deductionKinds.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
              </select>
              <input aria-label="Deduction weekly hours" type="number" min="0" step="0.01" value={deduction.weeklyHours} onChange={(e) => setDeduction({ ...deduction, weeklyHours: e.target.value })} placeholder="Hours explained" className={inputClass} />
            </div>
            <textarea aria-label="Capacity deduction basis" value={deduction.basis} onChange={(e) => setDeduction({ ...deduction, basis: e.target.value })} placeholder="Evidence for this deduction (20 characters minimum)" className={`${inputClass} min-h-20`} />
            <button type="button" onClick={() => void act("Capacity deduction", () => recordCapacityDeduction(deduction))} disabled={busy || !deduction.pool || deduction.weeklyHours === "" || deduction.basis.trim().length < 20} className={buttonClass}>Record capacity deduction</button>
          </ControlCard>
        </div>
      </div>
    </details>
  );
}
