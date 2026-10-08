import type { KeyboardEvent } from 'react'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Pokemon } from '@/lib/pokemon'
import type { WallSelection } from '@/wall/scene'

import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePokemonSearch } from '@/hooks/usePokemonSearch'
import { getTypeDotColor, rarityLabel } from '@/lib/pokemon'
import { SCROLL_DURATION_S, SCROLL_EASE } from '@/wall/scene'
import { useWallScene } from '@/wall/useWallScene'

import { PokemonCard } from './PokemonCard'
import PokemonListA11y from './PokemonListA11y'
import { TypeChips } from './TypeChips'

/** index.html preloads the first page by URL, so it repeats this number. */
const PAGE_SIZE = 60

/**
 * The wall: a single WebGL canvas holding every Pokemon, with the chrome,
 * search, expanded card and accessible mirror list around it.
 *
 * Each Pokemon is a subdivided plane rather than a flat rectangle, so the
 * vertex shader can bend it by its distance from the viewport centre — the
 * middle of the wall stays flat while the outer tiles genuinely curve.
 */
export default function PokemonWallGL() {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const activeSearchRef = useRef('')
  const prevSearchRef = useRef('')
  const [focusedPokemon, setFocusedPokemon] = useState<null | Pokemon>(null)
  const [rovingIndex, setRovingIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const lastTriggerRef = useRef<HTMLElement | null>(null)
  const openSourceRef = useRef<null | WallSelection['source']>(null)
  /** Read inside stable callbacks, so the memoised list keeps its identity. */
  const itemsRef = useRef<Pokemon[]>([])
  const [search, setSearch] = useState('')
  /** The search input is only ~156px wide on a phone, which fits about fifteen
   *  monospace characters — far less than the full prompt. */
  const compact = useMediaQuery('(max-width: 639px)')

  const {
    activeSearch,
    error,
    hasMore,
    isLoading,
    isLoadingMore,
    items,
    loadMore,
    retry,
    settled,
    total
  } = usePokemonSearch(search, PAGE_SIZE)

  activeSearchRef.current = activeSearch
  itemsRef.current = items

  // The scene asks for more on every frame once it nears the tail; the hook
  // already ignores calls while a request is in flight or the list is done.
  const onNeedMore = useCallback(() => loadMore(), [loadMore])

  const {
    atEnd,
    canvasRef,
    focusRingRef,
    hovered,
    labelNodesRef,
    labels,
    lenisRef,
    resetExtent,
    sceneEpoch,
    sceneRef,
    selection,
    spacerRef,
    webglFailed,
    wrapperRef
  } = useWallScene({ error, hasMore, onNeedMore, reduceMotion })

  const handleActivate = useCallback((pokemon: Pokemon) => {
    lastTriggerRef.current = document.activeElement as HTMLElement | null
    sceneRef.current?.open(pokemon)
  }, [sceneRef])

  /** Arrow keys are a screen reader's version of scrolling to the bottom, so
   *  results are topped up as focus nears the end. */
  const handleFocusItem = useCallback(
    (pokemon: Pokemon, index: number) => {
      const scene = sceneRef.current
      setFocusedPokemon(pokemon)
      setRovingIndex(index)
      scene?.setFocusTarget(pokemon.id)

      const target = scene?.scrollTargetFor(pokemon.id)
      if (target != null) {
        lenisRef.current?.scrollTo(target, {
          duration: reduceMotion ? 0 : SCROLL_DURATION_S,
          easing: SCROLL_EASE
        })
      }

      const rows = scene?.rows ?? 5
      if (index >= itemsRef.current.length - rows * 2) loadMore()
    },
    [loadMore, reduceMotion, lenisRef, sceneRef]
  )

  /** An arrow key steps into the wall, the same way Tab does. Left to the
   *  browser it only scrolls the container — moving the ring does that anyway,
   *  and says where you are while doing it. */
  useEffect(() => {
    const arrows = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'])
    const enter = (event: globalThis.KeyboardEvent) => {
      if (selection || !arrows.has(event.key)) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return

      const active = document.activeElement
      // Typing in the search box: arrows belong to the caret.
      if (active instanceof HTMLInputElement) return
      // Already in the list, so its own handler moves the ring.
      if (listRef.current?.contains(active)) return

      const button = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-index="${rovingIndex}"]`
      )
      if (!button) return
      event.preventDefault()
      button.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', enter)
    return () => window.removeEventListener('keydown', enter)
  }, [rovingIndex, selection])

  /** The title is the way back: clear everything and return to the start. */
  const handleReset = useCallback(() => {
    const scene = sceneRef.current
    setSearch('')
    scene?.collapse()
    scene?.setFocusTarget(null)
    setFocusedPokemon(null)
    setRovingIndex(0)

    // Only scroll home when nothing else is going to. Clearing an active search
    // starts a sweep that returns to the start on its own, and doing both read
    // as two separate movements rather than one.
    if (!activeSearch) {
      lenisRef.current?.scrollTo(0, {
        duration: SCROLL_DURATION_S,
        easing: SCROLL_EASE
      })
    }
  }, [activeSearch, lenisRef, sceneRef])

  const handleFocusLeave = useCallback(() => {
    setFocusedPokemon(null)
    sceneRef.current?.setFocusTarget(null)
  }, [sceneRef])

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      const count = itemsRef.current.length
      if (!count) return
      const rows = sceneRef.current?.rows ?? 5
      const from = Number(
        (event.target as HTMLElement).dataset.index ?? rovingIndex
      )

      const steps: Record<string, number> = {
        ArrowDown: 1,
        ArrowLeft: -rows,
        ArrowRight: rows,
        ArrowUp: -1
      }
      const next =
        event.key in steps
          ? from + steps[event.key]
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null
      if (next === null) return

      event.preventDefault()
      const clamped = Math.max(0, Math.min(count - 1, next))
      setRovingIndex(clamped)
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-index="${clamped}"]`)
        ?.focus({ preventScroll: true })
    },
    [rovingIndex, sceneRef]
  )

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    // The term is read from a ref rather than listed as a dependency: as a
    // dependency this also fired on the commit where the search had changed
    // but `items` was still the previous result set, sweeping the wall toward
    // the old Pokemon under the new term.
    scene.sync(items, !isLoading, activeSearchRef.current)
    // sceneEpoch: a preference flip rebuilds the scene, and the rebuilt one is
    // empty. The ref's identity does not change when that happens, so without
    // this the wall would stay blank until the next search.
  }, [isLoading, items, sceneEpoch, sceneRef])

  /**
   * The card takes focus whenever it opens, so the dialog announces itself and
   * Escape lands somewhere useful. Focus only travels back to the wall if the
   * keyboard opened it — after a tap there is no visible place to return it to,
   * and dropping it into a hidden list would be a worse surprise.
   */
  useEffect(() => {
    if (selection) {
      openSourceRef.current = selection.source
      cardRef.current?.focus({ preventScroll: true })
      return
    }
    if (openSourceRef.current === 'keyboard') {
      const trigger = lastTriggerRef.current
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      else listRef.current?.focus({ preventScroll: true })
    }
    openSourceRef.current = null
  }, [selection])

  // Entering search sweeps the wall off-screen and brings the results back from
  // the opposite side; clearing it reverses. A sweep asked for while one is
  // still running is queued rather than cut short, so a series of edits travels
  // on across the wall instead of restarting in place.
  useEffect(() => {
    const previous = prevSearchRef.current
    prevSearchRef.current = activeSearch
    if (previous === activeSearch) return

    resetExtent()

    // The old buttons are about to unmount. Without this the focused one takes
    // focus to <body> with it, and Tab restarts at the top of the document.
    // Reacting to a new result set is what this effect exists for.
    /* eslint-disable @eslint-react/set-state-in-effect */
    setRovingIndex(0)
    setFocusedPokemon(null)
    /* eslint-enable @eslint-react/set-state-in-effect */
    sceneRef.current?.setFocusTarget(null)
    if (listRef.current?.contains(document.activeElement)) {
      listRef.current.focus({ preventScroll: true })
    }
    // Order matters: the scene rebases its tiles by the current scroll before
    // the scroll is zeroed, and Lenis applies an immediate scrollTo
    // synchronously, so both land in one tick. Reversed, the wall snaps back to
    // the start of the current results before the sweep begins.
    // No sweep under prefers-reduced-motion: results fall through to sync()'s
    // in-place cross-fade, the recommended substitute for travelling motion.
    if (!reduceMotion) sceneRef.current?.beginSweep(activeSearch ? 1 : -1)
    lenisRef.current?.scrollTo(0, { immediate: true })
  }, [activeSearch, reduceMotion, lenisRef, resetExtent, sceneRef])

  // The wall behind the details panel must not drift.
  useEffect(() => {
    const lenis = lenisRef.current
    if (!lenis) return
    if (selection) lenis.stop()
    else lenis.start()
  }, [selection, lenisRef])

  /**
   * What a screen reader is told when results change. Derived rather than
   * pushed from an effect, so there is no string to keep in sync — and empty on
   * the first render, which is what lets the region be picked up at all.
   */
  const status = error
    ? `Could not load Pokémon. ${error}`
    : !settled
      ? ''
      : items.length === 0
        ? `Nothing matches “${activeSearch}”. Try a name, a type, or “legendary”.`
        : activeSearch
          ? `${total.toLocaleString()} matching “${activeSearch}”, ${items.length} loaded.`
          : `${total.toLocaleString()} Pokémon, ${items.length} loaded.`

  /**
   * Deliberately the size of the collection (or match set), not how many pages
   * happen to be loaded. `isLoading` is the first-page case, where items are
   * cleared and `total` still holds the previous query's count.
   */
  const tally = isLoading
    ? 'loading'
    : activeSearch
      ? `${total.toLocaleString()} ${total === 1 ? 'match' : 'matches'}`
      : `${total.toLocaleString()} Pokémon`

  const caption = selection?.pokemon ?? hovered ?? focusedPokemon
  const open = selection?.pokemon ?? null

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* The list below is the accessible representation of the wall; leaving
          the canvas exposed would only add an unlabelled node to the tree. */}
      <canvas
        aria-hidden="true"
        className="fixed inset-0 z-0 block h-full w-full"
        ref={canvasRef}
      />

      {/* Transparent scroll surface over the canvas. Touch and wheel land here
          so the platform drives scrolling; clicks still reach the scene via the
          window-level pointerdown listener. Scrollbar hidden by design. */}
      <div
        /* One canvas: the cursor is the only hint that a tile is clickable. */
        className={`scrollbar-none fixed inset-0 z-10 overflow-x-auto overflow-y-hidden ${
          hovered ? 'cursor-pointer' : ''
        }`}
        ref={wrapperRef}
      >
        <div className="h-full w-px" ref={spacerRef} style={{ width: 1 }} />
      </div>

      {/* Details sit opposite the expanded art, in the other half. */}
      <PokemonCard
        cardRef={cardRef}
        onClose={() => sceneRef.current?.collapse()}
        open={open}
        reduceMotion={reduceMotion}
        side={selection?.side}
      />

      {/* The input is a flex child capped at max-w-xs, so it takes whatever the
          wordmark leaves rather than overlapping it on a phone. */}
      {/* React 19 passes `inert` straight through, which is the whole focus
          trap: everything behind the dialog stops being reachable at all. */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 p-[var(--gutter)]"
        data-overlay
        inert={open ? true : undefined}
      >
        <h1 className="shrink-0 text-[11px] tracking-[0.28em]">
          {/* `uppercase` sits on the button, not the h1: browsers set
              text-transform on form controls, and Tailwind's preflight
              re-inherits font, letter-spacing and colour for them but not
              text-transform — so on the h1 it silently does nothing. */}
          <button
            className="pointer-events-auto cursor-pointer uppercase focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            onClick={handleReset}
            type="button"
          >
            The Pokémon Wall
          </button>
        </h1>

        <div
          className={`relative w-full max-w-xs min-w-0 flex-1 transition-state ${
            open ? 'pointer-events-none' : 'pointer-events-auto'
          }`}
          style={{ opacity: open ? 0 : 1 }}
        >
          <input
            aria-label="Search Pokémon by name, type or rarity"
            className="w-full rounded-full border border-line bg-white/50 py-2 pr-9 pl-4 text-left text-[12px] tracking-[0.08em] pointer-coarse:text-[16px] backdrop-blur transition-colors ease-out outline-none placeholder:text-muted hover:border-black/60 focus-visible:border-black/75"
            /* Labels the on-screen key "Search" rather than "return". */
            enterKeyHint="search"
            onChange={event => setSearch(event.target.value)}
            /* Results are already live, so Enter has nothing to submit; it hands
               the keyboard back instead — reclaiming a third of a phone screen,
               and releasing the arrow keys to step into the wall. */
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            placeholder={
              compact ? 'Search…' : 'Search by name, type or rarity…'
            }
            type="search"
            value={search}
          />
          {search ? (
            <button
              aria-label="Clear search"
              className="absolute top-1/2 right-2.5 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full opacity-55 transition-opacity ease-out hover:opacity-100 focus-visible:opacity-100 focus-ring"
              onClick={() => setSearch('')}
              /* Keeps the caret in the field: without it the press pulls focus
                 out, and on a phone shuts the keyboard. Enter/Space are
                 unaffected; neither fires mousedown. */
              onMouseDown={event => event.preventDefault()}
              type="button"
            >
              {/* Butt caps and a 1.25 stroke, matched to the 1px hairlines
                  elsewhere; a rounded cross reads as a different family. */}
              <svg
                aria-hidden
                className="size-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                viewBox="0 0 10 10"
              >
                <path d="M1 1l8 8M9 1l-8 8" />
              </svg>
            </button>
          ) : null}
        </div>
      </header>

      <div
        /* Hidden while the card is open: a full-width bottom banner belongs to
           neither half of a split screen, and the card already says all of it. */
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-10 z-30 text-center transition-state"
        style={{ opacity: open || !caption ? 0 : 1 }}
      >
        {/* A <p>, not a heading: it is empty until something is hovered, and an
            empty heading in the outline is worse than none. */}
        <p className="text-[clamp(2.25rem,5.5vw,4.5rem)] leading-none font-semibold tracking-[-0.03em]">
          {caption?.name ?? ' '}
          {caption ? (
            <span className="ml-3 align-super text-[0.26em] font-normal tracking-normal opacity-60">
              ({String(caption.id).padStart(4, '0')})
            </span>
          ) : null}
        </p>
        <ul className="mt-3 flex justify-center gap-2">
          {caption ? <TypeChips types={caption.types} /> : null}
          {caption && rarityLabel(caption) ? (
            /* Neutral and outlined on purpose: colour means type here, and a
               gold chip would collide with Ground and Rock's accents. */
            <li className="rounded-full border border-line px-3 py-1 text-[10px] tracking-[0.16em] text-muted uppercase">
              {rarityLabel(caption)}
            </li>
          ) : null}
        </ul>
      </div>

      {/* Outside the scroll surface on purpose: focusing something inside it
          would make the browser scroll that container natively, underneath
          Lenis. */}
      <PokemonListA11y
        inert={open ? true : undefined}
        items={items}
        listRef={listRef}
        onActivate={handleActivate}
        onFocusItem={handleFocusItem}
        onFocusLeave={handleFocusLeave}
        onKeyDown={handleListKeyDown}
        rovingIndex={rovingIndex}
        total={total}
        visible={webglFailed}
      />

      {/* Positioned every frame by the scene, like the labels. */}
      <div
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 z-30 -translate-x-1/2 -translate-y-1/2 rounded-[8px] border-2 border-ring opacity-0"
        ref={focusRingRef}
      />

      <div aria-atomic className="sr-only" role="status">
        {status}
      </div>

      {/* The canvas is the whole UI, so if WebGL is unavailable the mirror list
          becomes the interface rather than the page rendering blank. */}
      {webglFailed ? (
        <p className="pointer-events-none absolute inset-x-0 top-[var(--gutter)] z-20 px-[var(--gutter)] text-center text-[11px] tracking-[0.14em] opacity-70">
          This browser could not start WebGL, so the wall cannot be drawn. The
          Pokémon are listed below.
        </p>
      ) : null}

      {/* aria-hidden: the live region above already says this. */}
      {!isLoading && activeSearch && items.length === 0 && !error ? (
        /* One opacity for both lines: at 11px, opacity-60 is already only
           4.52:1 on the wall, so a dimmer second line would fail 1.4.3. */
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 text-[11px] tracking-[0.14em] opacity-70"
        >
          <p>Nothing on the wall matches “{activeSearch}”.</p>
          {/* Type and rarity search are invisible affordances otherwise. */}
          <p>Try a name, a type, or “legendary”.</p>
        </div>
      ) : null}

      {/* Per-tile labels, published by the scene only once the wall is still.
          They leave faster than they arrive: on the way out the positions are a
          frame or two stale, so the mismatch should be brief. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-20">
        {labels.map(label => (
          /* Two elements on purpose: the outer one is moved by the scene every
             frame and owns nothing else, while the inner one runs the fade.
             Sharing one transform would have them fight each other. */
          <div
            className="absolute top-0 left-0 opacity-0 will-change-[transform,opacity]"
            key={label.id}
            ref={node => {
              const nodes = labelNodesRef.current
              if (node) nodes.set(label.id, node)
              return () => {
                nodes.delete(label.id)
              }
            }}
            style={{
              transform: `translate3d(${label.x}px, ${label.y}px, 0)`
            }}
          >
            <div
              className="-translate-x-1/2 text-center leading-tight"
              style={{ width: label.width }}
            >
              <p className="truncate text-[9px] tracking-[0.12em] uppercase opacity-60">
                {label.name}
              </p>
              {/* Typing as colour, not a second line: two lines filled the 30px
                  row gap. The caption and card still name the types in full. */}
              <span className="mt-1 flex justify-center gap-1.5">
                {label.types.map(type => (
                  <span
                    className="size-[4px] rounded-full"
                    key={type}
                    style={{
                      backgroundColor: `oklch(${getTypeDotColor(type)})`
                    }}
                  />
                ))}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Fades rather than hard-hides, so it leaves on the caption's beat. */}
      <p
        aria-hidden
        className="pointer-events-none absolute right-[var(--gutter)] bottom-[calc(var(--gutter)+8px)] z-20 sm:right-auto sm:left-[var(--gutter)] text-[10px] tracking-[0.14em] transition-state"
        style={{ opacity: open ? 0 : 0.6 }}
      >
        {tally}
        {/* No end to reach when nothing matched — the empty state says it. */}
        {isLoadingMore
          ? ' · loading'
          : hasMore || !total || !atEnd
            ? ''
            : ' · end'}
      </p>

      {/* Without this the wall stalls silently: the hook refuses to fetch
          again while status is 'error', and nothing offered a way out. */}
      {error ? (
        <div
          className="absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-background/90 px-4 py-2 backdrop-blur"
          data-overlay
          role="alert"
        >
          <span className="text-[10px] tracking-[0.14em] opacity-70">
            {error}
          </span>
          <button
            className="cursor-pointer rounded-full border border-line px-3 py-1 text-[10px] tracking-[0.14em] uppercase transition-opacity ease-out hover:opacity-70 focus-ring"
            onClick={retry}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
    </main>
  )
}

