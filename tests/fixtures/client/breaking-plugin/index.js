/**
 * Test fixture body (see package.json + cordis.patch.yml).
 *
 * It never runs: admission denies the row before the loader can import this module on any runtime
 * that the declared range excludes. The export exists so that a runtime which *does* accept the row
 * (a 9.x one) gets a mountable plugin instead of an import error — the fixture must fail for the
 * declared reason, never for a missing file.
 */
export const name = 'compat-breaking-fixture'

export function apply() {
  // Intentionally empty: this fixture exists to be judged, not to behave.
}
