# Open-source and third-party software policy

## Objective

SyncAI may use third-party software when its terms are identified, compatible
with the intended hosting/distribution model, and retained in the dependency
inventory. Passing the automated check is an engineering control, not a legal
opinion.

## Automated baseline

Every pull request must keep `package-lock.json` reproducible and pass:

- No dependency package instance with missing license metadata.
- No automated match for AGPL, GPL, LGPL, SSPL, BUSL/BSL, Elastic License 2.0,
  or Commons Clause identifiers.
- Manual notice review for MPL-2.0, CC-BY-4.0, OFL-1.1, and any license not
  already approved by counsel.
- Generation of a CycloneDX SBOM.
- GitHub Dependabot vulnerability alerts and automated security updates for
  the committed lockfile.

License expressions and package metadata can be incomplete or inaccurate.
Source code, bundled assets, fonts, model weights, datasets, APIs, copied
snippets, and container images require review even when they are not in npm's
lockfile.

## Approval rule

New direct dependencies and new license families require pull-request evidence
of purpose, source, version, license, distribution impact, maintenance health,
security posture, and replacement/removal path. Copyleft, source-available,
non-commercial, field-of-use, data/model, or ambiguous terms require written
counsel approval before use in production or distribution.

Required attributions and license texts must travel with every distributed
artifact where the applicable license requires them. SaaS operation must not be
assumed to avoid all obligations.

## Outbound licensing

No SyncAI source, model, dataset, documentation, or brand asset may be released
under an open-source license without written approval from the IP owner and
counsel. An approved release should use a separate repository or an explicitly
defined directory boundary, a clean provenance review, a selected SPDX license,
its own notices, and a publication checklist. Adding a license file to an
existing repository is a substantive legal change, not a formatting task.

## Exceptions

Exceptions need a named business owner, package/version scope, counsel decision,
mitigation, expiry/review date, and removal plan. They must not be encoded by
weakening the automated prohibited list without the same written approval.

**2026-09-06 — Meet Sync vendor trees (Orville Davis, founder unlock).**
Attributed source under `third_party/jaredrhod/` (AGPL-3.0-or-later and
CC BY-SA 4.0) is an explicit exception to the “no AGPL in the product”
engineering lock. The npm lockfile prohibited-license check is unchanged.
Mitigation: LICENSE notices preserved, corresponding source is this public
tree, personality remains Sync / recommend≠authorize. Counsel review of the
SaaS source-offer obligation is still required. Review: keep until counsel
records a different instruction.
