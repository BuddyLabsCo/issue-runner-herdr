import assert from "node:assert/strict";
import test from "node:test";
import { encodeSubmitKey } from "../../src/herdr/keys.ts";

await test("defaults an omitted submission chord to Enter", () => {
  assert.equal(encodeSubmitKey(), "enter");
  assert.equal(encodeSubmitKey(undefined), "enter");
});

await test("rejects non-string chords supplied by JavaScript callers", () => {
  for (const key of [{ toLowerCase: () => "enter" }, null, false, 42, []]) {
    // @ts-expect-error Exercise invalid runtime input outside the string contract.
    assert.throws(() => encodeSubmitKey(key), /Unsupported submitKey/);
  }
});

for (const [requested, encoded] of [
  ["Enter", "enter"],
  ["enter", "enter"],
  ["ENTER", "enter"],
  ["Shift+Enter", "shift+enter"],
  ["shift+enter", "shift+enter"],
  ["SHIFT+ENTER", "shift+enter"],
]) {
  await test(`maps the logical submission chord ${requested}`, () => {
    assert.equal(encodeSubmitKey(requested), encoded);
  });
}

for (const key of [
  "",
  "Ctrl+Enter",
  "Shift-Enter",
  "right",
  "enter shift+enter",
  "enter,shift+enter",
  "right+enter",
  " enter",
  "enter ",
  "enter\n",
  "\r",
  "\u001b[13;2u",
  '{"keys":["enter"]}',
  "pane.send_input",
]) {
  await test(`rejects unsupported chords and scripts: ${JSON.stringify(key)}`, () => {
    assert.throws(() => encodeSubmitKey(key), /Unsupported submitKey/);
  });
}
