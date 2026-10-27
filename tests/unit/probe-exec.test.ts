import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { buildProbePlan } from '@dsh-triage/probe'
import type { ProbeExecDeps, ProbeRun, ProbeSampleView } from '@dsh-triage/probe'
import { executeProbe, isCandidateModule, judgeProbe, modulePackageName, probeAssertions, readSample } from '@dsh-triage/probe'

const realDshHome = join(tmpdir(), 'dsh-triage-probe-real', '.dsh')
const workRoot = join(tmpdir(), 'dsh-triage-probe')
const CANDIDATE = 'triage-probe-fixture-ok'
const CANDIDATE_PATH = 'tests/fixtures/probe/ok-plugin'

function plan() {
  const built = buildProbePlan({ candidate: CANDIDATE_PATH, realDshHome, workRoot })
  assert.ok(built.ok)
  if (!built.ok) throw new Error('plan failed')
  return built.value
}

/** The payload shape `scripts/probe_hooks/inventory-hook.mjs` writes. */
function hookPayload(entries: Array<{ entryId: string; moduleName: string; fiberPhase: string | null; enabled?: boolean }>) {
  return {
    kind: 'live',
    sampled_at: '2026-10-27T00:00:00.000Z',
    transport: 'in-process-projection',
    method: 'readPluginInventory',
    profile: 'probe',
    wait_ms: 1500,
    excluded: [],
    snapshot: {
      transport: 'in-process-projection',
      entries: entries.map((entry) => ({
        entryId: entry.entryId,
        moduleName: entry.moduleName,
        fiberPhase: entry.fiberPhase,
        enabled: entry.enabled ?? true,
      })),
    },
  }
}

const activeCandidate = hookPayload([
  { entryId: 'include:triage-probe-ok', moduleName: CANDIDATE, fiberPhase: 'active' },
  { entryId: 'include:base', moduleName: '@deepseek-ai/dsh-base', fiberPhase: 'active' },
])

interface FakeOptions {
  readonly deps?: Partial<ProbeExecDeps>
  readonly sample?: unknown | null
  readonly skipInstall?: boolean
}

async function runWith(options: FakeOptions = {}): Promise<{ run: ProbeRun; cleaned: boolean }> {
  let cleaned = false
  let clock = 0
  const deps: ProbeExecDeps = {
    now: () => {
      clock += 10
      return clock
    },
    readRuntimeVersion: async () => ({ version: '0.2.1-rc.4', detail: 'runtime 0.2.1-rc.4' }),
    install: async () => ({ exitCode: 0, detail: 'installed' }),
    bootAndSample: async () => ({
      sample: options.sample === undefined ? activeCandidate : options.sample,
      seconds: 7.2,
      detail: 'sampled',
    }),
    probeHttp: async () => ({ status: 303, detail: 'HTTP 303' }),
    cleanup: async () => {
      cleaned = true
      return { removed: true, portClosed: true, detail: 'sandbox removed' }
    },
    ...(options.deps ?? {}),
  }
  const run = await executeProbe(
    { plan: plan(), dshMain: '/fake/bin.js', candidatePackage: CANDIDATE, ...(options.skipInstall === true ? { skipInstall: true } : {}) },
    deps,
  )
  return { run, cleaned }
}

/* ------------------------------- green path ------------------------------- */

test('a clean candidate is decided go, with the limits spelled out', async () => {
  const { run } = await runWith()
  assert.equal(run.sample?.candidateRows.length, 1)
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'go')
  assert.equal(judgement.confidence.basis, 'measured-local')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.served'))
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.row-active'))
  assert.ok(judgement.evidence.some((evidence) => evidence.id === 'probe-boot'), 'boot evidence must be cited')
  assert.deepEqual(judgement.missingEvidence, [])
})

test('client-rendered and namespace-diff stay unmeasured, never passed', async () => {
  const { run } = await runWith()
  const assertions = probeAssertions(run)
  const byId = new Map(assertions.map((assertion) => [assertion.id, assertion.status]))
  assert.equal(byId.get('boot-sampled'), 'passed')
  assert.equal(byId.get('http-served'), 'passed')
  assert.equal(byId.get('inventory-active'), 'passed')
  assert.equal(byId.get('cleanup-complete'), 'passed')
  assert.equal(byId.get('client-rendered'), 'unmeasured', 'HTTP 200 is not a rendered UI (BS-03)')
  assert.equal(byId.get('namespace-diff'), 'unmeasured', 'tool surface lives in agent scope (BS-21)')
})

test('the 20s budget is measured spawn→sample, not the install', async () => {
  const { run } = await runWith({
    deps: {
      install: async () => ({ exitCode: 0, detail: 'installed' }),
      bootAndSample: async () => ({ sample: activeCandidate, seconds: 8.4, detail: 'sampled' }),
    },
  })
  assert.ok((run.timings.bootToSampleMs ?? Number.POSITIVE_INFINITY) < 20_000)
  assert.equal(run.timings.installMs !== null, true)
})

/* -------------------------------- failures -------------------------------- */

