# Technical Gap Checklist

This checklist tracks the gap from the current demoable product slice to a
sellable Microsoft pilot and then a public marketplace product.

## Current State

- [x] Reliability Copilot workspace shell.
- [x] Public demo route deployed at `https://repo-lime-nu.vercel.app/demo/copilot`.
- [x] Deterministic RAM calculation library.
- [x] CSV failure-history parsing.
- [x] Bad actor aggregation.
- [x] Mode-specific RCA/FRACAS/FMEA/RCM/RAM/PM/executive report generation.
- [x] Source-grounded report sections with source confidence from the seed
      reliability corpus map.
- [x] Structured governed recommendations with evidence used, assumptions,
      confidence, consequence of being wrong, validation, owner role, and
      approval requirement.
- [x] Data quality findings for missing/weak failure-history fields.
- [x] Expanded deterministic KPI tools for PM compliance, schedule compliance,
      break-in work, emergency work, planned work, cost of unreliability, and
      FMEA-style RPN.
- [x] One-command guided asset onboarding workflow with `/onboard asset`,
      `/onboard pump P-101`, `/onboard conveyor CV-204`, `/onboard fleet
    haul_trucks`, and source-import command variants.
- [x] Asset onboarding session model with identity, hierarchy, function,
      operating context, criticality, failure modes, existing maintenance,
      recommended strategy, condition monitoring, spares, reliability baseline,
      FRACAS readiness, risk safeguards, lifecycle, and final package steps.
- [x] Asset onboarding completion scoring, reliability readiness message,
      missing-fields list, assumptions, recommendations, and approval gates.
- [x] Asset onboarding export payloads for Markdown, Word-compatible HTML,
      PDF-ready HTML, Excel CSV, JSON, CMMS import CSV, Power BI dataset JSON,
      and API payload JSON.
- [x] Asset onboarding persistence migration with organization-scoped RLS and
      normalized tables for sessions, steps, profiles, failure modes,
      recommendations, exports, evidence, and approval workflows.
- [x] Browser-demo persistence fallback plus UI resume controls for saved
      onboarding sessions.
- [x] Markdown report export from the Copilot workspace.
- [x] PDF-to-RAG corpus builder for reliability standards and failure
      investigation reports.
- [x] Local retrieval validation for generated RAG chunks.
- [x] Reliability tool/action definitions.
- [x] Foundry prompt-agent instructions.
- [x] Teams manifest packaged for a static-tab pilot with live Vercel URLs,
      Entra client ID, app ID, icons, and `syncai-reliability-teams.zip`.
- [x] Teams pilot package refreshed so the first tab opens the live Reliability
      Copilot cowork demo and the second tab opens the pilot brief.
- [x] Microsoft Entra multitenant app registration created for pilot sign-in.
- [x] Supabase `marketplace-resolve` function deployed with Azure secrets and
      live Vercel CORS origin.
- [x] Production marketplace Edge Function smoke-tested with authenticated
      request path.
- [x] Live agent endpoint connected to Copilot workspace through
      `ai-agent-processor` with provider-aware OpenAI/Azure OpenAI/Anthropic
      routing and deterministic fallback.
- [x] Production marketplace metering compatibility table created.
- [x] Live agent invocation writes pending `agent_invocation` metering records
      when a marketplace subscription is mapped.
- [x] Adaptive card templates.
- [x] AppSource listing draft.
- [x] Paid pilot onboarding and SOW templates.
- [x] Comprehensive spec traceability matrix in
      `src/lib/reliability-spec-traceability.ts`.

## Spec Traceability P0 Gaps

- [x] Live OpenAI/Azure OpenAI/Foundry-capable agent endpoint connected to Copilot web
      workspace.
- [ ] Streaming reliability chat with persisted conversation history.
- [ ] Tenant-scoped document upload, parsing, chunking, indexing, retrieval,
      and citation rendering.
- [ ] Reliability corpus loaded into production vector search or hosted
      retrieval.
- [ ] FRACAS case CRUD with evidence, taxonomy, actions, owners, due dates,
      verification, recurrence checks, and lessons learned.
- [ ] Structured RCA workspace with event timeline, evidence table, cause map,
      hypotheses, corrective/preventive actions, and effectiveness review.
- [ ] Recommendation lifecycle: issued, approved, action/work order created,
      implemented, verified, recurrence checked, benefit captured.
- [ ] Copilot-specific audit trail for prompts, files, chunks, calculations,
      recommendations, approvals, edits, and exports.
