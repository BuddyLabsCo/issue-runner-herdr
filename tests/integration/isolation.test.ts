import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  caller,
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  pane,
  tab,
  targetSteps,
  type Step,
} from "../fixtures/herdr.ts";

const secondTab = { ...tab, tab_id: "w1:t3" };
const secondPane = {
  ...pane,
  tab_id: "w1:t3",
  pane_id: "w1:p3",
  terminal_id: "second-terminal",
};
const secondCreate: Step = {
  method: "tab.create",
  result: { type: "tab_created", tab: secondTab, root_pane: secondPane },
};
const secondTargets: Step[] = [
  {
    method: "tab.get",
    params: { tab_id: "w1:t3" },
    result: { type: "tab_info", tab: secondTab },
  },
  {
    method: "pane.get",
    params: { pane_id: "w1:p3" },
    result: { type: "pane_info", pane: secondPane },
  },
];

await test("out-of-order creation replies keep each handle associated with its own root pane", async (t) => {
  const gates = new EventEmitter();
  const firstRequested = once(gates, "first-request");
  const releaseFirst = once(gates, "release-first");
  t.after(() => {
    gates.emit("release-first");
  });
  const setup = contextSteps();
  const submissions: Step[] = [
    ...targetSteps(),
    ...inputSteps("first"),
    ...secondTargets,
    ...inputSteps("second", "enter", "w1:p3"),
  ];
  const server = await herdr((request): Step => {
    if (setup.length) return setup.shift()!;
    if (request.method === "tab.create") {
      assert.equal(request.params.workspace_id, "w1");
      assert.equal(request.params.focus, false);
      if (request.params.label === "First") {
        gates.emit("first-request");
        return { ...createStep(), waitFor: releaseFirst };
      }
      assert.equal(request.params.label, "Second");
      return secondCreate;
    }
    const step = submissions.shift();
    assert.ok(step, `unexpected ${request.method}`);
    return step;
  });
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  let firstCompleted = false;
  const firstPending = plugin
    .createTab({ cwd: process.cwd(), env: {}, label: "First" })
    .then((handle) => {
      firstCompleted = true;
      return handle;
    });
  await firstRequested;
  const second = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Second",
  });
  assert.equal(firstCompleted, false);
  gates.emit("release-first");
  const first = await firstPending;
  assert.notEqual(first, second);
  await plugin.submitText(first, "first");
  await plugin.submitText(second, "second");
  assert.equal(submissions.length, 0);
});

await test("closing one tab overlaps another tab's submission without following focus or invalidating it", async (t) => {
  const gates = new EventEmitter();
  const validatingFirst = once(gates, "validating-first");
  const releaseSubmit = once(gates, "release-submit");
  const releaseClose = once(gates, "release-close");
  t.after(() => {
    gates.emit("release-submit");
    gates.emit("release-close");
  });
  const script: Step[] = [
    ...contextSteps(),
    createStep(),
    secondCreate,
    { ...targetSteps()[0]!, waitFor: releaseSubmit },
    ...secondTargets,
    {
      method: "tab.list",
      params: { workspace_id: "w1" },
      result: {
        type: "tab_list",
        tabs: [caller, tab, secondTab, { workspace_id: "w1", tab_id: "w1:t4" }],
      },
    },
    {
      method: "tab.close",
      params: { tab_id: "w1:t3" },
      result: { type: "ok" },
      waitFor: releaseClose,
    },
    targetSteps()[1]!,
    ...inputSteps("while closing"),
    ...targetSteps(),
    ...inputSteps("still live"),
  ];
  const server = await herdr((request) => {
    const step = script.shift();
    assert.ok(step, `unexpected ${request.method}`);
    if (step.waitFor === releaseSubmit) gates.emit("validating-first");
    if (request.method === "tab.close") {
      process.env.HERDR_PANE_ID = "w8:p8";
      process.env.HERDR_TAB_ID = "w8:t8";
      process.env.HERDR_WORKSPACE_ID = "w8";
      gates.emit("release-submit");
    }
    if (request.method === "pane.send_input") gates.emit("release-close");
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
  process.env.HERDR_PANE_ID = "w9:p9";
  process.env.HERDR_TAB_ID = "w9:t9";
  process.env.HERDR_WORKSPACE_ID = "w9";
  const submitting = plugin.submitText(first, "while closing");
  await validatingFirst;
  await Promise.all([submitting, plugin.closeTab(second)]);
  const count = server.requests.length;
  await plugin.closeTab(second);
  await assert.rejects(plugin.submitText(second, "closed"), /closed/);
  assert.equal(server.requests.length, count);
  await plugin.submitText(first, "still live");
  assert.equal(script.length, 0);
});

await test("opaque handles stay instance-owned across backends with overlapping native identifiers", async (t) => {
  const firstServer = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("first backend"),
    ...targetSteps(),
    ...inputSteps("first backend still live"),
  ]);
  t.after(() => firstServer.close());
  const first = await createTerminalPlugin();
  const firstHandle = await first.createTab({
    cwd: process.cwd(),
    env: {},
    label: "First backend",
  });
  const secondServer = await herdr([
    ...contextSteps(),
    createStep(),
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
  ]);
  try {
    const second = await createTerminalPlugin();
    const secondHandle = await second.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Second backend",
    });
    assert.notEqual(firstHandle, secondHandle);
    assert.deepEqual(Reflect.ownKeys(firstHandle), []);
    assert.deepEqual(Reflect.ownKeys(secondHandle), []);
    for (const [plugin, owned, foreign] of [
      [first, firstHandle, secondHandle],
      [second, secondHandle, firstHandle],
    ] as const) {
      for (const fabricated of [{}, { ...owned }, { ...pane }, foreign]) {
        await assert.rejects(
          plugin.submitText(fabricated, "must not send"),
          /Unknown or foreign/,
        );
        await assert.rejects(plugin.closeTab(fabricated), /Unknown or foreign/);
      }
    }
    assert.equal(firstServer.requests.length, 3);
    assert.equal(secondServer.requests.length, 3);
    await Promise.all([
      first.submitText(firstHandle, "first backend"),
      second.closeTab(secondHandle),
    ]);
    await first.submitText(firstHandle, "first backend still live");
  } finally {
    await secondServer.close();
  }
});
