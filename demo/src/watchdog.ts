export interface WatchdogTarget {
  name: string
  url: string
  syntheticPath?: string
}

export interface WatchdogConfig {
  targets: WatchdogTarget[]
  ingestUrl: string
  token: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  log?: (msg: string) => void
}

export interface WatchdogState {
  down: Set<string>
}

export function createWatchdogState(): WatchdogState {
  return { down: new Set() }
}

type Probe =
  | { status: 'healthy' }
  | { status: 'unhealthy'; detail: string }
  | { status: 'unreachable'; detail: string }

async function probe(
  target: WatchdogTarget,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Probe> {
  if (target.syntheticPath) {
    // synthetic traffic feeding the target's outcome-derived health; failures here are the symptom, not an error
    try {
      await fetchImpl(`${target.url}${target.syntheticPath}`, { signal: AbortSignal.timeout(timeoutMs * 4) })
    } catch {
      // the health probe below decides what to report
    }
  }
  try {
    const res = await fetchImpl(`${target.url}/healthz`, { signal: AbortSignal.timeout(timeoutMs) })
    const body = (await res.json().catch(() => undefined)) as { ok?: boolean; failing?: string[] } | undefined
    if (res.ok && body?.ok) return { status: 'healthy' }
    const detail = body?.failing?.length ? body.failing.join('; ') : `healthz returned status ${res.status}`
    return { status: 'unhealthy', detail }
  } catch (err) {
    return { status: 'unreachable', detail: (err as Error).message }
  }
}

export async function pollOnce(config: WatchdogConfig, state: WatchdogState): Promise<{ alertsSent: number }> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch
  const timeoutMs = config.timeoutMs ?? 2000
  const log = config.log ?? ((msg: string) => console.log(msg))
  let alertsSent = 0

  for (const target of config.targets) {
    const result = await probe(target, fetchImpl, timeoutMs)

    if (result.status === 'healthy') {
      if (state.down.has(target.name)) {
        state.down.delete(target.name)
        log(`${target.name} recovered`)
      }
      continue
    }

    if (!state.down.has(target.name)) {
      log(`${target.name} ${result.status}: ${result.detail}`)
      state.down.add(target.name)
    }

    const alert = {
      title: `${target.name} ${result.status}: ${result.detail}`,
      severity: result.status === 'unreachable' ? 'critical' : 'high',
      service: target.name,
      labels: { env: 'demo' },
      dedupKey: `${target.name}-health`,
    }

    try {
      const res = await fetchImpl(config.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-smokejumper-token': config.token,
        },
        body: JSON.stringify(alert),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) {
        alertsSent++
      } else {
        log(`ingest rejected alert for ${target.name}: status ${res.status}`)
      }
    } catch (err) {
      log(`ingest unreachable while alerting for ${target.name}: ${(err as Error).message}`)
    }
  }

  return { alertsSent }
}

export function startWatchdog(config: WatchdogConfig, intervalMs = 5000): () => void {
  const state = createWatchdogState()
  const timer = setInterval(() => {
    void pollOnce(config, state)
  }, intervalMs)
  return () => clearInterval(timer)
}
