# MIT licensing and public-exposure record

Status: contained for future revisions; historical rights and anonymous copies
cannot be recalled.

This document records technical facts observed on 2026-08-22. Legal
interpretation and any external notice or enforcement decision belong to
qualified counsel.

## Timeline

| Event             | Evidence                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-21        | Pull request #48 added the MIT `LICENSE` in commit `ca6be08f817f83bd595c4776bcb46b819021e398`. The GitHub record showed `Stiggtechnologies` as author and merger, no submitted reviews, and no verified commit signature. |
| Before 2026-08-22 | The repository was public and its default branch carried the MIT license. Public readers could clone, fork outside GitHub, download archives, or otherwise retain copies without identifying themselves.                  |
| 2026-08-22        | The repository was changed to private. An unauthenticated request subsequently returned `404`, confirming that anonymous repository access was no longer available.                                                       |
| 2026-08-22        | Annotated tag `legacy-mit-final-2026-08-22` was created and pushed at `4e560153f72d80e4619d22b33a1b87706c45e5f4`, the final canonical `main` commit under the former root MIT license.                                    |
| 2026-08-22        | Draft pull request #258 began the forward-looking proprietary boundary by replacing the root license notice, setting the npm package to `UNLICENSED`, adding `NOTICE`, and adding governance controls.                    |

The historical MIT license blob has Git object ID
`99cf4aec6f16901ccce2749d453fab9692d7002e`. Preserving these identifiers makes
the transition auditable and avoids implying that previously granted rights
were retroactively revoked.

## Exposure evidence

GitHub's 14-day traffic window for 2026-08-08 through 2026-08-21 reported:

- 5,265 clones from 892 unique clone sources.
- 1,368 clones from 275 unique sources on 2026-08-21.
- 7 repository views from 4 unique viewers.

GitHub reported zero GitHub-network forks at the audit time. That does not rule
out local clones, downloaded archives, mirrors, or copies hosted elsewhere.
Clone traffic does not identify the people or organizations behind the source
counts and does not prove that every clone was a person: automated deployments
and integrations can clone repeatedly. The repository also showed 2,843
Vercel-created deployments, including 1,246 between 2026-08-08 and 2026-08-21,
which is a plausible source of part of the clone volume but cannot be mapped
one-for-one from the available data.

At privacy transition, 211 pre-existing remote branches and 16 open pull
requests were observed. Git does not record branch creation time, so these refs
are conservatively treated as potentially visible before privatization unless
separate evidence proves otherwise. They should not be deleted merely to
reduce the count; deletion would not recall external copies and could remove
useful provenance.

## Attribution findings

- Direct collaborator audit: only `Stiggtechnologies`.
- Pending repository invitations: none.
- Deploy keys and repository webhooks: none found.
- Repository activity search found no commits, pull requests, issues, or
  Actions runs attributable to `ukardesubodh-hash` or `Sashikanth-K`.
- Historical contributor counts visible in GitHub were `Stiggtechnologies`
  (587), `claude` (38), and `dependabot[bot]` (5). Counts are a snapshot, not a
  legal ownership conclusion.

## What this record does and does not establish

It establishes an auditable technical boundary for future revisions and
records the limits of GitHub's evidence. It does not prove that no third party
copied the repository, identify anonymous cloners, revoke valid historical MIT
rights, prove corporate ownership of every contribution, or determine whether
a trademark, patent, contract, or confidentiality claim applies.

## Preserved evidence

Keep the following indefinitely:

- The Git repository and pull-request metadata.
- Tag `legacy-mit-final-2026-08-22` and its annotated tag object.
- Commit `ca6be08f817f83bd595c4776bcb46b819021e398` and MIT blob
  `99cf4aec6f16901ccce2749d453fab9692d7002e`.
- GitHub audit exports, billing records, contractor/employee agreements, and
  applicable AI-service terms, stored outside the source repository when they
  contain personal or confidential data.

## Counsel decisions

Counsel should confirm the effectiveness of the forward-looking license,
chain of title between each contributor and the fundraising entity, any
contractor invention assignments, the treatment of prior MIT recipients,
trademark ownership, and whether any targeted notice or enforcement response
is appropriate. No external allegation should be made from clone counts alone.
