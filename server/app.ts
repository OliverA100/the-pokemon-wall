import express from 'express'

import { queryPokemon } from './query.js'

/**
 * Express types a query value as `string | string[] | ParsedQs | ParsedQs[]`,
 * because `?search=a&search=b` is legal and arrives as an array. Casting it to
 * `string` would be a lie the compiler cannot catch; taking the first value
 * matches what the serverless caller's `URLSearchParams.get` already does, so
 * both entry points agree.
 */
const one = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

const app = express()

app.get('/api/pokemon', (req, res) => {
  res.json(
    queryPokemon({
      limit: one(req.query.limit),
      page: one(req.query.page),
      search: one(req.query.search)
    })
  )
})

export default app
