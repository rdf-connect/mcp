export const RDFC_GUIDE = `# RDF-Connect primer

RDF-Connect pipelines are described in a \`pipeline.ttl\` (Turtle/RDF) file built from five concepts:

- **Pipeline** (\`rdfc:Pipeline\`): the top-level thing you define. It has one or more
  \`rdfc:consistsOf [ ... ]\` blank nodes, each pairing a runner with the processors it executes.
- **Runner** (\`rdfc:Runner\`, e.g. \`rdfc:NodeRunner\`, \`rdfc:PyRunner\`, \`rdfc:JvmRunner\`): executes
  processors written in a specific language/runtime. Attached via \`rdfc:instantiates\` inside a
  \`rdfc:consistsOf\` blank node.
- **Processor** (\`rdfc:Processor\`): a reusable unit of work (fetch data, transform, log, ...),
  implemented in JS/Python/Java. Attached to its runner's blank node via \`rdfc:processor <iri>\`,
  then separately instantiated with its own triples (\`<iri> a rdfc:SomeProcessor; rdfc:reader ...\`).
  Every processor's exact configuration properties (which are required, their datatype/class) are
  described by a SHACL NodeShape targeting its class — use \`get_component\` to fetch it instead of
  guessing.
- **Channel** (\`rdfc:Reader\` / \`rdfc:Writer\`): a named streaming link between processors, declared
  as \`<channelX> a rdfc:Writer, rdfc:Reader.\` and referenced from both the writing and reading
  processor.
- **owl:imports**: every runner and processor used in the pipeline must have its semantic (Turtle)
  definition imported, typically pointing at the installed package's \`.ttl\` file
  (e.g. \`./node_modules/<pkg>/processor.ttl\` for npm, or a venv site-packages path for PyPI).

## Recommended workflow for an agent building a pipeline

1. \`list_components\` (optionally with \`query\`/\`language\` filters) to find candidate processors.
2. \`get_component\` on each candidate to read its exact parameters (required vs optional, datatype).
3. \`get_pipeline_examples\` to see real \`pipeline.ttl\` files from the ecosystem for reference/style.
4. \`generate_pipeline_skeleton\` with the chosen processor IRIs to get a wired-up draft
   (imports, channels, consistsOf, processor stubs with TODO placeholders for required params).
5. Fill in the TODO placeholders with real values and correct the \`owl:imports\` paths to match how
   the packages are actually installed in the target project.
6. \`get_shapes_graph\` if you need the full SHACL shapes graph for stricter validation.

Data is harvested periodically from GitHub (repos tagged \`rdfc-processor\`, \`rdfc-runner\`,
\`rdfc-orchestrator\`, \`rdfc-pipeline\`, \`rdf-connect\`) in the background — call \`catalog_status\` to see
how fresh it is.
`;
