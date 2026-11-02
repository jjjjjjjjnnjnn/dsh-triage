/**
 * "Can we answer this thread?" — the classifier's rules, pinned (R57).
 *
 * The whole risk of this feature is flattering ourselves: calling a gateway 503 "answerable" because
 * the word "plugin" appears in it. Each test below is one of those temptations.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyThread, classifyThreadV2, classifyThreadV3, extractPackages } from '../../scripts/lib/discussion-triage.mjs'

test('a runtime crash is never "answerable", even when it mentions plugins', () => {
  const result = classifyThread({
    title: '[Bug] workspaceController is unavailable',
    body: 'workspace create failed: gateway/service-unavailable: typert gateway: active Service "workspaceController" is unavailable. plugins are installed.',
  })
  assert.equal(result.layer, 'runtime')
  assert.equal(result.verdict, 'partially-answerable', 'we can rule the declaration layer out, and no more')
  assert.match(result.reason, /upstream work/)
})

test('an admission thread that names a package is answerable without their profile', () => {
  const result = classifyThread({
    title: '升级到 0.2.1-rc.5 之后插件不见了',
    body: 'incompatible: peer @deepseek-ai/dsh-tools@0.2.1-rc.4 does not include 0.2.1-rc.5. 用的是 @linxin666/dsh-web-all。',
  })
  assert.equal(result.layer, 'admission')
  assert.equal(result.verdict, 'answerable')
  // Both names in the text are real package references; order is first-seen.
  assert.deepEqual(result.packages, ['@deepseek-ai/dsh-tools', '@linxin666/dsh-web-all'])
})

test('an admission thread with no package name needs their profile', () => {
  const result = classifyThread({
    title: '插件被禁用了',
    body: 'some plugin is incompatible after the upgrade, I do not know which one.',
  })
  assert.equal(result.verdict, 'needs-their-profile')
  assert.equal(result.answerableWith, 'dsh-triage audit (their profile)')
})

test('a thread with no signal at all is not-ours, not "probably a plugin"', () => {
  const result = classifyThread({ title: 'How do I change the theme?', body: 'Just aesthetics, thanks.' })
  assert.equal(result.layer, 'unknown')
  assert.equal(result.verdict, 'not-ours')
  assert.equal(result.answerableWith, null)
})

test('a scoped name does not also yield its bare suffix', () => {
  assert.deepEqual(extractPackages('see @deepseek-ai/dsh-mcp-client@0.1.0-rc.7 for details'), [
    '@deepseek-ai/dsh-mcp-client',
  ])
  assert.deepEqual(extractPackages('dsh-livedocs is the culprit'), ['dsh-livedocs'])
})

test('our own package and generic names are not probe targets', () => {
  assert.deepEqual(extractPackages('install dsh-triage, dsh-plugin, dsh-plugins and dsh-tools'), [])
})

/*
 * R60 / classifier v2. The 20-thread review found nine runtime reports that used none of v1's
 * keywords ("fails", "cannot", "TRANSPORT", "0xC0000142", "无法"). These tests pin the new generic
 * signals AND the things that must NOT become runtime (a feature request, a provider question).
 */

test('R60: a plain "fails" report is runtime, not unknown', () => {
  const result = classifyThreadV2({
    title: 'when we press back the harness fails',
    body: 'when we press back space; also when we type it takes only 1 letter',
  })
  assert.equal(result.layer, 'runtime')
  assert.equal(result.verdict, 'partially-answerable')
})

test('R60: TRANSPORT and native error codes are runtime shapes', () => {
  const transport = classifyThreadV2({ title: 'cad_render makes the session die', body: 'DeepSeek Messages transport failed (TRANSPORT) in ~0 ms' })
  assert.equal(transport.layer, 'runtime')
  const code = classifyThreadV2({ title: 'sandbox child processes fail', body: 'exit=0xC0000142; schannel: SEC_E_NO_CREDENTIALS' })
  assert.equal(code.layer, 'runtime')
})

test('R60: a Chinese "无法..." report is runtime', () => {
  const result = classifyThreadV2({ title: '开局弹窗', body: '暂时无法保存确认状态，请重试；相当于无法使用' })
  assert.equal(result.layer, 'runtime')
})

test('R60: a fork under the same name is composition', () => {
  const result = classifyThreadV2({
    title: '如何替换官方实现',
    body: '我 fork 了官方插件，package.json 的 name 相同，node_modules 里多了一个 link。',
  })
  assert.equal(result.layer, 'composition')
})

test('R60: inject / preset wiring is composition', () => {
  const result = classifyThreadV2({
    title: '第三方 bundle 让 preset 永久 pending',
    body: 'bundle patch 用 inject 给核心条目加硬依赖，preset-standard 停在 FIBER_PENDING。',
  })
  assert.equal(result.layer, 'composition')
})

