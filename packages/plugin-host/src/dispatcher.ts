import { listPluginInstances, type Db } from '@smokejumper/db'
import type { DeliveryReceipt, IncidentEvent, PluginLogger } from '@smokejumper/plugin-sdk'
import { createPluginLogger, createSinkContext } from './context'
import type { PluginRegistry } from './registry'
import { renderEvent } from './render'
import { resolveInstance } from './resolve'

export interface NotificationBus {
  subscribe(fn: (event: IncidentEvent) => void): () => void
}

export interface Delivery {
  event: IncidentEvent
  instanceId: string
  pluginId: string
  receipt: DeliveryReceipt
}

export interface DispatcherOptions {
  db: Db
  encryptionKey: string
  registry: PluginRegistry
  bus: NotificationBus
  logger?: PluginLogger
  onDelivered?: (delivery: Delivery) => void
}

export function startNotificationDispatcher(opts: DispatcherOptions): () => void {
  const logger = opts.logger ?? createPluginLogger('host')

  async function dispatch(event: IncidentEvent): Promise<void> {
    let instances
    try {
      instances = await listPluginInstances(opts.db, event.projectId, 'notification-sink')
    } catch (err) {
      logger.error(`failed to list notification sinks for project ${event.projectId}: ${String(err)}`)
      return
    }
    const rendering = renderEvent(event)
    for (const instance of instances) {
      if (!instance.enabled) continue
      const sink = opts.registry.notificationSink(instance.pluginId)
      if (!sink) {
        logger.warn(`instance ${instance.id}: no registered notification sink "${instance.pluginId}", skipping`)
        continue
      }
      let receipt: DeliveryReceipt
      try {
        const { config } = await resolveInstance({
          db: opts.db,
          encryptionKey: opts.encryptionKey,
          registry: opts.registry,
          instanceId: instance.id,
        })
        const ctx = createSinkContext({ pluginId: instance.pluginId, projectId: event.projectId, config })
        receipt = await sink.notify(event, rendering, ctx)
      } catch (err) {
        receipt = { delivered: false, error: err instanceof Error ? err.message : String(err) }
      }
      if (!receipt.delivered) {
        logger.error(`delivery to instance ${instance.id} (${instance.pluginId}) failed: ${receipt.error ?? 'unknown error'}`)
      }
      opts.onDelivered?.({ event, instanceId: instance.id, pluginId: instance.pluginId, receipt })
    }
  }

  return opts.bus.subscribe((event) => {
    void dispatch(event)
  })
}
