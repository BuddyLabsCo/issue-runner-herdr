import { lstat, realpath } from "node:fs/promises";
import { exec } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  enhancementContractVersion,
  type EnhancementModule,
} from "issue-runner-core/terminal";
import { record } from "../herdr/client.ts";

const queryNpm = promisify(exec);

export async function discover(
  agent: string,
): Promise<EnhancementModule | undefined> {
  const name = `issue-runner-agent-${agent}`;
  if (name.length > 214 || !/^[a-z0-9._-]+$/.test(agent)) return undefined;
  const root = await realpath(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  const modules = path.dirname(root);
  if (path.basename(modules) !== "node_modules") return undefined;
  const sibling = path.join(modules, name);
  try {
    await lstat(sibling);
  } catch (error) {
    if (record(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    // Use a fixed command so Windows' npm.cmd works without interpolating paths or Agent input.
    const { stdout } = await queryNpm("npm root --global", {
      cwd: homedir(),
      timeout: 5000,
      windowsHide: true,
    });
    const globalModules = await realpath(stdout.trim()).catch(
      (error: unknown) => {
        if (record(error) && error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (globalModules !== modules) return undefined;
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
