/**
 * Generates src/data/pokemon.json. Every field is real.
 *
 * Names and National Dex ids come from the Pokémon 3D API
 * (github.com/Pokemon-3D-api, MIT). Everything else comes from PokéAPI:
 * `/pokemon/{id}` carries the base stats, height, weight and typing;
 * `/pokemon-species/{id}` carries the legendary and mythical flags plus the
 * Pokédex flavour text; and 541 evolution chains give each species its family.
 *
 * Roughly 2,600 requests, batched — which is why the output is committed
 * rather than generated on install.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MODELS_API = 'https://pokemon-3d-api.onrender.com/v1/pokemon'
const POKEAPI = 'https://pokeapi.co/api/v2'
const ARTWORK =
  'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork'

// National Dex ranges per generation
const GENERATIONS = [
  [1, 151], [152, 251], [252, 386], [387, 493], [494, 649],
  [650, 721], [722, 809], [810, 905], [906, 1025]
]

/** Requests issued at once when a list has to be walked one item at a time. */
const BATCH = 24

/** PokéAPI's stat slugs, in the shape the app stores them. */
const STAT_FIELDS = {
  attack: 'attack',
  defense: 'defense',
  hp: 'hp',
  'special-attack': 'specialAttack',
  'special-defense': 'specialDefense',
  speed: 'speed'
}

/**
 * Pokédex entries, newest game first. Anything from Black/White onward writes
 * species names normally; the older games SHOUT THEM, which reads as a bug in
 * a caption. Later entries also tend to be the better-written ones.
 */
const FLAVOUR_VERSIONS = [
  'scarlet', 'violet', 'sword', 'shield', 'lets-go-pikachu', 'lets-go-eevee',
  'ultra-sun', 'ultra-moon', 'sun', 'moon', 'omega-ruby', 'alpha-sapphire',
  'x', 'y', 'black-2', 'white-2', 'black', 'white'
]

const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The best English Pokédex entry, as one line.
 *
 * The raw text is laid out for a game's text box: hard newlines mid-sentence,
 * a form feed where the box pages, and soft hyphens inside split words. All of
 * that collapses to single spaces. Gen 9 species only exist in the newest
 * games, so the preference list falls back to the last English entry, which is
 * the most recent one PokéAPI holds.
 */
function flavourText(entries) {
  const english = entries.filter(e => e.language.name === 'en')
  if (!english.length) return ''
  const pick =
    FLAVOUR_VERSIONS.map(v => english.find(e => e.version.name === v)).find(
      Boolean
    ) ?? english[english.length - 1]

  return pick.flavor_text
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .replace(/POKéMON/g, 'Pokémon')
    .trim()
}
const generationOf = id =>
  GENERATIONS.findIndex(([lo, hi]) => id >= lo && id <= hi) + 1 || 1

/**
 * id -> { height, weight, stats, types }.
 *
 * One request per Pokémon, which also makes this the source of typing — the
 * same endpoint carries it, so there is no second pass over the 18 type lists
 * and no chance of the two disagreeing. Height arrives in decimetres and
 * weight in hectograms; both are tenths of the unit we display.
 */
async function fetchDetails() {
  const index = new Map()
  for (let start = 1; start <= 1025; start += BATCH) {
    const ids = Array.from(
      { length: Math.min(BATCH, 1025 - start + 1) },
      (_, k) => start + k
    )
    const batch = await Promise.all(
      ids.map(n => getJson(`${POKEAPI}/pokemon/${n}`).catch(() => null))
    )
    for (const [k, entry] of batch.entries()) {
      if (!entry) continue
      const stats = {}
      for (const { base_stat: value, stat } of entry.stats) {
        stats[STAT_FIELDS[stat.name]] = value
      }
      index.set(ids[k], {
        height: entry.height / 10,
        stats,
        // `slot` orders a dual typing the way the Pokédex prints it.
        types: entry.types
          .sort((a, b) => a.slot - b.slot)
          .map(t => titleCase(t.type.name)),
        weight: entry.weight / 10
      })
    }
  }
  return index
}

/**
 * id -> evolution-chain id, so hovering one Pokémon can light up its whole
 * family. Every species belongs to a chain, including those that never evolve
 * — those simply have a chain to themselves.
 */
