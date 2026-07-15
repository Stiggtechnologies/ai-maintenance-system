# Data Classification, Retention & Disposal Policy

**Owner:** `[SECURITY OWNER]` · **Approved:** `[NAME, DATE]` · **Review:** annual

## 1. Classification

| Class        | Examples                                                              | Handling                                         |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| Restricted   | Credentials, API keys, secrets                                        | Secret store only; never in code/chat; MFA-gated |
| Confidential | Customer operating data, board/financial KPIs, user PII (email, name) | RLS tenant-isolated; role-audience filtered; TLS |
| Internal     | Aggregate metrics, docs                                               | Authenticated access                             |
| Public       | Marketing, public demo page                                           | Open                                             |

The product carries a `data_sensitivity` field per asset onboarding (public /
internal / confidential / restricted) — align with this scheme.

## 2. Encryption

- **In transit:** TLS/HTTPS everywhere; no sensitive data in URL parameters.
- **At rest:** managed encryption (Supabase/AWS); passwords bcrypt-hashed.

## 3. Retention

| Data                                      | Retention                 | Mechanism                          |
| ----------------------------------------- | ------------------------- | ---------------------------------- |
| Agent run history                         | 7 days                    | pruned in `run_agent_loop()`       |
| KPI values                                | 90 days                   | pruned in `compute_kpi_snapshot()` |
| Decisions / learning events / audit trail | `[define — e.g. 7 years]` | —                                  |
| Backups                                   | `[per Supabase plan]`     | managed                            |

## 4. Disposal

On contract end or request, customer data is deleted within `[N days]` via
`[procedure]`; deletion is logged. Confirm subprocessor deletion too.

## 5. PII & privacy

Minimal PII is collected (email, full name, role). A customer-facing **privacy
policy** `[link]` and, where applicable, data-subject request handling apply.

## 6. Evidence (for auditors)

- Retention windows in migrations; classification field; encryption config; the
  privacy policy; deletion records.
