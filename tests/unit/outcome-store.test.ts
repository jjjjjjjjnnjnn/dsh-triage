/**
 * The local outcome store's behaviour: opt-in off, deletion, concurrency, failure.
 *
 * Pinned here (spec `docs/specs/M5-reflow.md` §7–§11, controls N1 / N4 / N5 / N6 / N10 / N11 / N14):
 *   1. **off means nothing happened** - no directory, no file, no mtime change. The store is
 *      created lazily, on the first record, and never by a read (N1 / N4);
 *   2. **deleting never creates** - `outcomes --purge` on a store that does not exist is a
 *      no-op with exit 0, and it is the only way to make "nothing is left" true (N5 / N6);
 *   3. **two processes, two complete lines** - `O_APPEND` + one write per line + no lock file
 *      (N11; a lock file would survive a purge);
 *   4. **a broken environment or a failed write is reported in ONE stderr line and changes
 *      nothing else** (N10 / N14).
 *
 * Every test drives the SAME code the CLI runs (`packages/plugin/dist/outcomes/*`), and the
 * CLI is spawned for the commands a user actually types (`outcomes ...`). `%LOCALAPPDATA%`
 * (or `$XDG_DATA_HOME` on POSIX) points at a temp dir, so nothing here can touch the real
 * user's store.
 */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { Conclusion, Verdict } from '@dsh-triage/core'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const OUTCOMES_DIR = join(repoRoot, 'packages', 'plugin', 'dist', 'outcomes')
const CLI = join(repoRoot, 'packages', 'plugin', 'dist', 'cli.js')
const CONFIG_MOD = pathToFileURL(join(OUTCOMES_DIR, 'config.js')).href
const STORE_MOD = pathToFileURL(join(OUTCOMES_DIR, 'store.js')).href
const PURGE_MOD = pathToFileURL(join(OUTCOMES_DIR, 'purge.js')).href

const CANARY = 'dsh-privacy-canary-4111'
const STAMP = '2026-10-29T10:00:00.000Z'

type ConfigModule = typeof import('../../packages/plugin/src/outcomes/config.js')
type StoreModule = typeof import('../../packages/plugin/src/outcomes/store.js')
type PurgeModule = typeof import('../../packages/plugin/src/outcomes/purge.js')

const loadConfig = (): Promise<ConfigModule> => import(CONFIG_MOD) as Promise<ConfigModule>
const loadStore = (): Promise<StoreModule> => import(STORE_MOD) as Promise<StoreModule>
const loadPurge = (): Promise<PurgeModule> => import(PURGE_MOD) as Promise<PurgeModule>

/** The env var that decides WHERE the store is - never whether we write (spec §7). */
function storeEnvOf(root: string): Record<string, string> {
  return process.platform === 'win32' ? { LOCALAPPDATA: root } : { XDG_DATA_HOME: root }
}

const storeRootOf = (localDataDir: string): string => join(localDataDir, 'dsh-triage')

function verdictOf(conclusion: Conclusion = 'go', name = CANARY, profile = 'web'): Verdict {
  return {
    schemaVersion: 1,
    subject: { name, version: '1.2.3', kind: 'plugin' },
    env: {
      dsh: '0.2.1-rc.4',
      node: '24.15.0',
      platform: process.platform,
      arch: process.arch,
      profile,
      profileDir: '~/.dsh/profiles/web',
      bundles: [],
      installed: [],
    },
    conclusion,
    confidence: { level: 'medium', basis: 'declared' },
    reasons: [{ code: 'admitted', severity: 'info', messageId: 'admission.admitted', params: { runtime: '0.2.1-rc.4' } }],
    evidence: [{ id: 'declared', tier: 'declared', source: 'npm:canary', method: 'declared-range', at: STAMP }],
    remediation: [],
    missingEvidence: [],
    generatedAt: STAMP,
  }
}

