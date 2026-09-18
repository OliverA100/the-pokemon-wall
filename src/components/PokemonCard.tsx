import type { CSSProperties, Ref } from 'react'

import type { Pokemon } from '@/lib/pokemon'

import { rarityLabel, statBars } from '@/lib/pokemon'

import { TypeChips } from './TypeChips'

type Props = {
  cardRef: Ref<HTMLDivElement>
  onClose: () => void
  open: null | Pokemon
  /** No expand to wait for, so the panel should not hang back. */
  reduceMotion: boolean
  /** Which half the artwork expanded into, so the card takes the other one. */
  side: -1 | 1 | undefined
}

/**
 * The expanded view: a panel beside the artwork on a desktop, a sheet across
 * the bottom on a phone. Stays mounted while closed so the fade has something
 * to fade, but renders no content — nothing behind the wall may be focusable.
 */
export function PokemonCard({
  cardRef,
  onClose,
  open,
  reduceMotion,
  side
}: Props) {
  return (
    <aside
      aria-hidden={!open}
      /* Timed against the scene's 620ms tween: the panel waits for the art to
         be most of the way home, and leaves at once so it never lingers over
         a collapsing wall. No reduced-motion branch: a fade is already the
         movement the preference asks for. */
      /* Narrow screens get a sheet across the bottom: half a phone's width
         left only 158px of readable text, about 24 characters a line. From
         `sm` up it is the side panel again.

         justify-start, not end: `justify-end` in a scrolling flex column
         pushes the overflow off the top, opening the sheet already scrolled. */
      className={`absolute z-20 flex flex-col transition-state inset-x-0 bottom-0 h-[46%] items-center justify-start overflow-y-auto overscroll-contain px-6 pt-6 pb-8 sm:inset-x-auto sm:inset-y-0 sm:h-auto sm:w-1/2 sm:justify-center sm:overflow-visible sm:px-[4vw] sm:pb-0 ${
        side === 1
          ? 'sm:left-0 sm:items-end'
          : 'sm:right-0 sm:items-start'
      } ${
        open
          ? `pointer-events-auto opacity-100 ${reduceMotion ? 'delay-0' : 'delay-[300ms]'}`
          : 'pointer-events-none opacity-0 delay-0'
      }`}
    >
      {open ? (
        /* Only the card guards clicks — the padding around it stays
           click-through so the scene's pointerdown closes the view. */
        <div
          aria-labelledby="pokemon-name"
          aria-modal="true"
          /* Focused programmatically so the dialog announces itself and Escape
             lands here — but it is not a tab stop, so no ring. Browsers apply
             :focus-visible to programmatic focus in plenty of cases, mouse
             clicks included, which drew one every time it opened. */
          className="w-full max-w-md outline-none"
          data-overlay
          ref={cardRef}
          role="dialog"
          tabIndex={-1}
        >
          <div className="flex items-center gap-3">
            <p className="text-[11px] tracking-[0.24em] opacity-60">
              No. {String(open.id).padStart(4, '0')}
            </p>
            {rarityLabel(open) ? (
              <span className="rounded-full border border-line px-2 py-[3px] text-[9px] tracking-[0.18em] text-muted uppercase">
                {rarityLabel(open)}
              </span>
            ) : null}
          </div>
          <h2
            className="mt-2 text-[clamp(1.75rem,3.4vw,3rem)] leading-none font-semibold tracking-[-0.03em]"
            id="pokemon-name"
          >
            {open.name}
          </h2>

          {/* Shown at every width: the sheet hides the bottom caption on
              narrow screens, and on wide ones it sits at the far edge. */}
          <ul className="mt-3 flex flex-wrap gap-2">
            <TypeChips types={open.types} />
          </ul>

          {/* tabular-nums: monospace gave the stat column even digits for free;
              a proportional face does not, and this is a data table. */}
          <dl className="mt-8 grid grid-cols-2 gap-x-10 gap-y-3 tabular-nums">
            {statBars(open).map(stat => (
              <div key={stat.label}>
                <div className="flex items-baseline justify-between text-[10px] tracking-[0.14em] opacity-60">
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
                <div className="mt-1 h-px w-full bg-black/30">
                  <div
                    className="stat-fill h-px bg-black/80"
                    style={
                      {
                        '--stat-width': `${Math.min(100, (stat.value / stat.max) * 100)}%`
                      } as CSSProperties
                    }
                  />
                </div>
              </div>
            ))}
          </dl>

          <div className="mt-8 flex gap-6 text-[10px] tracking-[0.14em] opacity-60">
            <span>HT {open.height}m</span>
            <span>WT {open.weight}kg</span>
            <span>GEN {open.generation}</span>
          </div>

          <p className="mt-6 text-[13px] leading-relaxed opacity-60">
            {open.description}
          </p>

          <button
            aria-label={`Close ${open.name} details`}
            className="mt-8 w-fit cursor-pointer rounded-full border border-line px-4 py-2 text-[10px] tracking-[0.14em] uppercase opacity-60 transition-opacity ease-out hover:opacity-100 focus-ring"
            onClick={() => onClose()}
            type="button"
          >
            Close
          </button>
        </div>
      ) : null}
    </aside>
  )
}
