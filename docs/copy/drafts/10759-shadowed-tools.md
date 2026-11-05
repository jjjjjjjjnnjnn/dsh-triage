<!-- facts: docs/copy/facts/2026-11-05-batch2.md -->
# #10759 · hoisted dsh-tools 0.2.0-rc.2 is denied on 0.2.1-rc.2
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/10759 · English · ready-to-post -->
<!-- paste:start -->
One data point on the hoisted `@deepseek-ai/dsh-tools` conflict: against target runtime `0.2.1-rc.2`, the hoisted `@deepseek-ai/dsh-tools@0.2.0-rc.2` build fails declaration-layer admission across 10 peers, whereas `@deepseek-ai/dsh-tools@0.2.1-rc.2` is admitted across 10 peers.

Declaration-layer admission readings at target runtime `0.2.1-rc.2`:
- `@deepseek-ai/dsh-tools@0.2.0-rc.2` -> `denied` (10 peers)
- `@deepseek-ai/dsh-tools@0.2.1-rc.2` -> `admitted` (10 peers)

The hoisted `0.2.0-rc.2` build fails admission because its peer declarations are unsatisfied under `0.2.1-rc.2`. We maintain an in-repo reconstruction of this dependency shape (`CASE-10759`) that traces and names the plugin declaring the shadowed dependency. Note that `CASE-10759` is a repository reconstruction of the dependency shape, not a scan of your machine.

What you can do:
- Inspect your installed plugin manifests to identify which plugin pulls `@deepseek-ai/dsh-tools@0.2.0-rc.2` and triggers hoisting.
- Align that dependency with `@deepseek-ai/dsh-tools@0.2.1-rc.2` on runtime `0.2.1-rc.2`.

I maintain dsh-triage, the read-only tool that produced these numbers.

This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health.

Recompute artifact: https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-05T08-06-23-439Z.json (sha256 `ca436a01ce9c8f837f01ea7d7b28f8e4cd5a85b341cee9670c219a87f5ff442a`)
<!-- paste:end -->
