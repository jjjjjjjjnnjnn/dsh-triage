#!/usr/bin/env node
/**
 * Release preflight — the short version of "why did publishing fail".
 *
 * R49 exists because `npm publish` at the repo root (and an expired npm token) each surfaced as
 * an opaque `EPRIVATE` / `404 Not found`. This walks the four things that actually decide whether
 * `pnpm -r publish` can succeed and prints one sentence per failure with the exact next command:
 *
 *   1. are you logged in to npm at all;
 *   2. does every publishable manifest agree on the version (a partial publish is worse than none);
 *   3. is `access: public` set (a scoped package defaults to private, which needs a paid org);
 *   4. do the four tarballs actually contain what they claim (`pnpm pack --dry-run` style listing).
 *
 * It never publishes, never writes to the registry, and exits non-zero on the first blocking item.
 *
 *   node scripts/release_preflight.mjs
 *   node scripts/release_preflight.mjs --json
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const json = process.argv.includes('--json')
const problems = []
const notes = []

function run(command, args) {
  try {
    return { ok: true, out: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  } catch (error) {
    return { ok: false, out: String(error?.stderr ?? error?.message ?? error).trim() }
  }
}

/* 1. auth ------------------------------------------------------------------ */
// `npm whoami` is the cheapest honest check: it hits the registry with the stored token.
const who = run('npm', ['whoami'])
if (!who.ok) {
  problems.push({
    id: 'not-logged-in',
    detail: 'npm 不认这个 token（`npm whoami` 返回 401）。未登录时发布 scoped 包会报 404 Not found，看起来像「包不存在」。',
    fix: 'npm login        # 浏览器/终端交互登录，然后重跑 `pnpm run release:publish`',
  })
} else {
  notes.push(`npm user: ${who.out}`)
}

/* 2. versions -------------------------------------------------------------- */
const packages = ['packages/core', 'packages/plugin', 'packages/signals', 'packages/probe']
const manifests = packages.map((dir) => {
  const path = `${dir}/package.json`
  if (!existsSync(path)) {
    problems.push({ id: 'missing-manifest', detail: `找不到 ${path}`, fix: '先确认工作区完整' })
    return null
  }
  return { dir, manifest: JSON.parse(readFileSync(path, 'utf8')) }
}).filter((item) => item !== null)

const versions = new Set(manifests.map((item) => item.manifest.version))
if (versions.size > 1) {
  problems.push({
    id: 'version-skew',
    detail: `四个包版本不一致：${manifests.map((item) => `${item.manifest.name}@${item.manifest.version}`).join(' / ')}`,
    fix: '四个包必须同版本发布（插件 import 新 core 的导出，会在加载时炸）——先统一 version',
  })
} else if (versions.size === 1) {
  notes.push(`version: ${[...versions][0]}`)
}

/* 3. access ---------------------------------------------------------------- */
const notPublic = manifests.filter((item) => item.manifest.publishConfig?.access !== 'public')
if (notPublic.length > 0) {
  problems.push({
    id: 'scoped-without-public',
    detail: `${notPublic.map((item) => item.manifest.name).join(', ')} 没有 publishConfig.access=public；scoped 包默认按私有发布，会要求付费组织`,
    fix: '在各自的 package.json 里加 "publishConfig": { "access": "public" }，或用 `pnpm -r publish --access public`',
  })
}

/* 4. build output --------------------------------------------------------- */
// A publish that ships without `dist/` produces a package that installs and then fails to load
// — the worst outcome for a user, because everything "succeeded". Check it before publishing.
for (const item of manifests) {
  const files = Array.isArray(item.manifest.files) ? item.manifest.files : []
  if (!files.includes('dist')) {
    problems.push({
      id: 'files-missing-dist',
      detail: `${item.manifest.name} 的 files 里没有 dist`,
      fix: '在 package.json 的 files 加上 "dist"',
    })
  }
  if (!existsSync(`${item.dir}/dist`)) {
    problems.push({
      id: 'dist-not-built',
      detail: `${item.manifest.name} 还没有 dist/（发布出去的包会装得上但加载失败）`,
      fix: 'pnpm run build',
    })
  }
}

/* output ------------------------------------------------------------------- */
const report = { ok: problems.length === 0, problems, notes }
if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  process.stdout.write('release preflight\n')
  for (const note of notes) process.stdout.write(`  ok    ${note}\n`)
  for (const problem of problems) {
    process.stdout.write(`  FAIL  ${problem.id}: ${problem.detail}\n        → ${problem.fix}\n`)
  }
  if (problems.length === 0) {
    process.stdout.write('\n可以发布：pnpm run release:publish   （会提示输入 npm 的 6 位 OTP）\n')
  } else {
    process.stdout.write(`\n${problems.length} 个问题；先修上面的，再发布。\n`)
  }
}
process.exit(problems.length === 0 ? 0 : 1)
