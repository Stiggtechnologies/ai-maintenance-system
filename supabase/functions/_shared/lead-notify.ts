/**
 * lead-notify — every pure decision and every word of copy behind the
 * "a lead must never go cold" path.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM index.ts. vitest's include glob is
 * `src/**` only, and Deno is installed neither locally nor in CI, so anything
 * that reaches for a Deno global is untested and untypechecked by
 * construction. tsconfig.app.json therefore includes
 * supabase/functions/_shared, and src/lib/lead-notify/lead-notify.test.ts
 * imports THIS EXACT FILE. Nothing here touches Deno, the network, or the
 * environment: config arrives as arguments, side effects live in index.ts.
 *
 * THE SLA. First response is due one BUSINESS hour after the lead arrives,
 * where business hours are Mon-Fri 08:00-17:00 in America/Edmonton — the wall
 * clock of the person who has to answer. The authoritative deadline is
 * computed in SQL (business_hours_deadline, 20260914090000) and stored on the
 * row; businessHoursDeadline() below is a deliberate mirror of that algorithm,
 * used to render the deadline and as a fallback if the column is ever empty.
 * Both implementations are held to the same edge cases — Friday 16:30 rolls to
 * Monday 08:30, a weekend rolls to Monday 09:00 — the SQL against a live
 * Postgres, this one in vitest.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A row of public.pilot_intake_requests, exactly as the table stores it. */
export interface PilotIntakeLead {
  id: string;
  created_at: string;
  status: string;
  name: string;
  email: string;
  company: string;
  role: string | null;
  industry: string | null;
  asset_scope: string;
  system_of_record: string | null;
  history_available: string | null;
  primary_pain: string;
  data_readiness: string;
  security_need: string;
  commercial_model: string;
  notes: string | null;
  notification_status: string;
  notified_at: string | null;
  source_path: string;
  first_response_due: string | null;
}

/** The three values PilotLeads.tsx knows how to render. Nothing else is valid. */
export const NOTIFICATION_STATUS = {
  queued: "queued",
  notified: "notified",
  failed: "failed",
} as const;

export type NotificationStatus =
  (typeof NOTIFICATION_STATUS)[keyof typeof NOTIFICATION_STATUS];

export interface BusinessHours {
  timeZone: string;
  /** First hour of the working day, local wall clock. */
  openHour: number;
  /** Hour the working day ends, local wall clock. Exclusive. */
  closeHour: number;
}

export const ALBERTA_BUSINESS_HOURS: BusinessHours = {
  timeZone: "America/Edmonton",
  openHour: 8,
  closeHour: 17,
};

/** One business hour. The owner's commitment, and the promise in the copy. */
export const FIRST_RESPONSE_SLA_MINUTES = 60;

/** Route registered in App.tsx for the admin leads table. */
export const ADMIN_LEADS_PATH = "/pilot-leads";

export const DEFAULT_APP_BASE_URL = "https://app.syncai.ca";

/**
 * Customer-facing mail leaves from the verified domain or it does not leave at
 * all. syncai.ca holds the DKIM and return-path records; a gmail From on a
 * sales reply is both a deliverability problem and the wrong signal.
 */
export const SYNCAI_SENDER_DOMAIN = "syncai.ca";
export const DEFAULT_ACK_FROM = "Orville Davis <orville@syncai.ca>";
export const DEFAULT_ACK_REPLY_TO = "orville@syncai.ca";
export const DEFAULT_OWNER_ALERT_FROM = "SyncAI Leads <leads@syncai.ca>";
export const DEFAULT_OWNER_ALERT_EMAIL = "orvilledavis95@gmail.com";

// ---------------------------------------------------------------------------
// Time zone arithmetic (Intl only — no dependency, works in Deno and vitest)
// ---------------------------------------------------------------------------

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const MS_PER_DAY = 86_400_000;

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The wall clock a given instant shows in a given zone. */
function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const found: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }

  return {
    year: found.year ?? 1970,
    month: found.month ?? 1,
    day: found.day ?? 1,
    // Some ICU builds render midnight as hour 24 under hour12:false.
    hour: (found.hour ?? 0) % 24,
    minute: found.minute ?? 0,
    second: found.second ?? 0,
  };
}

/** Zone offset in ms at a given instant: (wall clock) - (UTC). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = wallClockIn(instant, timeZone);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a zone shows the given wall clock. Resolved in two
 * passes so a deadline that lands on the far side of a DST change still gets
 * the offset that is actually in force when it arrives.
 */
