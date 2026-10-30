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
  one generic `pane.send_input` request, followed by Right and Enter (default or
  explicit `"Enter"`) or `"Shift+Enter"`. Unsupported chords reject before input.
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

## Inherited host context

Launch Runner inside an existing Herdr 0.9.5 pane. The factory requires inherited
`HERDR_SOCKET_PATH` and `HERDR_PANE_ID`. It queries `pane.current` with that caller
identity, checks any inherited workspace/tab identities against the reply, and
validates the returned host with `workspace.get`. The captured workspace is
supplied explicitly on every creation. UI focus and display labels never select
targets. Missing, conflicting, or unusable context rejects; the plugin does not
install or start a server, select a default server, or probe capabilities.

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
