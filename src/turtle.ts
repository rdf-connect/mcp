import { rdfDereferencer } from "rdf-dereference";
import { RdfStore } from "rdf-stores";
import { streamifyArray } from "streamify-array";
import { rdfSerializer } from "rdf-serialize";
import stringifyStream from "stream-to-string";
import type * as RDF from "@rdfjs/types";

/** Dereference and parse a turtle document at `url` into an RdfStore. Returns an empty store on failure. */
export async function parseTurtleUrl(url: string): Promise<RdfStore> {
  const store = RdfStore.createDefault();
  try {
    const dereferenced = await rdfDereferencer.dereference(url, { localFiles: url.startsWith(".") || url.startsWith("/") });
    await new Promise((resolve, reject) => {
      store.import(dereferenced.data).on("end", resolve).on("error", reject);
    });
  } catch {
    // Not every .ttl file is valid/reachable turtle; skip it.
  }
  return store;
}

export async function serializeQuads(quads: RDF.Quad[]): Promise<string> {
  const quadStream = streamifyArray(quads);
  const textStream = rdfSerializer.serialize(quadStream, { contentType: "text/turtle" });
  return await stringifyStream(textStream);
}
