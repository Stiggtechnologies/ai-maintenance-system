# Source provenance procedure

The Git history is the canonical technical provenance record. It must be
combined with contracts and identity verification before making a chain-of-title
representation.

## Snapshot findings

The GitHub contributor snapshot on 2026-08-22 listed:

| Identity            | Contributions reported | Classification                                                                           |
| ------------------- | ---------------------: | ---------------------------------------------------------------------------------------- |
| `Stiggtechnologies` |                    587 | Repository owner; entity assignment still requires documentary evidence                  |
| `claude`            |                     38 | AI/vendor-associated contribution identity; review applicable terms and human acceptance |
| `dependabot[bot]`   |                      5 | Automated dependency updates governed by upstream licenses and review history            |

The audit found no repository commits, pull requests, issues, or Actions runs
attributable to the formerly listed collaborators `ukardesubodh-hash` or
`Sashikanth-K`. Absence in these GitHub surfaces does not prove that a person
never viewed or copied public code.

## Required review for every material contribution source

1. Export commit authors, committers, signed status, co-authors, pull-request
   authors, reviewers, and merge actors.
2. Normalize aliases without deleting the original Git identity.
3. Map each human identity to an employee, contractor, founder, vendor, or
   customer agreement and its effective dates.
4. Review generated/copied code for upstream source, license, notices, and
   compatibility with the proprietary product.
5. Record exceptions in the diligence data room with counsel disposition.
6. Require future pull requests to confirm provenance, licensing, secrets, and
   third-party obligations using the repository template.

## Evidence integrity

Do not squash or rewrite old commits solely to normalize identities, remove the
former MIT license, or conceal AI-assisted work. Correct the record prospectively
and preserve the original object IDs. Require signed commits or verified web
sign-off for future work where practical, but do not describe historical
unsigned commits as fraudulent without additional evidence.
