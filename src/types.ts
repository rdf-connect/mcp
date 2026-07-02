export type ComponentType = "processor" | "runner" | "orchestrator";

export interface ParameterShape {
  path: string;
  name: string;
  description?: string;
  datatype?: string;
  class?: string;
  minCount?: number;
  maxCount?: number;
  nodeKind?: string;
  defaultValue?: string;
}

export interface Component {
  iri: string;
  type: ComponentType;
  name: string;
  description: string;
  language?: "js" | "python" | "java";
  /** Path of the .ttl file (relative to repo root) that defines this component. */
  definedIn?: string;
  /** rdfc:file / rdfc:jar entrypoint pointing at the compiled artifact, relative to the repo. */
  entrypoint?: string;
  /** rdfc:class - the class/export name the runner should instantiate. */
  className?: string;
  parameters: ParameterShape[];
}

export interface Repository {
  name: string; // owner/repo
  url: string;
  description: string | null;
  branch: string;
  topics: string[];
  /** processors / runners / orchestrators discovered in this repo's turtle files */
  components: Component[];
  /** Turtle files inside the repo that define an rdfc:Pipeline instance (kept as reusable examples). */
  pipelineExamples: { path: string; url: string; turtle: string }[];
  /** Merged turtle serialization of every non-pipeline .ttl file found in the repo. */
  turtle: string;
  /** Best-effort install package name, e.g. npm package name for js processors. */
  packageName?: string;
}

export interface Catalog {
  harvestedAt: string;
  repositories: Repository[];
  /** processors/runners/orchestrators unioned with the base pipeline SHACL shapes, ready for SHACL-driven UIs. */
  shapesGraphTurtle: string;
}
