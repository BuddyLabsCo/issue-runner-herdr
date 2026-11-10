import { verifyCommand } from "./command.ts";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { exec, root, installCandidate } from "../fixtures/package.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
  pane,
} from "../fixtures/herdr.ts";

await test("installed artifact conforms to Core v2 in a relocated consumer with spaces", async (t) => {
  const consumer = await realpath(
    await mkdtemp(join(tmpdir(), "herdr package consumer ")),
  );
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const { installed, prefix, version } = await installCandidate(consumer);
  await verifyCommand(prefix, installed, consumer, version);
  await writeFile(
    join(installed, "contract.mts"),
    `
import type { TerminalIO, TerminalPlugin, TerminalPluginModule } from "issue-runner-core/terminal";
import { runCli, type CliOptions } from "issue-runner-core/cli";
import * as plugin from "issue-runner-herdr";
const contract: TerminalPluginModule = plugin;
const options: CliOptions = { commandName: "issue-runner-herdr", commandVersion: ${JSON.stringify(version)}, terminal: plugin, terminalPackageRoot: "/installed/herdr", terminalCliEntry: "/installed/herdr/dist/cli.js" };
const run: (options: CliOptions) => Promise<void> = runCli;
void options; void run;
const version: 2 = plugin.contractVersion;
const args: Parameters<typeof plugin.createTerminalPlugin> = [{ agentStartDelay: 0, enhancements: { retained: true } }];
const initialized: Promise<TerminalPlugin> = contract.createTerminalPlugin(args[0]);
const terminal = await initialized;
const { handle, io } = await terminal.createTab({ cwd: "/unused", env: {}, label: "Types only", submitKey: "Shift+Enter" });
const bound: TerminalIO = io;
const executed: void = await terminal.execute(handle, "opaque command");
const screen: string = await bound.read();
await bound.submitText(screen);
await bound.sendKeys(["Escape", "Shift+Enter"]);
await terminal.closeTab(handle);
void version; void executed;
// @ts-expect-error creation has no Agent selector
await terminal.createTab({ cwd: "/unused", env: {}, label: "Invalid", submitKey: "Enter", agent: "opaque" });
// @ts-expect-error submission key belongs to creation
await io.submitText("text", "Enter");
// @ts-expect-error startup orchestration belongs to Core
await terminal.start(handle, "command");
// @ts-expect-error resume orchestration belongs to Core
await terminal.resume(handle, "command", "ref");
// @ts-expect-error bound I/O owns text submission
await terminal.submitText(handle, "text");
`,
  );
  await writeFile(
    join(installed, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "NodeNext",
        target: "ES2022",
        types: [],
      },
      files: ["contract.mts"],
    }),
  );
  await exec(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", installed],
    { cwd: consumer },
  );
  await writeFile(
    join(installed, "consumer.mjs"),
    `
import assert from "node:assert/strict";
import * as plugin from "issue-runner-herdr";
import { terminalContractVersion, enhancementContractVersion } from "issue-runner-core/terminal";
assert.equal(import.meta.resolve("issue-runner-herdr"), ${JSON.stringify(pathToFileURL(join(installed, "dist/index.js")).href)});
assert.deepEqual(Object.keys(plugin).sort(), ["contractVersion", "createTerminalPlugin"]);
assert.equal(plugin.contractVersion, 2);
assert.equal(terminalContractVersion, 2);
assert.equal(enhancementContractVersion, 3);
assert.equal(plugin.createTerminalPlugin.length, 0);
for (const entry of ["src/index.ts", "dist/index.js", "dist/herdr/client.js", "terminal/testing"]) {
  await assert.rejects(import("issue-runner-herdr/" + entry), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
}
const initialized = plugin.createTerminalPlugin({ agentStartDelay: 100, enhancements: { privateSetting: ["ignored"] } });
assert.ok(initialized instanceof Promise);
const terminal = await initialized;
assert.deepEqual(Object.keys(terminal).sort(), ["closeTab", "createTab", "execute"]);
const { handle, io } = await terminal.createTab({ cwd: process.cwd(), env: {}, label: "Packaged lifecycle", submitKey: "Shift+Enter" });
assert.deepEqual(handle, {});
assert.deepEqual(Object.keys(io).sort(), ["read", "sendKeys", "submitText"]);
assert.equal(await terminal.execute(handle, "agent --configured"), undefined);
assert.equal(await terminal.execute(handle, "agent --configured"), undefined);
assert.equal(await io.read(), "Visible screen 中文");
await io.submitText("Complete text\\n\\n  中文 $HOME");
await io.sendKeys(["Escape", "Shift+Enter"]);
await terminal.closeTab(handle);
await terminal.closeTab(handle);
await assert.rejects(io.read(), /closed/);
await assert.rejects(io.submitText("late"), /closed/);
await assert.rejects(io.sendKeys(["Enter"]), /closed/);
`,
  );
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("agent --configured"),
    ...targetSteps(),
    ...inputSteps("agent --configured"),
    ...targetSteps(),
    {
      method: "pane.read",
      params: {
        pane_id: pane.pane_id,
        source: "visible",
        format: "text",
        strip_ansi: true,
      },
      result: {
        type: "pane_read",
        read: {
          pane_id: pane.pane_id,
          workspace_id: pane.workspace_id,
          tab_id: pane.tab_id,
          source: "visible",
          format: "text",
          text: "Visible screen 中文",
        },
      },
    },
    ...targetSteps(),
    ...inputSteps("Complete text\n\n  中文 $HOME", "shift+enter"),
    ...targetSteps(),
    {
      method: "pane.send_input",
      params: { pane_id: pane.pane_id, text: "", keys: ["escape"] },
      result: { type: "ok" },
    },
    {
      method: "pane.send_input",
      params: { pane_id: pane.pane_id, text: "", keys: ["shift+enter"] },
      result: { type: "ok" },
    },
    ...targetSteps(),
    {
      method: "tab.list",
      params: { workspace_id: "w1" },
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
  ]);
  t.after(() => server.close());
  await exec(process.execPath, [join(installed, "consumer.mjs")], {
    cwd: consumer,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  const creation = server.requests[2];
  assert.equal(creation?.params.cwd, consumer);
  assert.equal(creation.params.label, "Packaged lifecycle");
});
