import type { CitySource, FileRecord } from './types';
import { filterRecords } from './sources';

// --- GitHub ingestion --------------------------------------------------------
export const GITHUB_CONFIG = {
  apiBase: 'https://api.github.com',
} as const;

/** Error with a city-flavored message safe to show directly in the HUD. */
export class ScanError extends Error {}

const MSG_NOT_FOUND = "No city found at that address, or it's private.";
const MSG_RATE_LIMIT =
  "City hall is closed for an hour: GitHub's free limit. Drop a folder instead!";

/**
 * Accepts "owner/repo", "github.com/owner/repo", or a full URL (with optional
 * .git suffix or deeper path). Returns null when it can't parse.
 */
export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  let path = trimmed;
  const urlMatch = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(trimmed);
  if (urlMatch?.[1] !== undefined) path = urlMatch[1];
  const parts = path.split('/').filter((p) => p !== '');
  const owner = parts[0];
  let repo = parts[1];
  if (owner === undefined || repo === undefined) return null;
  repo = repo.replace(/\.git$/, '');
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { owner, repo };
}

interface TreeEntry {
  path?: string;
  type?: string;
  size?: number;
}

async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ScanError('The road to GitHub is washed out (network error). Try again?');
  }
  if (res.status === 404) throw new ScanError(MSG_NOT_FOUND);
  if (res.status === 403 || res.status === 429) throw new ScanError(MSG_RATE_LIMIT);
  if (!res.ok) throw new ScanError(`GitHub answered with a ${res.status}. Try again later.`);
  return res.json() as Promise<unknown>;
}

/**
 * Fetches the full file listing of a public repo via the free tree API.
 * Names and sizes only — the free tree endpoint has no history or contents,
 * so nothing downstream may pretend otherwise (HONESTY RULE).
 */
export async function scanGitHub(input: string): Promise<CitySource> {
  const parsed = parseRepoInput(input);
  if (!parsed) {
    throw new ScanError('Give me an address like "owner/repo" or a GitHub URL.');
  }
  const { owner, repo } = parsed;

  const repoInfo = await fetchJson(`${GITHUB_CONFIG.apiBase}/repos/${owner}/${repo}`);
  const branch =
    typeof repoInfo === 'object' &&
    repoInfo !== null &&
    'default_branch' in repoInfo &&
    typeof repoInfo.default_branch === 'string'
      ? repoInfo.default_branch
      : 'main';

  const tree = await fetchJson(
    `${GITHUB_CONFIG.apiBase}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  if (typeof tree !== 'object' || tree === null || !('tree' in tree)) {
    throw new ScanError('GitHub sent back something unreadable. Try again later.');
  }
  const entries = (tree as { tree: TreeEntry[]; truncated?: boolean }).tree;
  const truncated = (tree as { truncated?: boolean }).truncated === true;

  const files: FileRecord[] = [];
  for (const e of entries) {
    if (e.type !== 'blob' || typeof e.path !== 'string') continue;
    files.push({ path: e.path, size: typeof e.size === 'number' ? e.size : 0 });
  }

  return {
    files: filterRecords(files),
    displayName: `${owner}/${repo}`,
    sourceType: 'github',
    branch,
    ownerRepo: `${owner}/${repo}`,
    truncated,
  };
}
