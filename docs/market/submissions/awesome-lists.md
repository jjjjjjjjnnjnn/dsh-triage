# awesome 列表 + dsh.so · 提交文案

> 三个渠道都要求「有公开可访问的来源」。**现在没有**（仓库 private、npm 未发布，见
> `data/results/market-channels-2026-10-29T18-40-00.000Z.json` 的 `prerequisites`）。
> 文案先备好；解锁后复制、提交即可。

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

## 4. 已可用的（无需等任何解锁）

format-1 索引源已经发布在一个公开 HTTPS URL 上，可直接在任何支持 format-1 索引的地方添加：

```
https://gist.githubusercontent.com/jjjjjjjjnnjnn/3c77dfcb61affb60eb3508f87ca53bea/raw/index.json
```

证据与字节校验：`data/results/index-hosting-2026-10-29T18-10-00.000Z.json`（`fetch.status=200`、
`bytes match=true`、`cors=*`、5 plugins / 5 versions、上游校验器 accepted）。
