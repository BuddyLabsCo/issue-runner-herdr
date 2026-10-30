import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class BackendError extends Error {
  readonly code: string;

  constructor(method: string, code: string, message: string) {
    super(`Herdr ${method}: ${code}: ${message}`);
    this.code = code;
  }
}

export class Client {
  readonly address: string;
  failure: Error | undefined;
  private readonly pending = new Set<(error: Error) => void>();

  constructor(socketPath: string) {
    this.address =
      process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  }

  invalidate(message: string): Error {
    if (this.failure) return this.failure;
    this.failure = new Error(
      `Herdr context invalidated: ${message}. Initialize a new plugin; do not replay uncertain input.`,
    );
    for (const finish of this.pending) finish(this.failure);
    return this.failure;
  }

  request(
    method: string,
    params: Record<string, unknown>,
    resultType: string,
  ): Promise<Record<string, unknown>> {
    if (this.failure) return Promise.reject(this.failure);
    const id = randomUUID();
    const wire = JSON.stringify({ id, method, params }) + "\n";
    if (Buffer.byteLength(wire) > 1024 * 1024) {
      return Promise.reject(
        new Error(`Herdr ${method}: request exceeds the 0.9.5 1 MiB limit`),
      );
    }
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.address);
      let settled = false;
      let buffer = "";
      const finish = (error?: Error, result?: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        this.pending.delete(finish);
        clearTimeout(timer);
        socket.destroy();
        if (error) {
          reject(
            error instanceof BackendError
              ? error
              : this.invalidate(`${method}: ${error.message}`),
          );
        } else if (this.failure) {
          reject(this.failure);
        } else {
          resolve(result!);
        }
      };
      // A total deadline also bounds connect, writes, and partial/trickling replies.
      const timer = setTimeout(
        () =>
          finish(
            new Error("I/O timed out after 5000 ms; outcome may be uncertain"),
          ),
        5000,
      );
      this.pending.add(finish);
      socket.setEncoding("utf8");
      socket.once("connect", () => socket.write(wire));
      socket.on("error", (error) => finish(error));
      socket.once("close", () =>
        finish(new Error("connection closed before a complete response")),
      );
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 1024 * 1024) {
          finish(new Error("response exceeds 1 MiB"));
          return;
        }
        const end = buffer.indexOf("\n");
        if (end < 0) return;
        try {
          const response: unknown = JSON.parse(buffer.slice(0, end));
          if (!record(response) || response.id !== id) {
            throw new Error("invalid response or mismatched request ID");
          }
          if ("error" in response) {
            if (
              "result" in response ||
              !record(response.error) ||
              typeof response.error.code !== "string" ||
              typeof response.error.message !== "string"
            ) {
              throw new Error("malformed error response");
            }
            finish(
              new BackendError(
                method,
                response.error.code,
                response.error.message,
              ),
            );
          } else {
            if (
              !record(response.result) ||
              response.result.type !== resultType
            ) {
              throw new Error(`expected ${resultType} response`);
            }
            finish(undefined, response.result);
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}
