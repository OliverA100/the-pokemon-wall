import { describe, expect, it } from 'vitest'

import type { Pokemon } from './pokemon'

import {
  getTypeColor,
  getTypeDotColor,
  rarityLabel,
  statBars,
  thumbnailUrl
} from './pokemon'

const pokemon = (over: Partial<Pokemon> = {}): Pokemon => ({
  attack: 100,
  chainId: 1,
  defense: 100,
  description: '',
  generation: 1,
  height: 1,
  hp: 100,
  id: 1,
  imageUrl: 'https://example.com/1.png',
  name: 'Testmon',
  specialAttack: 100,
  specialDefense: 100,
  speed: 100,
  types: ['Water'],
  weight: 1,
  ...over
})

describe('rarityLabel', () => {
  it('is null for an ordinary Pokémon', () => {
    expect(rarityLabel(pokemon())).toBeNull()
  })

  it('prefers mythical over legendary when both are set', () => {
    expect(
      rarityLabel(pokemon({ isLegendary: true, isMythical: true }))
    ).toBe('Mythical')
  })
})

describe('statBars', () => {
  it('returns the six stats with a maximum each', () => {
    const bars = statBars(pokemon())
    expect(bars.map(b => b.label)).toEqual([
      'HP',
      'ATK',
      'DEF',
      'SP.ATK',
      'SP.DEF',
      'SPD'
    ])
    expect(bars.every(b => b.max > 0)).toBe(true)
  })

  it('can report a value above its maximum', () => {
    // No Pokémon in the fixture exceeds a ceiling, but statBars does not
    // clamp and nothing stops a future record holder — a mega evolution, a
    // new generation — from arriving above one. The renderer clamps; this
    // pins where that responsibility sits.
    const [hp] = statBars(pokemon({ hp: 999 }))
    expect(hp.value).toBeGreaterThan(hp.max)
  })
})

describe('thumbnailUrl', () => {
  it('routes through the resizing proxy and encodes the source', () => {
    const url = new URL(thumbnailUrl('https://example.com/a b.png'))
    expect(url.host).toBe('wsrv.nl')
    expect(url.searchParams.get('url')).toBe('https://example.com/a b.png')
    expect(url.searchParams.get('output')).toBe('webp')
  })

  it('asks for the width it is given', () => {
    expect(
      new URL(thumbnailUrl('https://example.com/a.png', 640)).searchParams.get(
        'w'
      )
    ).toBe('640')
  })
})

describe('type colours', () => {
  it('knows every type in the dataset', async () => {
    const data = (await import('../data/pokemon.json')).default as Pokemon[]
    const types = [...new Set(data.flatMap(p => p.types))]
    expect(types.length).toBeGreaterThan(0)
    for (const type of types) {
      expect(getTypeColor(type), type).toBeTruthy()
      expect(getTypeDotColor(type), type).toBeTruthy()
    }
  })

  it('uses a separate, more saturated ramp for the dots', () => {
    // Text needs 4.5:1 and the dots only 3:1, so the dots can carry more
    // chroma — which is what makes types tellable apart at 4px.
    expect(getTypeDotColor('Water')).not.toBe(getTypeColor('Water'))
  })
})