function withStore<T>(body: (localDataDir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'triage-outcomes-'))
  try {
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Same, for a body that needs to await two processes. */
async function withStoreAsync<T>(body: (localDataDir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'triage-outcomes-'))
  try {
    return await body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runCli(args: readonly string[], localDataDir: string) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...storeEnvOf(localDataDir), DSH_TRIAGE_LOCALE: 'en' },
  })
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const shaOf = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

test('N1: with recording off, nothing is created - not the directory, not a file', async () => {
  const store = await loadStore()
  await withStore((dir) => {
    const lines: string[] = []
    const report = store.recordOutcomes({
      source: 'check',
      subjects: [{ verdict: verdictOf(), version: '1.2.3' }],
      at: STAMP,
      probe: null,
      flag: null,
      env: storeEnvOf(dir),
      platform: process.platform,
      stderr: (line) => lines.push(line),
    })
    assert.equal(report.mode, 'off')
    assert.equal(report.written, 0)
    assert.deepEqual(lines, [], 'default-off is silent: no stderr noise on an ordinary command')
    assert.equal(existsSync(storeRootOf(dir)), false, 'the store directory must not exist after a default run')
  })
})

test('N1: the CLI on a clean store reports nothing and leaves nothing behind', async () => {
  await withStore((dir) => {
    const result = runCli(['outcomes', '--status', '--json'], dir)
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.mode, 'off')
    assert.equal(report.records, 0)
    assert.equal(report.store_root_exists, false)
    assert.equal(result.stderr, '')
    assert.equal(existsSync(storeRootOf(dir)), false)
  })
})

test('N4: `--outcomes off` is not "write less" - the file does not change at all', async () => {
  const store = await loadStore()
  await withStore((dir) => {
    const env = storeEnvOf(dir)
    const write = store.recordOutcomes({
      source: 'check',
      subjects: [{ verdict: verdictOf(), version: '1.2.3' }],
      at: STAMP,
      probe: null,
      flag: 'local',
      env,
      platform: process.platform,
      stderr: () => undefined,
    })
    assert.equal(write.written, 1)

    const file = join(storeRootOf(dir), 'outcomes.jsonl')
    const before = shaOf(file)
    const beforeMtime = statSync(file).mtimeMs

    const off = store.recordOutcomes({
      source: 'check',
      subjects: [{ verdict: verdictOf('blocked'), version: '1.2.3' }],
      at: STAMP,
      probe: null,
      flag: 'off',
      env,
      platform: process.platform,
      stderr: () => undefined,
    })
    assert.equal(off.written, 0)
    assert.equal(shaOf(file), before, 'a disabled run must not append')
    assert.equal(statSync(file).mtimeMs, beforeMtime, 'a disabled run must not even touch the mtime')
  })
})

test('N5: purging a store that does not exist is a no-op, not an mkdir', async () => {
  const purge = await loadPurge()
  await withStore((dir) => {
    const result = purge.purgeOutcomes({ env: storeEnvOf(dir), platform: process.platform, at: STAMP })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.report.purge.noop, true)
    assert.equal(result.report.purge.deleted_records, 0)
    assert.deepEqual(result.report.purge.remaining, [])
    assert.equal(result.report.store_root_exists, false)
    assert.equal(existsSync(storeRootOf(dir)), false, 'the deletion path must never become the creation path')
  })

  await withStore((dir) => {
    const flat = runCli(['outcomes', '--purge', '--json'], dir)
    assert.equal(flat.status, 0, 'nothing to delete is not an error')
    const report = JSON.parse(flat.stdout)
    assert.equal(report.purge.noop, true)
    assert.equal(report.store_root_exists, false)
    assert.equal(existsSync(storeRootOf(dir)), false)
  })
})

