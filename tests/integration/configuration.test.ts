import assert from "node:assert/strict";
import test from "node:test";
import type { CreateTabOptions } from "issue-runner-core/terminal";
import { createTerminalPlugin } from "../../src/index.ts";
import { contextSteps, herdr } from "../fixtures/herdr.ts";

await test("invalid Herdr configuration rejects before host initialization", async (t) => {
  const server = await herdr([]);
  t.after(() => server.close());
  for (const config of [null, [], false, "config"]) {
    await assert.rejects(createTerminalPlugin(config), /terminalPlugins/);
  }
  assert.deepEqual(server.requests, []);
});

await test("creation validates submit key and optional Run signal before native creation", async (t) => {
  const server = await herdr(contextSteps());
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const valid = {
    cwd: process.cwd(),
    env: {},
    label: "Issue",
    submitKey: "Enter",
  };
  for (const changes of [
    { submitKey: undefined },
    { submitKey: "" },
    { submitKey: "Ctrl+Enter" },
    { signal: {} },
  ]) {
    await assert.rejects(
      plugin.createTab({ ...valid, ...changes } as CreateTabOptions),
      /submitKey|signal/,
    );
  }
  assert.equal(server.requests.length, 2);
});

await test("Core-owned settings pass through without adapter interpretation", async (t) => {
  const server = await herdr(contextSteps());
  t.after(() => server.close());
  const config = Object.freeze({
    get agentStartDelay() {
      throw new Error("Core owns delay");
    },
    get enhancements() {
      throw new Error("Core owns enhancements");
    },
  });
  await createTerminalPlugin(config);
  assert.equal(server.requests.length, 2);
});
