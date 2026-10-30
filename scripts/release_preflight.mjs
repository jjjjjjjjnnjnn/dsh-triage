#!/usr/bin/env node
/**
 * Release preflight — the short version of "why did publishing fail".
 *
 * R49 exists because `npm publish` at the repo root (and an expired npm token) each surfaced as
 * an opaque `EPRIVATE` / `404 Not found`. This walks the five things that actually decide whether
 * `pnpm -r publish` can succeed and prints one sentence per failure with the exact next command:
 *
 *   1. are you logged in to npm at all;
 *   2. does every publishable manifest agree on the version (a partial publish is worse than none);
 *   3. is `access: public` set (a scoped package defaults to private, which needs a paid org);
 *   4. do the four tarballs actually contain what they claim (`pnpm pack --dry-run` style listing);
 *   5. if a dependency still says `workspace:`, is the publish done by the tool that rewrites it;
 *   6. is this exact version already on the registry (re-publishing it is a 403, not a mystery).
 *
 * It never publishes and never writes to the registry, and exits non-zero on the first blocking
 * item. With `--out <path>` it also records its own verdict as a hash-locked artifact, because
 * this repository does not accept a step without one.
 *
 *   node scripts/release_preflight.mjs
 *   node scripts/release_preflight.mjs --json
 *   node scripts/release_preflight.mjs --out data/results/release-preflight-<stamp>.json --stamp <ISO>
 *
 * 2026-10-30 — THE BUG THIS FILE USED TO HAVE: check 1 spawned `npm` directly, which on Windows is
 * `npm.cmd` and fails with `spawnSync npm ENOENT`; the failure was then reported with a hard-coded
 * "your token returned 401" sentence. The operator had a working token and spent the round
 * re-authenticating. Checks now separate "the answer is no" from "the question never reached the
 * registry" — see `scripts/lib/npm-auth.mjs` and `tests/unit/release-preflight.test.ts`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { classifyWhoami, npmInvocation } from './lib/npm-auth.mjs'

const argv = process.argv.slice(2)
const json = argv.includes('--json')
const stampIndex = argv.indexOf('--stamp')
const rawStamp = stampIndex === -1 ? new Date().toISOString() : (argv[stampIndex + 1] ?? '')
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-30T14:40:00.000Z\n`)
  process.exit(2)
}
const outIndex = argv.indexOf('--out')
const outPath = outIndex === -1 ? null : (argv[outIndex + 1] ?? null)
const problems = []
const notes = []

function run({ command, args }) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
      stderr: '',
    }
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? error?.message ?? error).trim(),
    }
  }
}

/* 1. auth ------------------------------------------------------------------ */
// `npm whoami` is the cheapest honest check: it hits the registry with the stored token.
// The invocation has to be platform-correct, and the three outcomes have to stay apart.
const who = run(npmInvocation(['whoami']))
const auth = classifyWhoami(who)
if (auth.state === 'logged-in') {
  notes.push(`npm user: ${auth.user}`)
} else if (auth.state === 'not-logged-in') {
  problems.push({
    id: 'not-logged-in',
    detail: `registry 拒绝了当前凭据（${auth.detail}）。未登录时发布 scoped 包会报 404 Not found，看起来像「包不存在」。`,
    observed: auth.observed,
    fix: 'npm login        # 浏览器/终端交互登录，然后重跑 `pnpm run release:publish`',
  })
} else {
  // Not an auth verdict. Saying "you are not logged in" here is what wasted a round on 2026-10-30.
  problems.push({
    id: 'check-could-not-run',
    detail: `预检查没能调用 npm（${auth.detail}），所以「是否登录」这个问题**没有答案**——这不等于没登录。`,
    observed: auth.observed,
    fix: '在 PowerShell 里手跑 `npm whoami`：能打印用户名说明登录没问题，要修的是这个脚本；报 ENOENT/EINVAL 通常是 Windows 上直接 spawn `npm.cmd` 导致的',
  })
}

/* 2. versions -------------------------------------------------------------- */
const packages = ['packages/core', 'packages/plugin', 'packages/signals', 'packages/probe']
const manifests = packages
  .map((dir) => {
    const path = `${dir}/package.json`
    if (!existsSync(path)) {
      problems.push({ id: 'missing-manifest', detail: `找不到 ${path}`, fix: '先确认工作区完整' })
      return null
    }
    return { dir, manifest: JSON.parse(readFileSync(path, 'utf8')) }
  })
  .filter((item) => item !== null)

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

