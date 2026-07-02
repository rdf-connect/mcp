import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Catalog } from "./types.js";

const cacheDir = process.env.RDFC_MCP_CACHE_DIR ?? path.join(os.homedir(), ".cache", "rdfc-mcp");
const cacheFile = path.join(cacheDir, "catalog.json");

export async function loadCachedCatalog(): Promise<Catalog | undefined> {
  try {
    const text = await readFile(cacheFile, "utf-8");
    return JSON.parse(text) as Catalog;
  } catch {
    return undefined;
  }
}

export async function saveCachedCatalog(catalog: Catalog): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(catalog, null, 2), "utf-8");
}

export { cacheFile };