- [ ] PDF and Word export.
- [x] Production Vercel environment variables for Supabase and
      marketplace/Entra integration.
- [x] Production model endpoint secret configured through available live provider
      fallback. Add Azure OpenAI/Foundry secrets before customer-tenant Azure
      deployment.
- [ ] Teams static-tab private pilot installed and tested in a Microsoft tenant.
- [ ] Azure Bot Service or Teams bot endpoint for message commands and compose
      extensions.
- [ ] Partner Center publisher verification and marketplace submission.

## Pilot-Ready Gaps

- [x] OpenAI/Azure OpenAI/Anthropic-capable agent endpoint wired to the Copilot workspace.
- [ ] Foundry prompt agent created in Azure tenant.
- [ ] Foundry agent tested against `foundry/evals.jsonl`.
- [ ] Foundry agent published to individual Teams/M365 pilot scope.
- [ ] File upload for work orders, asset registers, RCA reports, FMEA sheets,
      and standards.
- [ ] Document chunking and retrieval with citations.
- [x] Local RCA/FRACAS/FMEA/RAM/PM/executive draft generation from pasted or
      uploaded failure history.
- [ ] RAG-backed RCA draft generation with source citations.
- [ ] FRACAS case data model and CRUD.
- [ ] Report export to Markdown/PDF/Word.
- [ ] Tenant isolation verified.
- [ ] Audit log for recommendations, tool calls, uploads, and exports.
- [ ] Basic admin controls for prompt/version/configuration.

## Microsoft Private Teams App Gaps

- [x] Entra app registration created.
- [ ] Azure Bot Service or Foundry-generated bot endpoint configured.
- [x] Teams manifest GUIDs replaced.
- [x] Teams icons created.
- [x] Entra Application ID URI configured/verified for Teams SSO:
      `api://repo-lime-nu.vercel.app/09b1f6e1-99b3-46f7-bb23-48b2aa4a6399`.
- [x] Entra `access_as_user` scope created for Teams SSO.
- [x] Teams desktop and Teams web client applications pre-authorized for SSO.
- [ ] Private app sideload/install tested.
- [ ] Bot command routing implemented.
- [ ] Adaptive card submit handlers implemented.
- [ ] Teams file consent or SharePoint selection flow implemented.
- [ ] Single sign-on flow tested.

## AppSource / Store Gaps

- [ ] Partner Center identity verification submitted from
      `https://partner.microsoft.com/en-us/dashboard/account/v3/organization/identity?publisher=true`.
- [ ] Partner Center seller profile complete.
- [ ] Publisher verification complete.
- [ ] Legal business profile shows authorized / passed.
- [ ] Developer / Marketplace program verification shows authorized / passed.
- [ ] Privacy, terms, and support URLs live.
- [ ] AppSource screenshots created.
- [ ] Validation test account created.
- [ ] Admin setup guide completed.
- [ ] Data deletion process documented.
- [ ] Publisher attestation completed.
- [ ] Store validation issues resolved.

## Transactable SaaS Gaps

- [ ] SaaS offer created in Partner Center.
- [ ] Landing page integrated with marketplace subscription token resolution.
- [ ] Subscription activation implemented and tested.
- [ ] Subscription status checks implemented.
- [ ] Plan/seat entitlement enforcement implemented.
- [x] Marketplace metering storage path created for usage-based pricing.
- [ ] Marketplace metering submitted with a real Partner Center subscription ID.
- [ ] Teams app linked to SaaS offer.

## Azure Foundry / Managed Application Path

- [ ] Foundry project created for SyncAI Reliability Engineering Copilot.
- [ ] Foundry Agent Application published with Entra/RBAC invocation.
- [ ] Foundry publish-to-M365/Teams package downloaded and tested.
- [ ] Azure Bot Service provider registered and generated bot resource verified.
- [ ] Customer-tenant Azure Managed Application architecture created.
- [ ] Managed Application template includes app host, model endpoint, storage,
      vector search, Redis/session cache, Key Vault, monitoring, and private
      networking options.
- [ ] Marketplace offer decides hosted SaaS vs Managed Application vs both.

## Enterprise Trust Gaps

- [ ] Data flow diagram.
- [ ] Subprocessor list.
- [ ] Encryption statement.
- [ ] Incident response contact.
- [ ] Backup and retention statement.
- [ ] Tenant isolation proof.
- [ ] Evaluation results for hallucination resistance and citation accuracy.
- [ ] Human approval workflow for high-risk recommendations.
- [ ] Security review before Microsoft 365 certification.
