import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createOrganization,
  createPluginInstance,
  createProject,
  createTestDb,
} from '@smokejumper/db'
import type { IncidentEvent, NotificationSink } from '@smokejumper/plugin-sdk'
import { createFakeNotificationSink } from '@smokejumper/plugin-sdk/testing'
import { startNotificationDispatcher, type Delivery } from '../src/dispatcher'
import { createRegistry } from '../src/registry'

const encryptionKey = Buffer.alloc(32, 1).toString('base64')

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} }

function createTestBus() {
  const handlers = new Set<(event: IncidentEvent) => void>()
  return {
    publish(event: IncidentEvent) {
      for (const handler of handlers) handler(event)
    },
    subscribe(handler: (event: IncidentEvent) => void) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}

async function setup() {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, project }
}

function diagnosisEvent(projectId: string): IncidentEvent {
  return {
    type: 'diagnosis.ready',
    incidentId: 'inc-1',
    projectId,
    occurredAt: '2026-07-04T10:00:00.000Z',
    payload: { rootCause: 'OOM in worker', confidence: 0.85 },
  }
}

function collectDeliveries(expected: number) {
  const deliveries: Delivery[] = []
  let resolveDone: (() => void) | undefined
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  return {
    deliveries,
    done,
    onDelivered(delivery: Delivery) {
      deliveries.push(delivery)
      if (deliveries.length >= expected) resolveDone?.()
    },
  }
}

async function createSinkInstance(db: Awaited<ReturnType<typeof setup>>['db'], projectId: string, pluginId: string) {
  return createPluginInstance(db, {
    projectId,
    pluginId,
    kind: 'notification-sink',
    name: pluginId,
    config: {},
    credentials: {},
    encryptionKey,
  })
}

describe('startNotificationDispatcher', () => {
  it('renders and delivers events to enabled sinks', async () => {
    const { db, project } = await setup()
    const sink = createFakeNotificationSink()
    const registry = createRegistry()
    registry.register(sink)
    await createSinkInstance(db, project.id, 'fake-sink')
    const bus = createTestBus()
    const collector = collectDeliveries(1)
    const stop = startNotificationDispatcher({
      db,
      encryptionKey,
      registry,
      bus,
      logger: quietLogger,
      onDelivered: collector.onDelivered,
    })
    bus.publish(diagnosisEvent(project.id))
    await collector.done
    stop()
    expect(sink.deliveries).toHaveLength(1)
    expect(sink.deliveries[0]!.rendering.title).toBe('Diagnosis ready')
    expect(sink.deliveries[0]!.rendering.markdown).toContain('OOM in worker')
    expect(collector.deliveries[0]!.receipt.delivered).toBe(true)
  })

  it('contains sink failures and still delivers to other sinks', async () => {
    const { db, project } = await setup()
    const sink = createFakeNotificationSink()
    const failing: NotificationSink<Record<string, never>> = {
      manifest: {
        id: 'failing-sink',
        name: 'Failing Sink',
        version: '0.1.0',
        sdkVersion: '0.1.0',
        kind: 'notification-sink',
        description: 'Always throws',
        configSchema: z.object({}),
      },
      async notify() {
        throw new Error('boom')
      },
    }
    const registry = createRegistry()
    registry.register(failing)
    registry.register(sink)
    await createSinkInstance(db, project.id, 'failing-sink')
    await createSinkInstance(db, project.id, 'fake-sink')
    const bus = createTestBus()
    const collector = collectDeliveries(2)
    const stop = startNotificationDispatcher({
      db,
      encryptionKey,
      registry,
      bus,
      logger: quietLogger,
      onDelivered: collector.onDelivered,
    })
    bus.publish(diagnosisEvent(project.id))
    await collector.done
    stop()
    const byPlugin = new Map(collector.deliveries.map((d) => [d.pluginId, d.receipt]))
    expect(byPlugin.get('failing-sink')).toEqual({ delivered: false, error: 'boom' })
    expect(byPlugin.get('fake-sink')!.delivered).toBe(true)
    expect(sink.deliveries).toHaveLength(1)
  })

  it('stops delivering after stop() is called', async () => {
    const { db, project } = await setup()
    const sink = createFakeNotificationSink()
    const registry = createRegistry()
    registry.register(sink)
    await createSinkInstance(db, project.id, 'fake-sink')
    const bus = createTestBus()
    const stop = startNotificationDispatcher({ db, encryptionKey, registry, bus, logger: quietLogger })
    stop()
    bus.publish(diagnosisEvent(project.id))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(sink.deliveries).toHaveLength(0)
  })
})
