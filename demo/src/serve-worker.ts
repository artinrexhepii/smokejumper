import { createWorker } from './worker'

const port = Number(process.env.PORT ?? 3402)
const app = createWorker()
await app.listen({ port, host: '0.0.0.0' })
console.log(`worker listening on :${port}`)
