<!-- facts: docs/copy/facts/2026-11-05-outreach.md -->
# #10458 · opposite admission verdicts across nested runtime versions
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/10458 · English · prepare-only -->
<!-- paste:start -->
One data point on the version split described here: against target runtime `0.2.1-rc.2`, the `0.2.1-rc.2` build of `@deepseek-ai/dsh-agent-tool-presentation` is admitted at the declaration layer while the `0.2.0-rc.2` builds are denied, matching the direction of your report.

Declaration-layer admission readings at target runtime `0.2.1-rc.2`:

- `@deepseek-ai/dsh-agent-tool-presentation@0.2.1-rc.2` -> `admitted` (1 peer: `@deepseek-ai/dsh-tools@0.2.1-rc.2`)
- `@deepseek-ai/dsh-agent-tool-presentation@0.2.0-rc.2` -> `denied` (1 peer)
- `@deepseek-ai/dsh-agent-preset-registry@0.2.0-rc.2` -> `denied` (9 peers)

The same package produces opposite admission verdicts across the two runtime versions: `0.2.1-rc.2` passes declaration checks on `0.2.1-rc.2`, whereas `0.2.0-rc.2` is rejected.

What you can do:
- Align `@deepseek-ai/dsh-agent-tool-presentation` and `@deepseek-ai/dsh-agent-preset-registry` with the `0.2.1-rc.2` runtime rather than mixing `0.2.0-rc.2` packages into a `0.2.1-rc.2` host.
- Check whether any workspace dependency still pulls `0.2.0-rc.2` into the nested boot context.

Boundary: This only covers what the declaration layer can prove. We did not reproduce the nested `app-boot` startup path or how a nested instance resolves its own runtime version. This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health.

Recompute artifact:
- https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-05T08-03-35-886Z.json (sha256 `63b046e9c2cac5a151c5dc8a50d18a5e3b3ffe09ff1fa20bddcc36ecc8c96eac`)
<!-- paste:end -->
