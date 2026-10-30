import assert from "node:assert/strict";
import test from "node:test";
import type { TerminalPluginModule } from "issue-runner-core/terminal";
import * as pluginModule from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
  targetSteps,
  type Step,
} from "../fixtures/herdr.ts";

const contract: TerminalPluginModule = pluginModule;

await test("initializes from the caller and creates one owned interactive tab", async (t) => {
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  const plugin = await contract.createTerminalPlugin();
  assert.equal(contract.contractVersion, 1);
  assert.deepEqual(Object.keys(pluginModule).sort(), [
    "contractVersion",
    "createTerminalPlugin",
  ]);
  assert.equal(contract.createTerminalPlugin.length, 0);
  assert.deepEqual(Object.keys(plugin).sort(), [
    "closeTab",
    "createTab",
    "submitText",
  ]);
  // Inherited workspace/focus changes must not redirect the initialized plugin.
  process.env.HERDR_WORKSPACE_ID = "w9";
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: { ISSUE_RUNNER_TEST: "overlay" },
    label: "Issue 4",
  });
  assert.deepEqual(handle, {});
  const request = server.requests[2];
  assert.equal(request?.params.workspace_id, "w1");
  assert.equal(request.params.cwd, process.cwd());
  assert.equal(request.params.label, "Issue 4");
  assert.equal(request.params.focus, false);
  const env = request.params.env as Record<string, string>;
  assert.equal(env.ISSUE_RUNNER_TEST, "overlay");
  assert.equal(env.HERDR_PANE_ID, undefined);
  assert.equal(request.params.command, undefined);
});

await test("independent handles can submit concurrently without target crossover", async (t) => {
  const setup = [
    ...contextSteps(),
    createStep(),
    {
      method: "tab.create",
      result: {
        type: "tab_created",
        tab: { workspace_id: "w1", tab_id: "w1:t3", pane_count: 1 },
        root_pane: {
          workspace_id: "w1",
          tab_id: "w1:t3",
          pane_id: "w1:p3",
          terminal_id: "second-terminal",
        },
      },
    },
  ];
  const server = await herdr((request): Step => {
    if (setup.length) return setup.shift()!;
    if (request.method === "tab.get") {
      const id = request.params.tab_id;
      assert.ok(id === "w1:t2" || id === "w1:t3");
      return {
        method: "tab.get",
        result: { type: "tab_info", tab: { workspace_id: "w1", tab_id: id } },
      };
    }
    if (request.method === "pane.get") {
      const id = request.params.pane_id;
      assert.ok(id === "w1:p2" || id === "w1:p3");
      return {
        method: "pane.get",
        result: {
          type: "pane_info",
          pane: {
            workspace_id: "w1",
            pane_id: id,
            tab_id: id === "w1:p2" ? "w1:t2" : "w1:t3",
            terminal_id: id === "w1:p2" ? "owned-terminal" : "second-terminal",
          },
        },
      };
    }
    assert.equal(request.method, "pane.send_input");
    assert.deepEqual(request.params, {
      pane_id: request.params.text === "first" ? "w1:p2" : "w1:p3",
      text: request.params.text,
      keys: ["right", "enter"],
    });
    return { method: "pane.send_input", result: { type: "ok" } };
  });
  t.after(() => server.close());
  const plugin = await contract.createTerminalPlugin();
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
  assert.notEqual(first, second);
  await Promise.all([
    plugin.submitText(first, "first"),
    plugin.submitText(second, "second"),
  ]);
  assert.equal(
    server.requests.filter((request) => request.method === "pane.send_input")
      .length,
    2,
  );
});

await test("completes the public lifecycle and closes only the owned native tab", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    { method: "pane.send_input", result: { type: "ok" } },
    ...targetSteps(),
    {
      method: "tab.list",
      params: { workspace_id: "w1" },
      result: {
        type: "tab_list",
        tabs: [
          { tab_id: "w1:t1", workspace_id: "w1" },
          { tab_id: "w1:t2", workspace_id: "w1" },
          { tab_id: "w1:t3", workspace_id: "w1" },
        ],
      },
    },
    {
      method: "tab.close",
      params: { tab_id: "w1:t2" },
      result: { type: "ok" },
    },
  ]);
  t.after(() => server.close());
  const plugin = await contract.createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  await plugin.submitText(handle, "echo done");
  await plugin.closeTab(handle);
  const count = server.requests.length;
  await plugin.closeTab(handle);
  await assert.rejects(
    plugin.submitText(handle, "again"),
    /closed|absent|invalid/i,
  );
  assert.equal(server.requests.length, count);
});

await test("submits complete LF text then Right and the selected chord to the recorded pane", async (t) => {
  const text =
    "First\n\n  \u4e2d\u6587 'quoted' \"double\" $HOME $(1+2) A&B C:\\temp\\a b";
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.send_input",
      params: {
        pane_id: "w1:p2",
        text: "codex resume session-4",
        keys: ["right", "enter"],
      },
      result: { type: "ok" },
    },
    ...targetSteps(),
    {
      method: "pane.send_input",
      params: { pane_id: "w1:p2", text, keys: ["right", "shift+enter"] },
      result: { type: "ok" },
    },
  ]);
  t.after(() => server.close());
  const plugin = await contract.createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  process.env.HERDR_PANE_ID = "w9:p9";
  await plugin.submitText(handle, "codex resume session-4");
  await plugin.submitText(handle, text, "Shift+Enter");
});
