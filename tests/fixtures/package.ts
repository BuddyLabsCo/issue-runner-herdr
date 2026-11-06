import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const exec = promisify(execFile);
export const root = fileURLToPath(new URL("../../", import.meta.url));

export async function installCandidate(
  consumer: string,
  candidateTarball = process.env.HERDR_CANDIDATE_TARBALL,
) {
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run package checks through npm so its CLI is available");
  const releaseText = await readFile(join(root, "package.json"), "utf8");
  const release = JSON.parse(releaseText) as {
    private?: boolean;
    version: string;
    bin: Record<string, string>;
    dependencies: Record<string, string>;
    peerDependencies?: unknown;
  };
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  ) as {
    packages: Record<
      string,
      { version: string; integrity: string; resolved: string }
    >;
  };
  const pinned = lock.packages["node_modules/issue-runner-core"]!;
  assert.equal(
    pinned.resolved,
    "https://registry.npmjs.org/issue-runner-core/-/issue-runner-core-0.1.3.tgz",
  );
  assert.match(pinned.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
  assert.equal(pinned.version, release.dependencies["issue-runner-core"]);
  assert.equal(release.private, undefined);
  assert.equal(release.peerDependencies, undefined);
  assert.deepEqual(release.dependencies, {
    "issue-runner-core": "0.1.3",
  });
  assert.deepEqual(release.bin, { "issue-runner-herdr": "./dist/cli.js" });
  assert.doesNotMatch(JSON.stringify(release), /file:|link:|\.tgz/);
  let artifact = candidateTarball ? resolve(candidateTarball) : undefined;
  if (!artifact) {
    await exec(process.execPath, [npm, "run", "build"], { cwd: root });
    const artifacts = join(consumer, "packed artifacts");
    await mkdir(artifacts);
    await exec(
      process.execPath,
      [npm, "pack", "--ignore-scripts", "--pack-destination", artifacts],
      { cwd: root },
    );
    const packed = await readdir(artifacts);
    assert.equal(packed.length, 1, "Expected exactly one packed artifact");
    artifact = join(artifacts, packed[0]!);
  }
  assert.match(artifact, /\.tgz$/u);
  const artifactBytes = await readFile(artifact);
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
      artifact,
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
  const installedCore = JSON.parse(
    await readFile(join(core, "package.json"), "utf8"),
  ) as { version: string };
  assert.equal(
    installedCore.version,
    release.dependencies["issue-runner-core"],
  );
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
  ) as {
    exports: object;
    version: string;
    dependencies: Record<string, string>;
    bin: Record<string, string>;
    keywords: string[];
  };
  assert.deepEqual(manifest.keywords, [
    "issue-runner",
    "herdr",
    "terminal",
    "terminal-plugin",
    "cli",
    "github-issues",
    "workflow-automation",
    "ai-agents",
    "coding-agent",
  ]);
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  assert.deepEqual(manifest.dependencies, release.dependencies);
  assert.deepEqual(manifest.bin, release.bin);
  assert.deepEqual(
    await readFile(artifact),
    artifactBytes,
    "Package checks never change the candidate artifact",
  );
  assert.equal(
    await readFile(join(root, "package.json"), "utf8"),
    releaseText,
    "Package checks never change release metadata",
  );
  return { npm, installed, modules, prefix, version: manifest.version };
}
