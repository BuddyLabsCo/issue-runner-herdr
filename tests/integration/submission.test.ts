import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalPlugin } from "../../src/index.ts";
import {
  contextSteps,
  createStep,
  herdr,
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
      {
        method: "pane.send_input",
        params: {
          pane_id: "w1:p2",
          text,
          keys: ["right", submitKey],
        },
        result: { type: "ok" },
      },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Issue",
    });
    await plugin.submitText(handle, text, submitKey);
    assert.equal(server.requests.length, 6);
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
      {
        method: "pane.send_input",
        params: {
          pane_id: "w1:p2",
          text: command,
          keys: ["right", "enter"],
        },
        result: { type: "ok" },
      },
      ...targetSteps(),
      {
        method: "pane.send_input",
        params: {
          pane_id: "w1:p2",
          text: "First prompt\n\n  keep indentation",
          keys: ["right", "shift+enter"],
        },
        result: { type: "ok" },
      },
      ...targetSteps(),
      {
        method: "pane.send_input",
        params: {
          pane_id: "w1:p2",
          text: "Later prompt",
          keys: ["right", "enter"],
        },
        result: { type: "ok" },
      },
    ]);
    t.after(() => server.close());
    const plugin = await createTerminalPlugin();
    const handle = await plugin.createTab({
      cwd: process.cwd(),
      env: {},
      label: "Fresh command tab",
    });
    await plugin.submitText(handle, command);
    await plugin.submitText(
      handle,
      "First prompt\n\n  keep indentation",
      "shift+enter",
    );
    await plugin.submitText(handle, "Later prompt", "enter");
    assert.equal(server.requests.length, 12);
  });
}
