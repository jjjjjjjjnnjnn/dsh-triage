<!-- channel: reply in upstream discussion #8202 (English) · draft -->
<!-- 状态: draft（未发布）。贴之前确认：① 回的是 #8202；② 版本号与区间仍与 registry 一致；③ 只贴下面正文。 -->

# 草稿 06 · 回复 #8202（`dsh-mcp-client@0.1.0-rc.7` 与 0.2.x 不兼容）

> **为什么这条最干净**：帖子自己点名了版本，我们的判定就按它点名的版本算（不是 latest），
> 区间是包自己声明的，与对方的配置无关。

---

Read the thread; the denial is in that build's own peers, not in your configuration.

`@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` declares its peers on the **0.1 line**:

```text
@deepseek-ai/dsh-llm@^0.1.0-rc.7          @deepseek-ai/dsh-tools@^0.1.0-rc.7
@deepseek-ai/dsh-timeout@^0.1.0-rc.7      @deepseek-ai/dsh-attachment@^0.1.0-rc.7
@deepseek-ai/dsh-invariants@^0.1.0-rc.7   @deepseek-ai/dsh-subprocess@^0.1.0-rc.7
```

`^0.1.0-rc.7` cannot be satisfied by any `0.2.x` build, so admission drops the row before it can register. No flag widens a range: the only ways out are (a) a build whose peers admit `0.2.x`, or (b) an explicit pair exemption if you accept the risk:

```console
$ dsh plugin --profile web allow-version @deepseek-ai/dsh-mcp-client@0.1.0-rc.7 --dsh-version 0.2.1-rc.5 --accept-risk
```

To see it on **your** profile instead of on a registry fact:

```console
$ dsh-triage audit                              # one line per row, with what was denied and why
$ dsh-triage check @deepseek-ai/dsh-mcp-client@0.1.0-rc.7
```

Two boundaries worth stating: this judges the **published package at that exact version**, not your machine — if your installed copy differs, compare its peers against the list above; and an exemption bypasses the declaration only, it does not make the plugin work.

Evidence artifact (machine-readable, with sha256 in the repo): `data/results/discussion-triage-2026-11-02T12-10-00-000Z.json`
