/**
 * Tile size, spacing, and row count for a given viewport. Pure arithmetic with
 * no three.js and no mutable state, so the wall's responsive behaviour can be
 * tested without a canvas.
 */

/** Geometry is built at this size once and scaled per tile, so a viewport
 *  change never has to rebuild 60 meshes. */
export const BASE_CELL = 132 // px
const GAP_X_RATIO = 108 / BASE_CELL
/** On a phone that gap is nearly as wide as the tile beside it, which left
 *  under two columns on screen. */
const GAP_X_RATIO_NARROW = 36 / BASE_CELL
const GAP_Y_RATIO = 34 / BASE_CELL
/** The label sits in the row gap and does not shrink with the tile: at phone
 *  sizes the proportional gap came out at 19px against a 19px label. Never
 *  binds on a desktop, where the ratio is larger. */
const GAP_Y_MIN = 26
/** Rows are chosen by viewport height; a phone in landscape only fits two. */
const ROW_MAX = 6
const ROW_STEPS: [number, number][] = [
  [760, 5],
  [620, 4],
  [460, 3],
  [0, 2]
]
/** Share of the viewport height the wall may occupy. */
const HEIGHT_USE = 0.88
/** A single column may never take more than this share of the width, or a
 *  narrow screen would show barely one Pokemon at a time. */
const COLUMN_SHARE = 0.55
/** Ditto: 0.55 of a 375px screen is one tile and little else. */
const COLUMN_SHARE_NARROW = 0.27
const CELL_MIN = 64
const CELL_MAX = 156
/** Below this width the expanded view stacks instead of splitting side by side.
 *  Matches Tailwind's `sm`, which the details panel keys off. */
export const STACK_WIDTH = 640

export type WallMetrics = {
  cell: number
  gapX: number
  gapY: number
  rows: number
  stacked: boolean
}

export function measureWall(width: number, height: number): WallMetrics {
  const stacked = width < STACK_WIDTH
  const usable = height * HEIGHT_USE
  const perRow = 1 + GAP_Y_RATIO

  // A first guess at the row count sets the density; the tile then fills it.
  const guess = ROW_STEPS.find(([min]) => height >= min)?.[1] ?? 2
  const byHeight = usable / (guess * perRow - GAP_Y_RATIO)

  const columnShare = stacked ? COLUMN_SHARE_NARROW : COLUMN_SHARE
  const gapXRatio = stacked ? GAP_X_RATIO_NARROW : GAP_X_RATIO
  const byWidth = (width * columnShare) / (1 + gapXRatio)

  // Rounded down, all three. Rounding up put five rows a fraction of a pixel
  // over the height budget, and the row count below then floored to four.
  const cell = Math.floor(
    Math.max(CELL_MIN, Math.min(CELL_MAX, byHeight, byWidth))
  )
  const gapY = Math.max(GAP_Y_MIN, Math.floor(cell * GAP_Y_RATIO))

  // Then fit as many rows as that tile allows. Without this second pass a narrow
  // screen — where width decided the tile, not height — was left with the wall
  // floating in a third of the viewport.
  const rows = Math.max(
    2,
    Math.min(ROW_MAX, Math.floor((usable + gapY) / (cell + gapY) + 1e-6))
  )

  return { cell, gapX: Math.floor(cell * gapXRatio), gapY, rows, stacked }
}
