import { z } from 'zod'
import type { NotificationSink } from '@smokejumper/plugin-sdk'

export const slackConfigSchema = z.object({
  botToken: z.string().min(1),
  channel: z.string().min(1),
})

export type SlackConfig = z.infer<typeof slackConfigSchema>

export function toMrkdwn(markdown: string): string {
  return markdown.replace(/\*\*(.+?)\*\*/g, '*$1*')
}

export function createSlackNotificationSink(): NotificationSink<SlackConfig> {
  return {
    manifest: {
      id: 'slack',
      name: 'Slack',
      version: '0.1.0',
      sdkVersion: '0.1.0',
      kind: 'notification-sink',
      description: 'Posts incident events to a Slack channel via chat.postMessage',
      configSchema: slackConfigSchema,
    },
    async notify(_event, rendering, ctx) {
      try {
        const res = await ctx.fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          signal: ctx.signal,
          headers: {
            authorization: `Bearer ${ctx.config.botToken}`,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            channel: ctx.config.channel,
            text: `${rendering.title}\n${toMrkdwn(rendering.markdown)}`,
          }),
        })
        const body = (await res.json()) as { ok: boolean; ts?: string; error?: string }
        if (!body.ok) {
          return { delivered: false, error: body.error ?? `slack returned http ${res.status}` }
        }
        return { delivered: true, externalId: body.ts }
      } catch (err) {
        return { delivered: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
