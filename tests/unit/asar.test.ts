/**
 * R101: the asar reader must be pure, total, and honest about malformed input (M14-C1..C7, N5..N7).
 *
 * WHY: `asar.ts` is the module that decides whether the CLI can see the runtime the Host is actually
 * running. Every failure mode below was written into the spec as a negative control because the alternative
 * — silently returning a plausible version — is the defect the whole change exists to remove.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  asarKernelPackages,
  asarReadFile,
  asarReadManifest,
  parseAsarArchive,
  type AsarArchive,
} from '../../packages/core/dist/asar.js'

/**
 * Build a minimal in-memory asar image. Chromium's format:
 *   [uint32 sizeField][uint32 directorySize][directorySize bytes of JSON][padding to 4][data]
 * Offsets inside the directory are relative to the data section start.
 */
function buildAsar(files: Record<string, { content: string }>, directory?: Record<string, unknown>): Buffer {
  const header: Record<string, unknown> = directory ?? {
    files: Object.fromEntries(
      Object.entries(files).map(([name]) => [name, { size: files[name]?.content.length ?? 0 }]),
    ),
  }
  const json = JSON.stringify(header)
  const jsonBuffer = Buffer.from(json, 'utf8')
  const directorySize = jsonBuffer.length
  const jsonStart = 16
  let offset = 0
  const entries = Object.entries(files)
  const withOffsets = Object.fromEntries(
    entries.map(([name, file]) => {
      const entry = { size: file.content.length, offset: String(offset) }
      offset += file.content.length
      return [name, entry]
    }),
  )
  const finalHeader = directory === undefined ? { files: withOffsets } : directory
  const finalJson = Buffer.from(JSON.stringify(finalHeader), 'utf8')

  const dataStart = Math.ceil((jsonStart + finalJson.length) / 4) * 4
  const data = Buffer.alloc(offset)
  let cursor = 0
  for (const [, file] of entries) {
    Buffer.from(file.content, 'utf8').copy(data, cursor)
    cursor += file.content.length
  }

  const head = Buffer.alloc(dataStart)
  head.writeUInt32LE(4, 0) // sizeField
  head.writeUInt32LE(finalJson.length, 12) // directorySize
  finalJson.copy(head, jsonStart)
  return Buffer.concat([head, data])
}

test('a well-formed image parses and yields its directory', () => {
  const archive = buildAsar({ 'a.json': { content: '{"name":"a","version":"1.0.0"}' } })
  const parsed = parseAsarArchive(archive)
  assert.ok('header' in parsed, 'a good image must parse')
  const ok = parsed as AsarArchive
  assert.ok(ok.header.files['a.json'], 'the directory must carry the entry')
})

test('N5: a truncated header is reported, not thrown', () => {
  const truncated = Buffer.alloc(32)
  truncated.writeUInt32LE(4, 0)
  truncated.writeUInt32LE(999_999, 12) // claims a directory far past the end
  const parsed = parseAsarArchive(truncated)
  assert.ok('code' in parsed, 'a truncated image must return an error, not an archive')
  assert.equal((parsed as { code: string }).code, 'header-unreadable')
})

test('N5b: a buffer shorter than the fixed prefix is refused', () => {
  const parsed = parseAsarArchive(Buffer.alloc(4))
  assert.ok('code' in parsed)
  assert.equal((parsed as { code: string }).code, 'too-small')
})

test('N6: an entry whose offset runs past the file is unreadable, never synthesized', () => {
  const archive = buildAsar(
    { 'broken.json': { content: '{}' } },
    {
      files: { 'broken.json': { size: 100_000, offset: '999999' } },
    },
  )
  const parsed = parseAsarArchive(archive)
  assert.ok('header' in parsed)
  const ok = parsed as AsarArchive
  assert.equal(asarReadFile(ok, ['broken.json']), null, 'an out-of-range offset must read as null')
})

test('a directory node is not a file, and a missing path is null', () => {
  const archive = buildAsar({ 'x.json': { content: '{}' } })
  const parsed = parseAsarArchive(archive)
  assert.ok('header' in parsed)
  const ok = parsed as AsarArchive
  assert.equal(asarReadFile(ok, ['nope.json']), null)
  assert.equal(asarReadFile(ok, ['files']), null)
})

test('asarReadManifest parses a manifest and refuses malformed JSON', () => {
  const good = buildAsar({ 'p.json': { content: '{"name":"p","version":"2.0.0"}' } })
  const bad = buildAsar({ 'p.json': { content: 'not json' } })
  const parsedGood = parseAsarArchive(good) as AsarArchive
  const parsedBad = parseAsarArchive(bad) as AsarArchive
  assert.equal((asarReadManifest(parsedGood, ['p.json']) ?? {})['version'], '2.0.0')
  assert.equal(asarReadManifest(parsedBad, ['p.json']), null)
})

test('asarKernelPackages keys by declared name and skips unreadable manifests', () => {
  // Build the kernel shape directly: dsh/node_modules/@deepseek-ai/<pkg>/package.json
  const image = buildAsar(
    {},
    {
      files: {
        dsh: {
          files: {
            node_modules: {
              files: {
                '@deepseek-ai': {
                  files: {
                    'dsh': { files: { 'package.json': { size: 0, offset: '0' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  )
  const parsed = parseAsarArchive(image)
  assert.ok('header' in parsed)
  // A zero-size entry parses to an empty manifest → skipped; the scope directory is still read.
  const packages = asarKernelPackages(parsed as AsarArchive)
  assert.equal(packages.size, 0)
})

test('the real desktop asar is readable when it exists (guarded: CI machines may not have one)', () => {
  const asarPath = 'C:/Users/rongj/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'
  let buffer: Buffer
  try {
    buffer = readFileSync(asarPath)
  } catch {
    return // no desktop build on this machine: the guarded path is not evidence either way
  }
  const parsed = parseAsarArchive(buffer)
  assert.ok('header' in parsed, 'the real image must parse')
  const archive = parsed as AsarArchive
  const manifest = asarReadManifest(archive, ['dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'])
  assert.ok(manifest !== null, 'the kernel manifest must be readable')
  assert.match(String(manifest?.['version']), /^\d+\.\d+\.\d+-rc\.\d+$/, 'the kernel version must be a real rc')
  const packages = asarKernelPackages(archive)
  assert.ok(packages.size > 100, `expected the kernel scope to hold many packages, got ${packages.size}`)
})
