/** Types for `scripts/lib/discussion-triage.mjs`. */

export type TriageLayer = 'admission' | 'upgrade' | 'composition' | 'runtime' | 'unknown'
export type TriageVerdict = 'answerable' | 'partially-answerable' | 'needs-their-profile' | 'not-ours'

export declare const LAYERS: readonly TriageLayer[]
export declare const VERDICTS: readonly TriageVerdict[]
export declare const SIGNALS: ReadonlyArray<readonly [TriageLayer, RegExp, number]>
export declare const SIGNALS_V2: ReadonlyArray<readonly [TriageLayer, RegExp, number]>
export declare const SIGNALS_V3: ReadonlyArray<readonly [TriageLayer, RegExp, number]>

export declare function extractPackages(text: string): string[]

export declare function classifyThread(input: {
  title?: unknown
  body?: unknown
  category?: unknown
}): {
  layer: TriageLayer
  verdict: TriageVerdict
  reason: string
  signals: string[]
  packages: string[]
  answerableWith: string | null
}

export declare function classifyThreadV2(input: {
  title?: unknown
  body?: unknown
  category?: unknown
}): {
  layer: TriageLayer
  verdict: TriageVerdict
  reason: string
  signals: string[]
  packages: string[]
  answerableWith: string | null
}

export declare function classifyThreadV3(input: {
  title?: unknown
  body?: unknown
  category?: unknown
}): {
  layer: TriageLayer
  verdict: TriageVerdict
  reason: string
  signals: string[]
  packages: string[]
  answerableWith: string | null
}
