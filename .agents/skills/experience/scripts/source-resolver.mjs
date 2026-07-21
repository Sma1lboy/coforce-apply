import { execFileSync } from 'node:child_process';

const normalizeAuthors = values => [...new Set(
  (Array.isArray(values) ? values : [values])
    .map(value => String(value || '').trim())
    .filter(Boolean)
)].sort((a, b) => a.localeCompare(b));

const cleanRepo = (owner, name) => {
  const repoName = String(name || '').replace(/\.git$/i, '');
  if (!owner || !repoName || !/^[^/\s]+$/.test(owner) || !/^[^/\s]+$/.test(repoName)) {
    throw new Error('Expected a GitHub repository, pull-request, or commit URL');
  }
  return `${owner}/${repoName}`;
};

export function parseGitHubUrl(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('A GitHub repository, pull-request, or commit URL is required');

  const ssh = input.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { repo: cleanRepo(ssh[1], ssh[2]), kind: 'repository' };

  let parts;
  if (/^https?:\/\//i.test(input)) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error(`Invalid GitHub URL: ${input}`);
    }
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
      throw new Error(`Only github.com URLs are supported: ${input}`);
    }
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } else {
    const shorthand = input.replace(/^github\.com\//i, '').replace(/^\/+|\/+$/g, '');
    parts = shorthand.split('/').filter(Boolean).map(decodeURIComponent);
  }

  if (parts.length < 2) throw new Error(`Invalid GitHub source: ${input}`);
  const repo = cleanRepo(parts[0], parts[1]);
  if (parts.length === 2) return { repo, kind: 'repository' };
  if (parts[2] === 'pull' && /^\d+$/.test(parts[3] || '')) {
    return { repo, kind: 'pull_request', id: parts[3] };
  }
  if (parts[2] === 'commit' && parts[3]) {
    return { repo, kind: 'commit', id: parts[3] };
  }
  throw new Error(`Unsupported GitHub source URL: ${input}. Paste a repository, pull-request, or commit URL.`);
}

const githubApi = (endpoint, { ghBinary, runner }) => {
  let output;
  try {
    output = runner(ghBinary, ['api', endpoint], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(`Could not resolve GitHub source via gh api (${endpoint}): ${detail}. Run gh auth login and retry.`);
  }
  try {
    return JSON.parse(String(output));
  } catch {
    throw new Error(`gh api returned invalid JSON for ${endpoint}`);
  }
};

export function resolveSourceUrl(value, {
  authors = [],
  ghBinary = 'gh',
  runner = execFileSync,
} = {}) {
  const parsed = parseGitHubUrl(value);
  const explicitAuthors = normalizeAuthors(authors);
  if (explicitAuthors.length) {
    return { ...parsed, authors: explicitAuthors, detectedFrom: 'explicit' };
  }

  const viewer = () => {
    const login = githubApi('user', { ghBinary, runner })?.login;
    if (!login) throw new Error('Authenticated GitHub user has no login; run gh auth login and retry');
    return login;
  };

  let author;
  let detectedFrom;
  if (parsed.kind === 'pull_request') {
    author = githubApi(`repos/${parsed.repo}/pulls/${parsed.id}`, { ghBinary, runner })?.user?.login;
    detectedFrom = 'pull_request';
  } else if (parsed.kind === 'commit') {
    author = githubApi(`repos/${parsed.repo}/commits/${parsed.id}`, { ghBinary, runner })?.author?.login;
    detectedFrom = author ? 'commit' : 'authenticated_user';
  } else {
    detectedFrom = 'authenticated_user';
  }

  return {
    ...parsed,
    authors: [author || viewer()],
    detectedFrom,
  };
}
