import { expect, it } from 'vitest'
import * as sdk from '../src/index'

it('exposes the public surface', () => {
  expect(sdk.SDK_VERSION).toBe('0.2.0')
  expect(sdk.pluginManifestSchema).toBeDefined()
  expect(sdk.normalizedAlertSchema).toBeDefined()
  expect(sdk.severitySchema).toBeDefined()
  expect(sdk.checkAlertSource).toBeTypeOf('function')
  expect(sdk.checkTelemetrySource).toBeTypeOf('function')
  expect(sdk.checkNotificationSink).toBeTypeOf('function')
  expect(sdk.checkManifest).toBeTypeOf('function')
  expect(sdk.describeConfig).toBeTypeOf('function')
})
