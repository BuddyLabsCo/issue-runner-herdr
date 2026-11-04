# Code Architecture

```text
/
|-- src/                       # Command entry, public exports and plugin assembly
|   |-- plugin/                # Configuration, discovery, enhancement lifecycle; tab ownership and operation ordering
|   `-- herdr/                 # Host context, native targets, protocol encoding, transport, timeouts
|-- tests/
|   |-- unit/                  # Validation and key mapping
|   |-- integration/           # Public plugin behavior through a Herdr protocol substitute
|   |-- package/               # Built exports and Core contract compatibility
|   `-- fixtures/              # Protocol substitute and scripted backend responses
|-- docs/                      # Architecture, decisions and usage
|-- .github/workflows/         # Build and tests on Ubuntu and Windows
`-- dist/                      # Generated output
```

```text
public module -> plugin/ -> herdr/ -> Herdr server
                     # Dependencies flow forward; backend details stay in herdr/
```

- Public exports: `contractVersion` and `createTerminalPlugin`; consume types from `issue-runner-core/terminal`.
- Keep handles, target associations, and each Tab's enhancement inside its plugin instance; keep transport and test seams private.
- Discover optional enhancements only beside the globally installed plugin, anchored by the canonical executing Herdr package, its declared executable and matching same-prefix launcher; Core may be nested. Package filesystem checks belong in `plugin/discovery.ts`; native I/O belongs in `herdr/`.
- The executable in `src/cli.ts` calls only the public `issue-runner-core/cli` entry with command identity and the lazy terminal module. Importing the public terminal module never invokes the CLI.
- Core owns shared CLI policy, workflow, Agent configuration, retries, handoff acceptance and workflow recovery.
- The plugin layer owns startup progress, delay and Run cancellation per tab; native I/O retains finite bounds.
- Optional enhancements own business-turn recovery decisions; Herdr transports their requested input through Core's bound Host contract.
- Await enhancement preflight before returning a created Tab. Abort stops automatic activity while retaining the terminal; explicit close awaits enhancement stop before native close.
- Keep helpers beside their owner. Add directories when needed, not as empty scaffolding.
- Run `npm run check` for formatting, lint and types; `npm test` checks the quality rules.
