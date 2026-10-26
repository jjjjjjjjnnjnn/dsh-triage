# @dsh-triage/signals

Tiered signal adapters. Each adapter produces **evidence**, never a conclusion.

| Adapter | Source | Tier | Licence note |
|---|---|---|---|
| `fetchPackument` / `parsePackument` | npm registry metadata | `declared` | registry terms |
| `fetchInstallVerification` / `projectInstallVerification` | dsh.so install verification | `measured-registry` | **CC BY 4.0 — attribute dsh.so** |
| `discoverLocalArtifacts` | guard incidents / vet reports / savepoints already on disk | `inferred` until schemas are verified | each tool's own licence |

## Rules

- `fetch` is injected: unit tests never touch the network.
- Third-party payloads are read defensively; unknown fields go to `raw` and are never guessed into claims.
- No adapter may emit `measured-local` — only `packages/probe` can, because only probe runs on this machine.

MIT. dsh.so data is CC BY 4.0 and must be attributed wherever it is displayed.
