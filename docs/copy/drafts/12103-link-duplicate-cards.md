<!-- facts: docs/copy/facts/2026-11-05-batch2.md -->
# #12103 · unconstrained link packages and inventory card duplication
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/12103 · English · ready-to-post -->
<!-- paste:start -->
One data point on the rejection reported during link installation: the "incompatible with 0.2.2-alpha.2" error cannot be a declaration-layer admission denial because neither package declares a DSH constraint.

Manifest admission readings at target runtime `0.2.2-alpha.2`:
- `@deepseek-ai/dsh-experimental-session-search@0.2.1-alpha.2` -> `unconstrained`
- `@deepseek-ai/dsh-experimental-terminal-bundle@0.2.1-alpha.2` -> `unconstrained`

Because both manifests evaluate to `unconstrained`, the declaration gate does not reject them. The refusal comes from another layer—such as the installer, pnpm workspace isolation, package `engines.node`, or dependency resolution. Treating this failure as a compatibility verdict sends the investigation in the wrong direction; inspect the raw installer error logs instead.

The duplicate or missing cards reflect profile and inventory rendering state rather than manifest gate rejection. While we cannot fix panel rendering bugs, you can inspect your profile entries using:

```console
dsh-triage audit --all
```

This lists duplicate copies of packages alongside their install paths and reports entry-id collisions.

I maintain dsh-triage, the read-only tool that produced these numbers.

This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health.

Recompute artifact: https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-05T08-37-27-222Z.json (sha256 `4f5c4c7e53bf6632851533f7a67c181332aa390ba3dc1f8690a34c89755f4b5b`)
<!-- paste:end -->
