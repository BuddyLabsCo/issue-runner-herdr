import assert from "node:assert/strict";
import test from "node:test";
import type { CreateTabOptions } from "issue-runner-core/terminal";
import { createTerminalPlugin } from "../../src/index.ts";
import { contextSteps, herdr } from "../fixtures/herdr.ts";

await test("invalid Herdr configuration rejects before host initialization", async (t) => {
  const server = await herdr([]);
  t.after(() => server.close());
  for (const config of [
    null,
    [],
    false,
    "config",
    { agentStartDelay: -1 },
    { agentStartDelay: NaN },
    { agentStartDelay: Infinity },
    { agentStartDelay: "10" },
    { agentStartDelay: null },
    { agentStartDelay: 2147484 },
    { enhancements: null },
    { enhancements: [] },
    { enhancements: false },
  ]) {
    await assert.rejects(
      createTerminalPlugin(config),
      /terminalPlugins|agentStartDelay|enhancements/,
    );
  }
  assert.deepEqual(server.requests, []);
});

await test("creation validates required Agent fields and optional Run signal before native creation", async (t) => {
  const server = await herdr(contextSteps());
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const valid = {
    cwd: process.cwd(),
    env: {},
    label: "Issue",
    agent: "opaque",
    submitKey: "Enter",
  };
  for (const changes of [
    { agent: undefined },
    { agent: "" },
    { agent: 1 },
    { submitKey: undefined },
    { submitKey: "" },
    { submitKey: "Ctrl+Enter" },
    { signal: {} },
  ]) {
    await assert.rejects(
      plugin.createTab({ ...valid, ...changes } as CreateTabOptions),
      /agent|submitKey|signal/,
    );
  }
  assert.equal(server.requests.length, 2);
});
