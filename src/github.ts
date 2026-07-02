const GITHUB_API = "https://api.github.com";

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rdfc-mcp-server",
  };
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

async function ghFetch(url: string): Promise<any> {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

export interface RepoSummary {
  name: string; // owner/repo
  url: string;
  description: string | null;
  branch: string;
  topics: string[];
}

/**
 * Search repositories tagged with the given topic. Mirrors the logic used by
 * rdf-connect.github.io/github.data.ts: forks are only kept if their upstream
 * repository is not already present in the result set.
 */
export async function fetchRepositoriesByTopic(topic: string): Promise<RepoSummary[]> {
  const url = `${GITHUB_API}/search/repositories?q=fork:true+topic:${encodeURIComponent(topic)}&per_page=100`;
  const data = await ghFetch(url);
  const items: any[] = data.items ?? [];

  const results = await Promise.all(
    items.map(async (item) => {
      if (item.fork) {
        try {
          const repo = await ghFetch(item.url);
          if (items.some((upstream) => upstream.full_name === repo.parent?.full_name)) {
            return null;
          }
        } catch {
          // If we can't resolve the parent, keep the fork rather than silently drop it.
        }
      }
      return item;
    }),
  );

  return results
    .filter((item): item is any => item !== null)
    .map((item) => ({
      name: item.full_name,
      url: item.html_url,
      description: item.description,
      branch: item.default_branch,
      topics: item.topics ?? [],
    }));
}

export interface RepoTreeFile {
  path: string;
}

export async function fetchRepoTurtleFiles(repo: RepoSummary): Promise<RepoTreeFile[]> {
  const url = `${GITHUB_API}/repos/${repo.name}/git/trees/${repo.branch}?recursive=1`;
  const data = await ghFetch(url);
  const tree: any[] = data.tree ?? [];
  return tree
    .filter((f) => f.path.endsWith(".ttl") && !f.path.toLowerCase().includes("test"))
    .map((f) => ({ path: f.path }));
}

export function rawUrl(repo: RepoSummary, path: string): string {
  return `https://raw.githubusercontent.com/${repo.name}/${repo.branch}/${path}`;
}

/** Best-effort fetch of the raw text content of a file; returns undefined on any failure. */
export async function tryFetchRawText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

/** Best-effort detection of the published package name for a repo (npm for js, PyPI for python). */
export async function detectPackageName(
  repo: RepoSummary,
  language: "js" | "python" | "java",
): Promise<string | undefined> {
  try {
    if (language === "js") {
      const text = await tryFetchRawText(rawUrl(repo, "package.json"));
      if (!text) return undefined;
      const pkg = JSON.parse(text);
      return pkg.name;
    }
    if (language === "python") {
      const text = await tryFetchRawText(rawUrl(repo, "pyproject.toml"));
      if (!text) return undefined;
      const match = text.match(/^\s*name\s*=\s*"([^"]+)"/m);
      return match?.[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}
