# Ball Mill DNA Audit

## Scope

This note covers issue #109 for the manufacturer-neutral ball mill asset DNA. The work adds a draft canonical ball mill template and Engineering DNA profile without changing shared engineering contracts, physics contracts, migrations, RLS policies, or the existing SAG mill implementation.

## Sources And Constraints

- GitHub issue #109 defined the implementation boundaries, required systems, governance rules, and validation commands.
- Public ball-mill digital-twin literature was used only to confirm the generic problem space of ball-mill predictive-maintenance twins and data-quality constraints. It was not used for OEM limits, wear criteria, setpoints, or maintenance intervals.
- No OEM thresholds, liner-change criteria, lubrication setpoints, wear limits, or maintenance intervals were added.
- All records remain `draft`; site approval and engineering approval remain required; autonomous operational action remains prohibited.

## SAG Concepts Reused

- The SAG mill pattern of a self-contained `AssetClassTemplate` plus paired `EngineeringDnaProfile`.
- The same governed DNA capabilities: canonical hierarchy, failure mechanisms, telemetry concepts, digital twin instantiation, and governed recommendations.
- The same approval-gated DNA governance policy and approved-source-only threshold policy.
- The same registry shape through `getAssetClassTemplate`, `engineeringDnaLibrary`, `getEngineeringDnaProfile`, and `getEngineeringDnaForAssetClass`.
- The same customer twin compatibility path through `instantiateEngineeringTwin`.

## Ball Mill Differences

- The shell component explicitly includes grinding media as part of the canonical system boundary; SAG milling uses ore plus charge behavior, while the ball mill template needs ball-charge condition represented without prescribing quantities.
- The drive component explicitly allows ring gear and pinion or gearless drive applicability without model-specific configuration.
- The feed and discharge component is framed around prepared feed, slurry discharge, classification interfaces, and media retention, rather than SAG-specific trommel and oversize handling assumptions.
- The lubrication system names jacking, filtration, and cooling as first-class functions because these are required system boundaries for the ball mill work packet.

## Legacy Reference Check

The requested files were inspected before implementation. Current `main` does not contain a legacy ball-mill template in `src/lib/asset-class-templates.ts`, `src/lib/industry-template-packs.ts`, or seed files discovered by repository search. The only `SAG` hits in those named legacy template files referred to Steam-Assisted Gravity Drainage or voltage sag, not SAG grinding mills.
