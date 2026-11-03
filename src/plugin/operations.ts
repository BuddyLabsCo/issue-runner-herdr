import type { TerminalPlugin } from "issue-runner-core/terminal";
import timers from "node:timers/promises";
import { encodeSubmitKey } from "../herdr/keys.ts";
import {
  InvalidTargetError,
  type Host,
  type Target,
} from "../herdr/targets.ts";

export function operations(
  host: Host,
  agentStartDelay: number,
): TerminalPlugin {
  const handles = new WeakMap<object, Target>();
  const startups = new WeakMap<object, Promise<void>>();
  const signals = new WeakMap<object, AbortSignal>();
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
  const plugin: TerminalPlugin = {
    async createTab(options) {
      if (typeof options?.agent !== "string" || !options.agent) {
        throw new Error("createTab requires an opaque agent string");
      }
      if (typeof options.submitKey !== "string") {
        throw new Error("createTab requires a submitKey string");
      }
      encodeSubmitKey(options.submitKey);
      const { signal } = options;
      if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw new Error("createTab signal must be an AbortSignal");
      }
      signal?.throwIfAborted();
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
      if (signal) signals.set(handle, signal);
      return handle;
    },
    async start(handle, command) {
      if (!handles.has(handle))
        throw new Error("Unknown or foreign tab handle");
      if (closed.has(handle)) throw new Error("Owned tab is closed");
      if (invalid.has(handle)) throw new Error("Owned tab target is invalid");
      signals.get(handle)?.throwIfAborted();
      let startup = startups.get(handle);
      if (!startup) {
        startup = plugin
          .submitText(handle, command, "Enter")
          .catch((error: unknown) => {
            startups.delete(handle);
            throw error;
          })
          .then(() =>
            timers.setTimeout(agentStartDelay * 1000, undefined, {
              signal: signals.get(handle),
            }),
          );
        startups.set(handle, startup);
      }
      await startup;
      return undefined;
    },
    async resume(handle, command, sessionref) {
      if (typeof sessionref !== "string")
        throw new Error("resume requires a sessionref string");
      await plugin.start(handle, command);
      return sessionref;
    },
    async submitText(handle, text, submitKey = "Enter") {
      const owned = handles.get(handle);
      if (!owned) throw new Error("Unknown or foreign tab handle");
      if (closed.has(handle)) throw new Error("Owned tab is closed");
      signals.get(handle)?.throwIfAborted();
      const key = encodeSubmitKey(submitKey);
      if (typeof text !== "string")
        throw new Error("submitText requires a string");
      if (!(await exists(handle, owned))) {
        closed.add(handle);
        throw new Error("Owned tab is absent");
      }
      try {
        await host.submit(owned, text, key, signals.get(handle));
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
  return plugin;
}
