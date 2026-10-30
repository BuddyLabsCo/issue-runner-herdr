# Code Architecture

```text
/
|-- src/                       # Public exports and plugin assembly
|   |-- plugin/                # createTab, submitText, closeTab; validation, ordering, handle ownership
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
- Keep handles and target associations inside each plugin instance; keep transport and test seams private.
- Core owns workflow, Agent configuration, retries and recovery; this repository owns terminal operations.
- Keep helpers beside their owner. Add directories when needed, not as empty scaffolding.
- Run `npm run check` for formatting, lint and types; `npm test` checks the quality rules.
