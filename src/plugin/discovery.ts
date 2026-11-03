import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  enhancementContractVersion,
  type EnhancementModule,
} from "issue-runner-core/terminal";
import { record } from "../herdr/client.ts";

export async function discover(
  agent: string,
): Promise<EnhancementModule | undefined> {
  const name = `issue-runner-agent-${agent}`;
  if (name.length > 214 || !/^[a-z0-9._-]+$/.test(agent)) return undefined;
  const root = await realpath(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  const modules = path.dirname(root);
  if (
    path.basename(modules) !== "node_modules" ||
    (process.platform !== "win32" &&
      path.basename(path.dirname(modules)) !== "lib")
  )
    return undefined;
  const sibling = path.join(modules, name);
  try {
    await lstat(sibling);
  } catch (error) {
    if (record(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const installed = await realpath(sibling);
    if (path.dirname(installed) !== modules)
      throw new Error("enhancement must be installed in the same npm prefix");
    const entry = await realpath(fileURLToPath(import.meta.resolve(name)));
    const relative = path.relative(installed, entry);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error("enhancement entry escapes its installed package");
    const module: unknown = await import(pathToFileURL(entry).href);
    if (
      !record(module) ||
      module.contractVersion !== enhancementContractVersion
    )
      throw new Error(
        `enhancement must export contractVersion ${enhancementContractVersion}`,
      );
    if (typeof module.createEnhancement !== "function")
      throw new Error("enhancement must export createEnhancement");
    return module as unknown as EnhancementModule;
  } catch (error) {
    throw new Error(
      `Unable to load ${name}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
