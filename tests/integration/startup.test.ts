import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import timers, { setImmediate } from "node:timers/promises";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
} from "../fixtures/herdr.ts";

await test("base start submits the unchanged command once with Enter and returns no ref", async (t) => {
  const command =
    "\nagent --model 'configured model'\n  中文 $HOME $(literal) `literal`\n";
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps(command),
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin({
    agentStartDelay: 0,
    enhancements: { privateSetting: { retained: true } },
  });
  const tab = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Startup",
    agent: "opaque Agent / identifier",
    submitKey: "Shift+Enter",
  });
  assert.equal(server.requests.length, 3, "creation must not launch the Agent");
  assert.deepEqual(
    await Promise.all([plugin.start(tab, command), plugin.start(tab, command)]),
    [undefined, undefined],
  );
  assert.equal(await plugin.start(tab, command), undefined);
  assert.equal(server.requests.length, 8);
});

await test("base resume returns the exact supplied ref without probing or replaying the command", async (t) => {
  const command = "agent resume 'saved ref 中文' --option='$HOME'";
  const ref = "saved ref 中文";
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps(command),
    ...targetSteps(),
    ...inputSteps("prompt", "shift+enter"),
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin({ agentStartDelay: 0 });
  const tab = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Resume",
    agent: "opaque",
    submitKey: "Shift+Enter",
  });
  assert.equal(await plugin.resume(tab, command, ref), ref);
  assert.equal(await plugin.resume(tab, command, ref), ref);
  await plugin.submitText(
    tab,
    "prompt",
    "Shift+Enter",
    "/exact/handoff.json",
    "retained recovery",
  );
  assert.equal(server.requests.length, 13);
});

for (const config of [undefined, {}, { agentStartDelay: 0.05 }]) {
  await test(
    `startup delay begins after completed submission: ${JSON.stringify(config)}`,
    { timeout: 2000 },
    async (t) => {
      const gates = new EventEmitter();
      const requested = once(gates, "requested");
      const release = once(gates, "release");
      t.after(() => {
        gates.emit("release");
      });
      const script = [
        ...contextSteps(),
        createStep(),
        ...targetSteps(),
        ...inputSteps("command"),
      ];
      script[7]!.waitFor = release;
      const server = await herdr((request) => {
        const step = script.shift();
        assert.ok(step, `unexpected ${request.method}`);
        if (!script.length) gates.emit("requested");
        return step;
      });
      t.after(() => server.close());
      const plugin = await createTerminalPlugin(config);
      const tab = await plugin.createTab({
        cwd: process.cwd(),
        env: {},
        label: "Delay",
        agent: "opaque",
        submitKey: "Enter",
      });
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const waiting = t.mock.method(timers, "setTimeout");
      let settled = false;
      const starting = plugin.start(tab, "command").then((result) => {
        settled = true;
        return result;
      });
      await requested;
      t.mock.timers.tick(1000);
      assert.equal(settled, false);
      gates.emit("release");
      while (!waiting.mock.callCount()) await setImmediate();
      const delay = config?.agentStartDelay === undefined ? 10000 : 50;
      t.mock.timers.tick(delay - 1);
      await setImmediate();
      assert.equal(settled, false);
      t.mock.timers.tick(1);
      assert.equal(await starting, undefined);
      assert.equal(server.requests.length, 8);
    },
  );
}

await test(
  "abort interrupts startup delay, rejects further input, and leaves the owned tab closable",
  { timeout: 2000 },
  async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...inputSteps("command"),
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
      { method: "tab.close", result: { type: "ok" } },
    ]);
    t.after(() => server.close());
    const controller = new AbortController();
    const plugin = await createTerminalPlugin({ agentStartDelay: 10 });
    const tab = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Abort",
      agent: "opaque",
      submitKey: "Enter",
      signal: controller.signal,
    });
    const waiting = t.mock.method(timers, "setTimeout");
    const starting = plugin.start(tab, "command");
    while (!waiting.mock.callCount()) await setImmediate();
    const rejected = assert.rejects(starting, /abort/i);
    controller.abort();
    await rejected;
    await assert.rejects(plugin.start(tab, "command"), /abort/i);
    await assert.rejects(plugin.submitText(tab, "no follow-up"), /abort/i);
    assert.equal(server.requests.length, 8);
    await plugin.closeTab(tab);
    assert.equal(server.requests.length, 12);
  },
);

for (const phase of ["before startup", "target lookup", "body", "Right"]) {
  await test(
    `abort at ${phase} prevents subsequent startup input`,
    { timeout: 2000 },
    async (t) => {
      const controller = new AbortController();
      const gates = new EventEmitter();
      const requested = once(gates, "requested");
      const release = once(gates, "release");
      t.after(() => {
        gates.emit("release");
      });
      const all = [
        ...contextSteps(),
        createStep(),
        ...targetSteps(),
        ...inputSteps("command"),
      ];
      const count = {
        "before startup": 3,
        "target lookup": 5,
        body: 6,
        Right: 7,
      }[phase]!;
      const script = all.slice(0, count);
      if (phase !== "before startup") script[count - 1]!.waitFor = release;
      const server = await herdr((request) => {
        const step = script.shift();
        assert.ok(step, `unexpected ${request.method}`);
        if (!script.length) gates.emit("requested");
        return step;
      });
      t.after(() => server.close());
      const plugin = await createTerminalPlugin({ agentStartDelay: 0 });
      const tab = await plugin.createTab({
        cwd: process.cwd(),
        env: {},
        label: "Abort",
        agent: "opaque",
        submitKey: "Enter",
        signal: controller.signal,
      });
      if (phase === "before startup") controller.abort();
      const rejected = assert.rejects(plugin.start(tab, "command"), /abort/i);
      await requested;
      controller.abort();
      gates.emit("release");
      await rejected;
      await assert.rejects(
        plugin.resume(tab, "command", "exact-ref"),
        /abort/i,
      );
      assert.equal(server.requests.length, count);
    },
  );
}

await test("an ordinary startup submission rejection preserves its error and allows an explicit retry", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.send_input",
      error: { code: "input_rejected", message: "ordinary rejection" },
    },
    ...targetSteps(),
    ...inputSteps("command"),
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin({ agentStartDelay: 0 });
  const tab = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Retry",
    agent: "opaque",
    submitKey: "Enter",
  });
  await assert.rejects(
    plugin.start(tab, "command"),
    /pane.send_input.*input_rejected.*ordinary rejection/,
  );
  assert.equal(await plugin.start(tab, "command"), undefined);
  assert.equal(await plugin.start(tab, "command"), undefined);
  assert.equal(server.requests.length, 11);
});
