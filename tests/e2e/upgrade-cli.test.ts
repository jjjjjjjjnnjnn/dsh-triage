/**
 * `dsh-triage upgrade` end-to-end (`docs/specs/M5-upgrade.md` §9 N1 / N4 / N5 / N10 / N11 / N12).
 *
 * Every case here is about a way the command could lie:
 *
 *   - a bad `--to` must be a usage error, not "everything will break";
 *   - a missing profile must fail honestly instead of printing an empty (green-looking) list;
 *   - an empty composition must not read as "no impact";
 *   - a broken snapshot must not silently fall back to the live profile.
 *
 * Offline by construction: no `--registry`, synthetic `DSH_HOME`, no network stub needed.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const CLI = join(repoRoot, 'packages', 'plugin', 'dist', 'cli.js')
const STAMP = '2026-01-01T00:00:00.000Z'
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

interface Fixture {
  readonly root: string
  readonly home: string
  readonly dshHome: string
}

function buildFixture(options: { readonly bundles: readonly string[]; readonly extraBundleManifests?: Record<string, unknown> }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-upgrade-'))
  const home = join(root, 'home')
  const dshHome = join(home, '.dsh')
  const profileDir = join(dshHome, 'profiles', 'web')
  const sharedModules = join(dshHome, 'profiles', 'node_modules')

  mkdirSync(profileDir, { recursive: true })
  mkdirSync(join(sharedModules, '@deepseek-ai', 'dsh'), { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: Object.fromEntries(options.bundles.map((name) => [name, '1.0.0'])),
      dsh: { profile: { bundles: options.bundles } },
    }),
  )
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(
    join(sharedModules, '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }),
  )

  const manifests: Record<string, unknown> = {
    'fake-bundle': {
      name: 'fake-bundle',
      version: '1.0.0',
      // Pinned to an old build: denied by the running runtime AND by any newer one.
      engines: { dsh: '0.1.0-rc.6' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    },
    'ok-bundle': {
      name: 'ok-bundle',
      version: '1.0.0',
      engines: { dsh: '*' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    },
    ...options.extraBundleManifests,
  }
  for (const name of options.bundles) {
    const dir = join(sharedModules, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifests[name] ?? { name, version: '1.0.0' }))
    writeFileSync(join(dir, 'cordis.patch.yml'), `- id: ${name}-row\n  name: ${name}/host\n`)
    mkdirSync(join(dir, 'host.js'), { recursive: true })
  }
  return { root, home, dshHome }
}

function runCli(
  args: readonly string[],
  fixture: Fixture,
  extraEnv: Readonly<Record<string, string>> = {},
  cwd: string = repoRoot,
) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DSH_TRIAGE_LOCALE: 'en', HOME: fixture.home, USERPROFILE: fixture.home, ...extraEnv },
  })
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * Point the child's `fetch` at a port that refuses connections (`record_upgrade_impact.mjs` uses the
 * same trick). `NODE_USE_ENV_PROXY=1` is required for Node's global `fetch` to honour the proxy.
 */
const NO_NETWORK: Readonly<Record<string, string>> = {
  NODE_USE_ENV_PROXY: '1',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
}

