import assert from "node:assert/strict";
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
} from "../fixtures/herdr.ts";

await test("missing inherited context rejects without contacting a default server", async (t) => {
  const server = await herdr([]);
  t.after(() => server.close());
  for (const key of ["HERDR_SOCKET_PATH", "HERDR_PANE_ID"]) {
    const original = process.env[key];
    delete process.env[key];
    await assert.rejects(
      createTerminalPlugin(),
      /inherited HERDR_SOCKET_PATH and HERDR_PANE_ID/,
    );
    process.env[key] = original;
  }
});

for (const returned of [
  { ...caller, pane_id: "w1:p9" },
  { ...caller, workspace_id: "w2" },
  { ...caller, terminal_id: "" },
]) {
  await test(`unusable caller context rejects: ${JSON.stringify(returned)}`, async (t) => {
    const server = await herdr([
      {
        method: "pane.current",
        result: { type: "pane_current", pane: returned },
      },
    ]);
    t.after(() => server.close());
    await assert.rejects(createTerminalPlugin(), /context|identity/);
  });
}

await test("an unresolved host workspace rejects initialization", async (t) => {
  const server = await herdr([
    contextSteps()[0]!,
    {
      method: "workspace.get",
      result: { type: "workspace_info", workspace: { workspace_id: "w2" } },
    },
  ]);
  t.after(() => server.close());
  await assert.rejects(
    createTerminalPlugin(),
    /workspace could not be validated/,
  );
});

await test("validates cwd, environment, and chords before backend mutation", async (t) => {
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  await assert.rejects(
    plugin.createTab({ cwd: "relative", env: {}, label: "Issue" }),
    /absolute cwd/,
  );
  await assert.rejects(
    plugin.createTab({
      cwd: process.cwd(),
      env: { "BAD=KEY": "value" },
      label: "Issue",
    }),
    /environment key/,
  );
  await assert.rejects(
    plugin.createTab({
      cwd: process.cwd(),
      env: { HERDR_SOCKET_PATH: "elsewhere" },
      label: "Issue",
    }),
    /reserved environment/,
  );
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  for (const key of [
    "Ctrl+Enter",
    "",
    "Shift-Enter",
    "right",
    "enter shift+enter",
    "enter,shift+enter",
    "right+enter",
    " enter",
    "enter ",
    "enter\n",
    "\r",
    "\u001b[13;2u",
    '{"keys":["enter"]}',
    "pane.send_input",
  ]) {
    await assert.rejects(
      plugin.submitText(handle, "must not send", key),
      /Unsupported submitKey/,
    );
  }
  assert.equal(server.requests.length, 3);
});

await test(
  "Windows drive-relative roots cannot select a cwd implicitly",
  {
    skip: process.platform !== "win32",
  },
  async (t) => {
    const server = await herdr(contextSteps());
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    await assert.rejects(
      plugin.createTab({ cwd: "\\", env: {}, label: "Issue" }),
      /absolute cwd/,
    );
    assert.equal(server.requests.length, 2);
  },
);

await test("foreign handles reject before target queries or mutations", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...contextSteps(),
  ]);
  t.after(() => server.close());
  const first = await createTerminalPlugin();
  const handle = await first.createTab({
    cwd: process.cwd(),
    env: {},
    label: "First",
  });
  const second = await createTerminalPlugin();
  for (const foreign of [handle, {}, Object.freeze({})]) {
    await assert.rejects(second.submitText(foreign, "no"), /foreign/);
    await assert.rejects(second.closeTab(foreign), /foreign/);
  }
});

await test("duplicate native creation replies cannot create two owned handles for one tab", async (t) => {
  const server = await herdr([...contextSteps(), createStep(), createStep()]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  await plugin.createTab({ cwd: process.cwd(), env: {}, label: "First" });
  await assert.rejects(
    plugin.createTab({ cwd: process.cwd(), env: {}, label: "Second" }),
    /reused|duplicate/i,
  );
});

for (const viaSubmission of [false, true]) {
  await test(`a known absent owned tab closes successfully and cannot receive input (observed by submit: ${String(viaSubmission)})`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      {
        method: "tab.get",
        params: { tab_id: "w1:t2" },
        error: { code: "tab_not_found", message: "tab absent" },
      },
      {
        method: "pane.get",
        params: { pane_id: "w1:p1" },
        result: { type: "pane_info", pane: caller },
      },
      {
        method: "tab.list",
        params: { workspace_id: "w1" },
        result: { type: "tab_list", tabs: [caller] },
      },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    if (viaSubmission) {
      await assert.rejects(plugin.submitText(handle, "no"), /absent/);
    }
    await plugin.closeTab(handle);
    assert.equal(server.requests.length, 6);
    await plugin.closeTab(handle);
    await assert.rejects(plugin.submitText(handle, "no"), /closed/);
    assert.equal(server.requests.length, 6);
  });
}

await test("a lost root pane invalidates the handle without later lookup or mutation", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    targetSteps()[0]!,
    {
      method: "pane.get",
      error: { code: "pane_not_found", message: "root gone" },
    },
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  await assert.rejects(plugin.submitText(handle, "no"), /root gone/);
  await assert.rejects(plugin.closeTab(handle), /invalid/i);
  assert.equal(server.requests.length, 5);
});

await test("a reused native target rejects before input or close", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    targetSteps()[0]!,
    {
      method: "pane.get",
      result: {
        type: "pane_info",
        pane: { ...pane, terminal_id: "replacement" },
      },
    },
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  await assert.rejects(plugin.submitText(handle, "no"), /identity changed/);
  await assert.rejects(plugin.closeTab(handle), /invalid/);
});

await test("target loss during input invalidates the handle without another dispatch", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.send_input",
      error: {
        code: "pane_not_found",
        message: "pane disappeared during input",
      },
    },
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  await assert.rejects(plugin.submitText(handle, "once"), /pane disappeared/);
  const count = server.requests.length;
  await assert.rejects(plugin.submitText(handle, "twice"), /invalid/);
  assert.equal(server.requests.length, count);
});

await test("refuses to close the last tab and implicitly destroy its workspace", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    { method: "tab.list", result: { type: "tab_list", tabs: [tab] } },
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  await assert.rejects(plugin.closeTab(handle), /last tab/);
});
