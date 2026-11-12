<!-- facts: docs/copy/facts/2026-11-12-10849-rc2-followup.md -->

# #10849 · next 推到 0.2.2-rc.2 之后，pin 要跟着走（草稿，**未发**）

> 状态：`draft`。帖子 `open`（`record_discussion_state --ids 10849`，2026-11-12T07:10Z：6 条评论、最后一条 `fly-pig31`、`isAnswered: false`）。
> 发布由 HUMAN 决定；D5 关窗（`2026-11-15T20:24:37Z`）前不开新动作。
> **文案来源**：外部 `agy --model gemini-3.8-flash-high` 读本事实包生成（2026-11-12，第五次尝试成功；前四次 503 / 超时）。数字与边界句由事实包锁死，措辞由 copywriter 负责。

<!-- paste:start -->
你指的那处源码我核过，成立。`scripts/release/families.ts` 的 `distTagForVersion()` 对 prerelease 确实只返回 `next`、从不移动 `latest`。

补充一下我们在 2026-11-12 读到的 dist-tags：
- `@deepseek-ai/dsh`: `latest=0.2.2-rc.1`、`next=0.2.2-rc.2`
- `@deepseek-ai/dsh-mcp-client`: `latest=0.0.1-rc.1`、`next=0.2.2-rc.2`

因为 peer 是精确钉定而非区间，每跳一个 rc 就要重新 pin。我们在目标运行时 `0.2.2-rc.2` 下，对 `@deepseek-ai/dsh-mcp-client` 四个构建的实测准入判定如下：

| 构建版本 | 准入判定 | peer 数 |
| --- | --- | --- |
| `@0.0.1-rc.1`（当前 npm latest） | denied | 4 项 peer，全部 `^0.0.1-rc.1` |
| `@0.2.1-rc.5` | denied | 8 项 peer，全部精确钉在 0.2.1-rc.5 |
| `@0.2.2-rc.1` | denied | 8 项 peer，全部精确钉在 0.2.2-rc.1 |
| `@0.2.2-rc.2` | admitted | 9 项 peer，全部精确钉在 0.2.2-rc.2 |

以上判的是 npm 上已发布的版本，不是你那台机器。声明层放行不等于运行期一定无故障；标签是可变的，你若之后重跑 check 请以当时读到的 registry 为准。
<!-- paste:end -->

## 数值来源

- `data/results/remedy-probe-2026-11-12T07-15-00-000Z.json`（`--target 0.2.2-rc.2`，四行 `admission_status` 与 `peer` 计数）
- `data/results/next-release-2026-11-12T06-50-44.469Z.json`（`next` `0.2.2-rc.1` → `0.2.2-rc.2`、`latest` 未动）
- `data/results/upgrade-card-2026-11-12T07-35-00.000Z.json`（`--to next` 真机 14/14，**仓内沙盒 profile**）

## 复算

```powershell
node scripts/record_remedy_probe.mjs --stamp 2026-11-12T07:15:00.000Z --target 0.2.2-rc.2 --out %TEMP% `
  --pins "@deepseek-ai/dsh-mcp-client@0.0.1-rc.1,@deepseek-ai/dsh-mcp-client@0.2.1-rc.5,@deepseek-ai/dsh-mcp-client@0.2.2-rc.1,@deepseek-ai/dsh-mcp-client@0.2.2-rc.2"
npm view @deepseek-ai/dsh-mcp-client dist-tags
```

## 不许改的边界

- 不许写成「上游修好了」：`latest` 仍是 `0.0.1-rc.1`。
- 不许写成「升级会修好」「装了就没事」。
- 不许把对方提出的根因写成我们的发现（正文是「你指的那处源码我核过」）。
- 不许出现事实包以外的数字。
- 正文里的每一行数字都要与 `remedy-probe` 产物逐项对得上（`check_listing` 的 `drafts-cite-real-artifacts` 负责）。
