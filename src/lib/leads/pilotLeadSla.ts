/**
 * How /pilot-leads reads the first-response SLA back.
 *
 * Separate from PilotLeads.tsx so both halves can be unit-tested directly and
 * so the page file exports nothing but a component (react-refresh).
 */
import type { PilotIntakeLead } from "../../services/pilotIntake";

/**
 * The SLA is defined in America/Edmonton — Mon-Fri 08:00-17:00 — and this page
 * is where it is read back. Rendering it in the browser's zone with no label
 * means an owner on a UTC-set or travelling machine reads a deadline hours off
 * the one the acknowledgement email quoted to the customer.
 */
const EDMONTON_STAMP: Intl.DateTimeFormatOptions = {
  timeZone: "America/Edmonton",
  timeZoneName: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** An em dash, never a blank and never "Invalid Date". */
export const NO_VALUE = "—";

export function formatAlbertaStamp(value: string | null | undefined): string {
  if (!value) return NO_VALUE;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return NO_VALUE;
  return parsed.toLocaleString("en-CA", EDMONTON_STAMP);
}

/**
 * Past its one-business-hour deadline and nobody has answered it.
 *
 * Keyed on first_responded_at, which mark_pilot_lead_responded() writes. The
 * earlier version keyed on `status !== 'new'`, but nothing in the product can
 * write `status` — pilot_intake_requests has exactly one RLS policy and it is
 * SELECT — so the flag could never clear. Within a week every row was red,
 * including leads answered in ten minutes, and the one cold-lead signal in the
 * product became noise. `status` is still honoured for a lead moved by some
 * future pipeline; it is simply no longer the only escape.
 */
export function isOverdue(
  lead: Pick<
    PilotIntakeLead,
    "status" | "first_response_due" | "first_responded_at"
  >,
  now: number = Date.now(),
): boolean {
  if (lead.first_responded_at) return false;
  if (lead.status !== "new") return false;
  if (!lead.first_response_due) return false;
  const due = new Date(lead.first_response_due).getTime();
  return Number.isFinite(due) && due < now;
}
