# rdfc-mcp-server

An MCP server that keeps a live catalog of the [RDF-Connect](https://rdf-connect.github.io) ecosystem
(processors, runners, orchestrators and example pipelines), harvested periodically from GitHub the same
way [rdf-connect.github.io](https://github.com/rdf-connect/rdf-connect.github.io) does (`github.data.ts`:
searching repos tagged `rdfc-processor` / `rdfc-runner` / `rdfc-orchestrator` / `rdfc-pipeline` /
`rdf-connect`, then parsing their `.ttl` files for SHACL-described components), and exposes it to coding
agents as MCP tools so they can discover and wire up existing processors instead of guessing.

## What it does differently from the website

- Runs standalone (no VitePress), on a schedule, with the result cached to disk so a restart doesn't need
  to re-harvest before answering.
- Extracts each processor/runner/orchestrator's SHACL parameter shape (required vs. optional properties,
  datatypes, classes) into a structured form instead of just linking to the repo.
- Best-effort resolves the installable package name (npm `package.json` / PyPI `pyproject.toml`) so
  generated `owl:imports` paths are closer to correct.
- Adds a `generate_pipeline_skeleton` tool that drafts a wired-up `pipeline.ttl` (imports, channels,
  `consistsOf`, processor stubs) from a list of chosen processors.

## Setup

```bash
npm install
npm run build
```

Optionally set a GitHub token to avoid low unauthenticated rate limits (the harvester makes dozens of
GitHub API calls per run):

```bash
export GITHUB_TOKEN=ghp_...
```

## Transports

The server supports two MCP transports, and picks one at startup based on whether `MCP_HTTP_PORT` is set:

- **stdio** (default) - one process per client, talks JSON-RPC over stdin/stdout. What `npm start` and
  most local MCP client configs (Claude Code, Claude Desktop) use.
- **HTTP** (set `MCP_HTTP_PORT`) - the [Streamable HTTP](https://modelcontextprotocol.io) transport, with
  stateful sessions (one `McpServer` per session, tracked by the `mcp-session-id` header). This is what
  you want to deploy remotely - e.g. on a VPC, behind nginx or another reverse proxy that terminates TLS.
  Besides `/mcp`, the HTTP server also serves a plain-HTML status page at `/` (live catalog stats plus the
  client config snippet to copy) and a JSON health check at `/healthz`.

### Run standalone (stdio)

```bash
npm start
```

```json
{
  "mcpServers": {
    "rdfc": {
      "command": "node",
      "args": ["/absolute/path/to/rdfc-mcp/server/dist/index.js"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    }
  }
}
```

### Run standalone (HTTP)

```bash
MCP_HTTP_PORT=3001 npm start
```

Then open `http://localhost:3001/` for the status page, or point an MCP client that supports remote/HTTP
servers at the URL:

```json
{
  "mcpServers": {
    "rdfc": {
      "url": "https://rdfc-mcp.internal.example.com/mcp"
    }
  }
}
```

The HTTP server itself has no authentication or TLS - it's meant to sit behind a reverse proxy (nginx,
etc.) on the same host or a private network that handles both. Don't expose `MCP_HTTP_PORT` directly to
the public internet.

## Run with Docker

```bash
docker build -t rdfc-mcp-server .
```

The image defaults to the HTTP transport on port 3001 (`ENV MCP_HTTP_PORT=3001`), meant to be reverse-proxied
by nginx (or similar) running alongside it:

```bash
docker run -d --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -v rdfc-mcp-cache:/data \
  -e GITHUB_TOKEN=ghp_... \
  rdfc-mcp-server
```

Binding to `127.0.0.1` keeps the unauthenticated HTTP port off the network entirely; point nginx's
`proxy_pass` at `http://127.0.0.1:3001/mcp` and let it handle TLS/public exposure. Or via the included
`docker-compose.yml` (reads `GITHUB_TOKEN`/etc. from your shell/`.env`), which does the same thing:

```bash
docker compose up -d
```

A named volume at `/data` keeps the harvested catalog across container restarts/redeploys; without it,
every fresh container starts from an empty cache and serves nothing useful until the first background
harvest finishes. Prewarm it before first use with:

```bash
docker run --rm -v rdfc-mcp-cache:/data --entrypoint node rdfc-mcp-server dist/harvest-cli.js
```

If you'd rather run the container as a plain stdio server for a single local client instead, unset
`MCP_HTTP_PORT` and run with `-i` (not `-t`, which would corrupt the JSON-RPC stream over a pty):

```bash
docker run -i --rm -v rdfc-mcp-cache:/data -e MCP_HTTP_PORT= -e GITHUB_TOKEN=ghp_... rdfc-mcp-server
```

