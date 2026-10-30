import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { CreateTabOptions } from "issue-runner-core/terminal";
import { BackendError, Client, record } from "./client.ts";

export interface Target {
  workspace: string;
  tab: string;
  pane: string;
  terminal: string;
}

export class InvalidTargetError extends Error {}

const routingKeys = new Set([
  "HERDR_ENV",
  "HERDR_SOCKET_PATH",
  "HERDR_WORKSPACE_ID",
  "HERDR_TAB_ID",
  "HERDR_PANE_ID",
  "HERDR_BIN_PATH",
]);

function fullyAbsolute(path: string): boolean {
  return (
    isAbsolute(path) &&
    (process.platform !== "win32" ||
      /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(path))
  );
}

function target(value: unknown, client: Client): Target {
  if (
    !record(value) ||
    typeof value.workspace_id !== "string" ||
    !/^w[1-9]\d*$/.test(value.workspace_id) ||
    typeof value.tab_id !== "string" ||
    !new RegExp(`^${value.workspace_id}:t[1-9]\\d*$`).test(value.tab_id) ||
    typeof value.pane_id !== "string" ||
    !new RegExp(`^${value.workspace_id}:p[1-9]\\d*$`).test(value.pane_id) ||
    typeof value.terminal_id !== "string" ||
    !value.terminal_id
  ) {
    throw client.invalidate(
      "Herdr returned an unusable pane/workspace identity",
    );
  }
  return {
    workspace: value.workspace_id,
    tab: value.tab_id,
    pane: value.pane_id,
    terminal: value.terminal_id,
  };
}

export async function initialize() {
  const socketPath = process.env.HERDR_SOCKET_PATH;
  const callerPane = process.env.HERDR_PANE_ID;
  if (
    !socketPath ||
    !fullyAbsolute(socketPath) ||
    socketPath.includes("\0") ||
    !callerPane ||
    !/^w[1-9]\d*:p[1-9]\d*$/.test(callerPane)
  ) {
    throw new Error(
      "Launch Runner inside Herdr 0.9.5 with inherited HERDR_SOCKET_PATH and HERDR_PANE_ID",
    );
  }
  const client = new Client(socketPath);
  const result = await client.request(
    "pane.current",
    { caller_pane_id: callerPane },
    "pane_current",
  );
  const caller = target(result.pane, client);
  if (
    caller.pane !== callerPane ||
    (process.env.HERDR_WORKSPACE_ID &&
      process.env.HERDR_WORKSPACE_ID !== caller.workspace) ||
    (process.env.HERDR_TAB_ID && process.env.HERDR_TAB_ID !== caller.tab)
  ) {
    throw new Error("Herdr caller pane conflicts with inherited host context");
  }
  const workspace = await client.request(
    "workspace.get",
    { workspace_id: caller.workspace },
    "workspace_info",
  );
  if (
    !record(workspace.workspace) ||
    workspace.workspace.workspace_id !== caller.workspace
  ) {
    throw new Error("Herdr caller workspace could not be validated");
  }
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !routingKeys.has(key.toUpperCase()),
    ),
  );
  return {
    client,
    caller,
    async exists(owned: Target): Promise<boolean> {
      let found;
      try {
        found = await client.request(
          "tab.get",
          { tab_id: owned.tab },
          "tab_info",
        );
      } catch (error) {
        if (error instanceof BackendError && error.code === "tab_not_found")
          return false;
        throw error;
      }
      let current;
      try {
        current = await client.request(
          "pane.get",
          { pane_id: owned.pane },
          "pane_info",
        );
      } catch (error) {
        if (error instanceof BackendError && error.code === "pane_not_found") {
          throw new InvalidTargetError(error.message);
        }
        throw error;
      }
      const root = target(current.pane, client);
      if (
        !record(found.tab) ||
        found.tab.tab_id !== owned.tab ||
        found.tab.workspace_id !== owned.workspace ||
        root.workspace !== owned.workspace ||
        root.tab !== owned.tab ||
        root.pane !== owned.pane ||
        root.terminal !== owned.terminal
      ) {
        throw new InvalidTargetError(
          "Owned tab/pane identity changed; target invalidated",
        );
      }
      return true;
    },
    async submit(owned: Target, text: string, key: string) {
      try {
        await client.request(
          "pane.send_input",
          {
            pane_id: owned.pane,
            text,
            keys: ["right", key],
          },
          "ok",
        );
      } catch (error) {
        if (error instanceof BackendError && error.code === "pane_not_found") {
          throw new InvalidTargetError(error.message);
        }
        throw error;
      }
    },
    async close(owned: Target) {
      const listed = await client.request(
        "tab.list",
        { workspace_id: owned.workspace },
        "tab_list",
      );
      if (
        !Array.isArray(listed.tabs) ||
        !listed.tabs.every(
          (item: unknown) =>
            record(item) &&
            item.workspace_id === owned.workspace &&
            typeof item.tab_id === "string" &&
            new RegExp(`^${owned.workspace}:t[1-9]\\d*$`).test(item.tab_id),
        ) ||
        !listed.tabs.some(
          (item: unknown) => record(item) && item.tab_id === owned.tab,
        )
      ) {
        throw client.invalidate(
          "owned tab is unresolved in workspace tab list",
        );
      }
      const ids = new Set(
        listed.tabs.map((item: unknown) =>
          record(item) ? item.tab_id : undefined,
        ),
      );
      if (ids.size !== listed.tabs.length || ids.size < 2) {
        throw new Error(
          "Refusing to close the last tab: Herdr would also close the host workspace",
        );
      }
      await client.request("tab.close", { tab_id: owned.tab }, "ok");
    },
    async create(options: CreateTabOptions): Promise<Target> {
      if (
        !options ||
        typeof options.cwd !== "string" ||
        !fullyAbsolute(options.cwd) ||
        options.cwd.includes("\0")
      ) {
        throw new Error("createTab requires an absolute cwd");
      }
      if (!(await stat(options.cwd)).isDirectory()) {
        throw new Error(`createTab cwd is not a directory: ${options.cwd}`);
      }
      if (
        typeof options.label !== "string" ||
        options.label.includes("\0") ||
        !record(options.env)
      ) {
        throw new Error(
          "createTab requires a display label and a string environment overlay",
        );
      }
      for (const [key, value] of Object.entries(options.env)) {
        if (
          !key ||
          /[=\0]/.test(key) ||
          typeof value !== "string" ||
          value.includes("\0") ||
          routingKeys.has(key.toUpperCase())
        ) {
          throw new Error(
            `createTab invalid or reserved environment key: ${key}`,
          );
        }
      }
      const created = await client.request(
        "tab.create",
        {
          workspace_id: caller.workspace,
          cwd: options.cwd,
          label: options.label,
          env: Object.fromEntries(
            [...Object.entries(inherited), ...Object.entries(options.env)].map(
              ([key, value]) => [
                process.platform === "win32" ? key.toUpperCase() : key,
                value,
              ],
            ),
          ),
          focus: false,
        },
        "tab_created",
      );
      const root = target(created.root_pane, client);
      if (
        !record(created.tab) ||
        created.tab.tab_id !== root.tab ||
        created.tab.workspace_id !== caller.workspace ||
        root.workspace !== caller.workspace ||
        created.tab.pane_count !== 1 ||
        root.tab === caller.tab ||
        root.pane === caller.pane ||
        root.terminal === caller.terminal
      ) {
        throw client.invalidate(
          "tab.create returned an unsafe tab/root-pane association",
        );
      }
      return root;
    },
  };
}

export type Host = Awaited<ReturnType<typeof initialize>>;
