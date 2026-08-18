# Lead speed-to-response — a lead must never go cold

A pilot-intake lead used to land in `pilot_intake_requests` with
`notification_status='queued'` and nothing else would happen. No mail to the
visitor, no alert to the owner, no clock. The only automation was a weekday
cron on the owner's laptop, so a Friday-evening lead sat untouched until
Monday and the person who sent it heard nothing at all.

This is the always-on server-side path that fires the instant a lead arrives.

```
visitor submits /pilot/reliability
  → RPC submit_pilot_intake_request(jsonb)          [SECURITY DEFINER, anon]
    → INSERT into pilot_intake_requests
      → BEFORE INSERT  trg_pilot_intake_first_response_due
          stamps first_response_due = created_at + 1 BUSINESS hour
      → AFTER INSERT   trg_pilot_intake_notify
          dispatch_lead_notification()
            → lead_notify_allow_dispatch()  abuse cap; suppress or proceed
            → net.http_post → lead-notify    {"lead_id": "<uuid>"}
                → claim_lead_notification()  atomic, one run at a time
                → Resend  → alert to the OWNER first  (every field + SLA + link)
                → Resend  → acknowledgement to the lead (from orville@syncai.ca)
                → Twilio  → SMS to the owner          (inert until configured)
                → record_lead_notification()  per-channel stamps → status

every 5 min: pg_cron syncai-lead-notify-retry
  → retry_stalled_lead_notifications()
      re-dispatches any lead missing a channel, with backoff, for 7 days
```

**A trigger, not a cron — plus a cron.** The frontend never inserts directly —
it calls a SECURITY DEFINER RPC — so an `AFTER INSERT ... FOR EACH ROW` trigger
is the only hook that catches every writer, and it is instant rather than up to
N minutes late. But `pg_net` does not retry: one transient Resend 429, one
`pg_net` timeout, or a `RESEND_API_KEY` that was not set until Monday and the
lead is never notified at all. `retry_stalled_lead_notifications()` on a
five-minute job is the safety net behind the fast path. It is not one of the
four jobs `ci.yml` freezes for E2E, and it no-ops entirely without config, so
it cannot perturb the golden path.

**The owner alert goes out before the acknowledgement.** The acknowledgement
tells the customer they have been heard and names a deadline; it must not be
able to make that promise before anyone on this side knows the lead exists. If
the owner alert does not land, the acknowledgement still goes — the customer is
owed an answer either way — but it drops the sentence claiming the owner was
alerted, and the sweeper keeps retrying the alert.

## The anonymous form is not an email cannon

`submit_pilot_intake_request` is `GRANT EXECUTE … TO anon` with no captcha,
honeypot or rate limit. Before this path existed an anonymous insert was inert.
Wiring mail to it means every insert sends two DKIM-signed messages from the
verified `syncai.ca` domain — one of them to an address the caller chose, with
text the caller wrote in the subject line.

`lead_notify_allow_dispatch()` bounds that: **3 dispatches per recipient per 24
hours** and **40 per hour globally**, counted in `private.lead_notify_dispatch_log`
against a SHA-256 digest of the address (never the address itself). Over the
cap, the mail is suppressed and a warning is logged — **the lead is not**. It
commits, keeps its SLA clock, and shows on `/pilot-leads` in amber. The retry
sweeper picks it up again once the burst subsides.

The digest also gives the retry its backoff (`attempts`, `last_dispatch_at`),
so "how hard have we tried" lives in one place `PostgREST` cannot see.

## The SLA clock

**First response is due one business hour after the lead arrives.** Business
hours are **Mon–Fri, 08:00–17:00, America/Edmonton** — the wall clock of the
person who has to answer, so it follows MST/MDT rather than a fixed offset.

The algorithm walks forward day by day, consuming each business day's open
window until the duration is used up:

- a weekend day, or an instant at/after 17:00, supplies nothing — advance a day
- an instant before 08:00 is pulled forward to 08:00
- otherwise consume `min(remaining, time until 17:00)` and carry any remainder
  into the next business day

