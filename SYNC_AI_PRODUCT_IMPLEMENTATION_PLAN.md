# SyncAI Customer Infrastructure — Product Implementation Plan (Execution Roadmap)

**Purpose:** deliver a sellable, repeatable “customer infrastructure” package for SyncAI in three fixed-price phases.

- **P0 ($45K / 2 weeks):** Onboarding + Demo Environment + Basic Support
- **P1 ($35K / 2 weeks):** Tutorials + Advanced Help + Training Videos
- **P2 ($40K / 4 weeks):** Security + API Docs + Analytics + Mobile

**Source references:**
- `CUSTOMER_INFRASTRUCTURE_ROADMAP.md`
- `ONBOARDING_DESIGN.md`
- `DEMO_ENVIRONMENT_PLAN.md`

---

## 0) Guiding principles (so this ships on time)

1. **Sellable scope = repeatable scope.** Each phase has explicit “Done” criteria and strict change control.
2. **Customer-facing first.** Prioritize the flows prospects touch: signup → onboarding → demo → support.
3. **Instrument everything.** If we can’t measure onboarding + demo conversion, we can’t iterate sales.
4. **Security baseline by default.** No customer-facing launch without sane auth/RLS/audit/backup posture.

---

## 1) Implementation roadmap (tasks, dependencies, timeline)

### Phase P0 (2 weeks) — Onboarding + Demo Environment + Basic Support ($45K)

**Outcome:** a new user can sign up, reach “first value” within ~10 minutes, explore a realistic demo tenant, and get support.

#### P0-1 Onboarding MVP (from `ONBOARDING_DESIGN.md`)
**Scope:**
- Signup + email verification (Supabase Auth)
- Welcome wizard (3-step)
- Asset quick-add (manual + CSV template + “Try demo data”)
- Onboarding checklist widget (persistent)

**Tasks**
- FE: implement multi-step onboarding UI + validation; empty/edge states; basic a11y
- BE: `user_onboarding` + checklist persistence tables; API endpoints; RLS policies
- Data: sample/demo data generator hook (for “Try demo data”)
- QA: happy-path + basic negative-path testing; cross-browser sanity

**Dependencies**
- Supabase Auth configuration + domain email sending (SendGrid in P0-3)
- Asset creation APIs + tenant_id available in core tables

**Done criteria (quality gates)**
- ✅ 95%+ pass rate in Playwright smoke suite for: signup → verify → add asset → activate AI → dashboard
- ✅ Median “time-to-first-asset” < 10 minutes in internal test cohort (n≥10)
- ✅ No P0 flow requires manual admin intervention

#### P0-2 Demo Environment v1 (from `DEMO_ENVIRONMENT_PLAN.md`)
**Scope:**
- Dedicated demo tenant with seeded data (47 assets, 15 work orders, AI activity samples)
- Strict tenant isolation via RLS
- Automated daily reset (Edge Function + cron)
- Demo mode banner + CTA

**Tasks**
- BE: implement demo tenant + RLS isolation tests; demo reset function; reset logging
- FE: demo banner, “Try Demo” entry path, read-only protections where needed
- QA: isolation testing (demo user cannot access prod tenant rows)

**Dependencies**
- Multi-tenant schema (`tenant_id`) present in all customer data tables
- Supabase Edge Functions enabled

**Done criteria (quality gates)**
- ✅ RLS isolation test suite (automated) passes: “demo role cannot read non-demo tenant data”
- ✅ Demo reset completes < 5 minutes and is idempotent
- ✅ Demo credentials + self-serve link ready for sales

#### P0-3 Basic Support (email + lightweight process)
**Scope:**
- `support@syncai.com` configured
- Minimum SOP + templates
- Support routing and triage guidelines (pre-Intercom)

**Tasks**
- Ops/CS: set up mailbox + signatures + response templates
- Product: in-app support link + footer/help entry points

**Dependencies**
- SendGrid domain verification (or equivalent)

**Done criteria**
- ✅ Support email tested end-to-end (deliverability + reply)
- ✅ Internal escalation + severity rubric documented

