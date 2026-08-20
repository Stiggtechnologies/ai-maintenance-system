# Reliability Engineer

The application root (`/`) is the live SyncAI Reliability Engineer. Public and authenticated reliability reasoning now share one canonical expert methodology while retaining different evidence, tenancy, authorization, and spend boundaries.

This is a production product surface, not a simulated chatbot. Free access is a security- and cost-bounded tier of the Reliability Engineer. Approved reference cases are optional examples and are always identified as reference data; they are never presented as customer evidence.

## Canonical expert core

- `supabase/functions/_shared/reliability-engineer-core.ts` owns prompt version `syncai-reliability-engineer-v4`.
- The methodology covers RCA/FRACAS, FMEA/FMECA/RCM, RAM and life-data analysis, RBD/FTA/Markov methods, condition monitoring, lifecycle/value decisions, planning, MRO, commissioning, and governed technical recommendations.
- Facts, user assertions, assumptions, calculations, hypotheses, engineering judgment, recommendations, evidence gaps, severity, confidence, approval authority, and verification are kept distinct.
- FRACAS closure requires implementation and effectiveness verification; a recommendation is not equivalent to authorization.
- Safety, regulatory requirements, OEM/site limits, MOC, permits, isolations, interlocks, protective functions, approved procedures, and qualified human authority always prevail.

## Governed knowledge

Reliability Engineer reuses the existing `retrieveReliabilityContext()` boundary. It does not create a parallel vector store or retrieval service.

The retrieval boundary enforces organization scope for customer knowledge, document-class standing by claim type, public/private redistribution boundaries, and provenance-bearing citation labels. The expert core may cite only returned source/page labels and must identify unsupported conclusions instead of inventing citations, thresholds, limits, measurements, customer evidence, or precision.

## Public access

- Visitors can ask open-ended reliability questions or select approved synthetic/reference cases.
- `public-reliability-agent` keeps the existing browser/IP abuse controls and public-only knowledge filter.
- Public assessment output is structured and model-proposed citations are filtered against the exact governed retrieval result.
- No tenant files, production-system access, CMMS/historian/control write, or operational authorization is implied by free access.

## Authenticated and Sync-routed access

Authenticated Reliability Engineer requests continue through `ai-agent-processor`, preserving the current provider-resilience, gateway/failover, organization quota reservation/settlement, usage telemetry, audit, RLS, and approval rails. Sync specialist routing delegates to this same Reliability Engineer path rather than establishing another model rail.

Typed reliability tasks such as failure-mode classification and draft reliability assessments use the same methodology and tenant-scoped knowledge boundary and return prompt/model/knowledge provenance metadata with the governed result.

## Model configuration

The authenticated Reliability Engineer can be configured with:

```text
MODEL_RELIABILITY=<verified approved model artifact>
```

If unset, it inherits the current deliverable model. Public access remains separately controlled by `MODEL_PUBLIC_FRONTIER` / `PUBLIC_RELIABILITY_MODEL` as configured by the deployed path. The repository intentionally does not hard-code an unverified fine-tuned model identifier.

## Production gate

Do not claim a reliability-specific fine-tuned artifact is active until that configured model has been exercised in production. Release validation must cover the canonical prompt contract, tenant-scoped retrieval, public citation filtering, provider failover, quota enforcement, rate limiting, CORS, authenticated and public calls, Sync delegation, and the human approval boundary.
