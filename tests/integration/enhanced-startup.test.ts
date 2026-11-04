import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import timers from "node:timers/promises";
import { installedPlugin } from "../fixtures/enhancement.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
  pane,
  tab as nativeTab,
} from "../fixtures/herdr.ts";

const options = {
  cwd: process.cwd(),
  env: {},
  label: "Enhanced startup",
  agent: "generic",
  submitKey: "Shift+Enter",
};

await test(
  "enhanced start awaits preflight and monitoring, submits the exact command once with Enter, and returns the established ref without delay",
  { timeout: 10000 },
  async (t) => {
    const installed = await installedPlugin();
    const fixture = await (await installed.install()).fixture();
    t.after(() => installed.close());
    const command =
      "\nagent --model 'configured model'\n 中文 $HOME $(literal) `literal`\n";
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...inputSteps(command),
      ...targetSteps(),
      ...inputSteps("readiness marker", "shift+enter"),
    ]);
    t.after(() => server.close());
    const events = new EventEmitter();
    const preflight = once(events, "preflight");
    const initialized = once(events, "initialized");
    const monitoring = once(events, "monitoring");
    const observed = once(events, "observed");
    t.after(() => {
      events.emit("initialized");
      events.emit("observed");
    });
    fixture.controls.initialize = async () => {
      events.emit("preflight");
      await initialized;
    };
    fixture.controls.monitor = async () => {
      events.emit("monitoring");
      await observed;
    };
    fixture.controls.ready = async (call) => {
      assert.equal(
        server.requests.length,
        8,
        "readiness follows command acknowledgement",
      );
      await call.host.submitText("readiness marker");
      return "native ref 中文";
    };
    const plugin = await installed.plugin.createTerminalPlugin({
      agentStartDelay: 10,
    });
    const creating = plugin.createTab(options);
    await preflight;
    assert.deepEqual(fixture.calls[0]!.monitoring, []);
    events.emit("initialized");
    const tab = await creating;
    const delay = t.mock.method(timers, "setTimeout");
    const starting = plugin.start(tab, command);
    await monitoring;
    assert.equal(
      server.requests.length,
      3,
      "command waits for observation initialization",
    );
    assert.deepEqual(fixture.calls[0]!.monitoring, [undefined]);
    events.emit("observed");
    assert.equal(await starting, "native ref 中文");
    assert.equal(fixture.calls[0]!.readiness, 1);
    assert.equal(delay.mock.callCount(), 0);
    assert.equal(server.requests.length, 13);
  },
);

await test("readiness failure propagates unchanged and a same-Tab retry reuses monitoring and the submitted command", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  t.after(() => installed.close());
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("command"),
  ]);
  t.after(() => server.close());
  const failure = new Error("readiness unavailable");
  fixture.controls.ready = () => Promise.reject(failure);
  const plugin = await installed.plugin.createTerminalPlugin({
    agentStartDelay: 0,
  });
  const tab = await plugin.createTab(options);
  await assert.rejects(
    plugin.start(tab, "command"),
    (error) => error === failure,
  );
  fixture.controls.ready = () => Promise.resolve("established ref");
  assert.equal(
    await plugin.start(tab, "must not be submitted"),
    "established ref",
  );
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.calls[0]!.monitoring, [undefined]);
  assert.equal(fixture.calls[0]!.readiness, 2);
  assert.equal(server.requests.length, 8);
});

