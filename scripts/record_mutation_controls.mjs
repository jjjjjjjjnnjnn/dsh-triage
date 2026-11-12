/**
 * Negative-control runner for the two R91 judgements (M10 desktop bridge, M11 kernel resolution).
 *
 * WHY THIS IS A SCRIPT AND NOT A ONE-OFF: a claim like "12 controls each go red" is exactly the kind
 * of sentence this repository has learned not to trust when it lives only in a report. Here it is a
 * command: each entry breaks ONE decision in the *built* output, runs the test that is supposed to
 * notice, restores the file byte-for-byte, and fails if either half is untrue — a control that stays
 * green, OR a restore that is not identical.
 *
 * The restore check is the part most mutation harnesses skip. A harness that leaves a mutated file
 * behind turns a green suite into a lie that outlives the run, so `restored_identical` is recorded
 * per case and the exit code depends on it.
 *
 * Zero dependencies (PROJECT_RULES: gates must always run). Usage:
 *
 *   node scripts/record_mutation_controls.mjs --stamp 2026-11-09T14:00:00.000Z
 *   node scripts/record_mutation_controls.mjs --stamp <ISO> --out <dir>   # rehearsal, no SSOT
 *
 * Exit codes: 0 all red + all restored · 2 usage / a control stayed green / a restore differed.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = argOf('--stamp', null)
const dryRun = argv.includes('--dry-run')
const stamp = rawStamp === null ? null : new Date(String(rawStamp)).toISOString()
if (!dryRun && (stamp === null || Number.isNaN(Date.parse(stamp)))) {
  process.stderr.write(
    'usage: node scripts/record_mutation_controls.mjs --stamp <ISO> [--out <dir>] [--dry-run]\n',
  )
  process.exit(2)
}
const outDir = join(ROOT, argOf('--out', 'data/results'))

/**
 * One decision, one break, one test that must notice.
 *
 * Every `from` string is a line of the *built* output (`dist/`), because that is what the tests
 * import. `why` is written as a statement of what the break would ship, not as a code description —
 * the point of a control is the false claim it prevents.
 */