| Lead arrives (Edmonton) | First response due    | Why                             |
| ----------------------- | --------------------- | ------------------------------- |
| Wed 12:00               | Wed 13:00             | inside the day                  |
| Wed 07:00               | Wed 09:00             | clock starts at open, not 08:00 |
| Wed 16:30               | Thu 08:30             | 30 min today, 30 min tomorrow   |
| Wed 17:00               | Thu 09:00             | 17:00 is closed                 |
| Fri 16:30               | **Mon 08:30**         | remainder skips the weekend     |
| Sat / Sun (any time)    | **Mon 09:00**         | weekend supplies no hours       |
| Fri 30 Oct 16:30 MDT    | Mon 2 Nov 08:30 _MST_ | wall clock survives the DST end |

It is implemented **twice, deliberately**:

- `public.business_hours_deadline(timestamptz, interval)` — authoritative. Its
  result is written to `pilot_intake_requests.first_response_due` by the BEFORE
  INSERT trigger, and backfilled onto every pre-existing row. A stored deadline
  is a promise made at a point in time; it must not silently move later, which
  is also why the column is written rather than `GENERATED ALWAYS` (the
  timezone conversion is `STABLE`, not `IMMUTABLE`).
- `businessHoursDeadline()` in `supabase/functions/_shared/lead-notify.ts` —
  the mirror the edge function uses to render the deadline, and as a fallback
  if the column is ever empty.

Both are held to the table above: the SQL against a live Postgres, the
TypeScript in `src/lib/lead-notify/lead-notify.test.ts`.

## Environment

Set on the edge function (`supabase secrets set …`, or the dashboard).

| Secret                      | Required    | Default                             | Notes                                                                                 |
| --------------------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`            | **yes**     | —                                   | Without it the function marks the lead `failed`, still attempts SMS, and returns 200. |
| `OWNER_ALERT_EMAIL`         | no          | `orvilledavis95@gmail.com`          | Where the owner alert goes.                                                           |
| `APP_BASE_URL`              | no          | `https://app.syncai.ca`             | Used to build the `/pilot-leads` deep link. HTTPS or ignored.                         |
| `LEAD_ACK_FROM`             | no          | `Orville Davis <orville@syncai.ca>` | Rejected and replaced if not `@syncai.ca`.                                            |
| `LEAD_ACK_REPLY_TO`         | no          | `orville@syncai.ca`                 | Reply-to on both messages. Rejected and replaced if not `@syncai.ca`.                 |
| `OWNER_ALERT_FROM`          | no          | `SyncAI Leads <leads@syncai.ca>`    | Rejected and replaced if not `@syncai.ca`.                                            |
| `LEAD_NOTIFY_SHARED_SECRET` | situational | —                                   | See "Which key" below.                                                                |
| `TWILIO_ACCOUNT_SID`        | no (SMS)    | —                                   | All four or SMS is skipped silently.                                                  |
| `TWILIO_AUTH_TOKEN`         | no (SMS)    | —                                   |                                                                                       |
| `TWILIO_FROM_NUMBER`        | no (SMS)    | —                                   | Must be E.164, e.g. `+15875550100`.                                                   |
| `OWNER_SMS_TO`              | no (SMS)    | —                                   | Must be E.164.                                                                        |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform; if
either is absent the function answers **503** and does nothing.

**Sending domain is enforced in code.** `syncai.ca` holds the verified DKIM and
return-path records, and customer-facing mail leaves from there or not at all.
An override that is not exactly `@syncai.ca` — gmail, a subdomain, a lookalike
like `syncai.ca.attacker.example` — is discarded in favour of the default.

**Twilio is built but inert.** No Twilio account exists yet. Missing or
malformed settings produce a structured `sms_skipped` log and are **not** a
failure: if both emails landed, the lead is `notified`. SMS is attempted even
when `RESEND_API_KEY` is absent — it is an independent channel, and a broken
Resend is exactly when the owner most needs the other one.

## Wiring the trigger to the function

The trigger reads the target URL and calling key from
`private.lead_notify_config`, which is in the `private` schema PostgREST does
not expose. It is created empty; nothing is committed to the repository.

```sql
-- run as service_role (SQL editor, or psql with the service connection)
select public.configure_lead_notify(
  'https://<project-ref>.supabase.co/functions/v1/lead-notify',
  '<the key that authenticates against this project''s edge functions>'
);
```

Until this runs, the trigger no-ops and leads stay `queued` — but **loudly**:
`dispatch_lead_notification` raises a warning naming the lead and the missing
config on every single insert, rather than returning silently.