test('N6: enable → 3 records → purge leaves nothing, and nothing is written afterwards', async () => {
  const store = await loadStore()
  const purge = await loadPurge()
  await withStore((dir) => {
    const env = storeEnvOf(dir)
    const enabled = runCli(['outcomes', '--enable', '--json'], dir)
    assert.equal(enabled.status, 0, enabled.stderr)
    assert.equal(JSON.parse(enabled.stdout).mode, 'local')
    assert.equal(existsSync(join(storeRootOf(dir), 'config.json.tmp')), false, 'the atomic replace leaves no scratch file')

    for (const conclusion of ['go', 'blocked', 'unknown'] as const) {
      const written = store.recordOutcomes({
        source: 'check',
        subjects: [{ verdict: verdictOf(conclusion), version: '1.2.3' }],
        at: STAMP,
        probe: null,
        flag: null,
        env,
        platform: process.platform,
        stderr: () => undefined,
      })
      assert.equal(written.written, 1)
    }

    const status = runCli(['outcomes', '--status', '--json'], dir)
    assert.equal(status.status, 0, status.stderr)
    assert.equal(JSON.parse(status.stdout).records, 3)
    assert.equal(JSON.parse(status.stdout).mode, 'local')

    const purged = runCli(['outcomes', '--purge', '--json'], dir)
    assert.equal(purged.status, 0, purged.stderr)
    const report = JSON.parse(purged.stdout)
    assert.equal(report.purge.deleted_records, 3)
    assert.deepEqual(report.purge.deleted_files, ['config.json', 'outcomes.jsonl'])
    assert.equal(report.purge.directory_removed, true)
    assert.deepEqual(report.purge.remaining, [])
    assert.equal(report.store_root_exists, false)
    assert.equal(existsSync(storeRootOf(dir)), false, 'the invariant triple: remaining=[] + removed + absent')

    // The purge deleted `config.json` too, so the mode is back to the default: off.
    const after = store.recordOutcomes({
      source: 'check',
      subjects: [{ verdict: verdictOf(), version: '1.2.3' }],
      at: STAMP,
      probe: null,
      flag: null,
      env,
      platform: process.platform,
      stderr: () => undefined,
    })
    assert.equal(after.mode, 'off')
    assert.equal(after.written, 0)
    assert.equal(existsSync(storeRootOf(dir)), false)

    // Second purge in a row: idempotent, still exit 0, still nothing.
    const again = purge.purgeOutcomes({ env, platform: process.platform, at: STAMP })
    assert.equal(again.ok && again.report.purge.deleted_records, 0)
    assert.equal(again.ok && again.report.purge.noop, true)
  })
})

test('N6: a file the user put in the store is kept and reported, never deleted', async () => {
  const purge = await loadPurge()
  await withStore((dir) => {
    const env = storeEnvOf(dir)
    const root = storeRootOf(dir)
    runCli(['outcomes', '--enable', '--json'], dir)
    writeFileSync(join(root, 'notes.txt'), 'mine\n', 'utf8')

    const result = purge.purgeOutcomes({ env, platform: process.platform, at: STAMP })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.report.purge.remaining, ['notes.txt'])
    assert.equal(result.report.purge.directory_removed, false)
    assert.equal(result.report.store_root_exists, true)
    assert.equal(readFileSync(join(root, 'notes.txt'), 'utf8'), 'mine\n')
  })
})

