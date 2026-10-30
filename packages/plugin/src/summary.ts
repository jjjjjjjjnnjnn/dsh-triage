/**
 * One screen, three answers (R49).
 *
 * WHY THIS FILE EXISTS: `audit` prints the whole ledger because the ledger is the evidence.
 * A user opening the product does not want the ledger — they want "is my profile broken, which
 * row, what do I type". That question had no surface: `dsh-triage` with no arguments printed
 * usage, and the answer lived on line 160 of `audit`.
 *
 * This module is a *projection*, not a second engine: it reads the object `loadAuditData()`
 * already produced and never re-derives a conclusion. If `audit --json` and this summary ever
 * disagree, the summary is wrong by definition.
 */

import { catalogFor, format, type Locale, type Verdict } from '@dsh-triage/core'
import type { AuditData } from './audit-data.js'

export type SummaryTone = 'ok' | 'attention' | 'broken'

export type IssueKind = 'denied' | 'unknown' | 'collision' | 'duplicate' | 'unreadable'

export interface SummaryIssue {
  /** Row id, collision id, or duplicate package name — the thing the user must act on. */
  readonly id: string
  readonly kind: IssueKind
  /** One localized sentence. Never a code, never a JSON blob. */
  readonly line: string
  /** The same thing in everyday words — what the panel shows when nobody asked for detail. */
  readonly plain: string
  /** Copy-pasteable command, when the engine already produced one. */
  readonly fix: string | null
}

export interface SummaryNextStep {
  readonly label: string
  readonly command: string
}

export interface ProfileSummary {
  readonly tone: SummaryTone
  /** The sentence a user should read first. */
  readonly headline: string
  /** The same verdict without jargon, for first-time users. */
  readonly plain: string
  readonly counts: {
    /** Loader rows declared in this profile (the denominator a user expects). */
    readonly rows: number
    /** Rows that produced an admission verdict; the rest declare no DSH range at all. */
    readonly judged: number
    readonly go: number
    readonly denied: number
    readonly unknown: number
    readonly collisions: number
    readonly duplicateCopies: number
    readonly errors: number
  }
  readonly issues: readonly SummaryIssue[]
  /** Issues that did not fit in `issues` (the summary is capped, not exhaustive). */
  readonly more: number
  readonly next: readonly SummaryNextStep[]
}

export interface SummaryOptions {
  readonly locale: Locale
  /** How many issues to carry; the CLI prints them, the panel renders them as cards. */
  readonly limit?: number
}

const DEFAULT_LIMIT = 5

/**
 * Project an audit result into the one-screen answer.
 *
 * Ordering is deliberate: a denied row (something is actually broken) outranks a collision
 * (the profile may fail to boot), which outranks a duplicate copy (a warning), which outranks
 * `unknown` (we could not tell — not a defect). Users act top-down.
 */
