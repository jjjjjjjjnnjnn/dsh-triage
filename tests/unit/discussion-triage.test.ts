/**
 * "Can we answer this thread?" — the classifier's rules, pinned (R57).
 *
 * The whole risk of this feature is flattering ourselves: calling a gateway 503 "answerable" because
 * the word "plugin" appears in it. Each test below is one of those temptations.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyThread, extractPackages } from '../../scripts/lib/discussion-triage.mjs'

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
