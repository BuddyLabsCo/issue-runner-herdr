import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();

await test("rejects imports across architecture boundaries", async () => {
  const cases: [string, string][] = [
    ["src/herdr/client.mjs", "../plugin/handles.mjs"],
    ["src/herdr/nested/client.mjs", "../../plugin/handles.mjs"],
    ["src/plugin/operations.mjs", "../../tests/fixtures/server.mjs"],
    ["src/herdr/client.mjs", "../../tests/fixtures/server.mjs"],
    ["src/index.mjs", "../tests/fixtures/server.mjs"],
    ["src/plugin/operations.mjs", "node:fs/promises"],
    ["src/plugin/operations.mjs", "fs"],
    ["src/plugin/operations.mjs", "node:net"],
    ["src/plugin/operations.mjs", "child_process"],
    ["src/index.mjs", "issue-runner-core/dist/terminal.js"],
  ];
  for (const [filePath, source] of cases) {
    const [result] = await eslint.lintText(`export * from "${source}";`, {
      filePath,
    });
    assert.ok(
      result?.messages.some(
        (message) => message.ruleId === "no-restricted-imports",
      ),
      `${filePath} must reject ${source}`,
    );
  }
});

await test("allows dependencies in the intended direction", async () => {
  const cases: [string, string][] = [
    ["src/index.mjs", "./plugin/operations.mjs"],
    ["src/plugin/operations.mjs", "../herdr/client.mjs"],
    ["src/plugin/operations.mjs", "node:path"],
    ["src/herdr/client.mjs", "node:net"],
    ["src/index.mjs", "issue-runner-core/terminal"],
    ["tests/integration/plugin.mjs", "../../src/index.mjs"],
  ];
  for (const [filePath, source] of cases) {
    const [result] = await eslint.lintText(`export * from "${source}";`, {
      filePath,
    });
    assert.deepEqual(result?.messages, [], `${filePath} must allow ${source}`);
  }
});

await test("caps files at 500 code lines, excluding blanks and comments", async () => {
  for (const lines of [500, 501]) {
    const [result] = await eslint.lintText(
      "// Not counted.\n\n" + "export {};\n".repeat(lines),
      { filePath: "src/plugin/large.mjs" },
    );
    assert.equal(
      result?.messages.some((message) => message.ruleId === "max-lines"),
      lines > 500,
    );
  }
});

await test("keeps typed Promise checks enabled in TypeScript tests", async () => {
  const [result] = await eslint.lintText(
    "export async function example() { return 1; }\nexample();",
    { filePath: "tests/unit/quality.test.ts" },
  );
  const ruleIds = result?.messages.map((message) => message.ruleId);
  assert.ok(ruleIds?.includes("@typescript-eslint/no-floating-promises"));
  assert.ok(ruleIds?.includes("@typescript-eslint/require-await"));
});
