<!-- facts: docs/copy/facts/2026-11-05-batch2.md -->
# #11149 · compatibility-aware upgrade command and sandbox card
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/11149 · English · ready-to-post -->
<!-- paste:start -->
One data point on a compatibility-aware command: an external, standalone CLI command with this exact surface already exists, evaluating declaration-layer manifests rather than diagnosing runtime host internals.

For reference, running against our in-repo sandbox profile (192 units: 2 bundles, 190 entries) targeting runtime `0.2.2-rc.1` yields this upgrade card:

- 192 units -> 119 would be denied / 73 cannot-tell / 0 improved / 0 likely-fine

The 73 cannot-tell count is honest: those packages declare no compatibility constraints, so a declaration-layer tool cannot decide whether they will load.

The relevant read-only commands:

```console
dsh-triage upgrade --to 0.2.2-rc.1 --card
dsh-triage audit --all
```

The first command outputs the upgrade impact summary card for a target version, and `dsh-triage audit --all` provides a row-level ledger of all installed entries in the active profile. This is a standalone read-only tool rather than an upstream doctor command, and it does not make profile changes.

I maintain dsh-triage, the read-only tool that produced these numbers.

This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health.

Recompute artifact: https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/upgrade-card-2026-11-05T07-35-01.051Z.json (sha256 `64e82b370d8db1bad433714de0f616ed72fc144695b6f6855aa332c34e9c2342`)
<!-- paste:end -->
