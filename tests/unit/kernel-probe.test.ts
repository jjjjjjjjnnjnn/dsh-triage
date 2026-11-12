/**
 * R101 · M14: the kernel probe decides which copy of `@deepseek-ai/dsh` the CLI believes (C1/C4/C5).
 *
 * Each case below is a negative control from `docs/specs/M14-kernel-asar.md`. They matter because the
 * failure being fixed is "confidently reported a wrong version", so "did the probe answer" is not enough —
 * it must also refuse to answer when it cannot.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { probeKernelArchive } from '../../packages/core/dist/kernel-probe.js'

/** Minimal asar image: one flat directory, offsets relative to the data section. */
function buildImage(files: Record<string, string>): Buffer {
  const jsonStart = 16
  let offset = 0
  const entries: Record<string, unknown> = {}
  const dataChunks: Buffer[] = []
  for (const [name, content] of Object.entries(files)) {
    const bytes = Buffer.from(content, 'utf8')
    entries[name] = { size: bytes.length, offset: String(offset) }
    dataChunks.push(bytes)
    offset += bytes.length
  }
  const header = Buffer.from(JSON.stringify({ files: entries }), 'utf8')
  const dataStart = Math.ceil((jsonStart + header.length) / 4) * 4
  const head = Buffer.alloc(dataStart)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(header.length, 12)
  header.copy(head, jsonStart)
  return Buffer.concat([head, ...dataChunks])
}

/** The desktop shape: `dsh/node_modules/@deepseek-ai/<pkg>/package.json`. */
function buildDesktopImage(kernelVersion: string, extra: Record<string, { version: string }> = {}): Buffer {
  const files: Record<string, string> = {
    'dsh/node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ name: '@deepseek-ai/dsh', version: kernelVersion }),
  }
  for (const [name, manifest] of Object.entries(extra)) {
    files[`dsh/node_modules/@deepseek-ai/${name}/package.json`] = JSON.stringify({ name: `@deepseek-ai/${name}`, version: manifest.version })
  }
  return buildNested(files)
}

/** Build an image whose directory mirrors a path hierarchy (dirs are `files` maps). */
function buildNested(files: Record<string, string>): Buffer {
  const tree: Record<string, unknown> = {}
  const contents: Array<{ path: string; bytes: Buffer }> = []
  let offset = 0
  for (const [path, content] of Object.entries(files)) {
    const bytes = Buffer.from(content, 'utf8')
    const parts = path.split('/')
    let node = tree
    for (const part of parts.slice(0, -1)) {
      node[part] = node[part] ?? { files: {} }
      node = ((node[part] as { files: Record<string, unknown> }).files as Record<string, unknown>)
    }
    node[parts[parts.length - 1] as string] = { size: bytes.length, offset: String(offset) }
    contents.push({ path, bytes })
    offset += bytes.length
  }
  const jsonStart = 16
  const json = Buffer.from(JSON.stringify({ files: tree }), 'utf8')
  const dataStart = Math.ceil((jsonStart + json.length) / 4) * 4
  const head = Buffer.alloc(dataStart)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(json.length, 12)
  json.copy(head, jsonStart)
  return Buffer.concat([head, ...contents.map((entry) => entry.bytes)])
}

function writeHome(runtimeJsonVersion: string | null): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-kprobe-'))
  if (runtimeJsonVersion !== null) {
    const dir = join(home, 'dsh-runtimes', 'dsh-primary-runtime')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'runtime.json'), JSON.stringify({ desktopVersion: runtimeJsonVersion }))
  }
  return home
}

const tmp = () => mkdtempSync(join(tmpdir(), 'dsh-kprobe-img-'))

test('N1: the archive wins over the stale cache and reports the running kernel version', () => {
  const dir = tmp()
  const asarPath = join(dir, 'app.asar')
  writeFileSync(asarPath, buildDesktopImage('0.2.2-rc.1', { 'dsh-tools': { version: '0.2.2-rc.1' } }))
  const result = probeKernelArchive({ asarPath })
  assert.equal(result.probe.state, 'read')
  assert.equal(result.manifest?.['version'], '0.2.2-rc.1')
  assert.equal(result.packages.size, 2, 'the kernel scope must yield every readable package')
  // C3: manifests are available together with the version, so rows can be judged from the same source.
  assert.equal(result.packages.get('@deepseek-ai/dsh-tools')?.['version'], '0.2.2-rc.1')
})

test('N2: no archive means "absent", never a synthesized version', () => {
  const result = probeKernelArchive({ asarPath: join(tmp(), 'not-there.asar') })
  assert.equal(result.probe.state, 'absent')
  assert.equal(result.manifest, null)
  assert.equal(result.packages.size, 0)
})

test('N5: a truncated archive is "unreadable", not thrown and not "absent"', () => {
  const dir = tmp()
  const asarPath = join(dir, 'app.asar')
  writeFileSync(asarPath, buildDesktopImage('0.2.2-rc.1').subarray(0, 20))
  const result = probeKernelArchive({ asarPath })
  assert.equal(result.probe.state, 'unreadable')
  assert.match(String(result.probe.detail), /header-unreadable|too-small/)
})

test('an archive without the dsh package is "unreadable", not a fake version', () => {
  const dir = tmp()
  const asarPath = join(dir, 'app.asar')
  writeFileSync(asarPath, buildImage({ 'other.json': '{}' }))
  const result = probeKernelArchive({ asarPath })
  assert.equal(result.probe.state, 'unreadable')
  assert.equal(result.manifest, null)
})

test('N7: runtime.json disagreeing with the archive is recorded, and neither value is chosen', () => {
  const home = writeHome('0.2.1-rc.4')
  const dir = tmp()
  const asarPath = join(dir, 'app.asar')
  writeFileSync(asarPath, buildDesktopImage('0.2.2-rc.1'))
  const result = probeKernelArchive({ asarPath, dshHome: home })
  assert.equal(result.probe.state, 'read')
  assert.equal(result.manifest?.['version'], '0.2.2-rc.1', 'the archive is the version source (M14-C1)')
  assert.equal(result.probe.runtimeJsonVersion, '0.2.1-rc.4', 'the shell manifest is recorded, not used')
  assert.equal(result.probe.disagrees, true)
})

test('runtime.json agreeing is not a disagreement', () => {
  const home = writeHome('0.2.2-rc.1')
  const dir = tmp()
  const asarPath = join(dir, 'app.asar')
  writeFileSync(asarPath, buildDesktopImage('0.2.2-rc.1'))
  const result = probeKernelArchive({ asarPath, dshHome: home })
  assert.equal(result.probe.disagrees, false)
})

test('the probe can be disabled, and then it says nothing', () => {
  const result = probeKernelArchive({ disabled: true })
  assert.equal(result.probe.state, 'absent')
  assert.equal(result.manifest, null)
})

test('the real desktop archive answers when this machine has one', () => {
  const result = probeKernelArchive({})
  if (result.probe.state !== 'read') return // no desktop build here: not evidence either way
  assert.match(String(result.manifest?.['version']), /\d\.\d\.\d/)
  assert.ok(result.packages.size > 50, `expected a large kernel scope, got ${result.packages.size}`)
})
