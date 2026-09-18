import { describe, expect, it } from 'vitest'

import { queryPokemon } from './query.js'

const TOTAL = 1025

describe('pagination', () => {
  it('defaults to the first 20', () => {
    const { data, pagination } = queryPokemon({})
    expect(data).toHaveLength(20)
    expect(pagination).toMatchObject({
      hasNext: true,
      hasPrev: false,
      limit: 20,
      page: 1,
      total: TOTAL
    })
  })

  it('walks pages without gaps or repeats', () => {
    const first = queryPokemon({ limit: '10', page: '1' }).data
    const second = queryPokemon({ limit: '10', page: '2' }).data
    expect(new Set([...first, ...second].map(p => p.id)).size).toBe(20)
    expect(second[0].id).not.toBe(first[0].id)
  })

  it('reports the last page as the last page', () => {
    const last = Math.ceil(TOTAL / 100)
    const { data, pagination } = queryPokemon({
      limit: '100',
      page: String(last)
    })
    expect(pagination.hasNext).toBe(false)
    expect(pagination.hasPrev).toBe(true)
    expect(data).toHaveLength(TOTAL % 100)
  })

  it('returns nothing past the end, and says so', () => {
    const { data, pagination } = queryPokemon({ limit: '20', page: '9999' })
    expect(data).toHaveLength(0)
    expect(pagination.hasNext).toBe(false)
  })
})

describe('parameter clamping', () => {
  // Three different unvalidated outcomes — Infinity, NaN, and a backwards
  // slice — that the clamp collapses into one: a servable page.
  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['non-numeric', 'abc']
  ])('never advertises more pages than it can serve: limit=%s', (_, limit) => {
    const { data, pagination } = queryPokemon({ limit, page: '1' })
    expect(data.length).toBeGreaterThan(0)
    expect(pagination.limit).toBeGreaterThanOrEqual(1)
    expect(Number.isFinite(pagination.totalPages)).toBe(true)
  })

  it('caps how much one request can ask for', () => {
    const { data, pagination } = queryPokemon({ limit: '99999', page: '1' })
    expect(pagination.limit).toBe(100)
    expect(data).toHaveLength(100)
  })

  it('falls back to page 1 for junk', () => {
    expect(queryPokemon({ page: '0' }).pagination.page).toBe(1)
    expect(queryPokemon({ page: 'abc' }).pagination.page).toBe(1)
  })
})

describe('search', () => {
  const totalFor = (search: string) => queryPokemon({ search }).pagination.total

  it('matches names, case-insensitively and partially', () => {
    expect(queryPokemon({ search: 'charizard' }).data[0].name).toBe('Charizard')
    expect(totalFor('CHARIZARD')).toBe(1)
    expect(totalFor('char')).toBeGreaterThan(1)
  })

  it('matches types', () => {
    const { data, pagination } = queryPokemon({ limit: '100', search: 'ghost' })
    expect(pagination.total).toBeGreaterThan(0)
    expect(
      data.every(p => p.types.some(t => t.toLowerCase().includes('ghost')))
    ).toBe(true)
  })

  it('treats legendary and mythical as searchable rarities', () => {
    expect(totalFor('legendary')).toBeGreaterThan(0)
    expect(totalFor('mythical')).toBeGreaterThan(0)
    // Mythicals answer to "legendary" too, so it is the wider set.
    expect(totalFor('legendary')).toBeGreaterThan(totalFor('mythical'))
  })

  it('requires three characters before a rarity matches', () => {
    // Otherwise a single "a" pulls in every legendary, since "legendary"
    // contains one. Tested with a legendary whose own name contains neither
    // prefix, so only the rarity rule can put it in the results.
    const legendary = queryPokemon({ limit: '100', search: 'legendary' }).data
    const subject = legendary.find(p => !p.name.toLowerCase().includes('le'))
    expect(subject).toBeDefined()

    const named = (search: string) =>
      queryPokemon({ limit: '100', search }).data.some(
        p => p.id === subject?.id
      )
    expect(named('leg')).toBe(true)
    expect(named('le')).toBe(false)
  })

  it('does not search descriptions', () => {
    // Every description shares one template, so a word from it would match
    // nearly the whole set.
    expect(totalFor('generation')).toBe(0)
  })

  it('returns an empty, settled result for no matches', () => {
    const { data, pagination } = queryPokemon({ search: 'zzzzzz' })
    expect(data).toHaveLength(0)
    expect(pagination).toMatchObject({ hasNext: false, total: 0 })
  })
})
