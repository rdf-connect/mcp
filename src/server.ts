import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CatalogStore } from "./catalogStore.js";
import { generatePipelineSkeleton } from "./pipelineGenerator.js";
import { shortId } from "./rdf.js";
import { RDFC_GUIDE } from "./guide.js";
import { RDFC_AUTHORING_GUIDE } from "./authoringGuide.js";
import type { Catalog, Component, ComponentType, Repository } from "./types.js";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function json(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

function notHarvestedYet() {
  return text(
    "The catalog hasn't been harvested yet (server just started). " +
      "Try again shortly - a background harvest is in progress; check catalog_status.",
  );
}

type ListedItem = {
  kind: ComponentType | "pipeline" | "other";
  iri?: string;
  name: string;
  description: string;
  language?: string;
  repository: string;
  repositoryUrl: string;
  packageName?: string;
  parameterCount?: number;
};

function flattenCatalog(catalog: Catalog): ListedItem[] {
  const items: ListedItem[] = [];
  for (const repo of catalog.repositories) {
    for (const c of repo.components) {
      items.push({
        kind: c.type,
        iri: c.iri,
        name: c.name,
        description: c.description,
        language: c.language,
        repository: repo.name,
        repositoryUrl: repo.url,
        packageName: repo.packageName,
        parameterCount: c.parameters.length,
      });
    }
    for (const ex of repo.pipelineExamples) {
      items.push({
        kind: "pipeline",
        name: ex.path,
        description: `Example pipeline in ${repo.name}`,
        repository: repo.name,
        repositoryUrl: repo.url,
      });
    }
    if (repo.components.length === 0 && repo.pipelineExamples.length === 0) {
      items.push({
        kind: "other",
        name: repo.name,
        description: repo.description ?? "",
        repository: repo.name,
        repositoryUrl: repo.url,
      });
    }
  }
  return items;
}

function findComponent(catalog: Catalog, ref: string): { component: Component; repository: Repository } | undefined {
  for (const repo of catalog.repositories) {
    for (const component of repo.components) {
      if (component.iri === ref || shortId(component.iri) === ref || component.name === ref) {
        return { component, repository: repo };
      }
    }
  }
  return undefined;
}

/**
 * Builds a fresh McpServer wired up to `store`. Called once for stdio, and once per HTTP
 * session (see httpServer.ts) - `store` itself is shared and long-lived either way.
 */
export function createMcpServer(store: CatalogStore): McpServer {
  const server = new McpServer({
    name: "rdfc-mcp-server",
    version: "0.1.0",
  });

  function requireCatalog(): Catalog | undefined {
    return store.get();
  }

  server.registerResource(
    "rdfc-guide",
    "rdfc://guide",
    {
      title: "RDF-Connect primer",
      description: "Short primer on RDF-Connect concepts and the recommended tool workflow for building a pipeline.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: RDFC_GUIDE }],
    }),
  );

  server.registerResource(
    "rdfc-authoring-guide",
    "rdfc://authoring-guide",
    {
      title: "RDF-Connect processor authoring guide (JS/TS only)",
      description:
        "Read this before writing a brand-new JS/TS processor (i.e. list_components/get_component found " +
        "nothing suitable, and the target runner is rdfc:NodeRunner). Covers the Processor<T> lifecycle, " +
        "how pipeline.ttl SHACL shapes become constructor args (including the rdfl:PathLens mechanism for " +
        "'configured SHACL path' parameters), the SDS message convention, and a minimal project scaffold - " +
        "the parts the catalog tools below can't tell you because they only index .ttl metadata, not " +
        "runtime library APIs. For Python (rdfc:PyRunner) or Java (rdfc:JvmRunner) targets, none of this " +
        "applies - use get_component on TemplateProcessorPy or TestProcessor instead.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: RDFC_AUTHORING_GUIDE }],
    }),
  );

  server.registerResource(
    "rdfc-catalog",
    "rdfc://catalog",
    {
      title: "Full RDF-Connect catalog (JSON)",
      description: "The complete harvested catalog of processors, runners, orchestrators, pipelines and repositories.",
      mimeType: "application/json",
    },
    async (uri) => {
      const catalog = requireCatalog();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(catalog ?? { harvestedAt: null, repositories: [] }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "rdfc-shapes",
    "rdfc://shapes",
    {
      title: "Aggregated SHACL shapes graph (Turtle)",
      description: "SHACL shapes for rdfc:Pipeline plus every discovered processor's parameter shape.",
      mimeType: "text/turtle",
    },
    async (uri) => {
      const catalog = requireCatalog();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/turtle",
            text: catalog?.shapesGraphTurtle ?? "",
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_components",
    {
      title: "List RDF-Connect components",
      description:
        "List processors, runners, orchestrators, pipeline examples, and other tagged repositories from the " +
        "harvested RDF-Connect GitHub ecosystem. Use `query` to full-text search name/description/repository.",
      inputSchema: {
        kind: z
          .enum(["processor", "runner", "orchestrator", "pipeline", "other", "all"])
          .default("all")
          .describe("Filter by component kind. 'pipeline' returns example pipeline.ttl files."),
        language: z
          .enum(["js", "python", "java"])
          .optional()
          .describe("Filter processors by implementation language."),
        query: z.string().optional().describe("Case-insensitive substring search across name/description/repository."),
      },
    },
    async ({ kind, language, query }) => {
      const catalog = requireCatalog();
      if (!catalog) return notHarvestedYet();

      let items = flattenCatalog(catalog);
      if (kind !== "all") items = items.filter((i) => i.kind === kind);
      if (language) items = items.filter((i) => i.language === language);
      if (query) {
        const q = query.toLowerCase();
        items = items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q) ||
            i.repository.toLowerCase().includes(q),
        );
      }
      return json({ count: items.length, items });
    },
  );

  server.registerTool(
    "get_component",
    {
      title: "Get full details of a processor/runner/orchestrator",
      description:
        "Fetch the full definition of a single component by IRI, short local name (e.g. 'LogProcessorJs') or " +
        "exact label - including its required/optional parameters (from its SHACL shape), source repository, " +
        "install package name (best-effort) and the raw turtle definition file it was found in.",
      inputSchema: {
        ref: z.string().describe("IRI, short local name, or label of the component, as returned by list_components."),
      },
    },
    async ({ ref }) => {
      const catalog = requireCatalog();
      if (!catalog) return notHarvestedYet();

      const found = findComponent(catalog, ref);
      if (!found) return text(`No component matching "${ref}" was found in the current catalog.`);

      const { component, repository } = found;
      return json({
        component,
        repository: {
          name: repository.name,
          url: repository.url,
          description: repository.description,
          branch: repository.branch,
          topics: repository.topics,
          packageName: repository.packageName,
        },
        repositoryTurtle: repository.turtle,
      });
    },
  );

  server.registerTool(
    "get_pipeline_examples",
    {
      title: "Get example pipeline.ttl files",
      description:
        "List real pipeline.ttl (or similarly named) files discovered across the ecosystem, optionally filtered " +
        "to a specific repository, as reference material before writing a new pipeline.",
      inputSchema: {
        repository: z.string().optional().describe("Restrict to a specific repository, e.g. 'rdf-connect/some-repo'."),
      },
    },
    async ({ repository }) => {
      const catalog = requireCatalog();
      if (!catalog) return notHarvestedYet();

      const examples = catalog.repositories
        .filter((r) => !repository || r.name === repository)
        .flatMap((r) => r.pipelineExamples.map((e) => ({ repository: r.name, repositoryUrl: r.url, ...e })));

      if (examples.length === 0) return text("No pipeline examples found matching that filter.");
      return json({ count: examples.length, examples });
    },
  );

  server.registerTool(
    "get_shapes_graph",
    {
      title: "Get the aggregated SHACL shapes graph",
      description:
        "Return the full aggregated SHACL shapes graph (Turtle) covering rdfc:Pipeline's structure plus every " +
        "discovered processor's parameter shape. Useful for SHACL-validating a drafted pipeline.",
      inputSchema: {},
    },
    async () => {
      const catalog = requireCatalog();
      if (!catalog) return notHarvestedYet();
      return text(catalog.shapesGraphTurtle);
    },
  );

  server.registerTool(
    "generate_pipeline_skeleton",
    {
      title: "Generate a draft pipeline.ttl",
      description:
        "Generate a best-effort pipeline.ttl skeleton wiring the given processors together in order (chained via " +
        "reader/writer channels, grouped by the runner each processor's language needs). Required non-channel " +
        "parameters are left as TODO placeholders. Always inspect the result and fix owl:imports paths and TODOs " +
        "before use - this is a starting point, not a finished pipeline.",
      inputSchema: {
        processors: z
          .array(z.string())
          .min(1)
          .describe("Processor IRIs / short names / labels, in the order data should flow through them."),
      },
    },
    async ({ processors }) => {
      const catalog = requireCatalog();
      if (!catalog) return notHarvestedYet();

      const { turtle, warnings } = generatePipelineSkeleton(catalog.repositories, { processors });
      return json({ turtle, warnings });
    },
  );

  server.registerTool(
    "catalog_status",
    {
      title: "Get catalog freshness and summary stats",
      description:
        "Report when the catalog was last harvested, how many components it contains, and refresh state. " +
        "The catalog refreshes itself automatically in the background on a schedule - this tool is read-only " +
        "and cannot trigger a refresh.",
      inputSchema: {},
    },
    async () => {
      const catalog = requireCatalog();
      const counts = {
        processor: 0,
        runner: 0,
        orchestrator: 0,
        pipelineExamples: 0,
        repositories: catalog?.repositories.length ?? 0,
      };
      for (const repo of catalog?.repositories ?? []) {
        counts.pipelineExamples += repo.pipelineExamples.length;
        for (const c of repo.components) counts[c.type]++;
      }
      return json({
        harvestedAt: catalog?.harvestedAt ?? null,
        ageSeconds: catalog ? Math.round((Date.now() - Date.parse(catalog.harvestedAt)) / 1000) : null,
        isRefreshing: store.isRefreshing(),
        lastError: store.getLastError() ?? null,
        lastHarvestLog: store.getLog(),
        cacheFilePath: store.getCacheFilePath(),
        counts,
      });
    },
  );

  server.registerPrompt(
    "build_pipeline",
    {
      title: "Build an RDF-Connect pipeline",
      description:
        "Guided workflow for discovering existing RDF-Connect processors and drafting a pipeline.ttl from them.",
      argsSchema: {
        goal: z.string().describe("What the pipeline should accomplish, e.g. 'fetch an LDES and log each member'."),
      },
    },
    ({ goal }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `${RDFC_GUIDE}\n\n---\n\nGoal: ${goal}\n\n` +
              "Use list_components / get_component to find and inspect suitable processors for this goal, " +
              "then generate_pipeline_skeleton to draft a pipeline.ttl, then fill in the TODO placeholders.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "write_processor",
    {
      title: "Write a new RDF-Connect processor",
      description:
        "Guided workflow for authoring a brand-new processor when no existing one fits. For `language: js` " +
        "(the default) this covers the Processor<T> lifecycle, SHACL-to-args binding (including " +
        "rdfl:PathLens), the SDS message convention, and testing. For `python`/`java` there is no dedicated " +
        "guide yet - the prompt instead points at that runner's template processor to learn its conventions " +
        "from.",
      argsSchema: {
        goal: z
          .string()
          .describe("What the new processor should do, e.g. 'alert when a sensor value at a configured path exceeds a threshold'."),
        language: z
          .enum(["js", "python", "java"])
          .default("js")
          .describe("Target runner/language: js -> rdfc:NodeRunner, python -> rdfc:PyRunner, java -> rdfc:JvmRunner."),
      },
    },
    ({ goal, language }) => {
      const nonJsGuidance: Record<"python" | "java", string> = {
        python:
          "There is no dedicated authoring guide for Python yet. Use get_component on `TemplateProcessorPy` " +
          "(repo rdf-connect/template-processor-py) and `LogProcessorPy`/`SendProcessorPy` (repo " +
          "rdf-connect/log-processor-py) for a real, working example of the PyRunner's processor base class, " +
          "argument binding, and packaging (pyproject.toml + processor.ttl) conventions - read those repos " +
          "directly rather than guessing.",
        java:
          "There is no dedicated authoring guide for Java yet. Use get_component on `TestProcessor` (repo " +
          "rdf-connect/template-processor-jvm) and `RmlMapper` (repo rdf-connect/rml-processor-jvm) for a " +
          "real, working example of the JvmRunner's processor interface, argument binding, and packaging " +
          "conventions - read those repos directly rather than guessing.",
      };

      const text =
        language === "js"
          ? `${RDFC_AUTHORING_GUIDE}\n\n---\n\nGoal: ${goal}\n\n` +
            "First confirm with list_components that nothing suitable already exists. Then, once " +
            "@rdfc/js-runner and any needed ontology/lens packages are npm installed, prefer reading " +
            "their installed .d.ts files over fetching source from GitHub. Write the processor, its " +
            "processor.ttl SHACL shape, and tests that exercise transform() end-to-end."
          : `Goal: ${goal}\n\nTarget language: ${language}.\n\n${nonJsGuidance[language]}\n\n` +
            "First confirm with list_components that nothing suitable already exists for this goal.";

      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text },
          },
        ],
      };
    },
  );

  return server;
}

/** One-line summaries for the HTML landing page - keep in sync with the tool descriptions above. */
export const TOOL_SUMMARIES: { name: string; summary: string }[] = [
  { name: "list_components", summary: "List/search processors, runners, orchestrators and example pipelines." },
  { name: "get_component", summary: "Full detail on one component: parameters, source repo, package name." },
  { name: "get_pipeline_examples", summary: "Real pipeline.ttl files found in the ecosystem, for reference." },
  { name: "get_shapes_graph", summary: "The aggregated SHACL shapes graph (Turtle)." },
  { name: "generate_pipeline_skeleton", summary: "Draft a pipeline.ttl wiring the given processors together." },
  { name: "catalog_status", summary: "Freshness/counts/last error for the harvested catalog." },
];