`deploy-migrations.yml` will do both wiring steps for you if the repository
carries the secrets. They are no-ops with a `::warning::` in the Actions log
otherwise, and both are idempotent:

| Repository secret         | What the deploy does with it                                 |
| ------------------------- | ------------------------------------------------------------ |
| `RESEND_API_KEY`          | `supabase secrets set RESEND_API_KEY=…` on the project.      |
| `SUPABASE_DB_URL`         | psql connection used to call `configure_lead_notify()`.      |
| `LEAD_NOTIFY_SERVICE_KEY` | the bearer token pg_net will present. See "Which key" below. |

**Which key.** JWT verification stays **on** for `lead-notify` (it is not in
`allowedNoVerifyJwt`), so the bearer token pg_net sends must be one the
platform accepts. This project's edge functions authenticate with the
`sb_secret_…` key — the legacy `service_role` JWT is rejected. If that key is
not the same string the platform injects as `SUPABASE_SERVICE_ROLE_KEY`, also
set `LEAD_NOTIFY_SHARED_SECRET` to the value you passed to
`configure_lead_notify`, or the function's own bearer check will 401 requests
the platform already let through.

## Fail-soft, layer by layer

The lead is the asset. Nothing in this path may cost us one.

| Condition                               | Behaviour                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `private.lead_notify_config` empty      | **Warning naming the lead**; lead commits `queued`; sweeper retries.                          |
| `pg_net` missing / URL bad / net down   | Trigger warns and returns; **lead still commits** (verified).                                 |
| Over the abuse cap                      | Mail suppressed with a warning; lead commits `queued`; sweeper retries once the burst passes. |
| Business-hour helper raises             | BEFORE trigger falls back to `created_at + 1 hour`.                                           |
| Platform config missing on the function | 503, nothing written.                                                                         |
| Bad or absent bearer token              | 401, **and a structured `unauthorized` log** — see "Which key".                               |
| Body has no valid `lead_id`             | 200 `{skipped:"invalid_request"}` — no retry storm.                                           |
| Both channels already stamped           | 200 `{skipped:"already_notified"}`, nothing re-sent.                                          |
| Another run holds the claim             | 200 `{skipped:"already_in_flight"}`, nothing sent.                                            |
| `RESEND_API_KEY` absent                 | Error log, SMS still attempted, lead marked `failed`, sweeper retries.                        |
| One email rejected by Resend            | The channel that landed is stamped; the other is retried by the sweeper.                      |
| Twilio unconfigured                     | Silent skip; does **not** affect the status.                                                  |
| Twilio configured but failing           | Logged; does **not** affect the status.                                                       |
| Status write rejected                   | Logged; response carries `status_persisted: false`; sweeper retries.                          |
| Anything else throws                    | 200 `{skipped:"unhandled_error"}` — never a platform 500.                                     |

`notification_status` only ever becomes `notified` (both emails landed, counting
earlier attempts) or `failed`. Those are exactly the values `PilotLeads.tsx`
renders.

## Idempotency is per channel

`notification_status` is an **aggregate**: `failed` means "the two emails did
not both land", which is indistinguishable from "nothing was sent". Gating a
retry on it means the retry that fixes the owner alert also sends the visitor a
second acknowledgement — and this runbook invites a manual re-invoke.

So the row carries a write-once stamp **per channel**:

| Column              | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `ack_sent_at`       | the visitor acknowledgement left Resend. Never re-sent.   |
| `owner_alerted_at`  | the owner alert left Resend. Never re-sent.               |
| `notify_claimed_at` | a run is in flight; stale after 5 minutes, then reusable. |

`claim_lead_notification()` is a single `UPDATE … WHERE` — an atomic claim, not
a check-then-act — so two concurrent `pg_net` deliveries cannot both send.
`record_lead_notification()` sets each stamp only if it is not already set and
derives `notification_status` from the **cumulative** pair, so an
acknowledgement that went out on attempt one and an owner alert that went out on
attempt two add up to a `notified` lead.

A visitor never gets two acknowledgements. That is enforced by `ack_sent_at`,
not by the aggregate status.

**The one window the stamps cannot cover** is an email that leaves Resend
followed by a stamp write that fails — nothing can make those two atomic. The
stamp write is retried three times, and every Resend request carries a stable
`Idempotency-Key` of `lead-notify:<channel>:<lead id>`, so a repeat of the same
send within Resend's dedupe window is not delivered twice. (Resend's own
handling of that header could not be exercised here without a live API key; it
is a second line of defence behind `ack_sent_at`, not the primary one.)

