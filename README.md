# issue-runner-herdr

Herdr command entry and terminal adapter for [Issue Runner Core](https://github.com/BuddyLabsCo/issue-runner-core). Runner coordinates AI work on GitHub Issues; this package creates native Herdr tabs and transports commands and input.

![Issue Runner demo](https://raw.githubusercontent.com/BuddyLabsCo/issue-runner-core/main/docs/assets/demo.gif)

## Prerequisites

Install [native Herdr](https://github.com/herdrdev/herdr#install). This adapter targets Herdr 0.9.5. Launch Runner inside a live Herdr pane so it inherits that pane's server and identity.

Follow [Core prerequisites](https://github.com/BuddyLabsCo/issue-runner-core#prerequisites) for the remaining tools, credentials, handoff skill and optional Agent enhancements.

## Getting started

Install the terminal command globally; npm installs its exact Core runtime dependency transitively:

```sh
npm install --global issue-runner-herdr
issue-runner-herdr --help
```

The executable is `issue-runner-herdr`. Follow [Core getting started](https://github.com/BuddyLabsCo/issue-runner-core#getting-started) for initialization and Run commands. Configuration-field guidance lives in [Core's configuration template comments](https://github.com/BuddyLabsCo/issue-runner-core/blob/main/templates/config.yaml).

## Troubleshooting

Follow [Core troubleshooting](https://github.com/BuddyLabsCo/issue-runner-core#troubleshooting) for Operator Pause, startup trust blockers, stopped conversations and omitted handoffs.

## Developing the Herdr adapter

Use Node.js 22.18 or later within 22.x and npm 11.x. Install the locked dependencies and run the checks:

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
node --test tests/integration/lifecycle.test.ts
npm run check
npm test
```

Development uses the exact npm Core dependency from the lockfile, without a Core archive or sibling checkout. `npm test` includes the isolated package checks, which need registry access. They install the unchanged artifact, verify its executable and declarations, and relocate a global prefix containing spaces.

Read the [Core public integration contract](https://github.com/BuddyLabsCo/issue-runner-core/blob/main/docs/terminal-contract.md), [Herdr protocol](https://github.com/BuddyLabsCo/issue-runner-herdr/blob/main/docs/herdr-protocol.md) and [Herdr code architecture](https://github.com/BuddyLabsCo/issue-runner-herdr/blob/main/docs/code-architecture.md) for interfaces, native interactions and code placement.
