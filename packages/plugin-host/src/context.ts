import type { PluginLogger, SinkContext, SourceContext } from '@smokejumper/plugin-sdk'

export interface CreateContextOptions<TConfig> {
  pluginId: string
  projectId: string
  config: TConfig
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  logger?: PluginLogger
}

export function createPluginLogger(pluginId: string): PluginLogger {
  const prefix = `[plugin:${pluginId}]`
  return {
    debug: (msg) => console.debug(`${prefix} ${msg}`),
    info: (msg) => console.info(`${prefix} ${msg}`),
    warn: (msg) => console.warn(`${prefix} ${msg}`),
    error: (msg) => console.error(`${prefix} ${msg}`),
  }
}

function bindFetch(fetchImpl: typeof fetch, signal: AbortSignal): typeof fetch {
  return (input, init) => {
    const merged = init?.signal ? AbortSignal.any([signal, init.signal]) : signal
    return fetchImpl(input, { ...init, signal: merged })
  }
}

export function createSourceContext<TConfig>(opts: CreateContextOptions<TConfig>): SourceContext<TConfig> {
  const signal = opts.signal ?? new AbortController().signal
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  return {
    projectId: opts.projectId,
    config: opts.config,
    signal,
    fetch: bindFetch(fetchImpl, signal),
    logger: opts.logger ?? createPluginLogger(opts.pluginId),
  }
}

export function createSinkContext<TConfig>(opts: CreateContextOptions<TConfig>): SinkContext<TConfig> {
  return createSourceContext(opts)
}
