#!/usr/bin/env node
/**
 * Gate: governance.
 *
 * Keeps the repository from rotting: index references must resolve, the gate
 * registry must match `scripts/`, ledgers must exist, quarantine entries must be
 * complete, and no credential-shaped string may enter the tree.
 *
 * Negative control: `--mutate` registers a phantom path in the reference list.
 */

import { Checks, exists, listDir, readJson, readText, runGate } from './lib/kit.mjs'

// Files that legitimately contain credential-shaped prose (documentation of the rule itself).
const SECRET_SCAN_SKIP = new Set(['COMPLIANCE.md', 'audit/AI_DISCLOSURE_LOG.md', 'scripts/gate_governance.mjs'])

await runGate('governance', async ({ checks, mutate }) => {
  checks.require('agents-md', exists('AGENTS.md'))
  checks.require('project-rules', exists('PROJECT_RULES.md'))
  checks.require('index-md', exists('INDEX.md'))
  checks.require('compliance', exists('COMPLIANCE.md'))
  checks.require('license', exists('LICENSE'))

  // 1. INDEX.md table rows reference real paths.
  const index = readText('INDEX.md')
  const referenced = []
  for (const line of index.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const candidate = match[1]
      if (!looksLikePath(candidate)) continue
      if (candidate.includes('*')) continue
      referenced.push(candidate)
    }
  }
  const uniqueReferences = [...new Set(referenced)]
  const phantom = mutate ? 'docs/does-not-exist.md' : null
  const broken = uniqueReferences.filter((path) => !exists(stripAnchor(path)))
  const mutatedBroken = phantom !== null && !exists(phantom) ? [phantom] : []
  checks.add(
    'index-references',
    broken.length + mutatedBroken.length === 0,
    [...broken, ...mutatedBroken].slice(0, 5).join(', ') || `${uniqueReferences.length} references ok`,
  )

  // 2. Gate registry <-> scripts/ parity.
  const ledger = readJson('audit/gate_ledger.json')
  const registered = new Set((ledger.gates ?? []).map((gate) => gate.script))
  const onDisk = listDir('scripts')
    .filter((entry) => entry.isFile && /^gate_.*\.mjs$/.test(entry.name) && entry.name !== 'gate.mjs')
    .map((entry) => `scripts/${entry.name}`)
  const missingOnDisk = [...registered].filter((script) => !exists(script))
  const missingInLedger = onDisk.filter((script) => !registered.has(script))
  checks.add(
    'gate-registry',
    missingOnDisk.length === 0 && missingInLedger.length === 0,
    [...missingOnDisk.map((s) => `missing:${s}`), ...missingInLedger.map((s) => `unregistered:${s}`)].join(', ') ||
      `${onDisk.length} gates`,
  )
  for (const gate of ledger.gates ?? []) {
    checks.add(`gate-meta:${gate.id}`, Boolean(gate.enforces && gate.negative_control), `negative control: ${gate.negative_control ?? 'none'}`)
  }

  // 3. Audit ledgers.
  const disclosure = readText('audit/AI_DISCLOSURE_LOG.md')
  checks.require('disclosure-entries', disclosure.split(/\r?\n/).filter((line) => line.startsWith('### ')).length >= 1)
  const blindSpots = readJson('audit/blind_spots.json')
  const spots = Array.isArray(blindSpots.blind_spots) ? blindSpots.blind_spots : []
  checks.require('blind-spots', spots.length >= 3, `${spots.length} entries`)
  for (const spot of spots) {
    checks.add(
      `blind-spot:${spot.id}`,
      Boolean(spot.area && spot.cannot_see && spot.mitigation && spot.owner),
      spot.id,
    )
  }

  // 4. Archive manifest rows must exist on disk (archive-only removals).
  const archive = readText('_archive/ARCHIVE_MANIFEST.md')
  const archiveRows = archive
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---') && !line.includes('尚未归档'))
  const archiveProblems = []
  for (const row of archiveRows) {
    const cells = row.split('|').map((cell) => cell.trim())
    const archivedPath = cells[3]
    if (archivedPath === undefined || archivedPath === '' || archivedPath === '归档路径') continue
    if (!exists(archivedPath)) archiveProblems.push(archivedPath)
  }
  checks.add('archive-manifest', archiveProblems.length === 0, archiveProblems.join(', ') || 'no dangling entries')

  // 5. Quarantine manifest completeness.
  const vendor = readJson('quarantine/vendor-manifest.json')
  const vendorEntries = Array.isArray(vendor.entries) ? vendor.entries : []
  checks.require('vendor-manifest', vendorEntries.length >= 1, `${vendorEntries.length} entries`)
  for (const entry of vendorEntries) {
    checks.add(
      `vendor:${entry.id}`,
      Boolean(entry.id && entry.name && entry.source && entry.license && entry.used_for && entry.usage && typeof entry.commercial_ok === 'boolean'),
      entry.id,
    )
  }

  // 6. Credential-shaped strings.
  const suspicious = []
  const patterns = [/sk-[A-Za-z0-9]{20,}/, /ghp_[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{20,}/, /-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----/]
  for (const file of scanTargets()) {
    if (SECRET_SCAN_SKIP.has(file)) continue
    const text = readText(file)
    for (const pattern of patterns) {
      if (pattern.test(text)) suspicious.push(`${file}:${pattern.source}`)
    }
  }
  checks.add('no-credentials', suspicious.length === 0, suspicious.slice(0, 5).join(', ') || 'clean')

  // 6b. Privacy: committed SSOT must not contain user-home paths.
  // `data/results` is meant to be publishable, so a leaked `C:\Users\<name>` would
  // end up in git history forever (found via tests/e2e + fixed by redact.ts).
  const homePatterns = [
    /[A-Za-z]:\\\\Users\\\\/,
    /[A-Za-z]:\\Users\\/,
    /\/home\/[a-z0-9._-]+\//i,
    /\/Users\/[A-Za-z0-9._-]+\//,
    // Flattened paths: a slug made from an absolute path loses the separators, and the
    // patterns above stop matching while the account name is still there (R14 audit
    // finding F-2: `C-Users-<name>-Desktop-…` slipped into three probe artifacts).
    /[A-Za-z]-Users-[A-Za-z0-9._-]{2,}/,
  ]
  const leaked = []
  for (const entry of listDir('data/results').filter((item) => item.isFile && item.name.endsWith('.json'))) {
    const text = readText(`data/results/${entry.name}`)
    for (const pattern of homePatterns) {
      if (pattern.test(text)) leaked.push(`data/results/${entry.name}:${pattern.source}`)
    }
  }
  if (mutate) leaked.push('data/results/injected.json:leak-simulation')
  checks.add('results-privacy', leaked.length === 0, leaked.slice(0, 3).join(', ') || 'no home paths in SSOT')

  // 7. Agent framework completeness (.agents/README.md §4).
  const roleFiles = listDir('.agents/roles')
    .filter((entry) => entry.isFile && entry.name.endsWith('.md'))
    .map((entry) => `.agents/roles/${entry.name}`)
  checks.require('agent-roles', roleFiles.length >= 5, `${roleFiles.length} role cards`)
  const requiredSections = ['## 输入', '## 输出', '## 禁区', '## 验收']
  for (const [index, role] of roleFiles.entries()) {
    const raw = readText(role)
    const text = mutate && index === 0 ? raw.replace('## 验收', '## 已删除') : raw
    const missing = requiredSections.filter((section) => !text.includes(section))
    checks.add(`role:${role}`, missing.length === 0, missing.join(', ') || 'ok')
  }

  const promptFiles = listDir('.agents/prompts')
    .filter((entry) => entry.isFile && entry.name.endsWith('.md'))
    .map((entry) => `.agents/prompts/${entry.name}`)
  checks.require('agent-prompts', promptFiles.length >= 3, `${promptFiles.length} templates`)
  for (const [index, prompt] of promptFiles.entries()) {
    const raw = readText(prompt)
    const text = mutate && index === 0 ? raw.replace('## 模板', '## 空') : raw
    checks.add(`prompt:${prompt}`, text.includes('## 模板'), 'missing ## 模板 section')
  }

  checks.add(
    'agents-entry-linked',
    readText('AGENTS.md').includes('.agents/README.md'),
    'AGENTS.md must link .agents/README.md',
  )

  const handoff = readText('docs/HANDOFF.md')
  checks.add(
    'handoff-sections',
    handoff.includes('## 2. 当前批次') && handoff.includes('## 3. 下一位 agent 的第一件事'),
    'HANDOFF.md needs 当前批次 + 第一件事',
  )
  checks.add('handoff-command', /```powershell[\s\S]{10,}?```/.test(handoff), 'first task must be a runnable command block')

  checks.add(
    'disclosure-session-slot',
    disclosure.includes('SessionID'),
    'AI_DISCLOSURE_LOG.md must carry a SessionID field',
  )
})

function looksLikePath(value) {
  if (value.startsWith('http') || value.startsWith('#') || value.startsWith('@')) return false
  return value.includes('/') || /\.(md|json|mjs|ts|yml|yaml|txt)$/.test(value)
}

function stripAnchor(value) {
  return value.split('#')[0] ?? value
}

function scanTargets() {
  const targets = []
  for (const root of ['docs', 'packages', 'scripts', 'tests', 'audit', '.agents']) {
    collect(root, targets)
  }
  for (const entry of listDir('')) {
    if (entry.isFile && /\.(md|json|ya?ml)$/.test(entry.name)) targets.push(entry.name)
  }
  return targets
}

function collect(relativePath, out) {
  for (const entry of listDir(relativePath)) {
    const next = `${relativePath}/${entry.name}`
    if (entry.isDirectory) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collect(next, out)
    } else if (entry.isFile && /\.(md|json|mjs|ts|ya?ml)$/.test(entry.name)) {
      out.push(next)
    }
  }
}

void Checks
