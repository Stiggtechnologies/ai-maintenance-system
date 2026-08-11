/**
 * OEM bulletin applicability: which of your machines a manufacturer's notice
 * actually affects (register E12 master data, U3 ontology, C5 change control).
 *
 * WHAT AN OEM BULLETIN IS.
 *
 * Manufacturers publish four things that change what a machine should be:
 *
 *   supersession   — this part number is replaced by that one. A configuration
 *                    change whether or not anybody treats it as one.
 *   improvement    — a Product Improvement Program. Optional, usually.
 *   safety         — a Product Safety Program or recall. Not optional.
 *   service_letter — guidance that changes a procedure or interval.
 *
 * All four are scoped BY SERIAL RANGE, because that is how a manufacturer knows
 * which builds carry the affected part.
 *
 * THE PROBLEM THIS FLEET HAS.
 *
 * Zero of its 144 assets record a serial number. So serial-range applicability —
 * the only precise method — resolves for nothing, and the fallback is matching
 * on model, which is over-broad by construction: it will flag machines built
 * outside the affected range.
 *
 * The engine therefore returns THREE verdicts, not two:
 *
 *   affected           — the serial is inside the range. Actionable.
 *   possibly_affected  — the model matches and the serial is unknown. This is a
 *                        question, not a finding, and must never be counted as
 *                        one.
 *   indeterminate      — neither serial nor model is recorded. The bulletin
 *                        cannot be assessed against this machine at all, which
 *                        is different from it not applying.
 *
 * Collapsing "possibly" into "affected" would produce a safety register full of
 * machines that are fine. Collapsing it into "not affected" would hide a live
 * recall. Both are worse than saying which is which.
 *
 * Pure functions. No database, no network.
 */

export type BulletinKind =
  "supersession" | "improvement" | "safety" | "service_letter";

export interface OemBulletin {
  bulletinRef: string;
  kind: BulletinKind;
  manufacturer: string;
  title: string;
  /** Models the bulletin names. Empty means it did not scope by model. */
  models: string[];
  /** Inclusive serial range, as published. Either end may be open. */
  serialFrom?: string | null;
  serialTo?: string | null;
  /** supersession only. */
  fromPartNumber?: string | null;
  toPartNumber?: string | null;
  mandatory: boolean;
}

export interface AssetForBulletin {
  id: string;
  tag: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
}

export type ApplicabilityVerdict =
  "affected" | "possibly_affected" | "not_affected" | "indeterminate";

export interface Applicability {
  assetId: string;
  assetTag: string | null;
  bulletinRef: string;
  verdict: ApplicabilityVerdict;
  /** How the verdict was reached, so a reader can weigh it. */
  basis:
    "serial_range" | "model_only" | "no_identifiers" | "manufacturer_mismatch";
  reason: string;
}

/**
 * Serial comparison as published: an OEM serial is a build prefix followed by a
 * sequence number (Cat's look like 3KR01234, 7XM00250, JJG00123), and only the
 * numeric part orders within a prefix. Comparing the whole string lexically
 * gets "3KR9" above "3KR10" and would silently exclude machines from a recall.
 *
 * The prefix is ALPHANUMERIC, not alphabetic — "3KR" starts with a digit. An
 * earlier version anchored on /^([A-Z]*)(\d+)$/ and failed to parse every real
 * Cat serial, which made every machine fall back to a model-only match: the
 * failure was invisible because the fallback is a legitimate verdict.
 */
function splitSerial(s: string): { prefix: string; number: number } | null {
  // Lazy prefix so the trailing digit run is taken as the sequence number.
  const m = s
    .trim()
    .toUpperCase()
    .match(/^(.*?)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], number: Number(m[2]) };
}