function withFixture(options: Parameters<typeof buildFixture>[0], body: (fixture: Fixture) => void): void {
  const fixture = buildFixture(options)
  try {
    body(fixture)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

/* --------------------------------- N4 / N5 --------------------------------- */

test('N4/N5: a missing, ranged, partial, unknown-tag or empty --to is a usage error before anything is read', () => {
  withFixture({ bundles: ['fake-bundle'] }, (fixture) => {
    // The profile does not exist either: the target must still win, so the user fixes the flag
    // and not their installation.
    const missingProfile = ['--profile', 'does-not-exist', '--dsh-home', fixture.dshHome, '--json']
    const usage = runCli(['upgrade', ...missingProfile], fixture, NO_NETWORK)
    assert.equal(usage.status, 2)
    // M6 C8: no target means no judgement, but the message is guidance, not a bare usage line.
    assert.match(usage.stderr, /nothing was judged/)
    assert.equal(usage.stdout.trim(), '', 'a usage error must not print a report')

    // `latest` is no longer in this list: it is a dist-tag keyword now (M6 C9), and its own
    // negative control is "registry unreachable -> exit 3 with no bucket" below.
    for (const value of ['0.3', '^0.3.0', 'canary', '', '   ']) {
      const result = runCli(['upgrade', '--to', value, ...missingProfile], fixture, NO_NETWORK)
      assert.equal(result.status, 2, `--to "${value}": ${result.stderr}`)
      assert.match(result.stderr, /exact semver version/)
      assert.equal(result.stdout.trim(), '', 'a usage error must not print a report')
    }
  })
})

/* ------------------------------ M6 C8 / C9 -------------------------------- */

test('M6 C8: with no --to the guidance reports what it read and still refuses to judge', () => {
  withFixture({ bundles: ['ok-bundle'] }, (fixture) => {
    const result = runCli(['upgrade', '--dsh-home', fixture.dshHome, '--profile', 'web'], fixture, NO_NETWORK)
    assert.equal(result.status, 2, 'no target is a usage error, even when everything else is readable')
    assert.equal(result.stdout.trim(), '', 'guidance is not a report: stdout stays empty')
    assert.match(result.stderr, /nothing was judged/)
    assert.match(result.stderr, /current\s+0\.2\.1-rc\.2/, 'the running runtime is read from the profile')
    // N8: unreachable registry -> `unknown`, never an invented tag value.
    assert.match(result.stderr, /targets\s+unknown/)
    assert.match(result.stderr, /no guess is made/)
    assert.equal(/next \d+\.\d+\.\d+/.test(result.stderr), false, 'a failed lookup must not name a version')
  })
})

test('M6 C8: an unreadable profile is reported as unknown, not as a version', () => {
  withFixture({ bundles: ['ok-bundle'] }, (fixture) => {
    const result = runCli(['upgrade', '--dsh-home', fixture.dshHome, '--profile', 'nope'], fixture, NO_NETWORK)
    assert.equal(result.status, 2)
    assert.equal(result.stdout.trim(), '')
    assert.match(result.stderr, /current\s+unknown/)
    assert.match(result.stderr, /profile-not-found/)
  })
})

test('M6 C9: --to next with an unreachable registry exits 3 and produces no bucket', () => {
  withFixture({ bundles: ['ok-bundle'] }, (fixture) => {
    const result = runCli(['upgrade', '--to', 'next', '--dsh-home', fixture.dshHome, '--profile', 'web', '--json'], fixture, NO_NETWORK)
    assert.equal(result.status, 3, result.stderr)
    assert.equal(result.stdout.trim(), '', 'a failed resolution must not print a report')
    assert.match(result.stderr, /cannot resolve --to next/)
    assert.match(result.stderr, /never touches the network/, 'the hint names the offline path')
  })
})

test('M6 C9: --to latest is resolved before any profile read, so a bad target never becomes a finding', () => {
  withFixture({ bundles: ['ok-bundle'] }, (fixture) => {
    const result = runCli(['upgrade', '--to', 'LATEST', '--dsh-home', fixture.dshHome, '--profile', 'nope'], fixture, NO_NETWORK)
    assert.equal(result.status, 3, 'the keyword is recognised, and the lookup is what failed')
    assert.match(result.stderr, /cannot resolve --to latest/)
    assert.doesNotMatch(result.stderr, /exact semver version/, 'a keyword is never a usage error')
  })
})

/* -------------------------------- M6 C10 ---------------------------------- */

test('M6 C10: --card --out writes the same bytes a bare --card prints, and refuses to overwrite', () => {
  withFixture({ bundles: ['ok-bundle'] }, (fixture) => {
    const base = ['upgrade', '--to', '0.3.0', '--dsh-home', fixture.dshHome, '--profile', 'web', '--stamp', STAMP]
    const plain = runCli([...base, '--card'], fixture, NO_NETWORK)
    assert.equal(plain.status, 0, plain.stderr)

    const target = join(fixture.root, 'nested', 'card.md')
    const written = runCli([...base, '--card', '--out', target], fixture, NO_NETWORK, fixture.root)
    assert.equal(written.status, 0, written.stderr)
    assert.equal(written.stdout.trim(), join('nested', 'card.md'), 'under the cwd the printed path is relative')
    const onDisk = readFileSync(target, 'utf8')
    assert.equal(sha256(onDisk), sha256(plain.stdout), 'the file must be byte-identical to stdout')

    const again = runCli([...base, '--card', '--out', target], fixture, NO_NETWORK, fixture.root)
    assert.equal(again.status, 2, 'an existing file is a usage error, not an overwrite')
    assert.match(again.stderr, /refusing to overwrite/)
    assert.equal(sha256(readFileSync(target, 'utf8')), sha256(plain.stdout), 'the refusal must not touch the file')

    // One output per run (M6 N7): `--json` wins over `--out` too, and says so instead of writing.
    const unwritten = join(fixture.root, 'never-written.md')
    const both = runCli([...base, '--json', '--out', unwritten], fixture, NO_NETWORK)
    assert.equal(both.status, 0, both.stderr)
    assert.doesNotThrow(() => JSON.parse(both.stdout), 'stdout must be JSON only')
    assert.match(both.stderr, /out: ignored because --json was given/)
    assert.equal(existsSync(unwritten), false, 'a refused output flag must not leave a file behind')
  })
})

test('M6 C10: an unwritable target exits 3 and leaves no partial file', () => {
  withFixture({ bundles: ['ok-bundle'] }, (fixture) => {
    // Windows does not enforce a read-only *directory* for its owner, so the honest equivalent is a
    // parent path that cannot be a directory (it is a file). No half-written card may appear.
    const blocker = join(fixture.root, 'blocker')
    writeFileSync(blocker, 'not a directory\n')
    const result = runCli(
      [
        'upgrade',
        '--to',
        '0.3.0',
        '--dsh-home',
        fixture.dshHome,
        '--profile',
        'web',
        '--stamp',
        STAMP,
        '--card',
        '--out',
        join(blocker, 'card.md'),
      ],
      fixture,
      NO_NETWORK,
    )
    assert.equal(result.status, 3, result.stderr)
    assert.match(result.stderr, /cannot write/)
    const leftovers = readdirSync(fixture.root).filter((name) => name.includes('.tmp-'))
    assert.deepEqual(leftovers, [], 'no temp file may survive a failed write')
    assert.equal(existsSync(join(blocker, 'card.md')), false)
  })
})

/* ----------------------------------- N10 ----------------------------------- */

test('N10: a profile that does not exist fails honestly (exit 3) instead of printing an empty list', () => {
  withFixture({ bundles: ['fake-bundle'] }, (fixture) => {
    const result = runCli(['upgrade', '--to', '0.3.0', '--profile', 'nope', '--dsh-home', fixture.dshHome, '--json'], fixture)
    assert.equal(result.status, 3, result.stderr)
    assert.match(result.stderr, /profile/)
    assert.equal(result.stdout.trim(), '', 'no payload may be produced for a profile that was not read')
  })
})

/* ----------------------------------- N1 ------------------------------------ */

test('N1: an empty composition exits 3 and never renders as "nothing will break"', () => {
  withFixture({ bundles: [] }, (fixture) => {
    const text = runCli(['upgrade', '--to', '0.3.0', '--dsh-home', fixture.dshHome, '--stamp', STAMP], fixture)
    assert.equal(text.status, 3, text.stderr)
    assert.match(text.stderr, /nothing sampled/)
    assert.equal(text.stdout.trim(), '')
    assert.equal(/likely-fine|would-be-denied/.test(text.stdout), false)

    const json = runCli(['upgrade', '--to', '0.3.0', '--dsh-home', fixture.dshHome, '--json', '--stamp', STAMP], fixture)
    assert.equal(json.status, 3)
    assert.equal(json.stdout.trim(), '')
  })
})

/* -------------------------------- happy path -------------------------------- */

test('the impact list names the profile, the row ids and the target, and keeps the current runtime out of the target', () => {
  withFixture({ bundles: ['fake-bundle', 'ok-bundle'] }, (fixture) => {
    const result = runCli(
      ['upgrade', '--to', '0.2.1-rc.2', '--dsh-home', fixture.dshHome, '--json', '--stamp', STAMP],
      fixture,
    )
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)

    assert.equal(payload.command, 'upgrade')
    assert.equal(payload.profile, 'web')
    assert.equal(payload.current, '0.2.1-rc.2')
    assert.equal(payload.target, '0.2.1-rc.2')
    assert.equal(payload.target_relation, 'same')
    assert.equal(payload.counts.improved, 0)
    assert.equal(payload.registry.consulted, false, 'offline by default')

    const bundle = payload.units.find((unit: { id: string }) => unit.id === 'bundle:fake-bundle')
    assert.equal(bundle.bucket, 'would-be-denied')
    assert.equal(bundle.already_denied_at_current, true, 'the running runtime denies it too')
    assert.equal(bundle.conclusion, 'blocked')
    assert.ok(
      bundle.remediation.some((item: { kind: string }) => item.kind === 'pin-version'),
      'the exact `why` remediation must be carried',
    )
    assert.deepEqual(
      bundle.target.unmet.map((requirement: { key: string; range: string }) => ({ key: requirement.key, range: requirement.range })),
      [{ key: 'dsh', range: '0.1.0-rc.6' }],
    )

    const row = payload.units.find((unit: { id: string }) => unit.id === 'row:fake-bundle-row')
    assert.equal(row.bucket, 'would-be-denied')
    assert.equal(row.source, 'bundle:fake-bundle')
    assert.ok(
      row.reasons.some((reason: { messageId: string }) => reason.messageId === 'admission.row-scope'),
      'the row id must be attributable',
    )
    assert.equal(row.evidence_tiers.includes('declared'), true)

    const ok = payload.units.find((unit: { id: string }) => unit.id === 'bundle:ok-bundle')
    assert.equal(ok.bucket, 'likely-fine')

    // Privacy: the payload is meant to be shareable.
    assert.equal(result.stdout.includes(fixture.home.replaceAll('\\', '\\\\')), false)
    assert.equal(/[A-Za-z]:\\\\?Users/i.test(result.stdout), false)
  })
})

test('--strict exits 1 only when the target denies something, and cannot-tell is not a failure', () => {
  withFixture({ bundles: ['fake-bundle', 'ok-bundle'] }, (fixture) => {
    const denied = runCli(['upgrade', '--to', '0.3.0', '--dsh-home', fixture.dshHome, '--strict', '--stamp', STAMP], fixture)
    assert.equal(denied.status, 1, 'a denial is a finding under --strict')
    assert.match(denied.stdout, /profile "web"/)

    const notStrict = runCli(['upgrade', '--to', '0.3.0', '--dsh-home', fixture.dshHome, '--stamp', STAMP], fixture)
    assert.equal(notStrict.status, 0, 'without --strict a report is exit 0')
  })

  // A profile whose only finding is "no declaration" must NOT be exit 1 under --strict: not
  // knowing is not the same as knowing something will break.
  withFixture({ bundles: ['silent-bundle'], extraBundleManifests: { 'silent-bundle': { name: 'silent-bundle', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } } } }, (fixture) => {
    const result = runCli(['upgrade', '--to', '0.3.0', '--dsh-home', fixture.dshHome, '--strict', '--json', '--stamp', STAMP], fixture)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.counts.cannot_tell, 2, 'bundle + row are both unconstrained')
    assert.equal(payload.counts.would_be_denied, 0)
    assert.equal(
      payload.units.every((unit: { bucket: string }) => unit.bucket === 'cannot-tell'),
      true,
    )
  })
})

