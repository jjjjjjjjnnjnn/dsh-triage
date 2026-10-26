# @dsh-triage/core

Pure, offline judgment engine for DeepSeek Harness plugin compatibility.

## Public API

| Export | Purpose |
|---|---|
| `evaluateAdmission(manifest, runtime)` | Mirror upstream admission semantics (`engines.dsh` wins, else `@deepseek-ai/dsh*` peers ANDed, prereleases participate, empty/invalid ranges incompatible) |
| `evaluateRange(range, runtime)` | Single-range evaluation that never throws |
| `loadEnv({ dshHome, profile })` | Read a profile fingerprint (`Result`, no throw) |
| `parseProfileManifest(raw)` | Pure manifest projection |
| `parsePatchYaml(text)` / `extractEntryClaims(doc, source)` | Loader row extraction from a patch layer |
| `findEntryIdCollisions(claims)` | Duplicate loader entry ids (fatal at boot) |
| `verdictFromAdmission(input)` / `verdictsFromCollisions(input)` | Verdict assembly |
| `mergeVerdicts(verdicts)` | Worst-conclusion merge with dedupe |
| `renderVerdict(verdict, locale)` | Deterministic text rendering (`en` / `zh`) |

## Invariants

- Only `env.ts` touches the filesystem; everything else is pure.
- No clock, no randomness: timestamps are injected by the caller.
- Conclusions are exactly `go | risky | blocked | unknown`.
- `blocked`/`risky` always carry remediation; `unknown` always lists missing evidence.

## Parity

Behaviour is locked by `data/gold/admission-cases.json` (13 synthetic + 8 real npm snapshots) and enforced by `scripts/gate_admission_parity.mjs`. Change the fixtures and the spec before changing the rules.

MIT.
