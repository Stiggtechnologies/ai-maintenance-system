# Incident Response Policy

**Owner:** `[SECURITY OWNER]` · **Approved:** `[NAME, DATE]` · **Review:** annual + after each incident

## 1. Purpose

Define how `[COMPANY]` detects, responds to, and learns from security incidents.

## 2. Definitions

A **security incident** is any event that compromises the confidentiality,
integrity, or availability of SyncAI data or systems (e.g. credential exposure,
unauthorized access, data leak, malware, denial of service, RLS bypass).

## 3. Reporting

Anyone who suspects an incident reports immediately to `[security@COMPANY]` or
`[CHANNEL]`. No blame for good-faith reports.

## 4. Response phases

1. **Identify & triage** — assess scope and severity (`[SEV1–SEV3 criteria]`).
2. **Contain** — revoke affected credentials/sessions, isolate systems, rotate
   secrets. (Credential rotation is via `[Supabase admin / provider console]`.)
3. **Eradicate** — remove the cause; patch.
4. **Recover** — restore service; verify integrity (backups + migration chain).
5. **Notify** — customers/regulators per contractual and legal timelines
   `[e.g. within 72h where required]`.
6. **Post-incident review** — documented root-cause and corrective actions
   tracked to closure (apply the product's FRACAS discipline to the ISMS).

## 5. Roles

- **Incident lead:** `[ROLE]` · **Comms:** `[ROLE]` · **On-call eng:** `[ROTATION]`

## 6. Testing

Run at least one **tabletop exercise per year**; record it.

## 7. Evidence (for auditors)

- This policy + a maintained incident log (even if empty).
- Tabletop-exercise records; contact tree; breach-notification templates.