/* ----------------------------------- N11 ----------------------------------- */

test('N11: a broken composition snapshot is a usage error and never falls back to the live profile', () => {
  withFixture({ bundles: ['fake-bundle'] }, (fixture) => {
    const write = (name: string, body: string): string => {
      const path = join(fixture.root, name)
      writeFileSync(path, body)
      return path
    }
    const cases: readonly { readonly name: string; readonly body: string; readonly match: RegExp }[] = [
      { name: 'not-json.json', body: 'this is not json', match: /not readable as JSON/ },
      { name: 'bad-schema.json', body: JSON.stringify({ schema_version: 2, profile: 'web', bundles: [], rows: [] }), match: /schema_version must be 1/ },
      { name: 'no-profile.json', body: JSON.stringify({ schema_version: 1, bundles: [], rows: [] }), match: /profile must be a non-empty string/ },
      {
        name: 'row-without-module.json',
        body: JSON.stringify({
          schema_version: 1,
          profile: 'web',
          bundles: [],
          rows: [{ rowId: 'r1', source: 'patch:profile', manifest: null }],
        }),
        match: /rows\[0\]\.module/,
      },
      {
        name: 'row-without-manifest.json',
        body: JSON.stringify({
          schema_version: 1,
          profile: 'web',
          bundles: [],
          rows: [{ rowId: 'r1', module: 'm', source: 'patch:profile' }],
        }),
        match: /rows\[0\]\.manifest is required/,
      },
    ]
    for (const item of cases) {
      const path = write(item.name, item.body)
      const result = runCli(
        ['upgrade', '--to', '0.3.0', '--snapshot', path, '--dsh-home', fixture.dshHome, '--json', '--stamp', STAMP],
        fixture,
      )
      assert.equal(result.status, 2, `${item.name}: ${result.stderr}`)
      assert.match(result.stderr, item.match)
      assert.equal(result.stdout.trim(), '', `${item.name}: a rejected snapshot must not produce a report`)
    }
  })
})

