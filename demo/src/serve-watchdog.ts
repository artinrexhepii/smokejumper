import { startWatchdog } from './watchdog'

const ingestUrl =
  process.env.SMOKEJUMPER_INGEST_URL ??
  'http://localhost:3400/ingest/00000000-0000-4000-8000-000000000001'

startWatchdog({
  targets: [
    { name: 'shop-api', url: process.env.SHOP_API_URL ?? 'http://localhost:3401', syntheticPath: '/products' },
    { name: 'worker', url: process.env.WORKER_URL ?? 'http://localhost:3402' },
  ],
  ingestUrl,
  token: process.env.SMOKEJUMPER_WEBHOOK_TOKEN ?? 'demo-token',
})
console.log(`watchdog polling every 5s, alerting to ${ingestUrl}`)