test('N13: the purge text carries counts only - no package name, no quote, no separator', async () => {
  const store = await loadStore()
  await withStore((dir) => {
    runCli(['outcomes', '--enable', '--json'], dir)
    store.recordOutcomes({
      source: 'check',
      subjects: [
        { verdict: verdictOf('go'), version: '1.2.3' },
        { verdict: verdictOf('blocked'), version: '1.2.3' },
        { verdict: verdictOf('unknown'), version: '1.2.3' },
      ],
      at: STAMP,
      probe: null,
      flag: null,
      env: storeEnvOf(dir),
      platform: process.platform,
      stderr: () => undefined,
    })

    const text = runCli(['outcomes', '--purge'], dir)
    assert.equal(text.status, 0, text.stderr)
    assert.doesNotMatch(text.stdout, new RegExp(CANARY), 'the purge output must not name what it deleted')
    assert.doesNotMatch(text.stdout, /"/, 'no JSON fragments in the human output')
    assert.doesNotMatch(text.stdout, /[\\/]/, 'no path separators')
    assert.match(text.stdout, /purged\s+3 outcome records/)
    assert.match(text.stdout, /store\s+absent/)
  })
})

test('N10: an empty or relative local-data dir fails closed, with exactly one stderr line', async () => {
  const config = await loadConfig()
  const winEmpty = config.resolveStoreRoot({ LOCALAPPDATA: '' }, 'win32')
  assert.equal(winEmpty.ok, false)
  assert.equal(winEmpty.ok === false && winEmpty.problem, 'no-local-data-dir')

  const winRelative = config.resolveStoreRoot({ LOCALAPPDATA: 'relative\\dir' }, 'win32')
  assert.equal(winRelative.ok === false && winRelative.problem, 'relative-local-data-dir')

  const posixEmpty = config.resolveStoreRoot({ HOME: '', XDG_DATA_HOME: '' }, 'linux')
  assert.equal(posixEmpty.ok === false && posixEmpty.problem, 'no-local-data-dir')

  const posixRelative = config.resolveStoreRoot({ XDG_DATA_HOME: 'relative/dir', HOME: '/home/x' }, 'linux')
  assert.equal(posixRelative.ok === false && posixRelative.problem, 'relative-local-data-dir')

  const xdgWins = config.resolveStoreRoot({ XDG_DATA_HOME: '/data', HOME: '/home/x' }, 'linux')
  assert.equal(xdgWins.ok ? xdgWins.root : null, join('/data', 'dsh-triage'))

  const homeFallback = config.resolveStoreRoot({ HOME: '/home/x' }, 'linux')
  assert.ok(homeFallback.ok && homeFallback.root.includes('.local'))

  // The real CLI path: the platform's own variable is blanked.
  const blank = process.platform === 'win32' ? { LOCALAPPDATA: '' } : { HOME: '', XDG_DATA_HOME: '' }
  const result = spawnSync(process.execPath, [CLI, 'outcomes', '--status', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...blank, DSH_TRIAGE_LOCALE: 'en' },
  })
  assert.equal(result.status, 0, 'a broken environment must not break the command')
  assert.equal(JSON.parse(result.stdout).mode, 'off', 'a config we cannot read is not an opt-in')
  assert.equal(result.stderr.trim().split('\n').length, 1, `expected exactly one stderr line, got: ${result.stderr}`)
  assert.match(result.stderr, /^outcomes: off \(/)
})

test('N10: a corrupt config.json is read as off, not as an opt-in', async () => {
  const config = await loadConfig()
  await withStore((dir) => {
    const env = storeEnvOf(dir)
    const root = storeRootOf(dir)
    // The directory must exist before we can plant a broken config, which is itself a fact:
    // only `--enable` creates it, so we go through the real writer first.
    assert.equal(config.writeOutcomeMode('local', env, process.platform).ok, true)
    for (const broken of ['{oops', '{"schema_version":1,"outcomes":"on"}', '{"schema_version":2,"outcomes":"local"}', '[]']) {
      writeFileSync(join(root, 'config.json'), broken, 'utf8')
      const reading = config.readOutcomeConfig(env, process.platform)
      assert.equal(reading.mode, 'off', `broken config must read as off: ${broken}`)
      assert.equal(reading.problems.length, 1)
      assert.doesNotMatch(reading.problems[0] ?? '', /[\\/]/, 'the problem line must not carry a path')
    }
  })
})

test('enable/disable are idempotent and never delete records', async () => {
  const store = await loadStore()
  const config = await loadConfig()
  await withStore((dir) => {
    const first = runCli(['outcomes', '--enable', '--json'], dir)
    assert.equal(JSON.parse(first.stdout).changed, true)
    const second = runCli(['outcomes', '--enable', '--json'], dir)
    assert.equal(JSON.parse(second.stdout).changed, false, 're-enabling writes the same content again, not a new file')

    store.recordOutcomes({
      source: 'check',
      subjects: [{ verdict: verdictOf(), version: '1.2.3' }],
      at: STAMP,
      probe: null,
      flag: null,
      env: storeEnvOf(dir),
      platform: process.platform,
      stderr: () => undefined,
    })
    const file = join(storeRootOf(dir), 'outcomes.jsonl')
    const before = shaOf(file)

    const disabled = runCli(['outcomes', '--disable', '--json'], dir)
    assert.equal(JSON.parse(disabled.stdout).mode, 'off')
    assert.equal(shaOf(file), before, '--disable keeps existing records until --purge')
    assert.equal(config.readOutcomeConfig(storeEnvOf(dir), process.platform).mode, 'off')
  })
})

test('N11: two processes appending at once produce two complete, parseable lines', async () => {
  const store = await loadStore()
  await withStoreAsync(async (dir) => {
    const env = storeEnvOf(dir)
    runCli(['outcomes', '--enable', '--json'], dir)

    const script = `
      const { recordOutcomes } = await import(${JSON.stringify(STORE_MOD)});
      const verdict = {
        schemaVersion: 1,
        subject: { name: '${CANARY}', version: '1.2.3', kind: 'plugin' },
        env: { dsh: '0.2.1-rc.4', node: '24.15.0', platform: '${process.platform}', arch: '${process.arch}', profile: 'web', profileDir: '~/.dsh/profiles/web', bundles: [], installed: [] },
        conclusion: process.env.CONCURRENT_CONCLUSION,
        confidence: { level: 'medium', basis: 'declared' },
        reasons: [{ code: 'c', severity: 'info', messageId: 'admission.admitted', params: { runtime: '0.2.1-rc.4' } }],
        evidence: [{ id: 'd', tier: 'declared', source: 'npm:c', method: 'declared-range', at: '${STAMP}' }],
        remediation: [],
        missingEvidence: [],
        generatedAt: '${STAMP}',
      };
      recordOutcomes({
        source: 'check',
        subjects: [{ verdict, version: '1.2.3' }],
        at: '${STAMP}',
        probe: null,
        flag: 'local',
        stderr: (line) => process.stderr.write(line),
      });
    `
    const runOne = (conclusion: string) =>
      new Promise<{ status: number | null; stderr: string }>((resolveChild) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
          cwd: repoRoot,
          env: { ...process.env, ...env, CONCURRENT_CONCLUSION: conclusion },
        })
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += String(chunk)
        })
        child.on('close', (status) => resolveChild({ status, stderr }))
      })

    const results = await Promise.all([runOne('go'), runOne('blocked')])
    for (const result of results) assert.equal(result.status, 0, result.stderr)

    const text = readFileSync(join(storeRootOf(dir), 'outcomes.jsonl'), 'utf8')
    const lines = text.split('\n').filter((line) => line !== '')
    assert.equal(lines.length, 2, 'both appends survived')
    const conclusions = lines.map((line) => {
      assert.match(line, /^\{"schema_version":1,/, 'each line is a complete record, not a fragment')
      return JSON.parse(line).conclusion as string
    })
    assert.deepEqual(conclusions.sort(), ['blocked', 'go'])

    const read = store.readOutcomeRecords(storeRootOf(dir))
    assert.equal(read.records.length, 2)
    assert.equal(read.rejected, 0)
  })
})

