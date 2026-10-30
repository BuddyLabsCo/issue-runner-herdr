import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
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

await test("reports backend input failure without replaying the text", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.send_input",
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
