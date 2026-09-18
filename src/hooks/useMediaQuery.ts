import { useCallback, useSyncExternalStore } from 'react'

/**
 * `useSyncExternalStore` rather than state kept in sync by an effect: the
 * browser already holds this value, so mirroring it into React means a render
 * where the two disagree. The last argument is the server snapshot, for
 * pre-rendering.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query]
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