test('N14: an unwritable store is one stderr line, and nothing throws', async () => {
  const store = await loadStore()
  await withStore((dir) => {
    // A FILE where the store directory should be: `mkdir` fails the same way a read-only
    // directory or a full disk would, and it fails identically on Windows and POSIX.
    const blocked = storeRootOf(dir)
    writeFileSync(blocked, 'not a directory\n', 'utf8')
    const lines: string[] = []
    const report = store.recordOutcomes({
      source: 'probe',
      subjects: [{ verdict: verdictOf(), version: '1.2.3' }],
      at: STAMP,
      probe: { totalMs: 4200, bootMs: 3100, profile: 'web' },
      flag: 'local',
      env: storeEnvOf(dir),
      platform: process.platform,
      stderr: (line) => lines.push(line),
    })
    assert.equal(report.written, 0)
    assert.equal(lines.length, 1, `exactly one line, got: ${JSON.stringify(lines)}`)
    assert.match(lines[0] ?? '', /^outcomes: could not record \([A-Z]+\)\n$/, 'a code, never a path')
    assert.equal(readdirSync(dir).includes('outcomes.jsonl'), false)
  })
})

test('a record with an unkeyable version is skipped, not guessed', async () => {
  const store = await loadStore()
  await withStore((dir) => {
    const lines: string[] = []
    const report = store.recordOutcomes({
      source: 'probe',
      subjects: [{ verdict: verdictOf(), version: null }],
      at: STAMP,
      probe: { totalMs: 4200, bootMs: 3100, profile: 'web' },
      flag: 'local',
      env: storeEnvOf(dir),
      platform: process.platform,
      stderr: (line) => lines.push(line),
    })
    assert.equal(report.skipped, 1)
    assert.equal(report.written, 0)
    assert.match(lines[0] ?? '', /no exact version/)
    assert.equal(existsSync(storeRootOf(dir)), false, 'nothing to write means no directory either')
  })
})