## Configuration

| Env var                        | Default                          | Purpose                                              |
|---------------------------------|-----------------------------------|-------------------------------------------------------|
| `MCP_HTTP_PORT`                 | unset (`3001` in the Docker image) | Set to serve HTTP (`/mcp`, `/`, `/healthz`) on this port instead of stdio. |
| `GITHUB_TOKEN`                  | none                              | Auth token for GitHub API calls (raises rate limits). |
| `RDFC_MCP_REFRESH_INTERVAL_MS`  | `21600000` (6h)                   | How often to re-harvest GitHub in the background.     |
| `RDFC_MCP_CACHE_DIR`            | `~/.cache/rdfc-mcp` (`/data` in the Docker image) | Where `catalog.json` is cached between restarts. |

On startup the server immediately serves whatever is in the disk cache (if any) while a fresh harvest
runs in the background if the cache is missing or older than the refresh interval; it then re-harvests on
that interval for as long as the process stays alive. There is deliberately no agent-facing tool to force a
refresh (it's slow and burns GitHub rate limit) - as an operator, prewarm or force-refresh the cache with
`npm run harvest`, a one-off CLI that runs the same harvester.

## MCP surface

**Resources**
- `rdfc://guide` - short primer on RDF-Connect concepts and the recommended tool workflow.
- `rdfc://authoring-guide` - **JS/TS only.** For when nothing in the catalog fits and you have to write a
  new processor targeting `rdfc:NodeRunner`. The tools/catalog only index `.ttl` metadata; this covers the
  runtime APIs that metadata can't: the `Processor<T>` lifecycle (`@rdfc/js-runner`), how a `processor.ttl`
  SHACL shape becomes your constructor args (including `rdfl:PathLens`, the mechanism behind "extract a
  value at a configured SHACL path" parameters), the SDS message convention, and a testing/scaffold
  checklist. RDF-Connect processors aren't JS/TS-only though - for `rdfc:PyRunner`/`rdfc:JvmRunner` targets
  there's no dedicated guide yet; use `get_component` on `TemplateProcessorPy`/`TestProcessor` instead.
- `rdfc://catalog` - the full harvested catalog as JSON.
- `rdfc://shapes` - the aggregated SHACL shapes graph (Turtle) for `rdfc:Pipeline` plus every discovered
  processor.

**Tools**
- `list_components` - list/search processors, runners, orchestrators, pipeline examples, and other tagged
  repos (filter by `kind`, `language`, `query`).
- `get_component` - full detail on one component: parameters, source repo, package name, raw repo turtle.
- `get_pipeline_examples` - real `pipeline.ttl` files found in the ecosystem, for reference.
- `get_shapes_graph` - the aggregated SHACL shapes graph.
- `generate_pipeline_skeleton` - draft a `pipeline.ttl` wiring the given processors together.
- `catalog_status` - freshness/counts/last error, for checking whether it's safe to trust the data yet
  (read-only - see `npm run harvest` above to force a refresh).

**Prompts**
- `build_pipeline` - seeds a conversation with the primer plus a goal, pointing the agent at the tool
  workflow above.
- `write_processor` - seeds a conversation with a goal and a `language` (`js` default, or `python`/`java`).
  For `js` it includes the full authoring guide; for `python`/`java` it instead points at that runner's
  template processor repo, since no dedicated guide exists for those yet.

**HTTP-only routes** (when `MCP_HTTP_PORT` is set - not part of the MCP protocol itself)
- `GET /` - plain HTML status page: live catalog stats, the MCP client config snippet, and a table of
  available tools.
- `GET /healthz` - JSON liveness/status check for load balancers and container orchestration.

## Notes / known limitations

- Harvesting hits the public GitHub Search + REST APIs; without `GITHUB_TOKEN` you'll likely hit the 60
  req/hour unauthenticated limit after one or two harvests.
- `generate_pipeline_skeleton` is a best-effort starting point (straight-line chaining by declared
  reader/writer parameters, TODO placeholders for other required params) - always review its output.
- Component parameter paths are assumed to live under the `rdfc:` namespace when generating skeleton
  triples; a processor using a custom vocabulary property will need manual correction.
- The HTTP transport uses stateful sessions kept in memory (`Map<sessionId, transport>`) - if you run
  multiple replicas behind a load balancer, it needs to be session-affine (sticky) on `mcp-session-id`, or
  every replica must share the same in-memory state (they currently don't).
- Request bodies over 4MB on the HTTP transport are rejected (`413`) to bound memory use per request.
