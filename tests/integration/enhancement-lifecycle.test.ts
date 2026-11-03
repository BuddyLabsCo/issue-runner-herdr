import assert from "node:assert/strict";
import { EventEmitter, once, getEventListeners } from "node:events";
import test from "node:test";
import { installedPlugin } from "../fixtures/enhancement.ts";
import {
  contextSteps,
  createStep,
  herdr,
  caller,
  pane,
  tab as nativeTab,
  inputSteps,
  targetSteps,
  type Step,
} from "../fixtures/herdr.ts";

const options = {
  cwd: process.cwd(),
  env: {},
  label: "Lifecycle",
  agent: "generic",
  submitKey: "Enter",
};
const closeSteps = (): Step[] => [
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
];

await test("close waits for stop, preserves the terminal on stop failure, and retries native close without repeating completed stop", async (t) => {
  const installed = await installedPlugin();
  t.after(() => installed.close());
  const fixture = await (await installed.install()).fixture();
  const firstClose = closeSteps();
  firstClose[3] = {
    method: "tab.close",
    error: { code: "close_failed", message: "retry native close" },
  };
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...firstClose,
    ...closeSteps(),
  ]);
  t.after(() => server.close());
  const plugin = await installed.plugin.createTerminalPlugin({});
  const tab = await plugin.createTab(options);
  const events = new EventEmitter();
  const entered = once(events, "entered");
  const release = once(events, "release");
  t.after(() => {
    events.emit("release");
  });
  fixture.controls.stop = async () => {
    events.emit("entered");
    await release;
    throw new Error("stop failed");
  };
  const closing = assert.rejects(plugin.closeTab(tab), /stop failed/);
  await entered;
  assert.equal(server.requests.length, 3, "native close must wait for stop");
  await assert.rejects(fixture.calls[0]!.host.submitText("stopped"), /abort/i);
  events.emit("release");
  await closing;
  assert.equal(
    server.requests.length,
    3,
    "stop failure must preserve the terminal",
  );
  delete fixture.controls.stop;
  await assert.rejects(plugin.closeTab(tab), /retry native close/);
  assert.equal(fixture.calls[0]!.stops, 2);
  await plugin.closeTab(tab);
  await plugin.closeTab(tab);
  assert.equal(fixture.calls[0]!.stops, 2);
  await assert.rejects(fixture.calls[0]!.host.read(), /closed/);
});

