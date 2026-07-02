#!/usr/bin/env node
import { harvestCatalog } from "./harvest.js";
import { saveCachedCatalog, cacheFile } from "./cache.js";

const catalog = await harvestCatalog((msg) => console.error(msg));
await saveCachedCatalog(catalog);
console.error(`Saved catalog to ${cacheFile}`);
console.log(
  JSON.stringify(
    {
      harvestedAt: catalog.harvestedAt,
      repositories: catalog.repositories.length,
      processors: catalog.repositories.flatMap((r) => r.components).filter((c) => c.type === "processor").length,
      runners: catalog.repositories.flatMap((r) => r.components).filter((c) => c.type === "runner").length,
      orchestrators: catalog.repositories.flatMap((r) => r.components).filter((c) => c.type === "orchestrator").length,
      pipelineExamples: catalog.repositories.flatMap((r) => r.pipelineExamples).length,
    },
    null,
    2,
  ),
);
