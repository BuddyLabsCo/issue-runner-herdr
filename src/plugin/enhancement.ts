import type {
  Enhancement,
  EnhancementContext,
  EnhancementHost,
  EnhancementModule,
} from "issue-runner-core/terminal";
import { record } from "../herdr/client.ts";

export function lifecycle(runSignal?: AbortSignal) {
  const controller = new AbortController();
  let instance: Enhancement | undefined;
  let stopped = false;
  let stopping: Promise<void> | undefined;
  function detach() {
    runSignal?.removeEventListener("abort", cancel);
  }
  function stop(): Promise<void> {
    controller.abort();
    detach();
    if (!instance || stopped) return Promise.resolve();
    stopping ??= Promise.resolve()
      .then(() => instance!.stop())
      .then(() => {
        stopped = true;
      })
      .finally(() => {
        stopping = undefined;
      });
    return stopping;
  }
  function cancel() {
    void stop().catch(() => {
      /* Explicit close can retry a failed stop. */
    });
  }
  runSignal?.addEventListener("abort", cancel, { once: true });
  if (runSignal?.aborted) cancel();
  return {
    get instance() {
      return instance;
    },
    signal: controller.signal,
    stop,
    async initialize(
      module: EnhancementModule | undefined,
      host: EnhancementHost,
      context: EnhancementContext,
      config: unknown,
    ) {
      controller.signal.throwIfAborted();
      if (!module) return;
      const created: unknown = await module.createEnhancement(
        host,
        context,
        config,
      );
      if (record(created) && typeof created.stop === "function")
        instance = created as unknown as Enhancement;
      if (
        !record(created) ||
        !["startMonitoring", "waitUntilReady", "onAssignment", "stop"].every(
          (method) => typeof created[method] === "function",
        )
      )
        throw new Error(
          "Enhancement must provide startMonitoring, waitUntilReady, onAssignment, and stop",
        );
      controller.signal.throwIfAborted();
    },
  };
}
