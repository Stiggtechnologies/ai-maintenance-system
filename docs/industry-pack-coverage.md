# Industry pack coverage

**Program-of-record date:** 2026-08-26

SyncAI has **19 governed industry template packs** and a separate custom-sector
path. Every governed pack is bound to one or more executable kernel failure
contexts. Seventeen packs also bind to governed domain-depth modules containing
58 deterministic calculations, optimizers, traceability checks, verification
methods and readiness screens. `kernel_bound` means executable code exists; it
is not a claim that a customer has adopted the pack, that any legal requirement
applies, that a standard is licensed, or that an authority has certified the
result. All pack content remains `draft` until authorized domain and customer
review advances it.

| Pack                       | Kernel contexts | Governed domain-depth module / methods                                                    |
| -------------------------- | --------------: | ----------------------------------------------------------------------------------------- |
| Oil Sands                  |               5 | Tailings geotechnical screening (1)                                                       |
| Mining                     |               4 | None requested                                                                            |
| Oil & Gas                  |               4 | Well barrier and pressure-envelope review (1)                                             |
| Petrochemical              |               4 | Process integrity, process safety and RBI (6)                                             |
| Power Generation           |               4 | None requested                                                                            |
| Battery & Energy Storage   |               4 | Thermal; HV safety; degradation; fire readiness (4)                                       |
| Utilities                  |               3 | Storm mobilization and crew dispatch (1)                                                  |
| Manufacturing              |               3 | OEE; quality loss; line balance; robot/tooling health; changeover (6)                     |
| Food & Beverage            |               4 | HACCP; CIP; cold-chain excursion (3)                                                      |
| Pharmaceuticals            |               3 | GxP validation; batch-record trace (2)                                                    |
| Healthcare                 |               3 | Criticality; availability; calibration; infection control; patient risk; traceability (6) |
| Transportation & Logistics |               2 | Route/depot optimization; inspection scheduling (2)                                       |
| Aviation                   |               3 | Airworthiness; MSG-3; life-limited parts (3)                                              |
| Marine Shipping            |               4 | Class surveys; propulsion efficiency; voyage optimization (3)                             |
| Data Centers               |               2 | Lumped thermal and airflow balance (1)                                                    |
| Defense                    |               3 | Mission readiness; configuration; deployment controls (3)                                 |
| Aerospace & Launch         |               3 | Reuse life; range safety; propellant condition (3)                                        |
| Buildings & Infrastructure |               4 | Code; life safety; occupancy; environment; BAS; resources; renewal (7)                    |
| Civil Infrastructure       |               3 | Condition; inspection; deterioration; loads; geographic risk; renewal (6)                 |

## Count integrity

KPI, asset-class and failure-mode counts rendered by deployment screens are
derived from `kpi_pack_items`, `industry_asset_library_items` and
`failure_mode_pack_items`. The migration is generated from
`src/lib/industry-template-packs.ts`; CI refuses a stale generated migration.
The former unearned production literals (`24`, `38`, `412`) are overwritten by
relational counts, and the four legacy deployment templates are rebound to
their correct Oil Sands, Mining, Manufacturing and Power Generation packs.

## What remains human work

Moving any pack from `draft` to `reviewed` or `customer_validated` requires
named evidence and authorized review. Code must not promote those statuses.
Every domain run remains non-authoritative, links to a governed risk and
canonical evidence, and requires an independent reviewer. The modules do not
select jurisdiction, invent thresholds, interpret copyrighted standards,
certify compliance, release equipment/product/facilities, dispatch crews, or
authorize operation. Those decisions remain with the named customer, OEM,
professional, regulator, class, command, airworthiness, range or security
authority.
The custom-sector path remains organization-defined and is not counted as a
20th governed catalog option.

Implementation and method boundaries are documented in
[`domain-specialist-modules.md`](domain-specialist-modules.md).
