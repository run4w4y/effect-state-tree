import type { TreeValue } from '@effect-state-tree/core'
import { pathsOverlap, type TreePath } from '@effect-state-tree/core'
import type { SelectOptions, TreeStore } from '@effect-state-tree/runtime'
import type { Schema } from 'effect'
import { useRef, useSyncExternalStore } from 'react'

interface SelectorBinding<S extends Schema.Constraint, A> {
  readonly store: TreeStore<S>
  selector: (snapshot: TreeValue<S>) => A
  equals: (left: A, right: A) => boolean
  paths: ReadonlyArray<TreePath> | undefined
  selected: A
  version: number
  readonly refresh: () => void
  readonly reconcile: () => number
  readonly getVersion: () => number
  readonly subscribe: (listener: () => void) => () => void
}

const watchesChange = (
  watched: ReadonlyArray<TreePath> | undefined,
  touched: ReadonlyArray<TreePath>
): boolean =>
  watched === undefined ||
  watched.length === 0 ||
  watched.some((dependency) =>
    touched.some((path) => pathsOverlap(dependency, path))
  )

const makeSelectorBinding = <S extends Schema.Constraint, A>(
  store: TreeStore<S>,
  selector: (snapshot: TreeValue<S>) => A,
  equals: (left: A, right: A) => boolean,
  paths: ReadonlyArray<TreePath> | undefined
): SelectorBinding<S, A> => {
  const binding: SelectorBinding<S, A> = {
    store,
    selector,
    equals,
    paths,
    selected: selector(store.getSnapshot()),
    version: 0,
    refresh: () => {
      const next = binding.selector(store.getSnapshot())
      if (!binding.equals(binding.selected, next)) binding.selected = next
    },
    reconcile: () => {
      const next = binding.selector(store.getSnapshot())
      if (binding.equals(binding.selected, next)) return binding.version
      binding.selected = next
      binding.version += 1
      return binding.version
    },
    getVersion: () => binding.version,
    subscribe: (listener) => {
      const publishIfChanged = (): void => {
        const previousVersion = binding.version
        binding.reconcile()
        if (binding.version !== previousVersion) listener()
      }
      const unsubscribe = store.subscribe((commit) => {
        if (watchesChange(binding.paths, commit.touchedPaths)) {
          publishIfChanged()
        }
      })

      // Close the render-to-subscribe race without making getVersion impure.
      // React requires a cached snapshot from useSyncExternalStore; selectors
      // such as Array.filter legitimately return a fresh value every run.
      publishIfChanged()
      return unsubscribe
    },
  }
  return binding
}

/**
 * Subscribes React to one path-aware tree projection. Selector and options
 * updates are read through a retained subscription, so inline selectors never
 * need useMemo and unrelated parent renders do not resubscribe the store.
 */
export const useTreeSelector = <S extends Schema.Constraint, A>(
  store: TreeStore<S>,
  selector: (snapshot: TreeValue<S>) => A,
  options: SelectOptions<A> = {}
): A => {
  const equals = options.equals ?? Object.is
  const paths = options.paths
  const bindingRef = useRef<SelectorBinding<S, A> | undefined>(undefined)
  let binding = bindingRef.current

  if (binding === undefined || binding.store !== store) {
    binding = makeSelectorBinding(store, selector, equals, paths)
    bindingRef.current = binding
  } else {
    binding.selector = selector
    binding.equals = equals
    binding.paths = paths
    // Selector closures are component inputs, not external-store events. Keep
    // their projection current without mutating React's cached store version.
    binding.refresh()
  }

  useSyncExternalStore(
    binding.subscribe,
    binding.getVersion,
    binding.getVersion
  )
  return binding.selected
}

const selectSnapshot = <A>(snapshot: A): A => snapshot

/** Subscribes React to the complete immutable tree snapshot. */
export const useTreeSnapshot = <S extends Schema.Constraint>(
  store: TreeStore<S>
): TreeValue<S> => useTreeSelector(store, selectSnapshot)
