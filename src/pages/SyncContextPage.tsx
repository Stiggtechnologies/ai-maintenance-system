import { useState, useRef } from "react";
import { Navigate } from "react-router-dom";
import {
  Layers,
  Map as MapIcon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Moon,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { canOpenSyncContext } from "../lib/sync-context/access";
import { getRoleHome } from "../lib/roleNavigation";
import { useOperatingPicture } from "../components/sync-context/useOperatingPicture";
import { ContextCoordinateCanvas } from "../components/sync-context/ContextCoordinateCanvas";
import { ContextObjectInspector } from "../components/sync-context/ContextObjectInspector";
import { ContextProvenanceBadges } from "../components/sync-context/ContextProvenanceBadges";
import { CONTEXT_SOURCE_CLASSES } from "../lib/sync-context/contracts";
import type { SyncContextOperatingPicture } from "../lib/sync-context/operating-picture";
import type { OperatingSiteScope } from "../components/sync-context/OperatingSiteScope";
import {
  contextViewKey,
  contextSessionStorage,
  restoreContextView,
  saveContextView,
  type ContextViewPreferences,
} from "../lib/sync-context/view-preferences";
import "../components/sync-context/context-workspace.css";

export function SyncContextPage() {
  const { profile, loading } = useAuth();
  if (loading || !profile)
    return <p role="status">Waiting for authenticated profile…</p>;
  if (!canOpenSyncContext(profile.role))
    return <Navigate to={getRoleHome(profile.role)} replace />;
  return <OperatingWorkspace role={profile.role} />;
}
function OperatingWorkspace({ role }: { role: string }) {
  const { scope, status, picture, refresh } = useOperatingPicture();
  // Authenticated workspace appearance is local UI state, not a public-journey
  // or administrator preference. Public journeys deliberately remain dark.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const toggleTheme = () =>
    setTheme((value) => (value === "dark" ? "light" : "dark"));
  return (
    <section
      className="context-workspace"
      data-theme={theme}
      aria-label="Sync Context workspace"
    >
      <header className="context-header">
        <div>
          <p className="context-eyebrow">
            <MapIcon size={14} aria-hidden /> Industrial operating picture ·
            read only
          </p>
          <h1>Sync Context</h1>
          <p>
            Verified spatial evidence. Explicit uncertainty. Governed decisions.
          </p>
        </div>
        <div className="context-toolbar">
          <button
            onClick={toggleTheme}
            aria-label={`Switch Context to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button onClick={refresh} disabled={status === "loading"}>
            <RefreshCw size={16} /> Refresh authorized data
          </button>
        </div>
      </header>
      <div className="context-scope">
        <span>
          <ShieldCheck size={15} aria-hidden />{" "}
          {scope?.siteName ?? "Resolving organization/site scope"}
        </span>
        <span>
          Use the app’s site selector · no separate Context site preference
        </span>
      </div>
      {status === "loading" && (
        <section className="context-state" role="status">
          Retrieving current authorized context… Previous geometry is hidden
          until this read succeeds.
        </section>
      )}
      {status === "unauthorized" && (
        <section className="context-state" role="status">
          Waiting for a matching authenticated organization/site context. No
          prior tenant data is displayed.
        </section>
      )}
      {status === "error" && (
        <section className="context-state context-warning" role="alert">
          <h2>Context is unavailable</h2>
          <p>
            The authorized read failed or was refused. Previous geometry and
            selection are hidden; unavailable is not an empty or healthy site.
          </p>
          <button onClick={refresh}>Retry authorized read</button>
        </section>
      )}
      {status === "ready" && picture && scope && (
        <ReturnedOperatingPicture
          key={`${contextViewKey(scope)}:${picture.generatedAt}`}
          picture={picture}
          scope={scope}
          role={role}
        />
      )}
    </section>
  );
}
function ReturnedOperatingPicture({
  picture,
  scope,
  role,
}: {
  picture: SyncContextOperatingPicture;
  scope: OperatingSiteScope;
  role: string;
}) {
  const [view, setView] = useState(() =>
    restoreContextView(contextSessionStorage(), scope, picture),
  );
  const [query, setQuery] = useState("");
  const returnFocus = useRef<HTMLElement | SVGElement | null>(null);
  const targets = useRef(new Map<string, HTMLButtonElement>());
  const update = (change: Partial<ContextViewPreferences>) => {
    const next = { ...view, ...change };
    setView(next);
    saveContextView(contextSessionStorage(), scope, next);
  };
  const visible = picture.objects.filter(
    (o) =>
      !view.hiddenLayers.includes(o.layerId) &&
      (view.sourceClass === "all" || o.source.class === view.sourceClass) &&
      o.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selected = visible.find((o) => o.id === view.selectedId);
  const select = (id: string) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ||
      document.activeElement instanceof SVGElement
        ? document.activeElement
        : null;
    update({ selectedId: id });
  };
  const closeInspector = () => {
    const target =
      returnFocus.current?.isConnected && returnFocus.current !== document.body
        ? returnFocus.current
        : targets.current.get(view.selectedId ?? "");
    update({ selectedId: null });
    target?.focus();
  };
  const visibleEvents = picture.events.filter(
    (e) => view.sourceClass === "all" || e.source.class === view.sourceClass,
  );
  const cycle = (direction: number) => {
    if (!visible.length) return;
    const index = visible.findIndex((o) => o.id === view.selectedId);
    update({
      selectedId:
        visible[
          index < 0
            ? direction > 0
              ? 0
              : visible.length - 1
            : (index + direction + visible.length) % visible.length
        ].id,
    });
  };
  const objectCoverage = picture.coverage.objects;
  const exclusions = Object.entries(objectCoverage).filter(
    ([key]) => !["eligible", "returned", "truncated"].includes(key),
  );
  return (
    <>
      <section className="context-metrics" aria-label="Query coverage">
        <div>
          <span>Eligible geometry</span>
          <strong>{objectCoverage.eligible.toLocaleString()}</strong>
          <small>Post-governance, before limit</small>
        </div>
        <div>
          <span>Returned / matching display filters</span>
          <strong>
            {objectCoverage.returned.toLocaleString()} /{" "}
            {visible.length.toLocaleString()}
          </strong>
          <small>Display filters do not change query coverage</small>
        </div>
        <div>
          <span>Eligible / returned events</span>
          <strong>
            {picture.coverage.events.eligible.toLocaleString()} /{" "}
            {picture.coverage.events.returned.toLocaleString()}
          </strong>
          <small>Unlocated records, not map markers</small>
        </div>
        <div>
          <span>Snapshot retrieved</span>
          <strong className="context-time">{picture.generatedAt}</strong>
          <small>
            Refreshes every 60 seconds; not a completeness guarantee
          </small>
        </div>
      </section>
      {(objectCoverage.truncated || picture.coverage.events.truncated) && (
        <p className="context-warning">
          Query limits truncate the authorized result. This is not complete
          fleet/site coverage.
        </p>
      )}
      {picture.issues.length > 0 && (
        <details className="context-warning">
          <summary>
            Renderer validation issues ({picture.issues.length})
          </summary>
          <ul>
            {picture.issues.map((issue, i) => (
              <li key={i}>
                {issue.scope} {issue.id ?? issue.index}: {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="context-body">
        <section
          className="context-control-panel"
          aria-label="Layers and returned objects"
        >
          <h2>
            <Layers size={17} /> Layers
          </h2>
          {picture.layers.map((layer) => (
            <div className="context-layer" key={layer.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!view.hiddenLayers.includes(layer.id)}
                  disabled={!layer.authorized || layer.renderMode === "event"}
                  onChange={(e) =>
                    update({
                      hiddenLayers: e.target.checked
                        ? view.hiddenLayers.filter((id) => id !== layer.id)
                        : [...view.hiddenLayers, layer.id],
                    })
                  }
                />
                {layer.label}
              </label>
              <p>
                {layer.availability} · {layer.candidateCount} candidates ·{" "}
                {layer.eligibleCount} eligible
              </p>
              {layer.issues.map((issue, i) => (
                <small key={i}>{issue}</small>
              ))}
            </div>
          ))}
          <label className="context-field">
            Source display filter
            <select
              value={view.sourceClass}
              onChange={(e) =>
                update({
                  sourceClass: e.target
                    .value as ContextViewPreferences["sourceClass"],
                })
              }
            >
              <option value="all">All authorized source classes</option>
              {CONTEXT_SOURCE_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="context-field">
            Find a returned object
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder="Object name"
            />
          </label>
          <div className="context-cycle">
            <button disabled={!visible.length} onClick={() => cycle(-1)}>
              Previous target
            </button>
            <button disabled={!visible.length} onClick={() => cycle(1)}>
              Next target
            </button>
          </div>
          <ul
            className="context-object-list"
            aria-label="Accessible returned object list"
          >
            {visible.map((o) => (
              <li key={o.id}>
                <button
                  ref={(element) => {
                    if (element) targets.current.set(o.id, element);
                    else targets.current.delete(o.id);
                  }}
                  aria-pressed={selected?.id === o.id}
                  onClick={() => select(o.id)}
                >
                  <strong>{o.name}</strong>
                  <span>
                    {o.kind.replaceAll("_", " ")} ·{" "}
                    {o.display.demoOnly
                      ? "DEMO / SIMULATED"
                      : o.source.class.replaceAll("_", " ")}{" "}
                    · {o.source.healthState}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!visible.length && (
            <p>
              {picture.objects.length
                ? "No returned objects match these display filters."
                : objectCoverage.eligible > 0
                  ? "Renderer excluded returned records; inspect validation issues."
                  : "No eligible geometry returned. Review layer/source status and exclusion counts; this is not proof of no hazards, no assets or complete data."}
            </p>
          )}
        </section>
        <div className="context-map-column">
          <ContextCoordinateCanvas
            objects={visible}
            selectedId={selected?.id ?? null}
            onSelect={select}
            viewport={view.viewport}
            onViewport={(viewport) => update({ viewport })}
          />
          <section
            className="context-events"
            aria-label="Unlocated authorized events"
          >
            <h2>Operating events · location unavailable</h2>
            <p>
              Event timestamps are observations, not replay positions or current
              authorization to act.
            </p>
            <ul>
              {visibleEvents.map((e) => (
                <li key={e.id}>
                  <strong>{e.title}</strong>
                  <span>
                    {e.occurredAt} · {e.governanceState} ·{" "}
                    {e.source.class.replaceAll("_", " ")}
                  </span>
                  <small>
                    {e.canonicalRecord.type}: {e.canonicalRecord.id} ·{" "}
                    {e.display.demoOnly ? "DEMO / SIMULATED · " : ""}no
                    operational authority
                  </small>
                </li>
              ))}
            </ul>
            {!visibleEvents.length && (
              <p>
                {picture.events.length
                  ? "No returned events match this display filter."
                  : "No eligible events returned; not proof of no operating events."}
              </p>
            )}
          </section>
        </div>
        {selected && (
          <ContextObjectInspector
            object={selected}
            picture={picture}
            role={role}
            onClose={closeInspector}
          />
        )}
      </div>
      <details className="context-source-panel">
        <summary>
          Source health and governance ({picture.sources.length} dependent
          sources)
        </summary>
        <p>
          Only sources required by this query are listed. Source health is not
          inferred from object count, and this panel does not inventory
          unconnected sources without scoped candidates.
        </p>
        {picture.sources.map((source) => (
          <article key={source.id}>
            <h3>{source.name}</h3>
            <ContextProvenanceBadges source={source} />
            <p>{source.detail ?? "No source detail supplied"}</p>
            <dl>
              <dt>Checked</dt>
              <dd>{source.checkedAt}</dd>
              <dt>Source observation</dt>
              <dd>{source.observedAt ?? "Unavailable — not supplied"}</dd>
              <dt>Purpose</dt>
              <dd>{source.purpose}</dd>
            </dl>
          </article>
        ))}
      </details>
      <details className="context-source-panel">
        <summary>
          Disjoint object exclusions and incomplete capabilities
        </summary>
        <dl>
          {exclusions.map(([name, count]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{String(count)}</dd>
            </div>
          ))}
        </dl>
        <p>
          Full basemap, 3D, nearby/range queries, canonical engineering-detail
          resolution, timeline/replay, assessment and retained Decision Case
          handoff are unfinished. This surface does not certify source coverage,
          site safety or production readiness.
        </p>
      </details>
    </>
  );
}