await test("Run abort stops enhancement activity, blocks all later Host operations, and preserves a closable Tab", async (t) => {
  const installed = await installedPlugin();
  t.after(() => installed.close());
  const fixture = await (await installed.install()).fixture();
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...closeSteps(),
  ]);
  t.after(() => server.close());
  const controller = new AbortController();
  const events = new EventEmitter();
  const stopped = once(events, "stopped");
  fixture.controls.stop = () => {
    events.emit("stopped");
    return Promise.resolve();
  };
  const plugin = await installed.plugin.createTerminalPlugin({});
  const tab = await plugin.createTab({ ...options, signal: controller.signal });
  const host = fixture.calls[0]!.host;
  controller.abort();
  await stopped;
  for (const operation of [
    () => host.read(),
    () => host.submitText("late"),
    () => host.sendKeys(["Enter"]),
    () => host.requestRecovery(),
  ]) {
    await assert.rejects(operation(), /abort/i);
  }
  assert.equal(server.requests.length, 3);
  await plugin.closeTab(tab);
  assert.equal(fixture.calls[0]!.stops, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

await test("abort during pending preflight stops the late-created instance and leaves retained Host capabilities cancelled", async (t) => {
  const installed = await installedPlugin();
  t.after(() => installed.close());
  const fixture = await (await installed.install()).fixture();
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  const controller = new AbortController();
  const events = new EventEmitter();
  const entered = once(events, "entered");
  const release = once(events, "release");
  t.after(() => {
    events.emit("release");
  });
  fixture.controls.initialize = async () => {
    events.emit("entered");
    await release;
  };
  const plugin = await installed.plugin.createTerminalPlugin({});
  const creating = plugin.createTab({ ...options, signal: controller.signal });
  await entered;
  controller.abort();
  await assert.rejects(fixture.calls[0]!.host.sendKeys(["Enter"]), /abort/i);
  const rejected = assert.rejects(creating, /abort/i);
  events.emit("release");
  await rejected;
  assert.equal(fixture.calls[0]!.stops, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(fixture.calls[0]!.host.submitText("late"), /abort/i);
});

await test("factory failure owns its partial cleanup while Herdr releases its cancellation listener and revokes the Host", async (t) => {
  const installed = await installedPlugin();
  t.after(() => installed.close());
  const fixture = await (await installed.install()).fixture();
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  const controller = new AbortController();
  let active = false;
  fixture.controls.initialize = async () => {
    active = true;
    try {
      await Promise.resolve();
      throw new Error("initialization failed");
    } finally {
      active = false;
    }
  };
  const plugin = await installed.plugin.createTerminalPlugin({});
  await assert.rejects(
    plugin.createTab({ ...options, signal: controller.signal }),
    /initialization failed/,
  );
  assert.equal(active, false);
  assert.equal(
    fixture.calls[0]!.stops,
    0,
    "the factory never returned an instance to stop",
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(fixture.calls[0]!.host.submitText("late"), /abort/i);
});

await test("a late-created instance whose stop fails rejects creation without silently retrying stop", async (t) => {
  const installed = await installedPlugin();
  t.after(() => installed.close());
  const fixture = await (await installed.install()).fixture();
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  const controller = new AbortController();
  fixture.controls.initialize = () => {
    controller.abort();
    return Promise.resolve();
  };
  fixture.controls.stop = () => Promise.reject(new Error("late stop failed"));
  const plugin = await installed.plugin.createTerminalPlugin({});
  await assert.rejects(
    plugin.createTab({ ...options, signal: controller.signal }),
    /late stop failed/,
  );
  assert.equal(fixture.calls[0]!.stops, 1);
});

await test("confirmed absence still stops the enhancement even if earlier Host input retired the handle", async (t) => {
  const installed = await installedPlugin();
  t.after(() => installed.close());
  const fixture = await (await installed.install()).fixture();
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    { method: "tab.get", error: { code: "tab_not_found", message: "absent" } },
    { method: "pane.get", result: { type: "pane_info", pane: caller } },
    {
      method: "tab.list",
      result: {
        type: "tab_list",
        tabs: [{ workspace_id: "w1", tab_id: "w1:t1" }],
      },
    },
  ]);
  t.after(() => server.close());
  const plugin = await installed.plugin.createTerminalPlugin({});
  const handle = await plugin.createTab(options);
  await assert.rejects(fixture.calls[0]!.host.submitText("absent"), /absent/);
  await plugin.closeTab(handle);
  await plugin.closeTab(handle);
  assert.equal(fixture.calls[0]!.stops, 1);
});

await test("cancelling one Tab leaves another enhancement and its native input usable", async (t) => {
  const installed = await installedPlugin();
  t.after(() => installed.close());
  const fixture = await (await installed.install()).fixture();
  const otherPane = {
    ...pane,
    pane_id: "w1:p3",
    tab_id: "w1:t3",
    terminal_id: "other-terminal",
  };
  const otherTab = { ...nativeTab, tab_id: "w1:t3" };
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    {
      method: "tab.create",
      result: { type: "tab_created", tab: otherTab, root_pane: otherPane },
    },
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
    ...inputSteps("other Tab", "enter", otherPane.pane_id),
    ...closeSteps(),
  ]);
  t.after(() => server.close());
  const controller = new AbortController();
  const plugin = await installed.plugin.createTerminalPlugin({});
  const first = await plugin.createTab({
    ...options,
    signal: controller.signal,
  });
  await plugin.createTab(options);
  controller.abort();
  await fixture.calls[1]!.host.submitText("other Tab");
  await plugin.closeTab(first);
  assert.equal(fixture.calls[0]!.stops, 1);
  assert.equal(fixture.calls[1]!.stops, 0);
});
