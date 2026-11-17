/**
 * OpsCoordination — equipment release, return-to-service and production loss
 * (capability register E3.05, E3.06, C6.04).
 *
 * The handover between operations and maintenance is where people get hurt. It
 * is a two-sided transaction — operations releases the equipment and later
 * accepts it back only after independently released return-to-service test
 * evidence is available.
 *
 * The state this panel exists to surface is "returned but not accepted": the
 * equipment sits in neither party's hands while each assumes the other owns
 * it. Closing that out silently is how it stays invisible.
 *
 * The final act binds the exact canonical equipment release to the canonical
 * Quality acceptance test and its verified evidence. The server rechecks the
 * tenant, asset, work order, outcome, punch items, human provenance and
 * separation of duties; the list rendered here grants no authority.
 *
 * Production loss is measured against the rate each asset actually
 * demonstrated while running, never nameplate. Nameplate overstates loss
 * systematically, and an overstated loss is a number that will not survive
 * the meeting where it matters.
 */
import { HandCoins, ArrowLeftRight, Hourglass } from "lucide-react";
import { useState } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getOpsCoordination,
  returnEquipmentToOperations,
  verifyAndAcceptEquipment,
  type EquipmentRelease,
  type OpsCoordinationPayload,
} from "../services/opsCoordinationService";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

export function OpsCoordination() {
  const { data, loading, error, refetch } =
    useAsyncData<OpsCoordinationPayload>(getOpsCoordination, []);

  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedTests, setSelectedTests] = useState<Record<string, number>>(
    {},
  );

  const returnToOperations = async (release: EquipmentRelease) => {
    const note = window.prompt(
      "Returning this equipment to operations. Record its condition, restoration state and outstanding limitations (20 characters minimum):",
    );
    if (!note) return;
    setBusy(true);
    try {
      await returnEquipmentToOperations({
        assetId: release.asset_id,
        note,
      });
      setFlash(
        "Returned to operations. It remains out of service until governed verification and operations acceptance are recorded.",
      );
      refetch();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const acceptIntoService = async (release: EquipmentRelease) => {
    const acceptanceTestId =
      selectedTests[release.release_id] ?? release.eligible_rts_tests[0]?.id;
    if (!acceptanceTestId) {
      setFlash(
        "No eligible return-to-service acceptance test is available for this release.",
      );
      return;
    }
    const note = window.prompt(
      "Record what operations independently confirmed against the selected released test (20 characters minimum):",
    );
    if (!note) return;
    setBusy(true);
    try {
      await verifyAndAcceptEquipment({
        releaseId: release.release_id,
        acceptanceTestId,
        note,
      });
      setFlash(
        "Verified and accepted back into service with immutable test and evidence provenance.",
      );
      refetch();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading operations coordination" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const releases = data?.open_releases ?? [];
  const awaiting = releases.filter((r) => r.awaiting_acceptance).length;
  const loss = data?.production_loss;
  const lossRows = loss?.by_asset ?? [];

  return (
    <section aria-labelledby="ops-heading" className="space-y-4">
      <div>
        <h2
          id="ops-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ArrowLeftRight className="h-5 w-5 text-signal-cyan" aria-hidden />
          Operations Handover
          <span className="text-xs font-normal text-slate-500">
            {releases.length} open
            {awaiting > 0 && ` · ${awaiting} awaiting acceptance`}
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">{data?.note}</p>
      </div>

      {flash && (
        <p
          role="status"
          className="rounded-xl border border-white/10 bg-overlook-deep/60 px-4 py-3 text-sm text-slate-300"
        >
          {flash}
        </p>
      )}

      {releases.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No equipment is currently released to maintenance. A release is an
          operations act — maintenance cannot release equipment to itself — and
          work carrying a permit or isolation cannot be closed without one.
        </p>
      ) : (
        <ul className="space-y-2">
          {releases.map((r) => (
            <li
              key={r.release_id}
              className={`rounded-xl border p-3.5 ${
                r.awaiting_acceptance
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-white/6 bg-overlook-deep/40"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-slate-200">{r.asset}</p>
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <Hourglass className="h-3 w-3" aria-hidden />
                  {r.hours_out_of_service} h out of service
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {r.awaiting_acceptance ? (
                  <span className="text-amber-300">
                    Returned by maintenance, not yet accepted by operations —
                    the equipment is in neither party&rsquo;s hands.
                  </span>
                ) : (
                  <>Released to maintenance</>
                )}
                {" · "}
                {r.isolation_confirmed
                  ? "isolation confirmed"
                  : "no isolation recorded"}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {r.awaiting_acceptance ? (
                  <>
                    {r.eligible_rts_tests.length > 0 ? (
                      <label className="w-full text-xs text-slate-300">
                        Released return-to-service test
                        <select
                          aria-label={`Return-to-service test for ${r.asset}`}
                          value={
                            selectedTests[r.release_id] ??
                            r.eligible_rts_tests[0].id
                          }
                          onChange={(event) =>
                            setSelectedTests((current) => ({
                              ...current,
                              [r.release_id]: Number(event.target.value),
                            }))
                          }
                          className="mt-1 block w-full rounded-lg border border-white/10 bg-overlook-deep px-2.5 py-2 text-xs text-slate-200"
                        >
                          {r.eligible_rts_tests.map((test) => (
                            <option key={test.id} value={test.id}>
                              {test.test_ref} · {test.performed_on}
                            </option>
                          ))}
                        </select>
                        <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                          {
                            r.eligible_rts_tests.find(
                              (test) =>
                                test.id ===
                                (selectedTests[r.release_id] ??
                                  r.eligible_rts_tests[0].id),
                            )?.evidence_description
                          }
                        </span>
                      </label>
                    ) : (
                      <p className="w-full rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-amber-200">
                        No eligible return-to-service acceptance test exists.
                        Record the test with verified same-asset evidence, then
                        have an independent authority release it in Risk →
                        Quality assurance.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busy || r.eligible_rts_tests.length === 0}
                      onClick={() => void acceptIntoService(r)}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300 disabled:opacity-50"
                    >
                      Accept back into service
                    </button>
                    {r.returned_by_me && (
                      <span className="text-xs text-slate-500">
                        You returned this one — someone else in operations must
                        accept it.
                      </span>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void returnToOperations(r)}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 disabled:opacity-50"
                  >
                    Return to operations
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="pt-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <HandCoins className="h-4.5 w-4.5 text-signal-gold" aria-hidden />
          Production loss attributable to equipment
          <span className="font-mono text-[10px] text-slate-600">C6.04</span>
        </h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
          {loss?.basis}
        </p>
      </div>

      {lossRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">
              Production loss by asset over the last {loss?.window_days} days
            </caption>
            <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Asset
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Down hours
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Demonstrated rate
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Units lost
                </th>
              </tr>
            </thead>
            <tbody>
              {lossRows.map((r) => (
                <tr key={r.asset} className="border-t border-white/6">
                  <td className="px-4 py-2.5 text-slate-200">{r.asset}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {r.down_hours}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-400 tabular-nums">
                    {r.demonstrated_rate} {r.unit_of_measure}/h
                  </td>
                  <td className="px-4 py-2.5 font-mono text-amber-300 tabular-nums">
                    {r.units_lost.toLocaleString()} {r.unit_of_measure}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
