import type {
  EnhancementHost,
  TerminalPlugin,
} from "issue-runner-core/terminal";
import timers from "node:timers/promises";
import { discover } from "./discovery.ts";
import { lifecycle } from "./enhancement.ts";
import { encodeKeys, encodeSubmitKey } from "../herdr/keys.ts";
import {
  InvalidTargetError,
  type Host,
  type Target,
} from "../herdr/targets.ts";

export function operations(
  host: Host,
  agentStartDelay: number,
  enhancements: Record<string, unknown>,
): TerminalPlugin {
  const handles = new WeakMap<object, Target>();
  const startups = new WeakMap<object, Promise<void>>();
  const signals = new WeakMap<object, AbortSignal>();
  const lifecycles = new WeakMap<object, ReturnType<typeof lifecycle>>();
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
  async function onTarget<T>(
    handle: object,
    action: (target: Target, signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    const owned = handles.get(handle);
    if (!owned) throw new Error("Unknown or foreign tab handle");
    if (closed.has(handle)) throw new Error("Owned tab is closed");
    const signal = signals.get(handle);
    signal?.throwIfAborted();
    if (!(await exists(handle, owned))) {
      closed.add(handle);
      throw new Error("Owned tab is absent");
    }
    signal?.throwIfAborted();
    try {
      return await action(owned, signal);
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
      const context = { cwd: options.cwd, env: { ...options.env } };
      const submitKey = options.submitKey;
      const agent = options.agent;
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
      const activity = lifecycle(signal);
      lifecycles.set(handle, activity);
      const bound: EnhancementHost = {
        read() {
          return onTarget(handle, (target, signal) =>
            host.read(target, signal!),
          );
        },
        submitText(text) {
          return plugin.submitText(handle, text, submitKey);
        },
        async sendKeys(keys) {
          const encoded = encodeKeys(keys);
          await onTarget(handle, (target, signal) =>
            host.sendKeys(target, encoded, signal!),
          );
        },
        requestRecovery() {
          return onTarget(handle, () =>
            Promise.reject(new Error("No retained Core recovery wording")),
          );
        },
      };
      try {
        const module = await discover(agent);
        if (module) signals.set(handle, activity.signal);
        else if (signal) signals.set(handle, signal);
        await activity.initialize(module, bound, context, enhancements);
      } catch (error) {
        await activity.stop();
        throw error;
      }
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
      const key = encodeSubmitKey(submitKey);
      if (typeof text !== "string")
        throw new Error("submitText requires a string");
      await onTarget(handle, (target, signal) =>
        host.submit(target, text, key, signal),
      );
    },
    async closeTab(handle) {
      const owned = handles.get(handle);
      if (!owned) throw new Error("Unknown or foreign tab handle");
      await lifecycles.get(handle)!.stop();
      if (closed.has(handle)) return;
      if (await exists(handle, owned)) await host.close(owned);
      closed.add(handle);
    },
  };
  return plugin;
}
