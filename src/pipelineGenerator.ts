import { shortId } from "./rdf.js";
import type { Component, Repository } from "./types.js";

const RUNNER_BY_LANGUAGE: Record<string, string> = {
  js: "rdfc:NodeRunner",
  python: "rdfc:PyRunner",
  java: "rdfc:JvmRunner",
};

const IMPORT_HINT_BY_LANGUAGE: Record<string, (repo: Repository, definedIn: string) => string> = {
  js: (repo, definedIn) =>
    `./node_modules/${repo.packageName ?? "<npm-package-name>"}/${definedIn}`,
  python: (repo, definedIn) =>
    `./.venv/lib/python3.13/site-packages/${repo.packageName ?? "<pypi-package-name>"}/${definedIn}`,
  java: (repo) => `./build/plugins/<downloaded-jar-name>.jar`,
};

export interface SkeletonRequest {
  /** Processor IRIs (or their short local names) to include, in pipeline order. */
  processors: string[];
}

interface ResolvedProcessor {
  component: Component;
  repository: Repository;
  varName: string;
}

function resolveProcessor(
  repositories: Repository[],
  ref: string,
): { component: Component; repository: Repository } | undefined {
  for (const repo of repositories) {
    for (const component of repo.components) {
      if (component.type !== "processor") continue;
      if (component.iri === ref || shortId(component.iri) === ref || component.name === ref) {
        return { component, repository: repo };
      }
    }
  }
  return undefined;
}

/**
 * Generates a best-effort pipeline.ttl skeleton wiring the requested processors in a
 * straight line (reader/writer channels chained processor-to-processor), grouped by
 * runner. Required parameters that aren't a reader/writer are left as TODO placeholders
 * for the agent/user to fill in with real values.
 */
export function generatePipelineSkeleton(
  repositories: Repository[],
  request: SkeletonRequest,
): { turtle: string; warnings: string[] } {
  const warnings: string[] = [];
  const resolved: ResolvedProcessor[] = [];

  request.processors.forEach((ref, i) => {
    const found = resolveProcessor(repositories, ref);
    if (!found) {
      warnings.push(`Could not resolve processor "${ref}" in the current catalog - skipped.`);
      return;
    }
    resolved.push({ ...found, varName: `p${i + 1}` });
  });

  if (resolved.length === 0) {
    return {
      turtle: "# No processors could be resolved - nothing to generate.",
      warnings,
    };
  }

  const runnersUsed = new Set(resolved.map((r) => RUNNER_BY_LANGUAGE[r.component.language ?? "js"]));

  const RUNNER_IMPORT: Record<string, string> = {
    "rdfc:NodeRunner": "./node_modules/@rdfc/js-runner/index.ttl",
    "rdfc:PyRunner": "./.venv/lib/python3.13/site-packages/rdfc_runner/index.ttl",
    "rdfc:JvmRunner":
      "https://javadoc.jitpack.io/com/github/rdf-connect/jvm-runner/runner/master-SNAPSHOT/runner-master-SNAPSHOT-index.ttl",
  };

  const imports: { path: string; comment: string }[] = [];
  for (const runner of runnersUsed) {
    imports.push({ path: RUNNER_IMPORT[runner] ?? "TODO-import-path", comment: `${runner} runner` });
  }
  for (const { component, repository } of resolved) {
    const language = component.language ?? "js";
    const hint = IMPORT_HINT_BY_LANGUAGE[language]?.(repository, component.definedIn ?? "index.ttl");
    imports.push({ path: hint ?? "TODO-import-path", comment: `${component.name} (${repository.name})` });
  }

  const channelDefs: string[] = [];
  for (let i = 0; i <= resolved.length; i++) {
    channelDefs.push(`<channel${i + 1}> a rdfc:Writer, rdfc:Reader.`);
  }

  const consistsOf = [...runnersUsed]
    .map((runner) => {
      const procs = resolved.filter((r) => RUNNER_BY_LANGUAGE[r.component.language ?? "js"] === runner);
      const processorTriples = procs.map((r) => `       rdfc:processor <${r.varName}>;`).join("\n");
      return `   rdfc:consistsOf [\n       rdfc:instantiates ${runner};\n${processorTriples}\n   ]`;
    })
    .join(", ");

  const processorBlocks = resolved
    .map((r, i) => {
      const requiredParams = r.component.parameters.filter(
        (p) => (p.minCount ?? 0) >= 1 && !p.path.endsWith("#reader") && !p.path.endsWith("#writer"),
      );
      const readerLine =
        r.component.parameters.some((p) => p.path.endsWith("#reader"))
          ? `      rdfc:reader <channel${i + 1}>;\n`
          : "";
      const writerLine =
        r.component.parameters.some((p) => p.path.endsWith("#writer"))
          ? `      rdfc:writer <channel${i + 2}>;\n`
          : "";
      const paramLines = requiredParams
        .map((p) => `      rdfc:${shortId(p.path)} "TODO"; # ${p.description ?? p.name}`)
        .join("\n");
      return `<${r.varName}> a rdfc:${shortId(r.component.iri)};\n${readerLine}${writerLine}${paramLines ? paramLines + "\n" : ""}      rdfc:label "${r.varName}".`;
    })
    .join("\n\n");

  const turtle = `@prefix rdfc: <https://w3id.org/rdf-connect#>.
@prefix owl: <http://www.w3.org/2002/07/owl#>.

### Import runners and processors
${imports.map((i) => `<> owl:imports <${i.path}>.  # ${i.comment}`).join("\n")}

### Define the channels
${channelDefs.join("\n")}

### Define the pipeline
<> a rdfc:Pipeline;
${consistsOf}.

### Define the processors
${processorBlocks}
`;

  return { turtle, warnings };
}
