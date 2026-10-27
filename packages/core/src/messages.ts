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
    'admission.row-scope': 'loader row {rows} imports {module} (declared in {source})',
    'admission.row-declared-by': 'the "{module}" copy in this profile is there because {by} lists it under {fields}',
    'admission.row-missing': 'row {rows} imports {module}, which is not installed under this profile',
    'admission.row-unconstrained': 'row {rows} imports {module}, which declares no @deepseek-ai/dsh* range — silence here is not a pass',
    'admission.compat-channel': 'secondary evidence only: the manifest declares {claim} through dsh.compatibility, not through a peer range (runtime {runtime})',
    'admission.compat-channel-mismatch': 'secondary evidence only: the manifest declares {claim} through dsh.compatibility and that does not include the running {runtime}',
    'admission.range-exact-pin': 'peer {key} is pinned to exactly {range}: the next upstream patch release will deny this plugin — prefer a range that keeps an upper bound',
    'admission.range-unbounded': 'peer {key} range {range} has no upper bound: a breaking major would be admitted silently',
    'admission.unmet.engines': 'engines.dsh {range} does not include {runtime}',
    'admission.unmet.peer': 'peer {key}@{range} does not include {runtime}',
    'admission.failure.empty-range': 'empty range is treated as incompatible',
    'admission.failure.invalid-range': 'range is not valid semver',
    'admission.failure.workspace-protocol': 'workspace: ranges cannot be satisfied by an installed plugin',
    'admission.failure.malformed-manifest': 'manifest field has the wrong type',
    'collision.entry-id': 'loader entry id "{id}" is already used by {owner}',
    'collision.duplicate-in-source': 'entry id "{id}" appears {count} times in {source}',
    'collision.duplicate-copy': '"{name}" is installed twice with different versions ({versions}): {paths}',
    'registry.latest-behind': 'dist-tag "latest" points at {latest} while {newest} is already published{published}; installing the bare name gets you the older build',
    'registry.prerelease-ahead': '"latest" stays on the stable build {latest}; a newer prerelease {newest} is published{published}',
    'registry.latest-missing': 'the package publishes no "latest" dist-tag, so installing the bare name has no defined target',
    'registry.latest-unpublished': 'dist-tag "latest" names {latest}, which is not in the published version list — installing the bare name cannot resolve',
    'registry.latest-deprecated': 'dist-tag "latest" points at {latest}, which the author deprecated{published}',
    'registry.tags': 'registry  latest {latest} · next {next} · newest published {newest}{published}',
    'registry.drift-none': 'the "latest" tag points at the newest published build',
    'registry.drift-unknown': 'the registry tags could not be judged ({detail})',
    'runtime.fiber-failed': 'entry "{entryId}" ({module}) failed to start: the runtime fiber ended in "failed"',
    'runtime.no-fiber': 'entry "{entryId}" ({module}) is enabled but has no runtime fiber — it never loaded',
    'runtime.disabled': 'entry "{entryId}" ({module}) is explicitly disabled (phase {phase}) — this is configuration, not a crash',
    'runtime.missing-entry': 'entry "{entryId}" ({module}) is declared by a layer but absent from the runtime inventory',
    'runtime.undeclared-entry': 'entry "{entryId}" ({module}) appears in the sample (phase {phase}) but no layer declares it',
    'runtime.preset-unjudged': 'the sample also carries {rows} agent-preset row(s) in "{channel}"; this build cannot judge preset phases yet',
    'remediation.pin-version': 'install a build whose declaration admits {runtime} (profile: {profile})',
    'remediation.pin-version-unusable': 'fix {count} unusable declaration(s) ({failures}) and install a build that admits {runtime}',
    'remediation.upgrade-dsh': 'upgrade DSH: {count} requirement(s) need a newer runtime (needs at least {highest}, running {runtime})',
    'remediation.downgrade-dsh': 'downgrade or pin the plugin: {count} requirement(s) exclude {runtime}',
    'remediation.allow-version': 'record an explicit version exemption for this exact pair',
    'remediation.disable-entry': 'disable entry "{id}" in the later patch layer (owners: {owners})',
    'remediation.declared-by': 'move {module} from {by} dependencies to peerDependencies (or drop the declaring plugin) so the copy disappears',
    'remediation.duplicate-copy': 'keep one copy of {name} (currently {versions}); the declaring plugin should use peerDependencies',
    'remediation.remove-plugin': 'remove the plugin',
    'remediation.probe': 'exemption bypasses the declaration only; behaviour is still unproven',
    'remediation.report': 'report the mismatch to the plugin author',
    'remediation.declare-peer': 'ask the author to declare the {module} peer range it actually needs, or run an isolated probe',
    'remediation.install-module': 'install a build of {module} that admits {runtime}, or delete row {rows} from the later patch layer',
    'missing.admission': 'plugin manifest with engines.dsh or @deepseek-ai/dsh* peer ranges',
    'missing.runtime': 'detected DSH runtime version',
    'missing.probe': 'isolated boot probe (M3)',
    'missing.row-module': 'the installed package behind a patch row',
    'missing.peer-declaration': 'any @deepseek-ai/dsh* peer range (or engines.dsh) from this row module',
    'missing.inventory': 'a pluginInventory sample from the running Host',
    'missing.fiber': 'the runtime fiber phase of this entry (pluginInventory/list)',
    'missing.preset-phase': 'per-preset phases (T-112): the preset dimension is not implemented yet',
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
    'admission.row-scope': 'loader row {rows} 引入 {module}（声明于 {source}）',
    'admission.row-declared-by': 'profile 里的「{module}」这份副本来自 {by} 的 {fields} 声明',
    'admission.row-missing': 'row {rows} 引入的 {module} 在本 profile 下未安装',
    'admission.row-unconstrained': 'row {rows} 引入的 {module} 没有声明任何 @deepseek-ai/dsh* 区间——沉默不等于通过',
    'admission.compat-channel': '仅次要证据：清单通过 dsh.compatibility 声明了 {claim}，而不是 peer 区间（运行时 {runtime}）',
    'admission.compat-channel-mismatch': '仅次要证据：清单通过 dsh.compatibility 声明了 {claim}，其中不含当前运行的 {runtime}',
    'admission.range-exact-pin': 'peer {key} 被精确钉定在 {range}：上游下一次 patch 发布就会拒掉这个插件——建议改成带上界的区间',
    'admission.range-unbounded': 'peer {key} 的区间 {range} 没有上界：破坏性大版本会被静默放行',
    'admission.unmet.engines': 'engines.dsh {range} 不含 {runtime}',
    'admission.unmet.peer': 'peer {key}@{range} 不含 {runtime}',
    'admission.failure.empty-range': '空区间被视为不兼容',
    'admission.failure.invalid-range': '区间不是合法 semver',
    'admission.failure.workspace-protocol': 'workspace: 区间无法被已安装插件满足',
    'admission.failure.malformed-manifest': '清单字段类型错误',
    'collision.entry-id': 'loader entry id「{id}」已被 {owner} 占用',
    'collision.duplicate-in-source': '{source} 内 entry id「{id}」重复 {count} 次',
    'collision.duplicate-copy': '「{name}」被装了两份且版本不同（{versions}）：{paths}',
    'registry.latest-behind': 'dist-tag「latest」指向 {latest}，而已发布 {newest}{published}——直接装裸包名会拿到旧版本',
    'registry.prerelease-ahead': '「latest」停在稳定版 {latest}；更新的预发布版 {newest} 已发布{published}',
    'registry.latest-missing': '该包没有发布任何「latest」dist-tag，装裸包名没有明确目标',
    'registry.latest-unpublished': 'dist-tag「latest」指向 {latest}，但该版本不在已发布列表里——装裸包名解析不出来',
    'registry.latest-deprecated': 'dist-tag「latest」指向 {latest}，而作者已把它标为弃用{published}',
    'registry.tags': 'registry  latest {latest} · next {next} · 已发布最新 {newest}{published}',
    'registry.drift-none': '「latest」指向已发布的最新版本',
    'registry.drift-unknown': '无法判定 registry 的 tag 状态（{detail}）',
    'runtime.fiber-failed': 'entry「{entryId}」（{module}）启动失败：运行时 fiber 停在 failed',
    'runtime.no-fiber': 'entry「{entryId}」（{module}）处于启用态但没有运行时 fiber——它从未被加载',
    'runtime.disabled': 'entry「{entryId}」（{module}）被显式禁用（相位 {phase}）——这是配置选择，不是崩溃',
    'runtime.missing-entry': 'entry「{entryId}」（{module}）在某层被声明，但运行时台账里没有它',
    'runtime.undeclared-entry': 'entry「{entryId}」（{module}）出现在采样里（相位 {phase}），但没有任何层声明它',
    'runtime.preset-unjudged': '采样里还带 {rows} 条 agent preset 行（{channel}）；本版本尚不能判定 preset 相位',
    'remediation.pin-version': '改装一个声明含 {runtime} 的版本（profile: {profile}）',
    'remediation.pin-version-unusable': '先修 {count} 条不可用声明（{failures}），再改装声明含 {runtime} 的版本',
    'remediation.upgrade-dsh': '升级 DSH：{count} 条要求需要更新的运行时（至少 {highest}，当前 {runtime}）',
    'remediation.downgrade-dsh': '降级或钉住插件版本：{count} 条要求排除了 {runtime}',
    'remediation.allow-version': '为这个精确版本对记录一次显式豁免',
    'remediation.disable-entry': '在后置 patch 层把 entry「{id}」设为 disabled（占用方：{owners}）',
    'remediation.declared-by': '把 {module} 从 {by} 的 dependencies 移到 peerDependencies（或卸载声明方），副本才会消失',
    'remediation.duplicate-copy': '只保留一份 {name}（当前 {versions}）；声明方应改用 peerDependencies',
    'remediation.remove-plugin': '卸载该插件',
    'remediation.probe': '豁免只绕过声明；行为仍未实测',
    'remediation.report': '把失配反馈给插件作者',
    'remediation.declare-peer': '请作者补上 {module} 实际需要的 peer 区间，或做一次隔离实测',
    'remediation.install-module': '安装声明含 {runtime} 的 {module}，或在后置 patch 层删掉 row {rows}',
    'missing.admission': '插件的 engines.dsh 或 @deepseek-ai/dsh* peer 声明',
    'missing.runtime': '检测到的 DSH 运行时版本',
    'missing.probe': '隔离启动实测（M3）',
    'missing.row-module': 'patch row 所引用包的实际安装',
    'missing.peer-declaration': '该 row 模块声明的 @deepseek-ai/dsh* peer 区间（或 engines.dsh）',
    'missing.inventory': '运行中 Host 的 pluginInventory 采样',
    'missing.fiber': '该 entry 的运行时 fiber 相位（pluginInventory/list）',
    'missing.preset-phase': '按 preset 维度的相位（T-112：preset 维度尚未实现）',
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
