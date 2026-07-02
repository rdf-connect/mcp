import { DataFactory } from "rdf-data-factory";
import type * as RDF from "@rdfjs/types";

export const DF = new DataFactory();

export const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  sh: "http://www.w3.org/ns/shacl#",
  dcterms: "http://purl.org/dc/terms/",
  rdfc: "https://w3id.org/rdf-connect#",
  owl: "http://www.w3.org/2002/07/owl#",
};

export const P = {
  type: DF.namedNode(NS.rdf + "type"),
  label: DF.namedNode(NS.rdfs + "label"),
  comment: DF.namedNode(NS.rdfs + "comment"),
  subClassOf: DF.namedNode(NS.rdfs + "subClassOf"),
  title: DF.namedNode(NS.dcterms + "title"),
  description: DF.namedNode(NS.dcterms + "description"),

  shTargetClass: DF.namedNode(NS.sh + "targetClass"),
  shProperty: DF.namedNode(NS.sh + "property"),
  shPath: DF.namedNode(NS.sh + "path"),
  shName: DF.namedNode(NS.sh + "name"),
  shDescription: DF.namedNode(NS.sh + "description"),
  shDatatype: DF.namedNode(NS.sh + "datatype"),
  shClass: DF.namedNode(NS.sh + "class"),
  shMinCount: DF.namedNode(NS.sh + "minCount"),
  shMaxCount: DF.namedNode(NS.sh + "maxCount"),
  shNodeKind: DF.namedNode(NS.sh + "nodeKind"),
  shDefaultValue: DF.namedNode(NS.sh + "defaultValue"),
  shNodeShape: DF.namedNode(NS.sh + "NodeShape"),

  rdfcProcessor: DF.namedNode(NS.rdfc + "Processor"),
  rdfcRunner: DF.namedNode(NS.rdfc + "Runner"),
  rdfcOrchestrator: DF.namedNode(NS.rdfc + "Orchestrator"),
  rdfcPipeline: DF.namedNode(NS.rdfc + "Pipeline"),
  rdfcReader: DF.namedNode(NS.rdfc + "Reader"),
  rdfcWriter: DF.namedNode(NS.rdfc + "Writer"),
  rdfcJsImplOf: DF.namedNode(NS.rdfc + "jsImplementationOf"),
  rdfcPyImplOf: DF.namedNode(NS.rdfc + "pyImplementationOf"),
  rdfcJavaImplOf: DF.namedNode(NS.rdfc + "javaImplementationOf"),
  rdfcFile: DF.namedNode(NS.rdfc + "file"),
  rdfcClass: DF.namedNode(NS.rdfc + "class"),
  rdfcEntrypoint: DF.namedNode(NS.rdfc + "entrypoint"),
  rdfcJar: DF.namedNode(NS.rdfc + "jar"),
};

export function shortId(iri: string): string {
  return iri.split(/[/#]/).pop() || iri;
}

export function firstLiteral(
  quads: RDF.Quad[],
  subject: RDF.Term,
  predicate: RDF.NamedNode,
): string | undefined {
  return quads.find((q) => q.subject.equals(subject) && q.predicate.equals(predicate))
    ?.object.value;
}

export function allObjects(
  quads: RDF.Quad[],
  subject: RDF.Term,
  predicate: RDF.NamedNode,
): RDF.Term[] {
  return quads
    .filter((q) => q.subject.equals(subject) && q.predicate.equals(predicate))
    .map((q) => q.object);
}
