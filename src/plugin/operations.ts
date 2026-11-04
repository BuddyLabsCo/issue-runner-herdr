import type { TerminalPlugin, TerminalIO } from "issue-runner-core/terminal";
import { encodeKeys, encodeSubmitKey } from "../herdr/keys.ts";
import {
  InvalidTargetError,
  type Host,
  type Target,
} from "../herdr/targets.ts";

export function operations(host: Host): TerminalPlugin {
  const handles = new WeakMap<object, Target>();
  const signals = new WeakMap<object, AbortSignal>();
  const inputs = new WeakMap<object, Promise<void>>();
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
  async function automatic<T>(handle: object, action: () => Promise<T>) {
    const signal = signals.get(handle)!;
    signal.throwIfAborted();
    let cancel!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => {
        reject(new DOMException("Automatic activity aborted", "AbortError"));
      };
      signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      const result = await Promise.race([action(), aborted]);
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  async function input(
    handle: object,
    action: (target: Target, signal: AbortSignal | undefined) => Promise<void>,
  ) {
    const signal = signals.get(handle);
    signal?.throwIfAborted();
    const pending = (inputs.get(handle) ?? Promise.resolve()).then(() =>
      onTarget(handle, action),
    );
    inputs.set(
      handle,
      pending.catch(() => {
        // A failed send must not block subsequent explicit input.
      }),
    );
    return signal ? automatic(handle, () => pending) : pending;
  }
  return {
    async createTab(options) {
      if (typeof options?.submitKey !== "string") {
        throw new Error("createTab requires a submitKey string");
      }
      const submitKey = encodeSubmitKey(options.submitKey);
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
      const io: TerminalIO = {
        read() {
          return onTarget(handle, (target, signal) =>
            host.read(target, signal),
          );
        },
        async submitText(text) {
          if (typeof text !== "string")
            throw new Error("submitText requires a string");
          await input(handle, (target, signal) =>
            host.submit(target, text, submitKey, signal),
          );
        },
        async sendKeys(keys) {
          const encoded = encodeKeys(keys);
          await input(handle, (target, signal) =>
            host.sendKeys(target, encoded, signal),
          );
        },
      };
      return { handle, io };
    },
    async execute(handle, command) {
      if (typeof command !== "string")
        throw new Error("execute requires a string");
      await input(handle, (target, signal) =>
        host.submit(target, command, "enter", signal),
      );
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
