import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  pane,
  targetSteps,
  type Step,
} from "../fixtures/herdr.ts";

for (const operation of ["execute", "submitText", "sendKeys"] as const) {
  for (const fault of ["backend error", "timeout"]) {
    await test(
      `revocation preserves ${operation} ${fault} after partial delivery without replay`,
      { timeout: 2000 },
      async (t) => {
        const events = new EventEmitter();
        const requested = once(events, "requested");
        const release = once(events, "release");
        t.after(() => {
          events.emit("release");
        });
        const sends: Step[] =
          operation === "sendKeys"
            ? ["escape", "shift+enter"].map((key) => ({
                method: "pane.send_input",
                params: { pane_id: pane.pane_id, text: "", keys: [key] },
                result: { type: "ok" },
              }))
            : inputSteps("partial").slice(0, 2);
        sends[1] = {
          ...sends[1]!,
          waitFor: release,
          ...(fault === "backend error"
            ? { error: { code: "input_rejected", message: "native rejection" } }
            : {}),
        };
        const script = [
          ...contextSteps(),
          createStep(),
          ...targetSteps(),
          ...sends,
        ];
        const server = await herdr((request) => {
          const step = script.shift();
          assert.ok(step, `unexpected ${request.method}`);
          if (step.waitFor) events.emit("requested");
          return step;
        });
        t.after(() => server.close());
        const controller = new AbortController();
        const plugin = await createTerminalPlugin();
        const { handle, io } = await plugin.createTab({
          cwd: process.cwd(),
          env: {},
          label: "Partial input",
          submitKey: "Enter",
          signal: controller.signal,
        });
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const rejected = assert.rejects(
          operation === "execute"
            ? plugin.execute(handle, "partial")
            : operation === "submitText"
              ? io.submitText("partial")
              : io.sendKeys(["Escape", "Shift+Enter", "Ctrl+c"]),
          fault === "backend error"
            ? /pane.send_input: input_rejected: native rejection/
            : /pane.send_input: I\/O timed out after 5000 ms/,
        );
        const queued = assert.rejects(io.submitText("queued"), /abort/i);
        await requested;
        controller.abort();
        if (fault === "timeout") t.mock.timers.tick(5000);
        else events.emit("release");
        await Promise.all([rejected, queued]);
        events.emit("release");
        await setImmediate();
        t.mock.timers.tick(60_000);
        await setImmediate();
        assert.equal(script.length, 0);
        assert.equal(server.requests.length, 7);
        assert.deepEqual(
          server.requests
            .filter((request) => request.method === "pane.send_input")
            .map((request) => request.params),
          sends.map((step) => step.params),
        );
      },
    );
  }
}

await test("explicit close after revocation preserves native errors and can be retried", async (t) => {
  const close: Step[] = [
    ...targetSteps(),
    {
      method: "tab.list",
      result: {
        type: "tab_list",
        tabs: [
          { workspace_id: "w1", tab_id: "w1:t1" },
          { workspace_id: "w1", tab_id: "w1:t2" },
        ],
      },
    },
    {
      method: "tab.close",
      params: { tab_id: "w1:t2" },
      result: { type: "ok" },
    },
  ];
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...close.slice(0, -1),
    { ...close[3]!, error: { code: "close_failed", message: "tab retained" } },
    ...close,
  ]);
  t.after(() => server.close());
  const controller = new AbortController();
  const plugin = await createTerminalPlugin();
  const { handle } = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Retained tab",
    submitKey: "Enter",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    plugin.closeTab(handle),
    /tab.close: close_failed: tab retained/,
  );
  await plugin.closeTab(handle);
  await plugin.closeTab(handle);
  assert.equal(server.requests.length, 11);
});
