import Lenis from 'lenis'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Pokemon } from '@/lib/pokemon'
import type { WallLabel, WallSelection } from '@/wall/scene'

import { SCROLL_DURATION_S, SCROLL_EASE, WallScene } from '@/wall/scene'

/** Slop for "the wall has stopped", in px: the scroll eases in asymptotically. */
const END_SLOP = 2

type Options = {
  error: unknown
  hasMore: boolean
  onNeedMore: () => void
  reduceMotion: boolean
}

/**
 * Owns the WebGL scene and the Lenis scroller for their whole lifetime, and
 * keeps the scroll extent in step with a wall that grows as pages arrive: a
 * runway ahead of the loaded tiles, retired once the list completes.
 */
export function useWallScene({
  error,
  hasMore,
  onNeedMore,
  reduceMotion
}: Options) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const focusRingRef = useRef<HTMLDivElement>(null)
  /** The scene positions these itself, every frame. */
  const labelNodesRef = useRef(new Map<number, HTMLElement>())
  const lenisRef = useRef<Lenis | null>(null)
  const sceneRef = useRef<null | WallScene>(null)

  const measuredWidthRef = useRef(0)
  const pendingResizeRef = useRef(0)
  const reserveRef = useRef(0)
  /** Guards the one-shot settle onto the end of a completed list. */
  const settlingRef = useRef(false)

  /**
   * Bumped each time a scene is built. `sceneRef` is a stable object, so its
   * identity cannot tell the caller that the instance inside it was replaced —
   * and a rebuilt scene starts empty. Callers feeding it results depend on
   * this so they re-seed the new one.
   */
  const [sceneEpoch, setSceneEpoch] = useState(0)
  /** True when a WebGL context could not be created, so there is no wall. */
  const [webglFailed, setWebglFailed] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const [hovered, setHovered] = useState<null | Pokemon>(null)
  const [labels, setLabels] = useState<WallLabel[]>([])
  const [selection, setSelection] = useState<null | WallSelection>(null)

  // Mirrored rather than read from the closure: the frame callback is built
  // once, so the parameters would freeze at their first-render values and the
  // reserve would never retire.
  const hasMoreRef = useRef(hasMore)
  const erroredRef = useRef(false)
  hasMoreRef.current = hasMore
  erroredRef.current = Boolean(error)

  const resetExtent = useCallback(() => {
    measuredWidthRef.current = 0
    reserveRef.current = 0
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wrapper = wrapperRef.current
    const spacer = spacerRef.current
    if (!wrapper || !spacer) return

    // Lenis must exist before the scene's loop starts, since the loop drives it.
    // NOTE: `autoRaf` defaults to FALSE — without driving raf() ourselves the
    // instance listens to wheel events and never advances, so nothing scrolls.
    const lenis = new Lenis({
      content: spacer,
      gestureOrientation: 'both', // a vertical wheel drives the horizontal wall
      orientation: 'horizontal',
      // Both stay on in every mode. Turning them off hands scrolling back to the
      // browser, which also drops the gesture mapping above — a vertical wheel
      // would stop driving a horizontal wall, and the page would not scroll at
      // all. Reduced motion removes the easing below instead, not the mapping.
      smoothWheel: true,
      syncTouch: true,
      /* With syncTouch the drag runs at lerp 1 — Lenis applies `duration`/
         `easing` only on the wheel path — so a finger moves content
         one-for-one, and at ~100px columns one swipe threw nearly four past.
         0.6 lands a swipe at ~2.2 columns, against ~1.9 for a wheel notch. */
      touchMultiplier: 0.6,
      // Tiles are only 132px wide, so a full wheel notch at 1.0 threw the wall
      // several columns at once. Halved so one notch moves about one column.
      wheelMultiplier: 0.5,
      wrapper,
      // Reduced motion keeps every gesture working and removes only the glide:
      // lerp 1 lands the wall on the target in a single frame, and no inertia
      // survives the finger lifting. Otherwise, the sweep's own curve, so a
      // scroll and a search decelerate identically.
      ...(reduceMotion
        ? { lerp: 1, syncTouchLerp: 1, touchInertiaMultiplier: 0 }
        : { duration: SCROLL_DURATION_S, easing: SCROLL_EASE })
    })
    lenisRef.current = lenis

    // The scene's constructor starts its loop and calls onFrame before `const
    // scene` is initialised, so reading `scene` from that closure is a
    // temporal-dead-zone crash. Hence the holder, filled in just below.
    let live: null | WallScene = null

    let scene: WallScene
    try {
      scene = new WallScene({
        canvas,
        onFrame: time => {
          // NB: never call lenis.resize() here. Its implementation is
          //   resize() { this.dimensions.resize(); this.animatedScroll =
          //              this.targetScroll = this.actualScroll; this.emit() }
          // so it snaps the target onto the current position — which destroys an
          // in-flight fling. Called once per loaded page, that truncated every
          // forward scroll the moment new Pokemon arrived. dimensions.resize()
          // re-measures (and so updates `limit`) without touching scroll state.
          const content = live?.contentWidth() ?? 0
          if (content) {
            // A runway so the limit never sits exactly on the edge of loaded
            // content, collapsed once the list ends or a page fails — otherwise
            // the reserve relocates the stop into blank space with nothing there.
            const complete = !hasMoreRef.current || erroredRef.current
            const wantReserve = complete ? 0 : innerWidth * 2
            reserveRef.current += (wantReserve - reserveRef.current) * 0.06
            if (Math.abs(wantReserve - reserveRef.current) < 1) {
              reserveRef.current = wantReserve
            }

            let target = Math.round(content + reserveRef.current)

            // Never shrink the extent past where the user is heading — but only
            // while more is coming, or the wall stops wherever the reserve landed
            // and how far you can scroll depends on how fast you threw it.
            if (target < measuredWidthRef.current && !complete) {
              const safe = Math.round(lenis.targetScroll + innerWidth)
              target = Math.max(target, Math.min(measuredWidthRef.current, safe))
            }

            if (target !== measuredWidthRef.current) {
              measuredWidthRef.current = target
              spacer.style.width = `${target}px`
              // Re-measure a frame later: same-frame reads are stale.
              pendingResizeRef.current = 2
            }
            // Decoupled from the write above, so a target that keeps changing
            // can never starve the re-measure.
            if (pendingResizeRef.current > 0) {
              pendingResizeRef.current -= 1
              if (pendingResizeRef.current === 0) lenis.dimensions.resize()
            }

            // Lenis's `limit` only clamps new scrollTo calls, never a scroll
            // already in progress, so a fling past the last column would sit in
            // the blank runway. Ease onto the true end once, below.
            const maxScroll = Math.max(0, target - innerWidth)

            // "End" is a place, not a loading state — maxScroll carries the
            // reserve runway while more is coming, so it cannot be reached early.
            // Returning `prev` unchanged bails React out of a per-frame setState.
            const reached = maxScroll > 0 && lenis.scroll >= maxScroll - END_SLOP
            setAtEnd(prev => (prev === reached ? prev : reached))

            if (
              complete &&
              reserveRef.current === 0 &&
              lenis.targetScroll > maxScroll + 1
            ) {
              if (!settlingRef.current) {
                settlingRef.current = true
                lenis.scrollTo(maxScroll, {
                  duration: reduceMotion ? 0 : SCROLL_DURATION_S,
                  easing: SCROLL_EASE,
                  immediate: reduceMotion
                })
              }
            } else {
              settlingRef.current = false
            }
          }

          lenis.raf(time)
        },
        onHover: setHovered,
        // Only fires when a tile enters or leaves the screen; position and
        // opacity are the scene's business, every frame.
        onLabels: setLabels,
        onNeedMore,
          onSelect: next => setSelection(next),
          reduceMotion
        })
    } catch (cause) {
      // three.js throws here when the browser cannot give it a context — a
      // blocklisted GPU, a headless or remote session, WebGL switched off. The
      // canvas is the entire UI, so failing silently leaves a blank page.
      console.error('WebGL unavailable:', cause)
      lenis.destroy()
      lenisRef.current = null
      // eslint-disable-next-line @eslint-react/set-state-in-effect
      setWebglFailed(true)
      return
    }
    live = scene
    scene.setLabelNodes(labelNodesRef.current)
    scene.setFocusRingNode(focusRingRef.current)
    sceneRef.current = scene

    lenis.on('scroll', instance => scene.setScroll(instance.scroll))
    // Announce the new instance so results are fed into it. Setting state here
    // is the point of the effect: nothing else can know a scene was built.
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setSceneEpoch(n => n + 1)

    return () => {
      lenis.destroy()
      lenisRef.current = null
      scene.destroy()
      sceneRef.current = null
    }
    // A preference flip is a once-a-session event, so rebuilding the scene is
    // cheaper to reason about than threading a setter through every timing.
  }, [onNeedMore, reduceMotion])

  return {
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
  }
}
