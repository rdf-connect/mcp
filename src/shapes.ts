import type { RdfStore } from "rdf-stores";
import type * as RDF from "@rdfjs/types";
import { NS, P, shortId } from "./rdf.js";
import type { ComponentType, ParameterShape } from "./types.js";

function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Extract the sh:property parameter list for every sh:NodeShape targeting `term`. */
function extractParameters(store: RdfStore, term: RDF.Term): ParameterShape[] {
  const shapes = store.getQuads(null, P.shTargetClass, term).map((q) => q.subject);
  const params: ParameterShape[] = [];
  for (const shape of shapes) {
    const propertyNodes = store.getQuads(shape, P.shProperty, null).map((q) => q.object);
    for (const p of propertyNodes) {
      const path = store.getQuads(p, P.shPath, null)[0]?.object.value;
      if (!path) continue;
      params.push({
        path,
        name: store.getQuads(p, P.shName, null)[0]?.object.value ?? shortId(path),
        description: store.getQuads(p, P.shDescription, null)[0]?.object.value,
        datatype: store.getQuads(p, P.shDatatype, null)[0]?.object.value,
        class: store.getQuads(p, P.shClass, null)[0]?.object.value,
        minCount: toInt(store.getQuads(p, P.shMinCount, null)[0]?.object.value),
        maxCount: toInt(store.getQuads(p, P.shMaxCount, null)[0]?.object.value),
        nodeKind: store.getQuads(p, P.shNodeKind, null)[0]?.object.value,
        defaultValue: store.getQuads(p, P.shDefaultValue, null)[0]?.object.value,
      });
    }
  }
  return params;
}

const IMPLEMENTATION_PREDICATES: [RDF.NamedNode, "js" | "python" | "java"][] = [
  [P.rdfcJsImplOf, "js"],
  [P.rdfcPyImplOf, "python"],
  [P.rdfcJavaImplOf, "java"],
];

export interface DiscoveredComponent {
  term: RDF.Term;
  type: ComponentType;
  language?: "js" | "python" | "java";
  parameters: ParameterShape[];
  entrypoint?: string;
  className?: string;
}

/** Find every processor/runner/orchestrator defined in `store` and derive its parameter shape. */
export function discoverComponents(store: RdfStore): DiscoveredComponent[] {
  const found = new Map<string, DiscoveredComponent>();

  for (const [predicate, language] of IMPLEMENTATION_PREDICATES) {
    for (const quad of store.getQuads(null, predicate, P.rdfcProcessor)) {
      const term = quad.subject;
      const entrypoint =
        store.getQuads(term, P.rdfcFile, null)[0]?.object.value ??
        store.getQuads(term, P.rdfcJar, null)[0]?.object.value;
      found.set(term.value, {
        term,
        type: "processor",
        language,
        parameters: extractParameters(store, term),
        entrypoint,
        className: store.getQuads(term, P.rdfcClass, null)[0]?.object.value,
      });
    }
  }

  for (const quad of store.getQuads(null, P.type, P.rdfcRunner)) {
    found.set(quad.subject.value, {
      term: quad.subject,
      type: "runner",
      parameters: extractParameters(store, quad.subject),
    });
  }
  for (const quad of store.getQuads(null, P.subClassOf, P.rdfcRunner)) {
    if (!found.has(quad.subject.value)) {
      found.set(quad.subject.value, {
        term: quad.subject,
        type: "runner",
        parameters: extractParameters(store, quad.subject),
      });
    }
  }
  for (const quad of store.getQuads(null, P.type, P.rdfcOrchestrator)) {
    found.set(quad.subject.value, {
      term: quad.subject,
      type: "orchestrator",
      parameters: extractParameters(store, quad.subject),
    });
  }

  return [...found.values()];
}

export function labelOf(store: RdfStore, term: RDF.Term): string {
  return (
    store.getQuads(term, P.label, null)[0]?.object.value ??
    store.getQuads(term, P.title, null)[0]?.object.value ??
    shortId(term.value)
  );
}

export function descriptionOf(store: RdfStore, term: RDF.Term): string {
  return (
    store.getQuads(term, P.comment, null)[0]?.object.value ??
    store.getQuads(term, P.description, null)[0]?.object.value ??
    ""
  );
}

/** True if `store` contains at least one rdfc:Pipeline instance. */
export function definesPipeline(store: RdfStore): boolean {
  return store.getQuads(null, P.type, P.rdfcPipeline).length > 0;
}
