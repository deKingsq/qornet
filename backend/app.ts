import express from 'express'
import type { ErrorRequestHandler } from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { registerRoutes } from './routes.ts'
import type { Store } from './store.ts'

export function createApp(store: Store, dist?: string) {
  const app = express()
  app.disable('x-powered-by')
  app.use('/api', express.json({ limit: '32kb' }))
  registerRoutes(app, store)
  app.use('/api', (_req, res) => res.status(404).json({ message: 'Маршрут API не найден' }))
  if (dist && existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist))
    app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
  }
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(422).json({ message: 'Проверьте введённые данные', issues: error.issues.map(({ path, message }) => ({ path, message })) })
    } else if (error.status === 400 || error.status === 413) {
      res.status(error.status).json({ message: 'Некорректный запрос' })
    } else {
      console.error(error)
      res.status(500).json({ message: 'Не удалось обработать запрос' })
    }
  }
  app.use(errorHandler)
  return app
}

