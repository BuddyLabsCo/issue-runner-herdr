import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  tab,
  targetSteps,
} from "../fixtures/herdr.ts";

await test("reports tab creation failures instead of claiming a usable handle", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    {
      method: "tab.create",
      error: {
        code: "tab_create_failed",
        message: "shell executable unavailable",
      },
    },
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  await assert.rejects(
    plugin.createTab({ cwd: process.cwd(), env: {}, label: "Issue" }),
    /tab.create: tab_create_failed: shell executable unavailable/,
  );
});

await test("body failure rejects before Right or Enter without replaying the text", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.send_input",
      params: { pane_id: "w1:p2", text: "echo once", keys: [] },
      error: { code: "input_failed", message: "PTY write failed" },
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
    plugin.submitText(handle, "echo once"),
    /pane.send_input: input_failed: PTY write failed/,
  );
  assert.equal(
    server.requests.filter((request) => request.method === "pane.send_input")
      .length,
    1,
  );
});

for (const [index, name] of [
  [1, "Right"],
  [2, "Enter"],
] as const) {
  await test(`${name} failure rejects without later input or replay`, async (t) => {
    const input = inputSteps("echo once");
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...input.slice(0, index),
      {
        method: "pane.send_input",
        params: input[index]!.params!,
        error: { code: "input_failed", message: `${name} write failed` },
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
      plugin.submitText(handle, "echo once"),
      new RegExp(`pane.send_input: input_failed: ${name} write failed`),
    );
    assert.equal(server.requests.length, 6 + index);
  });
}

await test("ordinary lookup failure is not treated as known absence", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    {
      method: "tab.get",
      error: { code: "unavailable", message: "backend busy" },
    },
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  await assert.rejects(plugin.closeTab(handle), /backend busy/);
});

for (const fault of [
  { disconnect: true },
  { raw: "not JSON\n" },
  { raw: '{"id":"unrelated","result":{"type":"ok"}}\n' },
  { raw: '{"id":"unrelated","error":{"code":1}}\n' },
]) {
  await test(`transport/protocol loss invalidates associations without reconnect or replay: ${JSON.stringify(fault)}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      { method: "pane.send_input", ...fault },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    await assert.rejects(
      plugin.submitText(handle, "echo once"),
      /invalidated.*pane.send_input/,
    );
    const count = server.requests.length;
    await assert.rejects(
      plugin.submitText(handle, "echo twice"),
      /invalidated/,
    );
    await assert.rejects(plugin.closeTab(handle), /invalidated/);
    await assert.rejects(
      plugin.createTab({ cwd: process.cwd(), env: {}, label: "Again" }),
      /invalidated/,
    );
    assert.equal(server.requests.length, count);
  });
}

for (const envelope of [
  {},
  { result: null },
  { result: { type: "tab_created" } },
  { error: { code: 1, message: "failed" } },
  { error: { code: "failed" } },
  {
    result: { type: "ok" },
    error: { code: "failed", message: "ambiguous reply" },
  },
]) {
  await test(`a correlated malformed reply rejects before keys: ${JSON.stringify(envelope)}`, async (t) => {
    const setup = [...contextSteps(), createStep(), ...targetSteps()];
    const server = await herdr((request) => {
      if (setup.length) return setup.shift()!;
      return {
        method: "pane.send_input",
        params: { pane_id: "w1:p2", text: "once", keys: [] },
        raw: JSON.stringify({ id: request.id, ...envelope }) + "\n",
      };
    });
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    await assert.rejects(
      plugin.submitText(handle, "once"),
      /invalidated.*pane.send_input.*(?:expected ok|malformed error)/,
    );
    assert.equal(server.requests.length, 6);
  });
}

await test("an oversized UTF-8 body rejects with the encoding limit before any input", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...targetSteps(),
    ...inputSteps("small explicit follow-up"),
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const handle = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Issue",
  });
  await assert.rejects(
    plugin.submitText(handle, "\u4e2d".repeat(350_000)),
    /pane.send_input: request exceeds the 0.9.5 1 MiB limit/,
  );
  assert.equal(server.requests.length, 5);
  await plugin.submitText(handle, "small explicit follow-up");
});

await test("a backend close rejection reports its method and reason without replay", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "tab.list",
      result: {
        type: "tab_list",
        tabs: [{ tab_id: "w1:t1", workspace_id: "w1" }, tab],
      },
    },
    {
      method: "tab.close",
      params: { tab_id: "w1:t2" },
      error: { code: "close_failed", message: "tab could not be removed" },
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
    /tab.close: close_failed: tab could not be removed/,
  );
  assert.equal(server.requests.length, 7);
});

await test(
  "a partial backend reply has a finite total I/O deadline",
  { timeout: 8000 },
  async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      { method: "pane.send_input", raw: '{"id":', stall: true },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    const start = performance.now();
    await assert.rejects(
      plugin.submitText(handle, "echo once"),
      /timed out after 5000 ms/,
    );
    assert.ok(performance.now() - start < 7000);
    await assert.rejects(plugin.closeTab(handle), /invalidated/);
  },
);
