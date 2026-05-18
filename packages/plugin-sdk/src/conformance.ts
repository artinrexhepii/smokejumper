import { z } from 'zod'
import { normalizedAlertSchema } from './alert'
import type { SinkContext, SourceContext } from './context'
import type { AlertSource, AlertSourceRequest, NotificationSink, TelemetrySource } from './contracts'
import { pluginManifestSchema, type PluginKind, type PluginManifest } from './manifest'

export interface ConformanceResult {
  pass: boolean
  failures: string[]
}

export function checkManifest(manifest: PluginManifest, expectedKind: PluginKind): string[] {
  const failures: string[] = []
  const parsed = pluginManifestSchema.safeParse(manifest)
  if (!parsed.success) {
    failures.push(`manifest invalid: ${parsed.error.message}`)
    return failures
  }
  if (manifest.kind !== expectedKind) {
    failures.push(`manifest kind is "${manifest.kind}", expected "${expectedKind}"`)
  }
  return failures
}

export interface AlertSourceFixtures<TConfig> {
  config: TConfig
  validRequest: AlertSourceRequest
  invalidRequest: AlertSourceRequest
  samplePayloads: unknown[]
}

export async function checkAlertSource<TConfig>(
  source: AlertSource<TConfig>,
  fixtures: AlertSourceFixtures<TConfig>,
): Promise<ConformanceResult> {
  const failures = checkManifest(source.manifest, 'alert-source')
  if (!(await source.verify(fixtures.validRequest, fixtures.config))) {
    failures.push('verify() rejected the valid request fixture')
  }
  if (await source.verify(fixtures.invalidRequest, fixtures.config)) {
    failures.push('verify() accepted the invalid request fixture')
  }
  for (const [i, payload] of fixtures.samplePayloads.entries()) {
    try {
      const out = source.normalize(payload, fixtures.config)
      const alerts = Array.isArray(out) ? out : [out]
      for (const alert of alerts) {
        const parsed = normalizedAlertSchema.safeParse(alert)
        if (!parsed.success) {
          failures.push(`payload ${i}: normalize() output failed validation: ${parsed.error.message}`)
        }
      }
    } catch (err) {
      failures.push(`payload ${i}: normalize() threw: ${String(err)}`)
    }
  }
  return { pass: failures.length === 0, failures }
}

export async function checkTelemetrySource<TConfig>(
  source: TelemetrySource<TConfig>,
  ctx: SourceContext<TConfig>,
): Promise<ConformanceResult> {
  const failures = checkManifest(source.manifest, 'telemetry-source')
  const tools = source.tools()
  if (tools.length === 0) {
    failures.push('tools() returned no tools')
  }
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name)) failures.push(`duplicate tool name "${tool.name}"`)
    names.add(tool.name)
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) failures.push(`tool name "${tool.name}" must be snake_case`)
    if (tool.scope !== 'read') failures.push(`tool "${tool.name}" scope must be "read"`)
    if (tool.latencyHintMs <= 0) failures.push(`tool "${tool.name}" latencyHintMs must be positive`)
    if (!(tool.inputSchema instanceof z.ZodType)) failures.push(`tool "${tool.name}" inputSchema must be a zod schema`)
  }
  try {
    const health = await source.healthCheck(ctx)
    if (typeof health.ok !== 'boolean') failures.push('healthCheck() must return { ok: boolean }')
  } catch (err) {
    failures.push(`healthCheck() threw: ${String(err)}`)
  }
  return { pass: failures.length === 0, failures }
}

export async function checkNotificationSink<TConfig>(
  sink: NotificationSink<TConfig>,
  ctx: SinkContext<TConfig>,
): Promise<ConformanceResult> {
  const failures = checkManifest(sink.manifest, 'notification-sink')
  try {
    const receipt = await sink.notify(
      {
        type: 'incident.opened',
        incidentId: 'conformance-incident',
        projectId: ctx.projectId,
        occurredAt: new Date().toISOString(),
        payload: {},
      },
      { title: 'Conformance check', markdown: 'conformance check event' },
      ctx,
    )
    if (typeof receipt.delivered !== 'boolean') {
      failures.push('notify() must return { delivered: boolean }')
    }
  } catch (err) {
    failures.push(`notify() threw: ${String(err)}`)
  }
  return { pass: failures.length === 0, failures }
}
