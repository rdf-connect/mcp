import { RdfStore } from "rdf-stores";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectPackageName,
  fetchRepoTurtleFiles,
  fetchRepositoriesByTopic,
  rawUrl,
  type RepoSummary,
} from "./github.js";
import { parseTurtleUrl, serializeQuads } from "./turtle.js";
import { definesPipeline, descriptionOf, discoverComponents, labelOf } from "./shapes.js";
import type { Catalog, Component, Repository } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Topics used across the RDF-Connect ecosystem, see rdf-connect.github.io/discover-existing-work.md */
const COMPONENT_TOPICS = ["rdfc-processor", "rdfc-runner", "rdfc-orchestrator", "rdfc-pipeline"];
const CATCH_ALL_TOPIC = "rdf-connect";

/**
 * Harvests a single repository's turtle files, splitting out pipeline examples from
 * component (processor/runner/orchestrator) definitions. Processor-related quads are
 * also merged into `shapesStore` so a single aggregated SHACL shapes graph can be built
 * for the whole ecosystem without re-parsing serialized turtle later.
 */
async function harvestRepo(
  repo: RepoSummary,
  shapesStore: RdfStore,
  log: (msg: string) => void,
): Promise<Repository> {
  let files: { path: string }[] = [];
  try {
    files = await fetchRepoTurtleFiles(repo);
  } catch (err) {
    log(`  ! could not list files for ${repo.name}: ${(err as Error).message}`);
  }

  const aggregate = RdfStore.createDefault();
  const components: Component[] = [];
  const pipelineExamples: Repository["pipelineExamples"] = [];
  const languages = new Set<"js" | "python" | "java">();

  for (const file of files) {
    const url = rawUrl(repo, file.path);
    const store = await parseTurtleUrl(url);
    const quads = store.getQuads();
    if (quads.length === 0) continue;

    if (definesPipeline(store)) {
      pipelineExamples.push({ path: file.path, url, turtle: await serializeQuads(quads) });
      continue;
    }

    for (const quad of quads) aggregate.addQuad(quad);

    const discoveredHere = discoverComponents(store);
    if (discoveredHere.some((d) => d.type === "processor")) {
      for (const quad of quads) shapesStore.addQuad(quad);
    }

    for (const discovered of discoveredHere) {
      if (discovered.language) languages.add(discovered.language);
      components.push({
        iri: discovered.term.value,
        type: discovered.type,
        name: labelOf(store, discovered.term),
        description: descriptionOf(store, discovered.term),
        language: discovered.language,
        definedIn: file.path,
        entrypoint: discovered.entrypoint,
        className: discovered.className,
        parameters: discovered.parameters,
      });
    }
  }

  let packageName: string | undefined;
  for (const language of languages) {
    packageName = await detectPackageName(repo, language);
    if (packageName) break;
  }

  return {
    name: repo.name,
    url: repo.url,
    description: repo.description,
    branch: repo.branch,
    topics: repo.topics,
    components,
    pipelineExamples,
    turtle: await serializeQuads(aggregate.getQuads()),
    packageName,
  };
}

export type ProgressCallback = (message: string) => void;

export async function harvestCatalog(onProgress?: ProgressCallback): Promise<Catalog> {
  const log = onProgress ?? (() => {});

  const repoIndex = new Map<string, RepoSummary>();
  for (const topic of COMPONENT_TOPICS) {
    log(`Searching GitHub for topic:${topic}...`);
    for (const r of await fetchRepositoriesByTopic(topic)) repoIndex.set(r.name, r);
  }
  log(`Searching GitHub for topic:${CATCH_ALL_TOPIC}...`);
  for (const r of await fetchRepositoriesByTopic(CATCH_ALL_TOPIC)) {
    if (!repoIndex.has(r.name)) repoIndex.set(r.name, r);
  }

  const shapesStore = RdfStore.createDefault();
  const baseShapePath = path.join(__dirname, "assets", "base-pipeline-shape.ttl");
  const baseStore = await parseTurtleUrl(baseShapePath);
  for (const quad of baseStore.getQuads()) shapesStore.addQuad(quad);

  const repositories: Repository[] = [];
  for (const repo of repoIndex.values()) {
    log(`Harvesting ${repo.name}...`);
    try {
      repositories.push(await harvestRepo(repo, shapesStore, log));
    } catch (err) {
      log(`  ! failed to harvest ${repo.name}: ${(err as Error).message}`);
      repositories.push({
        name: repo.name,
        url: repo.url,
        description: repo.description,
        branch: repo.branch,
        topics: repo.topics,
        components: [],
        pipelineExamples: [],
        turtle: "",
      });
    }
  }

  log("Serializing aggregated SHACL shapes graph...");
  const shapesGraphTurtle = await serializeQuads(shapesStore.getQuads());

  return {
    harvestedAt: new Date().toISOString(),
    repositories,
    shapesGraphTurtle,
  };
}
