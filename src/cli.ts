#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { runCli } from "issue-runner-core/cli";
import * as terminal from "./index.ts";

const terminalCliEntry = realpathSync(new URL(import.meta.url));
const terminalPackageRoot = dirname(dirname(terminalCliEntry));
const { version } = JSON.parse(
  readFileSync(join(terminalPackageRoot, "package.json"), "utf8"),
) as { version: string };

await runCli({
  commandName: "issue-runner-herdr",
  commandVersion: version,
  terminal,
  terminalPackageRoot,
  terminalCliEntry,
});
