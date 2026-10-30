import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import test from "node:test";
import type { CreateTabOptions } from "issue-runner-core/terminal";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  caller,
  contextSteps,
  createStep,
  herdr,
  pane,
  tab,
} from "../fixtures/herdr.ts";

await test("creation keeps the requested context while checking the directory", async (t) => {
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const overlay = { ISSUE_RUNNER_CONTEXT: "requested" };
  const options: CreateTabOptions = {
    cwd: process.cwd(),
    label: "Requested issue",
    env: overlay,
  };
  const creating = plugin.createTab(options);
  options.cwd = "unchecked-relative-directory";
  options.label = "Changed issue";
  overlay.ISSUE_RUNNER_CONTEXT = "changed";
  options.env = { ISSUE_RUNNER_CONTEXT: "replaced" };
  await creating;
  const params = server.requests[2]?.params;
  assert.equal(params?.cwd, process.cwd());
  assert.equal(params.label, "Requested issue");
  const env = params.env as Record<string, string>;
  assert.equal(env.ISSUE_RUNNER_CONTEXT, "requested");
  assert.equal(env.HERDR_PANE_ID, undefined);
});

await test("creation preserves portable paths, labels, and literal environment values", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-context-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(
    directory,
    "space \u4e2d\u6587 \ud83d\ude80 $HOME & 'quote'",
  );
  await mkdir(cwd);
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  process.env.ISSUE_CONTEXT_KEEP = "inherited value";
  process.env.ISSUE_CONTEXT_REPLACE = "old value";
  process.env.ISSUE_CONTEXT_EMPTY = "nonempty";
  const plugin = await createTerminalPlugin();
  process.env.ISSUE_CONTEXT_KEEP = "changed after initialization";
  const overlay = Object.freeze({
    ISSUE_CONTEXT_REPLACE: "new value",
    ISSUE_CONTEXT_EMPTY: "",
    ISSUE_CONTEXT_LITERAL:
      "\u4e2d\u6587 \ud83d\ude80 'single' \"double\" $HOME $(echo no) %PATH% ! & \\ \nnext",
    HERDR_CUSTOM: "ordinary variable",
  });
  const label = 'Issue 6 \u4e2d\u6587 \ud83d\ude80 "quoted" $HOME & \\';
  await plugin.createTab({ cwd, label, env: overlay });
  const params = server.requests[2]?.params;
  assert.equal(params?.cwd, cwd);
  assert.equal(params.label, label);
  assert.equal(params.workspace_id, "w1");
  assert.equal(params.focus, false);
  assert.equal(params.command, undefined);
  const env = params.env as Record<string, string>;
  assert.equal(env.ISSUE_CONTEXT_KEEP, "inherited value");
  for (const [key, value] of Object.entries(overlay)) {
    assert.equal(env[key], value);
  }
  for (const key of [
    "HERDR_ENV",
    "HERDR_SOCKET_PATH",
    "HERDR_WORKSPACE_ID",
    "HERDR_TAB_ID",
    "HERDR_PANE_ID",
    "HERDR_BIN_PATH",
  ]) {
    assert.equal(env[key], undefined);
  }
});

await test("unusable working directories reject before tab creation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-cwd-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "file");
  await writeFile(file, "");
  const server = await herdr(contextSteps());
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  for (const cwd of ["", ".", "relative/path", directory + "\0"]) {
    await assert.rejects(
      plugin.createTab({ cwd, env: {}, label: "Issue" }),
      /absolute cwd/,
    );
  }
  await assert.rejects(
    plugin.createTab({ cwd: file, env: {}, label: "Issue" }),
    /cwd is not a directory/,
  );
  await assert.rejects(
    plugin.createTab({
      cwd: join(directory, "missing"),
      env: {},
      label: "Issue",
    }),
    /ENOENT/,
  );
  assert.equal(server.requests.length, 2);
});

