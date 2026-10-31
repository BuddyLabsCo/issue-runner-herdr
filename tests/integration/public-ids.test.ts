import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import { herdr, inputSteps } from "../fixtures/herdr.ts";

const host = {
  workspace_id: "wH",
  tab_id: "wH:t3",
  pane_id: "wH:p3",
  terminal_id: "runner-terminal",
};

for (const [workspace, number] of [
  ["w10", "AZ"],
  ["w0", "0"],
] as const) {
  await test(`creates, submits and closes with encoded public IDs in ${workspace}`, async (t) => {
    const caller = {
      workspace_id: workspace,
      tab_id: `${workspace}:t${number}`,
      pane_id: `${workspace}:p${number}`,
      terminal_id: "runner-terminal",
    };
    const tab = { workspace_id: workspace, tab_id: `${workspace}:t${number}1` };
    const pane = {
      ...tab,
      pane_id: `${workspace}:p${number}2`,
      terminal_id: "owned-terminal",
    };
    const server = await herdr([
      {
        method: "pane.current",
        params: { caller_pane_id: caller.pane_id },
        result: { type: "pane_current", pane: caller },
      },
      {
        method: "workspace.get",
        params: { workspace_id: workspace },
        result: {
          type: "workspace_info",
          workspace: { workspace_id: workspace },
        },
      },
      {
        method: "tab.create",
        result: {
          type: "tab_created",
          tab: { ...tab, pane_count: 1 },
          root_pane: pane,
        },
      },
      {
        method: "tab.get",
        params: { tab_id: tab.tab_id },
        result: { type: "tab_info", tab },
      },
      {
        method: "pane.get",
        params: { pane_id: pane.pane_id },
        result: { type: "pane_info", pane },
      },
      ...inputSteps("echo encoded", "enter", pane.pane_id),
      {
        method: "tab.get",
        params: { tab_id: tab.tab_id },
        result: { type: "tab_info", tab },
      },
      {
        method: "pane.get",
        params: { pane_id: pane.pane_id },
        result: { type: "pane_info", pane },
      },
      {
        method: "tab.list",
        params: { workspace_id: workspace },
        result: { type: "tab_list", tabs: [caller, tab] },
      },
      {
        method: "tab.close",
        params: { tab_id: tab.tab_id },
        result: { type: "ok" },
      },
    ]);
    t.after(() => server.close());
    process.env.HERDR_WORKSPACE_ID = workspace;
    process.env.HERDR_TAB_ID = caller.tab_id;
    process.env.HERDR_PANE_ID = caller.pane_id;
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Encoded IDs",
    });
    assert.equal(server.requests[2]?.params.workspace_id, workspace);
    await plugin.submitText(handle, "echo encoded");
    await plugin.closeTab(handle);
  });
}

for (const [key, value] of [
  ["workspace_id", "wH."],
  ["workspace_id", "wh"],
  ["workspace_id", "wI"],
  ["workspace_id", "wH\n"],
  ["tab_id", "wJ:t3"],
  ["pane_id", "wJ:p3"],
  ["tab_id", "wH:tI"],
  ["pane_id", "wH:pO"],
  ["pane_id", "wH:p3\n"],
] as const) {
  await test(`rejects unusable returned ${key}=${JSON.stringify(value)} in an alphabetic workspace`, async (t) => {
    const server = await herdr([
      {
        method: "pane.current",
        params: { caller_pane_id: host.pane_id },
        result: { type: "pane_current", pane: { ...host, [key]: value } },
      },
    ]);
    t.after(() => server.close());
    process.env.HERDR_WORKSPACE_ID = host.workspace_id;
    process.env.HERDR_TAB_ID = host.tab_id;
    process.env.HERDR_PANE_ID = host.pane_id;
    await assert.rejects(
      createTerminalPlugin(),
      /Herdr returned an unusable pane\/workspace identity/,
    );
  });
}

for (const [key, value] of [
  ["HERDR_WORKSPACE_ID", "wJ"],
  ["HERDR_TAB_ID", "wH:t4"],
  ["HERDR_PANE_ID", "wH:p4"],
] as const) {
  await test(`rejects conflicting inherited ${key}=${value} in an alphabetic workspace`, async (t) => {
    const server = await herdr([
      {
        method: "pane.current",
        params: {
          caller_pane_id: key === "HERDR_PANE_ID" ? value : host.pane_id,
        },
        result: { type: "pane_current", pane: host },
      },
    ]);
    t.after(() => server.close());
    process.env.HERDR_WORKSPACE_ID = host.workspace_id;
    process.env.HERDR_TAB_ID = host.tab_id;
    process.env.HERDR_PANE_ID = host.pane_id;
    process.env[key] = value;
    await assert.rejects(
      createTerminalPlugin(),
      /conflicts with inherited host context/,
    );
  });
}
