import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Request {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface Step {
  method: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  raw?: string;
  disconnect?: boolean;
  stall?: boolean;
}

export const caller = {
  pane_id: "w1:p1",
  workspace_id: "w1",
  tab_id: "w1:t1",
  terminal_id: "runner-terminal",
};

export const tab = { workspace_id: "w1", tab_id: "w1:t2", pane_count: 1 };
export const pane = {
  pane_id: "w1:p2",
  workspace_id: "w1",
  tab_id: "w1:t2",
  terminal_id: "owned-terminal",
};

export const contextSteps = (): Step[] => [
  {
    method: "pane.current",
    params: { caller_pane_id: "w1:p1" },
    result: { type: "pane_current", pane: caller },
  },
  {
    method: "workspace.get",
    params: { workspace_id: "w1" },
    result: { type: "workspace_info", workspace: { workspace_id: "w1" } },
  },
];

export const createStep = (): Step => ({
  method: "tab.create",
  result: { type: "tab_created", tab, root_pane: pane },
});

export const targetSteps = (): Step[] => [
  {
    method: "tab.get",
    params: { tab_id: "w1:t2" },
    result: { type: "tab_info", tab },
  },
  {
    method: "pane.get",
    params: { pane_id: "w1:p2" },
    result: { type: "pane_info", pane },
  },
];

export async function herdr(script: Step[] | ((request: Request) => Step)) {
  const socketPath = join(tmpdir(), `herdr-${randomUUID()}.sock`);
  const address =
    process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  const sockets = new Set<Socket>();
  const requests: Request[] = [];
  const failures: unknown[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {
      // Fault scripts intentionally disconnect clients with requests in flight.
    });
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      try {
        const request = JSON.parse(
          buffer.slice(0, buffer.indexOf("\n")),
        ) as Request;
        requests.push(request);
        const step = Array.isArray(script) ? script.shift() : script(request);
        assert.ok(step, `unexpected ${request.method}`);
        assert.equal(request.method, step.method);
        if (step.params) assert.deepEqual(request.params, step.params);
        if (step.disconnect) {
          socket.destroy();
        } else if (step.stall && step.raw) {
          socket.write(step.raw);
        } else if (!step.stall) {
          socket.end(
            step.raw ??
              JSON.stringify({
                id: request.id,
                ...(step.error
                  ? { error: step.error }
                  : { result: step.result }),
              }) + "\n",
          );
        }
      } catch (error) {
        failures.push(error);
        socket.destroy();
      }
    });
  });
  server.listen(address);
  await once(server, "listening");
  const env = { ...process.env };
  process.env.HERDR_SOCKET_PATH = socketPath;
  process.env.HERDR_PANE_ID = caller.pane_id;
  process.env.HERDR_WORKSPACE_ID = caller.workspace_id;
  process.env.HERDR_TAB_ID = caller.tab_id;
  return {
    requests,
    async close() {
      for (const key of Object.keys(process.env)) {
        if (!(key in env)) delete process.env[key];
      }
      Object.assign(process.env, env);
      const closed = once(server, "close");
      for (const socket of sockets) socket.destroy();
      server.close();
      await closed;
      assert.deepEqual(failures, []);
      if (Array.isArray(script)) {
        assert.equal(
          script.length,
          0,
          "all scripted requests must be exercised",
        );
      }
    },
  };
}
