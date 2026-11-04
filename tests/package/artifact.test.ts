import { verifyCodex } from "./codex.ts";
import { verifyCommand } from "./command.ts";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
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
} from "../fixtures/herdr.ts";

await test("installed artifact conforms to Core composite startup in a consumer with spaces", async (t) => {
  // Match discovery's canonical paths so Windows temp aliases share one module instance.
  const consumer = await realpath(
    await mkdtemp(join(tmpdir(), "herdr package consumer ")),
  );
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const { npm, installed, modules, prefix, version } =
    await installCandidate(consumer);
  await verifyCommand(prefix, installed, consumer, version);
  await writeFile(
    join(installed, "contract.mts"),
    `
import type { EnhancementModule, TerminalPlugin, TerminalPluginModule } from "issue-runner-core/terminal";
import { runCli, type CliOptions } from "issue-runner-core/cli";
import * as plugin from "issue-runner-herdr";
const contract: TerminalPluginModule = plugin;
const options: CliOptions = { commandName: "issue-runner-herdr", commandVersion: "0.0.0-dev.1", terminal: plugin };
const run: (options: CliOptions) => Promise<void> = runCli;
void options; void run;
const version: 1 = plugin.contractVersion;
const args: Parameters<typeof plugin.createTerminalPlugin> = [{ agentStartDelay: 0, enhancements: { retained: true } }];
const initialized: Promise<TerminalPlugin> = contract.createTerminalPlugin(args[0]);
const tab = await (await initialized).createTab({ cwd: "/unused", env: {}, label: "Types only", agent: "opaque", submitKey: "Shift+Enter", signal: new AbortController().signal });
const terminal = await initialized;
const started: string | undefined = await terminal.start(tab, "agent --configured");
const resumed: string = await terminal.resume(tab, "agent resume exact", "exact");
await terminal.submitText(tab, "echo done", undefined, "/handoff.json", "recovery");
void started; void resumed;
await (await initialized).closeTab(tab);
void version;
const enhancement: EnhancementModule = {
  contractVersion: 1,
  async createEnhancement(host, context, config) {
    const cwd: string = context.cwd;
    const env: Readonly<Record<string, string>> = context.env;
    const screen: string = await host.read();
    await host.submitText(screen);
    await host.sendKeys(["Escape", "Shift+Enter"]);
    await host.requestRecovery();
    void cwd; void env; void config;
    return { async startMonitoring(ref) { void ref; }, async waitUntilReady() { return "ref"; }, onAssignment(file) { void file; }, async stop() {} };
  }
};
void enhancement;
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
  const enhancement = join(modules, "issue-runner-agent-generic");
  await mkdir(enhancement);
  await writeFile(
    join(enhancement, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.mjs" }),
  );
  await writeFile(
    join(enhancement, "index.mjs"),
    `
import assert from "node:assert/strict";
export const contractVersion = 1;
export const calls = [];
export async function createEnhancement(host, context, config) {
  assert.equal(context.cwd, process.cwd());
  assert.deepEqual(context.env, { GENERIC: "context" });
  assert.deepEqual(config, { shared: { option: true }, other: ["kept"] });
  const call = { host, assignments: [], monitoring: [], readiness: 0, stopped: false };
  calls.push(call);
  if (calls.length === 1) {
    assert.equal(await host.read(), "Visible screen 中文");
    await host.submitText("完整 text\\n\\n  indented\\n");
    await host.sendKeys(["Escape", "Shift+Enter"]);
    await assert.rejects(host.requestRecovery(), /retained Core recovery/);
  }
  return {
    async startMonitoring(ref) { call.monitoring.push(ref); },
    async waitUntilReady() {
      assert.equal(call.monitoring.length, 1);
      call.readiness++;
      if (call.monitoring[0] !== undefined && call.readiness === 1) throw new Error("readiness unavailable");
      return call.monitoring[0] ?? "packaged native ref";
    },
    onAssignment(...args) { call.assignments.push(args); },
    async stop() { call.stopped = true; await assert.rejects(host.submitText("late"), /abort/); }
  };
}
`,
  );
  await writeFile(
    join(consumer, "enhanced-consumer.mjs"),
    `
import assert from "node:assert/strict";
import { createTerminalPlugin } from ${JSON.stringify(pathToFileURL(join(modules, "issue-runner-herdr/dist/index.js")).href)};
import * as fixture from ${JSON.stringify(pathToFileURL(join(enhancement, "index.mjs")).href)};
const terminal = await createTerminalPlugin({ enhancements: { shared: { option: true }, other: ["kept"] } });
const tab = await terminal.createTab({ cwd: process.cwd(), env: { GENERIC: "context" }, label: "Global enhancement", agent: "generic", submitKey: "Shift+Enter" });
assert.equal(fixture.calls[0].stopped, false);
assert.deepEqual(fixture.calls[0].monitoring, []);
assert.equal(await terminal.start(tab, "generic-agent --configured"), "packaged native ref");
assert.equal(await terminal.start(tab, "must not be replayed"), "packaged native ref");
assert.deepEqual(fixture.calls[0].monitoring, [undefined]);
assert.equal(fixture.calls[0].readiness, 2);
await terminal.submitText(tab, "Packaged task", undefined, "/exact/../handoff 中文.json", "Packaged recovery\\n\\n  中文\\n");
assert.deepEqual(fixture.calls[0].assignments, [["/exact/../handoff 中文.json"]]);
await fixture.calls[0].host.requestRecovery();
await terminal.submitText(tab, "Packaged continuation", "Enter", "/exact/../handoff 中文.json", "Latest packaged recovery");
await fixture.calls[0].host.requestRecovery();
assert.deepEqual(fixture.calls[0].assignments, [["/exact/../handoff 中文.json"], ["/exact/../handoff 中文.json"]]);
await terminal.closeTab(tab);
assert.equal(fixture.calls[0].stopped, true);
await terminal.closeTab(tab);
const resumer = await createTerminalPlugin({ enhancements: { shared: { option: true }, other: ["kept"] } });
const resumed = await resumer.createTab({ cwd: process.cwd(), env: { GENERIC: "context" }, label: "Enhanced resume", agent: "generic", submitKey: "Shift+Enter" });
await assert.rejects(resumer.resume(resumed, "generic-agent resume 'saved ref'", "packaged saved ref"), /readiness unavailable/);
assert.equal(await resumer.resume(resumed, "must not be replayed", "packaged saved ref"), "packaged saved ref");
assert.equal(fixture.calls.length, 2);
assert.deepEqual(fixture.calls[1].monitoring, ["packaged saved ref"]);
assert.equal(fixture.calls[1].readiness, 2);
await resumer.closeTab(resumed);
assert.equal(fixture.calls[1].stopped, true);
`,
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
assert.equal(import.meta.resolve("issue-runner-herdr"), ${JSON.stringify(
      pathToFileURL(join(installed, "dist/index.js")).href,
    )});
assert.deepEqual(Object.keys(plugin).sort(), ["contractVersion", "createTerminalPlugin"]);
assert.ok(Number.isInteger(plugin.contractVersion));
assert.equal(plugin.contractVersion, 1);
assert.equal(plugin.createTerminalPlugin.length, 0);
for (const entry of ["src/index.ts", "dist/index.js", "dist/herdr/client.js", "terminal/testing"]) {
  await assert.rejects(import("issue-runner-herdr/" + entry), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
}
const initialized = plugin.createTerminalPlugin({ agentStartDelay: 0, enhancements: { privateSetting: ["ignored"] } });
assert.ok(initialized instanceof Promise);
const terminal = await initialized;
assert.deepEqual(Object.keys(terminal).sort(), ["closeTab", "createTab", "resume", "start", "submitText"]);
const tab = await terminal.createTab({ cwd: process.cwd(), env: {}, label: "Packaged lifecycle", agent: "opaque", submitKey: "Shift+Enter" });
assert.equal(await terminal.start(tab, "agent --configured"), undefined);
assert.equal(await terminal.start(tab, "agent --configured"), undefined);
await terminal.submitText(tab, "echo packaged", undefined, "/exact/handoff.json", "Core recovery wording");
await terminal.submitText(tab, "echo explicit", "Enter", "/next/handoff.json", "Latest Core recovery wording");
await terminal.closeTab(tab);
const resumer = await plugin.createTerminalPlugin({ agentStartDelay: 0 });
const resumed = await resumer.createTab({ cwd: process.cwd(), env: {}, label: "Packaged resume", agent: "opaque", submitKey: "Enter" });
assert.equal(await resumer.resume(resumed, "agent resume 'saved ref'", "saved ref"), "saved ref");
assert.equal(await resumer.resume(resumed, "agent resume 'saved ref'", "saved ref"), "saved ref");
await resumer.closeTab(resumed);
`,
  );
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("agent --configured"),
    ...targetSteps(),
    ...inputSteps("echo packaged"),
    ...targetSteps(),
    ...inputSteps("echo explicit"),
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
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("agent resume 'saved ref'"),
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
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.read",
      params: {
        pane_id: "w1:p2",
        source: "visible",
        format: "text",
        strip_ansi: true,
      },
      result: {
        type: "pane_read",
        read: {
          pane_id: "w1:p2",
          workspace_id: "w1",
          tab_id: "w1:t2",
          source: "visible",
          format: "text",
          text: "Visible screen 中文",
        },
      },
    },
    ...targetSteps(),
    ...inputSteps("完整 text\n\n  indented\n", "shift+enter"),
    ...targetSteps(),
    {
      method: "pane.send_input",
      params: { pane_id: "w1:p2", text: "", keys: ["escape"] },
      result: { type: "ok" },
    },
    {
      method: "pane.send_input",
      params: { pane_id: "w1:p2", text: "", keys: ["shift+enter"] },
      result: { type: "ok" },
    },
    ...targetSteps(),
    ...targetSteps(),
    ...inputSteps("generic-agent --configured"),
    ...targetSteps(),
    ...inputSteps("Packaged task"),
    ...targetSteps(),
    ...inputSteps("Packaged recovery\n\n  中文\n", "shift+enter"),
    ...targetSteps(),
    ...inputSteps("Packaged continuation"),
    ...targetSteps(),
    ...inputSteps("Latest packaged recovery", "shift+enter"),
    ...targetSteps(),
    {
      method: "tab.list",
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
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("generic-agent resume 'saved ref'"),
    ...targetSteps(),
    {
      method: "tab.list",
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
    ...contextSteps(),
    createStep(),
  ]);
  t.after(() => server.close());
  await exec(process.execPath, [join(installed, "consumer.mjs")], {
    cwd: consumer,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  await exec(process.execPath, ["enhanced-consumer.mjs"], {
    cwd: consumer,
    env: {
      ...process.env,
      npm_config_prefix: join(consumer, "unrelated active prefix"),
      PATH: "",
      NODE_PATH: "",
      NODE_OPTIONS: "",
    },
  });
  await verifyCodex(npm, prefix, modules, consumer);
  const creation = server.requests[2];
  assert.equal(creation?.params.cwd, consumer);
  assert.equal(creation.params.label, "Packaged lifecycle");
});
