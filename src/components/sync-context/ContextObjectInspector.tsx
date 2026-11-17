import { Link } from "react-router-dom";
import type {
  OperatingSpatialObject,
  SyncContextOperatingPicture,
} from "../../lib/sync-context/operating-picture";
import { isNavItemVisible } from "../../lib/roleNavigation";
import { ContextProvenanceBadges } from "./ContextProvenanceBadges";

export function ContextObjectInspector({
  object,
  picture,
  role,
  onClose,
}: {
  object: OperatingSpatialObject;
  picture: SyncContextOperatingPicture;
  role: string | null;
  onClose: () => void;
}) {
  const source = picture.sources.find((s) => s.id === object.source.id);
  const links = object.subjects.flatMap((ref) => {
    const id = String(ref.id);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return [];
    const destination =
      ref.type === "asset"
        ? { item: "assets", path: `/assets/${id}`, label: "Open Asset" }
        : ref.type === "work_order"
          ? { item: "work", path: `/work/${id}`, label: "Open Work" }
          : ref.type === "development_case"
            ? {
                item: "develop",
                path: `/develop/cases/${id}`,
                label: "Open Develop Case",
              }
            : null;
    return destination && isNavItemVisible(role, destination.item)
      ? [{ ...destination, id }]
      : [];
  });
  return (
    <aside className="context-inspector" aria-label="Selected object inspector">
      <div className="context-inspector-heading">
        <div>
          <p className="context-eyebrow">
            Returned source geometry · {object.kind.replaceAll("_", " ")}
          </p>
          <h2>{object.name}</h2>
        </div>
        <button onClick={onClose} aria-label="Close object inspector">
          ×
        </button>
      </div>
      <p className="context-warning">
        {object.display.demoOnly ? "SIMULATED / DEMO ONLY. " : ""}
        {object.authority.label}. No operational authority.
      </p>
      {source && <ContextProvenanceBadges source={source} />}
      <dl>
        <dt>Canonical geometry ID</dt>
        <dd>{object.id}</dd>
        <dt>Observed</dt>
        <dd>{object.observedAt}</dd>
        <dt>Retrieved snapshot</dt>
        <dd>{picture.generatedAt}</dd>
        <dt>Validity</dt>
        <dd>
          {object.validityKind === "temporary"
            ? `Until ${object.validUntil}`
            : "Permanent record; not proof of continuing field conditions"}
        </dd>
        <dt>Data quality</dt>
        <dd>{object.dataQuality}</dd>
        <dt>Confidence</dt>
        <dd>Unavailable — not supplied by this projection</dd>
        <dt>Source reference</dt>
        <dd>{object.sourceReference}</dd>
        <dt>Coordinate basis (asserted)</dt>
        <dd>{object.coordinate.basis}</dd>
        <dt>Coordinate reference / axis order</dt>
        <dd>
          {object.coordinate.referenceSystem} · GeoJSON longitude, latitude (
          {object.coordinate.axisOrder})
        </dd>
        <dt>Horizontal accuracy</dt>
        <dd>
          {object.coordinate.horizontalAccuracyM === null
            ? "Unknown — not supplied; not zero"
            : `${object.coordinate.horizontalAccuracyM} metres (source supplied)`}
        </dd>
      </dl>
      <h3>Canonical subjects</h3>
      <ul>
        {object.subjects.map((ref) => (
          <li key={`${ref.type}:${ref.id}`}>
            <strong>{ref.type.replaceAll("_", " ")}</strong>
            <code>{ref.id}</code>
          </li>
        ))}
      </ul>
      <div className="context-inspector-actions">
        {links.map((link) => (
          <Link key={`${link.item}:${link.id}`} to={link.path}>
            {link.label}
          </Link>
        ))}
      </div>
      <h3>Referenced verified evidence</h3>
      <ul>
        {object.evidenceIds.map((id) => (
          <li key={id}>
            <code>{id}</code>
          </li>
        ))}
      </ul>
      <p>
        Evidence IDs are from this authorized read. Evidence detail is not
        retrieved here.
      </p>
      <h3>Named evidence gaps</h3>
      {object.missingEvidence.length ? (
        <ul>
          {object.missingEvidence.map((gap, i) => (
            <li key={i}>{gap}</li>
          ))}
        </ul>
      ) : (
        <p>
          No gaps declared by this record; this is not proof of complete
          evidence.
        </p>
      )}
      <h3>Engineering context</h3>
      <p>
        Operating state, criticality, current events, work opportunity, RTS,
        risks, repeat failures, PoF/RUL and dependencies: unavailable — not
        retrieved by this projection. No zero values, inferred confidence or
        readiness claims.
      </p>
      <p>
        Assessment and retained Decision Case drafting are not yet wired from
        this inspector. No approval or execution action is offered.
      </p>
    </aside>
  );
}
