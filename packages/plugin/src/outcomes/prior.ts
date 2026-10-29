/**
 * The `prior` annotation for `check --explain` (spec §10, `ADR-0011` option A).
 *
 * WHY THIS FILE EXISTS AT ALL: to keep the prior in one place that produces a SIBLING object
 * of the verdict. It does not take a verdict, does not return one, and cannot change one.
 * `check --json` (without `--explain`) never calls into this module, which is what makes the
 * "with a prior / without a prior" outputs byte-identical (control N3).
 *
 * FAILURE POLICY: a store that cannot be read means "no prior", not an error. Recording is
 * best-effort, so reading it back must be too - a broken local library may never turn a
 * working `check` into a failing one (same discipline as N14).
 *
 * No network client is imported here, and none may ever be (spec §12).
 */

import process from 'node:process'
import { catalogFor, computeLocalPrior, format, type EnvFingerprint, type Locale, type LocalPrior } from '@dsh-triage/core'
import { readOutcomeConfig } from './config.js'
import { outcomeKeyOfEnv, readOutcomeRecords } from './store.js'

/**
 * The prior for the exact key this run judged, or `null` when there is nothing to say.
 *
 * Both "no prior" cases (`n = 0`, incomplete key) come back as `null`, and the caller then
 * OMITS the `prior` key entirely: "nothing" must not be rendered as `null` or `{}` (§10.2).
 */
export function localPriorFor(options: {
  readonly env: EnvFingerprint
  readonly packageName: string
  readonly version: string
  readonly processEnv?: Readonly<Record<string, string | undefined>>
  readonly platform?: string
}): LocalPrior | null {
  try {
    const reading = readOutcomeConfig(options.processEnv ?? process.env, options.platform ?? process.platform)
    if (reading.root === null) return null
    const read = readOutcomeRecords(reading.root)
    if (read.records.length === 0) return null
    // The same seven-tuple the store writes, so a prior can never be matched against a key
    // shape that no record could have had.
    return computeLocalPrior(read.records, outcomeKeyOfEnv(options.env, options.packageName, options.version))
  } catch {
    // A prior is an annotation; it is never worth failing a judgement over.
    return null
  }
}

/**
 * One `explain` line: what this machine said about the exact key before, and the sentence
 * that stops a reader from treating it as evidence.
 */
export function renderPrior(prior: LocalPrior, locale: Locale): string {
  const catalog = catalogFor(locale)
  const template = catalog.messages['prior.annotation-only']
  const note = template === undefined ? 'prior.annotation-only' : format(template)
  const agreement = prior.agreement === null ? '—' : `${Math.round(prior.agreement * 1000) / 10}%`
  const majority = prior.majority ?? '—'
  const counts = `go ${prior.counts.go} · risky ${prior.counts.risky} · blocked ${prior.counts.blocked} · unknown ${prior.counts.unknown}`
  return `prior    ${prior.key.package}@${prior.key.version} · dsh ${prior.key.dsh ?? 'unknown'} · ${prior.key.os}/${prior.key.arch} · node ${prior.key.node_major} · ${prior.key.profile_kind} · n=${prior.n} · ${counts} · majority ${majority} · agreement ${agreement}\n         ${note}\n`
}
