import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createApp } from './app.ts'
import { Store } from './store.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const folder = join(root, 'data')
mkdirSync(folder, { recursive: true })
const store = new Store(process.env.QORNET_DB ?? join(folder, 'qornet.sqlite'))
const port = Number(process.env.QORNET_PORT ?? 4174)
const server = createApp(store, join(root, 'dist')).listen(port, '127.0.0.1', () => {
  console.log(`QORNET: http://127.0.0.1:${port}`)
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => store.close()))
}
