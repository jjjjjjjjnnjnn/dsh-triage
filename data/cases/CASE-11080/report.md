# CASE-11080 · 升级后插件行被静默禁用（真实报告）

> 取证等级：**A（可回溯的一手报告 + 真实的已发布 manifest）**
> 用途：T-101 真实案例验收（`docs/specs/M1-why.md` §3）。所有输入都已固化在本目录，复现不需要联网。

## 1. 报告原文（摘要）

| 项 | 值 |
|---|---|
| 来源 | https://github.com/deepseek-ai/deepseek-harness/discussions/11080 |
| 作者 | Yebeimu |
| 时间 | 2026-10-26 |
| 插件 | `@deepseek-ai/dsh-hooks-claude-code@0.2.1-rc.2` |
| 运行时 | 升级 `0.2.1-rc.2` → `0.2.1-rc.3`（桌面端） |
| 症状 | hooks 全部停止触发（删除守卫、每次提示的路由注记、编辑后结构检查）；`cordis.patch.yml` 里那一行从未加载；UI 里没有任何提示 |
| 运行期痕迹 | `di_loader_list` 报 `phase=no-fiber disabled=true`；唯一解释是启动时一行 stderr：`dsh: disabling profile plugin row ... incompatible with dsh ...` |

报告里还写了三个被浪费掉的错误猜测：改绝对路径、把行挪到 patch 末尾、删掉插件的 `inject` 声明（这条把运行时搞坏了，需要手工恢复）。

## 2. 根因（本仓判定）

该行的模块在 `peerDependencies` 里把 `@deepseek-ai/dsh-*` 钉成**精确版本** `0.2.1-rc.2`（共 9 个，含 `@deepseek-ai/dsh-llm`）。运行的是 `0.2.1-rc.3`，按 upstream admission 规则（peer 全 AND、prerelease 参与）全部不满足 → 该行被禁用。

这正是本仓 `docs/03-failure-taxonomy.md` 的 **F1（装了没反应）**，且是静态声明层就能给出答案的一类——不需要读 stderr。

## 3. 复现输入（全部已固化）

| 文件 | 内容 | 来源 |
|---|---|---|
| `runtime-dsh.json` | `@deepseek-ai/dsh@0.2.1-rc.3` 的真实 manifest | npm registry |
| `plugin-hooks-claude-code.json` | `@deepseek-ai/dsh-hooks-claude-code@0.2.1-rc.2` 的真实 manifest | npm registry |
| `profile-package.json` | 重建的 profile 清单（bundles 为空） | 本仓重建 |
| `profile-cordis.patch.yml` | 报告里那一行 row | 本仓重建 |
| `case.json` | 机器可读标注（含期望命中的 reason code） | 本仓 |

## 4. 复现与判定

```powershell
node scripts/record_case.mjs --case CASE-11080 --stamp 2026-10-26T00:00:00.000Z
```

产物：`data/results/why-case-CASE-11080-<stamp>.json` + `.sha256`（含 `verdicts`、`hit` 判定与输入哈希）。
命中判据是**机器可算的**：必须存在一个 verdict，其 `subject.name` = 插件模块、`reasons` 含 `admission-denied-peer`、该 reason 的 `params.key` = `@deepseek-ai/dsh-llm`，且 `admission.row-scope` 的 `params.rows` 含 `hooks-claude-code`。缺任一条即 `miss`，不得人工改成 `hit`。

## 5. 诚实边界（偏差披露）

1. **bundles 为空**：报告只涉及 `cordis.patch.yml` 的一行，故不引入 `dsh-base`/`dsh-web-app`，避免用无关行污染判定；
2. **node_modules 是重建的**：用真实已发布 manifest 铺出目录，而非完整 `npm install`，因此这是「声明层复现」而非「真机复现」；
3. **无法验证「修复后症状消失」**：原作者机器不在本机，退出条件按 `M1-why.md` 退化为「点名行 = 报告根因行 + 机器可算的命中指纹」；
4. **不含 stderr**：本案例的根因在声明层，故不需要 stderr；需要 stderr 的那类（`apply()` 抛错）仍是 T-102 的缺口。
