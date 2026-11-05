<!-- facts: docs/copy/facts/2026-11-05-outreach.md -->
# #10849 · @deepseek-ai/dsh-mcp-client dist-tag and 0.2.2-rc.1 admission
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/10849 · English · ready-to-post -->
<!-- paste:start -->
One data point on `@deepseek-ai/dsh-mcp-client` against target runtime `0.2.2-rc.1`: bare package installs still resolve to `0.0.1-rc.1`, and pinning to the earlier `0.2.1-rc.5` build is also rejected on `0.2.2-rc.1`.

Current npm dist-tags and declaration-layer admission verdicts on target `0.2.2-rc.1`:

- Registry dist-tags: `latest = 0.0.1-rc.1`, `next = 0.2.2-rc.1`
- `@deepseek-ai/dsh-mcp-client@0.0.1-rc.1` -> `denied` (4 peers, all `^0.0.1-rc.1`, which has no intersection with `0.2.2-rc.1`)
- `@deepseek-ai/dsh-mcp-client@0.2.1-rc.5` -> `denied` on `0.2.2-rc.1` (8 peers, all strictly pinned to `0.2.1-rc.5`)
- `@deepseek-ai/dsh-mcp-client@0.2.2-rc.1` -> `admitted` on `0.2.2-rc.1` (8 peers, all strictly pinned to `0.2.2-rc.1`)

The new detail for anyone upgrading to `0.2.2-rc.1` is that `0.2.1-rc.5` is not a reusable pin across minor rc jumps because all 8 peer declarations lock onto the exact rc version.

What you can do:
- Because updating the `latest` dist-tag requires an upstream publish action, pin the exact build matching your runtime instead of installing the bare package name or reusing `0.2.1-rc.5` on `0.2.2-rc.1`.
- If your runtime is `0.2.2-rc.1`, specify `@deepseek-ai/dsh-mcp-client@0.2.2-rc.1`.

Boundary: This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health. It also cannot observe local lockfile state or runtime MCP transport errors.

Recompute artifacts:
- https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/discussion-triage-2026-11-05T08-01-22-614Z.json (sha256 `edc89186b5d731370d88a56f7d78e3a193303cb7d9f89f40afaedd917a0bacb0`)
- https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-05T08-01-23-093Z.json (sha256 `132cec21ca9a89c230616a760065486e6fdda72ced7b89f28857a769278c4f54`)
<!-- paste:end -->
