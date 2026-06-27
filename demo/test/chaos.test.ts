import { describe, expect, it } from 'vitest'
import { runChaos, SCENARIOS } from '../src/chaos'

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Error) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const out = handler(url, init)
    if (out instanceof Error) throw out
    return out
  }) as typeof fetch
  return { impl, calls }
}

describe('runChaos', () => {
  it('POSTs the scenario and tells the user what to watch', async () => {
    const logs: string[] = []
    const { impl, calls } = fakeFetch(() => new Response('{"injected":"error-storm"}', { status: 200 }))
    const code = await runChaos('error-storm', {
      shopApiUrl: 'http://shop',
      fetchImpl: impl,
      log: (m) => logs.push(m),
    })
    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://shop/chaos/error-storm')
    expect(calls[0]!.init?.method).toBe('POST')
    const output = logs.join('\n')
    expect(output).toContain(SCENARIOS['error-storm'])
    expect(output).toContain('http://localhost:3000')
  })

  it('maps reset to /chaos/reset', async () => {
    const { impl, calls } = fakeFetch(() => new Response('{"reset":true}', { status: 200 }))
    const code = await runChaos('reset', { shopApiUrl: 'http://shop', fetchImpl: impl, log: () => {} })
    expect(code).toBe(0)
    expect(calls[0]!.url).toBe('http://shop/chaos/reset')
  })

  it('prints usage for a missing or unknown scenario', async () => {
    const logs: string[] = []
    const { impl, calls } = fakeFetch(() => new Response('{}', { status: 200 }))
    expect(await runChaos(undefined, { fetchImpl: impl, log: (m) => logs.push(m) })).toBe(1)
    expect(await runChaos('blizzard', { fetchImpl: impl, log: (m) => logs.push(m) })).toBe(1)
    expect(calls).toHaveLength(0)
    expect(logs.join('\n')).toContain('usage')
  })

  it('hints at the compose command when shop-api is unreachable', async () => {
    const logs: string[] = []
    const { impl } = fakeFetch(() => new Error('ECONNREFUSED'))
    const code = await runChaos('latency', { shopApiUrl: 'http://shop', fetchImpl: impl, log: (m) => logs.push(m) })
    expect(code).toBe(1)
    const output = logs.join('\n')
    expect(output).toContain('is the demo stack up?')
    expect(output).toContain('docker compose -f docker-compose.yml -f demo/docker-compose.yml up')
  })
})
