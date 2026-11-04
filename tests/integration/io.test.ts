import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
  pane,
} from "../fixtures/herdr.ts";

for (const phase of ["read", "body", "Right", "keys"]) {
  await test(`abort during pending I/O ${phase} prevents further automatic input`, async (t) => {
    const events = new EventEmitter();
    const requested = once(events, "requested");
    const release = once(events, "release");
    t.after(() => {
      events.emit("release");
    });
    const controller = new AbortController();
    const input = inputSteps("automatic");
    const script = [
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...(phase === "read"
        ? [
            {
              method: "pane.read",
              result: {
                type: "pane_read",
                read: {
                  pane_id: pane.pane_id,
                  workspace_id: pane.workspace_id,
                  tab_id: pane.tab_id,
                  source: "visible",
                  format: "text",
                  text: "screen",
                },
              },
            },
          ]
        : phase === "keys"
          ? [
              {
                method: "pane.send_input",
                params: { pane_id: pane.pane_id, text: "", keys: ["escape"] },
                result: { type: "ok" },
              },
            ]
          : input.slice(0, phase === "body" ? 1 : 2)),
    ];
    script[script.length - 1]!.waitFor = release;
    const server = await herdr((request) => {
      const step = script.shift();
      assert.ok(step, `unexpected ${request.method}`);
      if (!script.length) events.emit("requested");
      return step;
    });
    t.after(() => server.close());
    const plugin = await createTerminalPlugin({});
    const { io: host } = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Abort I/O",
      submitKey: "Enter",
      signal: controller.signal,
    });
    const rejected = assert.rejects(
      phase === "read"
        ? host.read()
        : phase === "keys"
          ? host.sendKeys(["Escape", "Enter"])
          : host.submitText("automatic"),
      /abort/i,
    );
    await requested;
    controller.abort();
    events.emit("release");
    await rejected;
    assert.equal(script.length, 0);
    await assert.rejects(host.submitText("later"), /abort/i);
  });
}

await test("all bound I/O operations reject a replaced target and never follow it", async (t) => {
  const steps = targetSteps();
  steps[1]!.result = {
    type: "pane_info",
    pane: { ...pane, terminal_id: "replacement-terminal" },
  };
  const server = await herdr([...contextSteps(), createStep(), ...steps]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin({});
  const { io: host } = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Replaced",
    submitKey: "Enter",
  });
  for (const operation of [
    () => host.read(),
    () => host.submitText("wrong"),
    () => host.sendKeys(["Enter"]),
  ]) {
    await assert.rejects(operation(), /identity changed|target is invalid/);
  }
  assert.equal(server.requests.length, 5);
});

await test("bound I/O reads only visible text and sends complete text and pure ordered chords using the creation-time submit key", async (t) => {
  const text = "\n中文 🐎\n  'quotes' $HOME `literal`\n\n";
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.read",
      params: {
        pane_id: pane.pane_id,
        source: "visible",
        format: "text",
        strip_ansi: true,
      },
      result: {
        type: "pane_read",
        read: {
          pane_id: pane.pane_id,
          workspace_id: pane.workspace_id,
          tab_id: pane.tab_id,
          source: "visible",
          format: "text",
          text: "Current 中文 screen\n",
          scrollback: "old output",
          ansi: "\u001b[31mCurrent",
        },
      },
    },
    ...targetSteps(),
    ...inputSteps(text, "shift+enter"),
    ...targetSteps(),
    {
      method: "pane.send_input",
      params: { pane_id: pane.pane_id, text: "", keys: ["escape"] },
      result: { type: "ok" },
    },
    {
      method: "pane.send_input",
      params: { pane_id: pane.pane_id, text: "", keys: ["shift+enter"] },
      result: { type: "ok" },
    },
    {
      method: "pane.send_input",
      params: { pane_id: pane.pane_id, text: "", keys: ["ctrl+c"] },
      result: { type: "ok" },
    },
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin({
    agentStartDelay: 0,
  });
  const options = {
    cwd: process.cwd(),
    env: {},
    label: "I/O",
    submitKey: "Shift+Enter",
  };
  const { io: host } = await plugin.createTab(options);
  options.submitKey = "Enter";
  assert.equal(await host.read(), "Current 中文 screen\n");
  await host.submitText(text);
  for (const invalid of [
    ["Escape", "Enter\n"],
    ["Escape", "not-a-key"],
    ["Ctrl"],
    ["\u001b[A"],
    ["Shift+Enter Enter"],
  ]) {
    await assert.rejects(host.sendKeys(invalid), /key|chord/i);
  }
  await host.sendKeys(["Escape", "Shift+Enter", "Ctrl+c"]);
});

for (const change of [
  { pane_id: "foreign" },
  { workspace_id: "foreign" },
  { tab_id: "foreign" },
  { source: "scrollback" },
  { format: "ansi" },
  { text: null },
]) {
  await test(`malformed visible screen invalidates the owned target: ${JSON.stringify(change)}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      {
        method: "pane.read",
        result: {
          type: "pane_read",
          read: {
            pane_id: pane.pane_id,
            workspace_id: pane.workspace_id,
            tab_id: pane.tab_id,
            source: "visible",
            format: "text",
            text: "screen",
            ...change,
          },
        },
      },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const { handle, io } = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Read",
      submitKey: "Enter",
    });
    await assert.rejects(io.read(), /invalid visible screen/);
    await assert.rejects(io.read(), /target is invalid/);
    await assert.rejects(io.submitText("late"), /target is invalid/);
    await assert.rejects(io.sendKeys(["Enter"]), /target is invalid/);
    await assert.rejects(plugin.execute(handle, "late"), /target is invalid/);
    await assert.rejects(plugin.closeTab(handle), /target is invalid/);
    assert.equal(server.requests.length, 6);
  });
}

await test("non-string text and commands reject before target queries", async (t) => {
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin();
  const { handle, io } = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Validation",
    submitKey: "Enter",
  });
  for (const value of [undefined, null, 1, [], {}]) {
    // @ts-expect-error exercise the JavaScript boundary
    await assert.rejects(io.submitText(value), /requires a string/);
    // @ts-expect-error exercise the JavaScript boundary
    await assert.rejects(plugin.execute(handle, value), /requires a string/);
  }
  assert.equal(server.requests.length, 3);
});
