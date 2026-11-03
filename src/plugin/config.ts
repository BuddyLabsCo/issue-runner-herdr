import { record } from "../herdr/client.ts";

export function configuration(value: unknown = {}) {
  if (!record(value)) throw new Error("terminalPlugins must be an object");
  const { agentStartDelay = 10, enhancements = {} } = value;
  if (
    typeof agentStartDelay !== "number" ||
    !Number.isFinite(agentStartDelay) ||
    agentStartDelay < 0 ||
    agentStartDelay * 1000 > 2_147_483_647
  ) {
    throw new Error(
      "agentStartDelay must be finite non-negative seconds within the timer limit",
    );
  }
  if (!record(enhancements)) throw new Error("enhancements must be an object");
  return { agentStartDelay, enhancements };
}
