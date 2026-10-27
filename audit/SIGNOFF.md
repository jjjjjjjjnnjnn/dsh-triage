# SIGNOFF · 授权与签署台账

> **为什么有这份文件**：这个仓里「signature」代表**授权**，不代表团签。把 agent 的复核写成「HUMAN 逐条审过」是另一种假证据——和伪造测试结果同性质。
> 因此每条记录都分三栏：**谁授权**、**谁执行与出结论**、**HUMAN 没有逐条看的部分**。
>
> 规则：
> 1. 签名只对「被点名的范围 + 当时的证据哈希」有效，跨轮不继承；
> 2. 冻结区（`data/gold/**`、`audit/gate_ledger.json` 的 negative_control、`packages/core/src/admission.ts` 规则顺序、`PROJECT_RULES.md` 铁律）必须有本文件对应条目；
> 3. 授权可以来自会话内明确批准，必须记录原话或摘要与日期；**不得事后补签**；
> 4. 执行方是 agent 时，必须写明模型与它**没有**做的事。

| 日期 | 范围 | 授权（HUMAN） | 执行与结论（agent） | HUMAN 未逐条复核的部分 | 证据 |
|---|---|---|---|---|---|
| 2026-10-27 | T-103 金标扩容（冻结区） | 会话内批准「T-103 金标扩容签字」 | DeepSeek V4.1 Flash：新增 6 条 synthetic，期望值由 `semantics_rules` 推导后写入；parity 门 27/27 | 6 条 `why` 文案与用例选取的人工复核；未由 HUMAN 逐条读 | `data/gold/admission-cases.json`（`signature` 字段）· `data/results/gates-2026-10-28T04-30-00.000Z.json` |
| 2026-10-27 | T-110 双 roadmap 合并（删文档） | 会话内批准「双 roadmap 合并」 | DeepSeek V4.1 Flash：保留 `docs/ROADMAP.md`，旧文件 `git mv` 到 `_archive/` 并登记，六处引用同步 | 合并后 §7 的措辞与优先级是否认可；未由 HUMAN 逐行校对 | `_archive/ARCHIVE_MANIFEST.md` · `data/results/gates-2026-10-28T04-40-00.000Z.json` |
| 2026-10-28 | R14 交付签收（M3 probe 执行器 + 上述两项） | 会话内原话：「好了，继续，你全方面审核测试以后替我签字，我已批准」 | DeepSeek V4.1 Flash：跑 166 测试 / 9 门 / `--mutate` 9/9；只读复核脚本抓出 F-1（沙盒逃逸）与 F-2（用户名进 SSOT）并当场修；重采三份产物 | **判据本身是否正确**（probe 的结论映射、`≤20s` 预算是否合理）；安全/合规口径的最终认定；未由 HUMAN 逐条审阅审核报告 | `audit/AUDIT_2026-10-28_R14.md` §7b · `data/results/gates-2026-10-28T07-20-00.000Z.json` · `audit/step_reviews.json` R14-S9 |

## 未决的授权项（尚未签，不要当成已签）

| 项 | 需要谁 | 为什么不能由 agent 代办 |
|---|---|---|
| `npm login` + 发布 `dsh-triage@0.0.1` | HUMAN 亲自操作 | 需要你的 npm 凭据；agent 不得读 `~/.npmrc` 或 token |
| 仓库转 public | HUMAN | 不可逆的对外动作（git 历史永久可见） |
| T-202a 真实会话（读 agent 作用域） | HUMAN 先签 ADR | 与铁律 4（不得读凭据 / 不得向沙盒注入真实凭据）冲突，改宪法必须有明文 ADR |
| 门禁阈值变更（若有） | HUMAN | 铁律 4：阈值变更需 spec + HUMAN-SIGN |

## 记录格式（后续照此追加）

```
| 日期 | 范围（文件/判据/阈值） | 授权（原话或摘要） | 执行与结论（模型 + 做了什么） | HUMAN 未逐条复核的部分 | 证据（产物 + sha256） |
```
