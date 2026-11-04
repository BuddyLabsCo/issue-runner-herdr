import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const exec = promisify(execFile);
export const root = fileURLToPath(new URL("../../", import.meta.url));

export async function installCandidate(consumer: string) {
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run package checks through npm so its CLI is available");
  const release = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as {
    private?: boolean;
    version: string;
    bin: Record<string, string>;
    dependencies: Record<string, string>;
    peerDependencies?: unknown;
  };
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  ) as {
    packages: Record<string, { integrity: string; resolved: string }>;
  };
  const pinned = lock.packages["node_modules/issue-runner-core"]!;
  assert.equal(pinned.resolved, "file:issue-runner-core-contract.1.tgz");
  assert.equal(
    pinned.integrity,
    "sha512-" +
      createHash("sha512")
        .update(await readFile(join(root, "issue-runner-core-contract.1.tgz")))
        .digest("base64"),
  );
  assert.equal(release.private, undefined);
  assert.equal(release.peerDependencies, undefined);
  assert.deepEqual(release.dependencies, {
    "issue-runner-core": "0.0.0-contract.1",
  });
  assert.deepEqual(release.bin, { "issue-runner-herdr": "./dist/cli.js" });
  assert.doesNotMatch(JSON.stringify(release), /file:|link:|\.tgz/);
  await exec(process.execPath, [npm, "run", "build"], { cwd: root });
  const candidate = join(consumer, "candidate");
  await mkdir(candidate);
  for (const file of ["dist", "README.md"])
    await cp(join(root, file), join(candidate, file), { recursive: true });
  await writeFile(
    join(candidate, "package.json"),
    JSON.stringify({
      ...release,
      dependencies: {
        "issue-runner-core": `file:${join(root, "issue-runner-core-contract.1.tgz")}`,
      },
    }),
  );
  const artifacts = join(consumer, "packed artifacts");
  await mkdir(artifacts);
  await exec(
    process.execPath,
    [npm, "pack", "--ignore-scripts", "--pack-destination", artifacts],
    { cwd: candidate },
  );
  const packed = await readdir(artifacts);
  assert.equal(packed.length, 1, "Expected exactly one packed artifact");
  const artifact = packed[0]!;
  assert.match(artifact, /\.tgz$/u);
  const originalPrefix = join(consumer, "original global prefix");
  await exec(
    process.execPath,
    [
      npm,
      "install",
      "--global",
      "--prefix",
      originalPrefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(artifacts, artifact),
    ],
    { cwd: consumer },
  );
  const prefix = join(consumer, "relocated global prefix");
  await rename(originalPrefix, prefix);
  const modules = join(
    prefix,
    ...(process.platform === "win32" ? [] : ["lib"]),
    "node_modules",
  );
  assert.deepEqual(
    (await readdir(modules)).filter((name) => !name.startsWith(".")),
    ["issue-runner-herdr"],
    "Only Herdr is installed globally; Core is a transitive runtime dependency",
  );
  const installed = join(modules, "issue-runner-herdr");
  const files = (
    await readdir(installed, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => !entry.isDirectory())
    .map((entry) =>
      relative(installed, join(entry.parentPath, entry.name))
        .split(sep)
        .join("/"),
    )
    .filter((file) => !file.startsWith("node_modules/"));
  for (const name of ["dist/index.js", "dist/index.d.ts", "dist/cli.js"])
    assert.ok(files.includes(name), name);
  for (const file of files)
    assert.ok(
      file === "package.json" ||
        file === "README.md" ||
        (file.startsWith("dist/") && /\.(js|d\.ts)$/u.test(file)),
      `Unexpected installed package file: ${file}`,
    );
  const core = join(installed, "node_modules/issue-runner-core");
  for (const file of [
    "dist/cli-entry.js",
    "dist/cli-entry.d.ts",
    "dist/terminal.js",
    "dist/terminal.d.ts",
    "dist/run/run.js",
    "templates/config.yaml",
    "templates/prompts/implement.md",
    "prompts/recovery.md",
    "skills/issue-runner-handoff/SKILL.md",
  ])
    assert.ok((await readFile(join(core, file))).length > 0, file);
  for (const file of [
    "dist/terminal.js",
    "dist/terminal.d.ts",
    "dist/cli-entry.js",
    "dist/cli-entry.d.ts",
  ])
    assert.deepEqual(
      await readFile(join(core, file)),
      await readFile(join(root, "node_modules/issue-runner-core", file)),
      "Installed candidate and checkout must use the same Core build: " + file,
    );
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  ) as { exports: object };
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  assert.equal(
    await readFile(join(root, "package.json"), "utf8"),
    JSON.stringify(release, null, 2) + "\n",
    "Candidate substitution never changes release metadata",
  );
  return { npm, installed, modules, prefix, version: release.version };
}
