# issue-runner-herdr

Herdr terminal execution environment plugin for
[issue-runner-core](https://github.com/BuddyLabsCo/issue-runner-core).

## Status

Design only. No plugin implementation or npm package is available yet.
The shared design is maintained in the Core repository; review its
[initial design proposal](https://github.com/BuddyLabsCo/issue-runner-core/pull/2).

## Intended usage

Run the Core-owned command from a terminal inside Herdr:

```sh
issue-runner run --env herdr
```

The target installation experience is:

```sh
npm install --save-dev issue-runner-core issue-runner-herdr
npx issue-runner run --env herdr
```

Without a prior project installation:

```sh
npx --package=issue-runner-core --package=issue-runner-herdr issue-runner run --env herdr
```

These are planned commands for unpublished packages, not an available product.
This plugin does not provide a separate `herdr-runner` executable.

## Responsibility

Implement Core's generic terminal contracts using Herdr:

- Connect to the intended Herdr server/workspace and capture explicit target
  identities instead of following UI focus.
- Create an Agent terminal in the assigned Worktree with the assigned
  environment and label.
- Execute the configured interactive start or resume command.
- Submit Core-prepared text separately from process startup and provide the
  required terminal-key operations.
- Expose relevant terminal/process/connection lifecycle information and
  diagnostic content where needed.
- Close only the intended Runner-owned terminal and report errors or
  uncertainty.

Core owns issue selection, Worktrees, prompts, Agent command configuration,
native session-reference handoffs, task-result files, JSON/Git verification,
retries, Review, CI, Pull Requests, recovery, and all shared workflow policy.

The plugin has no Agent brand allowlist and does not infer task completion
from Herdr's Agent badges or screen detection. It need not use Agent-specific
Herdr launch APIs: ordinary terminal operations are the required foundation.
Operators interact directly with the native CLI while Core waits for its
assigned file handoff.

## Initial validation

Implementation must prove startup/input ordering, correct cwd and environment,
multiline prompt submission, operator intervention, exact terminal targeting,
closure/error behavior, and local plus `npx` plugin discovery. Session Probe,
task-result validation, and end-to-end workflow acceptance remain shared Core
contracts rather than duplicated Herdr workflow logic.
