import type { KeyboardEvent, Ref } from 'react'

import { memo } from 'react'

import type { Pokemon } from '@/lib/pokemon'

type Props = {
  /** Set while the expanded card is open, so the wall behind it is unreachable. */
  inert?: true | undefined
  items: Pokemon[]
  listRef: Ref<HTMLUListElement>
  onActivate: (pokemon: Pokemon) => void
  onFocusItem: (pokemon: Pokemon, index: number) => void
  /** Focus left the wall entirely, so the ring should go with it. */
  onFocusLeave: () => void
  onKeyDown: (event: KeyboardEvent<HTMLUListElement>) => void
  rovingIndex: number
  total: number
  /** Shown for real when there is no canvas to mirror (see `webglFailed`). */
  visible?: boolean
}

/**
 * The wall, as something a keyboard and a screen reader can actually use:
 * canvas pixels have no API, so this mirrors the Pokémon as real buttons,
 * hidden from sight but not from the accessibility tree, handing activation
 * back to the same scene the mouse drives. Nothing here changes what is seen.
 *
 * Memoised on purpose: the parent re-renders on every hover change as the
 * raycaster reports a new tile, and re-rendering a hundred-odd buttons at that
 * rate makes moving the mouse expensive.
 */
function PokemonListA11y({
  inert,
  items,
  listRef,
  onActivate,
  onFocusItem,
  onFocusLeave,
  onKeyDown,
  rovingIndex,
  total,
  visible = false
}: Props) {
  return (
    <section
      aria-label="Pokémon"
      className={
        visible
          ? 'relative z-10 mx-auto flex max-w-md flex-col gap-2 p-[var(--gutter)] pt-16 text-[13px]'
          : 'sr-only'
      }
      data-overlay
      inert={inert}
      /* focusout bubbles, so this catches focus moving anywhere outside the
         wall — including to nothing at all when the canvas is clicked. */
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFocusLeave()
      }}
    >
      <p id="wall-help">
        Use the up and down arrow keys to move through the wall, left and right
        to move by a column, and Enter to open a Pokémon. {items.length.toLocaleString()} of{' '}
        {total.toLocaleString()} are loaded; keep moving to load more, or search
        to jump straight to one.
      </p>

      {/* tabIndex -1 so focus has somewhere to land when a search unmounts the
          button that had it. */}
      <ul
        aria-describedby="wall-help"
        onKeyDown={onKeyDown}
        ref={listRef}
        tabIndex={-1}
      >
        {items.map((pokemon, index) => (
          <li aria-posinset={index + 1} aria-setsize={total} key={pokemon.id}>
            <button
              data-index={index}
              onClick={() => onActivate(pokemon)}
              onFocus={() => onFocusItem(pokemon, index)}
              /* One tab stop for the whole wall, not one per Pokémon: Tab past
                 a hundred-odd of them would take a hundred presses. */
              tabIndex={index === rovingIndex ? 0 : -1}
              type="button"
            >
              {pokemon.name}, {pokemon.types.join(' and ')} type
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default memo(PokemonListA11y)
