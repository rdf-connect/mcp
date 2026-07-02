import { harvestCatalog } from "./harvest.js";
import { loadCachedCatalog, saveCachedCatalog, cacheFile } from "./cache.js";
import type { Catalog } from "./types.js";

const DEFAULT_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function refreshIntervalMs(): number {
  const fromEnv = Number(process.env.RDFC_MCP_REFRESH_INTERVAL_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_REFRESH_INTERVAL_MS;
}

export class CatalogStore {
  private catalog: Catalog | undefined;
  private refreshing: Promise<Catalog> | undefined;
  private lastError: string | undefined;
  private lastLog: string[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  async init(): Promise<void> {
    this.catalog = await loadCachedCatalog();

    const age = this.catalog ? Date.now() - Date.parse(this.catalog.harvestedAt) : Infinity;
    if (!this.catalog || age > refreshIntervalMs()) {
      // Kick off a harvest in the background so the server is usable immediately,
      // either serving stale cache or an empty catalog until this resolves.
      this.refresh().catch(() => {});
    }

    this.timer = setInterval(() => this.refresh().catch(() => {}), refreshIntervalMs());
    this.timer.unref?.();
  }

  get(): Catalog | undefined {
    return this.catalog;
  }

  isRefreshing(): boolean {
    return this.refreshing !== undefined;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }

  getLog(): string[] {
    return this.lastLog;
  }

  getCacheFilePath(): string {
    return cacheFile;
  }

  /** Triggers a harvest if one isn't already running, and returns a promise that resolves when it completes. */
  refresh(): Promise<Catalog> {
    if (this.refreshing) return this.refreshing;

    this.lastLog = [];
    this.refreshing = harvestCatalog((msg) => this.lastLog.push(msg))
      .then(async (catalog) => {
        this.catalog = catalog;
        this.lastError = undefined;
        await saveCachedCatalog(catalog);
        return catalog;
      })
      .catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        throw err;
      })
      .finally(() => {
        this.refreshing = undefined;
      });

    return this.refreshing;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