function instantForWallClock(wall: WallClock, timeZone: string): Date {
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const firstPass = asIfUtc - zoneOffsetMs(new Date(asIfUtc), timeZone);
  const secondPass = asIfUtc - zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/** A calendar day as a UTC midnight, used purely as DST-free day arithmetic. */
function calendarDayMs(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day);
}

/** ISO weekday for a calendar-day carrier: 1 = Monday … 7 = Sunday. */
function isoWeekday(dayMs: number): number {
  const jsDay = new Date(dayMs).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function toDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Adds a working duration to an instant across Mon-Fri openHour-closeHour in
 * the given zone. Mirrors public.business_hours_deadline.
 *
 *   * a weekend day, or an instant at/after close, supplies nothing — advance
 *   * an instant before open is pulled forward to open
 *   * otherwise consume min(remaining, time until close) and carry any
 *     remainder into the next business day
 *
 * Returns null for an unparseable start, so a caller can decide what to say
 * rather than have "Invalid Date" reach a customer.
 */
export function businessHoursDeadline(
  from: Date | string | null | undefined,
  durationMinutes: number,
  hours: BusinessHours = ALBERTA_BUSINESS_HOURS,
): Date | null {
  const start = toDate(from);
  if (!start) return null;

  const openSec = hours.openHour * 3600;
  const closeSec = hours.closeHour * 3600;
  if (!(closeSec > openSec)) return null;

  const startWall = wallClockIn(start, hours.timeZone);
  let dayMs = calendarDayMs(startWall);
  let cursorSec =
    startWall.hour * 3600 + startWall.minute * 60 + startWall.second;
  let remainingSec = Math.max(0, Math.round(durationMinutes * 60));

  // A business day supplies (close - open) hours, so any sane SLA resolves in
  // a handful of passes. The bound only stops a pathological duration from
  // spinning — it never fires for the one-hour SLA this ships with.
  for (let guard = 0; guard < 400; guard += 1) {
    if (isoWeekday(dayMs) >= 6 || cursorSec >= closeSec) {
      dayMs += MS_PER_DAY;
      cursorSec = 0;
      continue;
    }
    if (cursorSec < openSec) cursorSec = openSec;

    const availableSec = closeSec - cursorSec;
    if (remainingSec <= availableSec) {
      const endSec = cursorSec + remainingSec;
      const day = new Date(dayMs);
      return instantForWallClock(
        {
          year: day.getUTCFullYear(),
          month: day.getUTCMonth() + 1,
          day: day.getUTCDate(),
          hour: Math.floor(endSec / 3600),
          minute: Math.floor((endSec % 3600) / 60),
          second: endSec % 60,
        },
        hours.timeZone,
      );
    }

    remainingSec -= availableSec;
    dayMs += MS_PER_DAY;
    cursorSec = 0;
  }

  return null;
}

/** "MST" / "MDT" for the instant — whichever is actually in force. */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(instant);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * "Fri Sep 18, 2026 at 4:30 PM MDT". Assembled by hand rather than left to
 * dateStyle so the string does not drift between ICU versions — this text goes
 * into a customer email and into a test.
 */
export function formatBusinessInstant(
  instant: Date | string | null | undefined,
  timeZone: string = ALBERTA_BUSINESS_HOURS.timeZone,
): string | null {
  const date = toDate(instant);
  if (!date) return null;

  const wall = wallClockIn(date, timeZone);
  const weekday = WEEKDAY_LABELS[isoWeekday(calendarDayMs(wall)) - 1];
  const month = MONTH_LABELS[wall.month - 1];
  const meridiem = wall.hour < 12 ? "AM" : "PM";
  const hour12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12;
  const minute = String(wall.minute).padStart(2, "0");
  const zone = zoneAbbreviation(date, timeZone);

  const stamp = `${weekday} ${month} ${wall.day}, ${wall.year} at ${hour12}:${minute} ${meridiem}`;
  return zone ? `${stamp} ${zone}` : stamp;
}

/** The short form the owner sees in a subject line: "Mon 8:30 AM MDT". */
export function formatBusinessInstantShort(
  instant: Date | string | null | undefined,
  timeZone: string = ALBERTA_BUSINESS_HOURS.timeZone,
): string | null {
  const date = toDate(instant);
  if (!date) return null;

  const wall = wallClockIn(date, timeZone);
  const weekday = WEEKDAY_LABELS[isoWeekday(calendarDayMs(wall)) - 1];
  const meridiem = wall.hour < 12 ? "AM" : "PM";
  const hour12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12;
  const minute = String(wall.minute).padStart(2, "0");
  const zone = zoneAbbreviation(date, timeZone);

  const stamp = `${weekday} ${hour12}:${minute} ${meridiem}`;
  return zone ? `${stamp} ${zone}` : stamp;
}

/**
 * The deadline to show. The stored column is authoritative — it is the promise
 * made when the lead arrived — and the mirror only covers for a row that
 * somehow has none.
 */
export function resolveFirstResponseDue(
  lead: Pick<PilotIntakeLead, "created_at" | "first_response_due">,
  hours: BusinessHours = ALBERTA_BUSINESS_HOURS,
): Date | null {
  const stored = toDate(lead.first_response_due);
  if (stored) return stored;
  return businessHoursDeadline(
    lead.created_at,
    FIRST_RESPONSE_SLA_MINUTES,
    hours,
  );
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * pg_net can deliver more than once, and a human can re-run the function by
 * hand. Neither may send a second acknowledgement to the same person.
 */
export function isAlreadyNotified(
  lead: Pick<PilotIntakeLead, "notification_status">,
): boolean {
  return (
    (lead.notification_status ?? "").trim().toLowerCase() ===
    NOTIFICATION_STATUS.notified
  );
}

export interface ChannelOutcome {
  /** The acknowledgement to the lead. */
  acknowledgementSent: boolean;
  /** The alert to the owner's inbox. */
  ownerEmailSent: boolean;
  /** null when Twilio is not configured — a skip, not a failure. */
  smsSent: boolean | null;
}

/**
 * 'notified' only when both emails landed. SMS never decides this: it is an
 * extra shout, and it is inert until Twilio exists. A half-delivered
 * notification stays 'failed' so it shows red on the leads page and a person
 * picks it up — which is the entire point of the exercise.
 */
export function resolveNotificationStatus(
  outcome: ChannelOutcome,
): NotificationStatus {
  return outcome.acknowledgementSent && outcome.ownerEmailSent
    ? NOTIFICATION_STATUS.notified
    : NOTIFICATION_STATUS.failed;
}

// ---------------------------------------------------------------------------
// Text hygiene — nothing absent may reach the page
// ---------------------------------------------------------------------------

/**
 * A field's value, or null when there is nothing to say. The intake RPC writes
 * '' (not NULL) for omitted optional fields, and a stringified "null" or
 * "undefined" has to be treated as absence too — the whole point is that no
 * placeholder ever reaches a customer's inbox.
 */
export function presentValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "null" || lowered === "undefined" || lowered === "nan") {
    return null;
  }
  return trimmed;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First given name, for a greeting. Null when there is nothing usable. */
export function greetingName(name: unknown): string | null {
  const present = presentValue(name);
  if (!present) return null;
  const first = present.split(/\s+/)[0];
  return presentValue(first);
}

// ---------------------------------------------------------------------------
// Senders and links
// ---------------------------------------------------------------------------

/** The bare address out of "Name <a@b.c>" or "a@b.c". */
export function extractEmailAddress(sender: string): string | null {
  const present = presentValue(sender);
  if (!present) return null;
  const angled = present.match(/<([^>]+)>/);
  const raw = (angled ? angled[1] : present).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null;
}

/**
 * Exact-domain match, deliberately. "orville@syncai.ca.attacker.example" and
 * "orville@mail.syncai.ca" both fail: only syncai.ca itself carries the
 * verified DKIM and return-path records.
 */
export function isSyncaiSender(sender: string): boolean {
  const address = extractEmailAddress(sender);
  if (!address) return false;
  return address.slice(address.lastIndexOf("@") + 1) === SYNCAI_SENDER_DOMAIN;
}

/**
 * A misconfigured env var must never turn into mail from the wrong domain, so
 * an override that is not @syncai.ca is discarded in favour of the default.
 */
export function resolveSender(
  candidate: string | null | undefined,
  fallback: string,
): string {
  const present = presentValue(candidate);
  if (present && isSyncaiSender(present)) return present;
  return fallback;
}

/** https://app.syncai.ca/pilot-leads — the row the owner needs to open. */
export function buildAdminLeadsUrl(
  appBaseUrl: string | null | undefined,
  path: string = ADMIN_LEADS_PATH,
): string {
  const candidate = presentValue(appBaseUrl) ?? DEFAULT_APP_BASE_URL;
  let base: URL;
  try {
    base = new URL(candidate);
    if (base.protocol !== "https:") base = new URL(DEFAULT_APP_BASE_URL);
  } catch {
    base = new URL(DEFAULT_APP_BASE_URL);
  }
  const origin = base.origin;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${suffix}`;
}

// ---------------------------------------------------------------------------
// Email content
// ---------------------------------------------------------------------------

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateContext {
  lead: PilotIntakeLead;
  /** Resolved deadline, or null when it could not be computed. */
  dueAt: Date | null;
  appBaseUrl?: string | null;
  timeZone?: string;
}

const HTML_SHELL_OPEN =
  '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;">';
const HTML_SHELL_CLOSE = "</div>";

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px 0;">${text}</p>`;
}

/**
 * The acknowledgement the lead receives.
 *
 * Constraints this copy is written to, not decorated with: it promises exactly
 * the commitment the owner made (one business hour), it names only values the
 * visitor actually submitted, and it quotes no price, term, or timeline that
 * the owner has not personally agreed to. Every optional line is dropped
 * outright when its value is absent rather than rendered empty.
 */
export function buildLeadAcknowledgement(ctx: TemplateContext): EmailContent {
  const { lead } = ctx;
  const timeZone = ctx.timeZone ?? ALBERTA_BUSINESS_HOURS.timeZone;
  const first = greetingName(lead.name);
  const company = presentValue(lead.company);
  const assetScope = presentValue(lead.asset_scope);
  const primaryPain = presentValue(lead.primary_pain);
  const dueText = formatBusinessInstant(ctx.dueAt, timeZone);

  const subject = company
    ? `We have your SyncAI pilot request — ${company}`
    : "We have your SyncAI pilot request";

  const greeting = first ? `Hi ${first},` : "Hi there,";

  const opening = company
    ? `Thanks for sending through the pilot request for ${company}. It is in, and I have been alerted.`
    : "Thanks for sending through your pilot request. It is in, and I have been alerted.";

  const submitted: string[] = [];
  if (assetScope) submitted.push(`Assets or systems in scope: ${assetScope}`);
  if (primaryPain) submitted.push(`Primary reliability pain: ${primaryPain}`);

  const commitment = dueText
    ? `I will come back to you personally within one business hour — by ${dueText}. Business hours here are Monday to Friday, 8:00 AM to 5:00 PM Mountain Time, so a request that arrives outside them is answered within the first hour of the next working day.`
    : "I will come back to you personally within one business hour. Business hours here are Monday to Friday, 8:00 AM to 5:00 PM Mountain Time, so a request that arrives outside them is answered within the first hour of the next working day.";

  const closing =
    "If anything has changed in the meantime, or you would rather talk it through first, just reply to this message.";

  const textLines: string[] = [greeting, "", opening, ""];
  if (submitted.length > 0) {
    textLines.push("What you told us:");
    for (const line of submitted) textLines.push(`  - ${line}`);
    textLines.push("");
  }
  textLines.push(commitment, "", closing, "", "Orville Davis", "SyncAI");

  const htmlParts: string[] = [
    HTML_SHELL_OPEN,
    paragraph(escapeHtml(greeting)),
    paragraph(escapeHtml(opening)),
  ];
  if (submitted.length > 0) {
    htmlParts.push(
      paragraph("What you told us:"),
      `<ul style="margin:0 0 14px 0;padding-left:20px;">${submitted
        .map((line) => `<li style="margin:0 0 6px 0;">${escapeHtml(line)}</li>`)
        .join("")}</ul>`,
    );
  }
  htmlParts.push(
    paragraph(escapeHtml(commitment)),
    paragraph(escapeHtml(closing)),
    paragraph("Orville Davis<br />SyncAI"),
    HTML_SHELL_CLOSE,
  );

  return {
    subject,
    text: textLines.join("\n"),
    html: htmlParts.join(""),
  };
}

/** Label / value pairs for the owner alert, in intake-form order. */
export const OWNER_ALERT_FIELDS: ReadonlyArray<{
  label: string;
  key: keyof PilotIntakeLead;
}> = [
  { label: "Name", key: "name" },
  { label: "Work email", key: "email" },
  { label: "Company", key: "company" },
  { label: "Role", key: "role" },
  { label: "Industry", key: "industry" },
  { label: "Asset / system scope", key: "asset_scope" },
  { label: "System of record", key: "system_of_record" },
  { label: "History available", key: "history_available" },
  { label: "Primary pain", key: "primary_pain" },
  { label: "Data readiness", key: "data_readiness" },
  { label: "Security need", key: "security_need" },
  { label: "Commercial model", key: "commercial_model" },
  { label: "Notes", key: "notes" },
  { label: "Source path", key: "source_path" },
  { label: "Lead status", key: "status" },
  { label: "Lead id", key: "id" },
];

/** Shown in place of an omitted optional field. Never blank, never "null". */
export const NOT_PROVIDED = "not provided";

/**
 * The owner's alert: every field the visitor submitted, the deadline, and one
 * link straight to the row. Its reply-to stays on @syncai.ca rather than
 * pointing at the lead, because a reply typed from a gmail thread is a reply
 * sent from gmail — and customer-facing mail leaves from syncai.ca.
 */
export function buildOwnerAlert(ctx: TemplateContext): EmailContent {
  const { lead } = ctx;
  const timeZone = ctx.timeZone ?? ALBERTA_BUSINESS_HOURS.timeZone;
  const company = presentValue(lead.company) ?? "Unknown company";
  const name = presentValue(lead.name) ?? "Unknown contact";
  const dueShort = formatBusinessInstantShort(ctx.dueAt, timeZone);
  const dueLong = formatBusinessInstant(ctx.dueAt, timeZone);
  const arrived = formatBusinessInstant(lead.created_at, timeZone);
  const leadsUrl = buildAdminLeadsUrl(ctx.appBaseUrl);
  const leadEmail = presentValue(lead.email);

  const subject = dueShort
    ? `New pilot lead — ${company} (${name}) — reply by ${dueShort}`
    : `New pilot lead — ${company} (${name})`;

  const rows = OWNER_ALERT_FIELDS.map(({ label, key }) => ({
    label,
    value: presentValue(lead[key]) ?? NOT_PROVIDED,
  }));

  const headline = dueLong
    ? `First response is due by ${dueLong} — one business hour from arrival.`
    : "First response is due within one business hour of arrival.";

  const arrivedLine = arrived
    ? `Arrived ${arrived}.`
    : "Arrival time unavailable.";

  const replyLine = leadEmail
    ? `Reply to ${leadEmail} from your @syncai.ca address — never from gmail.`
    : "Reply from your @syncai.ca address — never from gmail.";

  const textLines: string[] = [
    headline,
    arrivedLine,
    "",
    ...rows.map(({ label, value }) => `${label}: ${value}`),
    "",
    replyLine,
    `Open the lead: ${leadsUrl}`,
  ];

  const html = [
    HTML_SHELL_OPEN,
    paragraph(`<strong>${escapeHtml(headline)}</strong>`),
    paragraph(escapeHtml(arrivedLine)),
    '<table style="border-collapse:collapse;width:100%;max-width:640px;margin:0 0 16px 0;">',
    rows
      .map(
        ({ label, value }) =>
          `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;color:#475569;white-space:nowrap;">${escapeHtml(
            label,
          )}</td><td style="padding:6px 0;vertical-align:top;">${escapeHtml(
            value,
          )}</td></tr>`,
      )
      .join(""),
    "</table>",
    paragraph(escapeHtml(replyLine)),
    paragraph(
      `<a href="${escapeHtml(leadsUrl)}" style="color:#0d9488;">Open the lead in SyncAI</a>`,
    ),
    HTML_SHELL_CLOSE,
  ].join("");

  return { subject, text: textLines.join("\n"), html };
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  cc?: string[];
}

export interface ResendPayloadInput {
  from: string;
  to: string | string[];
  content: EmailContent;
  replyTo?: string | null;
  cc?: string | string[] | null;
}

function addressList(value: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const cleaned: string[] = [];
  for (const entry of raw) {
    const address = extractEmailAddress(String(entry ?? ""));
    if (address && !cleaned.includes(address)) cleaned.push(address);
  }
  return cleaned;
}

/**
 * The exact JSON body Resend receives. Optional keys are omitted rather than
 * sent empty — Resend rejects an empty reply_to outright, and a request that
 * 422s is a lead going cold.
 */
export function buildResendPayload(input: ResendPayloadInput): ResendPayload {
  const payload: ResendPayload = {
    from: input.from,
    to: addressList(input.to),
    subject: input.content.subject,
    html: input.content.html,
    text: input.content.text,
  };
  const replyTo = extractEmailAddress(String(input.replyTo ?? ""));
  if (replyTo) payload.reply_to = replyTo;
  const cc = addressList(input.cc);
  if (cc.length > 0) payload.cc = cc;
  return payload;
}

export function buildResendRequest(
  apiKey: string,
  payload: ResendPayload,
): {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
} {
  return {
    url: RESEND_ENDPOINT,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

// ---------------------------------------------------------------------------
// Twilio — built, and inert until it is configured
// ---------------------------------------------------------------------------

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * True only when all four settings are present AND both numbers are E.164.
 * Anything short of that is a silent skip, never a failure: the owner asked
 * for SMS, no Twilio account exists yet, and a missing shout must not mark a
 * lead whose emails went out as failed.
 */
export function isTwilioConfigured(
  config: Partial<TwilioConfig> | null | undefined,
): config is TwilioConfig {
  if (!config) return false;
  const sid = presentValue(config.accountSid);
  const token = presentValue(config.authToken);
  const from = presentValue(config.fromNumber);
  const to = presentValue(config.toNumber);
  if (!sid || !token || !from || !to) return false;
  return E164.test(from) && E164.test(to);
}

/** Which settings are missing, for a structured skip log. Never the values. */
export function missingTwilioSettings(
  config: Partial<TwilioConfig> | null | undefined,
): string[] {
  const checks: Array<[string, string | null]> = [
    ["TWILIO_ACCOUNT_SID", presentValue(config?.accountSid)],
    ["TWILIO_AUTH_TOKEN", presentValue(config?.authToken)],
    ["TWILIO_FROM_NUMBER", presentValue(config?.fromNumber)],
    ["OWNER_SMS_TO", presentValue(config?.toNumber)],
  ];
  const missing = checks.filter(([, value]) => !value).map(([name]) => name);
  const from = presentValue(config?.fromNumber);
  const to = presentValue(config?.toNumber);
  if (from && !E164.test(from)) missing.push("TWILIO_FROM_NUMBER (not E.164)");
  if (to && !E164.test(to)) missing.push("OWNER_SMS_TO (not E.164)");
  return missing;
}

export const SMS_MAX_LENGTH = 320;

/** One glanceable line. Truncated on a boundary rather than mid-word. */
export function buildOwnerSms(ctx: TemplateContext): string {
  const { lead } = ctx;
  const timeZone = ctx.timeZone ?? ALBERTA_BUSINESS_HOURS.timeZone;
  const company = presentValue(lead.company) ?? "Unknown company";
  const name = presentValue(lead.name) ?? "Unknown contact";
  const pain = presentValue(lead.primary_pain);
  const dueShort = formatBusinessInstantShort(ctx.dueAt, timeZone);

  const pieces = [`SyncAI lead: ${company} (${name})`];
  if (pain) pieces.push(`Pain: ${pain}`);
  pieces.push(
    dueShort ? `Reply by ${dueShort}` : "Reply within 1 business hour",
  );
  pieces.push(buildAdminLeadsUrl(ctx.appBaseUrl));

  const message = pieces.join(". ");
  if (message.length <= SMS_MAX_LENGTH) return message;
  return `${message.slice(0, SMS_MAX_LENGTH - 1).trimEnd()}…`;
}

export function twilioEndpoint(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    accountSid,
  )}/Messages.json`;
}

/**
 * The Twilio request, shaped but not sent. Basic auth of SID:token,
 * form-encoded To/From/Body — base64 is computed by the caller so this module
 * stays free of runtime globals that differ between Deno and vitest.
 */
export function buildTwilioRequest(
  config: TwilioConfig,
  body: string,
  base64: (value: string) => string,
): {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
} {
  const form = new URLSearchParams({
    To: config.toNumber,
    From: config.fromNumber,
    Body: body,
  });
  return {
    url: twilioEndpoint(config.accountSid),
    method: "POST",
    headers: {
      Authorization: `Basic ${base64(`${config.accountSid}:${config.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  };
}
