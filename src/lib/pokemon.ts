export type Pagination = {
  hasNext: boolean
  hasPrev: boolean
  limit: number
  page: number
  total: number
  totalPages: number
}

export type Pokemon = {
  attack: number
  /** Evolution family. Shared by every Pokémon in the same chain. */
  chainId: number
  defense: number
  description: string
  generation: number
  height: number
  hp: number
  id: number
  imageUrl: string
  isLegendary?: boolean
  isMythical?: boolean
  name: string
  specialAttack: number
  specialDefense: number
  speed: number
  types: string[]
  weight: number
}

export type PokemonResponse = {
  data: Pokemon[]
  pagination: Pagination
}

/**
 * Accent per type, as an oklch triple so it can drive both text and glow.
 * Lightness is set by contrast, not taste: as small uppercase text on a 16%
 * tint of themselves the muted originals came out between 1.24 and 3.44, and
 * every one here clears 4.5, WCAG AA for small text. Chroma is trimmed only
 * where the darker colour would leave sRGB.
 */
const TYPE_COLORS: Record<string, string> = {
  Bug: '0.46 0.125 130',
  Dark: '0.47 0.04 280',
  Dragon: '0.48 0.19 275',
  Electric: '0.47 0.095 95',
  Fairy: '0.48 0.11 350',
  Fighting: '0.48 0.19 25',
  Fire: '0.48 0.135 45',
  Flying: '0.47 0.08 250',
  Ghost: '0.485 0.14 300',
  Grass: '0.45 0.14 145',
  Ground: '0.47 0.1 75',
  Ice: '0.46 0.075 200',
  Normal: '0.47 0.02 100',
  Poison: '0.49 0.18 320',
  Psychic: '0.485 0.17 5',
  Rock: '0.47 0.07 80',
  Steel: '0.465 0.04 220',
  Water: '0.465 0.105 240'
}

/**
 * A tile-sized copy of a Pokémon's artwork. The source is 475x475 and ~140KB
 * for a tile that renders at ~130px — 8.3MB for a first screen of sixty, where
 * a proxied WebP at the size actually needed costs about 16KB.
 *
 * The expanded view deliberately keeps the original: it draws at ~560px, where
 * 475 is already the ceiling, and only ever loads one at a time.
 */
export const thumbnailUrl = (imageUrl: string, width = 320) =>
  `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&w=${width}&output=webp&q=82`

/** The rarity worth showing, or null. Mythical is the narrower of the two. */
export const rarityLabel = (pokemon: Pokemon) =>
  pokemon.isMythical ? 'Mythical' : pokemon.isLegendary ? 'Legendary' : null

/**
 * A second ramp, for the type dots. Dots are graphical, not text: they answer
 * to the 3:1 non-text bar rather than 4.5:1, which buys back the colour the
 * text palette lost. Forced to AA every type flattened to L~0.47, and eighteen
 * of them cannot be told apart on hue alone — Electric and Normal sit five
 * degrees apart.
 */
const TYPE_DOT_COLORS: Record<string, string> = {
  Bug: '0.52 0.145 133',
  Dark: '0.38 0.06 280',
  Dragon: '0.54 0.2 275',
  Electric: '0.61 0.125 98',
  Fairy: '0.63 0.14 350',
  Fighting: '0.5 0.19 25',
  Fire: '0.6 0.17 45',
  Flying: '0.61 0.1 255',
  Ghost: '0.44 0.17 300',
  Grass: '0.59 0.17 148',
  Ground: '0.56 0.12 72',
  Ice: '0.6 0.1 195',
  Normal: '0.61 0.03 100',
  Poison: '0.48 0.19 320',
  Psychic: '0.63 0.2 5',
  Rock: '0.46 0.075 80',
  Steel: '0.5 0.04 228',
  Water: '0.52 0.12 240'
}

/** Accent for a type's dot. Use getTypeColor for anything made of text. */
export const getTypeDotColor = (type: string) =>
  TYPE_DOT_COLORS[type] ?? TYPE_DOT_COLORS.Normal

export const getTypeColor = (type: string) =>
  TYPE_COLORS[type] ?? TYPE_COLORS.Normal

/**
 * Stats shown in the expanded view, in the order the design lists them.
 *
 * The maxima are the real base-stat ceilings, so a bar reads as a share of the
 * best in the Pokédex rather than of whatever is on screen: Blissey's HP,
 * Shuckle's two defences and Regieleki's speed each fill theirs exactly. ATK
 * and SP.ATK keep some headroom because their record holders are mega
 * evolutions, which sit outside the 1–1025 range this fixture covers.
 */
export const statBars = (pokemon: Pokemon) =>
  [
    { label: 'HP', max: 255, value: pokemon.hp },
    { label: 'ATK', max: 190, value: pokemon.attack },
    { label: 'DEF', max: 230, value: pokemon.defense },
    { label: 'SP.ATK', max: 194, value: pokemon.specialAttack },
    { label: 'SP.DEF', max: 230, value: pokemon.specialDefense },
    { label: 'SPD', max: 200, value: pokemon.speed }
  ] as const
