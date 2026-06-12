import type { z } from 'zod'

export class InstanceNotFoundError extends Error {
  constructor(readonly instanceId: string) {
    super(`plugin instance not found: ${instanceId}`)
    this.name = 'InstanceNotFoundError'
  }
}

export class UnknownPluginError extends Error {
  constructor(readonly pluginId: string) {
    super(`no registered plugin with id "${pluginId}"`)
    this.name = 'UnknownPluginError'
  }
}

export class PluginConfigError extends Error {
  constructor(
    readonly pluginId: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(
      `invalid config for plugin "${pluginId}": ${issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
    )
    this.name = 'PluginConfigError'
  }
}
