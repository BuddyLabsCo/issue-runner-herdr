import type { TerminalPlugin } from "issue-runner-core/terminal";
import {
  InvalidTargetError,
  type Host,
  type Target,
} from "../herdr/targets.ts";

export function operations(host: Host): TerminalPlugin {
  const handles = new WeakMap<object, Target>();
  const closed = new WeakSet<object>();
  const invalid = new WeakSet<object>();
  const nativeIds = new Set<string>();
  async function exists(handle: object, native: Target) {
    if (invalid.has(handle)) throw new Error("Owned tab target is invalid");
    try {
      return await host.exists(native);
    } catch (error) {
      if (error instanceof InvalidTargetError) invalid.add(handle);
      throw error;
    }
  }
  return {
    async createTab(options) {
      const native = await host.create(options);
      const ids = [native.tab, native.pane, native.terminal];
      if (ids.some((id) => nativeIds.has(id))) {
        throw host.client.invalidate(
          "tab.create reused a previously issued native target",
        );
      }
      for (const id of ids) nativeIds.add(id);
      const handle = Object.freeze({});
      handles.set(handle, native);
      return handle;
    },
    async submitText(handle, text, submitKey = "Enter") {
      const owned = handles.get(handle);
      if (!owned) throw new Error("Unknown or foreign tab handle");
      if (closed.has(handle)) throw new Error("Owned tab is closed");
      if (submitKey !== "Enter" && submitKey !== "Shift+Enter") {
        throw new Error(`Unsupported submitKey: ${submitKey}`);
      }
      if (typeof text !== "string")
        throw new Error("submitText requires a string");
      if (!(await exists(handle, owned))) {
        closed.add(handle);
        throw new Error("Owned tab is absent");
      }
      try {
        await host.submit(
          owned,
          text,
          submitKey === "Enter" ? "enter" : "shift+enter",
        );
      } catch (error) {
        if (error instanceof InvalidTargetError) invalid.add(handle);
        throw error;
      }
    },
    async closeTab(handle) {
      const owned = handles.get(handle);
      if (!owned) throw new Error("Unknown or foreign tab handle");
      if (closed.has(handle)) return;
      if (await exists(handle, owned)) await host.close(owned);
      closed.add(handle);
    },
  };
}