test('R60: a feature request with no failure verb stays unknown', () => {
  const result = classifyThreadV2({ title: 'Please add a dark mode switch', body: 'It would make the UI nicer for night work.' })
  assert.equal(result.layer, 'unknown')
  assert.equal(result.verdict, 'not-ours')
})

test('R60: a provider/model question stays unknown', () => {
  const result = classifyThreadV2({
    title: 'Why does the opencode provider not update its model list?',
    body: 'The go plan gets new models, but the provider list seems stale.',
  })
  assert.equal(result.layer, 'unknown')
})

test('R60: "install fails: peer..." stays admission (tie goes to admission)', () => {
  const result = classifyThreadV2({
    title: 'install fails after the upgrade',
    body: 'peer @deepseek-ai/dsh-tools@0.2.1-rc.4 does not include 0.2.1-rc.5',
  })
  assert.equal(result.layer, 'admission')
  assert.equal(result.verdict, 'answerable')
})

test('R60: a version question with no failure verb is admission, and needs their profile', () => {
  const result = classifyThreadV2({
    title: 'which dsh version should I use?',
    body: 'I am on 0.2.1-rc.5 and want to know the supported version.',
  })
  assert.equal(result.layer, 'admission')
  assert.equal(result.verdict, 'needs-their-profile')
})

/*
 * R61 / classifier v3. v2's holdout missed Chinese/log shapes (卡着, 403, 400, 损坏, 提权, symlink,
 * "no text block") and falsely fired on `不能` inside a methodology paragraph. v3 adds those shapes
 * and a question/feature-request veto. These tests pin both directions.
 */

test('R61: Chinese "卡着" and 403 are runtime shapes', () => {
  assert.equal(classifyThreadV3({ title: '提问一直卡着', body: '模型提问一直卡着不给选啊' }).layer, 'runtime')
  assert.equal(classifyThreadV3({ title: '反代 403', body: '通过反代访问提示大部分接口返回403' }).layer, 'runtime')
})

test('R61: INVALID_REQUEST / HTTP 400 and corruption are runtime shapes', () => {
  const result = classifyThreadV3({
    title: '长会话被 400 拒绝',
    body: 'Content Exists Risk / INVALID_REQUEST (HTTP 400); 会话日志里有一段 tool/result 字节损坏。',
  })
  assert.equal(result.layer, 'runtime')
})

test('R61: a stale symlink is composition, not an upgrade', () => {
  const result = classifyThreadV3({
    title: 'stale broken fallback symlink breaks every request after upgrade',
    body: 'the symlink under $DSH_HOME/profiles/node_modules is a stale broken symlink; healProfilesModuleFallback never repairs it.',
  })
  assert.equal(result.layer, 'composition')
})

test('R61: elevation / permission is a runtime shape', () => {
  const result = classifyThreadV3({
    title: '更新后工作区需要提权',
    body: '更新后 4.1flash 说没法写入工作区 word 文档，需要权限/提权。',
  })
  assert.equal(result.layer, 'runtime')
})

test('R61: a turn with no text block is a runtime contract issue', () => {
  const result = classifyThreadV3({
    title: 'turn ends normally but the assistant message has no text block',
    body: 'the client receives nothing to display; only reasoning + tool-call blocks.',
  })
  assert.equal(result.layer, 'runtime')
})

test('R61: a methodology study using 不能, with no concrete failure, is not ours', () => {
  const result = classifyThreadV3({
    title: '请问身份提示是否影响推理模式',
    body: '还不能把这些实验写成因果结论，请问有没有办法排查？',
  })
  assert.equal(result.layer, 'unknown')
  assert.equal(result.verdict, 'not-ours')
})

test('R61: a how-to question with no failure is not ours', () => {
  const result = classifyThreadV3({
    title: 'qwen3.8 27b 怎么调用网页搜索工具？',
    body: '纯小白求教，本地模型怎么支持网页搜索？',
  })
  assert.equal(result.layer, 'unknown')
})

test('R61: a question that quotes a concrete failure is still a failure', () => {
  const result = classifyThreadV3({
    title: '能不能修一下粘贴长文本卡顿？',
    body: '粘贴到对话框文本过长会卡顿。',
  })
  assert.equal(result.layer, 'runtime')
})

test('R61: "install fails: peer..." stays admission under v3 too', () => {
  const result = classifyThreadV3({
    title: 'install fails after the upgrade',
    body: 'peer @deepseek-ai/dsh-tools@0.2.1-rc.4 does not include 0.2.1-rc.5',
  })
  assert.equal(result.layer, 'admission')
  assert.equal(result.verdict, 'answerable')
})
