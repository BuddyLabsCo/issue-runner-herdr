import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { exec, root } from "../fixtures/package.ts";
import { installedCommand } from "./command.ts";

export async function verifyCodex(
  npm: string,
  prefix: string,
  modules: string,
  cwd: string,
) {
  const run = installedCommand(prefix, cwd);
  const before = (await run(["--version"])).stdout;
  await exec(
    process.execPath,
    [
      npm,
      "install",
      "--global",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(root, "issue-runner-agent-codex-0.0.0-dev.1.tgz"),
    ],
    { cwd },
  );
  const manifest = JSON.parse(
    await readFile(
      join(modules, "issue-runner-agent-codex/package.json"),
      "utf8",
    ),
  ) as {
    peerDependencies: unknown;
    peerDependenciesMeta: unknown;
  };
  assert.deepEqual(manifest.peerDependencies, {
    "issue-runner-core": "0.0.0-contract.1",
  });
  assert.deepEqual(manifest.peerDependenciesMeta, {
    "issue-runner-core": { optional: true },
  });
  const consumer = join(cwd, "codex-consumer.mjs");
  await writeFile(
    consumer,
    `
    import assert from 'node:assert/strict';
    import { createTerminalPlugin } from ${JSON.stringify(pathToFileURL(join(modules, "issue-runner-herdr/dist/index.js")).href)};
    const plugin = await createTerminalPlugin({ enhancements: { readyTimeout: 0 } });
    await assert.rejects(plugin.createTab({ cwd: process.cwd(), env: {}, label: 'Actual Codex artifact', agent: 'codex', submitKey: 'Enter' }),
      /enhancements.readyTimeout must be finite and positive/);
  `,
  );
  // Codex's own validation proves factory loading without starting a real daemon or changing trust.
  await exec(process.execPath, [consumer], {
    cwd,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  assert.equal(
    (await run(["--version"])).stdout,
    before,
    "Installing Codex preserves the loaded Core identity",
  );
}