async function fetchEvolutionIndex() {
  const { results } = await getJson(`${POKEAPI}/evolution-chain/?limit=2000`)
  const idOf = url => Number(url.replace(/\/$/, '').split('/').pop())
  const index = new Map()

  for (let i = 0; i < results.length; i += BATCH) {
    const chains = await Promise.all(
      results.slice(i, i + BATCH).map(r => getJson(r.url))
    )
    for (const chain of chains) {
      // evolves_to is a tree, not a list: Eevee has eight branches.
      const walk = node => {
        index.set(idOf(node.species.url), chain.id)
        node.evolves_to.forEach(walk)
      }
      walk(chain.chain)
    }
  }
  return index
}

/** id -> display name, taken from the plain "regular" form. */
async function fetchNameIndex() {
  const raw = await getJson(MODELS_API)
  const list = Array.isArray(raw) ? raw : raw.pokemon
  const index = new Map()
  for (const entry of list) {
    const form =
      entry.forms?.find(f => f.formName === 'regular') ?? entry.forms?.[0]
    if (form) index.set(entry.id, form.name)
  }
  return index
}

/**
 * id -> { description, legendary, mythical }.
 *
 * One request per species is unavoidable — PokéAPI exposes the legendary and
 * mythical flags nowhere else — so they are batched, and the Pokédex entry
 * rides along in the same response for free.
 */
async function fetchSpecies() {
  const index = new Map()
  for (let start = 1; start <= 1025; start += BATCH) {
    const ids = Array.from(
      { length: Math.min(BATCH, 1025 - start + 1) },
      (_, k) => start + k
    )
    const species = await Promise.all(
      ids.map(n => getJson(`${POKEAPI}/pokemon-species/${n}`).catch(() => null))
    )
    for (const [k, entry] of species.entries()) {
      if (!entry) continue
      index.set(ids[k], {
        description: flavourText(entry.flavor_text_entries),
        legendary: entry.is_legendary,
        mythical: entry.is_mythical
      })
    }
  }
  return index
}

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

async function main() {
  console.warn('Fetching name index…')
  const names = await fetchNameIndex()
  console.warn(`  ${names.size} entries`)

  console.warn('Fetching evolution chains… (541 requests, batched)')
  const chainIndex = await fetchEvolutionIndex()
  console.warn(`  ${chainIndex.size} entries`)

  console.warn('Fetching species… (1025 requests, batched)')
  const species = await fetchSpecies()
  const legendary = [...species.values()].filter(f => f.legendary).length
  const mythical = [...species.values()].filter(f => f.mythical).length
  console.warn(
    `  ${species.size} entries — ${legendary} legendary, ${mythical} mythical`
  )

  console.warn('Fetching stats, size and typing… (1025 requests, batched)')
  const details = await fetchDetails()
  console.warn(`  ${details.size} entries`)

  const pokemon = []
  for (let id = 1; id <= 1025; id++) {
    const rawName = names.get(id)
    const detail = details.get(id)
    if (!rawName || !detail?.types.length) continue

    pokemon.push({
      attack: detail.stats.attack,
      // Negated on the fallback so a Pokémon missing from the chain index
      // becomes a family of one, rather than colliding with the chain whose
      // id happens to match its Dex number.
      chainId: chainIndex.get(id) ?? -id,
      defense: detail.stats.defense,
      description: species.get(id)?.description ?? '',
      generation: generationOf(id),
      height: detail.height,
      hp: detail.stats.hp,
      id,
      imageUrl: `${ARTWORK}/${id}.png`,
      // Omitted rather than set false, so the fixture stays small.
      isLegendary: species.get(id)?.legendary || undefined,
      isMythical: species.get(id)?.mythical || undefined,
      name: titleCase(rawName),
      specialAttack: detail.stats.specialAttack,
      specialDefense: detail.stats.specialDefense,
      speed: detail.stats.speed,
      types: detail.types,
      weight: detail.weight
    })
  }

  const outputPath = path.join(__dirname, '..', 'src', 'data', 'pokemon.json')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(pokemon, null, 2))

  console.warn(`\nGenerated ${pokemon.length} Pokémon -> ${outputPath}`)
  console.warn('Sample:', JSON.stringify(pokemon[0], null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
