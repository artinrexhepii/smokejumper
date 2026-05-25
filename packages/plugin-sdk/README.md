# @smokejumper/plugin-sdk

Contracts for building Smokejumper plugins: alert sources, telemetry sources,
context sources, notification sinks, and (reserved) action sinks.

Plugins are stateless objects. Configuration and host capabilities (fetch,
logger, abort signal) are injected per call — plugins never store credentials.

- `AlertSource` — verify and normalize incoming alert webhooks
- `TelemetrySource` — expose read-only investigation tools to the agent
- `ContextSource` — surface runbooks and prior-incident context
- `NotificationSink` — deliver incident events to chat/email/webhooks
- `ActionSink` — remediation interface, not loaded by hosts yet

Use the conformance helpers in your plugin's tests:

```ts
import { checkAlertSource } from '@smokejumper/plugin-sdk'

const result = await checkAlertSource(mySource, fixtures)
expect(result.failures).toEqual([])
```

Test fakes live in `@smokejumper/plugin-sdk/testing`.
