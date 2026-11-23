import type { GitHubRepoSummary } from '../src/types.ts';

export interface ScrapedWebsiteData {
  url: string;
  title: string;
  description: string;
  ogImage: string | null;
  themeColor: string | null;
  headings: string[];
  bodyExcerpt: string;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function scrapeWebsite(rawUrl: string): Promise<ScrapedWebsiteData> {
  let normalizedUrl = rawUrl.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error('Please enter a valid website URL (for example, https://stripe.com).');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CadenceStudioBot/1.0; +https://cadencestudio.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new Error(`Website responded with HTTP ${res.status}.`);
    }

    const html = await res.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescMatch =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i) ||
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i);

    const ogImageMatch =
      html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:image["'][^>]*>/i);

    const themeColorMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']*)["'][^>]*>/i);

    const headings: string[] = [];
    const headingRegex = /<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 10) {
      const cleanH = decodeHtmlEntities(hMatch[1].replace(/<[^>]+>/g, ' '));
      if (cleanH.length > 3 && cleanH.length < 160) {
        headings.push(cleanH);
      }
    }

    const strippedBody = decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    );

    let resolvedOgImage: string | null = null;
    if (ogImageMatch?.[1]) {
      try {
        resolvedOgImage = new URL(ogImageMatch[1], parsedUrl.origin).toString();
      } catch {
        resolvedOgImage = null;
      }
    }

    return {
      url: parsedUrl.toString(),
      title: decodeHtmlEntities(titleMatch?.[1] || parsedUrl.hostname),
      description: decodeHtmlEntities(metaDescMatch?.[1] || ''),
      ogImage: resolvedOgImage,
      themeColor: themeColorMatch?.[1] || null,
      headings,
      bodyExcerpt: strippedBody.slice(0, 3500),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getGitHubHeaders(optionalToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CadenceStudio-AdCreator',
  };
  const token = optionalToken?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchGitHubRepos(usernameOrOrg: string, token?: string): Promise<GitHubRepoSummary[]> {
  const cleanUser = usernameOrOrg.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/.*$/, '');
  if (!cleanUser) {
    throw new Error('Enter a GitHub username or organization name.');
  }

  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(cleanUser)}/repos?sort=updated&per_page=12`,
    { headers: getGitHubHeaders(token) }
  );

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`GitHub account "${cleanUser}" was not found.`);
    }
    if (res.status === 403) {
      throw new Error('GitHub API rate limit reached. Provide an optional GitHub token or try again shortly.');
    }
    throw new Error(`GitHub API returned HTTP ${res.status}.`);
  }

  const data = (await res.json()) as GitHubRepoSummary[];
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    description: r.description,
    language: r.language,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    topics: Array.isArray(r.topics) ? r.topics : [],
    homepage: r.homepage,
    html_url: r.html_url,
    updated_at: r.updated_at,
  }));
}

export async function fetchGitHubRepoDetail(ownerRepo: string, token?: string): Promise<{
  repo: GitHubRepoSummary;
  readme: string;
  languages: string[];
  latestRelease: string | null;
}> {
  const cleaned = ownerRepo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const parts = cleaned.split('/');
  if (parts.length < 2) {
    throw new Error('Specify a repository as "owner/repo" (for example, vercel/next.js).');
  }
  const fullName = `${parts[0]}/${parts[1]}`;
  const headers = getGitHubHeaders(token);

  const [repoRes, readmeRes, langRes, releaseRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${fullName}`, { headers }),
    fetch(`https://api.github.com/repos/${fullName}/readme`, { headers }),
    fetch(`https://api.github.com/repos/${fullName}/languages`, { headers }),
    fetch(`https://api.github.com/repos/${fullName}/releases/latest`, { headers }),
  ]);

  if (!repoRes.ok) {
    throw new Error(`Repository "${fullName}" could not be loaded (HTTP ${repoRes.status}).`);
  }

  const repo = (await repoRes.json()) as GitHubRepoSummary;

  let readme = '';
  if (readmeRes.ok) {
    const readmeJson = (await readmeRes.json()) as { content?: string; encoding?: string };
    if (readmeJson.content && readmeJson.encoding === 'base64') {
      readme = Buffer.from(readmeJson.content, 'base64')
        .toString('utf8')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);
    }
  }

  let languages: string[] = [];
  if (langRes.ok) {
    const langObj = (await langRes.json()) as Record<string, number>;
    languages = Object.keys(langObj).slice(0, 6);
  }

  let latestRelease: string | null = null;
  if (releaseRes.ok) {
    const rel = (await releaseRes.json()) as { tag_name?: string; name?: string; body?: string };
    latestRelease = `${rel.tag_name || ''} ${rel.name || ''}: ${(rel.body || '').slice(0, 400)}`.trim();
  }

  return { repo, readme, languages, latestRelease };
}
