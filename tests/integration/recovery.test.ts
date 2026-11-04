import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import { installedPlugin } from "../fixtures/enhancement.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  pane,
  tab as nativeTab,
  targetSteps,
} from "../fixtures/herdr.ts";

const options = {
  cwd: process.cwd(),
  env: {},
  label: "Assignment recovery",
  agent: "generic",
  submitKey: "Shift+Enter",
};

for (const submitKey of ["Enter", "Shift+Enter"]) {
  await test(`assignments notify before input and recover unchanged with captured ${submitKey}`, async (t) => {
    const installed = await installedPlugin();
    const fixture = await (await installed.install()).fixture();
    const paths = [
      "/exact/../Probe 中文.json",
      "C:\\work tree\\task.json",
      "C:\\work tree\\task.json",
      "/new/./correction.json",
    ];
    const prompts = ["Probe", "Task", "Continuation", "Correction"];
    const wording = [
      "\nCore Probe recovery 中文 🐎\n\n  'quotes' $HOME `literal`\n",
      "Task recovery",
      "Latest continuation wording",
      "Correction recovery\n",
    ];
    const script = [...contextSteps(), createStep()];
    const assignmentsAtInput: string[][][] = [];
    for (const [index, prompt] of prompts.entries()) {
      script.push(
        ...targetSteps(),
        ...inputSteps(prompt),
        ...targetSteps(),
        ...inputSteps("enhancement marker", submitKey.toLowerCase()),
        ...targetSteps(),
        ...inputSteps(wording[index]!, submitKey.toLowerCase()),
      );
    }
    const server = await herdr((request) => {
      if (request.method === "pane.send_input") {
        const index = prompts.indexOf(request.params.text as string);
        if (index !== -1) {
          assignmentsAtInput.push([...fixture.calls[0]!.assignments]);
        }
      }
      const step = script.shift();
      assert.ok(step, `unexpected ${request.method}`);
      return step;
    });
    t.after(() => server.close());
    t.after(() => installed.close());
    const plugin = await installed.plugin.createTerminalPlugin({});
    const creation = { ...options, submitKey };
    const tab = await plugin.createTab(creation);
    creation.submitKey = "Enter";
    const host = fixture.calls[0]!.host;
    for (const [index, prompt] of prompts.entries()) {
      await plugin.submitText(
        tab,
        prompt,
        undefined,
        paths[index],
        wording[index],
      );
      assert.deepEqual(
        assignmentsAtInput[index],
        paths.slice(0, index + 1).map((path) => [path]),
      );
      await host.submitText("enhancement marker");
      await host.requestRecovery();
      assert.equal(fixture.calls[0]!.assignments.length, index + 1);
    }
    assert.equal(script.length, 0);
  });
}

await test("missing wording rejects recovery and never reuses the preceding assignment", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  const missing = [
    { path: "/new.json", wording: undefined },
    { path: "/seed.json", wording: undefined },
    { path: undefined, wording: undefined },
    { path: "/empty.json", wording: "" },
  ];
  const script = [...contextSteps(), createStep(), ...targetSteps()];
  missing.forEach(() => {
    script.push(
      ...targetSteps(),
      ...inputSteps("Seed task"),
      ...targetSteps(),
      ...inputSteps("New submission without recovery"),
      ...targetSteps(),
    );
  });
  const server = await herdr(script);
  t.after(() => server.close());
  t.after(() => installed.close());
  const plugin = await installed.plugin.createTerminalPlugin({});
  const tab = await plugin.createTab(options);
  const host = fixture.calls[0]!.host;
  await assert.rejects(host.requestRecovery(), /retained Core recovery/);
  const expected: string[][] = [];
  for (const { path, wording } of missing) {
    await plugin.submitText(
      tab,
      "Seed task",
      undefined,
      "/seed.json",
      "Must not reuse",
    );
    expected.push(["/seed.json"]);
    await plugin.submitText(
      tab,
      "New submission without recovery",
      undefined,
      path,
      wording,
    );
    if (path !== undefined) expected.push([path]);
    await assert.rejects(host.requestRecovery(), /retained Core recovery/);
    assert.deepEqual(fixture.calls[0]!.assignments, expected);
  }
});

