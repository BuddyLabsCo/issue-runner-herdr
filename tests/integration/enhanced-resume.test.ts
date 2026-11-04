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
  label: "Enhanced resume",
  agent: "generic",
  submitKey: "Shift+Enter",
};

await test("enhanced resume forwards and returns the exact ref, submitting the unchanged command with Enter before readiness and without delay", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  t.after(() => installed.close());
  const ref = "saved ref 中文 / 'opaque'";
  const command =
    "\nagent resume 'configured identity' --model='configured model'\n 中文 $HOME $(literal) `literal`\n";
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps(command),
  ]);
  t.after(() => server.close());
  fixture.controls.monitor = () => {
    assert.equal(server.requests.length, 3, "monitoring precedes input");
    return Promise.resolve();
  };
  fixture.controls.ready = () => {
    assert.equal(server.requests.length, 8, "readiness follows command input");
    return Promise.resolve(ref);
  };
  const plugin = await installed.plugin.createTerminalPlugin({
    agentStartDelay: 0,
  });
  const tab = await plugin.createTab(options);
  const delay = t.mock.method(timers, "setTimeout");
  assert.equal(await plugin.resume(tab, command, ref), ref);
  assert.deepEqual(fixture.calls[0]!.monitoring, [ref]);
  assert.equal(fixture.calls[0]!.readiness, 1);
  assert.equal(delay.mock.callCount(), 0);
  assert.equal(server.requests.length, 8);
});

await test(
  "resume awaits preflight and observation initialization before sending any command input",
  { timeout: 10000 },
  async (t) => {
    const installed = await installedPlugin();
    const fixture = await (await installed.install()).fixture();
    t.after(() => installed.close());
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...inputSteps("resume command"),
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
    fixture.controls.ready = () => Promise.resolve("saved ref");
    const plugin = await installed.plugin.createTerminalPlugin({});
    const creating = plugin.createTab(options);
    await preflight;
    assert.deepEqual(fixture.calls[0]!.monitoring, []);
    assert.equal(server.requests.length, 3);
    events.emit("initialized");
    const tab = await creating;
    const resuming = plugin.resume(tab, "resume command", "saved ref");
    await monitoring;
    assert.deepEqual(fixture.calls[0]!.monitoring, ["saved ref"]);
    assert.equal(server.requests.length, 3);
    assert.equal(fixture.calls[0]!.readiness, 0);
    events.emit("observed");
    assert.equal(await resuming, "saved ref");
  },
);

await test("a conflicting readiness ref rejects and a retry preserves the saved conversation without replay", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  t.after(() => installed.close());
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("resume command"),
  ]);
  t.after(() => server.close());
  const plugin = await installed.plugin.createTerminalPlugin({
    agentStartDelay: 0,
  });
  const tab = await plugin.createTab(options);
  fixture.controls.ready = () => Promise.resolve("different conversation");
  await assert.rejects(
    plugin.resume(tab, "resume command", "saved ref"),
    /readiness.*conflict.*sessionref/i,
  );
  fixture.controls.ready = () => Promise.resolve("saved ref");
  assert.equal(
    await plugin.resume(tab, "must not be submitted", "saved ref"),
    "saved ref",
  );
  assert.deepEqual(fixture.calls[0]!.monitoring, ["saved ref"]);
  assert.equal(fixture.calls[0]!.readiness, 2);
  assert.equal(server.requests.length, 8);
});

