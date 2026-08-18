/**
 * Tests the EXACT module the lead-notify edge function deploys —
 * supabase/functions/_shared/lead-notify.ts is Deno-free precisely so vitest
 * can hold it (vitest's include glob is `src/**` only, and Deno is installed
 * neither locally nor in CI, so anything living in index.ts ships unverified).
 *
 * Three things are load-bearing here and each gets its own section:
 *
 *   1. THE SLA CLOCK. One business hour, Mon-Fri 08:00-17:00 America/Edmonton.
 *      The same edge cases are proven against the SQL implementation
 *      (public.business_hours_deadline, migration 20260914090000) on a live
 *      Postgres; these assertions pin the TypeScript mirror to the identical
 *      answers, so the two cannot quietly disagree about when a promise is due.
 *
 *   2. NOTHING ABSENT REACHES A CUSTOMER. The intake RPC writes '' for omitted
 *      optional fields, so a naive template renders blanks — or worse, the
 *      string "undefined" — into a first impression. A sparse lead is rendered
 *      in full and the output is swept for every placeholder token.
 *
 *   3. SMS IS INERT UNTIL IT IS REAL. No Twilio account exists yet. A missing
 *      account must be a silent skip, never a failure that marks a lead whose
 *      emails went out as 'failed'.
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_LEADS_PATH,
  buildAdminLeadsUrl,
  buildLeadAcknowledgement,
  buildOwnerAlert,
  buildOwnerSms,
  buildResendPayload,
  buildResendRequest,
  buildTwilioRequest,
  businessHoursDeadline,
  DEFAULT_ACK_FROM,
  DEFAULT_OWNER_ALERT_FROM,
  escapeHtml,
  extractEmailAddress,
  FIRST_RESPONSE_SLA_MINUTES,
  formatBusinessInstant,
  formatBusinessInstantShort,
  greetingName,
  isAlreadyNotified,
  isSyncaiSender,
  isTwilioConfigured,
  missingTwilioSettings,
  NOT_PROVIDED,
  NOTIFICATION_STATUS,
  OWNER_ALERT_FIELDS,
  presentValue,
  RESEND_ENDPOINT,
  resolveFirstResponseDue,
  resolveNotificationStatus,
  resolveSender,
  SMS_MAX_LENGTH,
  twilioEndpoint,
  zoneAbbreviation,
  type PilotIntakeLead,
  type TemplateContext,
  type TwilioConfig,
} from "../../../supabase/functions/_shared/lead-notify";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Edmonton is UTC-6 in September (MDT), so 16:30 local is 22:30Z. */
const FRIDAY_1630_MDT = "2026-09-18T22:30:00.000Z";

function makeLead(overrides: Partial<PilotIntakeLead> = {}): PilotIntakeLead {
  return {
    id: "6f1a9a20-3b6d-4f0e-9c5a-1f2e3d4c5b6a",
    created_at: FRIDAY_1630_MDT,
    status: "new",
    name: "Dana Whitecalf",
    email: "dana@northpeakmining.example",
    company: "North Peak Mining",
    role: "Maintenance Manager",
    industry: "Mining",
    asset_scope: "18 haul trucks and 2 primary crushers",
    system_of_record: "SAP PM",
    history_available: "3 years of work orders",
    primary_pain: "Unplanned crusher downtime during night shift",
    data_readiness: "Sanitized export can be shared",
    security_need: "NDA not required for first proof",
    commercial_model: "48-hour value proof first",
    notes: "Board reviews reliability spend in October.",
    notification_status: "queued",
    notified_at: null,
    source_path: "/pilot/reliability",
    first_response_due: null,
    ...overrides,
  };
}

/** Exactly what the intake RPC writes when a visitor skips optional fields. */
function makeSparseLead(): PilotIntakeLead {
  return makeLead({
    role: "",
    industry: "",
    system_of_record: "",
    history_available: "",
    notes: "",
    // The three that can genuinely arrive as SQL NULL.
    first_response_due: null,
    notified_at: null,
  });
}

