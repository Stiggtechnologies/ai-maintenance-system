# Data-loss prevention: controlled activation

SyncAI's DLP boundary governs supported server-mediated tenant AI-provider
egress. It does not claim to be a universal network DLP product, inspect inbound
connectors, or authorize plant action.

## Two-release activation

1. Deploy the governance control plane (`20270101860000_data_loss_prevention.sql`)
   and the Decision Governance panel.
2. For every hostname, data class and purpose the tenant intends to use, one
   administrator or executive proposes an immutable rule and a different named
   administrator or executive adopts it from an AAL2 session with a live
   verified factor.
3. Include every fallback hostname. Approval of `api.openai.com` does not
   approve a configured gateway or Azure OpenAI hostname.
4. Confirm the current-rule matrix before deploying the runtime enforcement
   release. Missing combinations will deny by default.
5. Deploy the runtime guard, then verify an allowed request and a deliberately
   unmatched request in production. The latter must be refused before a
   provider connection and both decisions must appear in the existing audit and
   security ledgers.

## Production rule matrix

The shipped runtime declares the most conservative class it can defend for
each path. A rule may permit or deny an exact combination; `redaction required`
denies until that caller explicitly proves redaction was applied.

| Runtime path | Data class | Purpose |
| --- | --- | --- |
| Sync investigation, general agents | `security_sensitive` | `model_inference` |
| Sync attachment extraction | `security_sensitive` | `document_extraction` |
| Sync realtime voice | `security_sensitive` | `realtime_voice` |
| Sync speech | `security_sensitive` | `speech_synthesis` |
| Gate, evidence, risk and change-impact agents | `safety_critical` | `model_inference` |
| Contract, methodology and requirements agents | `commercial` | `model_inference` |
| Asset onboarding | `operational` | `onboarding_enrichment` |
| Condition-loop enrichment | `operational` | `agent_enrichment` |

Public reference-case inference contains no tenant data and remains outside
this tenant-DLP claim. Marketplace lifecycle traffic and inbound CMMS,
historian and recovery connectors are also outside this AI-provider boundary.

## Invariants

- Exact HTTPS hostnames only; no scheme, path, wildcard, credential or custom
  port is accepted as a policy destination.
- Draft, rejected, legacy and superseded rules never authorize egress.
- The proposer cannot review the same version; adoption requires AAL2 and a
  live verified factor.
- Authorization-RPC failure is a denial, not a retry-to-open condition.
- Payload content is never copied into the authorization or audit receipt.
- Direct rule writes are refused; history is retained through supersession.
