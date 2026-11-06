# Code Architecture

```text
/
|-- src/                       # Command entry, public exports and plugin assembly
|   |-- plugin/                # Configuration boundary, tab ownership, bound I/O and operation ordering
|   `-- herdr/                 # Host context, native targets, protocol encoding, transport, timeouts
|-- tests/
|   |-- unit/                  # Validation and key mapping
|   |-- integration/           # Public plugin behavior through a Herdr protocol substitute
|   |-- package/               # Built exports and Core contract compatibility
|   |-- release/               # Release entry points through real Git and service substitutes
|   `-- fixtures/              # Protocol substitute and scripted backend responses
|-- scripts/release/           # Stable proposals, candidate verification and publication
|-- docs/                      # Architecture, decisions and usage
|-- .github/workflows/         # Build and tests on Ubuntu and Windows
`-- dist/                      # Generated output
```

```text
public module -> plugin/ -> herdr/ -> Herdr server
                     # Dependencies flow forward; backend details stay in herdr/
```

- Public exports: `contractVersion` and `createTerminalPlugin`; consume types from `issue-runner-core/terminal`.
- Keep handles and target associations inside their plugin instance; keep transport and test seams private.
- Core owns enhancement discovery, lifecycle, preflight, monitoring, startup delays, readiness, session identity, Assignment notification and recovery. Herdr neither imports enhancements nor interprets `terminalPlugins.agentStartDelay` or `terminalPlugins.enhancements`.
- The executable in `src/cli.ts` calls only the public `issue-runner-core/cli` entry with command identity, lazy terminal module, real executing terminal package location and CLI entry identity. Core validates the installation and discovers enhancements. Importing the public terminal module never invokes the CLI.
- Core owns shared CLI policy, workflows, Agent configuration, retries, handoff acceptance and workflow recovery.
- `createTab` returns `{ handle, io }` after native creation; `execute` submits an opaque command. Bound `read`, `submitText` and `sendKeys` retain the same owned target. Capture and validate the submit key at creation.
- The plugin owns one input queue per tab and its revocation signal. Command, text and key operations share the queue; reads stay outside it. Native I/O retains identity checks and finite bounds. Input starts after queue admission, ownership and target validation, and the final cancellation check immediately before the first native send. Once started, input retains its queue slot until all sends finish or a native error occurs; cancellation alone never interrupts it. Revoked queued operations send nothing.
- Explicit close works after revocation, closes only the owned target and never invokes enhancement cleanup.
- Keep helpers beside their owner. Add directories when needed, not as empty scaffolding.
- Release automation stays outside the runtime package. Package acceptance uses the existing supplied-candidate checks; proposal and publication service substitutes stay in release tests.
- Run `npm run check` for formatting, lint and types; `npm test` checks the quality rules.
