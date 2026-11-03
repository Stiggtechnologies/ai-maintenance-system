import { useState } from "react";
import { Globe2 } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import {
  bindTenantResidencyPath,
  declareTenantResidency,
  getTenantResidency,
  type ResidencyPathKind,
} from "../services/dataResidencyService";

const pathKinds: ResidencyPathKind[] = [
  "storage",
  "processing",
  "connector",
  "ai_provider",
];

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-black px-3 py-2 text-sm text-industrial-text placeholder:text-slate-600 focus:border-signal-cyan focus:outline-none";

export function DataResidencyPanel() {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canGovern = role === "admin" || role === "executive";
  const register = useAsyncData(
    () => (canGovern ? getTenantResidency() : Promise.resolve(null)),
    [canGovern],
  );
  const [region, setRegion] = useState("");
  const [basis, setBasis] = useState("");
  const [pathKind, setPathKind] = useState<ResidencyPathKind>("storage");
  const [pathRef, setPathRef] = useState("");
  const [pathBasis, setPathBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canGovern) return null;
  if (register.loading) {
    return (
      <div className="rounded-xl border border-white/6 p-4 text-xs text-slate-400">
        Loading data residency…
      </div>
    );
  }
  if (register.error) {
    return (
      <div className="rounded-xl border border-rose-500/20 p-4 text-xs text-rose-200">
        Data residency is unavailable: {register.error}
      </div>
    );
  }

  const workspace = register.data;
  const declaration = workspace?.declaration ?? null;
  const bindings = workspace?.bindings ?? [];
  const decisions = workspace?.decisions ?? [];
  const regionReady =
    /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(region.trim().toLowerCase()) &&
    basis.trim().length >= 30;
  const bindReady =
    declaration !== null &&
    pathRef.trim().length >= 2 &&
    pathBasis.trim().length >= 30;

  const act = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(message);
      await register.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="glass rounded-xl border border-white/6 p-6 max-w-3xl"
      aria-label="Data residency"
    >
      <div className="flex items-start gap-2">
        <Globe2 className="mt-0.5 h-4 w-4 text-signal-cyan" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold text-industrial-text">
            Data residency
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {workspace?.boundary ||
              "A declared region is enforced on storage, processing, connectors and AI-provider calls. A missing declaration or a path bound to another region is refused."}{" "}
            This does not authorize plant action.
          </p>
        </div>
      </div>

      {declaration ? (
        <p className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-slate-200">
          Current region{" "}
          <span className="font-mono text-industrial-text">
            {declaration.region}
          </span>{" "}
          · v{declaration.version}
          {declaration.declaredByLabel
            ? ` · declared by ${declaration.declaredByLabel}`
            : ""}
        </p>
      ) : (
        <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          No residency region is declared. Storage uploads, processing routes,
          connector transfers and AI-provider calls are refused.
        </p>
      )}

      <div className="mt-4 grid gap-2">
        {bindings.map((binding) => (
          <div
            key={binding.id}
            className="rounded-lg border border-white/8 p-3 text-xs"
          >
            <p className="font-mono text-slate-100">
              {binding.pathKind.replaceAll("_", " ")} · {binding.pathRef}
            </p>
            <p className="mt-1 text-slate-400">
              v{binding.version} · {binding.region}
            </p>
          </div>
        ))}
      </div>

      <form
        className="mt-4 grid gap-2 border-t border-white/8 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!regionReady) return;
          void act(
            () =>
              declareTenantResidency(region.trim().toLowerCase(), basis.trim()),
            `Residency region ${region.trim().toLowerCase()} declared.`,
          );
        }}
      >
        <label className="text-xs text-slate-400" htmlFor="residency-region">
          Residency region
        </label>
        <input
          id="residency-region"
          className={inputClass}
          aria-label="Residency region"
          placeholder="canada-central"
          value={region}
          onChange={(event) => setRegion(event.target.value.toLowerCase())}
        />
        <textarea
          className={inputClass}
          aria-label="Residency declaration basis"
          placeholder="Why this region is the tenant boundary (at least 30 characters)"
          value={basis}
          onChange={(event) => setBasis(event.target.value)}
        />
        <button
          type="submit"
          disabled={!regionReady || busy}
          className="justify-self-start rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-medium text-signal-cyan disabled:opacity-40"
        >
          Declare residency region
        </button>
      </form>

      <form
        className="mt-4 grid gap-2 border-t border-white/8 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!bindReady) return;
          void act(
            () =>
              bindTenantResidencyPath(
                pathKind,
                pathRef.trim(),
                pathBasis.trim(),
              ),
            `Bound ${pathKind} ${pathRef.trim().toLowerCase()} to ${declaration?.region}.`,
          );
        }}
      >
        <p className="text-xs text-slate-400">
          Bind a path to the current region. A different region is refused.
        </p>
        <select
          className={inputClass}
          aria-label="Residency path kind"
          value={pathKind}
          onChange={(event) =>
            setPathKind(event.target.value as ResidencyPathKind)
          }
        >
          {pathKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          aria-label="Residency path reference"
          placeholder="Bucket, route, connector key, or provider host"
          value={pathRef}
          onChange={(event) => setPathRef(event.target.value.toLowerCase())}
        />
        <textarea
          className={inputClass}
          aria-label="Residency binding basis"
          placeholder="Why this path is inside the declared region"
          value={pathBasis}
          onChange={(event) => setPathBasis(event.target.value)}
        />
        <button
          type="submit"
          disabled={!bindReady || busy}
          className="justify-self-start rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-40"
        >
          Bind path
        </button>
      </form>

      {decisions.length > 0 ? (
        <ul className="mt-4 space-y-1 text-xs text-slate-400">
          {decisions.map((decision, index) => (
            <li key={`${decision.at}-${index}`}>
              {decision.allowed ? "allowed" : "refused"} · {decision.pathKind}{" "}
              {decision.pathRef} · {decision.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? (
        <p className="mt-3 text-xs text-emerald-300">{notice}</p>
      ) : null}
      {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}
    </section>
  );
}
