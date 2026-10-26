/**
 * Public surface of `@dsh-triage/probe`.
 *
 * M0/M1 ship the planner only. The executor (`execute.ts`) lands in M3 with its
 * own gate: it must never run without `--execute`, and it must never receive a
 * plan that overlaps the real DSH home.
 */

export type { ProbeAssertion, ProbePlan, ProbePlanError, ProbePlanErrorCode, ProbePlanInput, ProbeStep } from './plan.js'
export { buildProbePlan, validateProbePlan } from './plan.js'
