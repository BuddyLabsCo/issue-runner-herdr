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
  const environment = { ...process.env };
  // Preserve Windows' case-insensitive lookup for inherited routing identities.
  const socketPath = process.env.HERDR_SOCKET_PATH;
  const callerPane = process.env.HERDR_PANE_ID;
  const inheritedWorkspace = process.env.HERDR_WORKSPACE_ID;
  const inheritedTab = process.env.HERDR_TAB_ID;
  if (
    !socketPath ||
    !fullyAbsolute(socketPath) ||
    socketPath.includes("\0") ||
    !callerPane ||
    !/^w[1-9]\d*:p[1-9]\d*$/.test(callerPane)
  ) {
    throw new Error(
      "Herdr host context is missing or malformed. Launch Runner inside Herdr 0.9.5 with inherited HERDR_SOCKET_PATH and HERDR_PANE_ID",
    );
  }
  const client = new Client(socketPath);
  let caller: Target;
  try {
    const result = await client.request(
      "pane.current",
      { caller_pane_id: callerPane },
      "pane_current",
    );
    caller = target(result.pane, client);
    if (
      caller.pane !== callerPane ||
      (inheritedWorkspace !== undefined &&
        inheritedWorkspace !== caller.workspace) ||
      (inheritedTab !== undefined && inheritedTab !== caller.tab)
    ) {
      throw new Error(
        "Herdr caller pane conflicts with inherited host context",
      );
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
  } catch (error) {
    throw new Error(
      `Herdr host context could not be initialized. Launch Runner inside Herdr 0.9.5 with inherited HERDR_SOCKET_PATH and HERDR_PANE_ID from the same live pane/server: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) =>
        value !== undefined && !routingKeys.has(key.toUpperCase()),
    ),
  );
  async function tabIds() {
    const listed = await client.request(
      "tab.list",
      { workspace_id: caller.workspace },
      "tab_list",
    );
    if (
      !Array.isArray(listed.tabs) ||
      !listed.tabs.every(
        (item: unknown) =>
          record(item) &&
          item.workspace_id === caller.workspace &&
          typeof item.tab_id === "string" &&
          new RegExp(`^${caller.workspace}:t[1-9]\\d*$`).test(item.tab_id),
      )
    ) {
      throw client.invalidate("workspace tab list is malformed");
    }
    const ids = new Set(
      listed.tabs.map((item: unknown) =>
        record(item) ? item.tab_id : undefined,
      ),
    );
    if (ids.size !== listed.tabs.length) {
      throw client.invalidate("workspace tab list is ambiguous");
    }
    return ids;
  }
  async function confirmAbsence(owned: Target) {
    const current = await client.request(
      "pane.get",
      { pane_id: caller.pane },
      "pane_info",
    );
    const runner = target(current.pane, client);
    if (
      runner.workspace !== caller.workspace ||
      runner.tab !== caller.tab ||
      runner.pane !== caller.pane ||
      runner.terminal !== caller.terminal
    ) {
      throw new InvalidTargetError("Runner context identity changed");
    }
    const ids = await tabIds();
    if (!ids.has(caller.tab) || ids.has(owned.tab)) {
      throw new InvalidTargetError(
        "Owned tab absence is unresolved in workspace tab list",
      );
    }
  }
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
        if (!(error instanceof BackendError) || error.code !== "tab_not_found")
          throw error;
        await confirmAbsence(owned);
        return false;
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
            keys: [],
          },
          "ok",
        );
        for (const chord of ["right", key]) {
          await client.request(
            "pane.send_input",
            { pane_id: owned.pane, text: "", keys: [chord] },
            "ok",
          );
        }
      } catch (error) {
        if (error instanceof BackendError && error.code === "pane_not_found") {
          throw new InvalidTargetError(error.message);
        }
        throw error;
      }
    },
    async close(owned: Target) {
      const ids = await tabIds();
      if (!ids.has(owned.tab)) {
        throw client.invalidate(
          "owned tab is unresolved in workspace tab list",
        );
      }
      if (ids.size < 2) {
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
      const { cwd, label, env } = options;
      if (typeof label !== "string" || label.includes("\0") || !record(env)) {
        throw new Error(
          "createTab requires a display label and a string environment overlay",
        );
      }
      const overlay = Object.entries(env);
      for (const [key, value] of overlay) {
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
      if (!(await stat(cwd)).isDirectory()) {
        throw new Error(`createTab cwd is not a directory: ${cwd}`);
      }
      const created = await client.request(
        "tab.create",
        {
          workspace_id: caller.workspace,
          cwd,
          label,
          env: Object.fromEntries(
            new Map(
              [...Object.entries(inherited), ...overlay].map((entry) => [
                process.platform === "win32"
                  ? entry[0].toUpperCase()
                  : entry[0],
                entry,
              ]),
            ).values(),
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
