import { createShopApi } from './shop-api'

const port = Number(process.env.PORT ?? 3401)
const app = createShopApi({
  workerUrl: process.env.WORKER_URL ?? 'http://localhost:3402',
  selfTraffic: true,
})
await app.listen({ port, host: '0.0.0.0' })
console.log(`shop-api listening on :${port}`)
