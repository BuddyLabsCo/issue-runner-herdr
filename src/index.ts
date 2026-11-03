import type { TerminalPlugin } from "issue-runner-core/terminal";
import { initialize } from "./herdr/targets.ts";
import { operations } from "./plugin/operations.ts";
import { configuration } from "./plugin/config.ts";

export const contractVersion = 1;

export async function createTerminalPlugin(
  config: unknown = {},
): Promise<TerminalPlugin> {
  const options = configuration(config);
  return operations(await initialize(), options.agentStartDelay);
}
