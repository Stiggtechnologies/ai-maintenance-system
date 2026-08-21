import { useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, FileCheck2, Loader2, X } from "lucide-react";
import {
  activateRiaFromIntake,
  listRiaActivationOrganizations,
  type PilotIntakeLead,
  type RiaActivationOrganization,
} from "../../services/pilotIntake";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RiaActivationResult = {
  assessmentId: string;
  organizationId: string;
};

type Props = {
  lead: PilotIntakeLead;
  onClose: () => void;
  onActivated: (result: RiaActivationResult) => void | Promise<void>;
};

function organizationLabel(org: RiaActivationOrganization): string {
  return `${org.name} · ${org.id}`;
}

/**
 * Feature-lane UI only. The dialog records an operator's commercial intent and
 * sends it to activate_ria_from_intake; it never writes a lead, organization or
 * assessment table directly. The server contract owns authority, tenancy,
 * idempotency and provenance.
 */
export function RiaActivationDialog({ lead, onClose, onActivated }: Props) {
  const [organizations, setOrganizations] = useState<RiaActivationOrganization[]>([]);
  const [directoryAvailable, setDirectoryAvailable] = useState<boolean | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState(
    lead.activated_organization_id ?? "",
  );
  const [scopeLabel, setScopeLabel] = useState(lead.asset_scope || "");
  const [targetEndOn, setTargetEndOn] = useState("");
  const [acceptanceReference, setAcceptanceReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await listRiaActivationOrganizations();
        if (cancelled) return;
        setOrganizations(directory.organizations);
        setDirectoryAvailable(directory.available);
        if (
          directory.available &&
          directory.organizations.length === 1 &&
          !organizationId
        ) {
          setOrganizationId(directory.organizations[0].id);
        }
      } catch (cause) {
        if (cancelled) return;
        setDirectoryAvailable(false);
        setDirectoryError(
          cause instanceof Error
            ? cause.message
            : "Organization directory could not be loaded.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // Load once for the specific activation attempt.

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  const selectedOrganization = useMemo(
    () => organizations.find((org) => org.id === organizationId) ?? null,
    [organizations, organizationId],
  );

  const organizationIsValid = UUID_PATTERN.test(organizationId.trim());
  const canSubmit =
    !submitting &&
    organizationIsValid &&
    scopeLabel.trim().length >= 3 &&
    acceptanceReference.trim().length >= 3;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const { assessmentId } = await activateRiaFromIntake({
        leadId: lead.id,
        organizationId: organizationId.trim(),
        scopeLabel: scopeLabel.trim(),
        targetEndOn: targetEndOn || null,
        acceptanceReference: acceptanceReference.trim(),
      });
      await onActivated({
        assessmentId,
        organizationId: organizationId.trim(),
      });
    } catch (cause) {
      setSubmitError(
        cause instanceof Error ? cause.message : "RIA activation failed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ria-activation-title"
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#07111A] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
              Commercial activation
            </p>
            <h2
              id="ria-activation-title"
              className="mt-2 text-xl font-semibold text-white"
            >
              Activate Reliability Intelligence Assessment
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {lead.company} · {lead.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close activation dialog"
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 px-6 py-6">
          <div className="rounded-xl border border-teal-300/15 bg-teal-300/5 p-4">
            <div className="flex gap-3">
              <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" />
              <div>
                <p className="text-sm font-medium text-slate-100">
                  Standard RIA · US$35,000 fixed fee · 6–8 weeks
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Activation records a commercial-acceptance reference. It does
                  not invent a payment event or auto-create a customer tenant.
                  The target must already exist as an organization in SyncAI.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="ria-activation-org"
              className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-200"
            >
              <Building2 size={15} className="text-teal-300" />
              Existing customer organization
            </label>

            {directoryAvailable === null ? (
              <div className="flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-slate-400">
                <Loader2 size={15} className="animate-spin" />
                Loading authorized organizations…
              </div>
            ) : directoryAvailable && organizations.length > 0 ? (
              <select
                id="ria-activation-org"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#0B151F] px-3 py-2.5 text-sm text-slate-100 outline-hidden focus:border-teal-300/50"
                required
              >
                <option value="">Select an existing organization</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {organizationLabel(org)}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  id="ria-activation-org"
                  value={organizationId}
                  onChange={(event) => setOrganizationId(event.target.value)}
                  placeholder="Existing organization UUID"
                  autoComplete="off"
                  className="w-full rounded-lg border border-white/10 bg-[#0B151F] px-3 py-2.5 font-mono text-sm text-slate-100 outline-hidden placeholder:text-slate-600 focus:border-teal-300/50"
                  required
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  The cross-tenant admin directory is not deployed, so this
                  falls back to an explicit existing organization UUID. The
                  server still validates the organization and your authority.
                </p>
              </>
            )}
            {directoryError ? (
              <p className="mt-1.5 text-xs text-amber-300">{directoryError}</p>
            ) : null}
            {organizationId && !organizationIsValid ? (
              <p className="mt-1.5 text-xs text-red-300">
                Enter a valid organization UUID.
              </p>
            ) : null}
            {selectedOrganization ? (
              <p className="mt-1.5 text-xs text-slate-500">
                Activation target: {selectedOrganization.name}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="ria-activation-scope"
              className="mb-1.5 block text-sm font-medium text-slate-200"
            >
              Bounded assessment scope
            </label>
            <input
              id="ria-activation-scope"
              value={scopeLabel}
              onChange={(event) => setScopeLabel(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0B151F] px-3 py-2.5 text-sm text-slate-100 outline-hidden focus:border-teal-300/50"
              placeholder="e.g. Haul truck fleet — 42 units"
              required
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Pre-filled from the lead's submitted asset scope. Edit only to
              match the commercially accepted boundary.
            </p>
          </div>

          <div>
            <label
              htmlFor="ria-activation-date"
              className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-200"
            >
              <CalendarDays size={15} className="text-teal-300" />
              Target completion date <span className="text-slate-500">(optional)</span>
            </label>
            <input
              id="ria-activation-date"
              type="date"
              value={targetEndOn}
              onChange={(event) => setTargetEndOn(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0B151F] px-3 py-2.5 text-sm text-slate-100 outline-hidden focus:border-teal-300/50"
            />
          </div>

          <div>
            <label
              htmlFor="ria-activation-reference"
              className="mb-1.5 block text-sm font-medium text-slate-200"
            >
              Commercial acceptance reference
            </label>
            <input
              id="ria-activation-reference"
              value={acceptanceReference}
              onChange={(event) => setAcceptanceReference(event.target.value)}
              placeholder="Signed SOW, PO, invoice, or payment reference"
              autoComplete="off"
              className="w-full rounded-lg border border-white/10 bg-[#0B151F] px-3 py-2.5 text-sm text-slate-100 outline-hidden placeholder:text-slate-600 focus:border-teal-300/50"
              required
            />
            <p className="mt-1.5 text-xs text-slate-500">
              This is the evidence that activation was authorized. SyncAI does
              not infer “paid” from the lead status.
            </p>
          </div>

          {submitError ? (
            <div
              className="rounded-lg border border-red-300/20 bg-red-300/5 px-4 py-3 text-sm text-red-200"
              role="alert"
            >
              {submitError}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-white/8 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <FileCheck2 size={16} />}
              {submitting ? "Activating…" : "Activate RIA"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default RiaActivationDialog;