function contextFor(
  lead: PilotIntakeLead,
  appBaseUrl = "https://app.syncai.ca",
): TemplateContext {
  return { lead, dueAt: resolveFirstResponseDue(lead), appBaseUrl };
}

/** Every token that means "we had nothing to say here". */
const PLACEHOLDER_TOKENS = [
  "undefined",
  "null",
  "NaN",
  "Invalid Date",
  "[object Object]",
];

function expectNoPlaceholders(text: string): void {
  for (const token of PLACEHOLDER_TOKENS) {
    expect(text.toLowerCase()).not.toContain(token.toLowerCase());
  }
}

// ---------------------------------------------------------------------------
// 1. The SLA clock
// ---------------------------------------------------------------------------

/** Local wall clock in Edmonton for a UTC instant, as "Dy Mon D, YYYY at …". */
const due = (utcIso: string): string | null =>
  formatBusinessInstant(
    businessHoursDeadline(utcIso, FIRST_RESPONSE_SLA_MINUTES),
  );

describe("businessHoursDeadline — one business hour, Alberta", () => {
  it("adds an hour inside the working day", () => {
    // Wed 2026-09-16 12:00 MDT -> Wed 13:00.
    expect(due("2026-09-16T18:00:00Z")).toBe("Wed Sep 16, 2026 at 1:00 PM MDT");
  });

  it("starts the clock at 08:00 for anything that arrives before open", () => {
    // Wed 07:00 MDT -> Wed 09:00, not 08:00.
    expect(due("2026-09-16T13:00:00Z")).toBe("Wed Sep 16, 2026 at 9:00 AM MDT");
  });

  it("treats 08:00 exactly as inside the day and 17:00 exactly as closed", () => {
    expect(due("2026-09-16T14:00:00Z")).toBe("Wed Sep 16, 2026 at 9:00 AM MDT");
    // 17:00 MDT is close, so the clock starts the next morning.
    expect(due("2026-09-16T23:00:00Z")).toBe("Thu Sep 17, 2026 at 9:00 AM MDT");
  });

  it("carries the remainder into the next morning when the hour spills past close", () => {
    // Wed 16:30 -> 30 minutes today, 30 tomorrow.
    expect(due("2026-09-16T22:30:00Z")).toBe("Thu Sep 17, 2026 at 8:30 AM MDT");
  });

  it("rolls a Friday 16:30 lead to Monday morning, not Saturday", () => {
    expect(due(FRIDAY_1630_MDT)).toBe("Mon Sep 21, 2026 at 8:30 AM MDT");
  });

  it("rolls a weekend lead to Monday 09:00", () => {
    // Saturday 10:00 MDT and Sunday 23:00 MDT both land on the same deadline.
    expect(due("2026-09-19T16:00:00Z")).toBe("Mon Sep 21, 2026 at 9:00 AM MDT");
    expect(due("2026-09-21T05:00:00Z")).toBe("Mon Sep 21, 2026 at 9:00 AM MDT");
  });

  it("keeps the wall clock across a DST change rather than the UTC offset", () => {
    // Fri 2026-10-30 16:30 MDT (UTC-6) spills into Mon 2026-11-02, by which
    // point Edmonton is on MST (UTC-7). The promise is "8:30 in the morning",
    // so the wall clock is what must survive.
    const deadline = businessHoursDeadline(
      "2026-10-30T22:30:00Z",
      FIRST_RESPONSE_SLA_MINUTES,
    );
    expect(formatBusinessInstant(deadline)).toBe(
      "Mon Nov 2, 2026 at 8:30 AM MST",
    );
    expect(deadline?.toISOString()).toBe("2026-11-02T15:30:00.000Z");
  });

  it("returns null rather than an Invalid Date for unusable input", () => {
    expect(businessHoursDeadline("not a date", 60)).toBeNull();
    expect(businessHoursDeadline("", 60)).toBeNull();
    expect(businessHoursDeadline(null, 60)).toBeNull();
    expect(businessHoursDeadline(undefined, 60)).toBeNull();
  });

  it("clamps a zero or negative duration to the start of the working day", () => {
    // Saturday with no duration still cannot be due on a Saturday.
    expect(
      formatBusinessInstant(businessHoursDeadline("2026-09-19T16:00:00Z", 0)),
    ).toBe("Mon Sep 21, 2026 at 8:00 AM MDT");
    expect(
      formatBusinessInstant(businessHoursDeadline("2026-09-19T16:00:00Z", -90)),
    ).toBe("Mon Sep 21, 2026 at 8:00 AM MDT");
  });

  it("spans multiple days for a duration longer than one working day", () => {
    // Two full working days from Wed 09:00 lands Fri 09:00.
    expect(
      formatBusinessInstant(
        businessHoursDeadline("2026-09-16T15:00:00Z", 18 * 60),
      ),
    ).toBe("Fri Sep 18, 2026 at 9:00 AM MDT");
  });

  it("reports the zone abbreviation actually in force", () => {
    expect(
      zoneAbbreviation(new Date("2026-09-18T22:30:00Z"), "America/Edmonton"),
    ).toBe("MDT");
    expect(
      zoneAbbreviation(new Date("2026-12-18T22:30:00Z"), "America/Edmonton"),
    ).toBe("MST");
  });

  it("formats a short stamp for the subject line", () => {
    expect(formatBusinessInstantShort("2026-09-21T14:30:00Z")).toBe(
      "Mon 8:30 AM MDT",
    );
    expect(formatBusinessInstantShort(null)).toBeNull();
    expect(formatBusinessInstant("nonsense")).toBeNull();
  });
});

