import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  createImplementationCommand,
  implementationStep,
  reconcileImplementation,
  type ImplementationAction,
  type ImplementationCommand,
} from "../../services/implementation/journey";
import {
  ImplementationCommandError,
  loadImplementationResources,
  loadImplementationWorkspace,
  sendImplementationCommand,
  type ImplementationWorkspace,
  type ImplementationJourney,
  type ImplementationResources,
  type ImplementationScope,
} from "../../services/implementation/service";

const EMPTY: ImplementationResources = {
  assets: [],
  templates: [],
  evidence: [],
  runs: [],
};

export function ImplementationJourneyPanel() {
  const [workspace, setWorkspace] = useState<ImplementationWorkspace | null>(
    null,
  );
  const [resources, setResources] = useState(EMPTY);
  const [selected, setSelected] = useState("");
  const [billing, setBilling] = useState("");
  const [outcome, setOutcome] = useState("");
  const [scope, setScope] = useState<ImplementationScope>({
    assets: [],
    runIds: [],
  });
  const [asset, setAsset] = useState("");
  const [template, setTemplate] = useState("");
  const [mapping, setMapping] = useState("");
  const [result, setResult] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [training, setTraining] = useState("");
  const [support, setSupport] = useState("");
  const [statement, setStatement] = useState("");
  const [pending, setPending] = useState<ImplementationCommand | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const readSequence = useRef(0);
  const identity = useRef("");
  const journalKey = useRef("");
  const journey = workspace?.journeys.find((j) => j.id === selected);

  async function reload(epoch = generation.current) {
    const readId = ++readSequence.current;
    let w: ImplementationWorkspace;
    let actorId: string;
    try {
      const { data, error: sessionError } = await supabase.auth.getUser();
      if (sessionError || !data.user)
        throw new Error(
          "Sign in as a named company administrator to continue.",
        );
      actorId = data.user.id;
      w = await loadImplementationWorkspace();
    } catch (e) {
      if (epoch === generation.current && readId === readSequence.current) {
        // A denied or unavailable membership read cannot leave old company data visible.
        setWorkspace(null);
        setResources(EMPTY);
        setSelected("");
        setRecoveryChecked(false);
      }
      throw e;
    }
    if (epoch !== generation.current || readId !== readSequence.current) return;
    const key = `syncai-implementation-intent:${actorId}:${w.organizationId}`;
    const nextIdentity = `${actorId}:${w.organizationId}`;
    if (identity.current && identity.current !== nextIdentity) {
      setResources(EMPTY);
      setSelected("");
      setScope({ assets: [], runIds: [] });
      setOutcome("");
      setStatement("");
      setAsset("");
      setTemplate("");
      setMapping("");
      setResult("");
      setAcceptance("");
      setTraining("");
      setSupport("");
      setBilling("");
      setNotice("");
    }
    identity.current = nextIdentity;
    journalKey.current = key;
    let retained: ImplementationCommand | null = null;
    try {
      retained = JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
      /* invalid draft is ignored */
    }
    if (
      retained?.commandId &&
      w.receipts.some((receipt) => reconcileImplementation(retained!, receipt))
    ) {
      sessionStorage.removeItem(key);
      retained = null;
    }
    setPending(retained);
    setRecoveryChecked(true);
    setWorkspace(w);
    // A later resource read failure cannot undo a known canonical commitment.
    const r = await loadImplementationResources(w.organizationId);
    if (epoch !== generation.current || readId !== readSequence.current) return;
    setResources(r);
    return w;
  }
  useEffect(() => {
    const lifecycle = generation;
    const epoch = ++lifecycle.current;
    void reload(epoch).catch((e) => {
      if (epoch === generation.current) setError(e.message);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_OUT" ||
        event === "SIGNED_IN" ||
        event === "USER_UPDATED"
      ) {
        ++generation.current;
        identity.current = "";
        journalKey.current = "";
        setWorkspace(null);
        setResources(EMPTY);
        setPending(null);
        setRecoveryChecked(false);
        setSelected("");
        setScope({ assets: [], runIds: [] });
        setOutcome("");
        setStatement("");
        setAsset("");
        setTemplate("");
        setMapping("");
        setResult("");
        setAcceptance("");
        setTraining("");
        setSupport("");
        setBilling("");
        setNotice("");
        setError("Account changed. Reload the implementation workspace.");
        setBusy(false);
      }
    });
    return () => {
      ++lifecycle.current;
      listener.subscription.unsubscribe();
    };
  }, []);

  function choose(j: ImplementationJourney) {
    setSelected(j.id);
    setScope(structuredClone(j.scope ?? { assets: [], runIds: [] }));
    setStatement("");
    setResult("");
    setAcceptance("");
    setTraining("");
    setSupport("");
    setNotice("");
  }
  async function submit(
    action: ImplementationAction,
    payload: Record<string, unknown>,
    dryRun = false,
    retry = false,
  ) {
    if (
      !workspace ||
      busy ||
      (pending && !retry) ||
      (retry && (!pending || !recoveryChecked))
    )
      return;
    ++readSequence.current;
    const epoch = generation.current;
    const actor = identity.current;
    const key = journalKey.current;
    const command = retry
      ? pending!
      : createImplementationCommand({
          action,
          payload,
          billingId: action === "start" ? billing : journey!.billingId,
          instanceId: action === "start" ? null : journey!.id,
          revision: action === "start" ? 0 : journey!.revision,
        });
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Storage failure prevents mutation; the exact intent must survive interrupted navigation.
      if (!dryRun) {
        sessionStorage.setItem(key, JSON.stringify(command));
        setPending(command);
        setRecoveryChecked(false);
      }
      const receipt = await sendImplementationCommand(command, dryRun);
      if (epoch !== generation.current || actor !== identity.current) return;
      if (dryRun)
        setNotice(
          "Dry run validated the current scope. No records were written; asset approval and customer acceptance remain separate.",
        );
      else {
        sessionStorage.removeItem(key);
        setPending(null);
        setNotice(
          "Command retained. Reloaded status is the evidence of progress.",
        );
        setSelected(receipt.instanceId);
        const refreshed = await reload(epoch);
        if (epoch === generation.current) {
          const entry = refreshed?.journeys.find(
            (j) => j.id === receipt.instanceId,
          );
          if (entry) choose(entry);
          setNotice(
            "Command retained. Reloaded status is the evidence of progress.",
          );
        }
      }
    } catch (e) {
      if (epoch !== generation.current || actor !== identity.current) return;
      if (
        e instanceof ImplementationCommandError &&
        e.outcome === "refused" &&
        !dryRun
      ) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
      setError(
        e instanceof Error ? e.message : "Implementation request failed.",
      );
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  const disabled = busy || Boolean(pending);
  const evidenceSelect = (
    label: string,
    value: string,
    change: (value: string) => void,
    filter?: (e: ImplementationResources["evidence"][number]) => boolean,
  ) => (
    <label className="block">
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => change(e.target.value)}
        className="block w-full rounded border border-industrial-border bg-industrial-black p-2"
      >
        <option value="">Select verified evidence</option>
        {resources.evidence.filter(filter ?? (() => true)).map((e) => (
          <option key={e.id} value={e.id}>
            {e.description}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section
      aria-label="Customer implementation"
      className="mb-8 space-y-4 rounded-xl border border-industrial-border bg-industrial-slate p-6 text-industrial-text"
    >
      <h2 className="text-xl font-semibold">Implement your subscription</h2>
      <p>
        Subscription activation, asset readiness and customer acceptance are
        separate milestones. This journey uses your authorized customer data and
        retains your intended outcome.
      </p>
      <p>
        New-company provisioning, connector installation and unsupported systems
        require a reviewed human-assisted setup.{" "}
        <Link to="/support" className="underline">
          Contact support
        </Link>
        . No live integration is claimed by this checklist.
      </p>
      <p>
        Preparation draft: mapping references are provisional. First-result
        approval and customer acceptance remain unavailable until the existing
        evidence and asset approval services provide qualified provenance.
      </p>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link className="underline" to="/assets">
          Customer asset register
        </Link>
        <Link className="underline" to="/integrations">
          Mapping, imports and retained rejects
        </Link>
        <Link className="underline" to="/onboarding">
          Asset checklist and human approval
        </Link>
        <Link className="underline" to="/assets/twins">
          Governed twin registry
        </Link>
        <Link className="underline" to="/decision-cases">
          Evidence-backed first result
        </Link>
        <Link className="underline" to="/knowledge">
          Authorized documents
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        type="button"
        disabled={busy}
        className="rounded border px-3 py-2"
        onClick={() => {
          setError("");
          void reload().catch((e) => setError(e.message));
        }}
      >
        Reload retained status
      </button>
      {pending && (
        <div
          role="status"
          className="space-y-2 rounded border border-amber-400 p-3"
        >
          <p>
            An unresolved {pending.action} command is retained. Reload status
            first. Retrying submits the same intent and command identity; it
            does not start another deployment.
          </p>
          <button
            disabled={busy || !recoveryChecked}
            type="button"
            className="rounded border px-3 py-2"
            onClick={() =>
              void submit(pending.action, pending.payload, false, true)
            }
          >
            Retry retained command
          </button>
        </div>
      )}
      {workspace && (
        <>
          <p>
            Verified company membership loaded. Subscription status below comes
            from the existing billing authority.
          </p>
          <label className="block">
            Subscription
            <select
              aria-label="Subscription"
              disabled={disabled}
              value={billing}
              onChange={(e) => setBilling(e.target.value)}
              className="block w-full rounded border bg-industrial-black p-2"
            >
              <option value="">Select subscription</option>
              {workspace.subscriptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.plan} — {b.status} ({b.source})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Intended outcome
            <textarea
              aria-label="Intended outcome"
              maxLength={2000}
              disabled={disabled}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="block w-full rounded border bg-industrial-black p-2"
              placeholder="What measurable first result should this implementation deliver?"
            />
          </label>
          <button
            type="button"
            className="rounded border px-3 py-2"
            disabled={disabled || !billing || !outcome.trim()}
            onClick={() => void submit("start", { outcome })}
          >
            Start or resume purchased implementation
          </button>
          <ul className="space-y-2">
            {workspace.journeys.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border px-3 py-2 text-left"
                  onClick={() => choose(j)}
                >
                  {j.outcome} — {j.phase}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {journey && (
        <>
          <h3 className="text-lg font-semibold">{journey.outcome}</h3>
          <p>{implementationStep(journey.phase, journey.current)}</p>
          {journey.failure && (
            <p role="alert">
              {journey.failure.message} Reference: {journey.failure.code}
            </p>
          )}
          {journey.phase !== "paused" && (
            <>
              <h4 className="font-semibold">Reviewed customer data mapping</h4>
              <p>
                Select existing customer assets, approved class-compatible twins
                and provisional mapping references with an independent verifier
                stamp. Imports remain in the existing integration workspace;
                only clean completed runs can be attached. The first-result
                review must demonstrate this scope supports the stated outcome.
              </p>
              <label className="block">
                Customer asset
                <select
                  aria-label="Customer asset"
                  disabled={disabled}
                  value={asset}
                  onChange={(e) => {
                    setAsset(e.target.value);
                    setTemplate("");
                    setMapping("");
                  }}
                  className="block w-full rounded border bg-industrial-black p-2"
                >
                  <option value="">Select customer asset</option>
                  {resources.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tag} — {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Approved twin template
                <select
                  aria-label="Approved twin template"
                  disabled={disabled}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="block w-full rounded border bg-industrial-black p-2"
                >
                  <option value="">Select approved template</option>
                  {resources.templates
                    .filter(
                      (t) =>
                        t.asset_class ===
                        resources.assets.find((a) => a.id === asset)
                          ?.asset_class,
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
              {evidenceSelect(
                "Verified mapping evidence",
                mapping,
                setMapping,
                (e) => e.asset_id === asset,
              )}
              <button
                type="button"
                className="rounded border px-3 py-2"
                disabled={
                  disabled ||
                  !asset ||
                  !template ||
                  !mapping ||
                  scope.assets.some((a) => a.assetId === asset)
                }
                onClick={() =>
                  setScope({
                    ...scope,
                    assets: [
                      ...scope.assets,
                      {
                        assetId: asset,
                        templateId: template,
                        mappingEvidenceId: mapping,
                      },
                    ],
                  })
                }
              >
                Add mapped asset
              </button>
              <ul>
                {scope.assets.map((a) => (
                  <li key={a.assetId}>
                    {resources.assets.find((r) => r.id === a.assetId)?.name ??
                      "Retained customer asset"}{" "}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setScope({
                          ...scope,
                          assets: scope.assets.filter(
                            (r) => r.assetId !== a.assetId,
                          ),
                        })
                      }
                    >
                      Remove from scope
                    </button>
                  </li>
                ))}
              </ul>
              <fieldset>
                <legend>Completed authorized import runs (optional)</legend>
                {resources.runs.map((r) => (
                  <label key={r.id} className="block">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={scope.runIds.includes(r.id)}
                      onChange={(e) =>
                        setScope({
                          ...scope,
                          runIds: e.target.checked
                            ? [...scope.runIds, r.id]
                            : scope.runIds.filter((id) => id !== r.id),
                        })
                      }
                    />{" "}
                    {r.entity_type}: {r.records_accepted} accepted,{" "}
                    {r.finished_at}
                  </label>
                ))}
              </fieldset>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded border px-3 py-2"
                  disabled={disabled || !scope.assets.length}
                  onClick={() =>
                    void submit(
                      "configure",
                      scope as unknown as Record<string, unknown>,
                      true,
                    )
                  }
                >
                  Dry-run mapping
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-2"
                  disabled={disabled || !scope.assets.length}
                  onClick={() =>
                    void submit(
                      "configure",
                      scope as unknown as Record<string, unknown>,
                    )
                  }
                >
                  Retain reviewed scope
                </button>
              </div>
              {journey.scope && journey.phase !== "accepted" && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="rounded border px-3 py-2"
                    disabled={disabled}
                    onClick={() => void submit("prepare", {}, true)}
                  >
                    Dry-run preparation
                  </button>
                  <button
                    type="button"
                    className="rounded border px-3 py-2"
                    disabled={disabled}
                    onClick={() => void submit("prepare", {})}
                  >
                    Prepare drafts using existing services
                  </button>
                </div>
              )}
              {journey.phase === "prepared" && (
                <>
                  <p role="status">
                    Human-assisted review required. The existing evidence rail
                    does not yet bind verification to immutable reviewed
                    content. First-result approval and implementation acceptance
                    are unavailable until that rail and authenticated asset
                    approval are qualified.
                  </p>
                  {evidenceSelect(
                    "Verified first-result evidence",
                    result,
                    setResult,
                    (e) =>
                      Boolean(
                        e.asset_id &&
                        journey.scope?.assets.some(
                          (a) => a.assetId === e.asset_id,
                        ),
                      ),
                  )}
                  <label className="block">
                    First-result review statement
                    <textarea
                      aria-label="First-result review statement"
                      value={statement}
                      disabled={disabled}
                      onChange={(e) => setStatement(e.target.value)}
                      className="block w-full rounded border bg-industrial-black p-2"
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded border px-3 py-2"
                    disabled={true}
                    onClick={() =>
                      void submit("result", { evidenceId: result, statement })
                    }
                  >
                    First-result approval awaits canonical evidence
                    qualification
                  </button>
                </>
              )}
              {journey.phase === "result_reviewed" && (
                <>
                  <p>
                    Acceptance evidence must record customer acceptance of this
                    outcome. Training and support evidence must record completed
                    training and the agreed support handoff.
                  </p>
                  {evidenceSelect(
                    "Customer acceptance evidence",
                    acceptance,
                    setAcceptance,
                    (e) => e.evidence_type === "customer_acceptance",
                  )}
                  {evidenceSelect(
                    "Completed training evidence",
                    training,
                    setTraining,
                    (e) => e.evidence_type === "training_completion",
                  )}
                  {evidenceSelect(
                    "Support handoff evidence",
                    support,
                    setSupport,
                    (e) => e.evidence_type === "support_handoff",
                  )}
                  <label className="block">
                    Customer acceptance statement
                    <textarea
                      aria-label="Customer acceptance statement"
                      value={statement}
                      disabled={disabled}
                      onChange={(e) => setStatement(e.target.value)}
                      className="block w-full rounded border bg-industrial-black p-2"
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded border px-3 py-2"
                    disabled={
                      disabled ||
                      !acceptance ||
                      !training ||
                      !support ||
                      !statement.trim()
                    }
                    onClick={() =>
                      void submit("accept", {
                        acceptanceEvidenceId: acceptance,
                        trainingEvidenceId: training,
                        supportEvidenceId: support,
                        statement,
                      })
                    }
                  >
                    Accept implementation and handoff
                  </button>
                </>
              )}
              <button
                type="button"
                className="rounded border px-3 py-2"
                disabled={disabled}
                onClick={() => void submit("pause", {})}
              >
                Pause — retain imported data and evidence
              </button>
            </>
          )}
          {(journey.phase === "paused" || journey.phase === "failed") && (
            <button
              type="button"
              className="rounded border px-3 py-2"
              disabled={disabled}
              onClick={() => void submit("resume", {})}
            >
              Resume for fresh review
            </button>
          )}
          <p className="text-sm">
            This workflow grants no operational authority. It creates no starter
            assets, sensors, infrastructure or credentials. A paused journey
            retains imports and evidence; any data correction uses the owning
            service’s reviewed correction process.
          </p>
        </>
      )}
    </section>
  );
}
