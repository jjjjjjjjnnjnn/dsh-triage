# M7 · 自动修复（autofix）判据

> **Stand**: R49 (2026-10-30)｜**状态**: 判据已定，**plan 已实现**（`packages/plugin/src/fix.ts`），**写入路径待批**
> 这份 spec 回答一件事：**哪些问题可以自动修、用什么证据证明修好了、以及为什么其余问题必须拒绝。**

---

## 1. 为什么不能"看见就修"

一条 denial 有三种"修法"，代价与安全性完全不同：

| 修法 | 机制 | 是否真的修好 | 风险 |
|---|---|---|---|
| **A. 固定到兼容版本**（pin） | 把 profile 依赖改成某个**声明了当前 runtime** 的精确版本，再装 | 是（声明对得上，重跑 audit 应消失） | 装包：网络、体积、可能引入行为变化；必须可回滚 |
| **B. 版本豁免**（exemption） | 写 `<profile>/compatibility.json`（上游 0.2.x 的 `allow-version`） | **只在 0.2.x 生效**；0.1.0-rc.6 不读这个文件 | 最轻，但**在本机是假的** |
| **C. 改插件自己的 `engines.dsh`** | 编辑 `node_modules/<pkg>/package.json` | 加载器会放行，**但这是对加载器撒谎** | 行为未验证，可能崩；升级/重装即失效 |

**结论**：C 永不实现。B 只在"运行时的确读取该文件"时才算修好——本机实测
`@deepseek-ai/dsh@0.1.0-rc.6` 的已安装包里**没有任何** `compatibility.json` / `allow-version`
实现（对整个 `@deepseek-ai` 目录做过全文搜索，0 命中）；0.2.1-rc.4 沙盒里有
（`dsh-app-boot/lib/index.js` 的 `setProfileVersionExemption`）。所以 B 必须在**运行时能力探测**
通过后才允许，否则就是"写了个没人读的文件"——比不修更糟。

## 2. 本轮的边界（写进代码里的）

1. `dsh-triage fix` 默认**只出计划**，不写盘。
2. `--apply` 只在两种情况下真的写：
   - **pin**：目标包已在 profile 的 `dependencies` 里（我们据此确定它怎么装），且能解析出一个
     **精确版本**，其 `engines.dsh` / peer 范围**包含当前 runtime**（逐字取自 registry，不改写）。
   - **exemption**：运行时能力探测为真（存在 `compatibility.json` 读取实现），且版本是规范精确版。
3. 任何写入都必须：**备份原文件 → 原子写（临时文件 + rename）→ 记 journal → 可 `--undo`**。
4. 写完之后**用同一个引擎重跑**一次判定：修好 = `denied` 消失；没消失就如实说"没修好"，
   并把备份还原（默认 `--rollback-on-failure`）。

## 3. 拒绝清单（必须永远保持）

| 情况 | 行为 |
|---|---|
| 运行时没有豁免实现 | `exemption` 项标 `unsupported`，不写文件 |
| 目标包不在 profile `dependencies` 里 | `pin` 项标 `unknown-install-shape`，只给命令 |
| 找不到包含当前 runtime 的版本 | `no-compatible-version`，只给命令（升级 DSH 或换插件） |
| 版本号不是精确 semver | 抛错，不猜 |
| `compatibility.json` 读不懂（非本工具写的） | 拒绝改写（会丢用户内容），要求人工处理 |
| 没有 `--apply` | 一律不写（含备份也不写） |

## 4. 证据口径

- 计划与结果都是**纯数据**（`FixPlan`），`--json` 输出，可被测试与面板复用；
- 写入结果带 `before` / `after` 的 sha256 与文件路径；
- 修好/没修好由**重跑判定**决定，不由脚本自述。

## 5. 下一步（需要 HUMAN 点头）

1. **授权跑安装**：`pin` 的"装"需要在 profile 目录执行 `pnpm install`。默认不做
   （`--install` 才做），因为它会改 `node_modules` 与 lockfile。
2. ~~**授权改判据**：让 `audit` 读取 `compatibility.json`~~ —— **R49 T-816 已交付**（HUMAN 批准）：
   `packages/core/src/exemption.ts` + 行级 verdict 的 `admission.exempted` 理由；见 `docs/04-admission-semantics.md`。