export function buildProfileSummary(data: AuditData, options: SummaryOptions): ProfileSummary {
  const locale = options.locale
  const limit = options.limit ?? DEFAULT_LIMIT
  const copy = summaryCopy(locale)

  const denied = data.rowVerdicts.filter((verdict) => verdict.conclusion === 'blocked' || verdict.conclusion === 'risky')
  const unknown = data.rowVerdicts.filter((verdict) => verdict.conclusion === 'unknown')
  const go = data.rowVerdicts.filter((verdict) => verdict.conclusion === 'go')

  const issues: SummaryIssue[] = []
  for (const verdict of denied) {
    issues.push({
      id: verdict.subject.name,
      kind: 'denied',
      line: firstReason(verdict, locale) ?? copy.deniedFallback,
      plain: copy.plainDenied,
      fix: firstCommand(verdict),
    })
  }
  for (const collision of data.collisions) {
    issues.push({
      id: collision.id,
      kind: 'collision',
      line: copy.collision.replace('{owners}', collision.owners.join(', ')),
      plain: copy.plainCollision,
      fix: null,
    })
  }
  for (const duplicate of data.duplicateFindings) {
    const versions = [...new Set(duplicate.copies.map((entry) => entry.version ?? 'unknown'))].join(' / ')
    issues.push({
      id: duplicate.name,
      kind: 'duplicate',
      line: copy.duplicate.replace('{versions}', versions),
      plain: copy.plainDuplicate,
      fix: null,
    })
  }
  for (const verdict of unknown) {
    issues.push({
      id: verdict.subject.name,
      kind: 'unknown',
      line: firstReason(verdict, locale) ?? copy.unknownFallback,
      plain: copy.plainUnknown,
      fix: null,
    })
  }
  for (const error of data.errors) {
    issues.push({ id: 'profile', kind: 'unreadable', line: error, plain: copy.plainUnreadable, fix: null })
  }

  const tone: SummaryTone =
    denied.length > 0 || data.collisions.length > 0
      ? 'broken'
      : unknown.length > 0 || data.duplicateFindings.length > 0 || data.errors.length > 0
        ? 'attention'
        : 'ok'

  // An empty composition is not a clean one. Saying "no problems" for a profile that yielded
  // zero rows would turn "I looked at the wrong home" into a passing grade — the same mistake
  // as an empty ledger rendering as a clean audit.
  const headline =
    data.claims.length === 0
      ? copy.emptyProfile
      : tone === 'broken'
        ? copy.broken.replace('{n}', String(denied.length + data.collisions.length))
        : tone === 'attention'
          ? copy.attention.replace('{n}', String(unknown.length + data.duplicateFindings.length + data.errors.length))
          : copy.ok

  const plain =
    data.claims.length === 0
      ? copy.plainEmpty
      : tone === 'broken'
        ? copy.plainBroken.replace('{n}', String(denied.length + data.collisions.length))
        : tone === 'attention'
          ? copy.plainAttention.replace('{n}', String(unknown.length + data.duplicateFindings.length + data.errors.length))
          : copy.plainOk

  return {
    tone: data.claims.length === 0 ? 'attention' : tone,
    headline,
    plain,
    counts: {
      rows: data.claims.length,
      judged: data.rowVerdicts.length,
      go: go.length,
      denied: denied.length,
      unknown: unknown.length,
      collisions: data.collisions.length,
      duplicateCopies: data.duplicateFindings.length,
      errors: data.errors.length,
    },
    issues: issues.slice(0, limit),
    more: Math.max(0, issues.length - limit),
    next: [
      { label: copy.nextWhy, command: 'dsh-triage why' },
      { label: copy.nextUpgrade, command: 'dsh-triage upgrade --to next' },
      { label: copy.nextPanel, command: 'dsh-triage serve' },
    ],
  }
}

/** Render the summary as the text a person reads. Kept next to the data it prints. */
export function formatProfileSummary(summary: ProfileSummary, options: { locale: Locale; env: { dsh: string | null; profile: string; platform: string; arch: string } }): string {
  const copy = summaryCopy(options.locale)
  const lines: string[] = []
  lines.push(`${copy.title} · dsh ${options.env.dsh ?? 'unknown'} · profile ${options.env.profile} · ${options.env.platform}/${options.env.arch}`)
  lines.push('')
  lines.push(`${copy.headline}  ${summary.plain}`)
  lines.push(`  ${summary.headline}`)
  lines.push(
    `  ${copy.counts
      .replace('{rows}', String(summary.counts.rows))
      .replace('{judged}', String(summary.counts.judged))
      .replace('{go}', String(summary.counts.go))
      .replace('{denied}', String(summary.counts.denied))
      .replace('{unknown}', String(summary.counts.unknown))
      .replace('{collisions}', String(summary.counts.collisions))}`,
  )
  if (summary.counts.rows > summary.counts.judged) {
    lines.push(
      `  ${copy.unjudged.replace('{n}', String(summary.counts.rows - summary.counts.judged))}`,
    )
  }
  if (summary.issues.length > 0) {
    lines.push('')
    lines.push(copy.issues)
    for (const issue of summary.issues) {
      const marker = issue.kind === 'denied' || issue.kind === 'collision' ? '✗' : issue.kind === 'duplicate' ? '!' : '?'
      lines.push(`  ${marker} ${issue.id}  ${issue.line}`)
      if (issue.fix !== null) lines.push(`      ${copy.fix} ${issue.fix}`)
    }
    if (summary.more > 0) lines.push(`  … ${summary.more} ${copy.more}`)
  }
  lines.push('')
  lines.push(copy.next)
  for (const step of summary.next) lines.push(`  ${step.command.padEnd(36)} ${step.label}`)
  return `${lines.join('\n')}\n`
}

function firstCommand(verdict: Verdict): string | null {
  for (const remediation of verdict.remediation) {
    if (typeof remediation.command === 'string' && remediation.command !== '') return remediation.command
  }
  return null
}

/** Localize the first block/warn reason; `null` when the verdict has none worth printing. */
function firstReason(verdict: Verdict, locale: Locale): string | null {
  const catalog = catalogFor(locale).messages
  for (const reason of verdict.reasons) {
    if (reason.severity !== 'block' && reason.severity !== 'warn') continue
    const template = catalog[reason.messageId]
    if (typeof template === 'string') return format(template, reason.params)
    return reason.code
  }
  return null
}