**P0 schedule (10 business days)**
- **Days 1–2:** project kickoff, repo readiness, auth + tenant_id verification, instrumenting plan
- **Days 3–7:** onboarding MVP build + demo tenant seed + RLS implementation
- **Days 8–9:** demo reset automation + banner/entry + support mailbox/SOP
- **Day 10:** hardening + QA + go/no-go

---

### Phase P1 (2 weeks) — Tutorials + Advanced Help + Training Videos ($35K)

**Outcome:** customers self-serve; sales and CS have polished enablement; support load decreases.

#### P1-1 Help Center “Advanced” (structure + in-app linking)
**Scope:**
- Help center structure (categories, search, nav)
- In-app contextual links (tooltip/help buttons point to relevant articles)
- Article screenshot set (minimum viable)

**Tasks**
- Content/Writer: finalize IA, add screenshots, publish
- FE: add contextual deep-links + “Help” entry points

**Dependencies**
- Chosen help center host (Intercom Articles vs standalone)

**Done criteria**
- ✅ Top 10 help articles have screenshots + “last updated” + owner
- ✅ In-app help links present in onboarding + assets + work orders

#### P1-2 Tutorials (in-product guided tour) + “How-to” flows
**Scope:**
- Interactive tour overlay (e.g., Joyride)
- Checklist + tour progress stored

**Tasks**
- FE: implement tour + step definitions; restart/skip; persistent state
- QA: tour doesn’t block primary flows

**Dependencies**
- Stable UI selectors and pages for tour anchoring

**Done criteria**
- ✅ Tour completion tracked; skip doesn’t break onboarding

#### P1-3 Training videos (3 core) + hosting + embed
**Scope:**
- 3 videos: Getting Started, Asset Management, Work Order Workflow
- Captions + thumbnails
- Hosted in Wistia and embedded in app/help center

**Tasks**
- Product/CS: scripts + storyboard
- Video: capture + edit + captions
- FE: embed player, “Watch next” placements

**Dependencies**
- Wistia account + branding

**Done criteria**
- ✅ Videos embedded and load fast; captions available
- ✅ Sales has shareable links + a short demo playlist

**P1 schedule (10 business days)**
- **Days 1–3:** finalize vendor setup (Intercom/Wistia), help center IA + link plan
- **Days 4–7:** tour implementation + article screenshots + video recording
- **Days 8–9:** edits + captions + embed + QA
- **Day 10:** release + measurement setup

---

### Phase P2 (4 weeks) — Security + API Docs + Analytics + Mobile ($40K)

**Outcome:** enterprise-ready baseline (not full SOC2), external API docs, measurable funnel, and credible mobile experience.

#### P2-1 Security baseline hardening
**Scope (practical, shippable in 4 weeks)**
- RLS audit: verify all customer tables enforce tenant isolation
- RBAC roles defined and enforced (admin/manager/tech/viewer) where applicable
- Audit logging for key actions (login, asset create/update, work order create/update, role changes)
- Secrets management + environment separation checks
- Backup/restore runbook (operational)

**Tasks**
- BE: policy review + tests; audit log table/events; role enforcement
- DevOps: secret rotation plan; deploy checklist; backup procedure

**Dependencies**
- Clear data model ownership; list of “sensitive tables”

**Done criteria (quality gates)**
- ✅ Automated RLS regression tests in CI
- ✅ Audit log produced for defined events and viewable by admin
- ✅ “Launch security checklist” signed by Eng lead

#### P2-2 API documentation (external)
**Scope**
- OpenAPI spec for external endpoints (assets, work orders, auth tokens as applicable)
- Human-readable docs (examples, error codes, pagination)
- Postman collection (optional but recommended)

**Tasks**
- BE: OpenAPI generation/hand-authored spec; examples
- Writer: structure + quickstarts

**Dependencies**
- Stable API surface and versioning strategy

**Done criteria**
- ✅ Docs hosted (public or gated) and referenced from app
- ✅ “Hello world” integration can be completed in < 30 minutes

#### P2-3 Analytics + funnels + reporting
**Scope**
- Event tracking: onboarding funnel, demo funnel, support entry points
- Simple dashboards: activation rate, time-to-value, demo-to-trial conversion

