export interface FetchedSignals {
  stars?: number
  downloads?: number
  lastReleaseAt?: string
  maintainer?: string
}

function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl)
    if (url.hostname !== 'github.com') return null
    const [owner, repo] = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
    if (!owner || !repo) return null
    return { owner, repo }
  } catch {
    return null
  }
}

export async function fetchGithubSignals(
  repoUrl: string,
  fetchImpl: typeof fetch,
  opts: { token?: string } = {},
): Promise<Pick<FetchedSignals, 'stars' | 'lastReleaseAt'>> {
  const parsed = parseGithubRepo(repoUrl)
  if (!parsed) return {}
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  const signals: Pick<FetchedSignals, 'stars' | 'lastReleaseAt'> = {}
  try {
    const repoRes = await fetchImpl(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers })
    if (repoRes.ok) {
      const body = (await repoRes.json()) as { stargazers_count?: number }
      if (typeof body.stargazers_count === 'number') signals.stars = body.stargazers_count
    }
  } catch {
    // signal fetch failures are non-fatal — the index still builds without this signal
  }
  try {
    const releasesRes = await fetchImpl(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases?per_page=1`,
      { headers },
    )
    if (releasesRes.ok) {
      const releases = (await releasesRes.json()) as Array<{ published_at?: string }>
      if (releases[0]?.published_at) signals.lastReleaseAt = releases[0].published_at
    }
  } catch {
    // non-fatal, see above
  }
  return signals
}

export async function fetchNpmSignals(
  packageName: string,
  fetchImpl: typeof fetch,
): Promise<Pick<FetchedSignals, 'downloads' | 'maintainer'>> {
  const signals: Pick<FetchedSignals, 'downloads' | 'maintainer'> = {}
  try {
    const downloadsRes = await fetchImpl(
      `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(packageName)}`,
    )
    if (downloadsRes.ok) {
      const body = (await downloadsRes.json()) as { downloads?: number }
      if (typeof body.downloads === 'number') signals.downloads = body.downloads
    }
  } catch {
    // non-fatal, see fetchGithubSignals
  }
  try {
    const metaRes = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`)
    if (metaRes.ok) {
      const body = (await metaRes.json()) as {
        maintainers?: Array<{ name: string }>
      }
      const maintainer = body.maintainers?.[0]?.name
      if (maintainer) signals.maintainer = maintainer
    }
  } catch {
    // non-fatal, see fetchGithubSignals
  }
  return signals
}

export async function fetchEntrySignals(
  entry: { repo: string },
  fetchImpl: typeof fetch,
  opts: { npmPackageName?: string; githubToken?: string } = {},
): Promise<FetchedSignals> {
  const [github, npm] = await Promise.all([
    fetchGithubSignals(entry.repo, fetchImpl, { token: opts.githubToken }),
    opts.npmPackageName ? fetchNpmSignals(opts.npmPackageName, fetchImpl) : Promise.resolve({}),
  ])
  return { ...github, ...npm }
}
