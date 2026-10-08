import * as THREE from 'three'

import type { Pokemon } from '@/lib/pokemon'

import { thumbnailUrl } from '@/lib/pokemon'

import { BASE_CELL, measureWall, STACK_WIDTH } from './layout'
import { FRAGMENT, VERTEX } from './shaders'

/** Drift beyond this, by finger or by wall, means the gesture was a scroll. */
const TAP_SLOP = 10 // px
/**
 * The four durations every timed motion resolves to: FEEDBACK answers a
 * pointer, STATE changes a property in place, GESTURE brings something in or
 * out, TRAVEL moves the wall itself. Tailwind cannot read them, so
 * PokemonWallGL.tsx and globals.css repeat STATE and GESTURE by hand — change
 * one here, change those. The sweep clamps and PANEL_WAIT_MS sit outside the
 * set on purpose: a floor, a cap and a timeout are not motion anyone perceives.
 */
const FEEDBACK_MS = 150
const STATE_MS = 340
const GESTURE_MS = 620
const TRAVEL_MS = 1050

/**
 * Labels belong to the wall at rest; while it moves it stays bare. Two
 * thresholds so they cannot flicker across a single line, with the show
 * threshold where movement stops being perceptible rather than at zero. Keyed
 * on speed rather than bend: bend relaxes slowly by design, so it still reads
 * "moving" long after the wall has visibly stopped.
 */
const LABEL_SHOW_SPEED = 1.5
const LABEL_HIDE_SPEED = 5
/** Label fade. Asymmetric: they arrive gently and leave promptly — on the way
 *  out the tiles have started moving and the positions are already stale. */
const LABEL_IN_MS = STATE_MS
const LABEL_OUT_MS = FEEDBACK_MS
const SEGMENTS = 24 // subdivision — this is what lets an image bend

/**
 * Warp shape. The middle stays flat and the two ends go OPPOSITE ways: left
 * curves down and into the screen, right curves up and out of it. Both axes are
 * therefore ODD in horizontal distance from centre — an even term (both edges
 * alike) makes a cylinder, which this is not. The odd term is raised to FALLOFF
 * so it only bites at the very ends: raise it to push the displacement further
 * out, lower it to spread the curve back toward the centre.
 */
const FALLOFF = 4.0
/**
 * The curve is normalised to half the viewport, so on a phone it eats the wall:
 * at 4.0 the flat middle is 56% of the width either way — 3.6 columns on a
 * desktop but only 2.1 at 375px. A steeper exponent bends the ends by the same
 * amount and gets them out of the middle sooner, buying back most of a column.
 */
const FALLOFF_NARROW = 8.0
const DEPTH = 150 // apparent depth travel at each end — matched to LIFT
const LIFT = 150 // apparent vertical travel at each end
/** Shallower on a phone: columns are half as wide, so twice as much content
 *  crosses the bend for a given drag, and touch tracks the finger 1:1 instead
 *  of going through the wheel's 0.5 multiplier and Lenis's easing — full bend
 *  is reached far more often than it ever is on a desktop. */
const DEPTH_NARROW = 90
const LIFT_NARROW = 90
/** The expand/collapse tween — same both directions. */
const EXPAND_MS = GESTURE_MS
/** Nothing travels or scales in this mode, so all that is left is a dissolve —
 *  and a dissolve wants to be short, or both views sit on screen together. Not
 *  a hard cut, which is jarring in its own right. */
const REDUCED_EXPAND_MS = FEEDBACK_MS
/** The hover colour/grey crossfade. */
const DIM_MS = STATE_MS
/** How far the rest of an evolution family is pushed toward grey while one is
 *  hovered. 0 makes the family indistinguishable from the hovered tile, 1 dims
 *  them like everything else; in between they read as related. */
const FAMILY_DIM = 0.45
/** Meshes built per frame. Building a whole page at once blocked the frame
 *  that ingests it, and the stall was charged against the live scroll tween. */
const BUILD_PER_FRAME = 12
/** Fade-in for each tile as its texture arrives, and fade-out when filtered. */
const REVEAL_MS = GESTURE_MS
/**
 * How long the loop keeps drawing after the last thing moved. A still wall
 * looks exactly like the frame before it, so redrawing it is pure cost. This
 * outlasts the tweens that trail a movement (the dim and label fades), so they
 * finish before the loop rests.
 */
const IDLE_GRACE_MS = 500
/** Thumbnail widths the proxy is asked for. The smallest that covers a tile at
 *  its device size wins, so a phone isn't sent a desktop's worth of pixels. */
const THUMB_WIDTHS = [160, 240, 320]
/** Symmetric cubic — the short tweens, where a snappier curve reads better. */
const EASE_IN_OUT = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/**
 * The scroll's own motion — exponential decay, full speed immediately then a
 * long settle. Exported because the component hands it to Lenis. The sweep is
 * a near relative, not the same curve: a softer opening and a shorter tail,
 * because a sweep starts from rest where a fling arrives with speed in it.
 */
export const SCROLL_EASE = (t: number) =>
  Math.min(1, 1.001 - Math.pow(2, -10 * t))

/**
 * The sweep — how a search moves the wall to a new set of results — is the
 * scroll's decay with two adjustments. A decay opens at seven times its own
 * average, a whip crack on a wall starting from rest, so SWEEP_RAMP warps time
 * near zero to soften the opening without changing the shape; a longer ramp
 * counter-intuitively lowers peak speed, because it rejoins the curve where it
 * has already slowed, and past ~0.4 it starts eating the tail. SWEEP_DECAY sets
 * how long that tail runs: lower is more even, higher is more settle.
 */
const SWEEP_RAMP = 0.35
const SWEEP_DECAY = 8

const SWEEP_EASE = (t: number) => {
  const r = Math.min(1, t / SWEEP_RAMP)
  const eased = t * r * r * (3 - 2 * r)
  // Normalised so it lands exactly on 1 whatever the decay is.
  return (1 - Math.pow(2, -SWEEP_DECAY * eased)) / (1 - Math.pow(2, -SWEEP_DECAY))
}

export const SCROLL_DURATION_S = TRAVEL_MS / 1000

/**
 * Fades the warp out over the last of the travel, so the wall is flat the
 * instant it lands rather than unwinding afterwards — the first column carries
 * the most displacement and its rebound is visible.
 *
 * Applied to `bend` itself. Tapering the target only halves it, since the lag
 * is in the filter; scaling the rendered value is worse than nothing, because
 * the state keeps its magnitude and snaps back the frame the sweep ends.
 */
const SWEEP_FLATTEN = 0.3

/**
 * A sweep of one screen takes this, longer ones proportionally longer, so the
 * wall always travels at about the same speed. The floor is on the duration
 * rather than the distance, so where the panel lands never changes; it only
 * stops a very short hop reading as a jump cut.
 */
const SWEEP_MS = TRAVEL_MS
const SWEEP_MIN_MS = 250
const SWEEP_MAX_MS = SWEEP_MS * 2.4

/** An entrance takes longer than a search: a search has outgoing tiles to
 *  carry the eye, while a wall arriving out of an empty screen has nothing to
 *  be brisk against, so the same speed reads as sudden. */
const ENTRANCE_STRETCH = 1.25

/** How much of the first screen must hold artwork before a sweep sets off, and
 *  how long to wait before giving up. Only reached when the wall behind the
 *  sweep is blank — see travelReadiness. */