**Tasks**
- FE/BE: implement event emitters + user/tenant properties
- Product: define KPI targets and weekly review cadence

**Dependencies**
- Analytics vendor selection (PostHog recommended)

**Done criteria**
- ✅ Events validated and visible in dashboards
- ✅ Weekly KPI report template ready for sales/product

#### P2-4 Mobile (credible v1)
**Scope options (pick one to avoid scope creep):**
- **Option A (recommended in 4 weeks):** Mobile-responsive web + PWA shell (offline-safe navigation shell)
- **Option B:** React Native “companion” app skeleton (auth + read-only dashboards)

**Tasks**
- FE: responsive fixes for onboarding + assets + work orders; touch targets; performance
- QA: device matrix smoke tests (iOS Safari/Chrome Android)

**Dependencies**
- UI library breakpoints and design tokens

**Done criteria**
- ✅ Onboarding + core browsing usable on mobile
- ✅ Lighthouse mobile performance baseline captured

**P2 schedule (20 business days)**
- **Week 1:** security/RLS audit + analytics instrumentation plan + mobile audit
- **Week 2:** audit logs + RBAC enforcement + analytics events shipped
- **Week 3:** API docs (OpenAPI + content) + dashboards + mobile implementation
- **Week 4:** regression testing + hardening + release + runbooks

---

## 2) Resource allocation & budget breakdown (engineers, designers, budget)

> Rates below are placeholders for planning; adjust to your actual blended rates. Budget is constrained to the fixed-price phase totals.

### Delivery team (recommended minimum)
- **Tech Lead (0.25–0.5 FTE across all phases):** architecture, reviews, risk management
- **Frontend Engineer (1.0 FTE P0–P2):** onboarding, tour, embeds, mobile
- **Backend Engineer (1.0 FTE P0–P2):** multi-tenant/RLS, demo reset, audit logs, OpenAPI
- **Designer (0.25 FTE P0–P1):** onboarding UI polish, help center visuals, video style frames
- **Technical Writer / Content (0.5 FTE P1–P2):** help center IA, API docs, scripts
- **CS/Support Lead (0.25 FTE P0–P1):** SOPs, templates, training review
- **Video Editor/Producer (contract P1):** 3 videos
- **QA (0.25 FTE each phase):** smoke/regression, RLS verification, mobile matrix

### Phase budgets (fixed price)

#### P0 — $45,000
- Engineering (FE+BE+Lead): **$33K**
- Design: **$4K**
- QA: **$4K**
- CS/Ops setup: **$2K**
- Tooling/setup contingency: **$2K**

#### P1 — $35,000
- Help center + tutorials (Eng+Writer+Design): **$16K**
- Video production (3 videos end-to-end): **$12K**
- QA + release hardening: **$3K**
- Tools + contingency: **$4K**

#### P2 — $40,000
- Security + RLS tests + audit logs: **$14K**
- API docs (OpenAPI + content): **$10K**
- Analytics instrumentation + dashboards: **$8K**
- Mobile v1 (responsive/PWA): **$6K**
- QA + penetration-lite checklist + contingency: **$2K**

**Total:** $120,000

---

## 3) Sprint plan (2-week sprints, milestones, quality gates)

### Sprint 1 (Weeks 1–2) — P0 delivery
**Milestone:** “First customer can onboard and self-serve demo + email support.”

**Stories (must ship):**
- Onboarding wizard + checklist + progress persistence
- Asset quick-add (manual + CSV template + demo data option)
- Demo tenant seeded + banner + daily reset
- Support email setup + templates + in-app links

**Quality gates:**
- Go/No-Go checklist signed by Tech Lead + PM
- Playwright smoke tests green
- RLS isolation tests for demo tenant green

### Sprint 2 (Weeks 3–4) — P1 delivery
**Milestone:** “Self-serve education: help center + guided tour + 3 training videos.”

**Stories (must ship):**
- Help center IA + screenshots + in-app contextual links
- Guided product tour w/ persistence
- 3 videos hosted + embedded