/* 5. workspace: protocol -------------------------------------------------- */
// `workspace:*` is only rewritten by pnpm. `npm publish` writes it through verbatim and the
// installed package then fails to resolve — the 0.1.0 footgun. This is a conditional check:
// with no `workspace:` left there is nothing to rewrite, and saying "FAIL" would be a lie.
const internal = new Set(['@dsh-triage/core', '@dsh-triage/probe', '@dsh-triage/signals'])
const leftToRewrite = []
for (const item of manifests) {
  for (const [name, spec] of Object.entries(item.manifest.dependencies ?? {})) {
    if (internal.has(name) && String(spec).startsWith('workspace:')) {
      leftToRewrite.push(`${item.manifest.name} → ${name}@${spec}`)
    }
  }
}
if (leftToRewrite.length === 0) {
  notes.push('workspace: protocol: none to rewrite')
} else {
  const publishScript = String(JSON.parse(readFileSync('package.json', 'utf8'))?.scripts?.['release:publish'] ?? '')
  const goesThroughPnpm = /\bpnpm\b/.test(publishScript) && !/\bnpm\s+(?:-r\s+)?publish\b/.test(publishScript)
  if (goesThroughPnpm) {
    notes.push(`workspace: protocol: ${leftToRewrite.length} dep(s), publish goes through pnpm (rewritten)`)
  } else {
    problems.push({
      id: 'workspace-protocol-without-pnpm',
      detail: `${leftToRewrite.join(', ')} 还是 workspace: 协议，但发布命令不走 pnpm（"${publishScript}"）；npm publish 会原样写进 registry，用户装了会解析失败`,
      fix: '把 package.json 的 release:publish 改成 `pnpm -r publish`',
    })
  }
}

/* 6. is this version already on the registry? ----------------------------- */
// Re-running a publish on a version that is already up fails with "cannot publish over the
// previously published versions" (R40) — opaque unless you already know it. One GET answers it.
// A registry we cannot reach stays a note: this check never invents an answer either way.
if (versions.size === 1) {
  const version = [...versions][0]
  const already = []
  let unconfirmed = null
  for (const item of manifests) {
    const name = String(item.manifest.name)
    try {
      const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (response.status === 200) already.push(`${name}@${version}`)
      else if (response.status !== 404) unconfirmed = `${name}: HTTP ${response.status}`
    } catch (error) {
      unconfirmed = `${name}: ${String(error?.message ?? error)}`
    }
  }
  if (already.length > 0) {
    problems.push({
      id: 'version-already-published',
      detail: `${already.join(', ')} 已经在 registry 上了；再次发布会报 cannot publish over the previously published versions`,
      fix: `先把四个包的 version 一起 bump（如 0.3.1），或者这版已经发好了：直接跑 \`node scripts/record_publish.mjs --version ${version}\` 取证（\`--stamp\` 可省，默认当前时间；别把 \`<ISO>\` 原样粘进 PowerShell，\`<\` 是保留符）`,
    })
  } else if (unconfirmed === null) {
    notes.push(`registry: ${version} 还没发过`)
  } else {
    notes.push(`registry: 没能确认 ${version} 是否已发布（${unconfirmed}）——这不等于还没发`)
  }
}

/* output ------------------------------------------------------------------- */
const targetVersion = versions.size === 1 ? [...versions][0] : null
const report = { ok: problems.length === 0, target_version: targetVersion, problems, notes }

if (outPath !== null) {
  // `--out` exists so a round can hash-lock what the check said (the repository's rule: no
  // artifact, no step). It records only this process's own observations.
  const payload = {
    schema_version: 1,
    produced_by: 'scripts/release_preflight.mjs',
    generated_at: stamp,
    ...report,
    limits: [
      'this is the pre-publish check, not the release: it says nothing about the bytes a registry would serve (that is `record_publish`)',
      'a registry it could not reach is reported as a note, never as a pass',
    ],
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  const target = abs(outPath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text, 'utf8')
  writeFileSync(`${target}.sha256`, sha256(text), 'utf8')
  process.stdout.write(`ssot ${outPath} sha256=${sha256(text).slice(0, 12)}…\n`)
}

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  process.stdout.write('release preflight\n')
  for (const note of notes) process.stdout.write(`  ok    ${note}\n`)
  for (const problem of problems) {
    process.stdout.write(`  FAIL  ${problem.id}: ${problem.detail}\n`)
    if (problem.observed) process.stdout.write(`        实际输出: ${problem.observed}\n`)
    process.stdout.write(`        → ${problem.fix}\n`)
  }
  if (problems.length === 0) {
    process.stdout.write('\n可以发布：pnpm run release:publish   （会提示输入 npm 的 6 位 OTP）\n')
  } else {
    process.stdout.write(`\n${problems.length} 个问题；先修上面的，再发布。\n`)
  }
}
process.exit(problems.length === 0 ? 0 : 1)
