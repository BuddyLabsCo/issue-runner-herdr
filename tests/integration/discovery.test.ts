import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  genericEnhancement,
  installedPlugin,
} from "../fixtures/enhancement.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
} from "../fixtures/herdr.ts";

const options = {
  cwd: process.cwd(),
  env: {},
  label: "Discovery",
  agent: "generic",
  submitKey: "Enter",
};

for (const config of [undefined, {}]) {
  await test(`omitted enhancement options still discover the generic package: ${JSON.stringify(config)}`, async (t) => {
    const installed = await installedPlugin();
    t.after(() => installed.close());
    const fixture = await (await installed.install()).fixture();
    const server = await herdr([...contextSteps(), createStep()]);
    t.after(() => server.close());
    await (
      await installed.plugin.createTerminalPlugin(config)
    ).createTab(options);
    assert.deepEqual(fixture.calls[0]!.config, {});
  });
}

for (const agent of [
  "generic",
  "Opaque / name",
  "../generic",
  "generic/../../elsewhere",
  "GENERIC",
  "a".repeat(215),
]) {
  await test(`absent or invalid package identifier keeps base execution and ignores private settings: ${agent.slice(0, 30)}`, async (t) => {
    const installed = await installedPlugin();
    t.after(() => installed.close());
    await installed.install(
      "unrelated",
      "throw new Error('must not import unrelated package');",
    );
    const project = join(installed.prefix, "project");
    const cache = join(installed.prefix, "cache");
    const other = join(installed.prefix, "other-prefix", "node_modules");
    for (const directory of [join(project, "node_modules"), cache, other]) {
      const local = join(directory, "issue-runner-agent-generic");
      await mkdir(local, { recursive: true });
      await writeFile(
        join(local, "package.json"),
        JSON.stringify({ type: "module", main: "./index.mjs" }),
      );
      await writeFile(
        join(local, "index.mjs"),
        "throw new Error('must not import decoys');",
      );
    }
    const original = process.cwd();
    process.chdir(project);
    t.after(() => process.chdir(original));
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...inputSteps("base command"),
    ]);
    t.after(() => server.close());
    const plugin = await installed.plugin.createTerminalPlugin({
      agentStartDelay: 0,
      enhancements: { removedPackageOption: ["ignored"] },
    });
    const tab = await plugin.createTab({ ...options, cwd: project, agent });
    assert.equal(await plugin.start(tab, "base command"), undefined);
  });
}

const broken = [
  [
    "default-only exports",
    "export default { contractVersion: 1, createEnhancement() {} };",
    /contractVersion/,
  ],
  [
    "incompatible version",
    genericEnhancement.replace("contractVersion = 1", "contractVersion = 2"),
    /contractVersion/,
  ],
  ["missing factory", "export const contractVersion = 1;", /createEnhancement/],
  [
    "non-callable factory",
    "export const contractVersion = 1; export const createEnhancement = 1;",
    /createEnhancement/,
  ],
  [
    "missing transitive dependency",
    "import 'missing-transitive-enhancement-dependency'; " + genericEnhancement,
    /missing-transitive-enhancement-dependency/,
  ],
  [
    "initialization rejection",
    "export const contractVersion = 1; export async function createEnhancement() { throw new Error('preflight failed'); }",
    /preflight failed/,
  ],
  [
    "invalid returned instance",
    "export const contractVersion = 1; export async function createEnhancement() { return null; }",
    /startMonitoring/,
  ],
] as const;

for (const [name, source, expected] of broken) {
  await test(`installed ${name} rejects instead of selecting base execution`, async (t) => {
    const installed = await installedPlugin();
    t.after(() => installed.close());
    await installed.install("generic", source);
    const server = await herdr([...contextSteps(), createStep()]);
    t.after(() => server.close());
    const plugin = await installed.plugin.createTerminalPlugin({
      agentStartDelay: 0,
    });
    await assert.rejects(plugin.createTab(options), expected);
  });
}

for (const method of [
  "startMonitoring",
  "waitUntilReady",
  "onAssignment",
  "stop",
]) {
  await test(`installed enhancement must implement ${method}`, async (t) => {
    const installed = await installedPlugin();
    t.after(() => installed.close());
    await installed.install(
      "generic",
      genericEnhancement.replace(`${method}(`, `missing_${method}(`),
    );
    const server = await herdr([...contextSteps(), createStep()]);
    t.after(() => server.close());
    await assert.rejects(
      (await installed.plugin.createTerminalPlugin({})).createTab(options),
      /Enhancement must provide/,
    );
  });
}

for (const escape of ["package", "entry"]) {
  await test(`rejects ${escape} symlinks escaping the same-prefix package`, async (t) => {
    const installed = await installedPlugin();
    t.after(() => installed.close());
    const outside = join(installed.prefix, "outside");
    await mkdir(outside);
    await writeFile(
      join(outside, "package.json"),
      JSON.stringify({ type: "module", main: "./outside.mjs" }),
    );
    await writeFile(
      join(outside, "outside.mjs"),
      "throw new Error('escaped entry imported');",
    );
    if (escape === "package") {
      await symlink(
        outside,
        join(installed.modules, "issue-runner-agent-generic"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } else {
      const enhancement = await installed.install();
      await symlink(
        outside,
        join(enhancement.root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await writeFile(
        join(enhancement.root, "package.json"),
        JSON.stringify({ type: "module", exports: "./linked/outside.mjs" }),
      );
    }
    const server = await herdr([...contextSteps(), createStep()]);
    t.after(() => server.close());
    await assert.rejects(
      (await installed.plugin.createTerminalPlugin({})).createTab(options),
      /same npm prefix|escapes its installed package/,
    );
  });
}