await test("onAssignment failure blocks task input after retaining the current Core wording", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("Previous task"),
    ...targetSteps(),
    ...targetSteps(),
    ...inputSteps("Current recovery", "shift+enter"),
  ]);
  t.after(() => server.close());
  t.after(() => installed.close());
  const plugin = await installed.plugin.createTerminalPlugin({});
  const tab = await plugin.createTab(options);
  await plugin.submitText(
    tab,
    "Previous task",
    undefined,
    "/old.json",
    "Old recovery",
  );
  const error = new Error("assignment refused");
  let recovery: Promise<void> | undefined;
  fixture.controls.assignment = (call) => {
    recovery = call.host.requestRecovery();
    throw error;
  };
  await assert.rejects(
    plugin.submitText(
      tab,
      "Must not send this task",
      undefined,
      "/failed.json",
      "Current recovery",
    ),
    (caught) => caught === error,
  );
  assert.ok(recovery);
  await recovery;
  assert.deepEqual(fixture.calls[0]!.assignments, [
    ["/old.json"],
    ["/failed.json"],
  ]);
  assert.equal(
    server.requests.some(
      (request) => request.params.text === "Must not send this task",
    ),
    false,
  );
});

await test("each Tab retains its own assignment, wording, and submit key", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  const otherTab = { ...nativeTab, tab_id: "w1:t3" };
  const otherPane = {
    ...pane,
    pane_id: "w1:p3",
    tab_id: "w1:t3",
    terminal_id: "other-terminal",
  };
  const otherTargets = [
    {
      method: "tab.get",
      params: { tab_id: "w1:t3" },
      result: { type: "tab_info", tab: otherTab },
    },
    {
      method: "pane.get",
      params: { pane_id: "w1:p3" },
      result: { type: "pane_info", pane: otherPane },
    },
  ];
  const server = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("First task"),
    {
      method: "tab.create",
      result: { type: "tab_created", tab: otherTab, root_pane: otherPane },
    },
    ...otherTargets,
    ...otherTargets,
    ...inputSteps("Second task", "enter", otherPane.pane_id),
    ...targetSteps(),
    ...inputSteps("First recovery", "shift+enter"),
    ...otherTargets,
    ...inputSteps("Second recovery", "enter", otherPane.pane_id),
  ]);
  t.after(() => server.close());
  t.after(() => installed.close());
  const plugin = await installed.plugin.createTerminalPlugin({});
  const first = await plugin.createTab(options);
  await plugin.submitText(
    first,
    "First task",
    undefined,
    "/first.json",
    "First recovery",
  );
  const second = await plugin.createTab({ ...options, submitKey: "Enter" });
  await assert.rejects(
    fixture.calls[1]!.host.requestRecovery(),
    /retained Core recovery/,
  );
  await plugin.submitText(
    second,
    "Second task",
    undefined,
    "/second.json",
    "Second recovery",
  );
  await fixture.calls[0]!.host.requestRecovery();
  await fixture.calls[1]!.host.requestRecovery();
  assert.deepEqual(
    fixture.calls.map((call) => call.assignments),
    [[["/first.json"]], [["/second.json"]]],
  );
});