test('the per-run cap refuses a whole batch rather than writing half of it', async () => {
  const store = await loadStore()
  await withStore((dir) => {
    const lines: string[] = []
    const subjects = Array.from({ length: 201 }, () => ({ verdict: verdictOf(), version: '1.2.3' }))
    const report = store.recordOutcomes({
      source: 'check',
      subjects,
      at: STAMP,
      probe: null,
      flag: 'local',
      env: storeEnvOf(dir),
      platform: process.platform,
      stderr: (line) => lines.push(line),
    })
    assert.equal(report.written, 0)
    assert.match(lines[0] ?? '', /subjects=201 > cap 200/)
    assert.equal(existsSync(storeRootOf(dir)), false)
  })
})

test('a probe record stores buckets, and a tui surface has no boot bucket', async () => {
  const store = await loadStore()
  await withStore((dir) => {
    const env = storeEnvOf(dir)
    store.recordOutcomes({
      source: 'probe',
      subjects: [{ verdict: verdictOf(), version: '1.2.3' }],
      at: STAMP,
      probe: { totalMs: 23_400, bootMs: 24_000, profile: 'web' },
      flag: 'local',
      env,
      platform: process.platform,
      stderr: () => undefined,
    })
    const web = store.readOutcomeRecords(storeRootOf(dir)).records
    assert.equal(web.length, 1)
    assert.deepEqual(web[0]?.probe, { total_ms_bucket: '20to60s', boot_ms_bucket: '20to60s' })
    assert.equal(web[0]?.source, 'probe')

    store.recordOutcomes({
      source: 'probe',
      subjects: [{ verdict: verdictOf('unknown', CANARY, 'tui'), version: '1.2.3' }],
      at: STAMP,
      probe: { totalMs: 900, bootMs: 900, profile: 'tui' },
      flag: 'local',
      env,
      platform: process.platform,
      stderr: () => undefined,
    })
    const tui = store.readOutcomeRecords(storeRootOf(dir)).records.at(-1)
    assert.equal(tui?.profile_kind, 'tui')
    assert.deepEqual(tui?.probe, { total_ms_bucket: 'lt5s', boot_ms_bucket: null })  })
})

test('a corrupted line is counted and skipped, never repaired into a record', async () => {
  const store = await loadStore()
  await withStore((dir) => {
    const env = storeEnvOf(dir)
    runCli(['outcomes', '--enable', '--json'], dir)
    store.recordOutcomes({
      source: 'check',
      subjects: [{ verdict: verdictOf(), version: '1.2.3' }],
      at: STAMP,
      probe: null,
      flag: null,
      env,
      platform: process.platform,
      stderr: () => undefined,
    })
    const file = join(storeRootOf(dir), 'outcomes.jsonl')
    const good = readFileSync(file, 'utf8')
    writeFileSync(file, `${good}{"schema_version":1,"profileDir":"C:\\\\Users\\\\x"}\nnot json\n`, 'utf8')

    const read = store.readOutcomeRecords(storeRootOf(dir))
    assert.equal(read.records.length, 1, 'the good line still reads')
    assert.equal(read.rejected, 2, 'both bad lines are counted, neither is repaired')
  })
})