for (const phase of ["monitor", "ready"] as const) {
  await test(
    `abort during ${phase} rejects pending startup and later automatic input while preserving a closable Tab`,
    { timeout: 10000 },
    async (t) => {
      const installed = await installedPlugin();
      const fixture = await (await installed.install()).fixture();
      t.after(() => installed.close());
      const server = await herdr([
        ...contextSteps(),
        createStep(),
        ...(phase === "ready"
          ? [...targetSteps(), ...inputSteps("command")]
          : []),
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
      const events = new EventEmitter();
      const entered = once(events, "entered");
      const release = once(events, "release");
      t.after(() => {
        events.emit("release");
      });
      const controller = new AbortController();
      const plugin = await installed.plugin.createTerminalPlugin({
        agentStartDelay: 0,
      });
      const tab = await plugin.createTab({
        ...options,
        signal: controller.signal,
      });
      const pending = async () => {
        events.emit("entered");
        await release;
        return "late ref";
      };
      if (phase === "monitor")
        fixture.controls.monitor = async () => {
          await pending();
        };
      else fixture.controls.ready = pending;
      const starting = plugin.start(tab, "command");
      await entered;
      const rejected = assert.rejects(starting, /abort/i);
      controller.abort();
      await rejected;
      assert.equal(fixture.calls[0]!.stops, 1);
      await assert.rejects(plugin.start(tab, "late command"), /abort/i);
      await assert.rejects(
        fixture.calls[0]!.host.submitText("late marker"),
        /abort/i,
      );
      events.emit("release");
      await plugin.closeTab(tab);
      assert.equal(fixture.calls[0]!.stops, 1);
      assert.equal(fixture.calls[0]!.readiness, phase === "ready" ? 1 : 0);
    },
  );
}

await test("monitoring and command errors allow explicit retry without repeating completed monitoring", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  t.after(() => installed.close());
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
  const failure = new Error("observation unavailable");
  fixture.controls.monitor = () => Promise.reject(failure);
  const plugin = await installed.plugin.createTerminalPlugin({
    agentStartDelay: 0,
  });
  const tab = await plugin.createTab(options);
  await assert.rejects(
    plugin.start(tab, "command"),
    (error) => error === failure,
  );
  assert.equal(server.requests.length, 3);
  delete fixture.controls.monitor;
  await assert.rejects(
    plugin.start(tab, "command"),
    /pane.send_input.*input_rejected.*ordinary rejection/,
  );
  assert.equal(await plugin.start(tab, "command"), "generic-ref");
  assert.deepEqual(fixture.calls[0]!.monitoring, [undefined, undefined]);
  assert.equal(fixture.calls[0]!.readiness, 1);
});

await test(
  "each owned Tab retains its own startup and readiness when another Tab is cancelled",
  { timeout: 10000 },
  async (t) => {
    const installed = await installedPlugin();
    const fixture = await (await installed.install()).fixture();
    t.after(() => installed.close());
    const otherTab = { ...nativeTab, tab_id: "w1:t3" };
    const otherPane = {
      ...pane,
      tab_id: "w1:t3",
      pane_id: "w1:p3",
      terminal_id: "other-terminal",
    };
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      {
        method: "tab.create",
        result: { type: "tab_created", tab: otherTab, root_pane: otherPane },
      },
      ...targetSteps(),
      ...inputSteps("first command"),
      {
        method: "tab.get",
        params: { tab_id: "w1:t3" },
        result: { type: "tab_info", tab: otherTab },
      },
      {
        method: "pane.get",
        params: { pane_id: "w1:p3" },
        result: { type: "pane_info", pane: otherPane },
      },
      ...inputSteps("second command", "enter", "w1:p3"),
      {
        method: "tab.get",
        params: { tab_id: "w1:t3" },
        result: { type: "tab_info", tab: otherTab },
      },
      {
        method: "pane.get",
        params: { pane_id: "w1:p3" },
        result: { type: "pane_info", pane: otherPane },
      },
      ...inputSteps("second marker", "shift+enter", "w1:p3"),
    ]);
    t.after(() => server.close());
    const events = new EventEmitter();
    const entered = once(events, "entered");
    const release = once(events, "release");
    t.after(() => {
      events.emit("release");
    });
    fixture.controls.ready = async (call) => {
      if (call === fixture.calls[0]) {
        events.emit("entered");
        await release;
        return "first ref";
      }
      await call.host.submitText("second marker");
      return "second ref";
    };
    const plugin = await installed.plugin.createTerminalPlugin({
      agentStartDelay: 0,
    });
    const controller = new AbortController();
    const first = await plugin.createTab({
      ...options,
      signal: controller.signal,
    });
    const second = await plugin.createTab(options);
    const starting = plugin.start(first, "first command");
    await entered;
    const rejected = assert.rejects(starting, /abort/i);
    controller.abort();
    await rejected;
    assert.equal(await plugin.start(second, "second command"), "second ref");
    assert.equal(fixture.calls[0]!.stops, 1);
    assert.equal(fixture.calls[1]!.stops, 0);
    assert.deepEqual(
      fixture.calls.map((call) => call.monitoring),
      [[undefined], [undefined]],
    );
    assert.equal(
      server.requests.filter((request) => request.method === "tab.create")
        .length,
      2,
    );
  },
);
