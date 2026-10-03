import { useEffect, useState } from "react";
import { Boxes, GitMerge, Hash, Loader2, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getAssetMasterWorkspace,
  recordAssetClassGovernance,
  recordTenantTwinTemplate,
  recordUnitNumberingRule,
  reviewTenantTwinTemplate,
  runGovernedTwinProvisioning,
  runGovernedUnitNumbering,
} from "../services/assetMasterGovernanceService";

const field =
  "w-full rounded-lg border border-industrial-border bg-industrial-black px-3 py-2 text-sm text-industrial-text placeholder:text-slate-600 focus:border-signal-cyan focus:outline-none";

export function AssetMasterGovernanceWorkbench() {
  const workspace = useAsyncData(getAssetMasterWorkspace);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [reviewBasis, setReviewBasis] = useState("");
  const [actionBasis, setActionBasis] = useState("");
  const [template, setTemplate] = useState({
    key: "",
    version: "1.0",
    family: "",
    assetClass: "",
    title: "",
    description: "",
    components: "[]",
    evidenceReference: "",
    evidenceBasis: "",
  });
  const [mapping, setMapping] = useState({
    localClass: "",
    catalogueClass: "",
    templateKey: "",
    fit: "direct" as "direct" | "approximate" | "none",
    rationale: "",
    source: "",
    evidenceBasis: "",
  });
  const [numbering, setNumbering] = useState({
    prefix: "",
    expectedClass: "",
    manufacturer: "",
    model: "",
    ambiguity: "",
    source: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    evidenceBasis: "",
  });

  useEffect(() => {
    if (mapping.fit === "none" && mapping.templateKey) {
      setMapping((current) => ({ ...current, templateKey: "" }));
    }
  }, [mapping.fit, mapping.templateKey]);

  async function run(
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await action();
      setNotice({ ok: true, text: `${success} ${JSON.stringify(result)}` });
      await workspace.refetch();
    } catch (error) {
      setNotice({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "The server refused the act.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (workspace.loading) {
    return (
      <div className="flex min-h-32 items-center justify-center text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-signal-cyan" />
        Loading asset-master governance…
      </div>
    );
  }
  if (workspace.error || !workspace.data) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
        {workspace.error ?? "Asset-master governance is unavailable."}
      </div>
    );
  }

  const data = workspace.data;

  return (
    <section aria-labelledby="asset-master-heading" className="space-y-5">
      <div>
        <h2
          id="asset-master-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ShieldCheck className="h-5 w-5 text-signal-gold" /> Asset Master
          Governance
        </h2>
        <p className="mt-1 max-w-4xl text-sm text-slate-300">
          Govern canonical class templates, local vocabulary and unit-number
          derivation before creating draft fleet twins.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {Object.values(data.governance).map((text) => (
          <p
            key={text}
            className="rounded-lg border border-white/6 bg-black/15 p-3 text-xs leading-5 text-slate-400"
          >
            {text}
          </p>
        ))}
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-lg border p-3 text-sm ${notice.ok ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-red-500/20 bg-red-500/5 text-red-300"}`}
        >
          {notice.text}
        </div>
      )}

      {!data.can_manage && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
          Your role is read-only. A named asset-master, reliability or
          management role must record changes.
        </div>
      )}

      {data.can_manage && (
        <div className="grid gap-5 xl:grid-cols-2">
          <form
            className="glass space-y-3 rounded-xl border border-white/6 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              let components: unknown;
              try {
                components = JSON.parse(template.components);
              } catch {
                setNotice({
                  ok: false,
                  text: "Components must be valid JSON.",
                });
                return;
              }
              if (!Array.isArray(components)) {
                setNotice({
                  ok: false,
                  text: "Components must be a JSON array.",
                });
                return;
              }
              void run(
                "template",
                () =>
                  recordTenantTwinTemplate({
                    template_key: template.key,
                    version: template.version,
                    asset_family: template.family,
                    asset_class: template.assetClass,
                    title: template.title,
                    description: template.description,
                    template: { components },
                    evidence_reference: template.evidenceReference,
                    evidence_basis: template.evidenceBasis,
                  }),
                "Private draft template recorded.",
              );
            }}
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Boxes className="h-4 w-4 text-signal-cyan" /> Canonical class
              template
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={field}
                placeholder="Template key"
                value={template.key}
                onChange={(e) =>
                  setTemplate({ ...template, key: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Version"
                value={template.version}
                onChange={(e) =>
                  setTemplate({ ...template, version: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Asset family"
                value={template.family}
                onChange={(e) =>
                  setTemplate({ ...template, family: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Asset class"
                value={template.assetClass}
                onChange={(e) =>
                  setTemplate({ ...template, assetClass: e.target.value })
                }
              />
            </div>
            <input
              className={field}
              placeholder="Title"
              value={template.title}
              onChange={(e) =>
                setTemplate({ ...template, title: e.target.value })
              }
            />
            <input
              className={field}
              placeholder="Description"
              value={template.description}
              onChange={(e) =>
                setTemplate({ ...template, description: e.target.value })
              }
            />
            <textarea
              className={`${field} min-h-28 font-mono text-xs`}
              aria-label="Components JSON"
              placeholder='Components JSON, e.g. [{"name":"bearing assembly"}]'
              value={template.components}
              onChange={(e) =>
                setTemplate({ ...template, components: e.target.value })
              }
            />
            <input
              className={field}
              placeholder="Evidence reference"
              value={template.evidenceReference}
              onChange={(e) =>
                setTemplate({ ...template, evidenceReference: e.target.value })
              }
            />
            <textarea
              className={field}
              placeholder="Evidence basis (minimum 20 characters)"
              value={template.evidenceBasis}
              onChange={(e) =>
                setTemplate({ ...template, evidenceBasis: e.target.value })
              }
            />
            <button
              disabled={busy !== null}
              className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-industrial-black disabled:opacity-50"
            >
              {busy === "template" ? "Recording…" : "Record private draft"}
            </button>
          </form>

          <form
            className="glass space-y-3 rounded-xl border border-white/6 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                "mapping",
                () =>
                  recordAssetClassGovernance({
                    local_class: mapping.localClass,
                    catalogue_class: mapping.catalogueClass,
                    template_key:
                      mapping.fit === "none" ? null : mapping.templateKey,
                    fit: mapping.fit,
                    rationale: mapping.rationale,
                    source: mapping.source,
                    evidence_basis: mapping.evidenceBasis,
                  }),
                "Class vocabulary and twin mapping recorded.",
              );
            }}
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <GitMerge className="h-4 w-4 text-signal-cyan" /> Class vocabulary
              and twin fit
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={field}
                placeholder="Local class"
                value={mapping.localClass}
                onChange={(e) =>
                  setMapping({ ...mapping, localClass: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Canonical catalogue class"
                value={mapping.catalogueClass}
                onChange={(e) =>
                  setMapping({ ...mapping, catalogueClass: e.target.value })
                }
              />
              <select
                className={field}
                value={mapping.fit}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    fit: e.target.value as typeof mapping.fit,
                  })
                }
              >
                <option value="direct">Direct fit</option>
                <option value="approximate">Approximate fit</option>
                <option value="none">No safe template</option>
              </select>
              <select
                className={field}
                disabled={mapping.fit === "none"}
                value={mapping.templateKey}
                onChange={(e) =>
                  setMapping({ ...mapping, templateKey: e.target.value })
                }
              >
                <option value="">Select reviewed template</option>
                {data.available_templates.map((item) => (
                  <option
                    key={`${item.template_key}-${item.version}`}
                    value={item.template_key}
                  >
                    {item.template_key} · {item.version} · {item.maturity}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              className={field}
              placeholder="Fit rationale (minimum 20 characters)"
              value={mapping.rationale}
              onChange={(e) =>
                setMapping({ ...mapping, rationale: e.target.value })
              }
            />
            <input
              className={field}
              placeholder="Controlled source reference"
              value={mapping.source}
              onChange={(e) =>
                setMapping({ ...mapping, source: e.target.value })
              }
            />
            <textarea
              className={field}
              placeholder="Evidence basis"
              value={mapping.evidenceBasis}
              onChange={(e) =>
                setMapping({ ...mapping, evidenceBasis: e.target.value })
              }
            />
            <button
              disabled={busy !== null}
              className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-industrial-black disabled:opacity-50"
            >
              {busy === "mapping" ? "Recording…" : "Record governed mapping"}
            </button>
          </form>

          <form
            className="glass space-y-3 rounded-xl border border-white/6 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                "numbering",
                () =>
                  recordUnitNumberingRule({
                    number_prefix: numbering.prefix,
                    expected_class: numbering.expectedClass,
                    manufacturer: numbering.manufacturer,
                    model: numbering.model,
                    ambiguity_note: numbering.ambiguity,
                    source: numbering.source,
                    effective_from: numbering.effectiveFrom,
                    evidence_basis: numbering.evidenceBasis,
                  }),
                "Unit-numbering rule recorded.",
              );
            }}
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Hash className="h-4 w-4 text-signal-cyan" /> Equipment naming
              rule
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={field}
                placeholder="Number prefix"
                value={numbering.prefix}
                onChange={(e) =>
                  setNumbering({ ...numbering, prefix: e.target.value })
                }
              />
              <input
                type="date"
                className={field}
                value={numbering.effectiveFrom}
                onChange={(e) =>
                  setNumbering({ ...numbering, effectiveFrom: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Expected class (optional)"
                value={numbering.expectedClass}
                onChange={(e) =>
                  setNumbering({ ...numbering, expectedClass: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Manufacturer (only if proven)"
                value={numbering.manufacturer}
                onChange={(e) =>
                  setNumbering({ ...numbering, manufacturer: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Model (only if proven)"
                value={numbering.model}
                onChange={(e) =>
                  setNumbering({ ...numbering, model: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Ambiguity note"
                value={numbering.ambiguity}
                onChange={(e) =>
                  setNumbering({ ...numbering, ambiguity: e.target.value })
                }
              />
            </div>
            <input
              className={field}
              placeholder="Controlled source reference"
              value={numbering.source}
              onChange={(e) =>
                setNumbering({ ...numbering, source: e.target.value })
              }
            />
            <textarea
              className={field}
              placeholder="Evidence basis"
              value={numbering.evidenceBasis}
              onChange={(e) =>
                setNumbering({ ...numbering, evidenceBasis: e.target.value })
              }
            />
            <button
              disabled={busy !== null}
              className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-industrial-black disabled:opacity-50"
            >
              {busy === "numbering" ? "Recording…" : "Record numbering rule"}
            </button>
          </form>

          <div className="glass space-y-3 rounded-xl border border-white/6 p-5">
            <h3 className="text-sm font-semibold text-white">
              Preview, apply and provision
            </h3>
            <p className="text-xs leading-5 text-slate-400">
              Preview first. Application only fills blank identity fields. Twin
              provisioning uses reviewed templates and creates draft instances
              only.
            </p>
            <textarea
              className={field}
              placeholder="Named-human basis required for Apply actions"
              value={actionBasis}
              onChange={(e) => setActionBasis(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "number-preview",
                    () => runGovernedUnitNumbering(false, ""),
                    "Numbering preview complete.",
                  )
                }
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300"
              >
                Preview numbering
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "number-apply",
                    () => runGovernedUnitNumbering(true, actionBasis),
                    "Numbering applied.",
                  )
                }
                className="rounded-lg border border-signal-cyan/30 px-3 py-2 text-xs text-signal-cyan"
              >
                Apply blank fields
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "twin-preview",
                    () => runGovernedTwinProvisioning(false, ""),
                    "Twin preview complete.",
                  )
                }
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300"
              >
                Preview draft twins
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "twin-apply",
                    () => runGovernedTwinProvisioning(true, actionBasis),
                    "Draft twins provisioned.",
                  )
                }
                className="rounded-lg border border-signal-cyan/30 px-3 py-2 text-xs text-signal-cyan"
              >
                Provision draft twins
              </button>
            </div>
          </div>
        </div>
      )}

      {data.templates.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">
              Tenant-private template reviews
            </h3>
            {data.can_manage && (
              <input
                className={`${field} max-w-xl`}
                placeholder="Independent review basis"
                value={reviewBasis}
                onChange={(e) => setReviewBasis(e.target.value)}
              />
            )}
          </div>
          {data.templates.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/6 p-4"
            >
              <div>
                <p className="text-sm font-medium text-slate-100">
                  {item.template_key} · {item.version} · {item.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.asset_family} / {item.asset_class} ·{" "}
                  {item.component_count} components · {item.maturity} ·{" "}
                  {item.review_outcome} · private
                </p>
              </div>
              {data.can_manage && item.review_outcome === "pending" && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `review-${item.id}`,
                        () =>
                          reviewTenantTwinTemplate(
                            item.id,
                            "engineer_reviewed",
                            reviewBasis,
                          ),
                        "Template independently reviewed.",
                      )
                    }
                    className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-300"
                  >
                    Engineer reviewed
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `reject-${item.id}`,
                        () =>
                          reviewTenantTwinTemplate(
                            item.id,
                            "rejected",
                            reviewBasis,
                          ),
                        "Template rejected; create a new version to revise it.",
                      )
                    }
                    className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="text-sm font-semibold text-white">Numbering rules</h3>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            {data.numbering_rules.map((rule) => (
              <li key={rule.id}>
                <span className="font-mono text-slate-200">
                  {rule.number_prefix}*
                </span>{" "}
                → {rule.expected_class ?? "class not asserted"}
                {rule.manufacturer ? ` · ${rule.manufacturer}` : ""}
                {rule.model ? ` ${rule.model}` : ""} · {rule.source}
              </li>
            ))}
            {data.numbering_rules.length === 0 && <li>No rules recorded.</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="text-sm font-semibold text-white">Class mappings</h3>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            {data.class_mappings.map((item) => (
              <li key={item.local_class}>
                <span className="text-slate-200">{item.local_class}</span> →{" "}
                {item.catalogue_class} · {item.fit}
                {item.template_key ? ` · ${item.template_key}` : " · no twin"}
              </li>
            ))}
            {data.class_mappings.length === 0 && <li>No mappings recorded.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
