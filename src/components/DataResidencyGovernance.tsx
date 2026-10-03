import { useEffect, useMemo, useState } from "react";
import { Database, Loader2, MapPin, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  configureDeploymentResidency,
  getDataResidencyWorkspace,
  recordDeploymentDataLocation,
  REQUIRED_RESIDENCY_PLANES,
  setDeploymentEnvironment,
  verifyDeploymentDataLocation,
  verifyDeploymentResidency,
} from "../services/dataResidencyService";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-black px-3 py-2 text-sm text-industrial-text placeholder:text-slate-600 focus:border-signal-cyan focus:outline-none";
const split = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export function DataResidencyGovernance() {
  const workspace = useAsyncData(getDataResidencyWorkspace);
  const [deploymentId, setDeploymentId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [policy, setPolicy] = useState({
    jurisdictions: "",
    countries: "",
    regions: "",
    classes: "operational, maintenance, identity",
    authority: "",
    crossBorder: "",
    basis: "",
  });
  const [location, setLocation] = useState({
    key: "",
    plane: "application",
    provider: "",
    service: "",
    region: "",
    country: "",
    activities: "store, process",
    classes: "operational",
    evidence: "",
    basis: "",
  });
  const [verificationBasis, setVerificationBasis] = useState("");
  const [transitionBasis, setTransitionBasis] = useState("");

  useEffect(() => {
    if (!deploymentId && workspace.data?.deployments[0]) {
      setDeploymentId(workspace.data.deployments[0].id);
    }
  }, [deploymentId, workspace.data?.deployments]);

  const selected = useMemo(
    () => workspace.data?.deployments.find((d) => d.id === deploymentId),
    [deploymentId, workspace.data?.deployments],
  );
  const verifiedPlanes = new Set(
    selected?.locations
      .filter((item) => item.status === "verified")
      .map((item) => item.data_plane) ?? [],
  );

  async function run(
    key: string,
    action: () => Promise<unknown>,
    message: string,
  ) {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      setNotice({ ok: true, text: message });
      await workspace.refetch();
    } catch (error) {
      setNotice({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "The server refused the change.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (workspace.loading)
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading residency controls…
      </div>
    );
  if (workspace.error || !workspace.data)
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
        {workspace.error ?? "Residency controls are unavailable."}
      </div>
    );

  const data = workspace.data;

  return (
    <section aria-labelledby="residency-heading" className="space-y-4">
      <div>
        <h2
          id="residency-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <MapPin className="h-5 w-5 text-signal-cyan" /> Data residency &amp;
          sovereignty
        </h2>
        <p className="mt-1 max-w-4xl text-sm text-slate-300">
          Govern the documented processing topology before calling a workspace
          pilot or production. Verification confirms reviewed evidence; it does
          not move data or configure a cloud provider.
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

      {data.deployments.length === 0 ? (
        <div className="rounded-xl border border-white/6 p-5 text-sm text-slate-400">
          Create an evaluation deployment before defining its residency policy.
        </div>
      ) : (
        <>
          <select
            className={input}
            value={deploymentId}
            onChange={(event) => setDeploymentId(event.target.value)}
          >
            {data.deployments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          {selected && (
            <div className="glass rounded-xl border border-white/6 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">{selected.name}</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {selected.deployment_environment} · policy revision{" "}
                    {selected.policy_revision} · {selected.residency_status}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {REQUIRED_RESIDENCY_PLANES.map((plane) => (
                    <span
                      key={plane}
                      className={`rounded-full px-2 py-1 text-[11px] ${verifiedPlanes.has(plane) ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}
                    >
                      {plane.replace("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {data.can_manage && selected && (
            <div className="grid gap-5 xl:grid-cols-2">
              <form
                className="glass space-y-3 rounded-xl border border-white/6 p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    "policy",
                    () =>
                      configureDeploymentResidency(selected.id, {
                        jurisdictions: split(policy.jurisdictions),
                        permitted_countries: split(policy.countries).map((x) =>
                          x.toUpperCase(),
                        ),
                        permitted_regions: split(policy.regions),
                        data_classes: split(policy.classes),
                        authority_reference: policy.authority,
                        cross_border_basis: policy.crossBorder,
                        evidence_basis: policy.basis,
                      }),
                    "A new policy revision was recorded; prior verification is no longer current.",
                  );
                }}
              >
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-signal-gold" /> Version
                  the policy
                </h3>
                <input
                  className={input}
                  placeholder="Jurisdictions, comma-separated"
                  value={policy.jurisdictions}
                  onChange={(e) =>
                    setPolicy({ ...policy, jurisdictions: e.target.value })
                  }
                />
                <input
                  className={input}
                  placeholder="Permitted countries (CA, US)"
                  value={policy.countries}
                  onChange={(e) =>
                    setPolicy({ ...policy, countries: e.target.value })
                  }
                />
                <input
                  className={input}
                  placeholder="Permitted provider regions"
                  value={policy.regions}
                  onChange={(e) =>
                    setPolicy({ ...policy, regions: e.target.value })
                  }
                />
                <input
                  className={input}
                  placeholder="Data classes"
                  value={policy.classes}
                  onChange={(e) =>
                    setPolicy({ ...policy, classes: e.target.value })
                  }
                />
                <input
                  className={input}
                  placeholder="Authority / contract reference"
                  value={policy.authority}
                  onChange={(e) =>
                    setPolicy({ ...policy, authority: e.target.value })
                  }
                />
                <input
                  className={input}
                  placeholder="Cross-border transfer basis, if applicable"
                  value={policy.crossBorder}
                  onChange={(e) =>
                    setPolicy({ ...policy, crossBorder: e.target.value })
                  }
                />
                <textarea
                  className={input}
                  placeholder="Evidence basis (minimum 20 characters)"
                  value={policy.basis}
                  onChange={(e) =>
                    setPolicy({ ...policy, basis: e.target.value })
                  }
                />
                <button
                  disabled={busy !== null}
                  className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-industrial-black disabled:opacity-50"
                >
                  {busy === "policy" ? "Recording…" : "Record policy revision"}
                </button>
              </form>

              <form
                className="glass space-y-3 rounded-xl border border-white/6 p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    "location",
                    () =>
                      recordDeploymentDataLocation(selected.id, {
                        location_key: location.key,
                        data_plane: location.plane,
                        provider: location.provider,
                        service: location.service,
                        region_code: location.region,
                        country_code: location.country.toUpperCase(),
                        processing_activities: split(location.activities),
                        data_classes: split(location.classes),
                        evidence_reference: location.evidence,
                        evidence_basis: location.basis,
                      }),
                    "Location evidence was declared and now requires independent review.",
                  );
                }}
              >
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Database className="h-4 w-4 text-signal-cyan" /> Declare
                  processing location
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className={input}
                    placeholder="Stable location key"
                    value={location.key}
                    onChange={(e) =>
                      setLocation({ ...location, key: e.target.value })
                    }
                  />
                  <select
                    className={input}
                    value={location.plane}
                    onChange={(e) =>
                      setLocation({ ...location, plane: e.target.value })
                    }
                  >
                    {REQUIRED_RESIDENCY_PLANES.map((x) => (
                      <option key={x} value={x}>
                        {x.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  <input
                    className={input}
                    placeholder="Provider"
                    value={location.provider}
                    onChange={(e) =>
                      setLocation({ ...location, provider: e.target.value })
                    }
                  />
                  <input
                    className={input}
                    placeholder="Service"
                    value={location.service}
                    onChange={(e) =>
                      setLocation({ ...location, service: e.target.value })
                    }
                  />
                  <input
                    className={input}
                    placeholder="Provider region code"
                    value={location.region}
                    onChange={(e) =>
                      setLocation({ ...location, region: e.target.value })
                    }
                  />
                  <input
                    className={input}
                    placeholder="Country code"
                    value={location.country}
                    onChange={(e) =>
                      setLocation({ ...location, country: e.target.value })
                    }
                  />
                </div>
                <input
                  className={input}
                  placeholder="Activities: store, process"
                  value={location.activities}
                  onChange={(e) =>
                    setLocation({ ...location, activities: e.target.value })
                  }
                />
                <input
                  className={input}
                  placeholder="Data classes"
                  value={location.classes}
                  onChange={(e) =>
                    setLocation({ ...location, classes: e.target.value })
                  }
                />
                <input
                  className={input}
                  placeholder="Evidence reference"
                  value={location.evidence}
                  onChange={(e) =>
                    setLocation({ ...location, evidence: e.target.value })
                  }
                />
                <textarea
                  className={input}
                  placeholder="Evidence basis (minimum 20 characters)"
                  value={location.basis}
                  onChange={(e) =>
                    setLocation({ ...location, basis: e.target.value })
                  }
                />
                <button
                  disabled={busy !== null || selected.policy_revision === 0}
                  className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-industrial-black disabled:opacity-50"
                >
                  {busy === "location" ? "Recording…" : "Declare location"}
                </button>
              </form>
            </div>
          )}

          {selected && selected.locations.length > 0 && (
            <div className="space-y-2">
              {selected.locations.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/6 p-4"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {item.data_plane.replace("_", " ")} · {item.provider}{" "}
                      {item.service}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.region_code}, {item.country_code} ·{" "}
                      {item.evidence_reference} · {item.status}
                    </p>
                  </div>
                  {data.can_manage && item.status === "declared" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          void run(
                            `verify-${item.id}`,
                            () =>
                              verifyDeploymentDataLocation(
                                item.id,
                                "verified",
                                verificationBasis,
                              ),
                            "Location evidence verified.",
                          )
                        }
                        className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-300"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() =>
                          void run(
                            `reject-${item.id}`,
                            () =>
                              verifyDeploymentDataLocation(
                                item.id,
                                "rejected",
                                verificationBasis,
                              ),
                            "Location evidence rejected.",
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
              {data.can_manage && (
                <textarea
                  className={input}
                  placeholder="Independent verification basis for location or full posture"
                  value={verificationBasis}
                  onChange={(e) => setVerificationBasis(e.target.value)}
                />
              )}
            </div>
          )}

          {data.can_manage && selected && (
            <div className="glass space-y-3 rounded-xl border border-white/6 p-5">
              <h3 className="text-sm font-semibold text-white">
                Verify and promote
              </h3>
              <button
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "verify-policy",
                    () =>
                      verifyDeploymentResidency(selected.id, verificationBasis),
                    "The current six-plane residency posture is verified.",
                  )
                }
                className="rounded-lg border border-signal-cyan/30 px-4 py-2 text-sm text-signal-cyan disabled:opacity-50"
              >
                Verify complete posture
              </button>
              <textarea
                className={input}
                placeholder="Named-human environment transition basis"
                value={transitionBasis}
                onChange={(e) => setTransitionBasis(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {(["evaluation", "pilot", "production"] as const).map(
                  (environment) => (
                    <button
                      key={environment}
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `env-${environment}`,
                          () =>
                            setDeploymentEnvironment(
                              selected.id,
                              environment,
                              transitionBasis,
                            ),
                          `Deployment environment changed to ${environment}.`,
                        )
                      }
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs capitalize text-slate-300 disabled:opacity-50"
                    >
                      {environment}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
