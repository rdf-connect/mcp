#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { CatalogStore } from "./catalogStore.js";
import { createMcpServer } from "./server.js";
import { startHttpServer } from "./httpServer.js";

const store = new CatalogStore();

async function main() {
  await store.init();

  const httpPort = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : undefined;
  if (httpPort) {
    startHttpServer(store, { port: httpPort });
  } else {
    const mcpServer = createMcpServer(store);
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
  }
}

main().catch((err) => {
  console.error("Fatal error starting rdfc-mcp-server:", err);
  process.exit(1);
});
