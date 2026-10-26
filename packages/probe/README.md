# @dsh-triage/probe

Isolated probe planning for dsh-triage.

```ts
import { buildProbePlan } from '@dsh-triage/probe'

const plan = buildProbePlan({
  candidate: 'dsh-cost-meter',
  realDshHome: 'C:/Users/me/.dsh',
  workRoot: 'C:/Temp/dsh-triage-probe',
})
```

A plan is pure data: steps (`argv`, `env`, `cwd`), assertions, and warnings. Sandbox naming is `sha256(candidate)[0..8]`, so the same candidate always maps to the same sandbox.

## Hard invariant

The sandbox `DSH_HOME` must never equal the real one, nor live inside it. `validateProbePlan` enforces this and `buildProbePlan` refuses to produce an invalid plan.

## Status

M0–M1 ship the planner only. The executor (`execute.ts`) lands in M3 and must:

- require an explicit `--execute`;
- always run the `cleanup` step;
- record `boot / http / client-rendered / inventory-active / namespace-diff` (HTTP 200 alone is not proof — see `audit/blind_spots.json` BS-03).

MIT.
