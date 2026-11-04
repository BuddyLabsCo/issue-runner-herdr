# Ticket 39 Core contract migration

## Pinned source build

Fetched the remote default branch of `BuddyLabsCo/issue-runner-core` into an isolated checkout on 2026-11-05. The checkout is pinned to `1bd2c4406978b168e3726c996fe7fbdae9ced8b4`; existing Core work was untouched, and no Herdr branch was fetched or pulled.

- Package: `issue-runner-core@0.0.0-contract.1`
- Public terminal contract: `2`
- Public enhancement contract: `2`
- Destination: `issue-runner-core-contract.1.tgz`
- SHA-256: `e11ddcc6900158b3f4ab3f91acc461dbd2c7f99ceb295c50c46ddced9310a65a`
- npm integrity: `sha512-AGH/7OTvqAY0w0qD+GQ7RF8wA/1igFy1L+LRvYnUDj8A0tMwJHmu7bD5lPFWerlwI2QqEY4bmI5csFFhV0KzJg==`

Followed Core's `docs/terminal-contract.md` source-build workflow: `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, then `npm pack --json --pack-destination artifacts`. Cleared the inherited `npm_config_allow_scripts` setting for installation; dependency install scripts remained disabled. Built and packed with Node 22.18.0 and npm 11.6.2. Core's full suite passed: 685 passed, 1 skipped, 0 failed.

The package contains 103 files, including public terminal and CLI JavaScript/declarations, runtime modules, prompts, templates, and the handoff skill. The package version is independent of both contract versions. Herdr keeps its exact runtime version dependency; only the development lockfile and disposable package-test candidate resolve the local tarball. The lockfile integrity changed with the bytes. A fresh script-disabled installation exposes terminal and enhancement contract 2, excluding reuse of the old same-named artifact.

## Transferred coverage

Verified these files in the pinned Core checkout before removing Herdr's orchestration assertions. All ran in Core's passing full suite:

| Removed Herdr responsibility | Equivalent Core coverage |
| --- | --- |
| Same-prefix discovery, nested Core, launcher identity, relocated installation, invalid modules and escaping links | `tests/package/enhancements.mjs` (through `tests/package.test.mjs`), `tests/adapters/cli-enhancement-discovery.test.ts` |
| Enhancement preflight, monitoring, readiness retries, base delay and startup deduplication | `tests/run/cli-composite-startup.test.ts` |
| Exact native resume identity and readiness mismatch | `tests/run/cli-implementation-resume.test.ts` |
| Abort during factory/preflight/readiness, late instances and cleanup errors | `tests/run/cli-cancellation.test.ts`, `tests/agent/conversation.test.ts` |
| Shared cleanup attempts, retryable cleanup and independent tabs | `tests/agent/conversation.test.ts` |
| Assignment notification and retained recovery wording | `tests/run/cli-handoff-recovery.test.ts`, `tests/agent/conversation.test.ts` |
| Originating Assignment rather than latest wording | `tests/agent/conversation.test.ts`: “recovery retains Assignment A through adapter-delayed input before same-path Assignment B” |
| Generic configuration validation | `tests/run/cli-validation.test.ts`, `tests/run/cli-terminal-contract.test.ts` |

The originating-Assignment test gates A's actual adapter input while B is queued with the same expected path. It checks distinct IDs, drops stale A requests, and observes exactly A, recovery A, B, recovery B. Herdr retains only opaque text and ordered input. Its protocol-level identity, cancellation, output, timeout and queue assertions remain at the migrated public adapter seam.

## Verification scope

Native Windows/Linux acceptance remains Core #15 and #198. Repository checks do not establish live Herdr or Agent behavior. No CI, publication, tracker or pull request operations are part of this delivery.

## Herdr verification results

Executed with Node 22.18.0 and npm 11.6.2 against the pinned artifact:

| Check | Result |
| --- | --- |
| Script-disabled clean dependency install | Passed; refreshed integrity and installed v2 declarations |
| Submission TDD | Four migrated cases failed on the removed Agent requirement, then passed |
| Bound I/O TDD | Missing optional signal failed at `read`; optional-signal fix passed |
| Focused native, queue, validation and lifecycle tests | Passed, including cancellation and malformed screen responses |
| Repeated `npm --allow-scripts= run typecheck` | Passed after migrating adapter and consumers |
| `npm --allow-scripts= run check` | Formatting, lint and types passed |
| `npm --allow-scripts= run test:package` | Passed; candidate pack/install, installed types, command identity, nested Core, relocated prefix and inert import |
| Final `npm --allow-scripts= test` | 232 passed, 6 platform-specific skips, 0 failures; one full Herdr suite run |
| `git diff --check` | Passed |

The installed-package fixture checks the tarball against lockfile integrity and compares installed Core's public runtime/declarations with the refreshed checkout dependency. Release metadata retains its exact version dependency without candidate paths.

Ripwire's quality delta exits 2: it flags recent churn, similar forwarding methods (`execute`, bound `submitText`, `sendKeys`) and longer package verification helpers. The forwarding methods deliberately share the existing input queue; no additional abstraction or baseline suppression was added. The test selector exits 4 while enumerating 19 affected test/fixture files and reports no uncovered impacted symbols. The final full suite exercises that selection; the selector does not observe test execution.
