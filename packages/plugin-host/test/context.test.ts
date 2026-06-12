import { describe, expect, it, vi } from 'vitest'
import { createPluginLogger, createSinkContext, createSourceContext } from '../src/context'

describe('createSourceContext', () => {
  it('exposes project id and config', () => {
    const ctx = createSourceContext({
      pluginId: 'docker',
      projectId: 'proj-1',
      config: { host: 'http://docker.test' },
    })
    expect(ctx.projectId).toBe('proj-1')
    expect(ctx.config).toEqual({ host: 'http://docker.test' })
    expect(ctx.signal.aborted).toBe(false)
  })

  it('prefixes the default logger with the plugin id', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = createSourceContext({ pluginId: 'docker', projectId: 'proj-1', config: {} })
    ctx.logger.warn('container list slow')
    expect(spy).toHaveBeenCalledWith('[plugin:docker] container list slow')
    spy.mockRestore()
  })

  it('binds the context signal into every fetch call', async () => {
    const captured: AbortSignal[] = []
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(init?.signal as AbortSignal)
      return new Response('ok')
    }) as typeof fetch
    const controller = new AbortController()
    const ctx = createSourceContext({
      pluginId: 'docker',
      projectId: 'proj-1',
      config: {},
      signal: controller.signal,
      fetchImpl,
    })
    await ctx.fetch('http://docker.test/_ping')
    expect(captured[0]).toBeInstanceOf(AbortSignal)
    expect(captured[0]!.aborted).toBe(false)
    controller.abort()
    expect(captured[0]!.aborted).toBe(true)
  })

  it('merges per-call signals with the context signal', async () => {
    const captured: AbortSignal[] = []
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(init?.signal as AbortSignal)
      return new Response('ok')
    }) as typeof fetch
    const contextController = new AbortController()
    const ctx = createSourceContext({
      pluginId: 'docker',
      projectId: 'proj-1',
      config: {},
      signal: contextController.signal,
      fetchImpl,
    })
    const callController = new AbortController()
    await ctx.fetch('http://docker.test/slow', { signal: callController.signal })
    callController.abort()
    expect(captured[0]!.aborted).toBe(true)

    await ctx.fetch('http://docker.test/other')
    expect(captured[1]!.aborted).toBe(false)
    contextController.abort()
    expect(captured[1]!.aborted).toBe(true)
  })

  it('uses a custom logger when provided', () => {
    const messages: string[] = []
    const logger = {
      debug() {},
      info(msg: string) {
        messages.push(msg)
      },
      warn() {},
      error() {},
    }
    const ctx = createSourceContext({ pluginId: 'docker', projectId: 'proj-1', config: {}, logger })
    ctx.logger.info('hello')
    expect(messages).toEqual(['hello'])
  })
})

describe('createSinkContext', () => {
  it('produces the same context shape for sinks', () => {
    const ctx = createSinkContext({ pluginId: 'slack', projectId: 'proj-1', config: { channel: '#incidents' } })
    expect(ctx.projectId).toBe('proj-1')
    expect(ctx.config).toEqual({ channel: '#incidents' })
    expect(typeof ctx.fetch).toBe('function')
  })
})

describe('createPluginLogger', () => {
  it('prefixes all levels', () => {
    const spies = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    }
    const logger = createPluginLogger('sentry')
    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')
    expect(spies.debug).toHaveBeenCalledWith('[plugin:sentry] a')
    expect(spies.info).toHaveBeenCalledWith('[plugin:sentry] b')
    expect(spies.warn).toHaveBeenCalledWith('[plugin:sentry] c')
    expect(spies.error).toHaveBeenCalledWith('[plugin:sentry] d')
    Object.values(spies).forEach((spy) => spy.mockRestore())
  })
})
