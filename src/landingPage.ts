import type { CatalogStore } from "./catalogStore.js";
import { TOOL_SUMMARIES } from "./server.js";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderLandingPage(store: CatalogStore, mcpUrl: string, authRequired: boolean): string {
  const catalog = store.get();
  const counts = { processor: 0, runner: 0, orchestrator: 0, pipelineExamples: 0 };
  for (const repo of catalog?.repositories ?? []) {
    counts.pipelineExamples += repo.pipelineExamples.length;
    for (const c of repo.components) counts[c.type]++;
  }

  const statusLine = catalog
    ? `Harvested ${esc(catalog.harvestedAt)} from ${catalog.repositories.length} repositories.`
    : store.isRefreshing()
      ? "First harvest is running in the background - check back in a minute."
      : "No catalog harvested yet.";

  const config = JSON.stringify(
    {
      mcpServers: {
        rdfc: {
          url: mcpUrl,
          ...(authRequired ? { headers: { Authorization: "Bearer <token>" } } : {}),
        },
      },
    },
    null,
    2,
  );

  const toolRows = TOOL_SUMMARIES.map(
    (t) => `<tr><td><code>${esc(t.name)}</code></td><td>${esc(t.summary)}</td></tr>`,
  ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rdfc-mcp-server</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; line-height: 1.55; }
  h1 { margin-bottom: 0.2rem; }
  .sub { color: #767676; margin-top: 0; }
  .stats { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1.5rem 0; }
  .stat { border: 1px solid #8884; border-radius: 8px; padding: 0.6rem 1rem; min-width: 6rem; }
  .stat b { display: block; font-size: 1.4rem; }
  pre { background: #8882; border-radius: 8px; padding: 1rem; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  td { border-top: 1px solid #8884; padding: 0.4rem 0.6rem; vertical-align: top; }
  td:first-child { white-space: nowrap; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  footer { margin-top: 2.5rem; font-size: 0.85rem; color: #767676; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>rdfc-mcp-server</h1>
<p class="sub">Live MCP catalog of the <a href="https://rdf-connect.github.io">RDF-Connect</a> ecosystem, harvested from GitHub.</p>

<p>${statusLine}</p>

<div class="stats">
  <div class="stat"><b>${counts.processor}</b>processors</div>
  <div class="stat"><b>${counts.runner}</b>runners</div>
  <div class="stat"><b>${counts.orchestrator}</b>orchestrators</div>
  <div class="stat"><b>${counts.pipelineExamples}</b>pipeline examples</div>
</div>

<h2>Connect an MCP client</h2>
<p>Point an MCP-compatible client (Claude Code, Claude Desktop, etc.) at <code>${esc(mcpUrl)}</code>${authRequired ? ", authenticated with a bearer token" : ""}:</p>
<pre>${esc(config)}</pre>

<h2>Available tools</h2>
<table>
<tbody>
${toolRows}
</tbody>
</table>

<footer>
  <a href="/healthz">/healthz</a> for liveness checks.
</footer>
</body>
</html>
`;
}