function withinRange(
  serial: string,
  from?: string | null,
  to?: string | null,
): boolean | null {
  const s = splitSerial(serial);
  if (!s) return null;
  const f = from ? splitSerial(from) : null;
  const t = to ? splitSerial(to) : null;
  // A range across different prefixes is not a range this can evaluate.
  if (f && f.prefix !== s.prefix) return false;
  if (t && t.prefix !== s.prefix) return false;
  if (f && s.number < f.number) return false;
  if (t && s.number > t.number) return false;
  return true;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export function assessApplicability(
  bulletin: OemBulletin,
  asset: AssetForBulletin,
): Applicability {
  const base = {
    assetId: asset.id,
    assetTag: asset.tag,
    bulletinRef: bulletin.bulletinRef,
  };

  if (
    asset.manufacturer &&
    norm(asset.manufacturer) !== norm(bulletin.manufacturer)
  ) {
    return {
      ...base,
      verdict: "not_affected",
      basis: "manufacturer_mismatch",
      reason: `Asset is ${asset.manufacturer}; the bulletin is ${bulletin.manufacturer}.`,
    };
  }

  const modelMatches =
    bulletin.models.length === 0 ||
    bulletin.models.some((m) => norm(m) === norm(asset.model));

  if (!asset.model && !asset.serialNumber) {
    return {
      ...base,
      verdict: "indeterminate",
      basis: "no_identifiers",
      reason: `This machine records neither a model nor a serial number, so the bulletin cannot be assessed against it. That is not the same as it not applying — an unassessable machine is an open question, and for a mandatory bulletin it is an open safety question.`,
    };
  }

  if (!modelMatches) {
    return {
      ...base,
      verdict: "not_affected",
      basis: "model_only",
      reason: `Model ${asset.model} is not among the models the bulletin names.`,
    };
  }

  if (asset.serialNumber) {
    const inRange = withinRange(
      asset.serialNumber,
      bulletin.serialFrom,
      bulletin.serialTo,
    );
    if (inRange === null) {
      return {
        ...base,
        verdict: "possibly_affected",
        basis: "model_only",
        reason: `Serial "${asset.serialNumber}" does not parse as a prefix-and-number, so it cannot be placed in the published range. Falling back to the model match, which is over-broad.`,
      };
    }
    return {
      ...base,
      verdict: inRange ? "affected" : "not_affected",
      basis: "serial_range",
      reason: inRange
        ? `Serial ${asset.serialNumber} falls inside the published range${bulletin.serialFrom ? ` from ${bulletin.serialFrom}` : ""}${bulletin.serialTo ? ` to ${bulletin.serialTo}` : ""}.`
        : `Serial ${asset.serialNumber} falls outside the published range, so this build does not carry the affected part.`,
    };
  }

  return {
    ...base,
    verdict: "possibly_affected",
    basis: "model_only",
    reason:
      `Model matches, serial number not recorded. A manufacturer scopes a bulletin by serial range because only some builds of a model carry the affected part — without one, this can only be narrowed to "a machine of the right type". ` +
      (bulletin.mandatory
        ? `The bulletin is mandatory, so this is an unresolved safety question rather than a maintenance nicety.`
        : `Recording the serial resolves it either way.`),
  };
}

export interface BulletinImpact {
  bulletinRef: string;
  kind: BulletinKind;
  mandatory: boolean;
  affected: Applicability[];
  possiblyAffected: Applicability[];
  indeterminate: Applicability[];
  notAffected: number;
  /** True only when every in-scope machine got a serial-based verdict. */
  conclusive: boolean;
  reason: string;
}

export function assessFleet(
  bulletin: OemBulletin,
  assets: AssetForBulletin[],
): BulletinImpact {
  const results = assets.map((a) => assessApplicability(bulletin, a));
  const affected = results.filter((r) => r.verdict === "affected");
  const possibly = results.filter((r) => r.verdict === "possibly_affected");
  const indeterminate = results.filter((r) => r.verdict === "indeterminate");
  const notAffected = results.filter(
    (r) => r.verdict === "not_affected",
  ).length;

  const conclusive = possibly.length === 0 && indeterminate.length === 0;

  return {
    bulletinRef: bulletin.bulletinRef,
    kind: bulletin.kind,
    mandatory: bulletin.mandatory,
    affected,
    possiblyAffected: possibly,
    indeterminate,
    notAffected,
    conclusive,
    reason:
      `${bulletin.bulletinRef}: ${affected.length} confirmed affected, ${possibly.length} possibly affected, ${indeterminate.length} unassessable, ${notAffected} ruled out. ` +
      (conclusive
        ? `Every machine got a serial-based verdict, so this is a finding rather than a question.`
        : `${possibly.length + indeterminate.length} machine(s) could not be resolved because their serial numbers are not recorded. ` +
          (bulletin.mandatory
            ? `THIS BULLETIN IS MANDATORY. An unresolved machine on a mandatory bulletin is an open safety exposure, not an administrative gap — and the fix is recording serials, which no analysis can substitute for.`
            : `Recording serials would resolve them; until then the count above is an upper bound on what needs doing and a lower bound on what is known.`)),
  };
}

/**
 * A supersession is a configuration change. Turn it into a PROPOSED
 * interchangeability rule — never an approved one, because whether a
 * replacement part is acceptable in a given position is an engineering
 * judgement the manufacturer's catalogue does not make for you.
 */
export interface ProposedInterchange {
  fromPartNumber: string;
  toPartNumber: string;
  bulletinRef: string;
  interchangeKind: "one_way" | "two_way";
  affectedAssetIds: string[];
  reason: string;
}

export function proposeInterchange(
  bulletin: OemBulletin,
  impact: BulletinImpact,
): ProposedInterchange | null {
  if (bulletin.kind !== "supersession") return null;
  if (!bulletin.fromPartNumber || !bulletin.toPartNumber) return null;

  const ids = [...impact.affected, ...impact.possiblyAffected].map(
    (a) => a.assetId,
  );

  return {
    fromPartNumber: bulletin.fromPartNumber,
    toPartNumber: bulletin.toPartNumber,
    bulletinRef: bulletin.bulletinRef,
    // Supersession is directional: the new part replaces the old, and the old
    // does not necessarily replace the new. Recording it as two-way would let
    // somebody fit a superseded part to a machine built for the replacement.
    interchangeKind: "one_way",
    affectedAssetIds: ids,
    reason:
      `${bulletin.fromPartNumber} is superseded by ${bulletin.toPartNumber} per ${bulletin.bulletinRef}, touching ${ids.length} machine(s) (${impact.affected.length} confirmed, ${impact.possiblyAffected.length} possible). ` +
      `Proposed one-way and unapproved: a catalogue states that a replacement exists, not that it is acceptable in every position it appears in. ` +
      (impact.possiblyAffected.length > 0
        ? `The possible ones are included so the change is not under-scoped, and flagged so it is not over-claimed.`
        : ``),
  };
}
