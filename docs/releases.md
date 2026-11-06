# Releasing Herdr

Eligible changes on `main` maintain one Release PR on `auto-release`.
A maintainer reviews and squash-merges or rebases that PR to authorize publication.
The first stable version is `0.1.0`; later proposals default to a patch increase.
A higher maintainer-selected version survives proposal refreshes.

## Repository setup

Install the release GitHub App on `BuddyLabsCo/issue-runner-herdr` with contents
and pull request write permissions. Configure repository secrets `APP_ID` and
`APP_PRIVATE_KEY`. The proposal workflow requests a token scoped to Herdr;
the default workflow token remains read-only. The App token lets Release PRs
trigger the existing Ubuntu and Windows CI checks.

Routine npm publication uses GitHub Actions OpenID Connect (OIDC) on an Ubuntu
GitHub-hosted runner. Configure this package's Trusted Publisher as follows:

| Field | Value |
| --- | --- |
| Package | `issue-runner-herdr` |
| Organization/user | `BuddyLabsCo` |
| Repository | `issue-runner-herdr` |
| Workflow filename | `publish-release.yml` |
| Environment | Empty; this workflow declares none |
| Allowed action | Direct `npm publish` |

No stored npm publication token or second routine approval is required.
The publishing process runs outside the source checkout with isolated user/global
npm configuration and removes token environment variables and npm configuration
overrides. See [npm's Trusted Publisher setup](https://docs.npmjs.com/trusted-publishers/)
for current prerequisites and the initial trust-validation deadline.

## Candidate verification and publication

Release PRs run the existing Ubuntu/Windows checks before merge. Main push CI
uses a lightweight GitHub lookup to skip its test matrix only for the exact
same-repository `auto-release` merge into `main`. Other pushes retain that matrix.

`publish-release` checks out the actual merged commit, installs locked dependencies,
builds once and packs one candidate. Its release script validates the event's
repository, branches, commit ancestry, merge shape, version, lockfile versions,
manifest identity, keywords and package inventory before publication writes.
Merge commits are rejected; squash and rebase merges are supported.

`release:accept` runs the existing package suite with `HERDR_CANDIDATE_TARBALL`
pointing to that candidate. It installs the unchanged archive and exact npm Core
dependency, checks the Herdr executable and combined version output, declarations,
contracts and resources, and relocates a prefix containing spaces before running
from an unrelated directory. It never rebuilds or repacks the supplied archive.
Publication neither reruns full CI nor waits for post-merge main CI.

A successful publication uploads that archive with public access and `latest`,
then creates immutable `v<version>` and the matching GitHub Release.
The separate concurrency groups remain `auto-release-pr` and `publish-release`.

## First publication and recovery

If npm has no Herdr package, verification retains the substantive candidate and
stops before publishing. The workflow uploads `verified-herdr-release` for 90 days,
including the `.tgz` and its `.tgz.json` handoff. The handoff and job summary record
the workflow run, actual release commit, version, archive location, SHA-512 integrity
and Herdr Trusted Publisher identity.

The maintainer-owned first-publication task uses that handoff:

1. Download the retained archive and compare its SHA-512 integrity with the handoff.
2. Publish those exact bytes using npm login and two-factor authentication.
3. Configure the Herdr Trusted Publisher above, including direct publication permission.
4. Rerun the original workflow to verify matching registry integrity and `latest`,
   then finish the tag and GitHub Release. Do not rebuild or publish a placeholder.

Recovery reports completed stages. It reuses matching npm contents and matching
local/remote tags, finishes missing tag/Release stages, and publishes an existing
draft Release. Conflicting registry contents, `latest`, tags or Release identities
stop recovery without overwriting them. Registry failures other than HTTP 404
are errors, not evidence that a package is absent.

Tags are written after npm publication. Because proposals select versions from
tags and use a separate concurrency group, a main push during partial publication
can propose the same version again. Finish recovery before merging another release.

## Implementation and live evidence

The implementation adapts the [pinned Sandcastle baseline](https://github.com/BuddyLabsCo/sandcastle-runner/tree/55c66eb88ba94272a51563666fe2ca19ece38224/scripts/release)
and [Core's release adaptation and CI change](https://github.com/BuddyLabsCo/issue-runner-core/commit/1b260991a199d4a763475b7f3ffc2bb3abb377c4).
Focused tests use real disposable Git repositories and substitute GitHub/npm
services. Installed-candidate checks obtain Core `0.1.0` from npm.

As inspected on 2026-11-06, [Core's recorded publication evidence](https://github.com/BuddyLabsCo/issue-runner-core/issues/312#issuecomment-6684159063)
establishes `0.1.0` availability and recovery of matching registry bytes.
The recorded successful run skipped the npm upload; a genuine subsequent OIDC
publication remains unverified. An open or merged implementation ticket is not
OIDC evidence. The npm dependency switch does not depend on that later proof.

Herdr implementation readiness is separate from first-package creation, App and
Trusted Publisher configuration, live workflow execution, genuine OIDC publication
and real-npm operation acceptance. Those operations belong to the human-operated
sibling task and were not performed here. Releases do not upgrade or publish
consumers or Agents.
