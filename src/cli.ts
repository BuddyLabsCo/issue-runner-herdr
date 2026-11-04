#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runCli } from "issue-runner-core/cli";
import * as terminal from "./index.ts";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

await runCli({
  commandName: "issue-runner-herdr",
  commandVersion: version,
  terminal,
});
