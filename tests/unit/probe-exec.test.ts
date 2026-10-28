import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { buildProbePlan } from '@dsh-triage/probe'
import type { ProbeExecDeps, ProbeRun, ProbeSampleView } from '@dsh-triage/probe'
import {
  bindFailedPorts,
  diagnosisFromText,
  executeProbe,
  failureEndpoints,
  installDiagnosis,
  isCandidateModule,
  isUsableSample,
  judgeProbe,
  modulePackageName,
  probeAssertions,
  readSample,
  sanitizeLogLine,
} from '@dsh-triage/probe'

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

/** The payload shape `inventory-hook.mjs` writes (R17 adds `settled`/`attempts`/error code). */
function hookPayload(
  entries: Array<{ entryId: string; moduleName: string; fiberPhase: string | null; enabled?: boolean }>,
  extras: {
    readonly settled?: boolean
    readonly error?: string
    readonly errorCode?: string
    readonly attempts?: number
    readonly applies?: number
    readonly waitMs?: number
  } = {},
) {
  const base = {
    kind: 'live',
    sampled_at: '2026-10-27T00:00:00.000Z',
    transport: 'in-process-projection',
    method: 'readPluginInventory',
    profile: 'probe',
    wait_ms: extras.waitMs ?? 1500,
    excluded: [],
    applies: extras.applies ?? 1,
    ...(extras.settled === undefined ? {} : { settled: extras.settled }),
    ...(extras.attempts === undefined
      ? {}
      : { attempts: Array.from({ length: extras.attempts }, (_unused, index) => ({ n: index + 1, ok: true })) }),
  }
  if (extras.error !== undefined) {
    return {
      ...base,
      settled: extras.settled ?? false,
      attempts: [{ n: 1, ok: false, code: extras.errorCode ?? 'other', error: extras.error }],
      error: { code: extras.errorCode ?? 'other', message: extras.error, attempts: 1 },
    }
  }
  return {
    ...base,
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

test('client-rendered stays unmeasured when the probe had no browser', async () => {
  const { run } = await runWith()
  const assertions = probeAssertions(run)
  const byId = new Map(assertions.map((assertion) => [assertion.id, assertion.status]))
  assert.equal(byId.get('boot-sampled'), 'passed')
  assert.equal(byId.get('http-served'), 'passed')
  assert.equal(byId.get('inventory-active'), 'passed')
  assert.equal(byId.get('cleanup-complete'), 'passed')
  assert.equal(byId.get('client-rendered'), 'unmeasured', 'no browser means no answer, not a pass (BS-03)')
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

/* ------------------------ install failure endpoints (T-305b) ---------------- */

test('a failed install names the endpoints it tried, from the diagnostics log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triage-endpoints-'))
  try {
    const log = join(dir, 'pnpm.log')
    writeFileSync(log, 'ERR_PNPM_RESOLVING_NPM_RESOLVER_NETWORK_ERROR\nFailed to fetch metadata from http://127.0.0.1:1/dsh-cost-meter\n', 'utf8')
    const endpoints = failureEndpoints(`dsh: plugin command failed; diagnostics: ${log}\n`)
    assert.deepEqual(endpoints, ['http://127.0.0.1:1/dsh-cost-meter'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('credentials, query strings and fragments never leave this layer', () => {
  const endpoints = failureEndpoints('GET https://user:secret@registry.example/pkg?token=abc#frag failed')
  assert.deepEqual(endpoints, ['https://registry.example/pkg'])
})

test('no URL at all is an empty list, not a guess', () => {
  assert.deepEqual(failureEndpoints('install failed with exit 1'), [])
  assert.equal(failureEndpoints('https://a.example/1 https://b.example/2 https://c.example/3 https://d.example/4 https://e.example/5 https://f.example/6').length, 5)
})

test('trailing punctuation from pnpm logs is not part of the endpoint', () => {
  assert.deepEqual(failureEndpoints('Failed to fetch metadata from http://127.0.0.1:1/dsh-cost-meter: error'), [
    'http://127.0.0.1:1/dsh-cost-meter',
  ])
})

/* --------------------- install failure diagnosis (T-310) -------------------- */

test('the package manager code is read from the launcher, where it actually is', () => {
  // Measured in R19 against @aiwayds/dsh-cron@0.6.1 (fixture is the real stderr, sandbox
  // path replaced by <sandbox>): the code is on the launcher's stderr, and the diagnostics
  // log named in the last line contains only "Command failed".
  const launcher = readFileSync(new URL('../fixtures/probe/install-failure/ignored-builds.stderr.txt', import.meta.url), 'utf8')
  const log = readFileSync(new URL('../fixtures/probe/install-failure/ignored-builds.pnpm-log.txt', import.meta.url), 'utf8')
  const diagnosis = diagnosisFromText({ launcher, log })
  assert.equal(diagnosis.code, 'ERR_PNPM_IGNORED_BUILDS')
  assert.equal(diagnosis.source, 'launcher', 'the log drops the code, so the launcher has to win')
  // The code line alone is a dead end; the cause is the line below it.
  assert.equal(diagnosis.key_line, 'Ignored build scripts: @aiwayds/dsh-cron@0.6.1')
})

test('a code line that explains itself is not replaced by the next line', () => {
  const diagnosis = diagnosisFromText({
    launcher: 'ERR_PNPM_FETCH_404 GET https://registry.example/@scope/pkg: Not Found — 404\n',
  })
  assert.equal(diagnosis.code, 'ERR_PNPM_FETCH_404')
  assert.match(diagnosis.key_line ?? '', /^ERR_PNPM_FETCH_404 GET https:\/\/registry\.example\/@scope\/pkg: Not Found/)
})

test('the harness line is never the explanation, even when it is the loudest one', () => {
  // Measured shape (R19, missing package): "Error: ERR_PNPM_…" alone, then pnpm's block,
  // then the launcher's own `dsh: plugin command failed; diagnostics: <path>`.
  const diagnosis = diagnosisFromText({
    launcher: [
      'Error: ERR_PNPM_RESOLVING_NPM_RESOLVER_NETWORK_ERROR',
      '',
      '  × adding a new package',
      '  ╰─▶ Failed to fetch metadata',
      'dsh: plugin command failed; diagnostics: C:\\Temp\\x\\pnpm.log',
    ].join('\n'),
  })
  assert.equal(diagnosis.code, 'ERR_PNPM_RESOLVING_NPM_RESOLVER_NETWORK_ERROR')
  assert.equal(diagnosis.key_line, 'Failed to fetch metadata')
  assert.doesNotMatch(diagnosis.key_line ?? '', /^dsh:/)
})

test('a plain sentence below the code is accepted as the explanation', () => {
  const diagnosis = diagnosisFromText({
    launcher: 'Error: ERR_PNPM_NO_MATCHING_VERSION\nNo matching version found for dsh-plugin-model-proxy@99.99.99\n',
  })
  assert.equal(diagnosis.code, 'ERR_PNPM_NO_MATCHING_VERSION')
  assert.equal(diagnosis.key_line, 'No matching version found for dsh-plugin-model-proxy@99.99.99')
})

test('a code that only the diagnostics log carries is found, and labelled as such', () => {
  const diagnosis = diagnosisFromText({
    launcher: 'dsh: plugin command failed; diagnostics: C:\\Temp\\x\\pnpm.log\n',
    log: 'ERR_PNPM_FETCH_404 GET https://registry.example/@scope/pkg: not found\n',
  })
  assert.equal(diagnosis.code, 'ERR_PNPM_FETCH_404')
  assert.equal(diagnosis.source, 'diagnostics-log')
})

test('no code at all falls back to the loudest line, and invents nothing', () => {
  const diagnosis = diagnosisFromText({ launcher: 'resolving packages\npnpm failed to resolve\n' })
  assert.equal(diagnosis.code, null)
  assert.equal(diagnosis.source, 'launcher')
  assert.equal(diagnosis.key_line, 'pnpm failed to resolve')
  // No error-shaped line at all: the first line is the honest answer, not an empty string.
  assert.equal(diagnosisFromText({ launcher: 'resolving packages\n' }).key_line, 'resolving packages')
  assert.equal(diagnosisFromText({ launcher: '  \n\n' }).source, 'none')
})

test('credentials and query strings never survive into the key line', () => {
  const diagnosis = diagnosisFromText({
    launcher: 'Error: ERR_PNPM_META_FETCH_FAIL GET https://user:secret@registry.example/pkg?token=abc: failed\n',
  })
  assert.equal(diagnosis.code, 'ERR_PNPM_META_FETCH_FAIL')
  assert.ok(!(diagnosis.key_line ?? '').includes('secret'), 'userinfo must be stripped')
  assert.ok(!(diagnosis.key_line ?? '').includes('token=abc'), 'query strings must be stripped')
  assert.match(diagnosis.key_line ?? '', /https:\/\/registry\.example\/pkg/)
})

test('installDiagnosis reads the named diagnostics log, and survives a missing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triage-diagnosis-'))
  try {
    const log = join(dir, 'pnpm.log')
    writeFileSync(log, 'ERR_PNPM_OUTDATED_LOCKFILE cannot install with frozen-lockfile\n', 'utf8')
    const diagnosis = installDiagnosis(`dsh: plugin command failed; diagnostics: ${log}\n`)
    assert.equal(diagnosis.code, 'ERR_PNPM_OUTDATED_LOCKFILE')
    assert.equal(diagnosis.source, 'diagnostics-log')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const missing = installDiagnosis(`dsh: plugin command failed; diagnostics: ${join(tmpdir(), 'nope', 'x.log')}\n`)
  assert.equal(missing.code, null)
  assert.equal(missing.source, 'launcher')
})

test('an IGNORED_BUILDS refusal is a build-policy refusal, not a broken plugin', async () => {
  const { run } = await runWith({
    deps: {
      install: async () => ({
        exitCode: 1,
        detail: 'dsh: plugin command failed',
        diagnosis: {
          code: 'ERR_PNPM_IGNORED_BUILDS',
          key_line: 'Ignored build scripts: @aiwayds/dsh-cron@0.6.1',
          source: 'launcher',
        },
      }),
    },
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'blocked', 'it still cannot run here, so it is not a go')
  const reason = judgement.reasons.find((item) => item.messageId === 'probe.install-build-refused')
  assert.ok(reason, 'the refusal has its own message: the next action is different from a 404')
  assert.equal(reason?.params?.code, 'ERR_PNPM_IGNORED_BUILDS')
  assert.ok(judgement.remediation.some((item) => item.messageId === 'remediation.install-build-refused'))
  assert.ok(
    judgement.evidence.some((item) => item.id === 'probe-install-diagnosis'),
    'the reason has to be cited as evidence, not asserted',
  )
})

test('a generic package-manager code rides into the reason instead of a bare exit 1', async () => {
  const { run } = await runWith({
    deps: {
      install: async () => ({
        exitCode: 1,
        detail: 'dsh: plugin command failed',
        diagnosis: { code: 'ERR_PNPM_FETCH_404', key_line: 'GET https://registry.example/pkg: not found', source: 'launcher' },
      }),
    },
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  const reason = judgement.reasons.find((item) => item.messageId === 'probe.install-failed-code')
  assert.ok(reason)
  assert.equal(reason?.params?.code, 'ERR_PNPM_FETCH_404')
  assert.equal(reason?.params?.exit, 1)
  assert.ok(!judgement.reasons.some((item) => item.messageId === 'probe.install-failed'), 'one install reason, not two')
})

test('an install that failed with nothing to read keeps the old message', async () => {
  const { run } = await runWith({
    deps: {
      install: async () => ({ exitCode: 1, detail: 'exit 1', diagnosis: { code: null, key_line: null, source: 'none' } }),
    },
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.ok(judgement.reasons.some((item) => item.messageId === 'probe.install-failed'))
  assert.ok(!judgement.evidence.some((item) => item.id === 'probe-install-diagnosis'), 'nothing to cite when nothing was said')
})

/* --------------------------- client render (T-302) ------------------------- */

const renderedCheck = { state: 'rendered' as const, detail: 'mount root with 1 child(ren), 320 visible chars', ms: 1_400, signals: null }
const blankCheck = { state: 'blank' as const, detail: 'mount point "root" has no children', ms: 900, signals: null }
const inconclusiveCheck = { state: 'inconclusive' as const, detail: 'the browser never opened a debugging port', ms: 20_000, signals: null }

test('a rendered page is an info reason, and the segment is timed separately', async () => {
  const { run } = await runWith({
    deps: { bootAndSample: async () => ({ sample: activeCandidate, seconds: 8.1, detail: 'sampled', http: { status: 401, detail: 'HTTP 401' }, render: renderedCheck }) },
  })
  assert.equal(run.timings.renderMs !== null, true)
  assert.ok((run.timings.renderMs ?? 0) < 20_000, 'the render segment must not be folded into the boot budget')
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'go')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.render-ok'))
  assert.equal(probeAssertions(run).find((item) => item.id === 'client-rendered')?.status, 'passed')
})

test('HTTP answered and the row is active, but the page is blank: blocked', async () => {
  const { run } = await runWith({
    deps: { bootAndSample: async () => ({ sample: activeCandidate, seconds: 8.1, detail: 'sampled', http: { status: 401, detail: 'HTTP 401' }, render: blankCheck }) },
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'blocked', 'a white screen is the BS-03 case, not a go')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.render-blank'))
  assert.equal(probeAssertions(run).find((item) => item.id === 'client-rendered')?.status, 'failed')
})

test('a render check that cannot conclude downgrades to unknown, never to go', async () => {
  const { run } = await runWith({
    deps: { bootAndSample: async () => ({ sample: activeCandidate, seconds: 8.1, detail: 'sampled', http: { status: 401, detail: 'HTTP 401' }, render: inconclusiveCheck }) },
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'unknown')
  assert.ok(judgement.missingEvidence.includes('missing.render'))
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.render-unmeasured'))
})

test('skipping the render check leaves the conclusion alone and says why', async () => {
  const { run } = await runWith({
    deps: {
      bootAndSample: async () => ({
        sample: activeCandidate,
        seconds: 8.1,
        detail: 'sampled',
        http: { status: 401, detail: 'HTTP 401' },
        renderSkipped: 'no Chromium-family browser was found on this machine',
      }),
    },
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'go')
  const assertion = probeAssertions(run).find((item) => item.id === 'client-rendered')
  assert.equal(assertion?.status, 'unmeasured')
  assert.match(String(assertion?.detail), /no Chromium-family browser/)
})

/* --------------------------- readiness source (T-306) --------------------- */

test('the readiness port comes from the Host and cleanup checks every port it used', async () => {
  const observed: { cleanup: { port: number; extraPorts?: readonly number[] } | null } = { cleanup: null }
  const { run } = await runWith({
    deps: {
      bootAndSample: async () => ({
        sample: activeCandidate,
        seconds: 8.1,
        detail: 'sampled',
        http: { status: 303, detail: 'HTTP 303' },
        readiness: { source: 'host-url' as const, port: 53997, outcome: 'served' as const, waited_ms: 12, window_ms: 5000, url_seen: true },
      }),
      cleanup: async (input) => {
        observed.cleanup = { port: input.port, ...(input.extraPorts === undefined ? {} : { extraPorts: input.extraPorts }) }
        return { removed: true, portClosed: true, detail: 'sandbox removed · port closed' }
      },
    },
  })
  assert.equal(run.readiness?.source, 'host-url')
  assert.equal(observed.cleanup?.extraPorts?.includes(53997), true, 'the port the Host actually used must be proven closed too')
})

test('a Host port that differs from the plan is reported, and the conclusion follows the measurement', async () => {
  const { run } = await runWith({
    deps: {
      bootAndSample: async () => ({
        sample: activeCandidate,
        seconds: 8.1,
        detail: 'sampled',
        http: { status: 401, detail: 'HTTP 401' },
        readiness: { source: 'host-url' as const, port: 53997, outcome: 'served' as const, waited_ms: 12, window_ms: 5000, url_seen: true },
        render: renderedCheck,
      }),
    },
  })
  const judgement = judgeProbe({ run, at: '2026-10-27T00:00:00.000Z' })
  assert.equal(judgement.conclusion, 'go', 'a port difference is a warning, not a verdict')
  const reason = judgement.reasons.find((item) => item.messageId === 'probe.port-mismatch')
  assert.equal(reason?.params?.host, 53997)
  assert.equal(reason?.params?.plan, run.port)
})

/* --------------------- R17: "slow" is not "broken" (BS-25) ------------------ */

const AT = '2026-10-27T00:00:00.000Z'

test('a sample taken while the tree was still moving cannot block the candidate (N19)', async () => {
  const { run } = await runWith({
    sample: hookPayload([{ entryId: 'include:triage-probe-ok', moduleName: CANDIDATE, fiberPhase: 'active' }], {
      settled: false,
    }),
    deps: { probeHttp: async () => ({ status: null, detail: 'fetch failed' }) },
  })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'unknown', 'an unsettled reading is not evidence of a broken plugin')
  assert.ok(judgement.missingEvidence.includes('missing.inventory'))
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.tree-not-settled'))
  assert.ok(!judgement.reasons.some((reason) => reason.messageId === 'probe.http-unreachable'))
  const byId = new Map(probeAssertions(run).map((item) => [item.id, item.status]))
  assert.equal(byId.get('http-served'), 'unmeasured', 'a silent port while the tree moves answers nothing')
  assert.equal(byId.get('inventory-active'), 'unmeasured')
})

test('a settled tree with a silent port is still blocked (N20)', async () => {
  const { run } = await runWith({
    sample: hookPayload([{ entryId: 'include:triage-probe-ok', moduleName: CANDIDATE, fiberPhase: 'active' }], { settled: true }),
    deps: { probeHttp: async () => ({ status: null, detail: 'ECONNREFUSED' }) },
  })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'blocked', 'the fix must not turn every failure into unknown')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.http-unreachable'))
})

test('a candidate row that is still pending is a race, not a dead row (N21)', async () => {
  const { run } = await runWith({
    sample: hookPayload([{ entryId: 'include:triage-probe-ok', moduleName: CANDIDATE, fiberPhase: 'pending' }], { settled: true }),
  })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'unknown')
  assert.ok(!judgement.reasons.some((reason) => reason.messageId === 'probe.row-inactive'))
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.tree-not-settled'))
})

test('a hook that could not read its own context reports a measurement failure, not a plugin one', async () => {
  const { run } = await runWith({
    sample: hookPayload([], { error: 'cannot get required service "loader" in inactive context', errorCode: 'inactive-context' }),
    deps: { probeHttp: async () => ({ status: null, detail: 'fetch failed' }) },
  })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'unknown')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.tree-not-settled'))
  assert.ok(!judgement.reasons.some((reason) => reason.messageId === 'probe.http-unreachable'))
})

test('an unparseable sample keeps its own reason instead of borrowing "not settled"', async () => {
  const { run } = await runWith({ sample: hookPayload([], { error: 'the sample file is not valid JSON', errorCode: 'unparseable' }) })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'unknown')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.sample-unreadable'))
})

test('no sample with no Host URL is a blocked boot (N22)', async () => {
  const { run } = await runWith({
    sample: null,
    deps: { bootAndSample: async () => ({ sample: null, seconds: 12, detail: 'no sample', urlPrinted: false }) },
  })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'blocked')
  assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.boot-timeout'))
})

test('no sample while the Host was serving is a measurement failure (N22b)', async () => {
  const { run } = await runWith({
    sample: null,
    deps: {
      bootAndSample: async () => ({
        sample: null,
        seconds: 12,
        detail: 'no sample',
        urlPrinted: true,
        firstLine: 'dsh web: http://127.0.0.1:1/?token=<redacted>',
      }),
    },
  })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'unknown', 'the Host was up; our instrument was not')
  assert.ok(judgement.missingEvidence.includes('missing.inventory'))
  assert.equal(probeAssertions(run).find((item) => item.id === 'boot-sampled')?.status, 'unmeasured')
})

test('a bind failure on the port the probe chose is never blamed on the candidate (N23)', async () => {
  const { run } = await runWith({
    sample: null,
    deps: {
      bootAndSample: async () => ({
        sample: null,
        seconds: 6,
        detail: 'no sample',
        urlPrinted: false,
        startupFailed: true,
        firstLine: 'dsh: startup failed: 2 required plugins did not activate',
        bindFailedPorts: [plan().port],
      }),
    },
  })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'unknown')
  assert.ok(judgement.missingEvidence.includes('missing.probe'))
  const reason = judgement.reasons.find((item) => item.messageId === 'probe.port-unavailable')
  assert.equal(reason?.params?.port, plan().port)
  assert.ok(!judgement.reasons.some((item) => item.messageId === 'probe.startup-failed'))
})

test('a startup failure quotes the launcher instead of paraphrasing it', async () => {
  const { run } = await runWith({
    sample: null,
    deps: {
      bootAndSample: async () => ({
        sample: null,
        seconds: 6,
        detail: 'no sample',
        urlPrinted: false,
        startupFailed: true,
        firstLine: 'dsh: startup failed: 1 required plugin did not activate',
        bindFailedPorts: [],
      }),
    },
  })
  const judgement = judgeProbe({ run, at: AT })
  assert.equal(judgement.conclusion, 'blocked')
  const reason = judgement.reasons.find((item) => item.messageId === 'probe.startup-failed')
  assert.match(String(reason?.params?.detail), /startup failed/)
})

test('the sample view carries settled/attempts/applies, and older payloads stay usable', async () => {
  const fresh = readSample(hookPayload([], { settled: true, attempts: 3, applies: 2 }), CANDIDATE, '/sandbox')
  assert.equal(fresh.settled, true)
  assert.equal(fresh.attempts, 3)
  assert.equal(fresh.applies, 2)
  // A payload written before R17 has no settled flag: it must not be retroactively disqualified.
  const legacy = readSample(
    { kind: 'live', wait_ms: 10, excluded: [], snapshot: { transport: 'in-process-projection', entries: [] } },
    CANDIDATE,
    '/sandbox',
  )
  assert.equal(legacy.settled, null)
  assert.equal(legacy.errorCode, null)
})

test('the log sanitiser redacts the launcher token before anything is published', () => {
  const line = 'dsh web: http://127.0.0.1:53052/?token=abc123secret and more'
  const sanitised = sanitizeLogLine(line)
  assert.ok(!sanitised.includes('abc123secret'))
  assert.match(sanitised, /\?token=<redacted>/)
})

test('bind failures name the port they could not take', () => {
  const log = 'Error: listen EACCES: permission denied 127.0.0.1:53506\n    at Server.setupListenHandle'
  assert.deepEqual(bindFailedPorts(log), [53506])
  assert.deepEqual(bindFailedPorts('nothing to see'), [])
})

test('a usable sample is one that was read on a settled tree', () => {
  assert.equal(isUsableSample({ kind: 'live', settled: true, snapshot: {} }), true)
  assert.equal(isUsableSample({ kind: 'live', settled: false, snapshot: {} }), false)
  assert.equal(isUsableSample({ kind: 'live', error: { code: 'inactive-context', message: 'x' } }), false)
  assert.equal(isUsableSample(null), false)
})
