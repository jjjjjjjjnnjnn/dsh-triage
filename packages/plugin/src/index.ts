/** Barrel for programmatic use of the plugin package (same code the CLI runs). */
export { loadBundleLayers, loadComposition, loadPatchText } from './load.js'
export type { BundleLayer, Composition, CompositionEntry } from './load.js'
/*
 * The package's MAIN entry is also its Cordis plugin (T-401 / R31): the profile patch row names
 * the bare package, because `dsh-client-modules` only discovers a browser half when the loader
 * entry's name is a bare package specifier. Without this re-export the row would mount an empty
 * module and the settings tab would never be composed.
 *
 * R36: there is no static `inject` to re-export any more — the route and the agent tool each gate
 * themselves through `ctx.inject`, so the row mounts in profiles that have only one of the two
 * services (see `host.ts`).
 */
export { apply, name } from './host.js'
export { default } from './host.js'
