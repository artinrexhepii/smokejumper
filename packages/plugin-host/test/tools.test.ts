import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  createOrganization,
  createPluginInstance,
  createProject,
  createTestDb,
} from '@smokejumper/db'
import type { TelemetrySource, ToolResult } from '@smokejumper/plugin-sdk'
import { createFakeTelemetrySource } from '@smokejumper/plugin-sdk/testing'
import { createRegistry } from '../src/registry'
import { getInstanceTools } from '../src/tools'

const encryptionKey = Buffer.alloc(32, 1).toString('base64')

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} }

async function setup() {
  const db = await createTestDb()
  const org = await createOrganization(db, { name: 'Acme', slug: 'acme' })
  const project = await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' })
  return { db, project }
}

const runOpts = () => ({ incidentId: 'inc-1', signal: new AbortController().signal })

async function setupFakeTelemetry() {
  const { db, project } = await setup()
  const registry = createRegistry()
  registry.register(createFakeTelemetrySource())
  const instance = await createPluginInstance(db, {
    projectId: project.id,
    pluginId: 'fake-telemetry',
    kind: 'telemetry-source',
    name: 'Fake telemetry',
    config: { prefix: '>> ' },
    credentials: {},
    encryptionKey,
  })
  return { db, project, registry, instance }
}

describe('getInstanceTools', () => {
  it('namespaces tools and runs them with resolved config', async () => {
    const { db, project, registry, instance } = await setupFakeTelemetry()
    const tools = await getInstanceTools({ db, encryptionKey, registry, projectId: project.id })
    expect(tools).toHaveLength(1)
    const tool = tools[0]!
    expect(tool.name).toBe('fake-telemetry_echo')
    expect(tool.instanceId).toBe(instance.id)
    expect(tool.pluginId).toBe('fake-telemetry')
    expect(tool.costHint).toBe('cheap')
    const result = await tool.run({ text: 'hi' }, runOpts())
    expect(result.data).toBe('>> hi')
  })

  it('rejects input that fails the tool schema', async () => {
    const { db, project, registry } = await setupFakeTelemetry()
    const tools = await getInstanceTools({ db, encryptionKey, registry, projectId: project.id })
    await expect(tools[0]!.run({ text: 7 }, runOpts())).rejects.toThrow()
  })

  it('never surfaces non-read tools', async () => {
    const { db, project } = await setup()
    const writer: TelemetrySource<Record<string, never>> = {
      manifest: {
        id: 'writer',
        name: 'Writer',
        version: '0.1.0',
        sdkVersion: '0.1.0',
        kind: 'telemetry-source',
        description: 'Declares a non-read tool',
        configSchema: z.object({}),
      },
      async healthCheck() {
        return { ok: true }
      },
      tools() {
        return [
          {
            name: 'read_ok',
            description: 'Reads things',
            inputSchema: z.object({}),
            scope: 'read',
            costHint: 'cheap',
            latencyHintMs: 1,
            async execute() {
              return { summary: 'ok', data: null }
            },
          },
          {
            name: 'write_bad',
            description: 'Writes things',
            inputSchema: z.object({}),
            scope: 'write' as 'read',
            costHint: 'cheap',
            latencyHintMs: 1,
            async execute() {
              return { summary: 'no', data: null }
            },
          },
        ]
      },
    }
    const registry = createRegistry()
    registry.register(writer)
    await createPluginInstance(db, {
      projectId: project.id,
      pluginId: 'writer',
      kind: 'telemetry-source',
      name: 'Writer',
      config: {},
      credentials: {},
      encryptionKey,
    })
    const warnings: string[] = []
    const logger = {
      ...quietLogger,
      warn(msg: string) {
        warnings.push(msg)
      },
    }
    const tools = await getInstanceTools({ db, encryptionKey, registry, projectId: project.id, logger })
    expect(tools.map((t) => t.name)).toEqual(['writer_read_ok'])
    expect(warnings.some((w) => w.includes('write_bad'))).toBe(true)
  })

  it('aborts runs that exceed the tool timeout', async () => {
    const { db, project } = await setup()
    const hanging: TelemetrySource<Record<string, never>> = {
      manifest: {
        id: 'hanging',
        name: 'Hanging',
        version: '0.1.0',
        sdkVersion: '0.1.0',
        kind: 'telemetry-source',
        description: 'Never returns',
        configSchema: z.object({}),
      },
      async healthCheck() {
        return { ok: true }
      },
      tools() {
        return [
          {
            name: 'sleep_forever',
            description: 'Hangs forever',
            inputSchema: z.object({}),
            scope: 'read',
            costHint: 'cheap',
            latencyHintMs: 1,
            execute: () => new Promise<ToolResult>(() => {}),
          },
        ]
      },
    }
    const registry = createRegistry()
    registry.register(hanging)
    await createPluginInstance(db, {
      projectId: project.id,
      pluginId: 'hanging',
      kind: 'telemetry-source',
      name: 'Hanging',
      config: {},
      credentials: {},
      encryptionKey,
    })
    const tools = await getInstanceTools({
      db,
      encryptionKey,
      registry,
      projectId: project.id,
      toolTimeoutMs: 25,
    })
    await expect(tools[0]!.run({}, runOpts())).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('skips disabled instances', async () => {
    const { db, project, registry, instance } = await setupFakeTelemetry()
    await db.execute(sql`update plugin_instances set enabled = false where id = ${instance.id}`)
    const tools = await getInstanceTools({ db, encryptionKey, registry, projectId: project.id })
    expect(tools).toHaveLength(0)
  })
})
