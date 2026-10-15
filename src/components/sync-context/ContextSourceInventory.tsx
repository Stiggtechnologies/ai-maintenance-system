import type { SyncContextSourceInventory } from "../../lib/sync-context/source-inventory";
import type { SourceInventoryStatus } from "./useSourceInventory";

const unknownAge = "Unknown — not supplied; not zero";
function age(value: number | null) {
  return value === null ? unknownAge : `${value} seconds at inventory snapshot`;
}
export function ContextSourceInventory({
  status,
  inventory,
  refresh,
}: {
  status: SourceInventoryStatus;
  inventory: SyncContextSourceInventory | null;
  refresh: () => void;
}) {
  return (
    <section
      className="context-source-panel context-inventory"
      aria-label="Organization source inventory"
    >
      <header>
        <div>
          <p className="context-eyebrow">Organization registry · read only</p>
          <h2>Source inventory</h2>
        </div>
        <button
          onClick={refresh}
          disabled={status === "loading" || status === "unauthorized"}
        >
          Refresh source inventory
        </button>
      </header>
      <p>
        All classified sources in the authorized organization, including
        disconnected and blocked feeds; not selected-site coverage. This is a
        separate snapshot from the operating picture.
      </p>
      <p>
        No operational authority. Recorded checks are not proof of a successful
        transport connection.
      </p>
      {status === "loading" && (
        <p role="status">
          Retrieving organization source inventory… Previous records are hidden.
        </p>
      )}
      {status === "unauthorized" && (
        <p role="status">
          Waiting for matching current organization access. No prior source
          records are displayed.
        </p>
      )}
      {(status === "error" || (status === "ready" && !inventory)) && (
        <div
          className="context-warning"
          role="alert"
          aria-label="Source inventory unavailable"
        >
          <p>
            Source inventory is unavailable or refused. Unavailable is not an
            empty registry or healthy coverage.
          </p>
          <button onClick={refresh}>Retry source inventory</button>
        </div>
      )}
      {status === "ready" && inventory && (
        <>
          <p>
            Inventory snapshot:{" "}
            <time dateTime={inventory.generatedAt}>
              {inventory.generatedAt}
            </time>{" "}
            · {inventory.sources.length} classified sources
          </p>
          {!inventory.sources.length && (
            <p>
              No classified sources returned for this authorized organization;
              not proof that no other integrations exist.
            </p>
          )}
          <div className="context-inventory-grid">
            {inventory.sources.map((source) => (
              <article
                key={source.id}
                aria-label={source.name || "Unnamed registered source"}
              >
                <h3>{source.name || "Unnamed registered source"}</h3>
                <p>
                  {source.class.replaceAll("_", " ")} ·{" "}
                  {source.authority.replaceAll("_", " ")}
                </p>
                <dl>
                  <dt>Reported health / effective read state</dt>
                  <dd>
                    {source.reportedHealthState} / {source.state}
                  </dd>
                  <dt>Registry enablement / status</dt>
                  <dd>
                    {source.enabled === null
                      ? "Unknown — not supplied"
                      : source.enabled
                        ? "Enabled"
                        : "Disabled"}{" "}
                    ·{" "}
                    {source.registryStatus ??
                      "Unknown — not supplied; not active"}
                  </dd>
                  <dt>Source rights</dt>
                  <dd>
                    {source.rightsState} ·{" "}
                    {source.rightsPermit
                      ? "Permitted at snapshot"
                      : "Not permitted at snapshot"}
                  </dd>
                  <dt>Eligible to emit / live display</dt>
                  <dd>
                    {source.canEmit
                      ? "Yes — at inventory snapshot, not feature approval"
                      : "No — not eligible to emit"}{" "}
                    ·{" "}
                    {source.displayAsLive
                      ? "Live source state at snapshot; not site coverage"
                      : "Not displayed as live"}
                  </dd>
                  <dt>Recorded check timestamp</dt>
                  <dd>{source.checkedAt ?? unknownAge}</dd>
                  <dt>Recorded check age</dt>
                  <dd>{age(source.checkAgeSeconds)}</dd>
                  <dt>Source observation / age</dt>
                  <dd>
                    {source.observedAt ?? "Unknown — not supplied"} ·{" "}
                    {age(source.observationAgeSeconds)}
                  </dd>
                  <dt>Last successful transport check</dt>
                  <dd>Unknown — no transport-success receipt</dd>
                  <dt>Coverage</dt>
                  <dd>Unknown — no governed coverage measurement</dd>
                  <dt>Purpose</dt>
                  <dd>{source.purpose || "No purpose supplied"}</dd>
                  <dt>Detail</dt>
                  <dd>{source.detail ?? "No source detail supplied"}</dd>
                  <dt>Read issues</dt>
                  <dd>
                    {source.issues.length
                      ? source.issues.join(" · ")
                      : "None reported by this inventory read; not proof of operational suitability"}
                  </dd>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
