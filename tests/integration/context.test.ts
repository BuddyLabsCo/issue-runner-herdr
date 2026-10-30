import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  caller,
  contextSteps,
  createStep,
  herdr,
  type Step,
} from "../fixtures/herdr.ts";

await test("a stale caller rejects with actionable host context guidance before creating resources", async (t) => {
  const server = await herdr([
    {
      method: "pane.current",
      params: { caller_pane_id: "w1:p1" },
      error: { code: "pane_not_found", message: "caller no longer exists" },
    },
  ]);
  t.after(() => server.close());
  await assert.rejects(
    createTerminalPlugin(),
    /Herdr host context.*Launch Runner inside.*HERDR_SOCKET_PATH.*HERDR_PANE_ID.*pane_not_found: caller no longer exists/,
  );
  assert.deepEqual(
    server.requests.map((request) => request.method),
    ["pane.current"],
  );
});

await test("captures inherited identities before the caller lookup completes", async (t) => {
  const steps = contextSteps();
  const server = await herdr((request) => {
    const step = steps.shift();
    assert.ok(step);
    if (request.method === "pane.current") {
      process.env.HERDR_WORKSPACE_ID = "w9";
      process.env.HERDR_TAB_ID = "w9:t9";
      process.env.HERDR_PANE_ID = "w9:p9";
    }
    return step;
  });
  t.after(() => server.close());
  await createTerminalPlugin();
  assert.equal(steps.length, 0);
});

for (const key of ["HERDR_WORKSPACE_ID", "HERDR_TAB_ID"]) {
  for (const value of ["", "invalid", "w9", "w9:t9"]) {
    await test(`rejects inconsistent inherited ${key}=${JSON.stringify(value)}`, async (t) => {
      const server = await herdr([contextSteps()[0]!]);
      t.after(() => server.close());
      process.env[key] = value;
      await assert.rejects(
        createTerminalPlugin(),
        /Launch Runner inside.*conflicts with inherited host context/,
      );
      assert.deepEqual(
        server.requests.map((request) => request.method),
        ["pane.current"],
      );
    });
  }
}

for (const [name, value] of [
  ["missing", undefined],
  ["null", null],
  ["empty", {}],
  ["ambiguous", [caller, { ...caller, pane_id: "w1:p9" }]],
  ["different caller", { ...caller, pane_id: "w1:p9" }],
  ["different server context", { ...caller, workspace_id: "w2" }],
  ["mismatched tab", { ...caller, tab_id: "w2:t1" }],
  ["missing terminal", { ...caller, terminal_id: "" }],
  ["display labels only", { pane_id: "Runner", workspace_id: "Project" }],
] as const) {
  await test(`rejects ${name} caller lookup before workspace lookup or creation`, async (t) => {
    const server = await herdr([
      {
        method: "pane.current",
        params: { caller_pane_id: "w1:p1" },
        result: { type: "pane_current", pane: value },
      },
    ]);
    t.after(() => server.close());
    await assert.rejects(
      createTerminalPlugin(),
      /Herdr host context.*Launch Runner inside/,
    );
    assert.deepEqual(
      server.requests.map((request) => request.method),
      ["pane.current"],
    );
  });
}

for (const [name, value] of [
  ["missing", undefined],
  ["null", null],
  ["empty", {}],
  ["ambiguous", [{ workspace_id: "w1" }, { workspace_id: "w2" }]],
  [
    "conflicting identity with matching label",
    { workspace_id: "w2", label: "Project" },
  ],
  ["display label only", { label: "Project" }],
] as const) {
  await test(`rejects ${name} host workspace without creating resources`, async (t) => {
    const server = await herdr([
      contextSteps()[0]!,
      {
        method: "workspace.get",
        params: { workspace_id: "w1" },
        result: { type: "workspace_info", workspace: value },
      },
    ]);
    t.after(() => server.close());
    await assert.rejects(
      createTerminalPlugin(),
      /Launch Runner inside.*workspace could not be validated/,
    );
    assert.deepEqual(
      server.requests.map((request) => request.method),
      ["pane.current", "workspace.get"],
    );
  });
}

for (const [method, codes] of [
  ["pane.current", ["ambiguous_pane", "server_unavailable"]],
  ["workspace.get", ["workspace_not_found", "ambiguous_workspace"]],
] as const) {
  for (const code of codes) {
    await test(`reports ${method} ${code} with launch guidance and no fallback`, async (t) => {
      const server = await herdr([
        ...(method === "workspace.get" ? [contextSteps()[0]!] : []),
        { method, error: { code, message: "host lookup failed" } },
      ]);
      t.after(() => server.close());
      await assert.rejects(
        createTerminalPlugin(),
        new RegExp(`Launch Runner inside.*${code}: host lookup failed`),
      );
      assert.deepEqual(
        server.requests.map((request) => request.method),
        method === "workspace.get"
          ? ["pane.current", "workspace.get"]
          : ["pane.current"],
      );
    });
  }
}