describe("resolveFirstResponseDue", () => {
  it("trusts the stored deadline — the promise made when the lead arrived", () => {
    const lead = makeLead({ first_response_due: "2026-09-21T14:30:00Z" });
    expect(resolveFirstResponseDue(lead)?.toISOString()).toBe(
      "2026-09-21T14:30:00.000Z",
    );
  });

  it("recomputes when the column is empty", () => {
    const lead = makeLead({ first_response_due: null });
    expect(formatBusinessInstant(resolveFirstResponseDue(lead))).toBe(
      "Mon Sep 21, 2026 at 8:30 AM MDT",
    );
  });

  it("gives up cleanly when neither source is usable", () => {
    const lead = makeLead({ first_response_due: "", created_at: "garbage" });
    expect(resolveFirstResponseDue(lead)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Idempotency
// ---------------------------------------------------------------------------

describe("isAlreadyNotified — pg_net can deliver twice", () => {
  it("stops a second acknowledgement once a lead is notified", () => {
    expect(isAlreadyNotified({ notification_status: "notified" })).toBe(true);
    expect(isAlreadyNotified({ notification_status: "  Notified " })).toBe(
      true,
    );
  });

  it("lets queued and failed leads through — those still need sending", () => {
    expect(isAlreadyNotified({ notification_status: "queued" })).toBe(false);
    expect(isAlreadyNotified({ notification_status: "failed" })).toBe(false);
    expect(isAlreadyNotified({ notification_status: "" })).toBe(false);
  });
});

describe("resolveNotificationStatus", () => {
  it("marks notified only when both emails landed", () => {
    expect(
      resolveNotificationStatus({
        acknowledgementSent: true,
        ownerEmailSent: true,
        smsSent: null,
      }),
    ).toBe(NOTIFICATION_STATUS.notified);
  });

  it("ignores SMS entirely — a skipped or failed shout is not a failed notification", () => {
    for (const smsSent of [null, false, true]) {
      expect(
        resolveNotificationStatus({
          acknowledgementSent: true,
          ownerEmailSent: true,
          smsSent,
        }),
      ).toBe(NOTIFICATION_STATUS.notified);
    }
  });

  it("marks failed when either email did not land", () => {
    expect(
      resolveNotificationStatus({
        acknowledgementSent: false,
        ownerEmailSent: true,
        smsSent: true,
      }),
    ).toBe(NOTIFICATION_STATUS.failed);
    expect(
      resolveNotificationStatus({
        acknowledgementSent: true,
        ownerEmailSent: false,
        smsSent: true,
      }),
    ).toBe(NOTIFICATION_STATUS.failed);
  });

  it("only ever returns a status PilotLeads.tsx knows how to render", () => {
    const rendered = ["queued", "notified", "failed"];
    for (const acknowledgementSent of [true, false]) {
      for (const ownerEmailSent of [true, false]) {
        expect(rendered).toContain(
          resolveNotificationStatus({
            acknowledgementSent,
            ownerEmailSent,
            smsSent: null,
          }),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Text hygiene
// ---------------------------------------------------------------------------

describe("presentValue — absence is absence, however it is spelled", () => {
  it("treats blank, null, undefined and their stringified forms as absent", () => {
    for (const value of [
      null,
      undefined,
      "",
      "   ",
      "null",
      "undefined",
      "NaN",
      "  NULL  ",
    ]) {
      expect(presentValue(value)).toBeNull();
    }
  });

  it("keeps real content, trimmed", () => {
    expect(presentValue("  SAP PM  ")).toBe("SAP PM");
    expect(presentValue(0)).toBe("0");
  });

  it("refuses shapes that would stringify into garbage", () => {
    expect(presentValue({ a: 1 })).toBeNull();
    expect(presentValue(Number.NaN)).toBeNull();
  });
});

describe("greetingName", () => {
  it("uses the first given name", () => {
    expect(greetingName("Dana Whitecalf")).toBe("Dana");
  });

  it("returns null when there is nothing to greet", () => {
    expect(greetingName("")).toBeNull();
    expect(greetingName(null)).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("neutralizes markup a visitor typed into the form", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The acknowledgement the lead receives
// ---------------------------------------------------------------------------

describe("buildLeadAcknowledgement", () => {
  const ack = buildLeadAcknowledgement(contextFor(makeLead()));

  it("names the company in the subject", () => {
    expect(ack.subject).toBe(
      "We have your SyncAI pilot request — North Peak Mining",
    );
  });

  it("greets the lead by their given name", () => {
    expect(ack.text).toContain("Hi Dana,");
  });

  it("reflects back what they actually submitted", () => {
    expect(ack.text).toContain("18 haul trucks and 2 primary crushers");
    expect(ack.text).toContain("Unplanned crusher downtime during night shift");
    expect(ack.text).toContain("North Peak Mining");
  });

  it("states the concrete commitment and the deadline it resolves to", () => {
    expect(ack.text).toContain("within one business hour");
    expect(ack.text).toContain("Mon Sep 21, 2026 at 8:30 AM MDT");
  });

  it("quotes no price, no term, and no capability claim", () => {
    const forbidden = [
      "$",
      "price",
      "pricing",
      "cost",
      "quote",
      "contract",
      "invoice",
      "discount",
      "guarantee",
      "roi",
      "%",
    ];
    const body = `${ack.subject} ${ack.text}`.toLowerCase();
    for (const term of forbidden) expect(body).not.toContain(term);
  });

  it("does not leak the commercial model or any internal field into customer copy", () => {
    // commercial_model defaults to a phrase the owner has not agreed with THIS
    // lead — it belongs in the owner alert, never in the reply to the lead.
    expect(ack.text).not.toContain("48-hour value proof");
    expect(ack.text).not.toContain("Board reviews reliability spend");
    expect(ack.text).not.toContain(makeLead().id);
  });

  it("renders a sparse lead with no placeholder text anywhere", () => {
    const sparse = buildLeadAcknowledgement(contextFor(makeSparseLead()));
    expectNoPlaceholders(sparse.subject);
    expectNoPlaceholders(sparse.text);
    expectNoPlaceholders(sparse.html);
  });

  it("still commits to one business hour when the deadline cannot be computed", () => {
    const lead = makeLead({ created_at: "garbage", first_response_due: null });
    const content = buildLeadAcknowledgement({
      lead,
      dueAt: resolveFirstResponseDue(lead),
      appBaseUrl: "https://app.syncai.ca",
    });
    expect(content.text).toContain("within one business hour");
    expectNoPlaceholders(content.text);
    expectNoPlaceholders(content.html);
  });

  it("falls back to a company-free subject and a generic greeting", () => {
    const lead = makeLead({ company: "", name: "" });
    const content = buildLeadAcknowledgement(contextFor(lead));
    expect(content.subject).toBe("We have your SyncAI pilot request");
    expect(content.text).toContain("Hi there,");
    expectNoPlaceholders(content.text);
  });

  it("escapes markup a visitor typed into a form field", () => {
    const lead = makeLead({ company: '<img src=x onerror="steal()">' });
    const content = buildLeadAcknowledgement(contextFor(lead));
    expect(content.html).not.toContain("<img");
    expect(content.html).toContain("&lt;img");
  });
});

// ---------------------------------------------------------------------------
// 5. The owner alert
// ---------------------------------------------------------------------------

describe("buildOwnerAlert", () => {
  const alert = buildOwnerAlert(contextFor(makeLead()));

  it("puts the company, the contact and the deadline in the subject", () => {
    expect(alert.subject).toBe(
      "New pilot lead — North Peak Mining (Dana Whitecalf) — reply by Mon 8:30 AM MDT",
    );
  });

  it("carries every intake field", () => {
    for (const { label } of OWNER_ALERT_FIELDS) {
      expect(alert.text).toContain(`${label}:`);
    }
    expect(alert.text).toContain("dana@northpeakmining.example");
    expect(alert.text).toContain("SAP PM");
    expect(alert.text).toContain("48-hour value proof first");
    expect(alert.text).toContain("Board reviews reliability spend in October.");
    expect(alert.text).toContain(makeLead().id);
  });

  it("states the SLA due time in full", () => {
    expect(alert.text).toContain("Mon Sep 21, 2026 at 8:30 AM MDT");
    expect(alert.text).toContain("one business hour");
  });

  it("links straight to the admin leads route registered in App.tsx", () => {
    expect(alert.text).toContain("https://app.syncai.ca/pilot-leads");
    expect(alert.html).toContain('href="https://app.syncai.ca/pilot-leads"');
  });

  it("writes 'not provided' for omitted fields rather than a blank or a placeholder", () => {
    const sparse = buildOwnerAlert(contextFor(makeSparseLead()));
    expect(sparse.text).toContain(`Role: ${NOT_PROVIDED}`);
    expect(sparse.text).toContain(`Industry: ${NOT_PROVIDED}`);
    expect(sparse.text).toContain(`Notes: ${NOT_PROVIDED}`);
    expectNoPlaceholders(sparse.subject);
    expectNoPlaceholders(sparse.text);
    expectNoPlaceholders(sparse.html);
  });

  it("reminds the owner to answer from the verified domain", () => {
    expect(alert.text).toContain("@syncai.ca");
    expect(alert.text.toLowerCase()).toContain("never from gmail");
  });

  it("escapes lead-supplied markup in the field table", () => {
    const lead = makeLead({ notes: "<b>urgent</b><script>x()</script>" });
    const content = buildOwnerAlert(contextFor(lead));
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------
// 6. Senders, links, Resend payloads
// ---------------------------------------------------------------------------

describe("sender domain guard", () => {
  it("accepts the verified domain in both bare and display forms", () => {
    expect(isSyncaiSender("orville@syncai.ca")).toBe(true);
    expect(isSyncaiSender("Orville Davis <orville@syncai.ca>")).toBe(true);
    expect(isSyncaiSender(DEFAULT_ACK_FROM)).toBe(true);
    expect(isSyncaiSender(DEFAULT_OWNER_ALERT_FROM)).toBe(true);
  });

  it("rejects gmail, lookalike domains and subdomains", () => {
    expect(isSyncaiSender("orvilledavis95@gmail.com")).toBe(false);
    expect(isSyncaiSender("orville@syncai.ca.attacker.example")).toBe(false);
    expect(isSyncaiSender("orville@mail.syncai.ca")).toBe(false);
    expect(isSyncaiSender("orville@notsyncai.ca")).toBe(false);
    expect(isSyncaiSender("")).toBe(false);
  });

  it("discards an env override that is not on the verified domain", () => {
    expect(resolveSender("Ops <ops@syncai.ca>", DEFAULT_ACK_FROM)).toBe(
      "Ops <ops@syncai.ca>",
    );
    expect(resolveSender("orvilledavis95@gmail.com", DEFAULT_ACK_FROM)).toBe(
      DEFAULT_ACK_FROM,
    );
    expect(resolveSender("", DEFAULT_ACK_FROM)).toBe(DEFAULT_ACK_FROM);
    expect(resolveSender(undefined, DEFAULT_ACK_FROM)).toBe(DEFAULT_ACK_FROM);
  });

  it("extracts the bare address from a display form", () => {
    expect(extractEmailAddress("Orville Davis <Orville@SyncAI.ca>")).toBe(
      "orville@syncai.ca",
    );
    expect(extractEmailAddress("not an address")).toBeNull();
  });
});

describe("buildAdminLeadsUrl", () => {
  it("builds the route the admin page is registered at", () => {
    expect(buildAdminLeadsUrl("https://app.syncai.ca")).toBe(
      `https://app.syncai.ca${ADMIN_LEADS_PATH}`,
    );
    expect(buildAdminLeadsUrl("https://app.syncai.ca/")).toBe(
      "https://app.syncai.ca/pilot-leads",
    );
  });

  it("refuses a plaintext or unparseable base and falls back to production", () => {
    expect(buildAdminLeadsUrl("http://app.syncai.ca")).toBe(
      "https://app.syncai.ca/pilot-leads",
    );
    expect(buildAdminLeadsUrl("nonsense")).toBe(
      "https://app.syncai.ca/pilot-leads",
    );
    expect(buildAdminLeadsUrl(null)).toBe("https://app.syncai.ca/pilot-leads");
  });
});

describe("buildResendPayload", () => {
  const content = { subject: "s", html: "<p>h</p>", text: "t" };

  it("shapes exactly the body Resend expects", () => {
    const payload = buildResendPayload({
      from: DEFAULT_ACK_FROM,
      to: "Dana <dana@example.com>",
      content,
      replyTo: "orville@syncai.ca",
    });
    expect(payload).toEqual({
      from: DEFAULT_ACK_FROM,
      to: ["dana@example.com"],
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      reply_to: "orville@syncai.ca",
    });
  });

  it("omits reply_to and cc rather than sending them empty", () => {
    const payload = buildResendPayload({
      from: DEFAULT_ACK_FROM,
      to: "dana@example.com",
      content,
      replyTo: "",
      cc: [],
    });
    expect(payload).not.toHaveProperty("reply_to");
    expect(payload).not.toHaveProperty("cc");
  });

  it("drops unusable recipients and de-duplicates the rest", () => {
    const payload = buildResendPayload({
      from: DEFAULT_ACK_FROM,
      to: ["dana@example.com", "Dana <DANA@example.com>", "not-an-address", ""],
      content,
    });
    expect(payload.to).toEqual(["dana@example.com"]);
  });

  it("targets the Resend endpoint with a bearer key and JSON body", () => {
    const request = buildResendRequest("re-test-key", {
      from: DEFAULT_ACK_FROM,
      to: ["dana@example.com"],
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
    expect(request.url).toBe(RESEND_ENDPOINT);
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer re-test-key");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(request.body).to).toEqual(["dana@example.com"]);
  });
});

// ---------------------------------------------------------------------------
// 7. Twilio — built, and inert
// ---------------------------------------------------------------------------

const TWILIO_OK: TwilioConfig = {
  accountSid: "AC00000000000000000000000000000000",
  authToken: "test-token",
  fromNumber: "+15875550100",
  toNumber: "+15875550111",
};

describe("isTwilioConfigured — no account yet, so this must stay false", () => {
  it("is false when nothing is set", () => {
    expect(isTwilioConfigured(undefined)).toBe(false);
    expect(isTwilioConfigured(null)).toBe(false);
    expect(
      isTwilioConfigured({
        accountSid: "",
        authToken: "",
        fromNumber: "",
        toNumber: "",
      }),
    ).toBe(false);
  });

  it("is false when any single setting is missing", () => {
    for (const key of Object.keys(TWILIO_OK) as Array<keyof TwilioConfig>) {
      expect(isTwilioConfigured({ ...TWILIO_OK, [key]: "" })).toBe(false);
    }
  });

  it("is false when a number is not E.164", () => {
    expect(
      isTwilioConfigured({ ...TWILIO_OK, fromNumber: "587-555-0100" }),
    ).toBe(false);
    expect(isTwilioConfigured({ ...TWILIO_OK, toNumber: "5875550111" })).toBe(
      false,
    );
  });

  it("is true only when all four are present and well-formed", () => {
    expect(isTwilioConfigured(TWILIO_OK)).toBe(true);
  });

  it("names what is missing without ever naming a value", () => {
    const missing = missingTwilioSettings({});
    expect(missing).toEqual([
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
      "OWNER_SMS_TO",
    ]);
    expect(missingTwilioSettings(TWILIO_OK)).toEqual([]);
    expect(
      missingTwilioSettings({ ...TWILIO_OK, toNumber: "5875550111" }),
    ).toEqual(["OWNER_SMS_TO (not E.164)"]);
    expect(
      missingTwilioSettings({ ...TWILIO_OK, authToken: "" }),
    ).not.toContain(TWILIO_OK.authToken);
  });
});

describe("the SMS itself", () => {
  it("says who, what and by when, and links the lead", () => {
    const sms = buildOwnerSms(contextFor(makeLead()));
    expect(sms).toContain("North Peak Mining");
    expect(sms).toContain("Dana Whitecalf");
    expect(sms).toContain("Reply by Mon 8:30 AM MDT");
    expect(sms).toContain("https://app.syncai.ca/pilot-leads");
    expectNoPlaceholders(sms);
  });

  it("stays inside the length cap even for a wordy lead", () => {
    const lead = makeLead({
      company: "C".repeat(200),
      primary_pain: "P".repeat(400),
    });
    const sms = buildOwnerSms(contextFor(lead));
    expect(sms.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });

  it("falls back to the plain commitment with no computable deadline", () => {
    const lead = makeLead({ created_at: "garbage", first_response_due: null });
    const sms = buildOwnerSms({ lead, dueAt: null, appBaseUrl: null });
    expect(sms).toContain("Reply within 1 business hour");
    expectNoPlaceholders(sms);
  });

  it("shapes a Twilio request with basic auth and a form body", () => {
    const base64 = (value: string) =>
      Buffer.from(value, "utf8").toString("base64");
    const request = buildTwilioRequest(TWILIO_OK, "hello", base64);
    expect(request.url).toBe(twilioEndpoint(TWILIO_OK.accountSid));
    expect(request.url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_OK.accountSid}/Messages.json`,
    );
    expect(request.headers.Authorization).toBe(
      `Basic ${base64(`${TWILIO_OK.accountSid}:${TWILIO_OK.authToken}`)}`,
    );
    expect(request.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(request.body);
    expect(form.get("To")).toBe(TWILIO_OK.toNumber);
    expect(form.get("From")).toBe(TWILIO_OK.fromNumber);
    expect(form.get("Body")).toBe("hello");
  });
});