const CASES = [
  {
    id: 'M10-N10',
    judgement: 'M10',
    rule: 'C1 ⑥ — 两者都被删掉时，只有带标记头的调用方被服务',
    why: '删掉标记分支：桌面设置页又变成 403',
    file: 'packages/plugin/dist/host-audit-route.js',
    from: '    if (input.clientMarker === CLIENT_MARKER_VALUE)\n        return { ok: true };\n',
    to: '',
    test: 'tests/unit/host-guard-desktop-bridge.test.ts',
  },
  {
    id: 'M10-N6/N7',
    judgement: 'M10',
    rule: 'C1 ⑥ — 标记头的值是精确匹配',
    why: '任何非空标记头都放行：一个「差不多」的头就能读到本机诊断',
    file: 'packages/plugin/dist/host-audit-route.js',
    from: '    if (input.clientMarker === CLIENT_MARKER_VALUE)\n        return { ok: true };',
    to: "    if (typeof input.clientMarker === 'string' && input.clientMarker !== '')\n        return { ok: true };",
    test: 'tests/unit/host-guard-desktop-bridge.test.ts',
  },
  {
    id: 'M10-N5',
    judgement: 'M10',
    rule: 'C4 — 方法检查排在一切之前',
    why: '标记头被放到方法检查之前：POST 也能读到答案',
    file: 'packages/plugin/dist/host-audit-route.js',
    from: "    if (input.method !== 'GET' && input.method !== 'HEAD') {",
    to: '    if (input.clientMarker === CLIENT_MARKER_VALUE)\n        return { ok: true };\n    if (input.method !== \'GET\' && input.method !== \'HEAD\') {',
    test: 'tests/unit/host-guard-desktop-bridge.test.ts',
  },
  {
    id: 'M10-N8',
    judgement: 'M10',
    rule: 'C2 — 出现过的 Sec-Fetch-Site 不由标记头翻案',
    why: '标记头压过 cross-site：跨站页面带个头就能洗白自己',
    file: 'packages/plugin/dist/host-audit-route.js',
    from: "    if (input.secFetchSite !== undefined && input.secFetchSite !== '') {",
    to: "    if (input.secFetchSite !== undefined && input.secFetchSite !== '' && input.clientMarker !== CLIENT_MARKER_VALUE) {",
    test: 'tests/unit/host-guard-desktop-bridge.test.ts',
  },
  {
    id: 'M10-C5',
    judgement: 'M10',
    rule: 'C5 — 浏览器半边必须真的发出标记头',
    why: '两半漂移：常量还在声明，只有一个 fetch 在发（另一个静默 403）',
    file: 'packages/plugin/client.js',
    from: "              headers: { accept: 'application/json', [CLIENT_MARKER_HEADER]: CLIENT_MARKER_VALUE },\n            })\n          } catch (error) {\n            // A dead route is a fact to report, not an exception to render: `load` never throws.",
    to: "              headers: { accept: 'application/json' },\n            })\n          } catch (error) {\n            // A dead route is a fact to report, not an exception to render: `load` never throws.",
    test: 'tests/unit/host-guard-desktop-bridge.test.ts',
  },
  {
    id: 'M11-N1',
    judgement: 'M11',
    rule: 'C1/C2 — 版本与 installed 用同一组 roots，且内核在前',
    why: '原始 bug：版本只从 profile / shared 取，读到陈旧缓存',
    file: 'packages/core/dist/env.js',
    from: '    const paths = [...kernelRoots, profileNodeModules, sharedNodeModules];',
    to: '    const paths = [profileNodeModules, sharedNodeModules];',
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M11-N1/N7',
    judgement: 'M11',
    rule: 'C3 — 内核 root 排在 profile / shared 之前',
    why: '内核 root 追加在最后：陈旧副本先答，layer 用错 patch 树',
    file: 'packages/core/dist/env.js',
    from: '    const paths = [...kernelRoots, profileNodeModules, sharedNodeModules];',
    to: '    const paths = [profileNodeModules, sharedNodeModules, ...kernelRoots];',
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M11-C4b',
    judgement: 'M11',
    rule: 'C4 — kernelRoots 只在 kernel 锚点上非空',
    why: 'inferred 也宣称内核 root：把缓存副本叫「宿主提供」',
    file: 'packages/core/dist/env.js',
    from: "    const kernelRoots = anchor.source === 'kernel' ? kernelAnchorRoots(anchor) : [];",
    to: '    const kernelRoots = kernelAnchorRoots(anchor);',
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M11-N2',
    judgement: 'M11',
    rule: 'C6 — 来源是测量结果，不是常量',
    why: '永远写 kernel：降级被抹掉，「推断」装成「实测」',
    file: 'packages/core/dist/env.js',
    from: '        dshSource: source,',
    to: "        dshSource: 'kernel',",
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M11-N5/N8',
    judgement: 'M11',
    rule: 'C3 — bundle roots 必须包含内核',
    why: 'issue #1 未修：内核自带 bundle 判「未安装」',
    file: 'packages/plugin/dist/load.js',
    from: "    for (const root of env.kernelRoots ?? [])\n        add(root, 'kernel');",
    to: '',
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M11-N6',
    judgement: 'M11',
    rule: 'C5 — 真找不到时必须报出来',
    why: '静默丢弃：加 roots 变成「什么都不报」',
    file: 'packages/plugin/dist/load.js',
    from: '            errors.push(`bundle ${name} is listed in dsh.profile.bundles but no copy was found in the profile, the shared layer, or the kernel`);',
    to: '            void name;',
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M11-N9',
    judgement: 'M11',
    rule: 'C3 — 每一处 package 解析用同一组 roots（layer 与 row 不许各用一套）',
    why: '行解析只看 profile / shared：内核包被拿陈旧版本judged（119 条假 blocked）',
    file: 'packages/plugin/dist/load.js',
    from: '    const roots = moduleRoots(env).map((entry) => entry.root);',
    to: "    const roots = [join(env.profileDir, 'node_modules'), join(dirname(env.profileDir), 'node_modules')];",
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M11-N10',
    judgement: 'M11',
    rule: 'C1 — 「kernel」的含义是「不是 profile / shared 缓存」',
    why: '入口走查落在共享缓存上也自称 kernel：把 0.1.0-rc.6 印成「实测」',
    file: 'packages/core/dist/env.js',
    from: "                    source: isCache(nodeModules) ? 'inferred' : 'kernel',",
    to: "                    source: 'kernel',",
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M12-N1',
    judgement: 'M12',
    rule: 'C1 — surface 由包的身份决定，不由「存在两份」决定',
    why: '每条 duplicate 都算能撞：13 条普通库又占满一屏',
    file: 'packages/plugin/dist/load.js',
    from: '            surface: canSurfaceInDsh(name, bundles),',
    to: '            surface: true,',
    test: 'tests/unit/duplicates.test.ts',
  },
  {
    id: 'M12-N2',
    judgement: 'M12',
    rule: 'C1 — 判定的那一层也要认 surface:false',
    why: '只有扫描层标记、判定层照旧：一屏仍然满是库副本',
    file: 'packages/core/dist/duplicates.js',
    from: '        if (duplicate.surface === false)',
    to: '        if (false)',
    test: 'tests/unit/duplicates.test.ts',
  },
  {
    id: 'M12-N3',
    judgement: 'M12',
    rule: 'C3 — 缺省 surface 是 finding，不是「不算」',
    why: '把 `=== false` 写成 `!surface`：手写的 duplicate 被静默降级',
    file: 'packages/core/dist/duplicates.js',
    from: '        if (duplicate.surface === false)',
    to: '        if (!duplicate.surface)',
    test: 'tests/unit/duplicates.test.ts',
  },
  {
    id: 'M12-N4',
    judgement: 'M12',
    rule: 'C4 — 脱离 bundle 清单的 harness 包也要算',
    why: 'canSurfaceInDsh 只看 bundles：嵌套的 dsh-* 又变回「不算」',
    file: 'packages/plugin/dist/load.js',
    from: "    return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-');",
    to: '    return false;',
    test: 'tests/unit/duplicates.test.ts',
  },
  {
    id: 'M11-C4',
    judgement: 'M11',
    rule: 'C4 — 内核 layer 的 provenance 是 kernel',
    why: '内核 layer 标成 profile：诊断再也说不清是谁提供的',
    file: 'packages/plugin/dist/load.js',
    from: "    for (const root of env.kernelRoots ?? [])\n        add(root, 'kernel');",
    to: "    for (const root of env.kernelRoots ?? [])\n        add(root, 'profile');",
    test: 'tests/unit/kernel-resolution.test.ts',
  },
  {
    id: 'M13-N1',
    judgement: 'M13',
    rule: 'C1 — 行按声明它的那个包解析（pnpm isolated 的整棵树只在 .pnpm 里）',
    why: '删掉 per-declarer 兜底：沙盒上 190 行只解析 2 行，188 条假 row-missing（BS-61 的 CLI 半边）',
    file: 'packages/plugin/dist/load.js',
    from: '        if (resolved === null && context !== undefined) {',
    to: '        if (false) {',
    test: 'tests/unit/row-resolution.test.ts',
  },
  {
    id: 'M13-N2',
    judgement: 'M13',
    rule: 'C1 — 声明者的**真实路径**才是搜索起点（软链不算）',
    why: '不解析 realpath：起点停在软链上，整棵树看不见，与「没修」等价',
    file: 'packages/plugin/dist/load.js',
    from: '        real = await realpath(start);',
    to: '        real = start;',
    test: 'tests/unit/row-resolution.test.ts',
  },
  {
    id: 'M13-N3',
    judgement: 'M13',
    rule: 'C2 — 只做加法：扁平 roots 已经有答案的行不许被改写',
    why: '先查声明者再查扁平：今天能解析的行被换成另一个副本（金标与 M11-N9 一起作废）',
    file: 'packages/plugin/dist/load.js',
    from: '        if (resolved === null && context !== undefined) {',
    to: '        if (resolved !== null && context !== undefined) {',
    test: 'tests/unit/row-resolution.test.ts',
  },
  {
    id: 'M16-N1',
    judgement: 'M16',
    rule: 'C1 — 归档里有这个 bundle 时，组合层从归档读',
    why: '不读归档：CLI 继续用缓存里 dsh-base@0.1.0-rc.6 的 patch，llm-deepseek 那条 phantom collision 原样存在',
    file: 'packages/plugin/dist/load.js',
    from: '        const fromArchive = archive === null ? null : readBundleFromArchive(archive, name, errors);',
    to: '        const fromArchive = null;',
    test: 'tests/unit/composition-source.test.ts',
  },
  {
    id: 'M16-N2',
    judgement: 'M16',
    rule: 'C2 — 没有归档时逐条退回旧行为',
    why: '版本不是 kernel-asar 也去读归档：夹具与 CI 被本机桌面壳改判（M14 第一次跑就踩过）',
    file: 'packages/plugin/dist/load.js',
    from: "    if (env.dshSource !== 'kernel-asar')\n        return null;",
    to: '',
    test: 'tests/unit/composition-source.test.ts',
  },
  {
    id: 'M16-N3',
    judgement: 'M16',
    rule: 'C1 — 归档里没有这个 bundle 就走磁盘，provenance 不变',
    why: '归档里没有也硬读：第三方 bundle 被标成 kernel，缺包不再报警',
    file: 'packages/plugin/dist/load.js',
    from: '    if (manifest === null)\n        return null;',
    to: "    if (manifest === null)\n        return { name, manifest: {}, version: null, dir: '', provenance: 'kernel', patchFiles: [], patchPath: null, patchText: null };",
    test: 'tests/unit/composition-source.test.ts',
  },
  {
    id: 'M16-C3',
    judgement: 'M16',
    rule: 'C3 — 归档里缺的 patch 不许从缓存补位',
    why: 'patch 缺失就整层退回磁盘：manifest 来自 0.2.2、patch 来自 0.1.0，半修比不修更坏（M14-N3 的同一原型）',
    file: 'packages/plugin/dist/load.js',
    from: '        if (fromArchive !== null) {',
    to: '        if (fromArchive !== null && fromArchive.patchText !== null) {',
    test: 'tests/unit/composition-source.test.ts',
  },
]

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** Run one control. Returns the record that goes into the artifact. */
function runCase(item) {
  const path = join(ROOT, item.file)
  const original = readFileSync(path, 'utf8')
  if (!original.includes(item.from)) {
    return { ...item, setup: 'pattern-not-found', red: false, restored_identical: true, test_exit: null }
  }
  let red = false
  let testExit = null
  let restoredIdentical = true
  try {
    writeFileSync(path, original.replace(item.from, item.to))
    const run = spawnSync(process.execPath, ['--test', item.test], { cwd: ROOT, encoding: 'utf8' })
    testExit = run.status
    red = run.status !== 0
  } finally {
    writeFileSync(path, original)
    restoredIdentical = readFileSync(path, 'utf8') === original
  }
  return {
    id: item.id,
    judgement: item.judgement,
    rule: item.rule,
    why: item.why,
    file: item.file,
    test: item.test,
    setup: 'applied',
    red,
    restored_identical: restoredIdentical,
    test_exit: testExit,
  }
}

