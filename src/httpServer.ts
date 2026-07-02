import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { CatalogStore } from "./catalogStore.js";
import { createMcpServer } from "./server.js";
import { renderLandingPage } from "./landingPage.js";

// Bounds memory use from a single request; generous enough for any pipeline.ttl-sized MCP payload.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

class PayloadTooLargeError extends Error {}

/**
 * Reads and JSON-parses the request body. Rejects (rather than throwing synchronously) on
 * malformed JSON or an oversized body - callers MUST catch this, since an uncaught rejection
 * inside an async request handler is an unhandled rejection that crashes the whole process.
 */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new PayloadTooLargeError("Request body too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0" as const, error: { code, message }, id: null };
}

export interface HttpServerOptions {
  port: number;
}

/**
 * Serves the MCP server over the Streamable HTTP transport with stateful sessions (one
 * McpServer per session, keyed by the mcp-session-id header) at POST/GET/DELETE /mcp, a plain
 * HTML status page at /, and a JSON health check at /healthz. Intended to sit behind a reverse
 * proxy (nginx, etc.) that terminates TLS and forwards to this port.
 */
export function startHttpServer(store: CatalogStore, options: HttpServerOptions): void {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const body = await readBody(req);

    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.handleRequest(req, res, body);
      return;
    }

    // New session — only allow on initialize requests.
    const isInit = Array.isArray(body)
      ? body.some((m: { method?: string }) => m.method === "initialize")
      : (body as { method?: string } | undefined)?.method === "initialize";

    if (!isInit) {
      sendJson(res, 400, jsonRpcError(-32600, "Bad Request: no session"));
      return;
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    const mcpServer = createMcpServer(store);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  const httpServer = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/healthz") {
          const catalog = store.get();
          sendJson(res, 200, {
            ok: true,
            harvestedAt: catalog?.harvestedAt ?? null,
            isRefreshing: store.isRefreshing(),
          });
          return;
        }

        if (url.pathname === "/mcp") {
          await handleMcp(req, res);
          return;
        }

        if (url.pathname === "/" && req.method === "GET") {
          const mcpUrl = `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host ?? `localhost:${options.port}`}/mcp`;
          const html = renderLandingPage(store, mcpUrl, false);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        }

        sendJson(res, 404, jsonRpcError(-32601, "Not found"));
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendJson(res, 413, jsonRpcError(-32600, err.message));
          return;
        }
        console.error("Error handling request:", err);
        if (!res.headersSent) {
          sendJson(res, 400, jsonRpcError(-32700, "Parse error: invalid JSON body"));
        } else if (!res.writableEnded) {
          res.end();
        }
      }
    })();
  });

  httpServer.listen(options.port, () => {
    console.error(
      `rdfc-mcp-server listening on http://0.0.0.0:${options.port}/ (info page), /mcp (MCP), /healthz (health)`,
    );
  });
}
