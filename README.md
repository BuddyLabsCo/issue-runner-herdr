# issue-runner-herdr


Herdr command and terminal execution plugin for
[issue-runner-core](https://github.com/BuddyLabsCo/issue-runner-core).

The plugin provides Core terminal contract version 2 for
**Herdr 0.9.5**. It exports only `contractVersion = 2` and the asynchronous
`createTerminalPlugin(config?)` from the ESM package `issue-runner-herdr`.
Types come from the packaged `issue-runner-core/terminal` public contract.

## Install and run

Install Herdr globally to receive its exact tested Core runtime transitively.
A release requires `issue-runner-core@0.1.1` to be available in your registry.
For unpublished candidates, use the [local artifact workflow](#development-artifacts).

```sh
npm install --global issue-runner-herdr
issue-runner-herdr --help
issue-runner-herdr --version
issue-runner-herdr init --project my-project
```

Help, version and init work without a live Herdr pane. Version output identifies
both packages: `issue-runner-herdr 0.1.0 (core 0.1.1)`.
Init creates `my-project/config.yaml` and three prompts beneath your working
directory, refusing existing destinations. Edit those files and set the configured
credentials before running from a live Herdr pane:

```sh
issue-runner-herdr run --project my-project --issue 36
```

The command selects Herdr; `--env` is unsupported. Core owns arguments, help,
configuration lookup, signals, workflows, reports, recovery identity and exit status.
Herdr's executable calls the public `runCli` API once with its command name,
package version, lazy terminal module, real executing package location and CLI entry identity. Core validates that installation identity and discovers enhancements. Importing `issue-runner-herdr` runs
neither the CLI nor Herdr initialization. Core invokes the factory only when a Run
passes its startup validation; the factory then performs the existing read-only
host-context preflight.

Custom global prefixes, including paths containing spaces, are supported. Invoke
the installed launcher in that prefix or add its executable directory to PATH.
Project-local, npx and mixed-prefix product installations are unsupported.

## Responsibilities

The initialized plugin exposes `createTab`, `execute`, and `closeTab`:

- `createTab({ cwd, env, label, submitKey, signal? })` returns `{ handle, io }` after creating one interactive native tab and recording its root pane. It validates and captures the submit key before native creation. Creation does not launch a command or initialize an enhancement.
- `execute(handle, command)` submits the complete opaque command, Right, then Enter. It resolves after input acknowledgement. Each call submits its command; Herdr does not deduplicate commands, substitute session references, wait for readiness, or wait for process exit.
- `closeTab(handle)` closes only the owned native tab. Known absence and repeated successful closure are harmless. Native failures reject and permit an explicit retry. Closure remains usable after revocation and does not invoke enhancement cleanup. Herdr refuses to close the workspace's last tab.

Handles belong to one plugin instance; native identifiers stay private. Bound `io.read()`, `io.submitText(text)`, and `io.sendKeys(keys)` use the same recorded target as `execute` and `closeTab`. They work with or without an optional creation signal.

A `tab_not_found` lookup alone does not establish safe absence. Herdr revalidates the captured Runner pane's identity and requires an unambiguous workspace tab list containing Runner and excluding the owned tab. Missing context, contradictory lists, transport errors and ordinary close failures reject. A changed root pane invalidates the handle permanently; Herdr never adopts its replacement.

Core owns enhancement discovery and lifecycle, preflight, monitoring, startup delays, readiness, session identity, Assignment notification and recovery wording. Enhancements request recovery for an originating Assignment through Core. Herdr transports opaque commands and input without interpreting those concepts.

## Submission semantics

Creation requires `submitKey`: Enter or Shift+Enter, case-insensitively. Whitespace, scripts, raw escape sequences and other submit chords reject before native creation. Changing the caller's options later does not change the captured key.

`io.submitText(text)` sends the unchanged complete string in one `pane.send_input` request, then Right, then the creation-time chord. `execute` always uses Enter. Neither operation splits, normalizes, substitutes, escapes or interprets the text. Unicode, LF, indentation, blank lines and shell-looking characters remain literal.

Each step awaits acknowledgement. A failed body prevents both keys; a failed Right prevents submission. A failed final chord rejects without replay. Success reports backend acknowledgement, not Agent acceptance or process completion.

`io.sendKeys(keys)` validates and translates the complete ordered logical chord sequence before sending any key. `io.read()` requests the current visible plain-text screen with ANSI stripping and validates its response identity and shape. It provides neither scrollback nor streaming.

Commands, text and keys share one queue per tab. Reads stay outside that queue; other tabs remain independent. Failed sends do not poison subsequent explicit input.

## Configuration and cancellation

The factory retains its `unknown` configuration boundary and requires an object. Core owns `terminalPlugins.agentStartDelay` and `terminalPlugins.enhancements`, including their defaults and validation. Herdr does not inspect those values or load enhancement packages.

The optional creation `signal` revokes automatic I/O. Input starts after queue admission, ownership and target validation, and the final cancellation check immediately before the first native send. Revocation before that boundary prevents every input message, including when cancellation occurs during target checks.

Once input starts, cancellation alone lets the complete text/Right/submit sequence or validated key sequence finish in order. The operation retains its queue slot and settles only after completion or a native error. Later queued operations and calls after revocation send nothing. Native failures and finite timeouts still stop remaining sends, without rollback or automatic replay. Cancellation retains the tab for manual takeover and explicit closure.

## Working context

Creation captures `cwd`, `label`, and the explicit environment entries before
checking the directory asynchronously. Changing the caller's options afterward
does not change that request. Paths, labels, and environment values travel as
UTF-8 JSON data, without shell quoting or expansion. Spaces, Unicode, quotes,
and literal shell characters are preserved; empty environment values override
inherited values rather than deleting their keys. Unspecified variables retain
the values captured when the plugin was initialized.

`cwd` must name an existing directory accessible to Runner on the same host as
Herdr. Use an absolute POSIX path on Linux/macOS, or a fully qualified drive or
UNC path on Windows; forward slashes and extended-length Windows paths are
preserved. Drive-relative paths such as `C:work`, current-drive roots such as
`\work`, and shell expressions such as `~/work` must be resolved by the caller.
Local directory validation is a preflight check; backend failures applying the
directory or environment still reject creation.

Labels and environment strings cannot contain NUL. Environment keys must be
nonempty and cannot contain `=` or NUL. Explicit overrides of `HERDR_ENV`,
`HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`, or
`HERDR_BIN_PATH` reject, including case variants; Herdr supplies routing context
for the new pane. Other environment names follow the platform's casing rules.
A partial or inconsistent creation reply cannot establish an owned handle and
invalidates the plugin. A rejected creation may leave a native tab behind;
the plugin does not guess its identity or retry the request.

## Inherited host context

Launch Runner inside an existing Herdr 0.9.5 pane. The factory requires inherited
`HERDR_SOCKET_PATH` and `HERDR_PANE_ID`. It queries `pane.current` with that caller
identity, checks any inherited workspace/tab identities against the reply, and
validates the returned host with `workspace.get`. The captured workspace is
supplied explicitly on every creation. UI focus and display labels never select
targets. Missing, conflicting, or unusable context rejects; the plugin does not
install or start a server, select a default server, or probe capabilities.

The inherited environment is captured before the first lookup. Workspace/tab
IDs are optional consistency checks; if present, they must be nonempty and match
the queried caller. An inherited workspace ID alone cannot initialize the plugin
without a caller pane, and missing or ambiguous lookup results never authorize
following focus.

Initialization lookup failures report `Herdr host context could not be initialized`
with launch guidance and the original backend/protocol reason. Launch Runner again
from a live pane in the intended Herdr server, preserving that pane's inherited
`HERDR_SOCKET_PATH` and `HERDR_PANE_ID` together. A missing or malformed required
value rejects before any server request. For stale panes/workspaces, conflicting
workspace/tab IDs, ambiguous results, or an unavailable socket, check the launch
wrapper for copied or overwritten `HERDR_*` values. Initialization only reads
context; a rejected factory creates no terminal resources.

Handles belong to one plugin instance and must not be inspected, persisted, or
reconstructed. Fabricated objects, copies of handles, and another instance's
handles reject before backend queries or mutation; native IDs are not a public
addressing mechanism. Concurrent creations associate each handle with the tab
and root pane in its own reply, even when replies arrive out of order. Closing
one handle leaves other live handles usable. Separate instances retain their
own backend contexts, even when different servers issue identical native IDs.
The plugin checks recorded tab/pane/terminal identities before mutation.
Detected target loss invalidates the handle; transport or protocol
loss invalidates every association in that instance and immediately rejects its
pending socket operations with the original loss reason. Later operations cannot
reconnect using stale associations. Ordinary backend rejections report the method
and backend message without invalidating otherwise live associations.
Each socket request has a total five-second I/O deadline, including
connection and partial replies, and a 1 MiB request/reply limit. Mutations are
never automatically replayed. Initialization uses two sequential requests;
creation uses one after local validation; submission uses two target lookups
and three input requests; present-tab closure uses two target lookups, a tab list,
and a close request. Known-absent confirmation instead uses the failed tab lookup,
a Runner pane lookup and a tab list, with no close request.
Their cumulative socket I/O budgets are at most 10, 5, 25, and
20 seconds respectively, with no Agent-response wait or public timeout option.
These budgets exclude local directory validation and event-loop scheduling.
Each settled request clears its timer, destroys its socket, and releases pending
transport bookkeeping. Late replies cannot resume a rejected submission.
A failed creation or lost mutation reply can leave
an uncertain native result; rejecting pending operations cannot undo a request
already sent. Core owns reconciliation and recovery. A fresh factory invocation
in valid inherited context can create a fresh tab; previous handles remain invalid
and cannot be transferred to that instance. The plugin does not adopt live tabs
or restart an Agent.

Herdr does not offer an atomic identity-check-and-mutate operation. Preflight
checks reject known unsafe targets but cannot establish that native IDs survive
server restart or prevent a target changing between a check and mutation.
There is no continuous connection or restart notification: loss is detected through
failed, incomplete, or malformed requests and inconsistent target identities.
A restart between successful requests that reuses every checked identity can go
undetected; the plugin cannot promise identity continuity in that case.
Herdr serializes complete input operations per Tab across Core and bound Host calls;
separate Tabs can operate concurrently. Screen reads can proceed during pending input.

## Development and verification

Use Node.js **22.18 or later within 22.x** and npm **11.x**:

```sh
npm ci --ignore-scripts
npm run typecheck
node --test tests/integration/lifecycle.test.ts
npm run check
npm run build
npm test
```

`npm ci` installs the exact runtime dependency `issue-runner-core@0.1.1` from npm.
The lockfile records its registry URL and integrity. Development and package
checks require no Core archive or sibling checkout.
Source tests use Node's built-in TypeScript support; the plugin build emits
JavaScript and a public declaration that imports Core's public types.

The stable release process and bootstrap handoff are documented in
[releasing Herdr](docs/releases.md).

## Development artifacts

`npm pack` builds a release-shaped package with the public module, executable,
declarations and documentation. Only the root terminal module is exported;
transport helpers, source files and test fixtures remain private.

Create a candidate with the declared npm Core dependency:

```sh
npm pack
```

The automated package check installs only Herdr, with Core nested beneath it, then relocates the prefix. It verifies the native launcher from an unrelated directory. No Agent package is needed for adapter checks.

For a manual development import, install the candidate into an empty temporary
consumer and run there:

```sh
npm install --omit=dev --ignore-scripts "/absolute/path/issue-runner-herdr-0.1.0.tgz"
node --input-type=module -e "import('issue-runner-herdr').then(m => console.log(m.contractVersion))"
```

This imports the installed artifact by package name and prints `2`; it needs no
Herdr server until the factory is invoked. From a valid inherited Herdr context,
consumers use the same public module:

```js
import { createTerminalPlugin } from "issue-runner-herdr";

const terminal = await createTerminalPlugin();
const { handle, io } = await terminal.createTab({
  cwd: process.cwd(),
  env: {},
  label: "Issue",
  submitKey: "Shift+Enter",
});
await terminal.execute(handle, "configured-agent-command");
await io.submitText("Complete the assigned task");
await terminal.closeTab(handle);
```

Run the automated isolated-consumer check separately with:

```sh
npm run test:package
```

By default, the check builds and packs this checkout. To verify an existing
candidate, set `HERDR_CANDIDATE_TARBALL` to its absolute path before running
`npm run test:package` (or `npm test`). The check installs that artifact unchanged,
without rebuilding, repacking or rewriting its manifest. Relative paths resolve
from the command's working directory.

It installs only Herdr globally into a disposable prefix containing spaces.
It relocates the prefix and invokes native launchers from an unrelated directory.
Help, combined versions, init overwrite protection, configuration lookup and run
validation require no live Herdr context. A consumer typecheck uses installed
Core and Herdr declarations, without checkout types.

Public consumers exercise bound I/O, opaque commands, creation-time submit keys and native closure through the private protocol substitute. Installed declaration checks reject the removed startup and submission APIs. The CLI check verifies the real executing package and entry identities, independent of task cwd, nested Core and active npm prefix. Historical Core migration coverage is recorded in [candidate verification](docs/candidate-verification.md).

Core installation requires npm registry access. Tests remove temporary installations.

The complete `npm test` suite includes this package check. The existing Ubuntu
and Windows CI jobs run checks, build and the suite under Node 22.18.0/npm 11.6.2.
These local artifact installs are development and CI verification, not an
additional supported product installation mode.

## Verification scope

Tests call the real public factory and operations through a private, scripted
local-socket substitute. They exercise actual UTF-8 JSON-line encoding,
caller-context validation, creation, LF/CJK/literal text, chord ordering, owned
targeting, concurrent handles, closure, failures, and finite timeout behavior.
Focused unit tests cover chord defaulting, case-insensitive mapping, and rejection.
Execution tests cover repeated opaque commands, submission acknowledgement and completion after cancellation once input starts. Bound I/O tests cover captured submit keys, complete ordered chords, visible output validation and revocation. Queue tests gate native replies to check queued cancellation, cancellation during target checks, serialization, independent tabs and reads outside the queue. Cancellation tests preserve native failures and finite timeouts after partial delivery without replay.
Isolation tests hold scripted replies to force out-of-order creation and
overlapping submit/close operations, and use separate socket substitutes with
overlapping native IDs to check instance ownership.
Backend-loss tests hold a pending input reply while another request disconnects,
script a restart with reused native identities, and count mutations to check
stale-handle rejection, absence of replay, and fresh-instance operation.
Ordinary backend rejection is also checked to leave live associations usable.
Closure tests script present, absent, contradictory and failed backend replies,
check exact tab targeting, and keep Runner, another Issue and unrelated resources
untouched while the other Issue handle remains usable.
Timeout tests use a controlled clock and an independent test timeout guard at
every lifecycle request, including a connection that never opens, silent replies,
and incomplete replies. They count requests and cleared timers, release withheld
late replies, and advance the clock after rejection to check absence of replay
or delayed follow-up input. Failure tests reject body, Right, and final Enter
independently, and cover malformed correlated replies, partial creation results,
UTF-8 size limits, and backend close errors. A wall-clock partial-reply test also
exercises the actual five-second deadline.
The existing quality checks enforce formatting, lint, types, and architecture
boundaries; CI is configured for Ubuntu and Windows. Implementation portability
targets Linux, Windows and macOS under the stated Node/npm runtime.

Simulated checks do not establish actual PTY delivery, Agent acceptance, exact
conversation resume, or complete Core workflow success. Real Herdr/Agent tests
and macOS execution have not been performed here.

## Product installation status

Herdr owns `issue-runner-herdr` and installs its exact Core runtime dependency.
Core discovers optional enhancements beside the executing terminal installation and owns shared CLI, orchestration and workflow policy. The package is publishable metadata-wise,
but this development candidate has not been published and requires the exact Core
version to be available before release.

No registry release, real Herdr/Agent acceptance or executed macOS result is claimed.
See [the protocol mapping](docs/herdr-protocol.md) for the pinned source evidence.