const PANEL_PAINTED = 0.75
const PANEL_WAIT_MS = 800

const VELOCITY_FOR_FULL_BEND = 34
/** How fast the warp follows the wall's speed, symmetric on purpose: releasing
 *  slower than it attacks reads as a second animation, the scroll stopping
 *  while the warp keeps straightening. Past ~0.22 the smoothing on `velocity`
 *  is the limit anyway. */
const BEND_RATE = 0.24

export type WallLabel = {
  id: number
  name: string
  types: string[]
  /** Tile width, so a label can never spill onto its neighbours. */
  width: number
  x: number
  y: number
}

export type WallSceneOptions = {
  canvas: HTMLCanvasElement
  /** Called at the top of every frame, before anything reads the scroll. */
  onFrame?: (time: number) => void
  onHover: (pokemon: null | Pokemon) => void
  /** Which tiles are worth labelling; re-emitted when that set changes. */
  onLabels?: (labels: WallLabel[]) => void
  onNeedMore: () => void
  onSelect: (selection: null | WallSelection) => void
  /** Read once at construction; the component rebuilds the scene if it flips. */
  reduceMotion?: boolean
}

/** Which half the tile expanded into: -1 left, 1 right. */
export type WallSelection = {
  pokemon: Pokemon
  side: -1 | 1
  /** Whether focus needs returning when this closes. */
  source: 'keyboard' | 'pointer'
}

type Entry = {
  /** Time-based tween of the grey-out, so it eases instead of snapping. */
  dimFrom: number
  dimStart: number
  dimTo: number
  /** True while this tile belongs to the outgoing panel of a sweep. */
  legacy: boolean
  /** 1 when this tile's label may show, 0 when a hover has excluded it. */
  mask: number
  maskFrom: number
  maskStart: number
  maskTo: number
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  /** Swap this tile's texture; used to upgrade a thumbnail to full size. */
  paint?: (texture: THREE.Texture, reveal: boolean) => void
  pokemon: Pokemon
  /** When this tile's texture arrived; drives its fade-in. 0 = not yet. */
  revealStart: number
  /** Index in the current layout. */
  slot: number
  /** True once the full-size artwork has been requested. */
  upgraded?: boolean
}

/**
 * Presses on the DOM overlay — the search field, the expanded card — belong to
 * it rather than to the wall behind it.
 */
const onOverlay = (event: PointerEvent) =>
  Boolean((event.target as HTMLElement | null)?.closest('[data-overlay]'))

/**
 * The wall, as three.js sees it.
 *
 * Each Pokemon is a subdivided plane whose vertices are displaced in the vertex
 * shader by their distance from the viewport centre, scaled by scroll velocity,
 * so the images themselves bend at the edges while the middle stays flat. That
 * bending is why this is WebGL and not CSS transforms, which can tilt a
 * rectangle but never curve what is drawn on it.
 *
 * Shader source lives in shaders.ts, the sizing maths in layout.ts.
 */
export class WallScene {
  /** Rows in the current layout, so arrow keys can move by a visual column. */
  get rows() {
    return this.layoutRows
  }
  private active: null | Pokemon = null // the tile being animated, open OR closing
  /** The loop draws until this time, then rests; see IDLE_GRACE_MS. */
  private awakeUntil = 0
  private bend = 0
  private camera: THREE.PerspectiveCamera
  /** Live layout metrics, recomputed from the viewport on every resize. */
  private cell = BASE_CELL
  private depthFar = DEPTH
  private depthNear = DEPTH
  private disposed = false
  private entries: Entry[] = []
  private expand = 0 // eased 0..1
  private expandCentre = new THREE.Vector2()
  private expandFocus = new THREE.Vector2()
  private expandFrom = 0
  /** Label visibility contributed by the expand gesture; see positionLabels. */
  private expandMask = 1
  private expandScale = 1
  private expandSide: -1 | 1 = 1
  private expandStart = 0
  private expandTo = 0
  private falloff = FALLOFF
  private focusId: null | number = null
  private focusNode: HTMLElement | null = null
  private frame = 0
  /**
   * Every tile is the same subdivided plane, scaled by its mesh, so they all
   * share this one. A copy per tile was ~27KB of vertices each, uploaded to the
   * GPU on first draw: 28MB and a buffer upload per tile across the full wall.
   */
  private geometry = new THREE.PlaneGeometry(
    BASE_CELL,
    BASE_CELL,
    SEGMENTS,
    SEGMENTS
  )
  private gapX = 108
  private gapY = 34
  private group = new THREE.Group()
  /** Resolved --gutter, so the first column lines up with the title above it. */
  private gutter = 24
  private hovered: null | Pokemon = null
  /** Eased 0..1 progress of the label fade, on a real clock. */
  private labelFade = 0
  private labelHash = 0
  private labelNodes: Map<number, HTMLElement> | null = null
  private labelsAtRest = false
  private lastFrameTime = 0
  private lastScrollX = 0
  private layoutRows = 5
  private lift = LIFT
  /**
   * Decodes artwork off the main thread, where an <img> handed to three is
   * decoded inside the upload, on the frame that first draws it. Null where
   * createImageBitmap ignores its options, which would upload it upside down.
   */
  private bitmapLoader = supportsImageBitmap()
    ? new THREE.ImageBitmapLoader().setOptions({
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none'
      })
    : null
  private loader = new THREE.TextureLoader()
  private onFrame?: (time: number) => void
  private onHover: (pokemon: null | Pokemon) => void
  private onLabels?: (labels: WallLabel[]) => void
  private onNeedMore: () => void
  private onSelect: (selection: null | WallSelection) => void
  private overPointerOverlay = false
  /** Where the incoming panel is laid out, relative to the outgoing one. */
  private panelOffsetX = 0
  /** Pokemon waiting to become meshes; drained a few per frame. */
  private pending: Pokemon[] = []
  /** Slot index for each queued Pokémon, so builds land in the right place. */
  private pendingSlots = new Map<number, number>()
  /** Where a press started, so a release can tell a tap from a drag. */
  private pendingTap: null | {
    id: number
    scroll: number
    x: number
    y: number
  } = null
  private pointer = new THREE.Vector2(-10, -10)
  private push = 0
  /** Identifies the result set on screen, so a refinement can be told from
   *  the next page of the same query. */
  private queryKey = ''
  private raycaster = new THREE.Raycaster()
  /**
   * Honour prefers-reduced-motion: the warp goes, the sweep is never started
   * (the component reconciles results in place instead), the expand tween
   * shortens, and the labels stop reacting to speed. The opacity timings
   * deliberately stay — the preference is about movement, and a crossfade is
   * the recommended substitute for motion, not something to strip as well.
   */
  private reduce: boolean
  /** A resize arrived mid-sweep; the relayout waits for it to land. */
  private relayoutPending = false
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private scrollX = 0
  private selected: null | Pokemon = null
  /** Narrow screens expand upward with the details beneath, not side by side. */
  private stacked = false
  private sweep: {
    direction: -1 | 1
    duration: number
    from: number
    phase: 'armed' | 'building' | 'idle' | 'travel'
    start: number
    to: number
  } = {
    direction: 1,
    duration: SWEEP_MS,
    from: 0,
    phase: 'idle',
    start: 0,
    to: 0
  }
  /** Extra horizontal offset applied by the sweep, in px. */
  private sweepOffset = 0
  /** Proxy width for new tiles, picked from THUMB_WIDTHS on every resize. */
  private thumbWidth = THUMB_WIDTHS[THUMB_WIDTHS.length - 1]

