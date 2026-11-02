<!-- channel: reply in upstream discussion #10849 (English) · draft -->
<!-- 状态: draft（未发布）。贴之前确认：① 回的是 #10849；② dist-tag 读数仍成立（它可能已经被修）。 -->

# 草稿 07 · 回复 #10849（`latest` 指向 0.0.1-rc.1，裸名安装必被拒）

> **这一条的要点**：失败**不在**使用者写的区间里，在 tag 上。先说这个，再给两条出路。

---

Confirming the mechanism, because it changes who can fix it: the rejection is not about the range in your profile — it is about **which build the bare name resolves to**.

`@deepseek-ai/dsh-mcp-client@0.0.1-rc.1` pins its peers to the 0.0.1 line:

```text
@deepseek-ai/dsh-llm@^0.0.1-rc.1        @deepseek-ai/dsh-tools@^0.0.1-rc.1
@deepseek-ai/dsh-invariants@^0.0.1-rc.1 @deepseek-ai/dsh-subprocess@^0.0.1-rc.1
```

Nothing in `0.2.x` satisfies `^0.0.1-rc.1`, so an unpinned `dsh plugin add @deepseek-ai/dsh-mcp-client` installs a build that admission must refuse. Two practical consequences:

1. **Workaround today**: install an explicit version whose peers admit your runtime, and stop relying on the tag.
2. **Where the fix belongs**: retagging `latest` is an upstream release action, not something a user can do locally.

If you want to know what a bare install would resolve to *before* running it:

```console
$ dsh-triage check @deepseek-ai/dsh-mcp-client          # names the build the tag resolves to
$ dsh-triage audit                                      # what your installed set already has
```

Boundary: this is a declaration-layer reading of the published builds; it says nothing about whether a given build works at runtime. And if the tag has moved since this was recorded, the `check` output above is the current truth, not this message.

Evidence artifact: `data/results/discussion-triage-2026-11-02T12-10-00-000Z.json`
