/**
 * `--to next` / `--to latest` resolution (`docs/specs/M6-upgrade-day.md` C9, `T-806`).
 *
 * The whole risk of this feature is a quiet rewrite: "the registry says v0.3.0, we judged 0.3.0"
 * is the kind of drift that makes a published card untrue. So the tests pin three things:
 *
 *   - only two words ever reach the registry (`canary` is a usage error, not a lookup);
 *   - the resolved version is the registry's own string, verbatim (no `v` stripping, no `=`);
 *   - every refusal says which one it is, because "no such tag" and "registry down" are
 *     different sentences with different next actions.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DIST_TAG_PACKAGE, DIST_TAG_TARGETS, distTagTargetOf, resolveDistTagTarget } from '@dsh-triage/core'

const tags = { latest: '0.2.1-rc.2', next: '0.2.1-rc.4' }

test('only next and latest are dist-tag targets, and the package is named once', () => {
  assert.deepEqual([...DIST_TAG_TARGETS], ['next', 'latest'])
  assert.equal(DIST_TAG_PACKAGE, '@deepseek-ai/dsh')
  assert.equal(distTagTargetOf('next'), 'next')
  assert.equal(distTagTargetOf('  LATEST '), 'latest', 'whitespace and case are forgiven on input')
  for (const value of ['canary', 'rc', 'next.1', '^0.3.0', '0.3.0', '']) {
    assert.equal(distTagTargetOf(value), null, `"${value}" must not be treated as a tag target`)
  }
})

test('the resolved version is the registry string, verbatim', () => {
  const resolved = resolveDistTagTarget({ requested: 'next', distTags: tags })
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.ok ? { tag: resolved.tag, version: resolved.version } : null, {
    tag: 'next',
    version: '0.2.1-rc.4',
  })

  // A prerelease is an exact version: `0.3.0-rc.1` must survive unchanged.
  const prerelease = resolveDistTagTarget({ requested: 'latest', distTags: { latest: '0.3.0-rc.1' } })
  assert.equal(prerelease.ok && prerelease.version, '0.3.0-rc.1')
})

test('a value that is not already an exact version is refused, never normalised', () => {
  // `semver.valid('v0.3.0')` returns `0.3.0`; rewriting it would make the card disagree with the registry.
  for (const value of ['v0.3.0', '=0.3.0', '^0.3.0', '0.3', 'latest']) {
    const resolved = resolveDistTagTarget({ requested: 'next', distTags: { next: value } })
    assert.equal(resolved.ok, false, `"${value}" must be refused`)
    assert.equal(resolved.ok ? null : resolved.code, 'tag-not-exact')
  }
  // A blank value is not "a slightly wrong version": there is no tag to resolve.
  const blank = resolveDistTagTarget({ requested: 'next', distTags: { next: '  ' } })
  assert.equal(blank.ok ? null : blank.code, 'tag-missing')
})

test('a missing tag lists the tags that do exist, so the next action is obvious', () => {
  const resolved = resolveDistTagTarget({ requested: 'next', distTags: { latest: '0.2.1-rc.2' } })
  assert.equal(resolved.ok, false)
  assert.equal(resolved.ok ? null : resolved.code, 'tag-missing')
  assert.match(resolved.ok ? '' : resolved.detail, /latest/, 'the detail names the tags that are published')

  const empty = resolveDistTagTarget({ requested: 'latest', distTags: {} })
  assert.equal(empty.ok ? null : empty.code, 'tag-missing')
  assert.match(empty.ok ? '' : empty.detail, /no dist-tags at all/)
})

test('a non-tag request is refused as a usage error, before any lookup could happen', () => {
  const resolved = resolveDistTagTarget({ requested: 'canary', distTags: tags })
  assert.equal(resolved.ok, false)
  assert.equal(resolved.ok ? null : resolved.code, 'not-a-tag')
  assert.match(resolved.ok ? '' : resolved.detail, /only next \/ latest/)
})

test('resolution is pure: same input, same answer, and the input object is not mutated', () => {
  const frozen = Object.freeze({ ...tags })
  const first = resolveDistTagTarget({ requested: 'next', distTags: frozen })
  const second = resolveDistTagTarget({ requested: 'next', distTags: frozen })
  assert.deepEqual(first, second)
  assert.deepEqual(frozen, tags)
})