for (const phase of ["monitor", "ready"] as const) {
  await test(
    `abort during resume ${phase} rejects pending and late input, stops the enhancement, and retains the Tab until explicit close`,
    { timeout: 10000 },
    async (t) => {
      const installed = await installedPlugin();
      const fixture = await (await installed.install()).fixture();
      t.after(() => installed.close());
      const server = await herdr([
        ...contextSteps(),
        createStep(),
        ...(phase === "ready"
          ? [...targetSteps(), ...inputSteps("resume command")]
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
      const finished = once(events, "finished");
      t.after(() => {
        events.emit("release");
      });
      const controller = new AbortController();
      const plugin = await installed.plugin.createTerminalPlugin({});
      const tab = await plugin.createTab({
        ...options,
        signal: controller.signal,
      });
      const pending = async () => {
        events.emit("entered");
        await release;
        await assert.rejects(
          fixture.calls[0]!.host.submitText("late marker"),
          /abort/i,
        );
        events.emit("finished");
        return "saved ref";
      };
      if (phase === "monitor")
        fixture.controls.monitor = async () => {
          await pending();
        };
      else fixture.controls.ready = pending;
      const resuming = plugin.resume(tab, "resume command", "saved ref");
      await entered;
      const rejected = assert.rejects(resuming, /abort/i);
      controller.abort();
      await rejected;
      assert.equal(fixture.calls[0]!.stops, 1);
      await assert.rejects(
        plugin.resume(tab, "late command", "saved ref"),
        /abort/i,
      );
      await assert.rejects(plugin.submitText(tab, "late task"), /abort/i);
      events.emit("release");
      await finished;
      assert.equal(server.requests.length, phase === "ready" ? 8 : 3);
      assert.equal(fixture.calls[0]!.readiness, phase === "ready" ? 1 : 0);
      await plugin.closeTab(tab);
      assert.equal(fixture.calls[0]!.stops, 1);
    },
  );
}

await test("resume progress and enhancement input stay bound to each owned Tab", async (t) => {
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
    ...inputSteps("first resume"),
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
    ...inputSteps("second resume", "enter", "w1:p3"),
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
  const plugin = await installed.plugin.createTerminalPlugin({});
  const first = await plugin.createTab(options);
  const second = await plugin.createTab(options);
  const failure = new Error("first readiness unavailable");
  fixture.controls.ready = () => Promise.reject(failure);
  await assert.rejects(
    plugin.resume(first, "first resume", "first ref"),
    (error) => error === failure,
  );
  fixture.controls.ready = async (call) => {
    if (call === fixture.calls[0]) return "first ref";
    await call.host.submitText("second marker");
    return "second ref";
  };
  assert.equal(
    await plugin.resume(second, "second resume", "second ref"),
    "second ref",
  );
  assert.equal(
    await plugin.resume(first, "must not be submitted", "first ref"),
    "first ref",
  );
  assert.deepEqual(
    fixture.calls.map((call) => call.monitoring),
    [["first ref"], ["second ref"]],
  );
  assert.deepEqual(
    fixture.calls.map((call) => call.readiness),
    [2, 1],
  );
});

await test("readiness errors propagate unchanged and retries cannot replace the original resume identity", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  t.after(() => installed.close());
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("resume command"),
  ]);
  t.after(() => server.close());
  const failure = new Error("readiness unavailable");
  fixture.controls.ready = () => Promise.reject(failure);
  const plugin = await installed.plugin.createTerminalPlugin({
    agentStartDelay: 0,
  });
  const tab = await plugin.createTab(options);
  await assert.rejects(
    plugin.resume(tab, "resume command", "original ref"),
    (error) => error === failure,
  );
  fixture.controls.ready = () => Promise.resolve("substitute ref");
  await assert.rejects(
    plugin.resume(tab, "another command", "substitute ref"),
    /sessionref/i,
  );
  fixture.controls.ready = () => Promise.resolve("original ref");
  assert.equal(
    await plugin.resume(tab, "must not be submitted", "original ref"),
    "original ref",
  );
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.calls[0]!.monitoring, ["original ref"]);
  assert.equal(fixture.calls[0]!.readiness, 2);
  assert.equal(server.requests.length, 8);
});

await test("resume propagates monitoring and native input errors and retries only unfinished startup work", async (t) => {
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
    ...inputSteps("resume command"),
  ]);
  t.after(() => server.close());
  const failure = new Error("observation unavailable");
  fixture.controls.monitor = () => Promise.reject(failure);
  fixture.controls.ready = () => Promise.resolve("saved ref");
  const plugin = await installed.plugin.createTerminalPlugin({});
  const tab = await plugin.createTab(options);
  await assert.rejects(
    plugin.resume(tab, "resume command", "saved ref"),
    (error) => error === failure,
  );
  assert.equal(server.requests.length, 3);
  delete fixture.controls.monitor;
  await assert.rejects(
    plugin.resume(tab, "resume command", "saved ref"),
    /pane.send_input.*input_rejected.*ordinary rejection/,
  );
  assert.equal(
    await plugin.resume(tab, "resume command", "saved ref"),
    "saved ref",
  );
  assert.deepEqual(fixture.calls[0]!.monitoring, ["saved ref", "saved ref"]);
  assert.equal(fixture.calls[0]!.readiness, 1);
});
