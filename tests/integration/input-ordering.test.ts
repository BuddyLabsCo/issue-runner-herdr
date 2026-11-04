import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  pane,
  tab as nativeTab,
  targetSteps,
} from "../fixtures/herdr.ts";

const options = {
  cwd: process.cwd(),
  env: {},
  label: "Ordered input",
  submitKey: "Shift+Enter",
};

await test(
  "command, bound text and keys share one queue while another Tab remains usable",
  { timeout: 5000 },
  async (t) => {
    const events = new EventEmitter();
    const requested = once(events, "requested");
    const release = once(events, "release");
    t.after(() => {
      events.emit("release");
    });
    const otherTab = { ...nativeTab, tab_id: "w1:t3" };
    const otherPane = {
      ...pane,
      pane_id: "w1:p3",
      tab_id: "w1:t3",
      terminal_id: "other-terminal",
    };
    const startup = [
      ...contextSteps(),
      createStep(),
      {
        method: "tab.create",
        result: { type: "tab_created", tab: otherTab, root_pane: otherPane },
      },
    ];
    const server = await herdr((request) => {
      const step = startup.shift();
      if (step) return step;
      if (request.method === "tab.get")
        return {
          method: request.method,
          result: {
            type: "tab_info",
            tab:
              request.params.tab_id === nativeTab.tab_id ? nativeTab : otherTab,
          },
        };
      if (request.method === "pane.get")
        return {
          method: request.method,
          result: {
            type: "pane_info",
            pane: request.params.pane_id === pane.pane_id ? pane : otherPane,
          },
        };
      assert.equal(request.method, "pane.send_input");
      if (request.params.text === "Bound text") {
        events.emit("requested");
        return {
          method: request.method,
          result: { type: "ok" },
          waitFor: release,
        };
      }
      return { method: request.method, result: { type: "ok" } };
    });
    t.after(() => server.close());
    const plugin = await createTerminalPlugin({});
    const { handle: first, io: host } = await plugin.createTab(options);
    const { handle: second } = await plugin.createTab(options);
    await plugin.execute(first, "Old task");
    const submittingText = host.submitText("Bound text");
    await requested;
    const submitting = plugin.execute(first, "New task");
    const marker = host.submitText("Marker");
    const keys = host.sendKeys(["Escape"]);
    await plugin.execute(second, "Independent task");
    const waiting = server.requests
      .filter(
        (request) =>
          request.method === "pane.send_input" &&
          request.params.pane_id === pane.pane_id,
      )
      .map((request) => request.params);
    events.emit("release");
    await Promise.all([submittingText, submitting, marker, keys]);
    assert.deepEqual(waiting, [
      ...inputSteps("Old task").map((step) => step.params),
      { pane_id: pane.pane_id, text: "Bound text", keys: [] },
    ]);
    assert.deepEqual(
      server.requests
        .filter(
          (request) =>
            request.method === "pane.send_input" &&
            request.params.pane_id === pane.pane_id,
        )
        .map((request) => request.params),
      [
        ...inputSteps("Old task").map((step) => step.params),
        ...inputSteps("Bound text", "shift+enter").map((step) => step.params),
        ...inputSteps("New task").map((step) => step.params),
        ...inputSteps("Marker", "shift+enter").map((step) => step.params),
        { pane_id: pane.pane_id, text: "", keys: ["escape"] },
      ],
    );
  },
);

await test(
  "bound text waits for pending command input without blocking screen reads",
  { timeout: 5000 },
  async (t) => {
    const events = new EventEmitter();
    const requested = once(events, "requested");
    const release = once(events, "release");
    t.after(() => {
      events.emit("release");
    });
    const task = inputSteps("New task");
    task[0]!.waitFor = release;
    const script = [
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...inputSteps("Old task"),
      ...targetSteps(),
      task[0]!,
      ...targetSteps(),
      {
        method: "pane.read",
        result: {
          type: "pane_read",
          read: {
            pane_id: pane.pane_id,
            workspace_id: pane.workspace_id,
            tab_id: pane.tab_id,
            source: "visible",
            format: "text",
            text: "Current screen",
          },
        },
      },
      ...task.slice(1),
      ...targetSteps(),
      ...inputSteps("Bound text", "shift+enter"),
    ];
    const server = await herdr((request) => {
      const step = script.shift();
      assert.ok(step, `unexpected ${request.method}`);
      if (step.waitFor) events.emit("requested");
      return step;
    });
    t.after(() => server.close());
    const plugin = await createTerminalPlugin({});
    const { handle: tab, io: host } = await plugin.createTab(options);
    await plugin.execute(tab, "Old task");
    const submitting = plugin.execute(tab, "New task");
    await requested;
    const submittingText = host.submitText("Bound text");
    assert.equal(await host.read(), "Current screen");
    events.emit("release");
    await Promise.all([submitting, submittingText]);
    assert.equal(script.length, 0);
  },
);

await test(
  "revocation rejects queued input and retains explicit close",
  { timeout: 5000 },
  async (t) => {
    const events = new EventEmitter();
    const requested = once(events, "requested");
    const release = once(events, "release");
    t.after(() => {
      events.emit("release");
    });
    const controller = new AbortController();
    const body = inputSteps("started")[0]!;
    body.waitFor = release;
    const script = [
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      body,
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
    const server = await herdr((request) => {
      const step = script.shift();
      assert.ok(step, `unexpected ${request.method}`);
      if (step.waitFor) events.emit("requested");
      return step;
    });
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const { handle, io } = await plugin.createTab({
      ...options,
      signal: controller.signal,
    });
    const started = assert.rejects(plugin.execute(handle, "started"), /abort/i);
    await requested;
    const queued = [
      assert.rejects(plugin.execute(handle, "queued command"), /abort/i),
      assert.rejects(io.submitText("queued text"), /abort/i),
      assert.rejects(io.sendKeys(["Escape", "Enter"]), /abort/i),
    ];
    controller.abort();
    await Promise.all([started, ...queued]);
    await assert.rejects(io.read(), /abort/i);
    assert.equal(server.requests.length, 6);
    events.emit("release");
    await plugin.closeTab(handle);
    await plugin.closeTab(handle);
    assert.equal(script.length, 0);
  },
);
