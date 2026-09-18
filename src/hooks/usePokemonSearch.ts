import { useCallback, useEffect, useRef, useState } from 'react'

import type { Pokemon, PokemonResponse } from '@/lib/pokemon'

/** Short: this throttles requests only — the wall folds a refinement into the
 *  sweep already running, so it need not also cover the animation. */
const DEBOUNCE_MS = 300

type Query = { page: number; search: string }

type State = {
  error: null | string
  hasMore: boolean
  items: Pokemon[]
  status: Status
  total: number
}

type Status = 'error' | 'idle' | 'loading' | 'loading-more'

const INITIAL: State = {
  error: null,
  hasMore: true,
  items: [],
  status: 'loading',
  total: 0
}

/**
 * Paginated Pokémon search backed by `/api/pokemon`.
 *
 * Search and page live in one `Query` so a new search can never apply against a
 * stale page number. Requests are tagged and aborted on supersession — the API
 * answers in ~1ms locally, which hides out-of-order responses unless handled.
 */
export function usePokemonSearch(search: string, pageSize: number) {
  const debouncedSearch = useDebounced(search.trim(), DEBOUNCE_MS)
  const [query, setQuery] = useState<Query>({ page: 1, search: '' })
  const [state, setState] = useState<State>(INITIAL)

  // Monotonic token; only the newest in-flight request may commit to state.
  const requestIdRef = useRef(0)
  // Set synchronously inside loadMore. `status` only flips on the next render,
  // so two loadMore calls in the same frame would both see 'idle' and each
  // bump the page — skipping one entirely. This closes that window.
  const inFlightRef = useRef(false)

  useEffect(() => {
    // Guard on value, not identity: a fresh object would restart the fetch
    // effect on mount, firing a request only to abort it a tick later.
    inFlightRef.current = false
    // The updater returns `current` unchanged when the search has not moved, so
    // React bails out and no re-render happens — which is the cost the rule is
    // guarding against.
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setQuery(current =>
      current.search === debouncedSearch && current.page === 1
        ? current
        : { page: 1, search: debouncedSearch }
    )
  }, [debouncedSearch])

  useEffect(() => {
    const id = ++requestIdRef.current
    const controller = new AbortController()
    const isFirstPage = query.page === 1

    // Marking the request as in flight before awaiting it is the point of the
    // effect, not an accident of it.
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setState(prev => ({
      ...prev,
      error: null,
      items: isFirstPage ? [] : prev.items,
      status: isFirstPage ? 'loading' : 'loading-more'
    }))

    const params = new URLSearchParams({
      limit: String(pageSize),
      page: String(query.page)
    })
    if (query.search) params.set('search', query.search)

    fetch(`/api/pokemon?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`)
        return (await response.json()) as PokemonResponse
      })
      .then(({ data, pagination }) => {
        if (id !== requestIdRef.current) return // superseded
        inFlightRef.current = false

        setState(prev => {
          const merged = isFirstPage ? data : [...prev.items, ...data]

          // The fixture has unique ids, but a shifting result set between
          // pages could still repeat one. Dedupe rather than trust it.
          const seen = new Set<number>()
          const items = merged.filter(p =>
            seen.has(p.id) ? false : (seen.add(p.id), true)
          )

          return {
            error: null,
            hasMore: pagination.hasNext,
            items,
            status: 'idle',
            total: pagination.total
          }
        })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || id !== requestIdRef.current) return
        inFlightRef.current = false
        setState(prev => ({
          ...prev,
          error: cause instanceof Error ? cause.message : 'Something went wrong',
          status: 'error'
        }))
      })

    return () => controller.abort()
  }, [pageSize, query])

  // `loadMore` must stay referentially stable — the scene holds it for the life
  // of the wall — and must not queue an update from inside another updater,
  // since React may invoke an updater twice and skip a page.
  const latestRef = useRef(state)
  latestRef.current = state

  const loadMore = useCallback(() => {
    const { hasMore, status } = latestRef.current
    if (inFlightRef.current || status !== 'idle' || !hasMore) return
    inFlightRef.current = true
    setQuery(q => ({ ...q, page: q.page + 1 }))
  }, [])

  const retry = useCallback(() => {
    setQuery(q => ({ ...q }))
  }, [])

  return {
    /** The settled search term. Callers that drive animation must key off
     *  this, not the raw input, or they fire once per keystroke. */
    activeSearch: query.search,
    error: state.error,
    hasMore: state.hasMore,
    isLoading: state.status === 'loading',
    isLoadingMore: state.status === 'loading-more',
    items: state.items,
    loadMore,
    retry,
    // Both are resting states, so empty-state copy never flashes mid-request.
    settled: state.status === 'idle' || state.status === 'error',
    total: state.total
  }
}

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
