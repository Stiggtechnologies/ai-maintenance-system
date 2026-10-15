Microsoft365 integration preparation — not deployed or submission-ready

Scope: entire SyncAI SaaS platform plus16 requested agent experiences. Portfolio
mapping is a commercial-scope hypothesis, not a replacement for tenant ai_agents.
Further viable products can be added after capability/distinct-workflow review.
No price, bundle, seat allocation or commercial policy is approved here.

SDK: pinned Microsoft Agents SDK1.9.1. sdk-adapter.mjs implements a read-only
AgentApplication route and authenticated Express hosting entry point. No server
starts implicitly. Current reply is portfolio advisory, not industrial inference.
Actual Activity/TurnContext tests use fixture authorization and capture transport.
Canonical adapters reuse verifiedAzureTenantId and Auth/profile/ai_agents RLS
read contracts. exchangeUserToken and resolveApprovedEntitlement are mandatory:
Microsoft OAuth token is not a Supabase session. No service-role bypass exists.

Run npm ci --ignore-scripts, then npm test in this directory. Node22+ required.
Canonical TypeScript helper imports require Node native type stripping support
(Node22.18+ or24+). The app build does not bundle or deploy this adapter.

validate.mjs is evidence preflight; schema-validation.mjs uses Microsoft's public
1.25 draft04 schema, singleton agent and personal-bot identity check. Neither
claims submission approval. Supply real registered IDs and reviewed witnesses;
no manifest ZIP or placeholder app ID was generated.
Schema source https://developer.microsoft.com/json-schemas/teams/v1.25/MicrosoftTeams.schema.json
SDK source https://github.com/microsoft/Agents-for-js

Live gates: approved Entra/Bot registrations, supported credentials and OAuth
handler syncai; approved Microsoft-to-Supabase session exchange; canonical
subscription/tenant/plan/quantity/agent/user entitlement resolver; verified HTTPS
hosting/channel, real bot/app IDs, screenshots and clean install/remove. Actual
native streaming, feedback/citations, mutation confirmation, prompt injection,
source fidelity and nine-second response qualification remain unimplemented.
One SaaS with linked agents does not promise16 Marketplace search results.

measurement.mjs adds an optional fixed-schema callback only. No collector,
third-party transmission, queue or persistence is configured; no tenant/user
IDs, prompts, tokens or responses are included. It measures only pilot reads,
not verified industrial outcomes or acquisition conversion. No retirement policy.

Integration preserves canonical recommendations, approvals, governed evidence,
ai_agents and billing contracts. No persistence, grant, migration, provider call,
credential or plan-policy value is changed. Remove this directory to roll back
preparation; no stored data exists to migrate. FullPR634 release gates remain.
