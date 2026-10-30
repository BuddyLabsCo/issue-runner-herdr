# Herdr 0.9.5 protocol mapping

The implementation targets release commit
`2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`, without later-version capability
negotiation. These are source-derived protocol facts, not real-terminal test
results from this repository.

| Plugin operation | Herdr requests |
| --- | --- |
| Factory | `pane.current {caller_pane_id}`, `workspace.get {workspace_id}` |
| Create | `tab.create {workspace_id, cwd, label, env, focus: false}` |
| Target validation | `tab.get {tab_id}`, `pane.get {pane_id}` |
| Submit | `pane.send_input {pane_id, text, keys: ["right", "enter"]}` or `["right", "shift+enter"]` |
| Close | Target validation, `tab.list {workspace_id}`, `tab.close {tab_id}` |

Each ordinary request uses a new local connection with one UTF-8 JSON line:
`{id, method, params}`. The response is `{id, result: {type, ...}}` or
`{id, error: {code, message}}`. The adapter checks correlation and result type,
uses a total deadline, and treats an incomplete or malformed reply as a lost
context. A successful request's normal connection close is not connection loss.

The inherited socket path is a Unix filesystem socket on Linux/macOS. On Windows,
Herdr's `GenericNamespaced` mapping prepends `\\.\pipe\` to that path. No TCP
fallback or default socket discovery is used.

Tab creation returns both `tab` and `root_pane`. The plugin records the public tab,
pane, workspace, and terminal IDs; labels are never identities. Herdr injects
managed pane routing after explicit environment overrides. The plugin excludes
inherited routing keys from its launch overlay and rejects explicit routing
overrides so new tabs receive Herdr's own context.

The generic input encoder appends encoded keys after the complete text body.
It owns bracketed-paste encoding according to the target terminal's mode. The
plugin therefore sends generic `pane.send_input` rather than raw `pane.send_text`,
Agent-specific APIs, separate line submissions, or rewritten newline characters.

The optional public `submitKey` string names one chord, mapped case-insensitively
to `enter` (the default) or `shift+enter`. Other chords, whitespace, key scripts,
and raw backend encodings reject locally before target queries or input. The
mapping stays private to the Herdr adapter. Each request carries the complete
unchanged canonical-LF text plus `["right", selectedChord]`, so the body precedes
mandatory Right and the final chord. Commands and prompts use the same operation
in separate calls; Core supplies complete start/resume text and chooses each
call's final chord.

Herdr's targeted `tab.close` closes the workspace when the tab is its last one.
The plugin lists the captured workspace's tabs before closing and refuses that
case. This is a preflight guard, not an atomic backend transaction.

## Primary sources

- [Request framing and response parsing](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/api/client.rs)
- [Server request limits and one-request connections](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/api/server.rs)
- [Response envelopes](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/api/schema/response.rs)
- [Caller-aware pane resolution](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/app/api/panes.rs)
- [Tab creation and closure](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/app/api/tabs.rs)
- [Managed launch environment](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/pane.rs)
- [Socket and binary environment injection](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/integration/env.rs)
- [Input encoding](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/app/api_helpers.rs)
- [Logical key parsing](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/config/keybinds.rs)
- [Windows socket namespace mapping](https://docs.rs/interprocess/2.4.4/interprocess/local_socket/enum.GenericNamespaced.html)
