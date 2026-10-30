import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  caller,
  contextSteps,
  createStep,
  herdr,
  pane,
  tab,
  targetSteps,
  type Step,
} from "../fixtures/herdr.ts";

const secondCreate: Step = {
  method: "tab.create",
  result: {
    type: "tab_created",
    tab: { ...tab, tab_id: "w1:t3" },
    root_pane: {
      ...pane,
      tab_id: "w1:t3",
      pane_id: "w1:p3",
      terminal_id: "second-terminal",
    },
  },
};

await test("detected connection loss rejects another handle's pending input without waiting for its reply", async (t) => {
  const gates = new EventEmitter();
  const inputRequested = once(gates, "input");
  const script: Step[] = [
    ...contextSteps(),
    createStep(),
    secondCreate,
    ...targetSteps(),
    { method: "pane.send_input", stall: true },
    {
      method: "tab.get",
      params: { tab_id: "w1:t3" },
      disconnect: true,
    },
  ];
  const server = await herdr((request) => {
    const step = script.shift();
    assert.ok(step, `unexpected ${request.method}`);
    if (step.stall) gates.emit("input");
    return step;
  });
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const first = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "First",
  });
  const second = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Second",
  });
  let pendingError: unknown;
  const pending = plugin.submitText(first, "uncertain input").catch((error) => {
    pendingError = error;
  });
  await inputRequested;
  await assert.rejects(plugin.closeTab(second), /invalidated.*tab.get/);
  await setImmediate();
  assert.match(String(pendingError), /invalidated.*tab.get/);
  await pending;
  const count = server.requests.length;
  for (const handle of [first, second]) {
    await assert.rejects(plugin.submitText(handle, "no replay"), /invalidated/);
    await assert.rejects(plugin.closeTab(handle), /invalidated/);
  }
  assert.equal(server.requests.length, count);
  assert.equal(
    server.requests.filter((request) => request.method === "pane.send_input")
      .length,
    1,
  );
  assert.equal(script.length, 0);
});

await test("a scripted restart reusing native identities cannot authorize old handles; a fresh instance can recover", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    secondCreate,
    ...targetSteps(),
    { method: "pane.send_input", disconnect: true },
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.send_input",
      params: {
        pane_id: "w1:p2",
        text: "fresh input",
        keys: ["right", "enter"],
      },
      result: { type: "ok" },
    },
    ...targetSteps(),
    {
      method: "tab.list",
      result: { type: "tab_list", tabs: [caller, tab] },
    },
    {
      method: "tab.close",
      params: { tab_id: "w1:t2" },
      result: { type: "ok" },
    },
  ]);
  t.after(() => server.close());
  const previous = await createTerminalPlugin();
  const first = await previous.createTab({
    cwd: process.cwd(),
    env: {},
    label: "First",
  });
  const second = await previous.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Second",
  });
  await assert.rejects(
    previous.submitText(first, "uncertain input"),
    /invalidated.*pane.send_input/,
  );
  const lostCount = server.requests.length;
  await assert.rejects(
    previous.createTab({ cwd: process.cwd(), env: {}, label: "No reconnect" }),
    /invalidated/,
  );
  for (const handle of [first, second]) {
    await assert.rejects(previous.submitText(handle, "stale"), /invalidated/);
    await assert.rejects(previous.closeTab(handle), /invalidated/);
  }
  assert.equal(server.requests.length, lostCount);

  // The replacement backend issues the same tab, pane, and terminal IDs.
  const fresh = await createTerminalPlugin();
  const replacement = await fresh.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Replacement",
  });
  const replacementCount = server.requests.length;
  for (const handle of [first, second]) {
    await assert.rejects(previous.submitText(handle, "stale"), /invalidated/);
    await assert.rejects(previous.closeTab(handle), /invalidated/);
    await assert.rejects(fresh.submitText(handle, "foreign"), /foreign/);
    await assert.rejects(fresh.closeTab(handle), /foreign/);
  }
  assert.equal(server.requests.length, replacementCount);
  await fresh.submitText(replacement, "fresh input");
  await fresh.closeTab(replacement);
  assert.equal(
    server.requests.filter((request) => request.method === "pane.send_input")
      .length,
    2,
  );
  assert.equal(
    server.requests.filter((request) => request.method === "tab.close").length,
    1,
  );
  assert.equal(
    server.requests.filter((request) => request.method === "tab.create").length,
    3,
  );
});

await test("ordinary backend rejection leaves the owned association usable for later input and close", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.send_input",
      error: { code: "input_failed", message: "PTY write rejected" },
    },
    ...targetSteps(),
    {
      method: "pane.send_input",
      params: {
        pane_id: "w1:p2",
        text: "later input",
        keys: ["right", "enter"],
      },
      result: { type: "ok" },
    },
    ...targetSteps(),
    {
      method: "tab.list",
      result: { type: "tab_list", tabs: [caller, tab] },
    },
    {
      method: "tab.close",
      params: { tab_id: "w1:t2" },
      result: { type: "ok" },
    },
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  await assert.rejects(
    plugin.submitText(handle, "rejected input"),
    /pane.send_input: input_failed: PTY write rejected/,
  );
  assert.equal(
    server.requests.filter((request) => request.method === "pane.send_input")
      .length,
    1,
  );
  await plugin.submitText(handle, "later input");
  await plugin.closeTab(handle);
  assert.equal(
    server.requests.filter((request) => request.method === "pane.send_input")
      .length,
    2,
  );
  assert.equal(
    server.requests.filter((request) => request.method === "tab.close").length,
    1,
  );
});
