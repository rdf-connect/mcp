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

### Run standalone

```bash
npm start
```

### Register with an MCP client

Example for a client that reads a JSON config with a `mcpServers` map (Claude Code, Claude Desktop, etc.):

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

## Run with Docker

```bash
docker build -t rdfc-mcp-server .
```

MCP is stdio-based - the container's stdin/stdout *is* the transport, so it must be run with `-i`
(interactive) and **not** `-t` (a pty would corrupt the JSON-RPC stream). A named volume at `/data` keeps
the harvested catalog across container restarts; without it, every fresh container starts from an empty
cache and re-harvests in the background before it has anything to answer with.

```bash
docker run -i --rm -v rdfc-mcp-cache:/data -e GITHUB_TOKEN=ghp_... rdfc-mcp-server
```

Or via the included `docker-compose.yml` (reads `GITHUB_TOKEN` from your shell/`.env`):

```bash
docker compose run --rm rdfc-mcp
```

Register it with an MCP client the same way, just swap the command:

```json
{
  "mcpServers": {
    "rdfc": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "rdfc-mcp-cache:/data", "rdfc-mcp-server"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    }
  }
}
```

To prewarm the volume before first use (avoids the first client session waiting on a background
harvest):

```bash
docker run --rm -v rdfc-mcp-cache:/data --entrypoint node rdfc-mcp-server dist/harvest-cli.js
```

## Configuration

| Env var                        | Default                          | Purpose                                              |
|---------------------------------|-----------------------------------|-------------------------------------------------------|
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

## Notes / known limitations

- Harvesting hits the public GitHub Search + REST APIs; without `GITHUB_TOKEN` you'll likely hit the 60
  req/hour unauthenticated limit after one or two harvests.
- `generate_pipeline_skeleton` is a best-effort starting point (straight-line chaining by declared
  reader/writer parameters, TODO placeholders for other required params) - always review its output.
- Component parameter paths are assumed to live under the `rdfc:` namespace when generating skeleton
  triples; a processor using a custom vocabulary property will need manual correction.
