import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  enhancementContractVersion,
  type EnhancementModule,
} from "issue-runner-core/terminal";
import { record } from "../herdr/client.ts";

async function globalInstallation(root: string): Promise<boolean> {
  const modules = path.dirname(root);
  try {
    if ((await realpath(path.join(modules, "issue-runner-herdr"))) !== root)
      return false;
    const manifest: unknown = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    );
    if (
      !record(manifest) ||
      manifest.name !== "issue-runner-herdr" ||
      !record(manifest.bin) ||
      typeof manifest.bin["issue-runner-herdr"] !== "string"
    )
      return false;
    const cli = await realpath(
      path.resolve(root, manifest.bin["issue-runner-herdr"]),
    );
    if (!cli.startsWith(`${root}${path.sep}`)) return false;
    for (const launcher of [
      path.join(path.dirname(modules), "issue-runner-herdr.cmd"),
      path.resolve(modules, "../../bin/issue-runner-herdr"),
    ]) {
      try {
        let destination = launcher;
        if (launcher.endsWith(".cmd")) {
          // npm's Windows shim records its target relative to the launcher's directory.
          const match = /"%(?:~dp0|dp0%)\\([^"]+?)"\s+%\*/.exec(
            await readFile(launcher, "utf8"),
          );
          if (!match) continue;
          destination = path.resolve(
            path.dirname(launcher),
            match[1]!.replaceAll("\\", path.sep),
          );
        }
        if ((await realpath(destination)) === cli) return true;
      } catch (error) {
        if (!record(error) || error.code !== "ENOENT") throw error;
      }
    }
    return false;
  } catch (error) {
    if (record(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

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
    if (!(await globalInstallation(root))) return undefined;
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
