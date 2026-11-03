import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type {
  EnhancementContext,
  EnhancementHost,
  TerminalPluginModule,
} from "issue-runner-core/terminal";

export const genericEnhancement = `
export const contractVersion = 1;
export const calls = [];
export const controls = {};
export async function createEnhancement(host, context, config) {
  const call = { host, context, config, stops: 0 };
  calls.push(call);
  await controls.initialize?.(call);
  return {
    async startMonitoring() { throw new Error("monitoring is separate work"); },
    async waitUntilReady() { throw new Error("readiness is separate work"); },
    onAssignment() { throw new Error("assignments are separate work"); },
    async stop() { call.stops++; await controls.stop?.(call); },
  };
}
`;

export interface EnhancementCall {
  host: EnhancementHost;
  context: EnhancementContext;
  config: unknown;
  stops: number;
}

interface Fixture {
  calls: EnhancementCall[];
  controls: {
    initialize?: (call: EnhancementCall) => Promise<void>;
    stop?: (call: EnhancementCall) => Promise<void>;
  };
}

export async function installedPlugin() {
  const prefix = await mkdtemp(join(tmpdir(), "herdr global prefix "));
  const modules = join(
    prefix,
    ...(process.platform === "win32" ? [] : ["lib"]),
    "node_modules",
  );
  const pluginRoot = join(modules, "issue-runner-herdr");
  await mkdir(pluginRoot, { recursive: true });
  const sourceRoot = new URL("../../src/", import.meta.url);
  for (const entry of await readdir(sourceRoot, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const source = join(entry.parentPath, entry.name);
    const output = join(
      pluginRoot,
      "src",
      relative(fileURLToPath(sourceRoot), source).replace(/\.ts$/, ".js"),
    );
    await mkdir(join(output, ".."), { recursive: true });
    await writeFile(
      output,
      ts.transpileModule(await readFile(source, "utf8"), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          rewriteRelativeImportExtensions: true,
        },
      }).outputText,
    );
  }
  await writeFile(
    join(pluginRoot, "package.json"),
    JSON.stringify({
      name: "issue-runner-herdr",
      type: "module",
      exports: "./src/index.js",
    }),
  );
  await cp(
    new URL("../../node_modules/issue-runner-core", import.meta.url),
    join(modules, "issue-runner-core"),
    { recursive: true },
  );
  const plugin = (await import(
    pathToFileURL(join(pluginRoot, "src/index.js")).href
  )) as TerminalPluginModule;
  return {
    prefix,
    modules,
    plugin,
    async install(agent = "generic", source = genericEnhancement) {
      const root = join(modules, `issue-runner-agent-${agent}`);
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: `issue-runner-agent-${agent}`,
          type: "module",
          exports: "./index.mjs",
        }),
      );
      await writeFile(join(root, "index.mjs"), source);
      return {
        root,
        async fixture() {
          return (await import(
            pathToFileURL(join(root, "index.mjs")).href
          )) as Fixture;
        },
      };
    },
    async close() {
      await rm(prefix, { recursive: true, force: true });
    },
  };
}
