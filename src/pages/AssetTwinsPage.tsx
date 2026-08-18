/**
 * Twin & Naming Coverage — /assets/twins.
 *
 * AssetTwinCoverage answers an asset-foundation question — which assets have
 * an evidence-carrying twin and which are shells — but it was filed as the
 * third panel of the Integrations page, under System. The panel is remounted
 * here unmodified (navigation-lifecycle-ia.md §2 Group 2).
 */
import { AssetTwinCoverage } from "../components/AssetTwinCoverage";

export function AssetTwinsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Twin &amp; Naming Coverage
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Which assets carry an evidence-backed twin, and which are shells
        </p>
      </div>
      <AssetTwinCoverage />
    </div>
  );
}
