/**
 * The upgrade-day card (`docs/specs/M6-upgrade-day.md`, T-801).
 *
 * WHY THIS IS NOT ANOTHER ENGINE: the four buckets, their evidence and their remediation are decided by
 * `judgeUpgradeImpact` (`upgrade.ts`). This module only decides how the answer is *said*: one conclusion line,
 * one small table, the units that matter, and the boundary. A card that re-derived a bucket would be a second
 * engine, and two engines drift — that is the failure this project exists to attribute.
 *
 * WHY MARKDOWN: the only social action in an upgrade day is pasting the answer into the release discussion or
 * an issue. Terminal colour does not survive that trip; a table does.
 *
 * WHAT IT MUST NEVER DO:
 *   - print a number that `impact.counts` did not produce (control C2/N2);
 *   - promise that upgrading fixes anything. `improved` is only witnessed in the downgrade geometry today
 *     (`BS-42`), so the boundary says "the target version admits it" and nothing stronger (C4/N4);
 *   - leak a home path. Callers pass `redactRoots`; a shape-based fallback catches the rest (C6/N5);
 *   - read the clock. The card is a pure function of its `impact` (C5/N6).
 */

import { catalogFor, format, type Locale } from './messages.js'
import { compareUnits, type UpgradeBucket, type UpgradeImpact, type UpgradeUnit } from './upgrade.js'

/** At most this many units per bucket are printed; the rest become a count (a card is not a log). */
export const MAX_UNITS_PER_BUCKET = 8

/** At most this many blocking reasons / fixes per unit. */
const MAX_DETAIL_PER_UNIT = 2

export interface UpgradeCardOptions {
  readonly locale: Locale
  /** Absolute roots to erase from the text (`homedir()`, the dsh home). */
  readonly redactRoots?: readonly string[]
  /** The command to re-run. Defaults to `dsh-triage upgrade --to <target> --card`. */
  readonly command?: string
}

const BUCKET_ORDER: readonly UpgradeBucket[] = ['would-be-denied', 'cannot-tell', 'improved', 'likely-fine']

interface Copy {
  readonly title: (target: string) => string
  readonly conclusion: (parts: {
    profile: string
    total: number
    bundles: number
    rows: number
    target: string
    denied: number
    cannot: number
    improved: number
    fine: number
  }) => string
  readonly meta: (parts: { profile: string; source: string; current: string; relation: string }) => string
  readonly scopeNote: string
  readonly tableHead: string
  readonly bucket: Readonly<Record<UpgradeBucket, { label: string; meaning: string }>>
  readonly reason: string
  readonly now: string
  readonly fix: string
  readonly alreadyDenied: string
  readonly material: string
  readonly more: (count: number) => string
  readonly boundary: readonly string[]
  readonly boundaryTitle: string
  readonly recompute: string
  readonly emptyProfile: (profile: string) => string
  readonly relation: Readonly<Record<'same' | 'newer' | 'older' | 'unknown', string>>
}

const ZH: Copy = {
  title: (target) => `# 升级日 · ${target}`,
  conclusion: (p) =>
    `**${p.profile}：${p.total} 个单元（${p.bundles} bundle + ${p.rows} 行）升到 ${p.target} → ${p.denied} 会被拒 · ${p.cannot} 判不了 · ${p.improved} 会变好 · ${p.fine} 像没事**`,
  meta: (p) => `> profile \`${p.profile}\`（${p.source}）· 当前 ${p.current} · 目标${p.relation}`,
  scopeNote: '> 判的是**声明层**：只看「声明区间 vs 目标运行时」，不是运行期实测。',
  tableHead: '| 桶 | 数量 | 意思 |\n|---|---|---|',
  bucket: {
    'would-be-denied': { label: '升上去会被摘掉', meaning: '目标版本的 admission 会拒绝这一行/包' },
    'cannot-tell': { label: '判不了', meaning: '声明不足或目标还没发布，证据不够' },
    improved: { label: '今天被拒、目标放行', meaning: '今天是坏的，目标版本会放行它' },
    'likely-fine': { label: '声明上不冲突', meaning: '不等于升级后能跑，只表示没有声明冲突' },
  },
  reason: '原因',
  now: '现在',
  fix: '修复',
  alreadyDenied: '今天已经是坏的（不是这次升级造成的）',
  material: '——',
  more: (count) => `- … 另外 ${count} 个`,
  boundaryTitle: '## 边界（请一起读）',
  boundary: [
    '- `improved` 只说明「**目标版本会放行它**」；今天没有「升到更新版本变好」的真实样本（`BS-42`）。',
    '- 声明层判不了运行期行为；`likely-fine` 不等于升级后能跑。',
  ],
  recompute: '复算',
  emptyProfile: (profile) => `这个 profile（${profile}）没有可判单元：没有任何 bundle 或 patch 行可以对着目标版本判。`,
  relation: { same: '等于当前', newer: '比当前新', older: '比当前旧', unknown: '无法判断新旧' },
}

