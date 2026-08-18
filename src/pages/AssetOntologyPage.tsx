/**
 * Class Profiles & Ontology — /assets/ontology.
 *
 * AssetOntology is org-scoped and honestly labelled, but it was mounted at the
 * bottom of the fabricated Conveyor C-22 intelligence page, which no nav item
 * pointed at. The panel is remounted here unmodified so the ontology has an
 * address of its own (navigation-lifecycle-ia.md §2 Group 2).
 */
import { AssetOntology } from "../components/AssetOntology";

export function AssetOntologyPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Class Profiles &amp; Ontology
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Asset class profiles and the knowledge coverage behind them
        </p>
      </div>
      <AssetOntology />
    </div>
  );
}
