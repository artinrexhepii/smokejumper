import { z } from 'zod'
import { severitySchema } from './alert'
import type { SourceContext } from './context'
import type {
  AlertSource,
  IncidentEvent,
  NotificationSink,
  Rendering,
  TelemetrySource,
} from './contracts'

export function createTestContext<TConfig>(config: TConfig, projectId = 'proj-test'): SourceContext<TConfig> {
  return {
    projectId,
    config,
    fetch: globalThis.fetch,
    signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  }
}

const fakePayloadSchema = z.object({
  message: z.string(),
  level: severitySchema,
  service: z.string(),
  key: z.string(),
})

export function createFakeAlertSource(): AlertSource<{ token: string }> {
  return {
    manifest: {
      id: 'fake-alerts',
      name: 'Fake Alert Source',
      version: '0.1.0',
      sdkVersion: '0.1.0',
      kind: 'alert-source',
      description: 'In-memory alert source for tests',
      configSchema: z.object({ token: z.string() }),
    },
    async verify(req, config) {
      return req.headers['x-smokejumper-token'] === config.token
    },
    normalize(payload) {
      const p = fakePayloadSchema.parse(payload)
      return {
        title: p.message,
        severity: p.level,
        service: p.service,
        labels: {},
        dedupKey: p.key,
        occurredAt: new Date().toISOString(),
        raw: payload,
      }
    },
  }
}

export function createFakeTelemetrySource(): TelemetrySource<{ prefix: string }> {
  return {
    manifest: {
      id: 'fake-telemetry',
      name: 'Fake Telemetry Source',
      version: '0.1.0',
      sdkVersion: '0.1.0',
      kind: 'telemetry-source',
      description: 'In-memory telemetry source for tests',
      configSchema: z.object({ prefix: z.string() }),
    },
    async healthCheck() {
      return { ok: true }
    },
    tools() {
      return [
        {
          name: 'echo',
          description: 'Echoes back the provided text',
          inputSchema: z.object({ text: z.string() }),
          scope: 'read',
          costHint: 'cheap',
          latencyHintMs: 1,
          async execute(input, ctx) {
            const { text } = input as { text: string }
            return { summary: 'echoed', data: `${ctx.config.prefix}${text}` }
          },
        },
      ]
    },
  }
}

export interface FakeNotificationSink extends NotificationSink<Record<string, never>> {
  deliveries: Array<{ event: IncidentEvent; rendering: Rendering }>
}

export function createFakeNotificationSink(): FakeNotificationSink {
  const deliveries: Array<{ event: IncidentEvent; rendering: Rendering }> = []
  return {
    deliveries,
    manifest: {
      id: 'fake-sink',
      name: 'Fake Notification Sink',
      version: '0.1.0',
      sdkVersion: '0.1.0',
      kind: 'notification-sink',
      description: 'In-memory notification sink for tests',
      configSchema: z.object({}),
    },
    async notify(event, rendering) {
      deliveries.push({ event, rendering })
      return { delivered: true, externalId: `fake-${deliveries.length}` }
    },
  }
}
