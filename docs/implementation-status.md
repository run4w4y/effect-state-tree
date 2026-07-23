# Implementation status

This file maps the source-audited plan to the current workspace.

| Planned capability | Status |
| --- | --- |
| Effect v4 Schema-first immutable tree kernel | Implemented |
| Structural sharing, aliases, one-parent rules | Implemented and property-tested |
| Forward/inverse add/remove/replace patches | Implemented and round-trip tested |
| Patch values captured at emission | Implemented |
| Entity annotations, indexes, refs, anchored paths | Implemented |
| Identity-aware snapshot reconciliation | Implemented |
| Nested Schema path codecs | Implemented; canonical JSON projections use `Schema.toCodecJson` and transformed containers are explicit atomic boundaries |
| Custom immutable atomic interpreters | Implemented through `TreeSpec` options |
| Mutable-looking producer | Implemented as an optional package |
| Semantic object/splice/move/text operations | Implemented |
| Effect transactional runtime and streams | Implemented |
| Retry-safe guards and once-only sinks | Implemented |
| Definition-derived async actions with inherited commit metadata | Implemented |
| Path checkpoints and atomic conditional commits | Implemented |
| Native Schema lifecycle diagnostics | Implemented |
| Same-Schema mobx-keystone-style drafts | Implemented outside core, including checkpointed submit/refresh reconciliation |
| Undo/redo/grouping/attached state | Implemented outside core, including ordered tagged baselines |
| Provenance and echo suppression | Implemented outside core |
| Yjs backend | Implemented |
| Loro backend with native moves | Implemented |
| Persistence binding | Implemented |
| Versioned migrations and canonical persistence writeback | Implemented |
| LocalStorage, SessionStorage, and IndexedDB | Implemented through official Effect browser layers |
| Supervised CRDT readiness, health, failure, idle, and shutdown | Implemented |
| Backend-native local-intention undo | Implemented for Yjs and Loro |
| Programmatic devtools/time travel | Implemented |
| Effect Atom UI projection | Implemented against `effect/unstable/reactivity` with tree-provided Layers and native function atoms |
| Framework-specific adapters | Deliberately delegated to official Effect Atom binding packages |
| Foldkit pure reducer integration | Implemented without a runtime dependency |
| React todo application | Implemented under `apps/react-todo-example` |
| React Loro collaboration application | Implemented under `apps/react-loro-collaboration-example` |
| Action-owned HttpApi todo workflows and race-safe optimistic draft reconciliation | Implemented and covered by contract/browser tests |
| Arbitrary WebSocket collaboration peers and room isolation | Implemented and covered by multi-peer tests |
| StyleX example application components | Implemented with Rsbuild compilation |
| Playwright end-to-end suites | Implemented with Nix-provisioned Chromium |
| Nx, Bun, Rslib, Rsbuild, Biome, direnv, and Nix flake workspace | Implemented |

## Deliberate beta constraints

- Effect is pinned exactly to `4.0.0-beta.97`; Atom APIs are isolated because
  they are explicitly unstable.
- Foldkit `0.127.0` peers against Effect `4.0.0-beta.88`. The integration remains
  dependency-free until Foldkit aligns, avoiding duplicate Effect types and
  runtimes.
- Arrays, plain objects, primitives, and values handled by a registered
  `AtomicInterpreter` are admitted. Mutable native `Date` values are rejected
  unless the explicit compatibility interpreter is registered; its Date-like
  immutable proxy is intentionally not structured-cloneable. Traversal through
  arbitrary transformed Schema containers remains intentionally unsupported
  unless the value is treated as an atomic leaf.
- Effect v4 native filter checks are synchronous, so effectful lifecycle
  diagnostics remain future work; effectful Schema codecs are supported.
- Devtools is intentionally a framework-neutral data/controller layer. A
  browser overlay can consume its `StoreView` without entering the kernel.
- Network providers remain the responsibility of Yjs/Loro provider packages;
  the adapters operate on documents and are covered by in-memory convergence,
  rebase, echo-suppression, failure-supervision, and peer-local undo tests.
