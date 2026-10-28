import assert from 'node:assert/strict'
import { test } from 'node:test'
import { badgeText, renderBadge, summarizeEvidence, type ProbeRecord } from '../../packages/plugin/dist/badge.js'

/*
 * A badge is a pass claim in miniature, so the rules that matter are the ones that stop it from
 * claiming more than a run measured (M4-b / T-402).
 */

const record = (artifact: string, payload: ProbeRecord) => ({ artifact, payload })

const measured: ProbeRecord = {
  generated_at: '2026-10-28T22:50:00.000Z',
  candidate: { package: 'dsh-status-rotator', resolved: { version: '0.38.0' } },
  conclusion: 'go',
  runtime: { version: '0.2.1-rc.4' },
  timings: { bootToSampleMs: 11_500 },
}

test('the badge says the conclusion and the dsh it was measured against', () => {
  const evidence = summarizeEvidence('dsh-status-rotator', [record('probe-a.json', measured)])
  const text = badgeText(evidence)
  assert.equal(text.label, 'triage')
  assert.equal(text.message, 'go · dsh 0.2.1-rc.4')
  assert.equal(text.color, '#2ea44f')
})

test('no measurement renders "not measured" instead of a guess', () => {
  const evidence = summarizeEvidence('unmeasured-plugin', [])
  const text = badgeText(evidence)
  assert.equal(text.message, 'not measured')
  assert.equal(text.color, '#6e7781')
  // The SVG must carry the same sentence, and it must not name a version or a runtime it never saw.
  const svg = renderBadge(evidence)
  assert.match(svg, /not measured/u)
  assert.doesNotMatch(svg, /dsh \d/u)
})

test('the newest usable run wins, and a diagnostic-hook run is never used', () => {
  const newerButDiagnostic = {
    ...measured,
    generated_at: '2026-10-29T00:00:00.000Z',
    conclusion: 'blocked',
    sandbox: { hook_config: { resolveFrom: 'x' } },
  }
  const evidence = summarizeEvidence('dsh-status-rotator', [
    record('probe-old.json', measured),
    record('probe-diagnostic.json', newerButDiagnostic),
  ])
  assert.equal(evidence.conclusion, 'go', 'the diagnostic run must not count (R26 rule)')
  assert.equal(evidence.artifact, 'probe-old.json')
})

test('the newest real run wins over an older one', () => {
  const older = { ...measured, generated_at: '2026-10-01T00:00:00.000Z', conclusion: 'blocked' }
  const newer = { ...measured, generated_at: '2026-10-28T00:00:00.000Z', conclusion: 'unknown' }
  const evidence = summarizeEvidence('dsh-status-rotator', [record('probe-old.json', older), record('probe-new.json', newer)])
  assert.equal(evidence.conclusion, 'unknown')
  assert.equal(evidence.artifact, 'probe-new.json')
})

test('another package never leaks into the badge', () => {
  const other = { ...measured, candidate: { package: 'someone-else', resolved: { version: '1.0.0' } } }
  const evidence = summarizeEvidence('dsh-status-rotator', [record('probe-other.json', other)])
  assert.equal(evidence.conclusion, null)
  assert.equal(evidence.version, null)
})

test('an unknown conclusion in the artifact is not turned into a verdict', () => {
  const weird = { ...measured, conclusion: 'probably-fine' }
  const evidence = summarizeEvidence('dsh-status-rotator', [record('probe-weird.json', weird)])
  assert.equal(evidence.conclusion, null, 'only go/blocked/unknown may reach the badge')
})

test('rendering is deterministic and escapes what it prints', () => {
  const evidence = summarizeEvidence('evil<script>', [])
  const first = renderBadge(evidence)
  const second = renderBadge(evidence)
  assert.equal(first, second, 'same input, same bytes (badge artifacts are hashed)')
  const withMarkup = renderBadge({ ...evidence, package: 'a&b<c>', sampledAt: '2026-10-29T00:00:00.000Z' })
  assert.match(withMarkup, /a&amp;b&lt;c&gt;/u)
  assert.doesNotMatch(withMarkup, /<c>/u)
})

test('the tooltip carries the evidence pointer, not just the verdict', () => {
  const evidence = summarizeEvidence('dsh-status-rotator', [record('probe-a.json', measured)])
  const svg = renderBadge(evidence)
  assert.match(svg, /dsh-status-rotator@0\.38\.0/u)
  assert.match(svg, /boot→sample 11\.5s/u)
  assert.match(svg, /sampled 2026-10-28T22:50:00\.000Z/u)
  assert.match(svg, /probe-a\.json/u)
})
