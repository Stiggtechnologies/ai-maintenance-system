# Public Reliability Engineer

The application root (`/`) is a public, synthetic-data Reliability Engineer
experience placed before signup. It provides one governed analysis, then routes
the user to a secure workspace for files, follow-ups, saved cases, exports and
tenant knowledge.

## What runs

- The browser always computes a deterministic RAM/RCA decision packet.
- `public-reliability-agent` adds a server-side expert synthesis through the
  OpenAI Responses API with structured output and `store: false`.
- The UI labels the result `Live expert review` only when that call succeeds.
  Otherwise it labels and displays the deterministic fallback.
- Public input is limited to a selected synthetic scenario and a 600-character
  question. Attachments and customer data are not accepted.
- The backend stores only an HMAC fingerprint and daily run count for abuse
  throttling; it does not store prompts, IP addresses or user-agent strings.

## Production configuration

Apply migration `00000000000021_public_reliability_demo.sql`, deploy the edge
function, and set these Supabase secrets:

```text
OPENAI_API_KEY=<server-side key>
PUBLIC_RELIABILITY_MODEL=gpt-5.6-terra
PUBLIC_DEMO_RATE_LIMIT_SECRET=<long random secret>
ALLOWED_ORIGINS=https://app.syncai.ca
```

The frontend uses its existing `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The edge function must retain JWT verification so the
Supabase gateway validates the project's anonymous token before the function's
own rate controls run.

## Local trial

Run `npm run dev`, open `http://localhost:5173/`, select a scenario, edit the
question if desired, and send it. Without the edge secrets the same route works
in deterministic-fallback mode.
