# Reliability Engineer

The application root (`/`) is the live SyncAI Reliability Engineer. A visitor
can submit one bounded, open-ended reliability question before signup. The same
product surface then routes authenticated users into the secure workspace for
company files, tenant knowledge, calculations, saved cases, exports, team
review, and governed workflows.

This is a production product surface, not a simulated chatbot. Free access is a
security- and cost-bounded tier of the Reliability Engineer. The approved
reference cases are optional examples and are always identified as reference
data; they are not presented as customer evidence.

## What runs

- A visitor can ask an open-ended reliability question or select an approved
  reference case with deterministic RAM/RCA calculations.
- `public-reliability-agent` adds a server-side expert synthesis through the
  OpenAI Responses API with structured output and `store: false`.
- Public and authenticated requests share
  `supabase/functions/_shared/reliability-engineer-core.ts`, which contains the
  versioned Stigg Reliability Engineer methodology charter. The public route no
  longer carries a parallel abbreviated expert prompt.
- Both routes retrieve approved global reliability passages through the
  `match_reliability_kb` vector RPC. Returned citations are restricted to exact
  retrieved title/page labels; model-invented citations are removed.
- The UI labels a result `Live production analysis` only when the server-side
  expert call succeeds. Reference cases can still display verified deterministic
  calculations if the model service is unavailable; open questions fall back to
  evidence-gathering guidance and never fabricate quantitative results.
- Free input is limited to a 1,600-character question. Attachments and tenant
  data require authentication and an isolated workspace.
- The backend stores only an HMAC fingerprint and daily run count for abuse
  throttling; it does not store prompts, IP addresses or user-agent strings.
- The Reliability Engineer remains advisory: it does not write to a CMMS,
  historian, control system, protection system, or operating limit from free
  access.

## Production configuration

Apply migration `00000000000025_public_reliability_access.sql`, deploy the edge
function, and set these Supabase secrets:

```text
OPENAI_API_KEY=<server-side key>
RELIABILITY_MODEL=<approved model or fine-tuned model ID>
PUBLIC_RELIABILITY_MODEL=<optional compatible public override>
RELIABILITY_EMBEDDING_API_KEY=<server-side Gemini key>
PUBLIC_RELIABILITY_RATE_LIMIT_SECRET=<long random secret>
ALLOWED_ORIGINS=https://app.syncai.ca
```

`RELIABILITY_MODEL` is the canonical model selector for the authenticated and
public Reliability Engineer. If `PUBLIC_RELIABILITY_MODEL` is set, it overrides
the public route only. The repository intentionally does not invent or embed a
fine-tuned model ID; the production secret must be set to the verified model
artifact and validated against both the Chat Completions and Responses API
paths before release.

The frontend uses its existing `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The edge function must retain JWT verification so the
Supabase gateway validates the project's anonymous token before the function's
own rate controls run.

## Local verification

Run `npm run dev`, open `http://localhost:5173/`, ask an open question or select
a reference case, and submit it. Without the edge secrets, reference cases use
verified calculation mode and open questions return evidence-gathering guidance.

Do not claim production readiness until CI, the production migration, the edge
deployment, required secrets, live model response, rate enforcement, CORS,
vector RAG retrieval with page citations, parity evaluation, tenant isolation,
and the authenticated handoff have all been verified in the production
environment.