await test("rejects all Herdr routing overlays, including case variants", async (t) => {
  const server = await herdr(contextSteps());
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  for (const key of [
    "HERDR_ENV",
    "HERDR_SOCKET_PATH",
    "HERDR_WORKSPACE_ID",
    "HERDR_TAB_ID",
    "HERDR_PANE_ID",
    "HERDR_BIN_PATH",
    "herdr_socket_path",
    "Herdr_Pane_Id",
  ]) {
    await assert.rejects(
      plugin.createTab({
        cwd: process.cwd(),
        env: { [key]: process.env[key] ?? "" },
        label: "Issue",
      }),
      /reserved environment key/,
    );
  }
  assert.equal(server.requests.length, 2);
});

await test("rejects invalid labels and environment values before tab creation", async (t) => {
  const server = await herdr(contextSteps());
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  for (const invalid of [
    { label: "nul\0label", env: {} },
    { label: 42, env: {} },
    { label: "Issue", env: null },
    { label: "Issue", env: [] },
    { label: "Issue", env: { "": "value" } },
    { label: "Issue", env: { "BAD=KEY": "value" } },
    { label: "Issue", env: { "BAD\0KEY": "value" } },
    { label: "Issue", env: { KEY: "nul\0value" } },
    { label: "Issue", env: { KEY: 42 } },
  ]) {
    const options = JSON.parse(
      JSON.stringify({ cwd: process.cwd(), ...invalid }),
    ) as CreateTabOptions;
    await assert.rejects(plugin.createTab(options), /label|environment/);
  }
  assert.equal(server.requests.length, 2);
});

await test(
  "Windows paths retain forward slashes and extended-length spelling",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "herdr-windows-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const cwd = join(directory, "space \u4e2d\u6587");
    await mkdir(cwd);
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...contextSteps(),
      createStep(),
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    for (const path of ["\\", "/", "C:", "C:relative", "\\\\server"]) {
      await assert.rejects(
        plugin.createTab({ cwd: path, env: {}, label: "Invalid Windows path" }),
        /absolute cwd/,
      );
    }
    const paths = [cwd.replaceAll("\\", "/"), toNamespacedPath(cwd)];
    for (const path of paths) {
      const current = path === paths[0] ? plugin : await createTerminalPlugin();
      await current.createTab({ cwd: path, env: {}, label: "Windows path" });
      assert.equal(server.requests.at(-1)?.params.cwd, path);
    }
  },
);

for (const error of [
  { code: "cwd_failed", message: "working directory became unavailable" },
  { code: "env_failed", message: "environment could not be applied" },
]) {
  await test(`creation reports working-context failure: ${error.code}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      { method: "tab.create", error },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    await assert.rejects(
      plugin.createTab({
        cwd: process.cwd(),
        env: { ISSUE_CONTEXT_EMPTY: "" },
        label: "Issue",
      }),
      { message: `Herdr tab.create: ${error.code}: ${error.message}` },
    );
    assert.equal(server.requests.length, 3);
  });
}

for (const [description, result] of [
  ["missing association", {}],
  ["missing tab", { root_pane: pane }],
  ["missing root pane", { tab }],
  ["null root pane", { tab, root_pane: null }],
  [
    "incomplete pane identity",
    { tab, root_pane: { workspace_id: "w1", tab_id: "w1:t2" } },
  ],
  ["different tab", { tab: { ...tab, tab_id: "w1:t3" }, root_pane: pane }],
  [
    "different workspace",
    { tab: { ...tab, workspace_id: "w2" }, root_pane: pane },
  ],
  ["multiple panes", { tab: { ...tab, pane_count: 2 }, root_pane: pane }],
  [
    "caller reused",
    {
      tab: { workspace_id: "w1", tab_id: "w1:t1", pane_count: 1 },
      root_pane: caller,
    },
  ],
] as const) {
  await test(`incomplete or unsafe creation cannot issue a handle: ${description}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      { method: "tab.create", result: { type: "tab_created", ...result } },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const options = { cwd: process.cwd(), env: {}, label: "Issue" };
    await assert.rejects(
      plugin.createTab(options),
      /invalidated.*identity|invalidated.*association/,
    );
    await assert.rejects(plugin.createTab(options), /invalidated/);
    assert.equal(server.requests.length, 3);
  });
}
