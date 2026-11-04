import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
  inputSteps,
  targetSteps,
} from "../fixtures/herdr.ts";

for (const submitKey of ["enter", "shift+enter"]) {
  await test(`submits literal text with Core-selected ${submitKey}`, async (t) => {
    const text =
      "\nFirst\n\n  \u4e2d\u6587 \ud83d\ude80 'quoted' \"double\"\n\t$HOME $(echo literal) `echo literal` A&B | > C:\\temp\\a b\n";
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...inputSteps(text, submitKey),
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const { io } = await plugin.createTab({
      submitKey,
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    await io.submitText(text);
    assert.equal(server.requests.length, 8);
  });
}

for (const command of [
  'codex --model "configured-model" --config \'model_reasoning_effort="high"\'',
  'codex resume "saved-session-7" --model "configured-model"',
]) {
  await test(`a fresh tab submits the complete command before independent prompts: ${command}`, async (t) => {
    const server = await herdr([
      ...contextSteps(),
      createStep(),
      ...targetSteps(),
      ...inputSteps(command),
      ...targetSteps(),
      ...inputSteps("First prompt\n\n  keep indentation", "shift+enter"),
      ...targetSteps(),
      ...inputSteps("Later prompt", "shift+enter"),
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const { handle, io } = await plugin.createTab({
      submitKey: "Shift+Enter",
      cwd: process.cwd(),
      env: {},
      label: "Fresh command tab",
    });
    await plugin.execute(handle, command);
    await io.submitText("First prompt\n\n  keep indentation");
    await io.submitText("Later prompt");
    assert.equal(server.requests.length, 18);
  });
}