interface SummaryCopy {
  readonly title: string
  readonly headline: string
  readonly counts: string
  readonly unjudged: string
  readonly issues: string
  readonly fix: string
  readonly more: string
  readonly next: string
  readonly broken: string
  readonly attention: string
  readonly ok: string
  readonly emptyProfile: string
  readonly collision: string
  readonly duplicate: string
  readonly plainOk: string
  readonly plainAttention: string
  readonly plainBroken: string
  readonly plainEmpty: string
  readonly plainDenied: string
  readonly plainCollision: string
  readonly plainDuplicate: string
  readonly plainUnknown: string
  readonly plainUnreadable: string
  readonly deniedFallback: string
  readonly unknownFallback: string
  readonly nextWhy: string
  readonly nextUpgrade: string
  readonly nextPanel: string
}

function summaryCopy(locale: Locale): SummaryCopy {
  if (locale === 'en') {
    return {
      title: 'triage',
      headline: 'Verdict',
      counts: '{rows} rows ({judged} judged) · {go} go · {denied} denied · {unknown} cannot-tell · {collisions} collisions',
      unjudged: 'the other {n} rows declare no DSH range at all, so they were not judged — silence is not a pass',
      issues: 'What to look at',
      fix: 'fix',
      more: 'more (the summary is capped; `audit --json` has the full list)',
      next: 'Next',
      broken: '{n} thing(s) are actually broken',
      attention: 'Nothing is denied, but {n} thing(s) have no evidence either way',
      ok: 'No problems found in this composition',
      emptyProfile:
        'this profile yielded no rows at all — usually the wrong --dsh-home or --profile, not a clean profile',
      collision: 'two rows claim this entry id (owners: {owners}) — the profile may fail to boot',
      duplicate: 'the same package is installed at more than one version ({versions})',
      deniedFallback: 'denied by admission',
      plainOk: 'All good — nothing in this setup needs fixing.',
      plainAttention: 'Nothing is broken, but there is (are) {n} thing(s) we could not judge. It usually still starts.',
      plainBroken: '{n} thing(s) will break: they are likely to disappear when DSH starts.',
      plainEmpty: 'No plugins were found — the folder is probably wrong, not empty.',
      plainDenied: 'It gets blocked, so it may vanish when DSH starts.',
      plainCollision: 'Two plugins want the same slot, so one of them may not take effect.',
      plainDuplicate: 'Two copies of the same plugin are installed, so one can shadow the other.',
      plainUnknown: 'It never says which versions it supports, so we cannot tell.',
      plainUnreadable: 'This config file could not be read.',
      unknownFallback: 'not enough evidence to judge this row',
      nextWhy: 'row-by-row attribution',
      nextUpgrade: 'what the next dsh would deny',
      nextPanel: 'open the local panel',
    }
  }
  return {
    title: 'triage',
    headline: '结论',
    counts: '{rows} 行（{judged} 行有判定）· {go} 正常 · {denied} 被拒 · {unknown} 判不了 · {collisions} 冲突',
    unjudged: '其余 {n} 行不声明任何 DSH 区间，因此没有判定——沉默不等于通过',
    issues: '要看的地方',
    fix: '修复',
    more: '条未显示（摘要只列前几条，全量用 `audit --json`）',
    next: '下一步',
    broken: '有 {n} 处真的坏了',
    attention: '没有行被拒，但有 {n} 处缺少证据、判不了',
    ok: '这套组合没有发现问题',
    emptyProfile: '这个 profile 里没有读到任何行——通常是 --dsh-home 或 --profile 指错了，不是干净',
    collision: '两行抢同一个 entry id（来自 {owners}），profile 可能起不来',
    duplicate: '同一个包装了两个版本（{versions}）',
    deniedFallback: '被 admission 拒绝',
    plainOk: '一切正常：这套组合里没有要修的东西。',
    plainAttention: '没有会坏的东西，但有 {n} 项我们判断不了，通常不影响启动。',
    plainBroken: '有 {n} 个东西会出问题：DSH 启动后它们很可能直接消失。',
    plainEmpty: '没读到任何插件——多半是目录指错了，不是「干净的」。',
    plainDenied: '它会被挡住，启动后可能直接不见。',
    plainCollision: '两个插件抢同一个位置，可能有一个不生效。',
    plainDuplicate: '同一个插件装了两份，容易互相盖住。',
    plainUnknown: '它没说自己支持哪个版本，所以我们判断不了。',
    plainUnreadable: '这份配置读不出来。',
    unknownFallback: '证据不足，判不了这一行',
    nextWhy: '逐行归因',
    nextUpgrade: '升级前先看会坏什么',
    nextPanel: '打开本地面板',
  }
}