const EN: Copy = {
  title: (target) => `# Upgrade day · ${target}`,
  conclusion: (p) =>
    `**${p.profile}: ${p.total} unit(s) (${p.bundles} bundle + ${p.rows} row) against ${p.target} → ${p.denied} would be denied · ${p.cannot} cannot tell · ${p.improved} would improve · ${p.fine} look fine**`,
  meta: (p) => `> profile \`${p.profile}\` (${p.source}) · current ${p.current} · target is ${p.relation}`,
  scopeNote: '> This judges the **declaration layer**: declared ranges against the target runtime, not runtime behaviour.',
  tableHead: '| bucket | count | meaning |\n|---|---|---|',
  bucket: {
    'would-be-denied': { label: 'would be dropped', meaning: 'the target build denies this row/package' },
    'cannot-tell': { label: 'cannot tell', meaning: 'not enough declaration evidence' },
    improved: { label: 'denied today, admitted at target', meaning: 'broken now, the target admits it' },
    'likely-fine': { label: 'no declared conflict', meaning: 'not a promise that it runs after the upgrade' },
  },
  reason: 'reason',
  now: 'now',
  fix: 'fix',
  alreadyDenied: 'already broken today (this upgrade did not cause it)',
  material: '—',
  more: (count) => `- … ${count} more`,
  boundaryTitle: '## Boundaries (read these too)',
  boundary: [
    '- `improved` only means "**the target admits it**"; there is no real sample of a newer build fixing anything today (`BS-42`).',
    '- The declaration layer cannot judge runtime behaviour; `likely-fine` is not "it runs after the upgrade".',
  ],
  recompute: 'Recompute',
  emptyProfile: (profile) => `This profile (${profile}) has no judgeable unit: nothing to judge against the target build.`,
  relation: { same: 'equal to current', newer: 'newer than current', older: 'older than current', unknown: 'unknown relation' },
}

const copyFor = (locale: Locale): Copy => (locale === 'zh' ? ZH : EN)

/**
 * Erase absolute roots and path shapes.
 *
 * The card is meant to be pasted in public, so a home path is a leak even when it is "only" the profile
 * directory. Roots are erased first (exact match), then a shape fallback catches paths the caller did not list.
 */
