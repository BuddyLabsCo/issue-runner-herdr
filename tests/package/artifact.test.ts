import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
} from "../fixtures/herdr.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));

await test("installed artifact conforms to Core and completes an Enter lifecycle in a consumer with spaces", async (t) => {
  const consumer = await mkdtemp(join(tmpdir(), "herdr package consumer "));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const artifacts = join(consumer, "artifacts");
  await mkdir(artifacts);
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run package checks through npm so its CLI is available");
  const packed = await exec(
    process.execPath,
    [npm, "pack", "--json", "--pack-destination", artifacts],
    { cwd: root },
  );
  const [artifact] = JSON.parse(packed.stdout) as {
    filename: string;
    files: { path: string }[];
  }[];
  assert.ok(artifact);
  assert.ok(artifact.files.some(({ path }) => path === "dist/index.js"));
  assert.ok(artifact.files.some(({ path }) => path === "dist/index.d.ts"));
  assert.ok(
    artifact.files.every(
      ({ path }) =>
        path === "package.json" ||
        path === "README.md" ||
        (path.startsWith("dist/") && /\.(js|d\.ts)$/.test(path)),
    ),
    "Only built runtime files, declarations, and package documentation ship",
  );
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await exec(
    process.execPath,
    [
      npm,
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--offline",
      join(root, "issue-runner-core-contract.1.tgz"),
      join(artifacts, artifact.filename),
    ],
    { cwd: consumer },
  );
  const installed = join(consumer, "node_modules", "issue-runner-herdr");
  assert.deepEqual(
    (await readdir(join(consumer, "node_modules")))
      .filter((name) => !name.startsWith("."))
      .sort(),
    ["issue-runner-core", "issue-runner-herdr"],
    "The consumer has no checkout development dependencies",
  );
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(manifest.bin, undefined, "Core owns the only Runner executable");
  assert.ok(manifest.exports && typeof manifest.exports === "object");
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  await writeFile(
    join(consumer, "contract.mts"),
    `
import type { TerminalPlugin, TerminalPluginModule } from "issue-runner-core/terminal";
import * as plugin from "issue-runner-herdr";
const contract: TerminalPluginModule = plugin;
const version: 1 = plugin.contractVersion;
const args: Parameters<typeof plugin.createTerminalPlugin> = [];
const initialized: Promise<TerminalPlugin> = contract.createTerminalPlugin(...args);
const tab = await (await initialized).createTab({ cwd: "/unused", env: {}, label: "Types only" });
await (await initialized).submitText(tab, "echo done");
await (await initialized).closeTab(tab);
void version;
`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
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
    [join(root, "node_modules/typescript/bin/tsc"), "-p", consumer],
    { cwd: consumer },
  );
  await writeFile(
    join(consumer, "consumer.mjs"),
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
const initialized = plugin.createTerminalPlugin();
assert.ok(initialized instanceof Promise);
const terminal = await initialized;
assert.deepEqual(Object.keys(terminal).sort(), ["closeTab", "createTab", "submitText"]);
const tab = await terminal.createTab({ cwd: process.cwd(), env: {}, label: "Packaged lifecycle" });
await terminal.submitText(tab, "echo packaged");
await terminal.submitText(tab, "echo explicit", "Enter");
await terminal.closeTab(tab);
`,
  );
  const server = await herdr([
    ...contextSteps(),
    createStep(),
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
  ]);
  t.after(() => server.close());
  await exec(process.execPath, ["consumer.mjs"], {
    cwd: consumer,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  const creation = server.requests[2];
  assert.equal(creation?.params.cwd, consumer);
  assert.equal(creation.params.label, "Packaged lifecycle");
});
