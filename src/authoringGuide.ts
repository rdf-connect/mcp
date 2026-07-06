export const RDFC_AUTHORING_GUIDE = `# Authoring a new RDF-Connect processor (JS/TS)

Use this when \`list_components\` doesn't have a processor that does what you need, so you have to
write one **targeting the Node/JS runner (\`rdfc:NodeRunner\`)**. The catalog tools only index \`.ttl\`
metadata (parameters, source repo, package name) - they say nothing about the runtime APIs a processor
is written against. This guide is that missing half, for JS/TS specifically.

RDF-Connect processors are not JS/TS-only - Python (\`rdfc:PyRunner\`) and Java (\`rdfc:JvmRunner\`) are
equally first-class. If your target runtime is Python or Java, this guide's specifics (\`@rdfc/js-runner\`,
\`rdf-lens\`) do not apply; instead fetch \`get_component TemplateProcessorPy\` (repo
\`rdf-connect/template-processor-py\`) or \`get_component TestProcessor\` (repo
\`rdf-connect/template-processor-jvm\`) and follow that runner's own conventions. Only sections 3
(the SDS message convention) and 6 (register it once it's written) generalize across all three languages.

## 0. Don't re-derive this from GitHub source, read the installed types

Once \`@rdfc/js-runner\`, \`rdf-lens\` and \`@treecg/types\` are \`npm install\`ed, their compiled \`.d.ts\`
files under \`node_modules/**/lib\` or \`node_modules/**/dist\` are the ground truth and are far cheaper
to read than fetching source files from GitHub one at a time. In particular:

- \`node_modules/@rdfc/js-runner/lib/processor.d.ts\`, \`reader.d.ts\`, \`writer.d.ts\`, \`runner.d.ts\`,
  \`testUtils/index.d.ts\`
- \`node_modules/rdf-lens/dist/lens.d.ts\`, \`shacl.d.ts\`
- \`node_modules/@treecg/types/dist/lib/Vocabularies.d.ts\`

Package \`main\` branches on GitHub can be ahead of the last npm publish (e.g. test helpers). Check the
installed version actually exports what a README or example claims before relying on it.

## 1. The \`Processor<T>\` contract (\`@rdfc/js-runner\`)

\`\`\`ts
export abstract class Processor<T> {
  protected readonly logger: Logger; // winston
  constructor(args: T, logger: Logger); // the runner does \`new YourClass(args, logger)\`
  abstract init(this: T & this): Promise<void>;      // set up, validate config
  abstract transform(this: T & this): Promise<void>; // start reading; runs before produce()
  abstract produce(this: T & this): Promise<void>;   // start writing; no-op if purely reactive
}
\`\`\`

- Reader: \`this.reader.strings(): AsyncIterable<string>\` (also \`.buffers()\`, \`.streams()\`, \`.anys()\`).
- Writer: \`await this.writer.string(msg)\` (also \`.buffer()\`, \`.stream()\`); call \`await this.writer.close()\`
  once you're done writing so downstream processors see the channel end.
- \`this.args\`/\`this.get(key)\` also work, but destructuring \`this\` (as typed via \`this: T & this\`) is
  the idiomatic style used across the ecosystem.

## 2. How your \`processor.ttl\` SHACL shape becomes \`T\`

The runner parses the pipeline's turtle, finds the SHACL \`NodeShape\` whose \`sh:targetClass\` matches
your processor's \`rdf:type\`, and uses \`rdf-lens\`'s \`extractShapes\`/\`TypedExtract\` to turn each
instance's triples into the plain object passed to your constructor. Per \`sh:property\`:

- \`sh:class rdfc:Reader\` / \`rdfc:Writer\` -> resolved to the real channel object (not available until
  pipeline start; don't expect these classes to resolve in isolated unit tests without a mock).
- \`sh:datatype xsd:string\` -> \`string\`; \`xsd:integer\`/\`float\`/\`double\`/\`decimal\` -> \`number\`;
  \`xsd:boolean\` -> \`boolean\`; \`xsd:dateTime\` -> \`Date\`; \`xsd:iri\`/\`xsd:anyURI\` -> \`NamedNode\`. Values
  are already coerced - don't re-parse \`Number(...)\` on something typed \`xsd:double\`.
- \`sh:maxCount 1\` -> scalar field; unset or \`> 1\` -> array field.
- \`sh:minCount\` unset/\`0\` -> field is optional (\`undefined\` when absent) in \`T\`.
- \`sh:class <SomeOtherShape>\` -> recursively extracted nested object, per that shape.

### \`rdfl:\` special classes (namespace \`https://w3id.org/rdf-lens/ontology#\`)

These \`sh:class\` values short-circuit the generic object extraction above and hand you a ready-to-use
\`rdf-lens\` primitive instead:

- **\`rdfl:PathLens\`** - the single most useful one for "extract a value at a configured path" style
  parameters (see e.g. \`rdfc:Bucketize\`'s \`tree:timestampPath\`). The property's *value* in the pipeline
  instance must itself be a valid SHACL property path: a bare IRI (simple predicate), an RDF list
  (sequence path), \`[sh:alternativePath (...)]\`, \`[sh:inversePath ...]\`, or \`[sh:zeroOrMorePath ...]\`/
  \`[sh:zeroOrOnePath ...]\`. The field on \`T\` ends up typed \`BasicLensM<Cont, Cont>\` (from \`rdf-lens\`).
  Run it with \`this.myPath.execute({ id: someTerm, quads: someQuads })\` -> \`Cont[]\`, where
  \`Cont = { id: Term, quads: Quad[] }\` and each result's \`.id\` is the term found at the far end of the
  path (check \`.termType === "Literal"\` before treating \`.value\` as your extracted value).
- \`rdfl:CBD\` - the Concise Bounded Description quads reachable from the current node.
- \`rdfl:Context\` - the full quad array of the current message, unfiltered.

Declare it like:

\`\`\`turtle
sh:property [
  sh:class rdfl:PathLens;
  sh:path ex:valuePath;
  sh:name "valuePath";
  sh:minCount 1; sh:maxCount 1;
].
\`\`\`

so pipeline authors write \`<#p> ex:valuePath <http://example.org/temperature> .\` (or a more complex
path) to configure it - no bespoke parsing code needed in your processor.

## 3. The SDS message convention (\`https://w3id.org/sds#\`)

Most streaming processors exchange members wrapped in Smart Data Streams (SDS) envelopes rather than
bare RDF. A message is Turtle/N-Quads containing, per member:

\`\`\`turtle
[] sds:payload <memberIri>;
   sds:stream <streamIri> .          # both usually asserted in the sds:DataDescription named graph
<memberIri> <ex:someProp> "42"^^xsd:double .   # the member's own data, in the default/other graph(s)
\`\`\`

To read a value off a member with an \`rdf-lens\` path (see above), you generally do **not** need CBD
shape extraction - just filter out the \`sds:DataDescription\` graph's quads and pass the rest as
\`Cont.quads\`; \`pred()\`-based lenses filter by subject equality, so passing more quads than strictly
belong to one member is harmless. Reserve CBD extraction (\`extract-cbd-shape\`'s \`CBDShapeExtractor\`) for
when you must know exactly which quads *belong* to a member (e.g. re-serializing it standalone).
\`@treecg/types\` exports ready-made \`SDS\`/\`TREE\`/\`PROV\`/\`XSD\`/\`RDF\`/\`SHACL\` term namespaces
(\`SDS.terms.payload\`, \`SDS.terms.custom("DataDescription")\`, ...) - use those instead of hardcoding IRIs.

## 4. Testing

Don't assume a repo's \`main\`-branch test helpers exist in the npm version you installed (see section 0
above). Two
approaches that work either way:

1. **Direct logic test**: hand-roll a Reader/Writer pair - a few lines implementing
   \`strings(): AsyncIterable<string>\` and \`string()\`/\`close()\` collecting into an array - and drive
   \`init()\`/\`transform()\` directly. Decoupled from js-runner's gRPC plumbing entirely.
2. **Shape-parsing test**: parse your own \`processor.ttl\` plus a sample instance with \`n3\`, run
   \`rdf-lens\`'s \`extractShapes(quads, {}, { [RDFC.Reader]: empty(), [RDFC.Writer]: empty() })\` (matching
   what the real runner does), and \`.execute()\` the resulting lens to confirm your shape actually
   produces the args object you expect - this catches \`processor.ttl\` typos that a TS compiler can't.

## 5. Minimal project scaffold

Clone the shape of \`rdf-connect/template-processor-ts\` (fetch its \`package.json\`/\`tsconfig.json\` once
if you need exact fields, or use \`generate_pipeline_skeleton\`'s neighboring examples for style):

\`\`\`
package.json     # type: module, main: lib/index.js, files: [lib/**/*, processor.ttl]
tsconfig.json    # target/module ES2022, outDir lib
processor.ttl    # rdfc:jsImplementationOf rdfc:Processor + sh:NodeShape sh:targetClass <YourClass>
src/index.ts     # export class YourProcessor extends Processor<Args> { ... }
\`\`\`

\`processor.ttl\` needs, at minimum: \`rdfc:file <./lib/index.js>\`, \`rdfc:class "YourClassName"\`,
\`rdfc:entrypoint <./>\`, and a \`sh:NodeShape\` with \`sh:targetClass\` matching your processor's own IRI,
listing every constructor parameter as a \`sh:property\`.

## 6. Once it's written

Register it with the ecosystem (tag the repo \`rdfc-processor\` on GitHub) so a future \`list_components\`
call finds it instead of another agent re-deriving all of this.
`;
