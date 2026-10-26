/**
 * Localized message catalog for verdict rendering.
 *
 * WHY a catalog instead of inline strings:
 * - `reason.code` / `messageId` stay stable for tests and machine consumers;
 * - adding a locale never touches the engine;
 * - gate `verdict-contract` forbids user-facing prose inside `reasons`.
 */

export type Locale = 'en' | 'zh'

export interface MessageCatalog {
  readonly locale: Locale
  readonly messages: Readonly<Record<string, string>>
}

const EN: MessageCatalog = {
  locale: 'en',
  messages: {
    'conclusion.go': 'installable',
    'conclusion.risky': 'installable with caveats',
    'conclusion.blocked': 'not usable as-is',
    'conclusion.unknown': 'not enough evidence',
    'admission.admitted': 'declared range matches this runtime ({runtime})',
    'admission.denied': 'declared range rejects this runtime ({runtime})',
    'admission.unconstrained': 'no DSH version declaration — admission cannot be judged',
    'admission.indeterminate': 'runtime version unknown — admission cannot be judged',
    'admission.declared-only': 'declaration passes only; runtime behaviour is unproven (run a probe)',
    'admission.unmet.engines': 'engines.dsh {range} does not include {runtime}',
    'admission.unmet.peer': 'peer {key}@{range} does not include {runtime}',
    'admission.failure.empty-range': 'empty range is treated as incompatible',
    'admission.failure.invalid-range': 'range is not valid semver',
    'admission.failure.workspace-protocol': 'workspace: ranges cannot be satisfied by an installed plugin',
    'admission.failure.malformed-manifest': 'manifest field has the wrong type',
    'collision.entry-id': 'loader entry id "{id}" is already used by {owner}',
    'collision.duplicate-in-source': 'entry id "{id}" appears {count} times in {source}',
    'remediation.pin-version': 'install a build whose declaration admits {runtime} (profile: {profile})',
    'remediation.pin-version-unusable': 'fix {count} unusable declaration(s) ({failures}) and install a build that admits {runtime}',
    'remediation.upgrade-dsh': 'upgrade DSH: {count} requirement(s) need a newer runtime (needs at least {highest}, running {runtime})',
    'remediation.downgrade-dsh': 'downgrade or pin the plugin: {count} requirement(s) exclude {runtime}',
    'remediation.allow-version': 'record an explicit version exemption for this exact pair',
    'remediation.disable-entry': 'disable entry "{id}" in the later patch layer (owners: {owners})',
    'remediation.remove-plugin': 'remove the plugin',
    'remediation.probe': 'exemption bypasses the declaration only; behaviour is still unproven',
    'remediation.report': 'report the mismatch to the plugin author',
    'missing.admission': 'plugin manifest with engines.dsh or @deepseek-ai/dsh* peer ranges',
    'missing.runtime': 'detected DSH runtime version',
    'missing.probe': 'isolated boot probe (M3)',
    'ui.more-reasons': '…{count} more reason(s); pass --json for the full list',
  },
}

const ZH: MessageCatalog = {
  locale: 'zh',
  messages: {
    'conclusion.go': '可装',
    'conclusion.risky': '有风险',
    'conclusion.blocked': '不可用',
    'conclusion.unknown': '证据不足',
    'admission.admitted': '声明区间包含当前运行时（{runtime}）',
    'admission.denied': '声明区间拒绝当前运行时（{runtime}）',
    'admission.unconstrained': '没有任何 DSH 版本声明——admission 无法判定',
    'admission.indeterminate': '运行时版本未知——admission 无法判定',
    'admission.declared-only': '仅在声明层通过；运行期行为未实测（需 probe）',
    'admission.unmet.engines': 'engines.dsh {range} 不含 {runtime}',
    'admission.unmet.peer': 'peer {key}@{range} 不含 {runtime}',
    'admission.failure.empty-range': '空区间被视为不兼容',
    'admission.failure.invalid-range': '区间不是合法 semver',
    'admission.failure.workspace-protocol': 'workspace: 区间无法被已安装插件满足',
    'admission.failure.malformed-manifest': '清单字段类型错误',
    'collision.entry-id': 'loader entry id「{id}」已被 {owner} 占用',
    'collision.duplicate-in-source': '{source} 内 entry id「{id}」重复 {count} 次',
    'remediation.pin-version': '改装一个声明含 {runtime} 的版本（profile: {profile}）',
    'remediation.pin-version-unusable': '先修 {count} 条不可用声明（{failures}），再改装声明含 {runtime} 的版本',
    'remediation.upgrade-dsh': '升级 DSH：{count} 条要求需要更新的运行时（至少 {highest}，当前 {runtime}）',
    'remediation.downgrade-dsh': '降级或钉住插件版本：{count} 条要求排除了 {runtime}',
    'remediation.allow-version': '为这个精确版本对记录一次显式豁免',
    'remediation.disable-entry': '在后置 patch 层把 entry「{id}」设为 disabled（占用方：{owners}）',
    'remediation.remove-plugin': '卸载该插件',
    'remediation.probe': '豁免只绕过声明；行为仍未实测',
    'remediation.report': '把失配反馈给插件作者',
    'missing.admission': '插件的 engines.dsh 或 @deepseek-ai/dsh* peer 声明',
    'missing.runtime': '检测到的 DSH 运行时版本',
    'missing.probe': '隔离启动实测（M3）',
    'ui.more-reasons': '…还有 {count} 条原因；加 --json 看完整列表',
  },
}

const CATALOGS: Readonly<Record<Locale, MessageCatalog>> = { en: EN, zh: ZH }

export function catalogFor(locale: Locale): MessageCatalog {
  return CATALOGS[locale]
}

/** Interpolate `{name}` placeholders; unknown placeholders are left untouched (fail loud in review, not at runtime). */
export function format(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key]
    return value === undefined ? match : String(value)
  })
}