**Quality gates:**
- Content QA (accuracy + versioning)
- Video QA (audio levels, captions, embed performance)
- Instrumentation confirms: help link clicks + video plays tracked

### Sprint 3 (Weeks 5–6) — P2 (part 1)
**Milestone:** “Security baseline + analytics events live.”

**Stories (must ship):**
- RLS audit + automated regression tests in CI
- RBAC enforcement pass
- Audit log table + admin view
- Analytics events for onboarding/demo/support

**Quality gates:**
- Security checklist completed
- RLS regression tests required for merge

### Sprint 4 (Weeks 7–8) — P2 (part 2)
**Milestone:** “API docs public/gated + mobile v1 + dashboards.”

**Stories (must ship):**
- OpenAPI spec + docs site + examples
- KPI dashboards (activation, time-to-value, demo-to-trial)
- Mobile responsive/PWA improvements for core flows
- Runbooks: backup/restore + demo reset + incident response basics

**Quality gates:**
- Docs “Hello world” tested by non-engineer
- Mobile device matrix smoke tests pass
- Release notes + operational handoff complete

---

## 4) Vendor selection (Intercom, SendGrid, Wistia)

### Intercom (support + knowledge base + in-app messaging)
**Why Intercom:** fastest path to “professional support” with chat, ticketing, and a knowledge base that can be embedded + searched.

**Minimum configuration (P0→P1):**
- Messenger installed + identity verification (HMAC)
- Support workflows: triage, assignment, SLAs
- Canned responses + macros
- Articles (optionally host help center inside Intercom)

**Acceptance checks:**
- Widget loads only for authenticated users (or controlled for marketing)
- Email-to-ticket routing tested

**Fallbacks (if pricing/fit fails):**
- Plain, HelpScout, Zendesk Starter

### SendGrid (transactional + lifecycle email)
**Why SendGrid:** predictable deliverability + templates + domain authentication; integrates cleanly with Supabase/Edge Functions.

**Minimum configuration (P0):**
- SPF/DKIM/DMARC set
- From-domain verified, support mailbox routing
- Transactional templates: verification + welcome

**P2+ (optional):**
- Event-driven onboarding sequence; suppression + unsubscribe compliance

**Fallbacks:**
- Postmark (excellent deliverability), Mailgun

### Wistia (video hosting + analytics + embed)
**Why Wistia:** best-in-class business video embeds, fast player, and viewer analytics useful for sales enablement.

**Minimum configuration (P1):**
- Channels/playlists for training
- Captions + thumbnails
- Embed components with lazy-load

**Fallbacks:**
- Vimeo Business, YouTube (public/unlisted) if cost constrained

---

## 5) Execution-ready start plan (what to do Monday morning)

### Kickoff checklist (first 4 hours)
- Confirm phase scope + “Done” criteria + change control owner
- Assign named owners for: FE, BE, Design, Content, QA, CS
- Confirm environments: staging/prod/demo tenant IDs
- Confirm analytics vendor + baseline events list
- Confirm Intercom/SendGrid/Wistia accounts + access

### Day-1 technical setup
- Create tracking tickets for every “Done criteria” item above
- Add CI gates: Playwright smoke + RLS regression test job placeholder
- Add feature flags for onboarding and demo mode banner (safe rollout)

### Weekly operating rhythm
- Daily 15-min standup
- Mid-sprint demo (internal)
- End-of-sprint release + KPI review
- Risk log updated 2x/week

---

## Appendix A — Cross-phase dependency map

- **Multi-tenant + tenant_id everywhere** → required for demo environment + security baseline
- **SendGrid domain verification** → required for signup verification + support routing
- **Stable UI selectors** → required for product tour + reliable tests
- **Analytics events** → required to prove ROI of onboarding and demo investments

---

## Appendix B — Go/No-Go (P0 launch)

**Must be true to ship P0:**
- Demo tenant isolation proven by automated tests
- Signup verification works reliably (deliverability verified)
- Onboarding flow completes without manual admin steps
- Support channel works and response owner assigned

---

**Document version:** 1.0  
**Last updated:** 2026-02-23  
**Owner:** Product + Engineering
