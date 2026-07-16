import type { StoreView } from '@effect-state-tree/runtime'
import { useSyncExternalStore } from 'react'

/** Subscribes React to any framework-neutral reactive view. */
export const useStoreView = <A>(view: StoreView<A>): A =>
  useSyncExternalStore(view.subscribe, view.getSnapshot, view.getSnapshot)
