import { pathToFileURL } from 'node:url'

export const SCENARIOS: Record<string, string> = {
  'error-storm': '/products now returns HTTP 500s. Watch the error rate climb, the watchdog alert, and Smokejumper open an incident.',
  'dependency-outage': "shop-api's calls to the worker now hang past the 500ms timeout; /products returns 502s.",
  latency: '/products now takes 2-5 seconds per request. Health degrades on latency, not errors.',
  oom: 'shop-api now leaks 10MB every 500ms until the container hits its 256MB limit, gets OOM-killed, and restarts.',
  reset: 'Clears every injected failure. The shop recovers within a few polls.',
}

export interface RunChaosOptions {
  shopApiUrl?: string
  dashboardUrl?: string
  fetchImpl?: typeof fetch
  log?: (msg: string) => void
}

export async function runChaos(scenario: string | undefined, opts: RunChaosOptions = {}): Promise<number> {
  const log = opts.log ?? ((msg: string) => console.log(msg))
  const shopApiUrl = opts.shopApiUrl ?? process.env.SHOP_API_URL ?? 'http://localhost:3401'
  const dashboardUrl = opts.dashboardUrl ?? 'http://localhost:3000'
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch

  if (!scenario || !(scenario in SCENARIOS)) {
    log(`usage: pnpm chaos <${Object.keys(SCENARIOS).join('|')}>`)
    return 1
  }

  const path = scenario === 'reset' ? '/chaos/reset' : `/chaos/${scenario}`
  try {
    const res = await fetchImpl(`${shopApiUrl}${path}`, { method: 'POST' })
    if (!res.ok) {
      log(`shop-api rejected the request: HTTP ${res.status}`)
      return 1
    }
  } catch {
    log(`could not reach shop-api at ${shopApiUrl} — is the demo stack up?`)
    log('start it with: docker compose -f docker-compose.yml -f demo/docker-compose.yml up -d --build')
    return 1
  }

  log(scenario === 'reset' ? 'chaos cleared.' : `injected: ${scenario}`)
  log(SCENARIOS[scenario]!)
  if (scenario !== 'reset') {
    log(`watch the investigation live: ${dashboardUrl} (admin@example.com / smokejumper)`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runChaos(process.argv[2])
}
