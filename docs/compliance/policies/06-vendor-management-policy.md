# Vendor / Subprocessor Management Policy

**Owner:** `[SECURITY OWNER]` · **Approved:** `[NAME, DATE]` · **Review:** annual

## 1. Purpose

Ensure third parties that process `[COMPANY]`/customer data meet security
obligations.

## 2. Subprocessor register (maintain and publish)

| Subprocessor                   | Purpose                                 | Data processed                     | Attestation                   | DPA        |
| ------------------------------ | --------------------------------------- | ---------------------------------- | ----------------------------- | ---------- |
| Supabase (AWS, Canada Central) | Database, auth, edge functions, storage | Customer operating data, user auth | SOC 2 / ISO 27001 `[collect]` | `[sign]`   |
| Vercel                         | Frontend hosting/CDN                    | App assets, request logs           | SOC 2 `[collect]`             | `[sign]`   |
| OpenAI                         | LLM inference (copilot, deliverables)   | Prompt content + injected context  | SOC 2 / DPA `[collect]`       | `[sign]`   |
| Google (Gemini)                | Embeddings + enrichment                 | Query text                         | `[collect]`                   | `[sign]`   |
| GitHub                         | Source control, CI                      | Source code                        | SOC 2 / ISO `[collect]`       | `[review]` |

## 3. Requirements

- Before onboarding a vendor with data access: review its security posture
  (SOC 2 / ISO cert), sign a **Data Processing Agreement**, and record it here.
- Re-review annually.
- Note **data-residency** obligations (Canada Central chosen for residency).
- For LLM subprocessors: confirm the **no-training-on-data** setting/contract
  and minimize the context sent.

## 4. Evidence (for auditors)

- This register with attestations attached; signed DPAs; annual review dates.
