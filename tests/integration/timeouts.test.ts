import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  caller,
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  tab,
  targetSteps,
  type Step,
} from "../fixtures/herdr.ts";

await test(
  "initialization bounds a connection that never opens and destroys its socket",
  { timeout: 2000 },
  async (t) => {
    const server = await herdr([]);
    t.after(() => server.close());
    const socket = new net.Socket();
    t.mock.method(net, "createConnection", () => socket);
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      socket.destroy();
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const cleared = t.mock.method(globalThis, "clearTimeout");
    const rejected = assert.rejects(
      createTerminalPlugin(),
      /Launch Runner inside.*pane.current: I\/O timed out after 5000 ms/,
    );
    t.mock.timers.tick(5000);
    await rejected;
    assert.equal(socket.destroyed, true);
    assert.equal(cleared.mock.callCount(), 1);
    assert.deepEqual(server.requests, []);
  },
);

const lifecycle: Step[] = [
  ...contextSteps(),
  createStep(),
  ...targetSteps(),
  ...inputSteps("once\n\n  \u4e2d\u6587 $HOME"),
  ...targetSteps(),
  {
    method: "tab.list",
    params: { workspace_id: "w1" },
    result: { type: "tab_list", tabs: [caller, tab] },
  },
  {
    method: "tab.close",
    params: { tab_id: "w1:t2" },
    result: { type: "ok" },
  },
];

for (const [index, fault] of lifecycle.entries()) {
  for (const partial of [false, true]) {
    const name =
      index >= 5 && index <= 7
        ? ["body", "Right", "Enter"][index - 5]
        : fault.method;
    await test(
      `${name} at lifecycle request ${index + 1} bounds a ${partial ? "partial" : "silent"} reply without replay`,
      { timeout: 2000 },
      async (t) => {
        const gates = new EventEmitter();
        const requested = once(gates, "requested");
        const release = once(gates, "release");
        t.after(() => {
          gates.emit("release");
        });
        const script = lifecycle.slice(0, index);
        script.push({
          ...fault,
          ...(partial ? { raw: '{"id":', stall: true } : { waitFor: release }),
        });
        const server = await herdr((request) => {
          const step = script.shift();
          assert.ok(step, `unexpected ${request.method}`);
          if (!script.length) gates.emit("requested");
          return step;
        });
        t.after(() => server.close());
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const cleared = t.mock.method(globalThis, "clearTimeout");
        let settled = false;
        async function run() {
          const plugin = await createTerminalPlugin();
          const handle = await plugin.createTab({
            cwd: process.cwd(),
            env: {},
            label: "Issue",
          });
          await plugin.submitText(handle, "once\n\n  \u4e2d\u6587 $HOME");
          await plugin.closeTab(handle);
        }
        const rejected = assert.rejects(
          run().finally(() => {
            settled = true;
          }),
          new RegExp(`${fault.method}: I/O timed out after 5000 ms`),
        );
        await requested;
        await setImmediate();
        t.mock.timers.tick(4999);
        assert.equal(settled, false);
        t.mock.timers.tick(1);
        await rejected;
        assert.equal(server.requests.length, index + 1);
        assert.equal(cleared.mock.callCount(), index + 1);
        const methods = server.requests.map((request) => request.method);
        assert.deepEqual(
          methods,
          lifecycle.slice(0, index + 1).map((step) => step.method),
        );
        gates.emit("release");
        await setImmediate();
        t.mock.timers.tick(60_000);
        await setImmediate();
        assert.equal(server.requests.length, index + 1);
        assert.equal(cleared.mock.callCount(), index + 1);
        assert.equal(script.length, 0);
      },
    );
  }
}
