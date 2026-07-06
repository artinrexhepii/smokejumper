import { createCloudwatchTelemetrySource } from '@smokejumper/plugin-cloudwatch'
import { createDockerTelemetrySource } from '@smokejumper/plugin-docker'
import { createGithubDeploysTelemetrySource } from '@smokejumper/plugin-github-deploys'
import { createHttpTelemetrySource } from '@smokejumper/plugin-http'
import { createKubernetesTelemetrySource } from '@smokejumper/plugin-kubernetes'
import { createSentryAlertSource } from '@smokejumper/plugin-sentry'
import { createSlackNotificationSink } from '@smokejumper/plugin-slack'
import { createWebhookAlertSource } from '@smokejumper/plugin-webhook'
import { createRegistry, type PluginRegistry } from './registry'

export function createBuiltinRegistry(): PluginRegistry {
  const registry = createRegistry()
  registry.register(createWebhookAlertSource())
  registry.register(createSentryAlertSource())
  registry.register(createDockerTelemetrySource())
  registry.register(createHttpTelemetrySource())
  registry.register(createGithubDeploysTelemetrySource())
  registry.register(createSlackNotificationSink())
  registry.register(createCloudwatchTelemetrySource())
  registry.register(createKubernetesTelemetrySource())
  return registry
}
