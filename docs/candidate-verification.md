# Ticket 36 candidate verification

This candidate gives Herdr its own command and installs the full Core runtime
transitively. Verification uses local npm artifacts, without publication or a
separate global Core installation.

## Input artifacts

Both artifacts were built with Node 22.18.0 and npm 11.6.2 from unmodified Git
archives. The Core checkout's existing local object supplied the completed public
CLI implementation; no branch was fetched, pulled or changed.

| Package | Source revision | Version | Artifact |
| --- | --- | --- | --- |
| Core | `6398a5f82acef11ccc59a30e6c75a48e608b1138` | `0.0.0-contract.1` | `issue-runner-core-contract.1.tgz` |
| Codex | `8a5de5b578f914ddf59a83d306d2c209d7aef75e` | `0.0.0-dev.1` | `issue-runner-agent-codex-0.0.0-dev.1.tgz` |

SHA-256 identities:

```text
6fc6d5203744a88a134b02e05f106c44de7d871cab724c1c9dde347097b620cc  issue-runner-core-contract.1.tgz
2bff3209bd7c1ae3030ff57e46ecb2340747f49cf3f371c1ab6a5ddc421a0493  issue-runner-agent-codex-0.0.0-dev.1.tgz
```

Core's npm integrity is
`sha512-656QJkiUlD+92f1gmvI1jPOy5nUIv+VyHN5esAHTwTkJT62EmMmMnNjlRxyJycKPiDJTpp7U5OU4SXngesgrxg==`.
Its 99 packed files include the runtime, `cli-entry.js` and declarations,
terminal contracts, prompts, templates and handoff skill. Core exports `runCli`
from `issue-runner-core/cli` and has no executable registration. Herdr imports
no Core internals.

Codex's npm integrity is
`sha512-cO/+ezqzIKnBRCS0wOMPe32pISETJ4zbxSih9v7JoVOUjlHhKHXOIfZGTg+T98j5TOTkt8J2JcolArADprKs8g==`.
Its optional peer remains exactly `issue-runner-core: 0.0.0-contract.1`.
No Codex source or package metadata was patched.

## Reproduce the inputs and candidate

Given local repositories containing the recorded revisions, export each revision
into a disposable build directory and run `npm ci --ignore-scripts` followed by
`npm pack`. Packing runs that package's TypeScript build. For example, from the
Herdr checkout using a POSIX shell:

```sh
mkdir -p node_modules/.candidate-core
core_source=/absolute/path/to/issue-runner-core
core_revision=6398a5f82acef11ccc59a30e6c75a48e608b1138
git -C "$core_source" archive "$core_revision" |
  tar -x -C node_modules/.candidate-core
(cd node_modules/.candidate-core && npm ci --ignore-scripts && npm pack)
cp node_modules/.candidate-core/issue-runner-core-0.0.0-contract.1.tgz \
  issue-runner-core-contract.1.tgz
```

Repeat with Codex's recorded revision to reproduce its tarball. Keep Core's
historical filename, and update its lockfile integrity if replacing the bytes.
`package.json` and the lockfile root both declare the exact runtime version;
only the development lockfile's resolved artifact location is local.

Run `npm ci`, `npm run check`, `npm run build`, and `npm test` in Herdr.
The [README candidate recipe](../README.md#development-artifacts) produces the
local Herdr tarball from a disposable package copy. It changes only that copy's
Core runtime dependency to the absolute tarball path. The release manifest has
no local dependency path, peer dependency, version range or private restriction.
Release still requires the exact Core version in the registry.

## Delivered Herdr candidate

The generated `issue-runner-herdr-0.0.0-dev.1.tgz` is retained at the checkout root
(ignored build output). Its SHA-256 is `b79cb7913037439aa3eeefb1334f9f03c8d7fe213fa8d16d8017f614dbc20001`.
It contains 12 files and references the Core tarball in this delivery
worktree by absolute path. Repack using the README recipe after moving the inputs.

## Verification results

Executed on Linux with Node 22.18.0 and npm 11.6.2:

| Check | Result |
| --- | --- |
| Clean `npm ci --ignore-scripts --no-audit --no-fund` | Passed |
| `npm run check` | Formatting, lint and types passed |
| `npm run build` | Passed |
| `npm run test:package` | Passed, including unchanged Codex install/load |
| `npm test` (one final full run) | 294 passed, 0 failed, 6 Windows-only skips |
| `git diff --check` | Passed |

The focused discovery regression failed before the identity change: valid
nested-Core installations did not initialize enhancements, and broken ones
silently fell back to base execution. All 32 discovery cases now pass, including
Unix symlinks and simulated Windows shims, unrelated prefixes, invalid metadata,
wrong launcher targets and escaping package, entry and executable links.

The installed-artifact check passes on Linux. It installs only Herdr globally,
with nested Core and no top-level Core, relocates a prefix containing spaces,
and runs native launchers from an unrelated directory. Help, combined version
output, init files and overwrite protection, configuration lookup, credentials,
selectors, `--env` rejection and missing live context retain Core's behavior.
Public imports stay lazy; installed declarations conform to the terminal and
CLI contracts. Generic protocol-substitute consumers retain startup, exact-ref
resume, readiness retry, assignment recovery and close behavior.

After base and generic checks, ordinary npm installation of the unchanged Codex
tarball into the same prefix succeeds. Through Herdr's public factory, invalid
`readyTimeout: 0` reaches Codex's own option validation and yields its expected
error. This proves actual module and factory loading, including its transitive
dependencies, without a real Codex daemon or trust changes. The command still
reports `issue-runner-herdr 0.0.0-dev.1 (core 0.0.0-contract.1)` afterward.

Ripwire reports no gating quality regressions, no incompatible caller of
`globalInstallation`, and no uncovered impacted symbols. Its test-selection
command exits 4 while listing tests to run; it does not observe their execution.
The complete suite covers that list.

Native Windows/macOS execution and live Herdr/Codex acceptance were not run.
The existing Ubuntu/Windows CI jobs are unchanged and were not operated here.
Core issues #15 and #198 retain real-terminal acceptance. No package was
published and no tracker or pull request was modified.