  private velocity = 0

  constructor({
    canvas,
    onFrame,
    onHover,
    onLabels,
    onNeedMore,
    onSelect,
    reduceMotion = false
  }: WallSceneOptions) {
    this.reduce = reduceMotion
    this.onHover = onHover
    this.onNeedMore = onNeedMore
    this.onFrame = onFrame
    this.onLabels = onLabels
    this.onSelect = onSelect

    // Render into React's own canvas. Swapping in a new element (replaceWith)
    // breaks under StrictMode: the cleanup removes it, and the second mount
    // then calls replaceWith on a detached node, which silently does nothing.
    // No MSAA: it only smooths geometry edges, and every tile's edge is the
    // transparent margin around its artwork, which the fragment shader
    // discards. At DPR 2 it was 4x the samples on a full-screen canvas for
    // nothing visible.
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      canvas
    })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 6000)
    this.scene.add(this.group)

    this.resize()
    this.draw()
    window.addEventListener('resize', this.resize)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointerout', this.onPointerOut)
    window.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('keydown', this.onKeyDown)
    // A resting loop draws nothing, and a browser may drop the canvas's last
    // frame while the tab is hidden or when the GPU resets the context. Either
    // way it needs drawing again, though nothing has moved.
    document.addEventListener('visibilitychange', this.onWake)
    canvas.addEventListener('webglcontextrestored', this.onWake)
    this.loop()
  }

  /**
   * Sweep the wall out and bring a new panel back from the opposite side.
   *
   * A mode change — entering or leaving search. Refining a term that is
   * already active reflows in place instead (see sync).
   */
  beginSweep(direction: -1 | 1) {
    this.wake()
    if (this.sweep.phase !== 'idle') {
      // Same way as the one already running: let it land rather than yanking
      // the panel off-screen mid-flight; extendSweep absorbs mid-flight ones.
      if (direction === this.sweep.direction) return
      // Turning back the other way. Land the current sweep first so the new one
      // measures against real coordinates, not a half-applied offset.
      this.settleSweep()
    }

    // The sweep is laid out from the origin, so fold the scrolled distance into
    // the tiles as the scroll resets to 0 — equal and opposite, so the reset is
    // invisible rather than a snap back to the first results.
    const base = this.scrollX
    if (base) {
      for (const entry of this.entries) entry.mesh.position.x -= base
      this.scrollX = 0
      this.lastScrollX = 0
    }

    // Discard everything off-screen — unseen, and it keeps the outgoing panel
    // about one screen wide, so the travel is one screen, not the whole wall.
    const colWidth = this.cell + this.gapX
    const leftEdge = this.scrollX - colWidth
    const rightEdge = this.scrollX + innerWidth + colWidth

    const kept: Entry[] = []
    for (const entry of this.entries) {
      const x = entry.mesh.position.x
      if (x < leftEdge || x > rightEdge) {
        this.disposeEntry(entry)
        continue
      }
      entry.legacy = true
      kept.push(entry)
    }
    this.entries = kept
    this.pending = []

    this.sweep = {
      direction,
      duration: SWEEP_MS,
      from: 0,
      phase: 'armed',
      start: 0,
      to: 0
    }
  }

  collapse() {
    if (!this.selected) return
    this.wake()
    this.selected = null
    this.tweenExpand(0)
    // The collapse tween normally clears `active`, but the loop only runs that
    // branch while `expandTo !== expand`. Collapsing before the open has had a
    // frame leaves both at 0, so `active` sticks and nothing can open again.
    if (this.expand === 0) this.active = null
    this.onSelect(null)
  }

  /** Total scrollable width of the wall, used to size the scroll spacer. */
  contentWidth() {
    // Counted, not filtered: this runs twice per frame and the array a
    // filter() allocates is pure garbage-collector pressure.
    let live = 0
    for (const entry of this.entries) if (!entry.legacy) live += 1
    const total = live + this.pending.length
    const span = Math.ceil(total / this.layoutRows) * (this.cell + this.gapX)
    // The span carries one gapX past the last column: 90px on desktop, which
    // reads as a margin. On a phone it is ~21px, and the first column starts a
    // gutter plus half a tile in, so the last column ended up 1px off the right
    // edge. Trailing space is `gapX + pad - gutter`, so this pad makes it
    // exactly `gutter` — the same margin at both ends, as in groupOffsetX.
    const pad = this.stacked ? Math.max(0, 2 * this.gutter - this.gapX) : 0
    return Math.max(0, span + pad)
  }

  destroy() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointerout', this.onPointerOut)
    window.removeEventListener('pointercancel', this.onPointerCancel)
    window.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('visibilitychange', this.onWake)
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.onWake
    )
    for (const entry of this.entries) this.disposeEntry(entry)
    this.entries = []
    this.geometry.dispose()
    this.renderer.dispose()
  }

  /**
   * Expand a tile by identity, as a tap does — the only way in without a mouse.
   *
   * Ignored rather than queued while a sweep or tween runs: pressing Enter
   * again beats acting on an intent the user may have moved on from.
   */
  open(pokemon: Pokemon) {
    if (this.active || this.sweep.phase !== 'idle') return
    const entry = this.entries.find(
      e => e.pokemon.id === pokemon.id && !e.legacy
    )
    // No `bend` guard here: that one exists because pick() raycasts undisplaced
    // geometry, and this knows the identity outright.
    if (entry) this.focusOn(entry.mesh, entry.pokemon, 'keyboard')
  }

  /**
   * Scroll offset that brings a tile into view, or null if it already is.
   *
   * Null for on-screen tiles is what stops the wall lurching as focus moves
   * down a column — the layout is column-major, so several tiles share an x.
   */
  scrollTargetFor(id: number) {
    // Mid-sweep the tiles are between panels, and a Lenis tween toward those
    // coordinates would sum with the sweep's own motion.
    if (this.sweep.phase !== 'idle') return null
    const entry = this.entries.find(e => e.pokemon.id === id && !e.legacy)
    if (!entry) return null

    const screenX = this.screenPosition(entry).x
    const pad = this.cell
    if (screenX >= pad && screenX <= innerWidth - pad) return null

    const centred = entry.mesh.position.x + this.cell - innerWidth / 2
    return Math.max(0, Math.min(centred, this.contentWidth() - innerWidth))
  }

  /** The focus ring, kept on its tile by the scene like the labels. */
  setFocusRingNode(node: HTMLElement | null) {
    this.focusNode = node
    this.wake()
  }

  /** Which tile the ring sits on, or null to hide it. */
  setFocusTarget(id: null | number) {
    this.focusId = id
    this.wake()
  }

  /**
   * React renders which labels exist; the scene positions them, because those
   * positions change every frame and belong on the animation clock, not state.
   */
  setLabelNodes(nodes: Map<number, HTMLElement>) {
    this.labelNodes = nodes
    this.wake()
  }

  /** Scroll position, pushed in by Lenis each frame. */
  setScroll(x: number) {
    this.scrollX = x
  }

  /**
   * Reconcile the wall against a result set, by id.
   *
   * During a sweep the incoming set is held and applied while the wall is
   * off-screen, so the swap is never seen. Outside one — paging in more of the
   * current results — tiles are simply appended.
   */
  sync(pokemon: Pokemon[], settled = true, queryKey = '') {
    this.wake()
    // A different query, not the next page of the same one — the distinction
    // that lets a refinement reflow in place instead of being appended.
    const fresh = queryKey !== this.queryKey

    // Blank wall — first load, or a search that matched nothing. Arm a sweep so
    // the results fly in on the curve a refinement rides, instead of appearing
    // in place.
    if (
      !this.reduce &&
      this.sweep.phase === 'idle' &&
      !this.entries.length &&
      pokemon.length
    ) {
      this.beginSweep(1)
    }

    if (this.sweep.phase === 'armed') {
      // The hook empties `items` the moment a query changes, before results
      // return; travelling toward that empty set would blank the wall. Hold the
      // outgoing panel until there is something to show, or a settled empty.
      if (!pokemon.length && !settled) return
      this.queryKey = queryKey
      this.startPanelTravel(pokemon)
      return
    }
    if (this.sweep.phase === 'building' || this.sweep.phase === 'travel') {
      if (fresh) {
        if (!pokemon.length && !settled) return
        this.queryKey = queryKey
        if (this.sweep.phase === 'travel') this.extendSweep(pokemon)
        // Still building the first panel, so nothing has moved yet and it can
        // simply be swapped rather than passed through.
        else this.restagePanel(pokemon)
        return
      }
      this.appendItems(pokemon)
      return
    }

    if (fresh) {
      // Same reason as the armed branch: don't reflow to the empty set the hook
      // leaves between queries.
      if (!pokemon.length && !settled) return
      this.queryKey = queryKey
    }
    this.applyItems(pokemon)
  }

  private advanceSweep(now: number) {
    const { phase } = this.sweep
    if (phase === 'idle') return
    if (phase === 'armed') return // waiting on the incoming results

    if (phase === 'building') {
      if (this.pending.length) return // still assembling off-screen
      const readiness = this.travelReadiness(now)
      if (readiness === 'wait') return
      if (readiness === 'cancel') {
        // Not worth carrying across: land the panel where it stands rather than
        // travelling a screen of tiles the shader would discard anyway.
        this.settleSweep()
        return
      }
      // No outgoing panel means the wall is arriving from nothing.
      const covered = this.entries.some(entry => entry.legacy)
      const travel = this.travelTime(this.panelOffsetX - this.sweepOffset)

      this.sweep = {
        ...this.sweep,
        duration: covered ? travel : travel * ENTRANCE_STRETCH,
        from: this.sweepOffset,
        phase: 'travel',
        start: now,
        to: this.panelOffsetX
      }
      return
    }

    const { from: f, start: st, to: dest } = this.sweep
    const t = Math.min(1, (now - st) / this.sweep.duration)
    this.sweepOffset = f + (dest - f) * SWEEP_EASE(t)
    if (t < 1) return

    this.settleSweep()
  }

  private appendItems(pokemon: Pokemon[]) {
    // Legacy tiles are excluded deliberately: they belong to the outgoing panel,
    // and a Pokemon in both must still be built here or it leaves a hole once
    // that panel goes. Without `pending`, a second page landing before the queue
    // drains re-queues everything in it — duplicate meshes on one slot.
    const present = new Set<number>()
    for (const entry of this.entries)
      if (!entry.legacy) present.add(entry.pokemon.id)
    for (const p of this.pending) present.add(p.id)
    const extra = pokemon.filter(p => !present.has(p.id))
    if (!extra.length) return
    for (const [index, p] of pokemon.entries())
      this.pendingSlots.set(p.id, index)
    this.pending.push(...extra)
  }

  /** Put the wall into the given set of Pokémon, with no transition. */
  private applyItems(pokemon: Pokemon[]) {
    const wanted = new Map(pokemon.map((p, index) => [p.id, index]))

    const survivors: Entry[] = []
    for (const entry of this.entries) {
      const slot = wanted.get(entry.pokemon.id)
      if (slot === undefined) {
        this.disposeEntry(entry)
        continue
      }
      entry.legacy = false
      if (entry.slot !== slot) {
        const position = this.slotPosition(slot)
        entry.mesh.position.x = position.x
        entry.mesh.position.y = position.y
        entry.slot = slot
      }
      survivors.push(entry)
    }
    this.entries = survivors

    const present = new Set(this.entries.map(e => e.pokemon.id))
    this.pending = pokemon.filter(p => !present.has(p.id))
    this.pendingSlots = wanted
    this.drainPending()
  }

  private applyTransform() {
    // The sweep rides on top of the scroll, so the warp — driven by the frame
    // delta of this position — bends the wall out and back, no separate effect.
    this.group.position.x = this.groupOffsetX()

    // Side by side on a wide screen; stacked on a narrow one, where half the
    // width left the artwork barely larger than the tile it grew from and the
    // details panel too narrow to read.
    if (this.stacked) {
      this.expandScale =
        Math.min(innerWidth * 0.86, innerHeight * 0.5 * 0.78) / this.cell
      this.expandCentre.set(0, innerHeight * 0.2)
    } else {
      this.expandScale =
        Math.min(innerWidth * 0.5 * 0.78, innerHeight * 0.78) / this.cell
      this.expandCentre.set((this.expandSide * innerWidth) / 4, 0)
    }
    // Gated: shortening the tween was not enough on its own — the other tiles
    // still flew a screen's diagonal, which is the movement the preference is
    // about. At 0 they stay put and simply fade.
    this.push = this.reduce ? 0 : Math.hypot(innerWidth, innerHeight) * 0.42

    const nowMs = performance.now()
    for (const entry of this.entries) {
      const material = entry.mesh.material
      const u = material.uniforms
      u.uBend.value = this.bend
      u.uHalf.value = innerWidth / 2
      u.uCamDist.value = this.camera.position.z
      u.uDepthNear.value = this.depthNear
      u.uFalloff.value = this.falloff
      u.uLift.value = this.lift
      u.uDepthFar.value = this.depthFar
      u.uExpand.value = this.expand
      // Reduced motion keeps the fade but drops the movement: geometry jumps to
      // wherever the gesture is heading instead of easing there.
      u.uExpandMove.value = this.reduce ? this.expandTo : this.expand
      // Full size under reduced motion, so the wall dissolves rather than
      // shrinking to a grid of thumbnails beside the opened one.
      u.uOthersScale.value = this.reduce ? 1 : 0.22
      u.uExpandCentre.value = this.expandCentre
      u.uExpandScale.value = this.expandScale
      u.uFocus.value = this.expandFocus
      u.uPush.value = this.push
      u.uSelected.value =
        this.active && this.active.id === entry.pokemon.id ? 1 : 0
      // The arrival fade is long because the entrance sweep normally covers it:
      // the wall waits until most tiles are painted, then flies in populated.
      // Reduced motion skips that sweep, so the fade is the only thing left and
      // 620ms of it per tile reads as slow loading. Shorten it to a state change.
      const revealSpan = this.reduce ? STATE_MS : REVEAL_MS
      u.uReveal.value = entry.revealStart
        ? EASE_IN_OUT(Math.min(1, (nowMs - entry.revealStart) / revealSpan))
        : 0
    }
  }

  /**
   * Three states, not two: the hovered tile in full colour, the rest of its
   * evolution family partway to grey, everything else dimmed. Pokemon that
   * never evolve have a chain to themselves, so only their own tile lights.
   */
  private dimFor(entry: Entry) {
    if (!this.hovered) return 0
    if (this.hovered.id === entry.pokemon.id) return 0
    return this.hovered.chainId === entry.pokemon.chainId ? FAMILY_DIM : 1
  }

  private disposeEntry(entry: Entry) {
    if (this.hovered?.id === entry.pokemon.id) {
      this.hovered = null
      this.onHover(null)
    }
    this.group.remove(entry.mesh)
    // The geometry is shared; only destroy() disposes it.
    const material = entry.mesh.material
    releaseTexture(material.uniforms.uMap.value as null | THREE.Texture)
    material.dispose()
  }

  private drainPending() {
    if (!this.pending.length) return
    const batch = this.pending.splice(0, BUILD_PER_FRAME)

    for (const p of batch) {
      const slot = this.pendingSlots.get(p.id) ?? this.entries.length
      const position = this.slotPosition(slot)
      // Newly built tiles belong to the incoming panel, which sits beside the
      // outgoing one until the travel completes and everything is renormalised.
      position.x += this.panelOffsetX

      const material = new THREE.ShaderMaterial({
        depthWrite: false,
        fragmentShader: FRAGMENT,
        transparent: true,
        uniforms: {
          uBend: { value: 0 },
          uCamDist: { value: 1 },
          uDepthFar: { value: DEPTH },
          uDepthNear: { value: DEPTH },
          uDim: { value: this.hovered ? 1 : 0 },
          uExpand: { value: 0 },
          uExpandCentre: { value: new THREE.Vector2() },
          uExpandMove: { value: 0 },
          uExpandScale: { value: 1 },
          uFalloff: { value: FALLOFF },
          uFocus: { value: new THREE.Vector2() },
          uHalf: { value: innerWidth / 2 },
          uHasMap: { value: 0 },
          uLift: { value: LIFT },
          uMap: { value: null },
          uOthersScale: { value: 0.22 },
          uPush: { value: 0 },
          uReveal: { value: 0 },
          uSelected: { value: 0 }
        },
        vertexShader: VERTEX
      })

      const mesh = new THREE.Mesh(this.geometry, material)
      mesh.scale.setScalar(this.cell / BASE_CELL)
      mesh.position.x = position.x
      mesh.position.y = position.y
      this.group.add(mesh)

      const startDim = this.hovered ? 1 : 0
      const startMask = this.labelMaskFor(p)
      const entry: Entry = {
        dimFrom: startDim,
        dimStart: 0,
        dimTo: startDim,
        legacy: false,
        mask: startMask,
        maskFrom: startMask,
        maskStart: 0,
        maskTo: startMask,
        mesh,
        pokemon: p,
        revealStart: 0,
        slot
      }
      this.entries.push(entry)

      const paint = (texture: THREE.Texture, reveal: boolean) => {
        if (this.disposed) {
          releaseTexture(texture)
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        // Thumbnails are sized to the tile, so they are drawn at about their
        // own resolution: a mip chain would add a third to every texture's
        // memory, and a GPU pass to every upload, for nothing visible.
        texture.generateMipmaps = false
        texture.minFilter = THREE.LinearFilter
        const previous = material.uniforms.uMap.value as null | THREE.Texture
        material.uniforms.uMap.value = texture
        material.uniforms.uHasMap.value = 1
        // Swapping in the full-size copy replaces the thumbnail, which nothing
        // else references by then.
        if (previous && previous !== texture) releaseTexture(previous)
        if (reveal) entry.revealStart = performance.now()
        // Long enough for the fade-in to finish before the loop rests.
        this.wake(REVEAL_MS + 100)
      }
      entry.paint = paint

      // Tile-sized to begin with; the proxy may be unreachable, in which case
      // the original still works — just heavier.
      this.loadTexture(
        thumbnailUrl(p.imageUrl, this.thumbWidth),
        texture => paint(texture, true),
        () => this.loadTexture(p.imageUrl, texture => paint(texture, true))
      )
    }
  }

  private draw() {
    if (this.disposed) return
    this.applyTransform()
    this.renderer.render(this.scene, this.camera)
  }

  /** Retargeting mid-flight eases from wherever the value currently is. */
  private easeDim(entry: Entry, wanted: number, now: number) {
    const material = entry.mesh.material
    if (entry.dimTo !== wanted) {
      entry.dimFrom = material.uniforms.uDim.value as number
      entry.dimTo = wanted
      entry.dimStart = now
    }
    const t = Math.min(1, (now - entry.dimStart) / DIM_MS)
    material.uniforms.uDim.value =
      entry.dimFrom + (entry.dimTo - entry.dimFrom) * EASE_IN_OUT(t)
  }

  /** On the same clock as the tile grey-out, so the two read as one gesture. */
  private easeMask(entry: Entry, now: number) {
    const wanted = this.labelMaskFor(entry.pokemon)
    if (entry.maskTo !== wanted) {
      entry.maskFrom = entry.mask
      entry.maskTo = wanted
      entry.maskStart = now
    }
    const t = Math.min(1, (now - entry.maskStart) / DIM_MS)
    entry.mask =
      entry.maskFrom + (entry.maskTo - entry.maskFrom) * EASE_IN_OUT(t)
    return entry.mask
  }

  /**
   * Carry a running sweep on to newer results instead of stopping and starting
   * again: the panel now flying in becomes something the view passes through,
   * the new one is laid out beyond it and the travel retargeted in the same
   * frame, so a burst of queries reads as one journey rather than arrivals.
   */
  private extendSweep(pokemon: Pokemon[]) {
    // Target panel still off-screen: swap its contents where it stands rather
    // than lay another beyond it. Invisible either way, and it keeps the
    // distance — and so the speed — bounded across a burst of refinements.
    if (this.panelOffsetX - this.sweepOffset > innerWidth) {
      const kept: Entry[] = []
      for (const entry of this.entries) {
        if (entry.legacy) kept.push(entry)
        else this.disposeEntry(entry)
      }
      this.entries = kept
      this.pending = []
      this.pendingSlots.clear()
      this.stagePanel(pokemon, true)
      return
    }

    for (const entry of this.entries) entry.legacy = true
    this.pending = []
    this.pendingSlots.clear()
    this.stagePanel(pokemon)
    // Retarget now, not when the build finishes: waiting lets the wall
    // decelerate into the target it is about to abandon — expo-out is nearly
    // stopped by then — the stutter this path exists to avoid. The new panel is
    // far off, so it has more cover to build in than the first one did.
    this.sweep = {
      ...this.sweep,
      duration: this.travelTime(this.panelOffsetX - this.sweepOffset),
      from: this.sweepOffset,
      start: performance.now(),
      to: this.panelOffsetX
    }
  }

  /** Expand a tile. Shared by the pointer path and by `open()`. */
  private focusOn(
    mesh: THREE.Mesh,
    pokemon: Pokemon,
    source: 'keyboard' | 'pointer'
  ) {
    const focusX = mesh.position.x + this.groupOffsetX()
    const side: -1 | 1 = focusX >= 0 ? 1 : -1
    this.wake()
    this.expandFocus.set(focusX, mesh.position.y)
    this.expandSide = side
    this.selected = pokemon
    this.active = pokemon
    this.upgradeArtwork(pokemon)
    this.tweenExpand(1)
    this.onSelect({ pokemon, side, source })
  }

  /**
   * Where the wall sits this frame — a method rather than a read of
   * `group.position.x`, which is a frame stale in `open()`: that runs from an
   * event handler, after `setScroll()` but before the next `applyTransform()`.
   */
  private groupOffsetX() {
    // Positions are tile centres, so half a cell puts the first column's left
    // edge on the gutter — aligned with the title above it on a phone. Wider
    // screens keep the plain inset, which reads as a margin, not an alignment.
    const inset = this.stacked ? this.gutter + this.cell / 2 : this.cell
    return -(this.scrollX + this.sweepOffset) - innerWidth / 2 + inset
  }

  /**
   * Whether anything is still in motion. Everything else that changes the
   * picture — a pointer, a texture arriving, a call from React — wakes the loop
   * itself.
   */
  private isMoving() {
    return (
      this.scrollX + this.sweepOffset !== this.lastScrollX ||
      this.velocity > 0.01 ||
      this.bend > 0.001 ||
      this.expand !== this.expandTo ||
      this.sweep.phase !== 'idle' ||
      this.pending.length > 0 ||
      (this.labelFade > 0 && this.labelFade < 1)
    )
  }

  /** Labels show for the hovered evolution family, or all when nothing is. */
  private labelMaskFor(pokemon: Pokemon) {
    if (!this.hovered) return 1
    return this.hovered.chainId === pokemon.chainId ? 1 : 0
  }

  private loadTexture(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onError?: () => void
  ) {
    if (!this.bitmapLoader) {
      this.loader.load(url, onLoad, undefined, onError)
      return
    }
    this.bitmapLoader.load(
      url,
      bitmap => {
        const texture = new THREE.Texture(bitmap)
        // Already flipped while decoding; WebGL ignores flipY for bitmaps.
        texture.flipY = false
        texture.needsUpdate = true
        onLoad(texture)
      },
      undefined,
      onError
    )
  }

  private loop = (time = 0) => {
    this.frame = requestAnimationFrame(this.loop)
    // Advance Lenis before anything reads the scroll, so position and the
    // velocity-driven warp stay in the same frame.
    this.onFrame?.(time)

    const now = performance.now()

    if (this.isMoving()) this.wake()
    if (now > this.awakeUntil) {
      // At rest, the last frame drawn is still the right one. The clock keeps
      // ticking, so the first frame back measures one real frame — exactly
      // what it would have measured had the loop never rested.
      this.lastFrameTime = now
      return
    }

    if (this.expandTo !== this.expand) {
      const span = this.reduce ? REDUCED_EXPAND_MS : EXPAND_MS
      const t = Math.min(1, (now - this.expandStart) / span)
      this.expand =
        this.expandFrom + (this.expandTo - this.expandFrom) * EASE_IN_OUT(t)
      if (t >= 1) {
        this.expand = this.expandTo
        if (this.expandTo === 0) this.active = null
      }
    }

    this.advanceSweep(now)

    // Frame-rate independent smoothing: a plain `x += (target - x) * rate`
    // converges twice as fast at 120Hz as at 60Hz. Normalised to 60Hz here.
    const dt = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 1 / 60
    this.lastFrameTime = now
    const frames = Math.min(4, Math.max(0.25, dt * 60))
    const decay = (rate: number) => 1 - Math.pow(1 - rate, frames)

    // Divided by `frames` for the same reason the decay is: the raw per-frame
    // delta at 120Hz is half the 60Hz one for the same real speed. The result
    // is pixels per 60Hz frame — the unit VELOCITY_FOR_FULL_BEND is in.
    const rendered = this.scrollX + this.sweepOffset
    const delta = (rendered - this.lastScrollX) / frames
    this.lastScrollX = rendered

    this.velocity += (Math.abs(delta) - this.velocity) * decay(0.25)
    const target = Math.min(1, this.velocity / VELOCITY_FOR_FULL_BEND)
    this.bend = this.reduce
      ? 0
      : this.bend +
        (target - this.bend) * decay(BEND_RATE)

    // Flat by the time the panel lands. Applied to `bend` itself: scaling only
    // the rendered value leaves the state untouched, so the phase flipping to
    // idle snaps the scale back to 1 and re-exposes the bend in one frame.
    if (this.sweep.phase === 'travel') {
      const left = 1 - (now - this.sweep.start) / this.sweep.duration
      this.bend *= Math.min(1, Math.max(0, left / SWEEP_FLATTEN))
    }

    this.drainPending()
    this.applyTransform()
    this.positionLabels(now, frames)
    this.positionFocusRing()
    this.updateHover()
    this.updateLabels()
    this.maybeLoadMore()

    this.renderer.render(this.scene, this.camera)
  }

  private maybeLoadMore() {
    if (this.sweep.phase !== 'idle') return
    if (this.scrollX > this.contentWidth() - innerWidth * 3) {
      this.onNeedMore()
    }
  }

  private measureLayout() {
    // Read rather than duplicated: --gutter is registered as a <length>, so the
    // computed value is a real pixel figure and the CSS stays the one source.
    const gutter = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--gutter')
    )
    if (Number.isFinite(gutter)) this.gutter = gutter

    const metrics = measureWall(innerWidth, innerHeight)
    this.cell = metrics.cell
    this.gapX = metrics.gapX
    this.gapY = metrics.gapY
    this.layoutRows = metrics.rows
    this.stacked = metrics.stacked
    this.falloff = metrics.stacked ? FALLOFF_NARROW : FALLOFF

    // Tiles already on the wall keep what they loaded; a resize rarely changes
    // the bucket, and refetching the whole wall for it would cost far more.
    const device = this.cell * Math.min(devicePixelRatio, 2)
    this.thumbWidth =
      THUMB_WIDTHS.find(width => width >= device) ??
      THUMB_WIDTHS[THUMB_WIDTHS.length - 1]
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.collapse()
  }

  private onWake = () => this.wake()

  private onPointerCancel = () => {
    this.pendingTap = null
    this.onPointerOut()
  }

  /**
   * Presses only arm a tap; onPointerUp decides whether it was one — acting
   * here opens a Pokemon on every touch scroll, since a scroll begins as a
   * press on whatever is under the finger.
   */
  private onPointerDown = (event: PointerEvent) => {
    this.wake()
    this.pendingTap = null
    if (event.button !== 0) return
    if (onOverlay(event)) return

    this.pendingTap = {
      id: event.pointerId,
      scroll: this.scrollX + this.sweepOffset,
      x: event.clientX,
      y: event.clientY
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    this.wake()
    this.overPointerOverlay = onOverlay(event)
    this.setPointer(event.clientX, event.clientY)
  }

  /** Park the pointer off-screen so nothing stays hovered. */
  private onPointerOut = () => {
    this.pointer.set(-10, -10)
    this.wake()
  }

  private onPointerUp = (event: PointerEvent) => {
    this.wake()
    const tap = this.pendingTap
    this.pendingTap = null
    if (!tap || tap.id !== event.pointerId) return
    if (onOverlay(event)) return

    // Two ways to disqualify a tap: the finger travelled, or the wall did.
    // The second matters when a release lands mid-fling — without it, grabbing
    // a moving wall to stop it would also open whatever it stopped on.
    if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP) {
      return
    }
    if (Math.abs(this.scrollX + this.sweepOffset - tap.scroll) > TAP_SLOP)
      return

    // Read coordinates from this event rather than trusting the last
    // pointermove: a touch tap fires with no move before it.
    this.setPointer(event.clientX, event.clientY)

    if (this.selected) {
      this.collapse()
      return
    }
    if (this.active) return // mid-collapse; ignore until it has landed
    if (this.bend > 0.25) return // mid-fling; the pick would not match the draw
    if (this.sweep.phase !== 'idle') return

    const hit = this.pick()
    if (!hit) return
    this.focusOn(hit.root, hit.pokemon, 'pointer')
  }

  private pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.group.children, false)
    const object = hits[0]?.object
    if (!object) return null
    const entry = this.entries.find(e => e.mesh === object && !e.legacy)
    return entry ? { pokemon: entry.pokemon, root: entry.mesh } : null
  }

  /**
   * Unlike the labels, the ring never hides while the wall moves: a focus
   * indicator that disappears mid-scroll is worse than one a pixel or two out,
   * and the focused tile is scrolled toward the middle where the warp is ~zero.
   */
  private positionFocusRing() {
    const node = this.focusNode
    if (!node) return

    const entry =
      this.focusId === null
        ? undefined
        : this.entries.find(e => e.pokemon.id === this.focusId && !e.legacy)

    // Staged tiles already carry panelOffsetX while sweepOffset is still 0, so
    // until the travel starts the ring would sit a screen off to the right.
    const staged =
      this.sweep.phase === 'armed' || this.sweep.phase === 'building'
    if (!entry || staged || this.expand > 0.01) {
      node.style.opacity = '0'
      return
    }

    const { x, y } = this.screenPosition(entry)
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`
    node.style.width = `${this.cell}px`
    node.style.height = `${this.cell}px`
    node.style.opacity = '1'
  }

  /**
   * Ride each label along with its tile, and fade it by how bent the wall is.
   * Opacity is eased here rather than by a CSS transition, which would be
   * restarted by the per-frame transform rewrite and so never actually play.
   */
  private positionLabels(now: number, frames: number) {
    const nodes = this.labelNodes
    if (!nodes?.size) return

    const offset = this.cell / 2 + 8
    // Advanced on the frame clock rather than by a fixed per-frame step, so the
    // fades take the same time at 120Hz as they do at 60.
    const elapsed = (frames / 60) * 1000

    this.labelsAtRest =
      this.reduce ||
      this.velocity < (this.labelsAtRest ? LABEL_HIDE_SPEED : LABEL_SHOW_SPEED)

    // Deliberately asymmetric. `expand` eases in and out and barely moves for
    // its first hundred milliseconds, so opening runs on its own short curve —
    // tied to `expand`, labels linger while the wall is already flying apart.
    // Closing tracks `expand`, so they return with the wall reassembling.
    this.expandMask =
      this.expandTo === 1
        ? Math.max(0, this.expandMask - elapsed / LABEL_OUT_MS)
        : 1 - this.expand

    const span = this.labelsAtRest ? LABEL_IN_MS : LABEL_OUT_MS
    const moved = (this.labelsAtRest ? elapsed : -elapsed) / span
    this.labelFade = Math.max(0, Math.min(1, this.labelFade + moved))

    // Smoothstep, not a decay chase. An exponential approach is at its fastest
    // on the very first frame and then crawls, which is what made the labels
    // lurch into view and then linger.
    const t = this.labelFade
    // Shared, because every label belongs to the same rest — a tile scrolling
    // into view arrives at the right opacity rather than starting its own fade.
    const shared = t * t * (3 - 2 * t) * this.expandMask

    for (const entry of this.entries) {
      if (entry.legacy) continue
      const node = nodes.get(entry.pokemon.id)
      if (!node) continue

      const { x, y } = this.screenPosition(entry)
      node.style.transform = `translate3d(${x}px, ${y + offset}px, 0)`
      node.style.opacity = (shared * this.easeMask(entry, now)).toFixed(3)
    }
  }

  private relayout() {
    this.relayoutPending = false
    const scale = this.cell / BASE_CELL
    for (const entry of this.entries) {
      const position = this.slotPosition(entry.slot)
      entry.mesh.position.x =
        position.x + (entry.legacy ? 0 : this.panelOffsetX)
      entry.mesh.position.y = position.y
      entry.mesh.scale.setScalar(scale)
    }
  }

  private resize = () => {
    const width = innerWidth
    const height = innerHeight
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    // One world unit == one CSS pixel at z = 0.
    this.camera.position.z =
      height / 2 / Math.tan((this.camera.fov * Math.PI) / 360)
    this.camera.updateProjectionMatrix()

    // Pick the far-side push so its apparent scaling is the exact reciprocal
    // of the near side's.
    const d = this.camera.position.z
    // Computed locally: `stacked` is only assigned in measureLayout, which runs
    // after this, so reading the field here would be one resize stale.
    const narrow = innerWidth < STACK_WIDTH
    this.lift = narrow ? LIFT_NARROW : LIFT
    this.depthNear = Math.min(narrow ? DEPTH_NARROW : DEPTH, d * 0.45)
    this.depthFar = (d * d) / (d - this.depthNear) - d

    this.measureLayout()
    // Mid-sweep the tiles are spread across two panels and a rebase, none of
    // which can be reconstructed from slot alone. Defer until it lands.
    if (this.sweep.phase === 'idle') this.relayout()
    else this.relayoutPending = true

    this.wake()
    this.draw()
  }

  private restagePanel(pokemon: Pokemon[]) {
    const kept: Entry[] = []
    for (const entry of this.entries) {
      if (entry.legacy) kept.push(entry)
      else this.disposeEntry(entry)
    }
    this.entries = kept
    this.pending = []
    this.pendingSlots.clear()
    this.panelOffsetX = 0
    this.stagePanel(pokemon)
  }

  /** Screen-space centre of a tile, in CSS pixels. */
  private screenPosition(entry: Entry) {
    return {
      x: innerWidth / 2 + entry.mesh.position.x + this.groupOffsetX(),
      y: innerHeight / 2 - entry.mesh.position.y
    }
  }

  private setPointer(clientX: number, clientY: number) {
    this.pointer.x = (clientX / innerWidth) * 2 - 1
    this.pointer.y = -(clientY / innerHeight) * 2 + 1
  }

  /**
   * Drop the outgoing panel and slide the incoming one back to the origin,
   * cancelling the offset in the same frame so nothing visibly moves. Must run
   * on an interrupted travel too: an unsettled sweep leaves the incoming panel
   * carrying the old panelOffsetX, which the next travel would measure against.
   */
  private settleSweep() {
    const survivors: Entry[] = []
    for (const entry of this.entries) {
      if (entry.legacy) {
        this.disposeEntry(entry)
        continue
      }
      entry.mesh.position.x -= this.panelOffsetX
      survivors.push(entry)
    }
    this.entries = survivors

    this.panelOffsetX = 0
    this.sweepOffset = 0
    this.lastScrollX = this.scrollX
    // Nothing is moving; without this the filter keeps feeding the tail of the
    // travel back into the warp for a few frames after the panel has landed.
    this.velocity = 0
    this.sweep = { ...this.sweep, from: 0, phase: 'idle', to: 0 }

    if (this.relayoutPending) this.relayout()
  }

  private slotPosition(slot: number) {
    const column = Math.floor(slot / this.layoutRows)
    const row = slot % this.layoutRows
    return new THREE.Vector2(
      column * (this.cell + this.gapX),
      ((this.layoutRows - 1) / 2 - row) * (this.cell + this.gapY)
    )
  }

  private stagePanel(pokemon: Pokemon[], keepOffset = false) {
    const colWidth = this.cell + this.gapX

    // Where the outgoing panel ends (or begins, when travelling backwards).
    let outgoingEnd = this.scrollX + innerWidth
    let outgoingStart = this.scrollX
    for (const entry of this.entries) {
      outgoingEnd = Math.max(outgoingEnd, entry.mesh.position.x + this.cell)
      outgoingStart = Math.min(outgoingStart, entry.mesh.position.x)
    }

    const width = Math.ceil(pokemon.length / this.layoutRows) * colWidth
    if (!keepOffset) {
      this.panelOffsetX =
        this.sweep.direction > 0
          ? outgoingEnd + this.gapX - this.scrollX
          : outgoingStart - this.gapX - width - this.scrollX
    }

    this.pendingSlots = new Map(pokemon.map((p, index) => [p.id, index]))
    this.pending = [...pokemon]
    // A whole page of meshes in the frame the sweep starts hitches at exactly
    // the moment the motion begins, and the panel is off-screen anyway: a page
    // of 60 at BUILD_PER_FRAME is five frames out of a travel of TRAVEL_MS.
    this.drainPending()
  }

  /**
   * Lay the incoming results out beside the outgoing ones and scroll across to
   * them, so the two panels read as one continuous strip rather than a swap in
   * place with a gap between.
   */
  private startPanelTravel(pokemon: Pokemon[]) {
    this.stagePanel(pokemon)
    // The travel begins once the panel is worth showing — see advanceSweep;
    // `start` doubles as the staging stamp until the travel branch resets it.
    this.sweep = { ...this.sweep, phase: 'building', start: performance.now() }
  }

  /**
   * Whether the staged panel is worth carrying across yet.
   *
   * A tile whose texture has not arrived is discarded outright by the fragment
   * shader, so setting off too early animates an empty screen and the Pokemon
   * then fade in at rest — worse than not animating at all. Only a blank wall
   * ever waits: during a search the outgoing panel covers it.
   */
  private travelReadiness(now: number): 'cancel' | 'go' | 'wait' {
    const onScreen =
      this.layoutRows * Math.ceil(innerWidth / (this.cell + this.gapX))
    let painted = 0
    let wanted = 0
    for (const entry of this.entries) {
      // Something is already on screen to look at, so depart now.
      if (entry.legacy) {
        if (entry.revealStart) return 'go'
        continue
      }
      if (entry.slot >= onScreen) continue
      wanted += 1
      if (entry.revealStart) painted += 1
    }
    if (!wanted) return 'cancel'
    if (painted >= wanted * PANEL_PAINTED) return 'go'
    // The proxy can be unreachable, and the fallback load carries no error
    // handler, so revealStart may never arrive. Give up rather than hang.
    return now - this.sweep.start < PANEL_WAIT_MS ? 'wait' : 'cancel'
  }

  /** How long a travel of this distance should take, so speed stays constant. */
  private travelTime(distance: number) {
    const screens = Math.abs(distance) / Math.max(1, innerWidth)
    return Math.max(SWEEP_MIN_MS, Math.min(SWEEP_MAX_MS, SWEEP_MS * screens))
  }

  private tweenExpand(to: number) {
    this.expandFrom = this.expand
    this.expandTo = to
    this.expandStart = performance.now()
  }

  private updateHover() {
    // The raycaster tests the flat, undisplaced geometry — it knows nothing of
    // the vertex-shader warp or the expand push. Bent or opened, it reports the
    // tile at the *unwarped* slot under the cursor, not the one drawn there.
    if (this.active || this.bend > 0.02 || this.overPointerOverlay) {
      if (this.hovered) {
        this.hovered = null
        this.onHover(null)
      }
      const now = performance.now()
      for (const entry of this.entries) this.easeDim(entry, 0, now)
      return
    }

    const found = this.pick()?.pokemon ?? null

    if (found?.id !== this.hovered?.id) {
      this.hovered = found
      this.onHover(found)
      this.wake()
    }

    const now = performance.now()
    for (const entry of this.entries)
      this.easeDim(entry, this.dimFor(entry), now)
  }

  /**
   * Publish which tiles deserve a label, whenever that set changes. Membership
   * is hashed first so the common case — nothing entered or left the screen —
   * costs one pass and allocates nothing.
   */
  private updateLabels() {
    if (!this.onLabels) return

    // Any tile with a sliver on screen, plus a tile's grace either side so one
    // entering the edge is already labelled rather than popping.
    const margin = this.cell * 1.5
    const visible = (entry: Entry) => {
      if (entry.legacy) return false
      const x = this.screenPosition(entry).x
      return x >= -margin && x <= innerWidth + margin
    }

    let hash = 0
    for (const entry of this.entries) {
      if (visible(entry)) hash = (hash * 31 + entry.pokemon.id) | 0
    }
    if (hash === this.labelHash) return
    this.labelHash = hash

    const labels: WallLabel[] = []
    for (const entry of this.entries) {
      if (!visible(entry)) continue
      const { x, y } = this.screenPosition(entry)
      labels.push({
        id: entry.pokemon.id,
        name: entry.pokemon.name,
        types: entry.pokemon.types,
        width: this.cell,
        x,
        y: y + this.cell / 2
      })
    }
    this.onLabels(labels)
  }

  /**
   * The wall runs on 320px thumbnails: ample at tile size, hopeless expanded.
   * Only the tile being looked at is upgraded, and without a reveal — it is
   * already visible, so a second fade would only draw attention to the swap.
   */
  private upgradeArtwork(pokemon: Pokemon) {
    const entry = this.entries.find(
      e => e.pokemon.id === pokemon.id && !e.legacy
    )
    if (!entry?.paint || entry.upgraded) return
    entry.upgraded = true
    const paint = entry.paint
    this.loadTexture(pokemon.imageUrl, texture => paint(texture, false))
  }

  /** Keep the loop drawing for at least this long. */
  private wake(ms = IDLE_GRACE_MS) {
    this.awakeUntil = Math.max(this.awakeUntil, performance.now() + ms)
  }
}

/** Free a texture's GPU copy, and an ImageBitmap's decoded pixels with it —
 *  a bitmap holds them until closed, where an <img> has no equivalent. */
function releaseTexture(texture: null | THREE.Texture) {
  if (!texture) return
  texture.dispose()
  if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap)
    texture.image.close()
}

/**
 * Whether createImageBitmap honours the options the wall decodes with. Safari
 * before 17 and Firefox before 98 ignore them and would hand back the artwork
 * upside down — the same check three's own GLTFLoader makes.
 */
function supportsImageBitmap() {
  if (typeof createImageBitmap === 'undefined') return false
  const agent = navigator.userAgent
  const safari = /^((?!chrome|android).)*safari/i.test(agent)
  const safariVersion = Number(agent.match(/Version\/(\d+)/)?.[1] ?? 0)
  const firefoxVersion = Number(agent.match(/Firefox\/(\d+)\./)?.[1] ?? 0)
  if (safari && safariVersion < 17) return false
  if (firefoxVersion && firefoxVersion < 98) return false
  return true
}
