export interface PluginLogger {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface HostCapabilities {
  fetch: typeof fetch
  signal: AbortSignal
  logger: PluginLogger
}

export interface SourceContext<TConfig = unknown> extends HostCapabilities {
  projectId: string
  config: TConfig
}

export interface SinkContext<TConfig = unknown> extends HostCapabilities {
  projectId: string
  config: TConfig
}
