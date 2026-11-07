# Herdr protocol

## Native interfaces used

The adapter targets [Herdr 0.9.5](https://github.com/herdrdev/herdr/tree/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01). These interfaces describe current adapter behavior, not live-terminal acceptance results.

| Interface | Parameters used | Purpose |
| --- | --- | --- |
| `pane.current` | `caller_pane_id` | Resolve the inherited Runner pane and check optional inherited workspace/tab IDs |
| `workspace.get` | `workspace_id` | Validate the Runner workspace before creating resources |
| `tab.create` | `workspace_id`, `cwd`, `label`, `env`, `focus: false` | Create an interactive tab in the captured workspace and record its validated `tab` and `root_pane` identities |
| `tab.get` | `tab_id` | Validate the owned tab before I/O or closure |
| `pane.get` | `pane_id` | Validate the owned pane, or revalidate Runner when confirming an owned tab's absence |
| `pane.send_input` | `pane_id`, `text`, `keys` | Send a complete literal body or one encoded logical chord; native Herdr handles bracketed paste |
| `pane.read` | `pane_id`, `source: "visible"`, `format: "text"`, `strip_ansi: true` | Read the current visible screen and validate returned identities, source, format and text |
| `tab.list` | `workspace_id` | Guard against last-tab closure and confirm absence with an unambiguous workspace list |
| `tab.close` | `tab_id` | Close only the owned native tab; acknowledgement does not prove process or descendant exit |

[Local protocol requests](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/api/client.rs) use one connection per UTF-8 JSON line: `{id, method, params}`. Replies must correlate `id` and contain either `result: {type, ...}` or `error: {code, message}`. Each request has a total five-second deadline and a 1 MiB request/reply limit. Linux/macOS use the inherited Unix socket path. [Windows namespace mapping](https://docs.rs/interprocess/2.4.4/interprocess/local_socket/enum.GenericNamespaced.html) prepends `\\.\pipe\` to it. There is no TCP fallback or default-server discovery.

[Public native IDs](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/workspace.rs) use `123456789ABCDEFGHJKMNPQRSTVWXYZ0`, including multi-character suffixes. The adapter validates workspace prefixes and keeps workspace, tab, pane and terminal identities private. Labels and UI focus never select targets.

## Interaction sequences

### Initialize and create a tab

```mermaid
%%{init: {"sequence": {"width": 250, "wrap": true}}}%%
sequenceDiagram
    participant H as Herdr (the plugin)
    participant N as Native Herdr
    Note over H: Capture inherited environment, HERDR_SOCKET_PATH and HERDR_PANE_ID
    Note over H: Reject missing or malformed context before requests
    H->>N: pane.current {caller_pane_id}
    N-->>H: pane_current with Runner identities
    Note over H: Check pane and optional inherited workspace/tab IDs
    H->>N: workspace.get {workspace_id}
    N-->>H: workspace_info
    Note over H: Validate workspace, initialization creates no resources
    Note over H: Validate and capture cwd, label, env and submitKey
    Note over H: cwd must be an existing absolute host directory<br/>POSIX path, Windows drive path or UNC path
    Note over H: Exclude inherited routing keys, reject explicit routing overrides<br/>Preserve literal values, Windows env names are case-insensitive
    H->>N: tab.create {workspace_id, cwd, label, env, focus: false}
    Note over N: Inject managed routing context for the new pane
    N-->>H: tab_created {tab, root_pane}
    Note over H: Validate unique tab, root pane and terminal identities<br/>Return an owned handle and bound I/O, launch no command
    Note over H,N: A rejected or lost creation reply can leave a native tab<br/>Never guess its identity or replay creation
```

### Validate targets, submit input and read output

```mermaid
%%{init: {"sequence": {"width": 250, "wrap": true}}}%%
sequenceDiagram
    participant H as Herdr (the plugin)
    participant N as Native Herdr
    Note over H: Commands, text and keys enter one queue per tab<br/>Reads bypass the queue, other tabs remain independent
    Note over H: Reject foreign, closed, invalid or revoked handles<br/>Validate all logical keys before native queries
    H->>N: tab.get {tab_id: owned tab}
    N-->>H: tab_info
    H->>N: pane.get {pane_id: owned root pane}
    N-->>H: pane_info
    Note over H: Require recorded workspace, tab, pane and terminal identities<br/>Changed targets invalidate the handle, never adopt a replacement
    alt Revoked before first input send, including during target checks
        Note over H: Reject without sending input, retain tab for manual takeover
    else Command or bound text submission
        H->>N: pane.send_input {pane_id, text: complete unchanged body, keys: []}
        N-->>H: ok
        H->>N: pane.send_input {pane_id, text: empty, keys: [right]}
        N-->>H: ok
        H->>N: pane.send_input {pane_id, text: empty, keys: [submit chord]}
        N-->>H: ok
        Note over H: Commands use Enter, bound text uses captured Enter or Shift+Enter<br/>Resolve on acknowledgement, not Agent acceptance or process exit
    else Ordered logical keys
        loop Each validated chord
            H->>N: pane.send_input {pane_id, text: empty, keys: [chord]}
            N-->>H: ok
        end
    else Bound screen read
        H->>N: pane.read {pane_id, source: visible, format: text, strip_ansi: true}
        N-->>H: pane_read with identities and visible text
        Note over H: Recheck revocation and validate reply before returning text<br/>No scrollback or streaming
    end
    Note over H,N: Await each acknowledgement, native failure stops remaining sends<br/>Once input starts, cancellation alone lets the full sequence settle<br/>Keep its queue slot until completion or native error, later revoked input sends nothing
    Note over H,N: Identity checks and mutations are not atomic<br/>A restart reusing every checked identity can go undetected
```

### Close an owned tab or confirm absence

```mermaid
%%{init: {"sequence": {"width": 250, "wrap": true}}}%%
sequenceDiagram
    participant H as Herdr (the plugin)
    participant N as Native Herdr
    Note over H: Explicit close remains usable after revocation<br/>Unknown handles reject, already closed handles succeed locally
    H->>N: tab.get {tab_id: owned tab}
    alt Owned tab is present
        N-->>H: tab_info
        H->>N: pane.get {pane_id: owned root pane}
        N-->>H: pane_info
        Note over H: Validate all recorded target identities
        H->>N: tab.list {workspace_id}
        N-->>H: tab_list
        Note over H: Require owned tab in a valid, unique workspace list<br/>Refuse last-tab closure, which would close the workspace
        alt Safe to close
            H->>N: tab.close {tab_id: owned tab}
            alt Close succeeds
                N-->>H: ok
                Note over H: Retire handle
            else Close fails
                N-->>H: error
                Note over H: Reject, ordinary errors permit explicit retry on the same handle
            end
        else Unsafe or unresolved tab list
            Note over H: Reject without closing
        end
    else Lookup reports tab_not_found
        N-->>H: error {code: tab_not_found, message}
        H->>N: pane.get {pane_id: captured Runner pane}
        N-->>H: pane_info
        Note over H: Require original Runner workspace, tab, pane and terminal
        H->>N: tab.list {workspace_id}
        N-->>H: tab_list
        Note over H: Require unique valid list containing Runner and excluding owned tab<br/>Retire handle without a close request
    else Other lookup failure
        N-->>H: error
        Note over H: Reject, failure is not proof of absence
    end
    Note over H,N: Last-tab guard is a preflight check, not an atomic transaction<br/>Core owns enhancement cleanup, the plugin never invokes it
```

### Settle requests and handle protocol loss

```mermaid
%%{init: {"sequence": {"width": 250, "wrap": true}}}%%
sequenceDiagram
    participant H as Herdr (the plugin)
    participant N as Native Herdr
    H->>N: Open local connection and send {id, method, params} plus newline
    alt Complete correlated result of expected type
        N-->>H: {id, result: {type, ...}} plus newline
        Note over H: Resolve request
    else Correlated backend rejection
        N-->>H: {id, error: {code, message}} plus newline
        Note over H: Reject with method, code and message<br/>Ordinary rejection leaves other live associations usable
    else Disconnect, malformed reply, oversized reply or five-second deadline
        N--xH: No valid complete response
        Note over H: Invalidate instance, reject all pending socket operations<br/>Old handles cannot reconnect or transfer to a new instance
    end
    Note over H: On settlement, clear timer, destroy socket and remove pending request<br/>Late replies cannot resume rejected input
    Note over H,N: Lost replies can leave mutations uncertain, no rollback or automatic replay<br/>A fresh factory needs valid inherited context, Core owns recovery
```