for (const fault of [
  { disconnect: true },
  { raw: "not JSON\n" },
  { result: { type: "pane_info", pane: caller } },
]) {
  await test(`reports caller protocol failure as an actionable context error: ${JSON.stringify(fault)}`, async (t) => {
    const server = await herdr([{ method: "pane.current", ...fault }]);
    t.after(() => server.close());
    await assert.rejects(
      createTerminalPlugin(),
      /Herdr host context.*Launch Runner inside.*pane.current/,
    );
    assert.equal(server.requests.length, 1);
  });
}

await test("an unavailable inherited server rejects without selecting another server or creating resources", async (t) => {
  const server = await herdr([]);
  t.after(() => server.close());
  process.env.HERDR_SOCKET_PATH += ".stale";
  await assert.rejects(
    createTerminalPlugin(),
    /Herdr host context.*Launch Runner inside.*pane.current/,
  );
  assert.deepEqual(server.requests, []);
});

await test("an inherited workspace alone cannot authorize a focused-pane lookup", async (t) => {
  const server = await herdr([]);
  t.after(() => server.close());
  delete process.env.HERDR_PANE_ID;
  await assert.rejects(
    createTerminalPlugin(),
    /inherited HERDR_SOCKET_PATH and HERDR_PANE_ID/,
  );
  assert.deepEqual(server.requests, []);
});

await test("caller-aware lookup and later creations keep the queried workspace despite focus moving", async (t) => {
  let focused = {
    ...caller,
    workspace_id: "w9",
    tab_id: "w9:t9",
    pane_id: "w9:p9",
  };
  let creations = 0;
  const server = await herdr((request): Step => {
    if (request.method === "pane.current") {
      return {
        method: "pane.current",
        params: { caller_pane_id: "w1:p1" },
        result: {
          type: "pane_current",
          pane: request.params.caller_pane_id === "w1:p1" ? caller : focused,
        },
      };
    }
    if (request.method === "workspace.get") return contextSteps()[1]!;
    assert.equal(request.method, "tab.create");
    assert.equal(request.params.workspace_id, "w1");
    assert.equal(request.params.focus, false);
    assert.notEqual(request.params.workspace_id, focused.workspace_id);
    creations++;
    const step = createStep();
    if (creations === 1) return step;
    return {
      method: "tab.create",
      result: {
        type: "tab_created",
        tab: { workspace_id: "w1", tab_id: "w1:t3", pane_count: 1 },
        root_pane: {
          workspace_id: "w1",
          tab_id: "w1:t3",
          pane_id: "w1:p3",
          terminal_id: "second-terminal",
        },
      },
    };
  });
  t.after(() => server.close());
  delete process.env.HERDR_WORKSPACE_ID;
  delete process.env.HERDR_TAB_ID;
  const plugin = await createTerminalPlugin();
  focused = {
    ...caller,
    workspace_id: "w2",
    tab_id: "w2:t2",
    pane_id: "w2:p2",
  };
  await plugin.createTab({ cwd: process.cwd(), env: {}, label: "Project" });
  focused = {
    ...caller,
    workspace_id: "w3",
    tab_id: "w3:t3",
    pane_id: "w3:p3",
  };
  const otherServer = process.env.HERDR_SOCKET_PATH + ".other";
  process.env.HERDR_SOCKET_PATH = otherServer;
  process.env.HERDR_PANE_ID = focused.pane_id;
  process.env.HERDR_WORKSPACE_ID = focused.workspace_id;
  process.env.HERDR_TAB_ID = "w3:t3";
  await plugin.createTab({ cwd: process.cwd(), env: {}, label: "Project" });
  assert.equal(creations, 2);
  assert.deepEqual(
    server.requests.map((request) => request.method),
    ["pane.current", "workspace.get", "tab.create", "tab.create"],
  );
});

for (const [key, value] of [
  ["HERDR_SOCKET_PATH", undefined],
  ["HERDR_SOCKET_PATH", ""],
  ["HERDR_SOCKET_PATH", "relative.sock"],
  ["HERDR_PANE_ID", undefined],
  ["HERDR_PANE_ID", ""],
  ["HERDR_PANE_ID", "Runner"],
  ["HERDR_PANE_ID", "w0:p1"],
  ["HERDR_PANE_ID", "w1:p0"],
  ["HERDR_PANE_ID", "w1:p1,w2:p1"],
  ["HERDR_PANE_ID", "w1:p1\n"],
] as const) {
  await test(`rejects missing or malformed ${key}=${JSON.stringify(value)} without requests`, async (t) => {
    const server = await herdr([]);
    t.after(() => server.close());
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    await assert.rejects(
      createTerminalPlugin(),
      /Launch Runner inside.*inherited HERDR_SOCKET_PATH and HERDR_PANE_ID/,
    );
    assert.deepEqual(server.requests, []);
  });
}
