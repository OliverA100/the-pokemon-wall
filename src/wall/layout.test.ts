import { describe, expect, it } from 'vitest'

import { measureWall, STACK_WIDTH } from './layout'

const PHONE = [375, 812] as const
const DESKTOP = [1280, 760] as const

const columnsAcross = (width: number, height: number) => {
  const { cell, gapX } = measureWall(width, height)
  return width / (cell + gapX)
}

describe('measureWall', () => {
  it('always returns a usable grid', () => {
    for (const [w, h] of [PHONE, DESKTOP, [320, 480], [2560, 1440]] as const) {
      const m = measureWall(w, h)
      expect(m.cell, `${w}x${h}`).toBeGreaterThan(0)
      expect(m.rows, `${w}x${h}`).toBeGreaterThanOrEqual(2)
      expect(Number.isInteger(m.cell)).toBe(true)
      expect(Number.isInteger(m.rows)).toBe(true)
    }
  })

  it('fits the rows it claims into the height it is given', () => {
    for (const [w, h] of [PHONE, DESKTOP, [414, 896], [1920, 1080]] as const) {
      const { cell, gapY, rows } = measureWall(w, h)
      expect(rows * cell + (rows - 1) * gapY, `${w}x${h}`).toBeLessThanOrEqual(h)
    }
  })

  it('leaves room for a label in every row gap', () => {
    // The label sits in the gap and does not shrink with the tile, so the gap
    // has a floor independent of the ratio.
    for (const [w, h] of [PHONE, DESKTOP, [320, 480]] as const) {
      expect(measureWall(w, h).gapY, `${w}x${h}`).toBeGreaterThanOrEqual(26)
    }
  })

  it('keeps a phone dense enough to browse', () => {
    // Desktop proportions applied to a phone left under two columns on screen.
    expect(columnsAcross(...PHONE)).toBeGreaterThan(3)
  })

  it('gives a desktop more columns than a phone', () => {
    expect(columnsAcross(...DESKTOP)).toBeGreaterThan(columnsAcross(...PHONE))
  })

  it('switches to the stacked layout at the breakpoint, not around it', () => {
    expect(measureWall(STACK_WIDTH - 1, 800).stacked).toBe(true)
    expect(measureWall(STACK_WIDTH, 800).stacked).toBe(false)
  })

  it('tightens the gap on the narrow side of the breakpoint', () => {
    const narrow = measureWall(STACK_WIDTH - 1, 800)
    const wide = measureWall(STACK_WIDTH, 800)
    expect(narrow.gapX).toBeLessThan(wide.gapX)
  })

  it('grows the tile with the viewport, up to a ceiling', () => {
    const small = measureWall(...PHONE).cell
    const large = measureWall(...DESKTOP).cell
    expect(large).toBeGreaterThan(small)
    expect(measureWall(4000, 3000).cell).toBe(measureWall(6000, 4000).cell)
  })
})