export function scrubCardText(text: string, roots: readonly string[] = []): string {
  let out = text
  for (const root of roots) {
    if (root === '') continue
    for (const variant of [root, root.replaceAll('\\', '/'), root.replaceAll('/', '\\')]) {
      out = out.split(variant).join('<path>')
    }
  }
  out = out.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+(\.[^\\/\s"'`]+)?(?:[\\/][^\s"'`]*)?/g, '<path>')
  out = out.replace(/\/(?:home|Users)\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, '<path>')
  return out
}

/** One blocking reason, said the way the CLI says it (same catalogue, same params). */
function reasonLines(unit: UpgradeUnit, locale: Locale, kind: 'target' | 'current'): string[] {
  const catalog = catalogFor(locale)
  const say = (messageId: string, params?: Readonly<Record<string, string | number>>): string => {
    const template = catalog.messages[messageId]
    return template === undefined ? `?${messageId}` : format(template, params)
  }
  const reasons =
    kind === 'target'
      ? unit.reasons.filter((reason) => reason.severity === 'block')
      : unit.current.unmet.map((requirement) => ({
          messageId: requirement.key === 'dsh' ? 'admission.unmet.engines' : 'admission.unmet.peer',
          params: { key: requirement.key, range: requirement.range, runtime: unit.current.runtime ?? 'unknown' },
        }))
  return reasons.slice(0, MAX_DETAIL_PER_UNIT).map((reason) => say(reason.messageId, 'params' in reason ? reason.params : undefined))
}

function fixLines(unit: UpgradeUnit, locale: Locale): string[] {
  return unit.remediation.slice(0, MAX_DETAIL_PER_UNIT).map((fix) => {
    if (fix.messageId !== undefined) {
      const catalog = catalogFor(locale)
      const template = catalog.messages[fix.messageId]
      return template === undefined ? `?${fix.messageId}` : format(template, fix.params)
    }
    // A note is prose unless it reads like a command; wrapping prose in backticks makes it look like one.
    return /^(dsh|npx|npm|pnpm)\b/.test(fix.note) ? `\`${fix.note}\`` : fix.note
  })
}

function unitHeading(unit: UpgradeUnit): string {
  const version = unit.version === null ? '' : `@${unit.version}`
  return `\`${unit.id}\` · ${unit.name}${version}`
}

/**
 * Render the card.
 *
 * Every number in the header and the table comes from `impact.counts`; the unit lists are only a
 * projection of `impact.units`. That split is what makes control N2 meaningful.
 */
export function renderUpgradeCard(impact: UpgradeImpact, options: UpgradeCardOptions): string {
  const copy = copyFor(options.locale)
  const command = options.command ?? `dsh-triage upgrade --to ${impact.target} --card`
  const lines: string[] = []

  lines.push(copy.title(impact.target))
  lines.push('')
  lines.push(
    copy.conclusion({
      profile: impact.profile,
      total: impact.counts.total,
      bundles: impact.counts.bundles,
      rows: impact.counts.rows,
      target: impact.target,
      denied: impact.counts.would_be_denied,
      cannot: impact.counts.cannot_tell,
      improved: impact.counts.improved,
      fine: impact.counts.likely_fine,
    }),
  )
  lines.push('')
  lines.push(
    copy.meta({
      profile: impact.profile,
      source: impact.profile_source,
      current: impact.current ?? 'unknown',
      relation: copy.relation[impact.target_relation],
    }),
  )
  lines.push(copy.scopeNote)
  lines.push('')

  if (impact.counts.total === 0) {
    lines.push(copy.emptyProfile(impact.profile))
    lines.push('')
    return scrubCardText(`${lines.join('\n')}\n`, options.redactRoots)
  }

  lines.push(copy.tableHead)
  for (const bucket of BUCKET_ORDER) {
    const count =
      bucket === 'would-be-denied'
        ? impact.counts.would_be_denied
        : bucket === 'cannot-tell'
          ? impact.counts.cannot_tell
          : bucket === 'improved'
            ? impact.counts.improved
            : impact.counts.likely_fine
    lines.push(`| \`${bucket}\` | ${count} | ${copy.bucket[bucket].label} —— ${copy.bucket[bucket].meaning} |`)
  }
  lines.push('')

  for (const bucket of BUCKET_ORDER) {
    const units = impact.units.filter((unit) => unit.bucket === bucket).sort(compareUnits)
    if (units.length === 0) continue
    lines.push(`## ${copy.bucket[bucket].label}（${units.length}）`)
    lines.push('')
    for (const unit of units.slice(0, MAX_UNITS_PER_BUCKET)) {
      lines.push(`- ${unitHeading(unit)}`)
      if (unit.already_denied_at_current) lines.push(`  - ${copy.alreadyDenied}`)
      for (const reason of reasonLines(unit, options.locale, 'target')) lines.push(`  - ${copy.reason}：${reason}`)
      if (bucket === 'improved') {
        for (const reason of reasonLines(unit, options.locale, 'current')) lines.push(`  - ${copy.now}：${reason}`)
      }
      for (const fix of fixLines(unit, options.locale)) lines.push(`  - ${copy.fix}：${fix}`)
    }
    if (units.length > MAX_UNITS_PER_BUCKET) lines.push(copy.more(units.length - MAX_UNITS_PER_BUCKET))
    lines.push('')
  }

  lines.push(copy.boundaryTitle)
  lines.push('')
  lines.push(...copy.boundary)
  lines.push('')
  lines.push(`**${copy.recompute}**：\`${command}\``)
  lines.push('')

  return scrubCardText(`${lines.join('\n')}`, options.redactRoots)
}
