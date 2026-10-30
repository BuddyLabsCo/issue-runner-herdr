import type { TerminalPlugin } from "issue-runner-core/terminal";
import { initialize } from "./herdr/targets.ts";
import { operations } from "./plugin/operations.ts";

export const contractVersion = 1;

export async function createTerminalPlugin(): Promise<TerminalPlugin> {
  return operations(await initialize());
}