**Leads that predate this migration are never mailed.** The migration stamps
both channels on every row older than an hour at apply time: acknowledging
somebody weeks after they wrote in is worse than staying quiet, and the sweeper
would otherwise treat every historic row as unsent.

## Closing the loop

`pilot_intake_requests` has exactly one RLS policy — `SELECT`, admin/ai_admin —
and no write policy at all, so nothing in the product could move a lead out of
`status='new'`. Keying the overdue flag on that made it permanent: every lead
red one business hour after arrival, forever, including ones answered in ten
minutes, until the whole table was red and the signal was noise.

`mark_pilot_lead_responded(uuid)` is the one write the admin surface has. It is
`SECURITY DEFINER`, granted to `authenticated` and never to `anon`, and it
repeats the same `admin`/`ai_admin` role test the read policy uses rather than
trusting the grant. It sets `first_responded_at` (and moves `status` to
`contacted`), which is what clears the flag and what stops the sweeper.

## Realtime

`pilot_intake_requests` is in the `supabase_realtime` publication, so
`/pilot-leads` — which already called `useRealtimeRefetch` on this table —
actually refreshes live and its LIVE badge means something.

**Replica identity stays `default`, deliberately.** Realtime applies RLS to
insert and update events but _not_ to deletes — Postgres cannot check access to
a row that no longer exists — so `replica identity full` would put every column
of a deleted lead (name, work email, company, notes) into a payload any
publishable-key subscriber receives. That is exactly the PII
`20260913090000_pilot_leads_admin_only.sql` was written to lock down. The
default identity puts only the primary key in a delete payload, and
`useRealtimeRefetch` discards the payload and calls `refetch()` anyway, so
nothing is lost.

## Testing it

Locally, without sending anything:

```bash
npx vitest run src/lib/lead-notify src/test/leadNotifyMigration.test.ts
npx tsc --noEmit -p tsconfig.app.json
node scripts/check-edge-function-boundary.mjs
node scripts/check-migration-order.mjs
```

The SQL itself against a throwaway Postgres (this is how the business-hour
table above was verified):

```bash
docker run -d --name sqlcheck -e POSTGRES_PASSWORD=postgres postgres:15-alpine
# create roles anon/authenticated/service_role + the leads table, then:
psql -f supabase/migrations/20260914090000_lead_notify_trigger.sql
select public.business_hours_deadline(
  timestamp '2026-09-18 16:30' at time zone 'America/Edmonton', interval '1 hour'
) at time zone 'America/Edmonton';   -- Mon 2026-09-21 08:30
```

End to end against a real project, once `RESEND_API_KEY` and
`configure_lead_notify` are in place — submit the public form, or:

```sql
select public.submit_pilot_intake_request('{
  "name":"Test Lead","email":"you@yourdomain.example","company":"Test Co",
  "asset_scope":"2 crushers","primary_pain":"Unplanned downtime"
}'::jsonb);
```

Then check `notification_status` moved to `notified`, `notified_at` is set,
`first_response_due` is one business hour out, and both messages arrived.
Function logs are one JSON object per event (`email_sent`, `sms_skipped`,
`completed`, …) and never contain a key.

## Files

| Path                                                         | What                                         |
| ------------------------------------------------------------ | -------------------------------------------- |
| `supabase/migrations/20260914090000_lead_notify_trigger.sql` | Clock, config table, RPC, triggers, realtime |
| `supabase/functions/_shared/lead-notify.ts`                  | All pure logic and copy — unit tested        |
| `supabase/functions/lead-notify/index.ts`                    | Deno shell: env, auth, orchestration         |
| `src/lib/lead-notify/lead-notify.test.ts`                    | Templates, SLA edge cases, Twilio predicate  |
| `src/test/leadNotifyMigration.test.ts`                       | The migration asserted as text               |
| `src/lib/leads/pilotLeadSla.ts`                              | Overdue predicate + Alberta timestamps       |
| `src/services/pilotIntake.ts`                                | Admin read (degrading) + the responded write |
| `config/edge-function-boundary.json`                         | `lead-notify` added to the deploy allowlist  |
| `.github/workflows/deploy-migrations.yml`                    | Path trigger + explicit deploy line          |
