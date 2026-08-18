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
          net.http_post → edge function lead-notify   {"lead_id": "<uuid>"}
            → Resend  → acknowledgement to the lead   (from orville@syncai.ca)
            → Resend  → alert to the owner            (every field + SLA + link)
            → Twilio  → SMS to the owner              (inert until configured)
            → UPDATE notification_status = notified | failed
```

**A trigger, not a cron.** The frontend never inserts directly — it calls a
SECURITY DEFINER RPC — so an `AFTER INSERT ... FOR EACH ROW` trigger is the only
hook that catches every writer. It is also instant rather than up to N minutes
late, and invisible to the E2E cron freeze in `ci.yml`.

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

| Secret                      | Required    | Default                             | Notes                                                            |
| --------------------------- | ----------- | ----------------------------------- | ---------------------------------------------------------------- |
| `RESEND_API_KEY`            | **yes**     | —                                   | Without it the function marks the lead `failed` and returns 200. |
| `OWNER_ALERT_EMAIL`         | no          | `orvilledavis95@gmail.com`          | Where the owner alert goes.                                      |
| `APP_BASE_URL`              | no          | `https://app.syncai.ca`             | Used to build the `/pilot-leads` deep link. HTTPS or ignored.    |
| `LEAD_ACK_FROM`             | no          | `Orville Davis <orville@syncai.ca>` | Rejected and replaced if not `@syncai.ca`.                       |
| `LEAD_ACK_REPLY_TO`         | no          | `orville@syncai.ca`                 | Reply-to on both messages.                                       |
| `OWNER_ALERT_FROM`          | no          | `SyncAI Leads <leads@syncai.ca>`    | Rejected and replaced if not `@syncai.ca`.                       |
| `LEAD_NOTIFY_SHARED_SECRET` | situational | —                                   | See "Which key" below.                                           |
| `TWILIO_ACCOUNT_SID`        | no (SMS)    | —                                   | All four or SMS is skipped silently.                             |
| `TWILIO_AUTH_TOKEN`         | no (SMS)    | —                                   |                                                                  |
| `TWILIO_FROM_NUMBER`        | no (SMS)    | —                                   | Must be E.164, e.g. `+15875550100`.                              |
| `OWNER_SMS_TO`              | no (SMS)    | —                                   | Must be E.164.                                                   |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform; if
either is absent the function answers **503** and does nothing.

**Sending domain is enforced in code.** `syncai.ca` holds the verified DKIM and
return-path records, and customer-facing mail leaves from there or not at all.
An override that is not exactly `@syncai.ca` — gmail, a subdomain, a lookalike
like `syncai.ca.attacker.example` — is discarded in favour of the default.

**Twilio is built but inert.** No Twilio account exists yet. Missing or
malformed settings produce a structured `sms_skipped` log and are **not** a
failure: if both emails landed, the lead is `notified`.

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

Until this runs, the trigger no-ops cleanly and leads simply stay `queued`.

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

| Condition                               | Behaviour                                                     |
| --------------------------------------- | ------------------------------------------------------------- |
| `private.lead_notify_config` empty      | Trigger returns; lead commits `queued`.                       |
| `pg_net` missing / URL bad / net down   | Trigger warns and returns; **lead still commits** (verified). |
| Business-hour helper raises             | BEFORE trigger falls back to `created_at + 1 hour`.           |
| Platform config missing on the function | 503, nothing written.                                         |
| Bad or absent bearer token              | 401.                                                          |
| Body has no valid `lead_id`             | 200 `{skipped:"invalid_request"}` — no retry storm.           |
| Lead already `notified`                 | 200 `{skipped:"already_notified"}`, nothing re-sent.          |
| `RESEND_API_KEY` absent                 | Lead marked `failed`, 200, structured error log.              |
| One email rejected by Resend            | Lead marked `failed` — it shows red and a person picks it up. |
| Twilio unconfigured                     | Silent skip; does **not** affect the status.                  |
| Twilio configured but failing           | Logged; does **not** affect the status.                       |
| Status write rejected                   | Logged; response carries `status_persisted: false`.           |
| Anything else throws                    | 200 `{skipped:"unhandled_error"}` — never a platform 500.     |

`notification_status` only ever becomes `notified` (both emails landed) or
`failed`. Those are exactly the values `PilotLeads.tsx` renders.

## Idempotency

`pg_net` can deliver more than once and a person can re-invoke the function by
hand. The first thing `lead-notify` does after loading the row is check
`notification_status`; if it is already `notified`, it returns without sending.
A visitor never gets two acknowledgements.

## Realtime

`pilot_intake_requests` is now in the `supabase_realtime` publication with
`replica identity full`, so `/pilot-leads` — which already called
`useRealtimeRefetch` on this table — actually refreshes live and its LIVE badge
means something. Realtime enforces RLS per subscriber and the only policy is
`pilot_intake_requests_admin_read`, so this streams to admin / ai_admin and
nobody else.

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
| `config/edge-function-boundary.json`                         | `lead-notify` added to the deploy allowlist  |
| `.github/workflows/deploy-migrations.yml`                    | Path trigger + explicit deploy line          |
