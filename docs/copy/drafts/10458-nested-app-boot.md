<!-- facts: docs/copy/facts/2026-11-05-batch2.md -->
# #10458 · opposite admission verdicts across nested runtime versions
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/10458 · English · ready-to-post -->
<!-- paste:start -->
One data point on the version mismatch during nested boot: against target runtime `0.2.1-rc.2`, the `0.2.1-rc.2` build of `@deepseek-ai/dsh-agent-tool-presentation` is admitted at the declaration layer, while the `0.2.0-rc.2` build is denied.

Declaration-layer admission readings at target runtime `0.2.1-rc.2`:
- `@deepseek-ai/dsh-agent-tool-presentation@0.2.1-rc.2` -> `admitted` (1 item: `@deepseek-ai/dsh-tools@0.2.1-rc.2`)
- `@deepseek-ai/dsh-agent-tool-presentation@0.2.0-rc.2` -> `denied` (1 item)
- `@deepseek-ai/dsh-agent-preset-registry@0.2.0-rc.2` -> `denied` (9 items)

The same package yields opposite admission verdicts across the two versions: `0.2.1-rc.2` satisfies declaration constraints on `0.2.1-rc.2`, whereas `0.2.0-rc.2` is rejected. This matches the direction of your report.

What you can do:
- Align both `@deepseek-ai/dsh-agent-tool-presentation` and `@deepseek-ai/dsh-agent-preset-registry` to `0.2.1-rc.2` rather than pulling `0.2.0-rc.2` artifacts into a `0.2.1-rc.2` host.
- Check whether an intermediate dependency or workspace lockfile pins `0.2.0-rc.2` inside the nested boot environment.

We did not reproduce the upstream nested app-boot resolution path itself. I maintain dsh-triage, the read-only tool that produced these numbers.

This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health.

Recompute artifact: https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-05T08-03-35-886Z.json (sha256 `63b046e9c2cac5a151c5dc8a50d18a5e3b3ffe09ff1fa20bddcc36ecc8c96eac`)
<!-- paste:end -->
