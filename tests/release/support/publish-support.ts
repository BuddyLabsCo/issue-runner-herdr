import {
  createReleaseFixture,
  type FixtureOptions,
  type ReleaseFixture,
} from "./release-fixture.ts";

export const releaseRepository = "BuddyLabsCo/issue-runner-herdr";

export const readyPackage = {
  manifest: {
    name: "issue-runner-herdr",
    repository: {
      type: "git",
      url: "git+https://github.com/BuddyLabsCo/issue-runner-herdr.git",
    },
    version: "0.1.0",
    description: "Herdr terminal plugin",
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    bin: { "issue-runner-herdr": "./dist/cli.js" },
    dependencies: { "issue-runner-core": "0.1.0" },
    keywords: [
      "issue-runner",
      "herdr",
      "terminal",
      "terminal-plugin",
      "cli",
      "github-issues",
      "workflow-automation",
      "ai-agents",
      "coding-agent",
    ],
    files: ["dist", "README.md", "CHANGELOG.md"],
    engines: { node: ">=22.18.0 <23" },
    scripts: { "release:accept": "node scripts/release-accept.mjs" },
  },
  files: {
    "dist/cli.js": 'console.log("issue-runner-herdr 0.1.1 (core 0.1.0)");\n',
    "dist/index.js":
      "export const contractVersion = 2; export async function createTerminalPlugin() {}\n",
    "dist/index.d.ts": "export declare const contractVersion = 2;\n",
    // This substitute checks supplied bytes; the real package suite covers installation and relocation.
    "scripts/release-accept.mjs": [
      'import assert from "node:assert/strict";',
      'import { mkdtempSync, rmSync } from "node:fs";',
      'import { execFileSync } from "node:child_process";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      'import { pathToFileURL } from "node:url";',
      'const directory = mkdtempSync(join(tmpdir(), "herdr-candidate-"));',
      "try {",
      '  execFileSync("tar", ["-xzf", process.env.HERDR_CANDIDATE_TARBALL, "-C", directory]);',
      '  const version = execFileSync(process.execPath, [join(directory, "package/dist/cli.js"), "--version"], { encoding: "utf8" });',
      "  assert.match(version, /issue-runner-herdr .*core 0\\.1\\.0/);",
      '  const before = process.listenerCount("SIGINT");',
      '  const terminal = await import(pathToFileURL(join(directory, "package/dist/index.js")));',
      "  assert.equal(terminal.contractVersion, 2);",
      '  assert.equal(typeof terminal.createTerminalPlugin, "function");',
      '  assert.equal(process.listenerCount("SIGINT"), before);',
      "} finally { rmSync(directory, { recursive: true, force: true }); }",
      "",
    ].join("\n"),
    "README.md": "# issue-runner-herdr\n",
    "CHANGELOG.md": "# Changelog\n",
  },
};

export const releaseBody =
  "## Proposed release 0.1.1\n\n### Changelog\n\n- fix: [issue-7] repair publication\n";

export function createPublishFixture(
  t: { after: (fn: () => void) => void },
  options: FixtureOptions = readyPackage,
): ReleaseFixture {
  return createReleaseFixture(t, options);
}

export function publishEnvironment(
  mergeSha: string,
  tarball: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    GITHUB_REPOSITORY: releaseRepository,
    PR_NUMBER: "18",
    PR_MERGED: "true",
    PR_HEAD_REF: "auto-release",
    PR_BASE_REF: "main",
    PR_HEAD_REPOSITORY: releaseRepository,
    MERGE_SHA: mergeSha,
    TARBALL: tarball,
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example.invalid/token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-oidc-request-token",
    ...overrides,
  };
}

// A merged release pull request for 0.1.1 and the tarball packed from the
// merged commit, exactly as the publication job provides them.
export function mergedRelease(fixture: ReleaseFixture): {
  merge: string;
  tarball: string;
} {
  fixture.propose("0.1.1");
  const merge = fixture.squashMerge();
  fixture.configureGitHub({
    pullRequest: {
      number: "18",
      title: "chore: propose release v0.1.1",
      body: releaseBody,
    },
  });
  return { merge, tarball: fixture.pack(fixture.artifacts) };
}