if (dryRun) {
  // A rehearsal must leave nothing behind: no mutations applied, no artifact written.
  for (const item of CASES) {
    const text = readFileSync(join(ROOT, item.file), 'utf8')
    process.stdout.write(`${text.includes(item.from) ? 'READY' : 'STALE'} ${item.id} → ${item.file}\n`)
  }
  process.exit(0)
}

const controls = CASES.map(runCase)
const passed = controls.filter((control) => control.red && control.restored_identical && control.setup === 'applied')
const failures = controls.filter((control) => !(control.red && control.restored_identical) || control.setup !== 'applied')

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_mutation_controls.mjs',
  generated_at: stamp,
  judgement: ['M10-desktop-bridge', 'M11-kernel-resolution'],
  controls_total: controls.length,
  controls_red: passed.length,
  all_red: failures.length === 0,
  controls,
  limits: [
    'Breaks the built output (packages/*/dist), which is what the tests import — not the sources.',
    'Proves each test can fail; it does not prove the source is the only thing that compiles to it.',
    'One break per rule. A test that notices two breaks at once is not distinguished from one.',
  ],
}

const name = `mutation-controls-${stamp.replaceAll(':', '-')}`
const file = join(outDir, `${name}.json`)
if (existsSync(file)) {
  process.stderr.write(`refusing to overwrite ${relative(ROOT, file)}\n`)
  process.exit(2)
}
mkdirSync(dirname(file), { recursive: true })
const text = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(file, text)
// The repository's `.sha256` convention is the bare digest (trimmed by the gate), not `digest  name`.
writeFileSync(`${file}.sha256`, `${sha256(text)}\n`)

for (const control of controls) {
  const state = control.setup !== 'applied' ? 'SETUP-FAIL' : control.red ? 'RED  ' : 'GREEN!!'
  const restore = control.restored_identical ? '' : ' + RESTORE-FAIL'
  process.stdout.write(`${state} ${control.id} — ${control.why}${restore}\n`)
}
process.stdout.write(
  `\n${failures.length === 0 ? 'NEGATIVE CONTROL PASSED' : `${failures.length} CONTROL(S) DID NOT GO RED`}` +
    ` · ${passed.length}/${controls.length} · ssot ${relative(ROOT, file)} · sha256 ${sha256(text).slice(0, 12)}…\n`,
)
process.exit(failures.length === 0 ? 0 : 1)
