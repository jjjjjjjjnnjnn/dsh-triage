<!-- facts: docs/copy/facts/2026-11-05-outreach.md -->
# #10759 · hoisted dsh-tools 0.2.0-rc.2 is denied on 0.2.1-rc.2
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/10759 · English · prepare-only -->
<!-- paste:start -->
One data point on the hoisted `@deepseek-ai/dsh-tools` conflict: against target runtime `0.2.1-rc.2`, the shadowed `@deepseek-ai/dsh-tools@0.2.0-rc.2` build fails declaration-layer admission across 10 peers, whereas `@deepseek-ai/dsh-tools@0.2.1-rc.2` is admitted.

Declaration-layer admission readings at target runtime `0.2.1-rc.2`:

- `@deepseek-ai/dsh-tools@0.2.0-rc.2` -> `denied` (10 peers)
- `@deepseek-ai/dsh-tools@0.2.1-rc.2` -> `admitted` (10 peers)

We also maintain a synthetic case reconstruction of this exact shape (`CASE-10759`) that traces and names the plugin declaring the shadowed `@deepseek-ai/dsh-tools` copy. Note that `CASE-10759` is a repository reconstruction of the dependency shape, not a capture from your profile.

What you can do:
- Inspect your installed plugin manifests to find which plugin still declares `@deepseek-ai/dsh-tools@0.2.0-rc.2` and causes the package manager to hoist the denied build.
- Replace or align that dependency with `@deepseek-ai/dsh-tools@0.2.1-rc.2` on runtime `0.2.1-rc.2`.

Boundary: We did not run against your machine or profile, and remote manifest checks cannot see your local `node_modules` tree without a local scan. This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health.

Recompute artifact:
- https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-05T08-06-23-439Z.json (sha256 `ca436a01ce9c8f837f01ea7d7b28f8e4cd5a85b341cee9670c219a87f5ff442a`)
<!-- paste:end -->
