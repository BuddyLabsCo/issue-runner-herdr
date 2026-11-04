import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { EventEmitter, once } from "node:events";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
} from "../fixtures/herdr.ts";

await test("execute sends every opaque command with Enter and resolves after submission", async (t) => {
  const command =
    "\nagent --model 'configured model'\n  中文 $HOME $(literal) `literal`\n";
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps(command),
    ...targetSteps(),
    ...inputSteps(command),
    ...targetSteps(),
    ...inputSteps(command),
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin({
    agentStartDelay: 100,
    enhancements: { privateSetting: { retained: true } },
  });
  const { handle: tab } = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Startup",

    submitKey: "Shift+Enter",
  });
  assert.equal(server.requests.length, 3, "creation must not launch the Agent");
  assert.deepEqual(
    await Promise.all([
      plugin.execute(tab, command),
      plugin.execute(tab, command),
    ]),
    [undefined, undefined],
  );
  assert.equal(await plugin.execute(tab, command), undefined);
  assert.equal(server.requests.length, 18);
});

for (const phase of [
  "before execution",
  "target lookup",
  "body",
  "Right",
  "Enter",
]) {
  await test(
    `abort at ${phase} drops unstarted commands but completes started input`,
    { timeout: 2000 },
    async (t) => {
      const controller = new AbortController();
      const gates = new EventEmitter();
      const requested = once(gates, "requested");
      const release = once(gates, "release");
      t.after(() => {
        gates.emit("release");
      });
      const all = [
        ...contextSteps(),
        createStep(),
        ...targetSteps(),
        ...inputSteps("command"),
      ];
      const count = {
        "before execution": 3,
        "target lookup": 5,
        body: 6,
        Right: 7,
        Enter: 8,
      }[phase]!;
      const started = count > 5;
      const script = started ? all : all.slice(0, count);
      if (phase !== "before execution") script[count - 1]!.waitFor = release;
      const server = await herdr((request) => {
        const step = script.shift();
        assert.ok(step, `unexpected ${request.method}`);
        if (step.waitFor || phase === "before execution")
          gates.emit("requested");
        return step;
      });
      t.after(() => server.close());
      const plugin = await createTerminalPlugin({ agentStartDelay: 0 });
      const { handle: tab } = await plugin.createTab({
        cwd: process.cwd(),
        env: {},
        label: "Abort",

        submitKey: "Enter",
        signal: controller.signal,
      });
      if (phase === "before execution") controller.abort();
      let settled = false;
      const executing = plugin.execute(tab, "command").then(
        () => {
          settled = true;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      await requested;
      controller.abort();
      await setImmediate();
      if (started) assert.equal(settled, false);
      gates.emit("release");
      if (started) assert.equal(await executing, undefined);
      else assert.match(String(await executing), /abort/i);
      await assert.rejects(plugin.execute(tab, "command"), /abort/i);
      assert.equal(server.requests.length, started ? 8 : count);
      assert.equal(script.length, 0);
    },
  );
}

await test("an ordinary command submission rejection preserves its error and allows an explicit retry", async (t) => {
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    {
      method: "pane.send_input",
      error: { code: "input_rejected", message: "ordinary rejection" },
    },
    ...targetSteps(),
    ...inputSteps("command"),
  ]);
  t.after(() => server.close());
  const plugin = await createTerminalPlugin({ agentStartDelay: 0 });
  const { handle: tab } = await plugin.createTab({
    cwd: process.cwd(),
    env: {},
    label: "Retry",

    submitKey: "Enter",
  });
  await assert.rejects(
    plugin.execute(tab, "command"),
    /pane.send_input.*input_rejected.*ordinary rejection/,
  );
  assert.equal(await plugin.execute(tab, "command"), undefined);
  assert.equal(server.requests.length, 11);
});
