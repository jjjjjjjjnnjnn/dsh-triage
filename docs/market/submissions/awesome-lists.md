# awesome 列表 + dsh.so · 提交文案

> **已提交**：`awesome-deepseekharness/awesome-deepseek-harness` → PR **#193**（`README.md` +1 / -0），
> 实时状态见 `data/results/market-channels-2026-10-29T22-40-00.000Z.json` 的 `submitted[]`。
> **未提交**：`walkinglabs/...`（文案在下面，随时可提）、`dsh.so`（等 npm 发布）。

## 1. walkinglabs/awesome-deepseek-harness-plugins

它自己的 CONTRIBUTING 规定格式：

```markdown
- [Project](https://example.com) - What it provides and its DSH compatibility.
```

条目行（放进插件区的字母序位置）：

```markdown
- [dsh-triage (分诊台)](https://github.com/jjjjjjjjnnjnn/dsh-triage) - Pre-install judgement and post-mortem attribution for DSH profiles: says why a plugin disappeared, measures a candidate in an isolated DSH_HOME, and shows the current composition read-only. DSH `>=0.2.0-rc.1 <0.3.0-0` (measured on 0.2.1-rc.4).
```

PR 标题/正文：

```text
docs: add dsh-triage (judgment layer for DSH plugins)
```

```markdown
Adds one entry to the plugin list.

`dsh-triage` answers two questions a profile owner actually has: "should I install this?" (declaration
check plus an isolated measurement) and "why did my plugin disappear?" (row-level admission, import
failures, declared-but-unregistered capabilities). It is read-only by design: no install/remove, no
credential access, no security claims.

- Repo: https://github.com/jjjjjjjjnnjnn/dsh-triage (MIT)
- DSH compatibility: `>=0.2.0-rc.1 <0.3.0-0`
- Publicly accessible, actively maintained; links verified on the day of submission.
```

## 2. awesome-deepseekharness/awesome-deepseek-harness

**已提交**：PR https://github.com/awesome-deepseekharness/awesome-deepseek-harness/pull/193
（`Tools, Workflows & Presets` 表末行，`README.md` +1 / -0；星标列按该表格式写 `0`）。

同一行条目；如果该列表要求「兼容性单列」，把它写成：

```markdown
- [dsh-triage](https://github.com/jjjjjjjjnnjnn/dsh-triage) — **DSH `>=0.2.0-rc.1 <0.3.0-0`** · pre-install judgement + post-mortem attribution; isolated probe evidence; read-only settings tab; `compat_verdict` agent tool.
```

## 3. dsh.so（站点表单，无 API）

需要已发布的 npm 包。表单里通常要：包名、一句话、主页、分类。推荐用：

| 字段 | 值 |
|---|---|
| Package | `dsh-triage` |
| Tagline (EN) | The judgment layer for DSH plugins: decide before you install, attribute after it breaks. |
| Tagline (ZH) | 装之前判断该不该装，装完坏了定位为什么——DSH 插件的判断层。 |
| Homepage | https://github.com/jjjjjjjjnnjnn/dsh-triage |
| Category | Diagnostics / Developer tools |
| Licence | MIT |

**不写的话术**（本项目严禁）：不写「安全 / 无恶意 / 100% 兼容 / 提升速度」，不写没有证据的下载量。

## 4. 索引源（两条 URL，都逐字节校验过）

仓库转 public 之后，**仓库内副本的 raw URL 是首选**（跟着分支走，重发布不换地址）：

```
https://raw.githubusercontent.com/jjjjjjjjnnjnn/dsh-triage/main/docs/market/index.json
```

备用（public gist，仓库若哪天又转回 private 时仍可用）：

```
https://gist.githubusercontent.com/jjjjjjjjnnjnn/3c77dfcb61affb60eb3508f87ca53bea/raw/index.json
```

证据与字节校验：`data/results/index-hosting-2026-10-29T22-00-00.000Z.json`（raw URL：`fetch.status=200`、
`bytes match=true`、`cors=*`、5 plugins / 5 versions）与 `data/results/index-hosting-2026-10-29T18-10-00.000Z.json`（gist 同款校验）。
