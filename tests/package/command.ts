import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { exec } from "../fixtures/package.ts";

export function installedCommand(prefix: string, cwd: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_PATH: "",
    NODE_OPTIONS: "",
  };
  for (const name of Object.keys(env))
    if (/^HERDR_|^(GH_TOKEN|GITHUB_TOKEN)$/i.test(name)) delete env[name];
  const launcher = join(
    prefix,
    process.platform === "win32"
      ? "issue-runner-herdr.cmd"
      : "bin/issue-runner-herdr",
  );
  return (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
    process.platform === "win32"
      ? exec(
          process.env.ComSpec ?? "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            `""${launcher}" ${args.map((arg) => `"${arg}"`).join(" ")}"`,
          ],
          {
            cwd,
            env: { ...env, ...extraEnv },
            windowsVerbatimArguments: true,
            timeout: 30_000,
          },
        )
      : exec(launcher, args, {
          cwd,
          env: { ...env, ...extraEnv },
          timeout: 30_000,
        });
}

export async function verifyCommand(
  prefix: string,
  installed: string,
  cwd: string,
  version: string,
) {
  const run = installedCommand(prefix, cwd);
  for (const args of [["--help"], ["run", "--help"], ["init", "--help"]]) {
    const { stdout } = await run(args);
    assert.match(stdout, /usage: issue-runner-herdr/);
    assert.doesNotMatch(stdout, /--env/);
  }
  assert.equal(
    (await run(["--version"])).stdout.trim(),
    `issue-runner-herdr ${version} (core 0.0.0-contract.1)`,
  );
  const imported = await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const plugin = await import(${JSON.stringify(pathToFileURL(join(installed, "dist/index.js")).href)});
    assert.deepEqual(Object.keys(plugin).sort(), ['contractVersion', 'createTerminalPlugin']);
    assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
    assert.equal(process.exitCode, undefined);
  `,
    ],
    {
      cwd,
      env: {
        ...process.env,
        HERDR_SOCKET_PATH: "",
        HERDR_PANE_ID: "",
        NODE_OPTIONS: "",
        NODE_PATH: "",
      },
    },
  );
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
  const initialized = await run(["init", "--project", "sample"]);
  assert.match(initialized.stdout, /issue-runner-herdr run --project sample/);
  const project = join(cwd, "sample");
  const configPath = join(project, "config.yaml");
  const original = await readFile(configPath, "utf8");
  assert.deepEqual((await readdir(join(project, "prompts"))).sort(), [
    "documentation.md",
    "implement.md",
    "review.md",
  ]);
  await assert.rejects(run(["init", "--project", "sample"]), {
    code: 1,
    stdout: /exist|refus/i,
  });
  assert.equal(await readFile(configPath, "utf8"), original);
  for (const [args, expected] of [
    [
      ["run", "--project", "sample", "--issue", "1", "--env", "herdr"],
      /Unknown option.*--env/,
    ],
    [["init", "--project", ".."], /Project key|project key/],
    [["run", "--project", "sample"], /Exactly one/],
    [["run", "--project", "missing", "--issue", "1"], /missing.*config.yaml/],
  ] as const)
    await assert.rejects(run([...args]), { code: 1, stdout: expected });
  // The generated template is valid configuration once its checkout is absolute on this platform.
  const configured = original.replace(
    "/absolute/path/to/your-repository",
    JSON.stringify(cwd),
  );
  await writeFile(configPath, configured);
  await assert.rejects(run(["run", "--project", "sample", "--issue", "1"]), {
    code: 1,
    stdout: /GH_TOKEN/,
  });
  await assert.rejects(
    run(["run", "--project", "sample", "--issue"], {
      GH_TOKEN: "fixture-only",
    }),
    { code: 1, stdout: /issueList must not be empty/ },
  );
  await assert.rejects(
    run(["run", "--project", "sample", "--issue", "1"], {
      GH_TOKEN: "fixture-only",
    }),
    { code: 1, stdout: /HERDR_SOCKET_PATH/ },
  );
  await writeFile(configPath, "invalid: config\n");
  await assert.rejects(run(["run", "--project", "sample", "--issue", "1"]), {
    code: 1,
    stdout: /config contains unknown field/,
  });
  assert.deepEqual(
    (await readdir(project)).sort(),
    ["config.yaml", "prompts"],
    "Invalid runs have no workflow or audit effects",
  );
}
