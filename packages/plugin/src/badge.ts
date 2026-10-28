/**
 * Badges for `README` files (M4-b / T-402).
 *
 * WHY A BADGE AT ALL: an author only puts it in their README if it is both true and cheap to read. That
 * rules out a score: this project has no evidence for "quality", only for "in this environment, the
 * candidate reached a verdict". So the badge says exactly that, plus the dsh version the verdict was
 * measured against — and when there is no measurement it says `not measured` instead of guessing
 * (铁律 1: no evidence → no claim).
 *
 * DETERMINISM: the SVG is a pure function of the verdict record. No `Date.now()`, no randomness, no
 * font metrics from the host — widths are computed from a fixed per-character table so the same input
 * always yields the same bytes (the repo's reproducibility rule, and it makes the artifact hash stable).
 */

/** What a badge is allowed to say. All fields come from a recorded probe artifact. */
export interface BadgeEvidence {
  readonly package: string
  /** Resolved version, or null when the candidate was a local directory. */
  readonly version: string | null
  /** `null` means "no usable measurement", which renders as `not measured`. */
  readonly conclusion: 'go' | 'blocked' | 'unknown' | null
  /** dsh runtime the verdict was measured against (never the local machine's, unless they are the same). */
  readonly dsh: string | null
  /** `boot→sample` of that run, in milliseconds. */
  readonly bootToSampleMs: number | null
  /** The artifact's `generated_at`; the badge's only date. */
  readonly sampledAt: string | null
  /** Where the evidence came from, so a reader can check it. */
  readonly artifact: string | null
}

const COLORS: Record<string, string> = {
  go: '#2ea44f',
  blocked: '#cf222e',
  unknown: '#9a6700',
  'not measured': '#6e7781',
}

/** Fixed per-character advance in px (approximation of 11px Verdana, rounded for stable output). */
const ADVANCE = 6.2
const PADDING = 10
const LABEL = 'triage'

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;')

const widthOf = (text: string): number => Math.round(text.length * ADVANCE + PADDING * 2)

/** The two halves of the badge, as text. Exported so the CLI's `--json` can show them plainly. */
export function badgeText(evidence: BadgeEvidence): { label: string; message: string; color: string } {
  const conclusion = evidence.conclusion ?? 'not measured'
  // The message carries the runtime, because a verdict without its dsh version is not portable.
  const message = evidence.conclusion === null ? 'not measured' : evidence.dsh === null ? conclusion : `${conclusion} · dsh ${evidence.dsh}`
  return { label: LABEL, message, color: COLORS[conclusion] ?? COLORS['not measured']! }
}

/**
 * Render a shields-style flat badge. The `<title>` carries the full, checkable sentence (package,
 * version, timing, date, artifact) so the badge is a pointer to evidence rather than a summary of it.
 */
export function renderBadge(evidence: BadgeEvidence): string {
  const { label, message, color } = badgeText(evidence)
  const labelWidth = widthOf(label)
  const messageWidth = widthOf(message)
  const total = labelWidth + messageWidth
  const title =
    evidence.conclusion === null
      ? `dsh-triage: no usable measurement for ${evidence.package} (not measured)`
      : `dsh-triage: ${evidence.package}${evidence.version === null ? '' : `@${evidence.version}`} → ${evidence.conclusion}` +
        `${evidence.dsh === null ? '' : ` on dsh ${evidence.dsh}`}` +
        `${evidence.bootToSampleMs === null ? '' : `, boot→sample ${(evidence.bootToSampleMs / 1000).toFixed(1)}s`}` +
        `${evidence.sampledAt === null ? '' : `, sampled ${evidence.sampledAt}`}` +
        `${evidence.artifact === null ? '' : ` (${evidence.artifact})`}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(`${label}: ${message}`)}">`,
    `  <title>${escapeXml(title)}</title>`,
    '  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>',
    '  <clipPath id="r"><rect width="' + total + '" height="20" rx="3" fill="#fff"/></clipPath>',
    '  <g clip-path="url(#r)">',
    `    <rect width="${labelWidth}" height="20" fill="#555"/>`,
    `    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/>`,
    `    <rect width="${total}" height="20" fill="url(#s)"/>`,
    '  </g>',
    '  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">',
    `    <text x="${Math.round(labelWidth / 2)}" y="15">${escapeXml(label)}</text>`,
    `    <text x="${labelWidth + Math.round(messageWidth / 2)}" y="15">${escapeXml(message)}</text>`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

/** The subset of a recorded probe artifact this module reads. */
export interface ProbeRecord {
  readonly generated_at?: unknown
  readonly candidate?: { readonly package?: unknown; readonly resolved?: { readonly version?: unknown } | null }
  readonly conclusion?: unknown
  readonly runtime?: { readonly version?: unknown } | null
  readonly timings?: { readonly bootToSampleMs?: unknown } | null
  readonly sandbox?: { readonly hook_config?: unknown } | null
}

/**
 * Pick the newest USABLE measurement for one package.
 *
 * Excluded on purpose: artifacts recorded through a diagnostic hook (`sandbox.hook_config` set) — R26
 * decided those must never count toward a pass rate, and a badge is a pass claim in miniature.
 */
export function summarizeEvidence(
  packageName: string,
  records: readonly { readonly artifact: string; readonly payload: ProbeRecord }[],
): BadgeEvidence {
  const usable = records
    .filter((entry) => entry.payload.candidate?.package === packageName)
    .filter((entry) => entry.payload.sandbox?.hook_config === undefined || entry.payload.sandbox?.hook_config === null)
    .sort((left, right) => String(right.payload.generated_at ?? '').localeCompare(String(left.payload.generated_at ?? '')))
  const newest = usable[0]
  if (newest === undefined) {
    return { package: packageName, version: null, conclusion: null, dsh: null, bootToSampleMs: null, sampledAt: null, artifact: null }
  }
  const conclusion = newest.payload.conclusion
  const version = newest.payload.candidate?.resolved?.version
  const dsh = newest.payload.runtime?.version
  const boot = newest.payload.timings?.bootToSampleMs
  return {
    package: packageName,
    version: typeof version === 'string' ? version : null,
    conclusion: conclusion === 'go' || conclusion === 'blocked' || conclusion === 'unknown' ? conclusion : null,
    dsh: typeof dsh === 'string' ? dsh : null,
    bootToSampleMs: typeof boot === 'number' ? boot : null,
    sampledAt: typeof newest.payload.generated_at === 'string' ? newest.payload.generated_at : null,
    artifact: newest.artifact,
  }
}
