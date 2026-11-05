<!-- facts: docs/copy/facts/2026-11-05-outreach.md -->
# #12210 · cordis family mismatch is invisible to declaration gate
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/12210 · English · ready-to-post -->
<!-- paste:start -->
One data point supporting your proposed startup assertion: the boot-time declaration gate cannot detect a `@deepseek-ai/cordis` family mismatch because none of the involved packages declare a DSH constraint.

Declaration-layer admission readings at target runtime `0.2.2-rc.1`:

- `@deepseek-ai/dsh@0.2.2-rc.1` -> `unconstrained` (declares no DSH range)
- `@deepseek-ai/cordis@4.1.0` -> `unconstrained`
- `@deepseek-ai/cordis@4.0.5` -> `unconstrained`

The declaration gate only inspects `engines.dsh` and `@deepseek-ai/dsh*` peer declarations. Because all three manifests evaluate to `unconstrained`, the declaration layer is blind to whether `@deepseek-ai/cordis@4.1.0` or `@deepseek-ai/cordis@4.0.5` is loaded alongside `@deepseek-ai/dsh@0.2.2-rc.1`. An `unconstrained` verdict only means no range was declared; it is not `compatible`.

What you can do:
- Treat `unconstrained` packages as unverified by the manifest gate when diagnosing cross-family version drift.
- Keep the explicit runtime assertion in `app-boot`, since declaration-layer checks cannot catch a `@deepseek-ai/cordis` mismatch.

Boundary: Our tool does not detect this failure; it only evaluates declaration-layer admission and cannot see cross-family runtime mismatches. This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health.

Recompute artifact:
- https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-05T08-06-24-136Z.json (sha256 `50455dfb5db76bc75985bf4284eb74125869fbeb65e1ca5f7b4e699cf78e989c`)
<!-- paste:end -->
