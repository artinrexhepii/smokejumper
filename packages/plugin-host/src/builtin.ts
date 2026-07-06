import { createAlertmanagerAlertSource } from '@smokejumper/plugin-alertmanager'
import { createCloudwatchTelemetrySource } from '@smokejumper/plugin-cloudwatch'
import { createDatadogTelemetrySource } from '@smokejumper/plugin-datadog'
import { createDockerTelemetrySource } from '@smokejumper/plugin-docker'
import { createGithubDeploysTelemetrySource } from '@smokejumper/plugin-github-deploys'
import { createGrafanaTelemetrySource } from '@smokejumper/plugin-grafana'
import { createHttpTelemetrySource } from '@smokejumper/plugin-http'
import { createKubernetesTelemetrySource } from '@smokejumper/plugin-kubernetes'
import { createLokiTelemetrySource } from '@smokejumper/plugin-loki'
import { createPagerdutyAlertSource, createPagerdutyNotificationSink } from '@smokejumper/plugin-pagerduty'
import { createPrometheusTelemetrySource } from '@smokejumper/plugin-prometheus'
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
  registry.register(createAlertmanagerAlertSource())
  registry.register(createLokiTelemetrySource())
  registry.register(createPrometheusTelemetrySource())
  registry.register(createDatadogTelemetrySource())
  registry.register(createPagerdutyAlertSource())
  registry.register(createPagerdutyNotificationSink())
  registry.register(createGrafanaTelemetrySource())
  return registry
}
