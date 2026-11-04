import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { installedPlugin } from "../fixtures/enhancement.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
  pane,
} from "../fixtures/herdr.ts";

await test("createTab awaits one generic preflight with unchanged options and Tab context, without starting the Agent", async (t) => {
  const installed = await installedPlugin();
  const enhancement = await (await installed.install()).fixture();
  const server = await herdr([...contextSteps(), createStep()]);
  t.after(() => server.close());
  t.after(() => installed.close());
  const options = { private: { nested: ["kept"] }, another: true };
  const plugin = await installed.plugin.createTerminalPlugin({
    enhancements: options,
  });
  const events = new EventEmitter();
  const release = once(events, "release");
  const entered = once(events, "entered");
  enhancement.controls.initialize = async () => {
    events.emit("entered");
    await release;
  };
  const creating = plugin.createTab({
    cwd: process.cwd(),
    env: { PRIVATE: "value" },
    label: "Preflight",
    agent: "generic",
    submitKey: "Shift+Enter",
  });
  await Promise.race([
    entered,
    creating.then(() => {
      throw new Error("createTab skipped enhancement preflight");
    }),
  ]);
  assert.equal(enhancement.calls.length, 1);
  const call = enhancement.calls[0]!;
  assert.equal(call.config, options);
  assert.deepEqual(call.context, {
    cwd: process.cwd(),
    env: { PRIVATE: "value" },
  });
  assert.deepEqual(Object.keys(call.host).sort(), [
    "read",
    "requestRecovery",
    "sendKeys",
    "submitText",
  ]);
  events.emit("release");
  await creating;
  assert.equal(server.requests.length, 3);
});

for (const phase of ["read", "body", "Right", "keys"]) {
  await test(`abort during pending Host ${phase} prevents further automatic input`, async (t) => {
    const installed = await installedPlugin();
    const fixture = await (await installed.install()).fixture();
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
    t.after(() => installed.close());
    const plugin = await installed.plugin.createTerminalPlugin({});
    await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Abort Host",
      agent: "generic",
      submitKey: "Enter",
      signal: controller.signal,
    });
    const host = fixture.calls[0]!.host;
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
    assert.equal(fixture.calls[0]!.stops, 1);
  });
}

await test("all bound Host operations reject a replaced target and never follow it", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  const steps = targetSteps();
  steps[1]!.result = {
    type: "pane_info",
    pane: { ...pane, terminal_id: "replacement-terminal" },
  };
  const server = await herdr([...contextSteps(), createStep(), ...steps]);
  t.after(() => server.close());
  t.after(() => installed.close());
  const plugin = await installed.plugin.createTerminalPlugin({});
  await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Replaced",
    agent: "generic",
    submitKey: "Enter",
  });
  const host = fixture.calls[0]!.host;
  for (const operation of [
    () => host.read(),
    () => host.submitText("wrong"),
    () => host.sendKeys(["Enter"]),
    () => host.requestRecovery(),
  ]) {
    await assert.rejects(operation(), /identity changed|target is invalid/);
  }
  assert.equal(server.requests.length, 5);
});

await test("bound Host reads only visible text and sends complete text and pure ordered chords using the captured Agent key", async (t) => {
  const installed = await installedPlugin();
  const enhancement = await (await installed.install()).fixture();
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
    ...targetSteps(),
  ]);
  t.after(() => server.close());
  t.after(() => installed.close());
  const plugin = await installed.plugin.createTerminalPlugin({
    agentStartDelay: 0,
  });
  const options = {
    cwd: process.cwd(),
    env: {},
    label: "Host",
    agent: "generic",
    submitKey: "Shift+Enter",
  };
  await plugin.createTab(options);
  options.submitKey = "Enter";
  const host = enhancement.calls[0]!.host;
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
  await assert.rejects(host.requestRecovery(), /retained Core recovery/i);
});
