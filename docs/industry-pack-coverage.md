# Industry pack coverage

**Program-of-record date:** 2026-08-24

SyncAI has **16 governed industry template packs** and a separate custom-sector
path. Every governed pack is bound to one or more executable kernel failure
contexts. `kernel_bound` means the referenced analysis engines exist; it is not
a claim that the pack has been adopted by a customer, reviewed for every
jurisdiction, or validated as industry policy. All pack content remains
`draft` until authorized domain and customer review advances it.

| Pack                       | Kernel contexts | Named non-executable scope still requiring a domain module                                          |
| -------------------------- | --------------: | --------------------------------------------------------------------------------------------------- |
| Oil Sands                  |               5 | Tailings geotechnical assessment                                                                    |
| Mining                     |               4 | None in the current declared profile                                                                |
| Oil & Gas                  |               4 | Well integrity                                                                                      |
| Petrochemical              |               4 | RBI corrosion-loop modelling                                                                        |
| Power Generation           |               4 | None in the current declared profile                                                                |
| Utilities                  |               3 | Storm mobilization; crew dispatch                                                                   |
| Manufacturing              |               3 | Line balancing; robot-specific health models                                                        |
| Food & Beverage            |               4 | HACCP verification; CIP validation; cold-chain excursion modelling                                  |
| Pharmaceuticals            |               3 | GxP validation; batch-record integration                                                            |
| Transportation & Logistics |               2 | Route/depot optimization; regulatory inspection scheduling                                          |
| Aviation                   |               3 | Airworthiness/service-bulletin compliance; MSG-3; life-limited-part traceability                    |
| Marine Shipping            |               4 | Class survey scheduling; hull/propulsion efficiency; voyage optimization                            |
| Data Centers               |               2 | Thermal/airflow modelling                                                                           |
| Defense                    |               3 | Mission-readiness modelling; MIL-SPEC configuration/obsolescence; classified deployment             |
| Aerospace & Launch         |               3 | Reuse-life accounting; range safety; propellant-specific degradation                                |
| Buildings & Infrastructure |               4 | Jurisdictional code compliance; fire/life-safety engineering; occupancy/accessibility certification |

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
The custom-sector path remains organization-defined and is not counted as a
17th governed pack.