test('an install failure is blocked and still cleans the sandbox up', async () => {
  const { run, cleaned } = await runWith({ deps: { install: async () => ({ exitCode: 1, detail: 'pnpm exited 1' }) } })
  assert.equal(cleaned, true, 'cleanup must run even when install throws or fails')
  assert.ok(!run.steps.some((step) => step.id === 'boot'), 'a failed install must not boot')
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'blocked')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.install-failed'))
  assert.ok(judgement.remediation.length >= 1, 'blocked verdicts must offer a remediation')
})

test('a Host that never samples is a timeout, not a success', async () => {
  const { run } = await runWith({ sample: null })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'blocked')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.boot-timeout'))
  assert.equal(probeAssertions(run).find((item) => item.id === 'boot-sampled')?.status, 'failed')
})

test('an unreadable runtime stops before installing anything', async () => {
  const { run } = await runWith({ deps: { readRuntimeVersion: async () => ({ version: null, detail: 'node missing' }) } })
  assert.ok(!run.steps.some((step) => step.id === 'install'))
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'blocked')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.runtime-unavailable'))
})

test('a Host that answers nothing is http-unreachable', async () => {
  const { run } = await runWith({ deps: { probeHttp: async () => ({ status: null, detail: 'ECONNREFUSED' }) } })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'blocked')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.http-unreachable'))
})

test('a candidate that installs but produces no row is blocked, not "fine"', async () => {
  const { run } = await runWith({
    sample: hookPayload([{ entryId: 'include:base', moduleName: '@deepseek-ai/dsh-base', fiberPhase: 'active' }]),
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'blocked')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.row-missing'))
})

test('an apply-time failure names the row and its phase', async () => {
  const { run } = await runWith({
    sample: hookPayload([{ entryId: 'include:triage-probe-throw', moduleName: CANDIDATE, fiberPhase: 'failed' }]),
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'blocked')
  const reason = judgement.reasons.find((item) => item.messageId === 'probe.row-inactive')
  assert.ok(reason !== undefined)
  assert.equal(reason?.params?.phase, 'failed')
})

test('an import-time failure (phase null) is not rounded into "failed"', async () => {
  const { run } = await runWith({
    sample: hookPayload([{ entryId: 'include:triage-probe-broken', moduleName: CANDIDATE, fiberPhase: null }]),
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  const reason = judgement.reasons.find((item) => item.messageId === 'probe.row-inactive')
  assert.equal(reason?.params?.phase, 'none', 'a missing fiber and a failed fiber are different shapes')
})

test('two matching rows is unknown, never an invented attribution', async () => {
  const { run } = await runWith({
    sample: hookPayload([
      { entryId: 'include:a', moduleName: CANDIDATE, fiberPhase: 'active' },
      { entryId: 'include:b', moduleName: CANDIDATE, fiberPhase: 'active' },
    ]),
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'unknown')
  assert.ok(judgement.missingEvidence.includes('missing.row-identity'))
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.row-ambiguous'))
})

test('an unclean sandbox downgrades go to risky but keeps the measurement', async () => {
  const { run } = await runWith({
    deps: { cleanup: async () => ({ removed: false, portClosed: true, detail: 'EBUSY' }) },
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'risky')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.cleanup-incomplete'))
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.row-active'), 'the row reading still stands')
  assert.equal(probeAssertions(run).find((item) => item.id === 'cleanup-complete')?.status, 'failed')
})

test('a probe runtime outside the declared range downgrades the reading to unknown', async () => {
  const { run } = await runWith()
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z', declaredRange: '0.1.0' })
  assert.equal(judgement.conclusion, 'unknown')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.runtime-mismatch'))
  assert.ok(judgement.missingEvidence.length >= 1)
})

test('running without the install step is allowed and visible', async () => {
  const { run } = await runWith({ skipInstall: true })
  assert.equal(run.steps.find((step) => step.id === 'install')?.status, 'skipped')
  assert.equal(judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' }).conclusion, 'go')
})

test('a hook error payload is a failed measurement, not zero rows', () => {
  const view: ProbeSampleView = readSample(
    { kind: 'live', error: { name: 'Error', message: 'readPluginInventory threw' }, wait_ms: 10 },
    CANDIDATE,
    '/sandbox',
  )
  assert.equal(view.error, 'readPluginInventory threw')
  assert.equal(view.entries, 0)
  assert.equal(view.candidateRows.length, 0)
})

test('module names reduce to package names however the loader spelled them', () => {
  assert.equal(modulePackageName('triage-probe-fixture-ok'), 'triage-probe-fixture-ok')
  assert.equal(modulePackageName('@scope/pkg/sub/path'), '@scope/pkg')
  // A `file:` URL with no node_modules segment has no derivable package name.
  assert.equal(modulePackageName('file:///C:/x/ok-plugin/index.js'), '')
  assert.equal(modulePackageName('file:///tmp/x/node_modules/%40scope%2Fpkg/lib/index.js'), '@scope/pkg')
})

test('a linked candidate is still identified, and two matches stay ambiguous', () => {
  assert.equal(isCandidateModule('triage-probe-fixture-ok', 'triage-probe-fixture-ok'), true)
  assert.equal(isCandidateModule('file:///C:/Users/x/AppData/Local/Temp/opencode/r14/ok-plugin/index.js', 'ok-plugin'), true)
  assert.equal(isCandidateModule('@deepseek-ai/dsh-base', 'triage-probe-fixture-ok'), false)
  assert.equal(isCandidateModule('anything', ''), false)
})