await test("plugin instances with identical native IDs retain independent recovery", async (t) => {
  const installed = await installedPlugin();
  const fixture = await (await installed.install()).fixture();
  const firstServer = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...inputSteps("First task"),
    ...targetSteps(),
    ...inputSteps("First instance recovery", "shift+enter"),
  ]);
  t.after(() => firstServer.close());
  t.after(() => installed.close());
  const first = await installed.plugin.createTerminalPlugin({});
  const firstTab = await first.createTab(options);
  await first.submitText(
    firstTab,
    "First task",
    undefined,
    "/same.json",
    "First instance recovery",
  );
  const secondServer = await herdr([
    ...contextSteps(),
    createStep(),
    ...targetSteps(),
    ...targetSteps(),
    ...inputSteps("Second task"),
    ...targetSteps(),
    ...inputSteps("Second instance recovery", "shift+enter"),
  ]);
  try {
    const second = await installed.plugin.createTerminalPlugin({});
    const secondTab = await second.createTab(options);
    await assert.rejects(
      fixture.calls[1]!.host.requestRecovery(),
      /retained Core recovery/,
    );
    await second.submitText(
      secondTab,
      "Second task",
      undefined,
      "/same.json",
      "Second instance recovery",
    );
    await Promise.all([
      fixture.calls[0]!.host.requestRecovery(),
      fixture.calls[1]!.host.requestRecovery(),
    ]);
    await assert.rejects(
      first.submitText(secondTab, "foreign", undefined, "/wrong.json", "wrong"),
      /foreign/,
    );
    assert.deepEqual(
      fixture.calls.map((call) => call.assignments),
      [[["/same.json"]], [["/same.json"]]],
    );
  } finally {
    await secondServer.close();
  }
});

for (const cancellation of ["abort", "stop"]) {
  for (const [phase, last] of [
    ["body", 0],
    ["Right", 1],
    ["submit", 2],
  ] as const) {
    await test(
      `${cancellation} cancels pending recovery ${phase} and preserves the Tab`,
      { timeout: 5000 },
      async (t) => {
        const installed = await installedPlugin();
        const fixture = await (await installed.install()).fixture();
        const events = new EventEmitter();
        const requested = once(events, "requested");
        const release = once(events, "release");
        t.after(() => {
          events.emit("release");
        });
        const recovery = inputSteps("Core recovery", "shift+enter");
        recovery[last]!.waitFor = release;
        const script = [
          ...contextSteps(),
          createStep(),
          ...targetSteps(),
          ...inputSteps("Task"),
          ...targetSteps(),
          ...recovery.slice(0, last + 1),
          ...targetSteps(),
          {
            method: "tab.list",
            result: {
              type: "tab_list",
              tabs: [
                { workspace_id: "w1", tab_id: "w1:t1" },
                { workspace_id: "w1", tab_id: "w1:t2" },
              ],
            },
          },
          {
            method: "tab.close",
            params: { tab_id: "w1:t2" },
            result: { type: "ok" },
          },
        ];
        const server = await herdr((request) => {
          const step = script.shift();
          assert.ok(step, `unexpected ${request.method}`);
          if (step.waitFor) events.emit("requested");
          return step;
        });
        t.after(() => server.close());
        t.after(() => installed.close());
        const controller = new AbortController();
        const plugin = await installed.plugin.createTerminalPlugin({});
        const tab = await plugin.createTab({
          ...options,
          signal: controller.signal,
        });
        await plugin.submitText(
          tab,
          "Task",
          undefined,
          "/handoff.json",
          "Core recovery",
        );
        const host = fixture.calls[0]!.host;
        const rejected = assert.rejects(host.requestRecovery(), /abort/i);
        await requested;
        if (cancellation === "abort") controller.abort();
        else {
          fixture.controls.stop = () =>
            Promise.reject(new Error("stop failed"));
          await assert.rejects(plugin.closeTab(tab), /stop failed/);
        }
        await rejected;
        const count = server.requests.length;
        for (const operation of [
          () => host.requestRecovery(),
          () => host.submitText("late marker"),
          () => host.sendKeys(["Enter"]),
          () =>
            plugin.submitText(
              tab,
              "late task",
              undefined,
              "/late.json",
              "late recovery",
            ),
        ]) {
          await assert.rejects(operation(), /abort/i);
        }
        assert.equal(server.requests.length, count);
        assert.equal(fixture.calls[0]!.stops, 1);
        assert.deepEqual(fixture.calls[0]!.assignments, [["/handoff.json"]]);
        events.emit("release");
        delete fixture.controls.stop;
        await plugin.closeTab(tab);
      },
    );
  }
}
