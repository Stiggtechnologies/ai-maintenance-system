# Investor diligence evidence

This directory is the technical evidence pack for SyncAI's source-code
ownership, licensing boundary, repository access, and software supply chain as
of 2026-08-22. It is designed for repeatable diligence, but it is not legal,
tax, or investment advice.

## Current conclusion

- The current code line is proprietary and the package is marked
  `UNLICENSED`.
- The former MIT-licensed history is preserved, not revoked. The permanent tag
  `legacy-mit-final-2026-08-22` identifies the final canonical `main` commit
  before the licensing transition.
- The repository is private. No direct collaborators other than
  `Stiggtechnologies`, no pending invitations, no deploy keys, no repository
  webhooks, and no GitHub forks were found in the 2026-08-22 API audit.
- Anonymous copying while the repository was public cannot be attributed or
  recalled. GitHub traffic data establishes exposure volume, not identity or
  downstream use.
- A redacted Gitleaks 8.24.3 audit now reports zero findings in the current
  working tree. The full history still contains reviewed findings, including
  old credential-exposure records; provider-side rotation is not proven by a
  clean current tree.
- The current private-repository plan does not expose all desired GitHub
  controls. Branch protection, private-repository CodeQL/code scanning, and
  GitHub-native secret scanning remain upgrade-dependent.

## Evidence map

| File                         | Purpose                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `mit-license-incident.md`    | Timeline, exposure evidence, limitations, and preserved boundary              |
| `access-control-report.md`   | Access, deployment, and current/historical secret-scan disposition            |
| `ip-asset-register.md`       | Technical asset inventory and ownership evidence gaps                         |
| `source-provenance.md`       | Commit/contributor provenance and review procedure                            |
| `open-source-policy.md`      | Dependency and outbound-licensing policy                                      |
| `open-core-boundary.md`      | Current product boundary and future publication rules                         |
| `open-source-inventory.md`   | Generated human-readable dependency inventory                                 |
| `open-source-inventory.json` | Generated machine-readable dependency inventory                               |
| `sbom.cdx.json`              | CycloneDX SBOM generated from the lockfile                                    |
| `residual-actions.md`        | Actions that require the owner, counsel, a trusted reviewer, or a plan change |

## Reproduction

Run the following from the repository root:

```sh
npm ci
npm run compliance:check
npm run --silent compliance:sbom > docs/investor-diligence/sbom.cdx.json
```

The generated dependency inventory is bound to the SHA-256 of
`package-lock.json`. CI repeats the governance, inventory, and SBOM checks on
pull requests and on `main`. Live vulnerability monitoring is provided by
GitHub Dependabot alerts and automated security updates; the CI workflow does
not send the private dependency inventory to an additional registry audit
endpoint.

## Evidence-handling rule

Do not rewrite or delete historical commits, the legacy tag, or this incident
record to make the history appear cleaner. New facts should be added with a
date, source, and reviewer. Secrets, personal access tokens, IP addresses, and
private customer data must not be added to this directory.