/* ----------------------------------- N12 ----------------------------------- */

test('N12: a snapshot that names bundles but no rows judges the bundles and says rows are zero', () => {
  withFixture({ bundles: ['fake-bundle'] }, (fixture) => {
    const path = join(fixture.root, 'bundles-only.json')
    writeFileSync(
      path,
      JSON.stringify({
        schema_version: 1,
        profile: 'hand-written',
        dsh: '0.2.1-rc.2',
        bundles: [
          { name: 'pinned-bundle', version: '1.0.0', manifest: { name: 'pinned-bundle', engines: { dsh: '0.2.1-rc.2' } } },
        ],
        rows: [],
      }),
    )
    const result = runCli(['upgrade', '--to', '0.3.0', '--snapshot', path, '--json', '--stamp', STAMP], fixture)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.profile, 'hand-written', 'the snapshot names the profile the answer belongs to')
    assert.equal(payload.profile_source, 'snapshot')
    assert.equal(payload.counts.rows, 0)
    assert.equal(payload.counts.bundles, 1)
    assert.equal(payload.counts.would_be_denied, 1)
    assert.equal(payload.units[0].id, 'bundle:pinned-bundle')
    assert.equal(payload.units[0].target.status, 'denied')
  })
})

/* ----------------------- no existing command was touched ----------------------- */

test('the pre-existing commands keep their own contract (upgrade did not leak into them)', () => {
  withFixture({ bundles: ['fake-bundle'] }, (fixture) => {
    const why = runCli(['why', '--json', '--dsh-home', fixture.dshHome, '--stamp', STAMP], fixture)
    assert.equal(why.status, 0, why.stderr)
    const payload = JSON.parse(why.stdout)
    assert.equal(payload.command, 'why')
    assert.ok(Array.isArray(payload.verdicts) && payload.verdicts.length >= 1)
    assert.equal('counts' in payload, false, 'why must not grow upgrade fields')
  })
})
