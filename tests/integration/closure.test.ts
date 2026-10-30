import assert from "node:assert/strict";
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

const absent: Step = {
  method: "tab.get",
  params: { tab_id: "w1:t2" },
  error: { code: "tab_not_found", message: "tab absent" },
};
const runner: Step = {
  method: "pane.get",
  params: { pane_id: "w1:p1" },
  result: { type: "pane_info", pane: caller },
};

for (const lookup of [
  { error: { code: "not_found", message: "resource not resolved" } },
  { error: { code: "unavailable", message: "backend busy" } },
  { disconnect: true },
]) {
  await test(`a failed lookup cannot establish safe absence: ${JSON.stringify(lookup)}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      { method: "tab.get", params: { tab_id: "w1:t2" }, ...lookup },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    await assert.rejects(
      plugin.closeTab(handle),
      /not_found|backend busy|invalidated/,
    );
    assert.equal(server.requests.length, 4);
  });
}

for (const context of [
  { error: { code: "pane_not_found", message: "Runner is unresolved" } },
  { result: { type: "pane_info", pane: { ...caller, tab_id: "w1:t9" } } },
  {
    result: {
      type: "pane_info",
      pane: { ...caller, terminal_id: "replacement" },
    },
  },
  { result: { type: "pane_info", pane: null } },
]) {
  await test(`missing tab plus unresolved Runner context rejects: ${JSON.stringify(context)}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      absent,
      { method: "pane.get", params: { pane_id: "w1:p1" }, ...context },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    await assert.rejects(
      plugin.closeTab(handle),
      /Runner is unresolved|identity|invalidated/,
    );
    assert.equal(server.requests.length, 5);
  });
}

for (const tabs of [
  undefined,
  null,
  [],
  [caller, caller],
  [caller, { workspace_id: "w9", tab_id: "w9:t3" }],
  [caller, { workspace_id: "w1", tab_id: "invalid" }],
  [caller, null],
  [caller, tab],
  [{ workspace_id: "w1", tab_id: "w1:t3" }],
]) {
  await test(`missing tab requires an unambiguous list proving absence: ${JSON.stringify(tabs)}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      absent,
      runner,
      {
        method: "tab.list",
        params: { workspace_id: "w1" },
        result: { type: "tab_list", tabs },
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
      plugin.closeTab(handle),
      /malformed|ambiguous|unresolved/,
    );
    await assert.rejects(plugin.closeTab(handle), /invalid/);
    await assert.rejects(plugin.submitText(handle, "no"), /invalid/);
    assert.equal(server.requests.length, 6);
  });
}

for (const lookup of [
  { error: { code: "not_found", message: "workspace unresolved" } },
  { error: { code: "unavailable", message: "list unavailable" } },
  { disconnect: true },
]) {
  await test(`absence confirmation propagates list failures: ${JSON.stringify(lookup)}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      absent,
      runner,
      { method: "tab.list", params: { workspace_id: "w1" }, ...lookup },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    await assert.rejects(
      plugin.closeTab(handle),
      /workspace unresolved|list unavailable|invalidated/,
    );
    assert.equal(server.requests.length, 6);
  });
}

for (const code of ["close_failed", "not_found", "tab_not_found"]) {
  await test(`close rejection (${code}) leaves the handle usable without replay`, async (t) => {
    const server = await herdr([
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
        error: { code, message: "close not established" },
      },
      ...targetSteps(),
      ...inputSteps("still live"),
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    await assert.rejects(
      plugin.closeTab(handle),
      new RegExp(`tab.close: ${code}: close not established`),
    );
    assert.equal(server.requests.length, 7);
    await plugin.submitText(handle, "still live");
    assert.equal(server.requests.length, 12);
  });
}

for (const externallyClosed of [false, true]) {
  await test(`closure preserves Runner, another Issue and unrelated tabs (external: ${String(externallyClosed)})`, async (t) => {
    const secondTab = { ...tab, tab_id: "w1:t3" };
    const secondPane = {
      ...pane,
      tab_id: "w1:t3",
      pane_id: "w1:p3",
      terminal_id: "second-terminal",
    };
    const unrelated = { workspace_id: "w1", tab_id: "w1:t4" };
    const resources = [
      { workspace_id: "w1", tab_id: "w1:t1" },
      tab,
      secondTab,
      unrelated,
    ];
    const setup: Step[] = [
      ...contextSteps(),
      createStep(),
      {
        method: "tab.create",
        result: { type: "tab_created", tab: secondTab, root_pane: secondPane },
      },
      ...(externallyClosed ? [absent, runner] : targetSteps()),
      {
        method: "tab.list",
        params: { workspace_id: "w1" },
        result: {
          type: "tab_list",
          tabs: resources.filter(
            (item) => !externallyClosed || item.tab_id !== tab.tab_id,
          ),
        },
      },
      ...(externallyClosed
        ? []
        : [
            {
              method: "tab.close",
              params: { tab_id: "w1:t2" },
              result: { type: "ok" },
            },
          ]),
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
      ...inputSteps("other Issue remains usable", "enter", "w1:p3"),
    ];
    const server = await herdr(setup);
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
    await plugin.closeTab(first);
    const count = server.requests.length;
    await plugin.closeTab(first);
    await assert.rejects(plugin.submitText(first, "no"), /closed/);
    assert.equal(server.requests.length, count);
    await plugin.submitText(second, "other Issue remains usable");
    assert.deepEqual(
      server.requests
        .filter((request) => request.method === "tab.close")
        .map((request) => request.params),
      externallyClosed ? [] : [{ tab_id: "w1:t2" }],
    );
    assert.deepEqual(
      server.requests
        .filter((request) => request.method === "pane.send_input")
        .map((request) => request.params.pane_id),
      ["w1:p3", "w1:p3", "w1:p3"],
    );
  });
}
