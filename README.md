# issue-runner-herdr

Herdr terminal execution environment plugin for
[issue-runner-core](https://github.com/BuddyLabsCo/issue-runner-core).

The plugin provides Core terminal contract version 1 for
**Herdr 0.9.5**. It exports only `contractVersion = 1` and the asynchronous
`createTerminalPlugin(config?)` from the ESM package `issue-runner-herdr`.
Types come from the packaged `issue-runner-core/terminal` public contract.

## Responsibilities

The initialized plugin provides five operations:

- `createTab({ cwd, env, label, agent, submitKey, signal? })` creates one native
  tab with an interactive shell and records its root pane. `cwd` must be an existing absolute directory.
  The explicit string environment overlay is applied over Runner's environment
  captured at initialization; Herdr supplies the new pane's routing identities.
  Overlay keys reserved for Herdr routing are rejected.
  When a matching enhancement is installed, creation awaits its initialization/preflight before returning.
- `start(handle, command)` submits the unchanged command with Enter, waits the
  configured startup delay, and returns `undefined`. Core can then Probe for identity.
- `resume(handle, command, sessionref)` submits the unchanged command with Enter,
  waits the same delay, and returns the exact supplied ref without another Probe.
- `submitText(handle, text, submitKey?, expectedFile?, recoveryText?)` sends the
  complete canonical-LF body in one generic `pane.send_input` request, then sends Right and the selected
  logical chord in separate requests, awaiting acknowledgement at each step.
  Omission defaults to Enter; `"enter"` and `"shift+enter"` are
  supported case-insensitively, including `"Enter"` and `"Shift+Enter"`.
  Unsupported values reject before input.
  Text is not split, normalized, interpreted as argv, or escaped as shell code.
- `closeTab(handle)` awaits enhancement stop, then closes only the native tab recorded for that owned handle.
  A failed stop prevents native closure; either failure rejects and allows an explicit retry.
  Foreign and invalid handles reject. A known absent or previously closed tab
  closes successfully; repeated close after established success makes no backend
  requests. Closing the last tab is refused because Herdr would also remove the
  host workspace.

A `tab_not_found` lookup alone does not establish safe absence. The plugin also
revalidates the captured Runner pane's workspace, tab, pane and terminal identity,
then requires an unambiguous workspace tab list containing the Runner tab and
excluding the owned tab. Missing context, contradictory or malformed lists,
generic not-found errors, transport errors and ordinary backend close failures
reject rather than claim closure. A handle established to be closed or absent
cannot receive later input; other owned handles remain usable.

Core owns Agent configuration, complete start/resume shell-command text, prompts,
handoff acceptance, workflow retries, and workflow recovery. Herdr owns startup
submission and timing. Optional enhancements own business-turn recovery decisions;
Herdr transports their requested input. Enhanced start/resume readiness and successful assignment recovery remain separate work.
Creation does not launch an Agent or prove shell readiness. Submission success
reports backend acknowledgement, not Agent acceptance. Closing invokes the
targeted backend operation; it does not prove process or descendant exit or
writer settlement.

## Submission semantics

`submitKey` remains an optional string describing one logical submission chord.
Only Enter and Shift+Enter are supported. Whitespace, multiple-key scripts,
raw escape sequences, backend commands, and other chords reject locally before
target queries or body dispatch. Rejection does not fall back to another chord
or omit the mandatory Right key.

Every call preserves the complete text, including LF, Chinese/Unicode, blank
lines, indentation, quotes, and literal shell-looking characters. The request
contains the unchanged body and no keys. After acknowledgement, the plugin
sends empty text with `["right"]`, then empty text with `["enter"]` or
`["shift+enter"]`, awaiting each reply. A failed or uncertain body prevents both
keys; a failed or uncertain Right prevents the final chord. A failed final
chord rejects without resending the body or Right. The plugin does not rewrite
LF to CR or send each line separately.

Core supplies complete commands to `start` or `resume` for a fresh tab. Herdr
always uses Enter for commands, regardless of the Agent's creation-time key.
Later prompts use `submitText(handle, prompt, "shift+enter")` or an omitted key
for Enter. The optional `expectedFile` and `recoveryText` arguments are accepted
without changing base submission. Herdr performs no identity Probe.

## Startup configuration and cancellation

Pass the complete `terminalPlugins` object to `createTerminalPlugin`. Omission
or `{}` defaults `agentStartDelay` to ten seconds and `enhancements` to `{}`:

```js
const terminal = await createTerminalPlugin({
  agentStartDelay: 10,
  enhancements: { retainedPrivateSetting: true },
});
```

`agentStartDelay` accepts finite non-negative seconds, including zero and
fractions, up to Node's timer limit of 2,147,483,647 milliseconds. `enhancements`
must be an object. Its private contents are ignored during base execution.
Creation requires a nonempty opaque `agent` string and a supported `submitKey`.
Herdr does not parse Agent names or command text.

The delay starts after body, Right, and Enter have all been acknowledged.
Concurrent and repeated startup calls on the same owned tab reuse that startup;
they never resend a successfully submitted command or create another terminal.
Ordinary submission errors reject unchanged. Core controls explicit retries;
transport loss retains the existing context invalidation and native I/O bounds.

Pass the Run's `AbortSignal` at creation to cancel startup. Abort interrupts the
startup wait and rejects later input. If a native request is already in flight,
it retains its five-second bound, but no subsequent input step is sent.
Already delivered input cannot be retracted. Abort preserves the tab and Agent;
`closeTab` remains available for explicit closure.

## Optional enhancements

Install `issue-runner-agent-${agent}` globally in the same npm prefix as Herdr and Core.
Herdr verifies its location against the active `npm root --global`. Keep npm's prefix configuration set to your installation prefix when launching Runner.
Herdr treats `agent` as an opaque package-name suffix. Invalid package identifiers have no match.
Discovery excludes Project-local packages, other prefixes, and caches, and rejects package or entry links that escape containment.
Missing packages preserve base execution and ignore retained private settings. Discovery also runs when configuration is omitted.
An installed package with invalid exports, an incompatible Core enhancement version, a missing dependency, or failed initialization rejects creation.

Each created Tab receives one enhancement and one portable `EnhancementHost` from Core's public contract.
The factory receives the Tab's `cwd` and environment overlay, plus the entire `enhancements` object unchanged, defaulting to `{}`.
Creation awaits preflight without starting an Agent. The Host exposes four operations:

- `read()` returns the current visible screen as text, excluding scrollback and terminal control sequences
- `submitText(text)` sends the complete body, Right, and the Agent's creation-time submit chord
- `sendKeys(keys)` validates all logical chords before input, then sends them in array order without an added Right or submit chord
- `requestRecovery()` rejects until Core recovery wording is retained; successful assignment recovery is separate work

Every Host operation checks the Tab's captured target identity. Enhancements need no native IDs, sockets, or Herdr environment variables.
Logical keys include Enter, Shift+Enter, Escape, Tab, Backspace, arrows, printable characters, and backend-supported modifier combinations.
Invalid key scripts and raw control bytes reject before input.

Run abort stops enhancement activity and pending follow-up input while preserving the Tab and Agent.
If abort occurs during factory initialization, Herdr stops the returned instance before rejecting creation.
The factory owns cleanup when its partial initialization fails. Herdr releases its own cancellation resources and revokes Host input.
Explicit close waits for stop before native closure. Completed stop and close actions are not repeated; failed actions can be retried.
Stopping one enhancement never terminates a shared Agent daemon or unrelated sessions.

Protocol-substitute and installed-package tests verify these boundaries. Real Agent acceptance remains in Core's Windows base #15 and Linux enhanced #198.

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
Core serializes calls on one handle; separate handles can operate concurrently.

## Development and verification

Use Node.js **22.18 or later within 22.x** and npm **11.x**:

```sh
npm ci
npm run typecheck
node --test tests/integration/lifecycle.test.ts
npm run check
npm run build
npm test
```

The checked-in `issue-runner-core-contract.1.tgz` is the Core contract-only
development artifact installed by the lockfile. It is a prerequisite for
typechecking, not a project-local product installation or a published Runner.
Source tests use Node's built-in TypeScript support; the plugin build emits
JavaScript and a public declaration that imports Core's public types.

## Development artifacts

Create a tarball from this checkout:

```sh
npm ci
npm pack
```

`npm pack` builds automatically and writes
`issue-runner-herdr-0.0.0-dev.1.tgz`. The package contains built JavaScript,
the public `dist/index.d.ts`, and package documentation/metadata. Only the root
module is exported; transport helpers, source files, test fixtures and a testing
entry are not public APIs. It has no executable and no third-party runtime
dependencies. Core is a peer dependency and supplies the declaration types.

For a manual development import, create an empty temporary consumer with its
own `package.json`, then run there, replacing both absolute artifact paths:

```sh
npm install --omit=dev --ignore-scripts "/absolute/path/issue-runner-core-contract.1.tgz" "/absolute/path/issue-runner-herdr-0.0.0-dev.1.tgz"
node --input-type=module -e "import('issue-runner-herdr').then(m => console.log(m.contractVersion))"
```

This imports the installed artifact by package name and prints `1`; it needs no
Herdr server until the factory is invoked. From a valid inherited Herdr context,
consumers use the same public module:

```js
import { createTerminalPlugin } from "issue-runner-herdr";

const terminal = await createTerminalPlugin();
const tab = await terminal.createTab({
  cwd: process.cwd(),
  env: {},
  label: "Issue",
  agent: "configured-agent",
  submitKey: "Shift+Enter",
});
const sessionref = await terminal.start(tab, "configured-agent-command");
// Core performs its identity Probe when sessionref is undefined.
await terminal.submitText(tab, "Complete the assigned task", "Shift+Enter");
await terminal.closeTab(tab);
```

Run the automated isolated-consumer check separately with:

```sh
npm run test:package
```

It packs the plugin, installs it and the supplied Core artifact into a
temporary directory containing spaces, and resolves the plugin from that
directory. The consumer installs only these artifacts and Core's transitive
dependencies, with installation scripts disabled and no enhancement installed.
Core's transitive dependencies may require npm registry access.
A development TypeScript compiler checks the installed declarations against `TerminalPluginModule` with no checkout types in the consumer.
An independent consumer process checks the exports, configured asynchronous
factory, all five operations, start/resume refs, and five-argument submission
with default and explicit Enter against the private Herdr protocol substitute.
No public test API is added. Temporary artifacts are removed afterward.

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
Startup tests cover unchanged commands, concurrent and repeated calls, exact refs,
default and explicit delays after submission, and cancellation between input steps.
Submission tests check subsequent prompts with independently selected chords.
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

The intended product installation is Core and the selected plugin installed
globally in the same active npm environment/prefix, with Core owning the single
`issue-runner` executable. Project-local, npx, mixed-prefix, and automatic
installation flows are outside the agreed support policy. Core owns plugin
discovery; this package does not implement a loader or automatic installer.
The supplied Core artifact contains the public contract only, not the Runner.
It enables development verification before a complete Core product is available.

The plugin is currently marked private and versioned as a development artifact.
Packing and simulated consumer checks do not publish either package, reserve or
claim availability of their candidate registry names, or validate a joint product
installation. No registry release, real Herdr/Agent acceptance, or executed macOS
test result is claimed.

See [the protocol mapping](docs/herdr-protocol.md) for the pinned source evidence.
