import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestContext } from '@smokejumper/plugin-sdk/testing'
import { createKubernetesTelemetrySource, type KubernetesConfig } from '../src/index'

const run = describe.skipIf(!process.env.SMOKEJUMPER_INTEGRATION || !process.env.KUBECONFIG)

run('kubernetes adapter against a live cluster', () => {
  const source = createKubernetesTelemetrySource()
  let config: KubernetesConfig

  beforeAll(() => {
    const kubeconfig = Buffer.from(readFileSync(process.env.KUBECONFIG as string, 'utf8'), 'utf8').toString('base64')
    config = { namespace: 'kube-system', kubeconfig }
  })

  it('reports healthy', async () => {
    const health = await source.healthCheck(createTestContext<KubernetesConfig>(config))
    expect(health.ok).toBe(true)
  })

  it('lists pods in kube-system', async () => {
    const tool = source.tools().find((t) => t.name === 'list_pods')!
    const ctx = { ...createTestContext<KubernetesConfig>(config), incidentId: 'inc-int' }
    const result = await tool.execute(tool.inputSchema.parse({}), ctx)
    expect((result.data as unknown[]).length).toBeGreaterThan(0)
  })
})
