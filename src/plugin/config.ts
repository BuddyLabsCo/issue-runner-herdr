import { record } from "../herdr/client.ts";

export function configuration(value: unknown = {}) {
  if (!record(value)) throw new Error("terminalPlugins must be an object");
}
