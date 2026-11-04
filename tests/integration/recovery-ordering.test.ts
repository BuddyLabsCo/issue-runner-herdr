import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import { installedPlugin } from "../fixtures/enhancement.ts";
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
  label: "Ordered recovery",
  agent: "generic",
  submitKey: "Shift+Enter",
};

await test(
  "recovery and subsequent Core/Host input finish in order while another Tab remains usable",
  { timeout: 5000 },
  async (t) => {
    const installed = await installedPlugin();
    const fixture = await (await installed.install()).fixture();
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
      if (request.params.text === "Old recovery") {
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
    t.after(() => installed.close());
    const plugin = await installed.plugin.createTerminalPlugin({});
    const first = await plugin.createTab(options);
    const second = await plugin.createTab(options);
    await plugin.submitText(
      first,
      "Old task",
      undefined,
      "/old.json",
      "Old recovery",
    );
    const host = fixture.calls[0]!.host;
    const recovering = host.requestRecovery();
    await requested;
    const submitting = plugin.submitText(
      first,
      "New task",
      undefined,
      "/new.json",
      "New recovery",
    );
    const marker = host.submitText("Marker");
    const keys = host.sendKeys(["Escape"]);
    await plugin.submitText(second, "Independent task");
    const waiting = server.requests
      .filter(
        (request) =>
          request.method === "pane.send_input" &&
          request.params.pane_id === pane.pane_id,
      )
      .map((request) => request.params);
    const assignmentsWhileWaiting = [...fixture.calls[0]!.assignments];
    events.emit("release");
    await Promise.all([recovering, submitting, marker, keys]);
    assert.deepEqual(waiting, [
      ...inputSteps("Old task").map((step) => step.params),
      { pane_id: pane.pane_id, text: "Old recovery", keys: [] },
    ]);
    assert.deepEqual(assignmentsWhileWaiting, [["/old.json"]]);
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
        ...inputSteps("Old recovery", "shift+enter").map((step) => step.params),
        ...inputSteps("New task").map((step) => step.params),
        ...inputSteps("Marker", "shift+enter").map((step) => step.params),
        { pane_id: pane.pane_id, text: "", keys: ["escape"] },
      ],
    );
  },
);

await test(
  "recovery waits for pending Core input and reads the latest wording without blocking screen reads",
  { timeout: 5000 },
  async (t) => {
    const installed = await installedPlugin();
    const fixture = await (await installed.install()).fixture();
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
      ...inputSteps("Latest recovery", "shift+enter"),
    ];
    const server = await herdr((request) => {
      const step = script.shift();
      assert.ok(step, `unexpected ${request.method}`);
      if (step.waitFor) events.emit("requested");
      return step;
    });
    t.after(() => server.close());
    t.after(() => installed.close());
    const plugin = await installed.plugin.createTerminalPlugin({});
    const tab = await plugin.createTab(options);
    await plugin.submitText(
      tab,
      "Old task",
      undefined,
      "/old.json",
      "Old recovery",
    );
    const submitting = plugin.submitText(
      tab,
      "New task",
      undefined,
      "/new.json",
      "Latest recovery",
    );
    await requested;
    const host = fixture.calls[0]!.host;
    const recovering = host.requestRecovery();
    assert.equal(await host.read(), "Current screen");
    events.emit("release");
    await Promise.all([submitting, recovering]);
    assert.deepEqual(fixture.calls[0]!.assignments, [
      ["/old.json"],
      ["/new.json"],
    ]);
  },
);
