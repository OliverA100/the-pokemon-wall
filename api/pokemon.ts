import type { IncomingMessage, ServerResponse } from 'node:http'

import { queryPokemon } from '../server/query.js'

/**
 * `/api/pokemon` in production: a built site has no server, so the route would
 * 404 without it. Anything under `api/` is picked up as a serverless function,
 * and this file's path is the route it answers.
 *
 * The `.js` specifier is deliberate. Hosts differ in whether they bundle these
 * files or merely transpile them, and under plain Node ESM an extensionless
 * import does not resolve and a JSON import needs an attribute (see
 * server/query.ts). Bundlers map `.js` back to the `.ts` source.
 *
 * Plain Node types rather than `@vercel/node`, so nothing ties the project to
 * one host.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // `req.url` is a path, not an absolute URL, so it needs a base to parse
    // against. The host never matters — only the query string is read.
    const { searchParams } = new URL(
      req.url ?? '',
      `http://${req.headers.host ?? 'localhost'}`
    )

    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify(
        queryPokemon({
          limit: searchParams.get('limit'),
          page: searchParams.get('page'),
          search: searchParams.get('search')
        })
      )
    )
  } catch (error) {
    // Otherwise the platform swallows this into an opaque 500 and the only
    // way to find out what broke is the host's log viewer.
    const message = error instanceof Error ? error.message : String(error)
    console.error('GET /api/pokemon failed:', error)
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: message }))
  }
}
