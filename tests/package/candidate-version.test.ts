import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { exec, root, installCandidate } from "../fixtures/package.ts";
import { verifyCommand } from "./command.ts";

await test("verifies a supplied candidate whose version differs from the checkout", async (t) => {
  const consumer = await realpath(
    await mkdtemp(join(tmpdir(), "herdr distinct candidate ")),
  );
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const npm = process.env.npm_execpath;
  assert.ok(npm);
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.notEqual(manifest.version, "9.8.7");
  const staging = join(consumer, "candidate source");
  await mkdir(staging);
  await exec(
    process.execPath,
    [npm, "run", "build", "--", "--outDir", join(staging, "dist")],
    { cwd: root },
  );
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify({ ...manifest, version: "9.8.7" }),
  );
  await exec(
    process.execPath,
    [npm, "pack", "--ignore-scripts", "--pack-destination", consumer],
    { cwd: staging },
  );
  const { installed, prefix, version } = await installCandidate(
    consumer,
    join(consumer, "issue-runner-herdr-9.8.7.tgz"),
  );
  assert.equal(version, "9.8.7");
  await verifyCommand(prefix, installed, consumer, "9.8.7");
});
