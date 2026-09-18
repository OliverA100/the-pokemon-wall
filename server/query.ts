import pokemonData from '../src/data/pokemon.json' with { type: 'json' }

const MAX_PAGE_SIZE = 100

const clamp = (
  value: null | string | undefined,
  fallback: number,
  min: number,
  max: number
) => {
  const parsed = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

type Params = {
  limit?: null | string
  page?: null | string
  search?: null | string
}

/**
 * The one implementation of what `/api/pokemon` returns, shared by the Express
 * app Vite mounts in dev and the serverless function that answers the route in
 * production, so the deployed API cannot drift from the one developed against.
 *
 * Query values arrive as strings or null from both callers, so parsing lives
 * here rather than being repeated either side.
 */
export function queryPokemon({ limit, page, search }: Params) {
  // `?limit=0` divides into an infinite page count — hasNext true forever while
  // returning nothing — and a non-numeric value slices with NaN. Bounded above
  // so one request cannot ask for the whole fixture.
  const pageNumber = clamp(page, 1, 1, Number.MAX_SAFE_INTEGER)
  const pageSize = clamp(limit, 20, 1, MAX_PAGE_SIZE)

  let filtered = pokemonData

  if (search) {
    const term = search.toLowerCase()

    // "legendary" and "mythical" behave like types you can search for. They are
    // prefix-matched with a minimum length: plain `includes` would mean typing
    // a single "a" pulled in every legendary, since "legendary" contains one.
    const tagged = (tag: string) => term.length >= 3 && tag.startsWith(term)

    // Compared against `true` because the fixture is sparse: the rarity flags
    // exist only on the records that carry them, so the rest read `undefined`.
    filtered = pokemonData.filter(pokemon => {
      const legendary = pokemon.isLegendary === true
      const mythical = pokemon.isMythical === true

      return (
        pokemon.name.toLowerCase().includes(term) ||
        pokemon.types.some(type => type.toLowerCase().includes(term)) ||
        // Mythicals answer to "legendary" too — nobody searching it expects
        // Mew and Celebi to be left out — while "mythical" narrows to just them.
        ((legendary || mythical) && tagged('legendary')) ||
        (mythical && tagged('mythical'))
      )
    })
  }

  const total = filtered.length
  const totalPages = Math.ceil(total / pageSize)
  const startIndex = (pageNumber - 1) * pageSize

  return {
    data: filtered.slice(startIndex, startIndex + pageSize),
    pagination: {
      hasNext: pageNumber < totalPages,
      hasPrev: pageNumber > 1,
      limit: pageSize,
      page: pageNumber,
      total,
      totalPages
    }
  }
}
