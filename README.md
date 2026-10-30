# issue-runner-herdr

Herdr terminal execution environment plugin for
[issue-runner-core](https://github.com/BuddyLabsCo/issue-runner-core).

The source implementation provides Core terminal contract version 1 for
**Herdr 0.9.5**. It exports only `contractVersion = 1` and the zero-argument
asynchronous `createTerminalPlugin()` from `src/index.ts`. Types come from the
packaged `issue-runner-core/terminal` public contract.

## Responsibilities

The initialized plugin provides three operations:

- `createTab({ cwd, env, label })` creates one new native tab with an interactive
  shell and records its root pane. `cwd` must be an existing absolute directory.
  The explicit string environment overlay is applied over Runner's environment
  captured at initialization; Herdr supplies the new pane's routing identities.
  Overlay keys reserved for Herdr routing are rejected.
- `submitText(handle, text, submitKey?)` sends the complete canonical-LF body in
  one generic `pane.send_input` request, followed by Right and the selected
  logical chord. Omission defaults to Enter; `"enter"` and `"shift+enter"` are
  supported case-insensitively, including `"Enter"` and `"Shift+Enter"`.
  Unsupported values reject before input.
  Text is not split, normalized, interpreted as argv, or escaped as shell code.
- `closeTab(handle)` closes only the native tab recorded for that owned handle.
  Foreign and invalid handles reject. A known absent or previously closed tab
  closes successfully. Closing the last tab is refused because Herdr would also
  remove the host workspace.

Core owns Agent configuration, complete start/resume shell-command text, the
startup delay, prompts, completion validation, workflow, retries, and recovery.
Creation does not launch an Agent or prove shell readiness. Submission success
reports backend acknowledgement, not Agent acceptance. Closing does not prove
process or descendant exit.

## Submission semantics

`submitKey` remains an optional string describing one logical submission chord.
Only Enter and Shift+Enter are supported. Whitespace, multiple-key scripts,
raw escape sequences, backend commands, and other chords reject locally before
target queries or body dispatch. Rejection does not fall back to another chord
or omit the mandatory Right key.

Every call preserves the complete text, including LF, Chinese/Unicode, blank
lines, indentation, quotes, and literal shell-looking characters. The request
contains the unchanged body and ordered keys `["right", "enter"]` or
`["right", "shift+enter"]`; Herdr's generic input encoder writes the body before
those keys. The plugin does not rewrite LF to CR or send each line separately.

Core supplies the complete configured start command, or a complete resume
command for a fresh tab, through ordinary `submitText(handle, command)` with
Enter. A later prompt is a separate call such as
`submitText(handle, prompt, "shift+enter")`. Core chooses each call's chord;
the plugin does not infer it from the command or Agent brand, remember a previous
call's selection, merge command and prompt, or add startup delays. Core retains
command construction, literal session-reference replacement, startup timing,
Probe/result validation, and recovery policy.

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
reconstructed. The plugin checks recorded tab/pane/terminal identities before
mutation. Detected target loss invalidates the handle; transport or protocol
loss invalidates the instance. Backend errors reject with the method and backend
message. Each socket request has a total five-second I/O deadline, including
connection and partial replies, and a 1 MiB request/reply limit. Mutations are
never automatically replayed. A failed creation or lost mutation reply can leave
an uncertain native result; Core owns reconciliation and recovery.

Herdr does not offer an atomic identity-check-and-mutate operation. Preflight
checks reject known unsafe targets but cannot establish that native IDs survive
server restart or prevent a target changing between a check and mutation.
Core serializes calls on one handle; separate handles can operate concurrently.

## Development and verification

Use Node.js **22.18 or later within 22.x** and npm **11.x**:

```sh
npm ci
npm run typecheck
node --test tests/integration/lifecycle.test.ts
npm run check
npm test
```

The checked-in `issue-runner-core-contract.1.tgz` is the Core contract-only
development artifact installed by the lockfile. It is a prerequisite for
typechecking, not a project-local product installation or a published Runner.
The source can execute using Node's built-in TypeScript support on the supported
runtime. Building and packing a distributable plugin is a separate ticket.

Tests call the real public factory and operations through a private, scripted
local-socket substitute. They exercise actual UTF-8 JSON-line encoding,
caller-context validation, creation, LF/CJK/literal text, chord ordering, owned
targeting, concurrent handles, closure, failures, and finite timeout behavior.
Focused unit tests cover chord defaulting, case-insensitive mapping, and rejection.
Submission tests verify exact protocol requests for start/resume commands in
fresh tabs and subsequent prompts with independently selected chords.
The existing quality checks enforce formatting, lint, types, and architecture
boundaries; CI is configured for Ubuntu and Windows.

Simulated checks do not establish actual PTY delivery, Agent acceptance, exact
conversation resume, or complete Core workflow success. Real Herdr/Agent tests
and macOS execution have not been performed here.

## Product installation status

The intended product installation is Core and the selected plugin installed
globally in the same active npm environment/prefix, with Core owning the single
`issue-runner` executable. Project-local, npx, mixed-prefix, and automatic
installation flows are outside the agreed support policy. This source lifecycle
does not claim an npm release, a packaged plugin, or validated joint installation.

See [the protocol mapping](docs/herdr-protocol.md) for the pinned source evidence.
